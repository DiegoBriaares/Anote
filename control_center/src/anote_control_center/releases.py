from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import tempfile
from typing import Literal, Mapping
import zipfile

from . import __version__
from .errors import ContractError
from .image_archives import inspect_image_archive
from .model import RELEASE_PATTERN, SHA256_PATTERN, VERSION_PATTERN, version_key
from .platform_paths import ManagedPaths, PlatformIdentity
from .storage import atomic_json_write, ensure_private_directory, strict_json_read


SCHEMA_VERSION = 1
MAX_CANDIDATES = 256
MAX_MEMBERS = 64
MAX_MANIFEST_BYTES = 256 * 1024
MAX_SIGNATURE_BYTES = 64 * 1024
MAX_MEMBER_BYTES = 10 * 1024**3
MAX_EXPANDED_BYTES = 12 * 1024**3
MAX_COMPRESSION_RATIO = 200
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
MEMBER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$")
VERSION_REQUIREMENT_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){1,3}$")
REQUIRED_FILE_ROLES = frozenset({"api_image", "web_image", "compose_template", "gateway_template", "runtime_commands"})
REQUIRED_IMAGE_ROLES = frozenset({"api", "web"})
ReleaseChangeKind = Literal["upgrade", "downgrade", "replacement", "current", "incompatible"]


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ContractError(f"{label} must be an object.", code="invalid_release")
    return value


def _exact(value: dict[str, object], keys: set[str], label: str) -> None:
    if set(value) != keys:
        raise ContractError(f"{label} fields are incomplete or unsupported.", code="invalid_release")


def _canonical_member(value: object) -> str:
    if not isinstance(value, str) or MEMBER_PATTERN.fullmatch(value) is None or "\\" in value:
        raise ContractError("Release member path is invalid.", code="unsafe_release")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(part in {"", ".", ".."} for part in path.parts):
        raise ContractError("Release member path is not canonical.", code="unsafe_release")
    if path.parts[0] not in {"images", "runtime"}:
        raise ContractError("Release member is outside supported roots.", code="unsafe_release")
    return value


def _numeric_requirement(value: object, label: str) -> str:
    if not isinstance(value, str) or VERSION_REQUIREMENT_PATTERN.fullmatch(value) is None:
        raise ContractError(f"{label} requirement is invalid.", code="invalid_release")
    return value


@dataclass(frozen=True)
class ReleaseFile:
    path: str
    role: str
    size: int
    sha256: str

    def __post_init__(self) -> None:
        _canonical_member(self.path)
        if self.role not in REQUIRED_FILE_ROLES:
            raise ContractError("Release file role is unsupported.", code="invalid_release")
        if isinstance(self.size, bool) or not isinstance(self.size, int) or not 0 < self.size <= MAX_MEMBER_BYTES:
            raise ContractError("Release file size is outside the supported bound.", code="invalid_release")
        if SHA256_PATTERN.fullmatch(self.sha256) is None:
            raise ContractError("Release file digest is invalid.", code="invalid_release")


@dataclass(frozen=True)
class RuntimeImage:
    role: str
    tag: str
    archive_path: str
    config_digest: str
    manifest_digest: str
    load_digest: str
    operating_system: str
    architecture: str

    def __post_init__(self) -> None:
        if self.role not in REQUIRED_IMAGE_ROLES:
            raise ContractError("Runtime image role is unsupported.", code="invalid_release")
        if not re.fullmatch(r"anote-(?:api|web):[A-Za-z0-9._-]{1,128}", self.tag):
            raise ContractError("Runtime image tag is invalid.", code="invalid_release")
        _canonical_member(self.archive_path)
        if any(DIGEST_PATTERN.fullmatch(value) is None for value in (self.config_digest, self.manifest_digest, self.load_digest)):
            raise ContractError("Runtime image identity is invalid.", code="invalid_release")
        if self.operating_system != "linux" or self.architecture not in {"amd64", "arm64"}:
            raise ContractError("Runtime image platform is unsupported.", code="invalid_release")

    @property
    def accepted_runtime_digests(self) -> frozenset[str]:
        """Exact IDs Docker may expose for this verified archive across image stores."""
        return frozenset((self.config_digest, self.manifest_digest, self.load_digest))


