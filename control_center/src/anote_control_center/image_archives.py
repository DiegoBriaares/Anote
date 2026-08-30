from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

from .errors import ContractError


DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
BLOB_PREFIX = "blobs/sha256/"
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 100_000
MAX_ARCHIVE_LOGICAL_BYTES = 10 * 1024**3
MANIFEST_MEDIA_TYPES = {
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
}
INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
ATTESTATION_TYPE = "attestation-manifest"
Descriptor = tuple[str, str, int]


@dataclass(frozen=True)
class ImageArchiveIdentity:
    tag: str
    config_digest: str
    manifest_digest: str
    load_digest: str
    operating_system: str
    architecture: str


def _fail(message: str) -> ContractError:
    return ContractError(message, code="invalid_release")


def _member_name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or path.as_posix() != name or any(part in {"", ".", ".."} for part in path.parts):
        raise ContractError("Runtime image archive contains an unsafe path.", code="unsafe_release")
    return name


def _scan(path: Path, wanted: set[str]) -> dict[str, bytes]:
    values: dict[str, bytes] = {}
    seen: set[str] = set()
    logical_bytes = 0
    try:
        with tarfile.open(path, mode="r|") as archive:
            for member in archive:
                if len(seen) >= MAX_ARCHIVE_MEMBERS or member.size < 0:
                    raise _fail("Runtime image archive member count is outside supported bounds.")
                name = _member_name(member.name)
                if name in seen:
                    raise ContractError("Runtime image archive contains duplicate members.", code="unsafe_release")
                seen.add(name)
                logical_bytes += member.size
                if logical_bytes > MAX_ARCHIVE_LOGICAL_BYTES:
                    raise _fail("Runtime image archive expands beyond supported bounds.")
                if not (member.isfile() or member.isdir()) or member.issym() or member.islnk():
                    raise ContractError("Runtime image archive contains a non-regular member.", code="unsafe_release")
                if name not in wanted:
                    continue
                if not member.isfile() or member.size < 0 or member.size > MAX_JSON_BYTES:
                    raise _fail("Runtime image metadata exceeds supported bounds.")
                stream = archive.extractfile(member)
                if stream is None:
                    raise _fail("Runtime image metadata is unreadable.")
                value = stream.read(MAX_JSON_BYTES + 1)
                if len(value) != member.size:
                    raise _fail("Runtime image metadata size changed while reading.")
                values[name] = value
    except (OSError, tarfile.TarError) as error:
        raise _fail("Runtime image archive is unreadable.") from error
    missing = wanted - set(values)
    if missing:
        raise _fail("Runtime image archive is missing OCI identity metadata.")
    return values