@dataclass(frozen=True)
class RuntimeCommands:
    migrate: tuple[str, ...]
    bootstrap_admin: tuple[str, ...]

    @staticmethod
    def _command(value: object, label: str) -> tuple[str, ...]:
        if not isinstance(value, list) or not 1 <= len(value) <= 16:
            raise ContractError(f"{label} command is invalid.", code="invalid_release")
        if not all(isinstance(part, str) and 1 <= len(part) <= 256 and not any(char in part for char in "\x00\r\n") for part in value):
            raise ContractError(f"{label} command contains an unsafe argument.", code="invalid_release")
        return tuple(value)

    @classmethod
    def parse(cls, payload: bytes) -> "RuntimeCommands":
        if len(payload) > 64 * 1024:
            raise ContractError("Runtime command bundle is too large.", code="invalid_release")
        try:
            raw = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ContractError("Runtime command bundle is unreadable.", code="invalid_release") from error
        value = _object(raw, "Runtime commands")
        _exact(value, {"schema_version", "migrate", "bootstrap_admin"}, "Runtime commands")
        if value["schema_version"] != 1:
            raise ContractError("Runtime command schema is unsupported.", code="invalid_release")
        return cls(cls._command(value["migrate"], "Migration"), cls._command(value["bootstrap_admin"], "Administrator bootstrap"))