def _json(value: bytes, label: str) -> object:
    try:
        return json.loads(value.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise _fail(f"{label} is not valid UTF-8 JSON.") from error


def _digest(value: object, label: str) -> str:
    if not isinstance(value, str) or DIGEST_PATTERN.fullmatch(value) is None:
        raise _fail(f"{label} digest is invalid.")
    return value


def _blob_name(digest: str) -> str:
    return BLOB_PREFIX + digest.removeprefix("sha256:")


def _content_digest(value: bytes) -> str:
    return "sha256:" + sha256(value).hexdigest()


def _descriptor(value: object, label: str, media_types: set[str]) -> Descriptor:
    if not isinstance(value, dict) or value.get("mediaType") not in media_types:
        raise _fail(f"{label} media type is unsupported.")
    digest = _digest(value.get("digest"), label)
    size = value.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_JSON_BYTES:
        raise _fail(f"{label} size is invalid.")
    return str(value["mediaType"]), digest, size


def _descriptor_value(blobs: dict[str, bytes], descriptor: Descriptor, label: str) -> bytes:
    _media_type, digest, size = descriptor
    try:
        value = blobs[_blob_name(digest)]
    except KeyError as error:
        raise _fail(f"{label} blob is missing.") from error
    if len(value) != size or _content_digest(value) != digest:
        raise _fail(f"{label} blob does not match its descriptor.")
    return value


def _nested_runtime_descriptor(value: bytes, *, operating_system: str, architecture: str) -> tuple[Descriptor, tuple[Descriptor, ...]]:
    index = _json(value, "Nested OCI index")
    if not isinstance(index, dict) or index.get("schemaVersion") != 2 or index.get("mediaType") != INDEX_MEDIA_TYPE or not isinstance(index.get("manifests"), list):
        raise _fail("Nested OCI image index is unsupported.")
    runtime: list[Descriptor] = []
    attestations: list[tuple[Descriptor, str]] = []
    for raw in index["manifests"]:
        descriptor = _descriptor(raw, "Nested OCI descriptor", MANIFEST_MEDIA_TYPES)
        assert isinstance(raw, dict)
        platform = raw.get("platform")
        if platform == {"os": operating_system, "architecture": architecture}:
            runtime.append(descriptor)
            continue
        annotations = raw.get("annotations")
        if platform != {"os": "unknown", "architecture": "unknown"} or not isinstance(annotations, dict) or annotations.get("vnd.docker.reference.type") != ATTESTATION_TYPE:
            raise _fail("Nested OCI index contains an unexpected platform.")
        attestations.append((descriptor, _digest(annotations.get("vnd.docker.reference.digest"), "Attestation reference")))
    if len(runtime) != 1 or any(reference != runtime[0][1] for _descriptor_value_, reference in attestations):
        raise _fail("OCI attestations do not identify one requested platform image.")
    return runtime[0], tuple(descriptor for descriptor, _reference in attestations)


def inspect_image_archive(path: Path, expected_tag: str, *, operating_system: str, architecture: str) -> ImageArchiveIdentity:
    if path.is_symlink() or not path.is_file():
        raise _fail("Runtime image archive is unavailable.")
    metadata = _scan(path, {"manifest.json", "index.json", "oci-layout"})
    if _json(metadata["oci-layout"], "OCI layout") != {"imageLayoutVersion": "1.0.0"}:
        raise _fail("Runtime image OCI layout is unsupported.")

    legacy = _json(metadata["manifest.json"], "Docker save manifest")
    if not isinstance(legacy, list) or len(legacy) != 1 or not isinstance(legacy[0], dict):
        raise _fail("Runtime image Docker metadata is incomplete.")
    row = legacy[0]
    config_path = row.get("Config")
    tags = row.get("RepoTags")
    if not isinstance(config_path, str) or not config_path.startswith(BLOB_PREFIX) or tags != [expected_tag]:
        raise _fail("Runtime image tag or configuration identity is inconsistent.")
    config_digest = _digest("sha256:" + config_path.removeprefix(BLOB_PREFIX), "Runtime configuration")

    index = _json(metadata["index.json"], "OCI index")
    if not isinstance(index, dict) or index.get("schemaVersion") != 2 or not isinstance(index.get("manifests"), list) or len(index["manifests"]) != 1:
        raise _fail("Runtime image OCI index must contain one image descriptor.")
    top = _descriptor(index["manifests"][0], "OCI index descriptor", MANIFEST_MEDIA_TYPES | {INDEX_MEDIA_TYPE})
    wanted = {_blob_name(config_digest), _blob_name(top[1])}
    blobs = _scan(path, wanted)
    config_value = blobs[_blob_name(config_digest)]
    if _content_digest(config_value) != config_digest:
        raise _fail("Runtime image configuration content is invalid.")
    config = _json(config_value, "Runtime image configuration")
    if not isinstance(config, dict) or config.get("os") != operating_system or config.get("architecture") != architecture:
        raise ContractError("Runtime image platform does not match its release.", code="incompatible_platform")

    top_value = _descriptor_value(blobs, top, "OCI index")
    auxiliary: tuple[Descriptor, ...] = ()
    if top[0] == INDEX_MEDIA_TYPE:
        manifest, auxiliary = _nested_runtime_descriptor(top_value, operating_system=operating_system, architecture=architecture)
    else:
        manifest = top
    needed = {_blob_name(manifest[1]), *(_blob_name(item[1]) for item in auxiliary)}
    missing = needed - set(blobs)
    if missing:
        blobs.update(_scan(path, missing))
    for descriptor in auxiliary:
        _descriptor_value(blobs, descriptor, "OCI attestation")
    manifest_value = _descriptor_value(blobs, manifest, "OCI manifest")
    manifest_json = _json(manifest_value, "OCI manifest")
    if not isinstance(manifest_json, dict) or manifest_json.get("schemaVersion") != 2 or not isinstance(manifest_json.get("config"), dict):
        raise _fail("Runtime OCI manifest is incomplete.")
    declared_config = manifest_json["config"]
    if _digest(declared_config.get("digest"), "OCI configuration") != config_digest or declared_config.get("size") != len(config_value):
        raise _fail("Runtime OCI manifest and configuration disagree.")
    return ImageArchiveIdentity(expected_tag, config_digest, manifest[1], top[1], operating_system, architecture)