@dataclass(frozen=True)
class ReleaseManifest:
    release_id: str
    version: str
    source_commit: str
    minimum_control_center_version: str
    minimum_installed_version: str
    minimum_data_schema: int
    maximum_data_schema: int
    platform: PlatformIdentity
    minimum_docker_engine: str
    minimum_docker_compose: str
    files: tuple[ReleaseFile, ...]
    images: tuple[RuntimeImage, ...]
    signing_policy: Literal["unsigned-disclosed", "signed"]

    def __post_init__(self) -> None:
        if RELEASE_PATTERN.fullmatch(self.release_id) is None or VERSION_PATTERN.fullmatch(self.version) is None:
            raise ContractError("Release identity is invalid.", code="invalid_release")
        if COMMIT_PATTERN.fullmatch(self.source_commit) is None:
            raise ContractError("Release source commit is invalid.", code="invalid_release")
        version_key(self.minimum_control_center_version)
        version_key(self.minimum_installed_version)
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (
            self.minimum_data_schema, self.maximum_data_schema
        )) or self.minimum_data_schema > self.maximum_data_schema:
            raise ContractError("Release data schema range is invalid.", code="invalid_release")
        _numeric_requirement(self.minimum_docker_engine, "Docker Engine")
        _numeric_requirement(self.minimum_docker_compose, "Docker Compose")
        roles = [item.role for item in self.files]
        paths = [item.path for item in self.files]
        if set(roles) != REQUIRED_FILE_ROLES or len(roles) != len(REQUIRED_FILE_ROLES) or len(paths) != len(set(paths)):
            raise ContractError("Release files are incomplete or duplicated.", code="invalid_release")
        if sum(item.size for item in self.files) > MAX_EXPANDED_BYTES:
            raise ContractError("Release expands beyond the supported bound.", code="invalid_release")
        image_roles = [image.role for image in self.images]
        if set(image_roles) != REQUIRED_IMAGE_ROLES or len(image_roles) != len(REQUIRED_IMAGE_ROLES):
            raise ContractError("Runtime images are incomplete or duplicated.", code="invalid_release")
        file_paths = {item.path for item in self.files}
        if any(image.archive_path not in file_paths or image.architecture != self.platform.container_architecture for image in self.images):
            raise ContractError("Runtime image metadata disagrees with release files or platform.", code="invalid_release")
        if self.signing_policy not in {"unsigned-disclosed", "signed"}:
            raise ContractError("Release signing disclosure is invalid.", code="invalid_release")

    def file_for_role(self, role: str) -> ReleaseFile:
        try:
            return next(item for item in self.files if item.role == role)
        except StopIteration as error:
            raise ContractError(f"Release file role is missing: {role}.", code="invalid_release") from error

    def image_for_role(self, role: str) -> RuntimeImage:
        try:
            return next(item for item in self.images if item.role == role)
        except StopIteration as error:
            raise ContractError(f"Runtime image role is missing: {role}.", code="invalid_release") from error

    @property
    def supports_control_center(self) -> bool:
        return version_key(__version__) >= version_key(self.minimum_control_center_version)

    def supports_data_schema(self, schema: int) -> bool:
        return self.minimum_data_schema <= schema <= self.maximum_data_schema

    @classmethod
    def parse(cls, payload: bytes) -> "ReleaseManifest":
        if len(payload) > MAX_MANIFEST_BYTES:
            raise ContractError("Release manifest is too large.", code="invalid_release")
        try:
            raw = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ContractError("Release manifest is not valid UTF-8 JSON.", code="invalid_release") from error
        root = _object(raw, "Release manifest")
        _exact(root, {"kind", "schema_version", "release", "platform", "prerequisites", "images", "files", "publication"}, "Release manifest")
        if root["kind"] != "anote-release" or root["schema_version"] != SCHEMA_VERSION:
            raise ContractError("Release manifest kind or schema is unsupported.", code="invalid_release")
        release = _object(root["release"], "Release identity")
        _exact(release, {
            "id", "version", "source_commit", "minimum_control_center_version", "minimum_installed_version",
            "minimum_data_schema", "maximum_data_schema",
        }, "Release identity")
        platform = _object(root["platform"], "Release platform")
        _exact(platform, {"host_os", "host_arch", "container_os", "container_arch"}, "Release platform")
        prerequisites = _object(root["prerequisites"], "Release prerequisites")
        _exact(prerequisites, {"docker_engine", "docker_compose"}, "Release prerequisites")
        publication = _object(root["publication"], "Release publication")
        _exact(publication, {"signing_policy"}, "Release publication")
        file_values = root["files"]
        if not isinstance(file_values, list) or len(file_values) != len(REQUIRED_FILE_ROLES):
            raise ContractError("Release file manifest is invalid.", code="invalid_release")
        files: list[ReleaseFile] = []
        for value in file_values:
            row = _object(value, "Release file")
            _exact(row, {"path", "role", "size", "sha256"}, "Release file")
            files.append(ReleaseFile(str(row["path"]), str(row["role"]), row["size"], str(row["sha256"])))  # type: ignore[arg-type]
        image_values = root["images"]
        if not isinstance(image_values, list) or len(image_values) != len(REQUIRED_IMAGE_ROLES):
            raise ContractError("Runtime image manifest is invalid.", code="invalid_release")
        images: list[RuntimeImage] = []
        for value in image_values:
            row = _object(value, "Runtime image")
            keys = {"role", "tag", "archive_path", "config_digest", "manifest_digest", "load_digest", "operating_system", "architecture"}
            _exact(row, keys, "Runtime image")
            images.append(RuntimeImage(*(str(row[key]) for key in (
                "role", "tag", "archive_path", "config_digest", "manifest_digest", "load_digest", "operating_system", "architecture"
            ))))
        return cls(
            str(release["id"]), str(release["version"]), str(release["source_commit"]),
            str(release["minimum_control_center_version"]), str(release["minimum_installed_version"]),
            release["minimum_data_schema"], release["maximum_data_schema"],  # type: ignore[arg-type]
            PlatformIdentity(
                str(platform["host_os"]), str(platform["host_arch"]),  # type: ignore[arg-type]
                str(platform["container_os"]), str(platform["container_arch"]),
            ),
            str(prerequisites["docker_engine"]), str(prerequisites["docker_compose"]),
            tuple(files), tuple(images), str(publication["signing_policy"]),  # type: ignore[arg-type]
        )


@dataclass(frozen=True)
class VerifiedRelease:
    package_path: Path
    package_sha256: str
    manifest_sha256: str
    manifest: ReleaseManifest
    commands: RuntimeCommands
    cache_root: Path
    signer_key_id: str | None

    @property
    def signed(self) -> bool:
        return self.manifest.signing_policy == "signed"

    def asset(self, role: str) -> Path:
        return self.cache_root / self.manifest.file_for_role(role).path

    def assert_current(self) -> None:
        if file_sha256(self.package_path) != self.package_sha256:
            raise ContractError("Selected release changed after verification.", code="release_changed")
        receipt = strict_json_read(self.cache_root / "receipt.json", max_bytes=64 * 1024)
        if receipt != {
            "schema_version": 1,
            "package_sha256": self.package_sha256,
            "manifest_sha256": self.manifest_sha256,
        }:
            raise ContractError("Verified release receipt is inconsistent.", code="release_changed")
        for item in self.manifest.files:
            path = self.cache_root / item.path
            if path.is_symlink() or not path.is_file() or path.stat().st_size != item.size or file_sha256(path) != item.sha256:
                raise ContractError("Verified release cache changed after verification.", code="release_changed")


@dataclass(frozen=True)
class ReleaseCandidate:
    path: Path
    release: VerifiedRelease | None
    error_code: str | None
    error_message: str | None


@dataclass(frozen=True)
class ReleaseChange:
    kind: ReleaseChangeKind
    installed_version: str
    selected_version: str

    @property
    def can_apply(self) -> bool:
        return self.kind in {"upgrade", "downgrade", "replacement"}

    @property
    def requires_confirmation(self) -> bool:
        return self.kind in {"downgrade", "replacement"}


def classify_release_change(
    manifest: ReleaseManifest,
    *,
    installed_release_id: str,
    installed_version: str,
    installed_source_commit: str,
) -> ReleaseChange:
    if manifest.release_id != installed_release_id:
        return ReleaseChange("replacement", installed_version, manifest.version)
    selected = version_key(manifest.version)
    installed = version_key(installed_version)
    if selected == installed and manifest.source_commit == installed_source_commit:
        return ReleaseChange("current", installed_version, manifest.version)
    if selected == installed:
        return ReleaseChange("replacement", installed_version, manifest.version)
    if selected > installed:
        if installed < version_key(manifest.minimum_installed_version):
            return ReleaseChange("incompatible", installed_version, manifest.version)
        return ReleaseChange("upgrade", installed_version, manifest.version)
    return ReleaseChange("downgrade", installed_version, manifest.version)


class ReleaseVerifier:
    """Turn an untrusted package into immutable typed bytes before Docker can see it."""

    def __init__(
        self,
        *,
        platform: PlatformIdentity,
        cache_root: Path,
        signing_keys: Mapping[str, bytes] | None = None,
        require_signed: bool = False,
        managed_paths: ManagedPaths | None = None,
    ) -> None:
        self.platform = platform
        self.cache_root = cache_root.resolve(strict=False)
        self.signing_keys = dict(signing_keys or {})
        self.require_signed = require_signed
        self.managed_paths = managed_paths

    def verify(self, package_path: Path) -> VerifiedRelease:
        if self.managed_paths is not None:
            self.managed_paths.assert_safe(self.cache_root)
        if package_path.is_symlink():
            raise ContractError("Select a regular .anote-release file.", code="invalid_release")
        path = package_path.resolve(strict=True)
        if path.is_symlink() or not path.is_file() or path.suffix != ".anote-release":
            raise ContractError("Select a regular .anote-release file.", code="invalid_release")
        package_digest = file_sha256(path)
        try:
            with zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                self._validate_zip_infos(archive, infos)
                names = [info.filename for info in infos]
                if "manifest.json" not in names:
                    raise ContractError("Release manifest is missing.", code="invalid_release")
                manifest_bytes = archive.read("manifest.json")
                manifest_digest = sha256(manifest_bytes).hexdigest()
                manifest = ReleaseManifest.parse(manifest_bytes)
                if manifest.platform != self.platform:
                    raise ContractError("Release package does not match this computer.", code="incompatible_platform")
                if not manifest.supports_control_center:
                    raise ContractError("Update Anote Control Center before using this release.", code="control_center_too_old")
                expected = {"manifest.json", *(item.path for item in manifest.files)}
                signer_key_id: str | None = None
                if manifest.signing_policy == "signed":
                    expected.add("signature.json")
                    if "signature.json" in names:
                        signer_key_id = self._verify_signature(archive, manifest_bytes)
                elif "signature.json" in names:
                    raise ContractError("Unsigned release contains contradictory signature metadata.", code="invalid_signature")
                if self.require_signed and manifest.signing_policy != "signed":
                    raise ContractError("A signed release is required by local policy.", code="signature_required")
                if set(names) != expected:
                    raise ContractError("Release contains missing or undeclared files.", code="invalid_release")
                for item in manifest.files:
                    info = archive.getinfo(item.path)
                    if info.file_size != item.size:
                        raise ContractError("Release file size does not match its manifest.", code="invalid_release")
                    digest = sha256()
                    with archive.open(info) as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(chunk)
                    if not hmac.compare_digest(digest.hexdigest(), item.sha256):
                        raise ContractError("Release file digest does not match its manifest.", code="invalid_release")
                cache = self._extract(archive, manifest, manifest_bytes, package_digest, manifest_digest)
        except (zipfile.BadZipFile, OSError) as error:
            raise ContractError("Release package cannot be read safely.", code="invalid_release") from error
        commands = RuntimeCommands.parse((cache / manifest.file_for_role("runtime_commands").path).read_bytes())
        for image in manifest.images:
            self._verify_image_archive(cache / image.archive_path, image)
        release = VerifiedRelease(path, package_digest, manifest_digest, manifest, commands, cache, signer_key_id)
        release.assert_current()
        return release

    @staticmethod
    def _validate_zip_infos(archive: zipfile.ZipFile, infos: list[zipfile.ZipInfo]) -> None:
        if not 1 <= len(infos) <= MAX_MEMBERS:
            raise ContractError("Release package member count is invalid.", code="invalid_release")
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ContractError("Release contains duplicate members.", code="unsafe_release")
        total = 0
        intervals: list[tuple[int, int]] = []
        for info in infos:
            if info.is_dir() or info.flag_bits & ~0x800 or info.compress_type != zipfile.ZIP_STORED:
                raise ContractError("Release members use unsupported ZIP flags or compression.", code="unsafe_release")
            if info.filename not in {"manifest.json", "signature.json"}:
                _canonical_member(info.filename)
            mode = info.external_attr >> 16
            if stat.S_IFMT(mode) not in {0, stat.S_IFREG}:
                raise ContractError("Release contains a non-regular member.", code="unsafe_release")
            limit = MAX_MANIFEST_BYTES if info.filename == "manifest.json" else MAX_SIGNATURE_BYTES if info.filename == "signature.json" else MAX_MEMBER_BYTES
            if info.file_size < 0 or info.file_size > limit:
                raise ContractError("Release member size is outside the supported bound.", code="invalid_release")
            if info.compress_size == 0 and info.file_size > 0:
                raise ContractError("Release compression metadata is unsafe.", code="unsafe_release")
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise ContractError("Release compression ratio is unsafe.", code="unsafe_release")
            total += info.file_size
            if archive.fp is None:
                raise ContractError("Release ZIP stream is unavailable.", code="invalid_release")
            archive.fp.seek(info.header_offset)
            header = archive.fp.read(30)
            if len(header) != 30:
                raise ContractError("Release local header is incomplete.", code="unsafe_release")
            try:
                values = struct.unpack("<4s2B4HL2L2H", header)
            except struct.error as error:
                raise ContractError("Release local header is invalid.", code="unsafe_release") from error
            signature, flags, method, crc, compressed, expanded, name_length, extra_length = (
                values[0], values[3], values[4], values[7], values[8], values[9], values[10], values[11]
            )
            name_bytes = archive.fp.read(name_length)
            archive.fp.seek(extra_length, os.SEEK_CUR)
            if (
                signature != b"PK\x03\x04"
                or flags != info.flag_bits
                or method != info.compress_type
                or crc != info.CRC
                or compressed not in {info.compress_size, 0xFFFFFFFF}
                or expanded not in {info.file_size, 0xFFFFFFFF}
                or name_bytes != info.filename.encode("ascii")
            ):
                raise ContractError("Release local and central headers disagree.", code="unsafe_release")
            data_start = info.header_offset + 30 + name_length + extra_length
            intervals.append((info.header_offset, data_start + info.compress_size))
        if total > MAX_EXPANDED_BYTES + MAX_MANIFEST_BYTES:
            raise ContractError("Release expands beyond the supported bound.", code="invalid_release")
        intervals.sort()
        start_directory = getattr(archive, "start_dir", None)
        if any(end > next_start for (_, end), (next_start, _) in zip(intervals, intervals[1:])) or (
            intervals and isinstance(start_directory, int) and intervals[-1][1] > start_directory
        ):
            raise ContractError("Release ZIP members overlap.", code="unsafe_release")

    def _verify_signature(self, archive: zipfile.ZipFile, manifest: bytes) -> str:
        payload = archive.read("signature.json")
        if len(payload) > MAX_SIGNATURE_BYTES:
            raise ContractError("Release signature is too large.", code="invalid_signature")
        try:
            raw = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ContractError("Release signature is invalid.", code="invalid_signature") from error
        value = _object(raw, "Release signature")
        _exact(value, {"schema_version", "algorithm", "key_id", "manifest_sha256", "signature"}, "Release signature")
        if value["schema_version"] != 1 or value["algorithm"] != "hmac-sha256":
            raise ContractError("Release signature algorithm is unsupported.", code="invalid_signature")
        key_id = value["key_id"]
        if not isinstance(key_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", key_id):
            raise ContractError("Release signer identity is invalid.", code="invalid_signature")
        key = self.signing_keys.get(key_id)
        if key is None:
            raise ContractError("Release signer is not trusted on this computer.", code="untrusted_signer")
        manifest_digest = sha256(manifest).hexdigest()
        if value["manifest_sha256"] != manifest_digest:
            raise ContractError("Release signature manifest digest is invalid.", code="invalid_signature")
        expected = hmac.new(key, manifest, sha256).hexdigest()
        if not isinstance(value["signature"], str) or not hmac.compare_digest(value["signature"], expected):
            raise ContractError("Release signature verification failed.", code="invalid_signature")
        return key_id

    def _extract(
        self,
        archive: zipfile.ZipFile,
        manifest: ReleaseManifest,
        manifest_bytes: bytes,
        package_digest: str,
        manifest_digest: str,
    ) -> Path:
        target = self.cache_root / package_digest
        receipt = target / "receipt.json"
        if self.managed_paths is not None:
            self.managed_paths.assert_safe(target)
        expected_receipt = {
            "schema_version": 1,
            "package_sha256": package_digest,
            "manifest_sha256": manifest_digest,
        }
        if target.exists():
            if target.is_symlink() or strict_json_read(
                receipt,
                max_bytes=64 * 1024,
                managed_paths=self.managed_paths,
            ) != expected_receipt:
                raise ContractError("Verified release cache is inconsistent.", code="unsafe_release_cache")
            return target
        ensure_private_directory(self.cache_root, managed_paths=self.managed_paths)
        work_root = self.cache_root.parent / "work"
        ensure_private_directory(work_root, managed_paths=self.managed_paths)
        staging = Path(tempfile.mkdtemp(prefix="release.", dir=work_root))
        try:
            for item in manifest.files:
                destination = staging.joinpath(*PurePosixPath(item.path).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item.path) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                if file_sha256(destination) != item.sha256:
                    raise ContractError("Extracted release file failed verification.", code="invalid_release")
            (staging / "manifest.json").write_bytes(manifest_bytes)
            atomic_json_write(staging / "receipt.json", expected_receipt, managed_paths=self.managed_paths)
            os.replace(staging, target)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise
        return target

    @staticmethod
    def _verify_image_archive(path: Path, image: RuntimeImage) -> None:
        identity = inspect_image_archive(
            path,
            image.tag,
            operating_system=image.operating_system,
            architecture=image.architecture,
        )
        if (
            identity.config_digest,
            identity.manifest_digest,
            identity.load_digest,
        ) != (image.config_digest, image.manifest_digest, image.load_digest):
            raise ContractError("Runtime image archive identity disagrees with its release manifest.", code="invalid_release")


class ReleaseInbox:
    def __init__(self, root: Path, verifier: ReleaseVerifier, *, managed_paths: ManagedPaths | None = None) -> None:
        self.root = root
        self.verifier = verifier
        self.managed_paths = managed_paths

    def discover(self) -> tuple[ReleaseCandidate, ...]:
        ensure_private_directory(self.root, managed_paths=self.managed_paths)
        paths = sorted(self.root.glob("*.anote-release"), key=lambda item: item.name.lower())[:MAX_CANDIDATES]
        candidates: list[ReleaseCandidate] = []
        for path in paths:
            try:
                candidates.append(ReleaseCandidate(path, self.verifier.verify(path), None, None))
            except ContractError as error:
                candidates.append(ReleaseCandidate(path, None, error.code, str(error)))
        return tuple(candidates)
