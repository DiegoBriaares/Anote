from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import struct
import tarfile
import tempfile
import time
from typing import Callable
import zipfile

from .errors import ContractError, RuntimeStillActiveError
from .model import Installation, RELEASE_PATTERN, SHA256_PATTERN, VERSION_PATTERN
from .platform_paths import ManagedPaths, is_link_or_junction
from .releases import ReleaseManifest, file_sha256
from .storage import (
    InstallationRegistry,
    OperationJournal,
    OperationLock,
    OperationRecord,
    atomic_json_write,
    ensure_private_directory,
    strict_json_read,
)


CHECKPOINT_SCHEMA = 1
MAX_DATABASE_BYTES = 128 * 1024**3
MAX_UPLOAD_ARCHIVE_BYTES = 1024**4
MAX_UPLOAD_FILES = 1_000_000
MAX_UPLOAD_ENTRIES = 1_000_000
MAX_UPLOAD_BYTES = 1024**4
CHECKPOINT_MEMBERS = frozenset({"manifest.json", "calendar.db", "uploads.tar"})
WINDOWS_RESERVED_NAMES = frozenset({
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
})
STAGED_CHECKPOINT_PATTERN = re.compile(r"checkpoint\.package-[0-9a-f]{12}\.anote-checkpoint")
CHECKPOINT_WORK_PATTERN = re.compile(r"checkpoint\.work-[0-9a-f]{12}")
CHECKPOINT_DATA_PATTERNS = {
    "staging": re.compile(r"data\.checkpoint-[0-9a-f]{12}"),
    "previous": re.compile(r"data\.previous-[0-9a-f]{12}"),
    "failed": re.compile(r"data\.failed-[0-9a-f]{12}"),
}


def checkpoint_staging_path(paths: ManagedPaths, name: str) -> Path:
    """Resolve one journaled checkpoint staging name inside managed production storage."""
    if not isinstance(name, str) or STAGED_CHECKPOINT_PATTERN.fullmatch(name) is None:
        raise ContractError("Checkpoint recovery staging identity is invalid.", code="recovery_failed")
    return paths.assert_safe(paths.production / name)


def checkpoint_work_path(paths: ManagedPaths, name: str) -> Path:
    """Resolve one journal-owned checkpoint work directory under the managed root."""
    if not isinstance(name, str) or CHECKPOINT_WORK_PATTERN.fullmatch(name) is None:
        raise ContractError("Checkpoint recovery work identity is invalid.", code="recovery_failed")
    return paths.assert_safe(paths.root / name)


def checkpoint_data_path(paths: ManagedPaths, name: str, kind: str) -> Path:
    """Resolve one journal-owned checkpoint data directory by its declared role."""
    pattern = CHECKPOINT_DATA_PATTERNS.get(kind)
    if pattern is None or not isinstance(name, str) or pattern.fullmatch(name) is None:
        raise ContractError("Checkpoint recovery data identity is invalid.", code="recovery_failed")
    return paths.assert_safe(paths.production / name)


def _validate_portable_upload_path(path: PurePosixPath) -> None:
    if len(path.as_posix()) > 240:
        raise ContractError("Checkpoint upload path is too long for a portable checkpoint.", code="checkpoint_unsafe")
    for part in path.parts:
        stem = part.split(".", 1)[0].upper()
        if (
            len(part.encode("utf-8")) > 255
            or part.endswith((" ", "."))
            or any(ord(character) < 32 or character in '<>:"|?*' for character in part)
            or stem in WINDOWS_RESERVED_NAMES
        ):
            raise ContractError("Checkpoint upload path is not portable across supported systems.", code="checkpoint_unsafe")


def _validate_checkpoint_zip_layout(archive: zipfile.ZipFile, infos: list[zipfile.ZipInfo]) -> None:
    """Cross-check local/central ZIP headers and refuse overlapping byte ranges."""
    intervals: list[tuple[int, int]] = []
    if archive.fp is None:
        raise ContractError("Checkpoint ZIP stream is unavailable.", code="checkpoint_invalid")
    for info in infos:
        archive.fp.seek(info.header_offset)
        header = archive.fp.read(30)
        if len(header) != 30:
            raise ContractError("Checkpoint local header is incomplete.", code="checkpoint_unsafe")
        try:
            values = struct.unpack("<4s2B4HL2L2H", header)
            name = info.filename.encode("ascii")
        except (struct.error, UnicodeEncodeError) as error:
            raise ContractError("Checkpoint local header is invalid.", code="checkpoint_unsafe") from error
        signature, flags, method, crc, compressed, expanded, name_length, extra_length = (
            values[0], values[3], values[4], values[7], values[8], values[9], values[10], values[11]
        )
        local_name = archive.fp.read(name_length)
        if (
            signature != b"PK\x03\x04"
            or flags != info.flag_bits
            or method != info.compress_type
            or crc != info.CRC
            or compressed not in {info.compress_size, 0xFFFFFFFF}
            or expanded not in {info.file_size, 0xFFFFFFFF}
            or local_name != name
        ):
            raise ContractError("Checkpoint local and central headers disagree.", code="checkpoint_unsafe")
        start = info.header_offset + 30 + name_length + extra_length
        intervals.append((info.header_offset, start + info.compress_size))
    intervals.sort()
    directory = getattr(archive, "start_dir", None)
    if any(end > next_start for (_, end), (next_start, _) in zip(intervals, intervals[1:])) or (
        intervals and isinstance(directory, int) and intervals[-1][1] > directory
    ):
        raise ContractError("Checkpoint ZIP members overlap.", code="checkpoint_unsafe")


def _validate_checkpoint_database(
    path: Path,
    *,
    expected_schema: int | None = None,
    require_empty_sessions: bool = False,
) -> None:
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            schema_row = connection.execute(
                "SELECT MAX(version) FROM schema_migrations"
            ).fetchone() if expected_schema is not None else None
            sessions = None
            if require_empty_sessions:
                sessions_table = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
                ).fetchone()
                sessions = connection.execute("SELECT COUNT(*) FROM sessions").fetchone() if sessions_table else (0,)
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise ContractError("The Anote database could not be validated.", code="database_invalid") from error
    if integrity != ("ok",) or foreign_keys:
        raise ContractError("The Anote database failed its integrity check.", code="database_invalid")
    if expected_schema is not None and schema_row != (expected_schema,):
        raise ContractError("Checkpoint data schema does not match its manifest.", code="checkpoint_invalid")
    if require_empty_sessions and sessions != (0,):
        raise ContractError("Checkpoint contains local browser sessions.", code="checkpoint_private_data")


def _integrity_check(path: Path) -> None:
    _validate_checkpoint_database(path)


def backup_database(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise ContractError("The Anote database is unavailable or unsafe.", code="database_missing")
    ensure_private_directory(destination.parent)
    try:
        source_connection = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
        destination_connection = sqlite3.connect(destination)
        try:
            source_connection.backup(destination_connection)
        finally:
            destination_connection.close()
            source_connection.close()
    except sqlite3.Error as error:
        destination.unlink(missing_ok=True)
        raise ContractError("A consistent Anote database backup could not be created.", code="backup_failed") from error
    if destination.stat().st_size > MAX_DATABASE_BYTES:
        destination.unlink(missing_ok=True)
        raise ContractError("The Anote database exceeds the supported backup size.", code="backup_too_large")
    _integrity_check(destination)


def sanitize_checkpoint_database(path: Path) -> None:
    """Physically remove host-local sessions from the portable data copy."""
    try:
        connection = sqlite3.connect(path)
        try:
            journal_mode = connection.execute("PRAGMA journal_mode = DELETE").fetchone()
            secure_delete = connection.execute("PRAGMA secure_delete = ON").fetchone()
            if not journal_mode or str(journal_mode[0]).lower() != "delete" or secure_delete != (1,):
                raise ContractError("Portable session cleanup is unavailable.", code="checkpoint_invalid")
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
            ).fetchone()
            if exists:
                connection.execute("DELETE FROM sessions")
                connection.commit()
            connection.execute("VACUUM")
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise ContractError("Portable session cleanup failed.", code="checkpoint_invalid") from error
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(f"{path}{suffix}")
        sidecar.unlink(missing_ok=True)
        if sidecar.exists():
            raise ContractError("Portable database sidecar cleanup failed.", code="checkpoint_invalid")
    _validate_checkpoint_database(path, require_empty_sessions=True)


def create_upload_archive(source: Path, destination: Path) -> tuple[int, int]:
    if source.exists() and (is_link_or_junction(source) or not source.is_dir()):
        raise ContractError("The uploads directory is unsafe.", code="uploads_unsafe")
    ensure_private_directory(destination.parent)
    file_count = 0
    total_bytes = 0
    entry_count = 0
    try:
        with tarfile.open(destination, "w", format=tarfile.PAX_FORMAT) as archive:
            if source.exists():
                for path in sorted(source.rglob("*"), key=lambda item: item.relative_to(source).as_posix()):
                    entry_count += 1
                    if entry_count > MAX_UPLOAD_ENTRIES:
                        raise ContractError("Uploads exceed the supported checkpoint bounds.", code="uploads_too_large")
                    if is_link_or_junction(path):
                        raise ContractError("Upload links and junctions are forbidden.", code="uploads_unsafe")
                    relative = path.relative_to(source).as_posix()
                    _validate_portable_upload_path(PurePosixPath(relative))
                    if path.is_dir():
                        info = tarfile.TarInfo(relative + "/")
                        info.type = tarfile.DIRTYPE
                        info.mode = 0o700
                        info.mtime = 0
                        archive.addfile(info)
                        continue
                    if not path.is_file():
                        raise ContractError("Uploads must contain regular files only.", code="uploads_unsafe")
                    size = path.stat().st_size
                    file_count += 1
                    total_bytes += size
                    if file_count > MAX_UPLOAD_FILES or total_bytes > MAX_UPLOAD_BYTES:
                        raise ContractError("Uploads exceed the supported checkpoint bounds.", code="uploads_too_large")
                    info = tarfile.TarInfo(relative)
                    info.size = size
                    info.mode = 0o600
                    info.mtime = 0
                    with path.open("rb") as stream:
                        archive.addfile(info, stream)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    if destination.stat().st_size > MAX_UPLOAD_ARCHIVE_BYTES:
        destination.unlink(missing_ok=True)
        raise ContractError("The uploads archive exceeds the supported checkpoint size.", code="uploads_too_large")
    return file_count, total_bytes


def _validate_upload_member(member: tarfile.TarInfo, names: set[str]) -> PurePosixPath:
    path = PurePosixPath(member.name)
    canonical = path.as_posix()
    if (
        path.is_absolute()
        or canonical != member.name.rstrip("/")
        or any(part in {"", ".", ".."} for part in path.parts)
        or canonical.casefold() in names
        or not (member.isdir() or member.isfile())
        or member.issym()
        or member.islnk()
    ):
        raise ContractError("Checkpoint upload path is unsafe.", code="checkpoint_unsafe")
    _validate_portable_upload_path(path)
    names.add(canonical.casefold())
    return path


def inspect_upload_archive_stream(stream: object) -> tuple[int, int]:
    names: set[str] = set()
    file_count = 0
    total_bytes = 0
    entry_count = 0
    try:
        with tarfile.open(fileobj=stream, mode="r|") as archive:  # type: ignore[arg-type]
            for member in archive:
                entry_count += 1
                if entry_count > MAX_UPLOAD_ENTRIES:
                    raise ContractError("Checkpoint uploads exceed supported bounds.", code="checkpoint_too_large")
                _validate_upload_member(member, names)
                if member.isdir():
                    continue
                file_count += 1
                total_bytes += member.size
                if file_count > MAX_UPLOAD_FILES or total_bytes > MAX_UPLOAD_BYTES:
                    raise ContractError("Checkpoint uploads exceed supported bounds.", code="checkpoint_too_large")
    except (tarfile.TarError, OSError) as error:
        raise ContractError("Checkpoint uploads could not be inspected safely.", code="checkpoint_invalid") from error
    return file_count, total_bytes


def extract_upload_archive(archive_path: Path, destination: Path) -> tuple[int, int]:
    ensure_private_directory(destination)
    names: set[str] = set()
    file_count = 0
    total_bytes = 0
    entry_count = 0
    try:
        with tarfile.open(archive_path, "r:") as archive:
            for member in archive:
                entry_count += 1
                if entry_count > MAX_UPLOAD_ENTRIES:
                    raise ContractError("Checkpoint uploads exceed supported bounds.", code="checkpoint_too_large")
                path = _validate_upload_member(member, names)
                target = destination.joinpath(*path.parts)
                if target.resolve(strict=False) != destination.resolve(strict=False).joinpath(*path.parts):
                    raise ContractError("Checkpoint upload escaped its destination.", code="checkpoint_unsafe")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                file_count += 1
                total_bytes += member.size
                if file_count > MAX_UPLOAD_FILES or total_bytes > MAX_UPLOAD_BYTES:
                    raise ContractError("Checkpoint uploads exceed supported bounds.", code="checkpoint_too_large")
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ContractError("Checkpoint upload data is missing.", code="checkpoint_invalid")
                with target.open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                if os.name != "nt":
                    target.chmod(0o600)
    except (tarfile.TarError, OSError) as error:
        raise ContractError("Checkpoint uploads could not be extracted safely.", code="checkpoint_invalid") from error
    return file_count, total_bytes


@dataclass(frozen=True)
class Backup:
    backup_id: str
    root: Path
    database: Path
    uploads_archive: Path


class SnapshotService:
    """Own consistent database/upload snapshots and atomic data restoration."""

    def __init__(self, paths: ManagedPaths, *, clock: Callable[[], int] = lambda: int(time.time())) -> None:
        self.paths = paths
        self.clock = clock

    def create(self, label: str) -> Backup:
        safe_label = "".join(character if character.isalnum() or character in "._-" else "-" for character in label)[:80]
        if not safe_label:
            raise ContractError("Backup label is invalid.", code="backup_invalid")
        backup_id = f"{self.clock()}-{safe_label}"
        self.paths.assert_safe(self.paths.database, allow_missing=False)
        self.paths.assert_safe(self.paths.uploads)
        ensure_private_directory(self.paths.backups, managed_paths=self.paths)
        target = self.paths.backups / backup_id
        if target.exists():
            raise ContractError("Backup identity already exists.", code="backup_exists")
        staging = Path(tempfile.mkdtemp(prefix="backup.", dir=self.paths.backups))
        try:
            database = staging / "calendar.db"
            uploads = staging / "uploads.tar"
            backup_database(self.paths.database, database)
            file_count, total_bytes = create_upload_archive(self.paths.uploads, uploads)
            atomic_json_write(staging / "manifest.json", {
                "kind": "anote-backup",
                "schema_version": 1,
                "backup_id": backup_id,
                "created_at": self.clock(),
                "files": {
                    "calendar.db": {"size": database.stat().st_size, "sha256": file_sha256(database)},
                    "uploads.tar": {"size": uploads.stat().st_size, "sha256": file_sha256(uploads)},
                },
                "upload_files": file_count,
                "upload_bytes": total_bytes,
                "runtime_files": {},
                "installation_sha256": None,
            })
            os.replace(staging, target)
        except Exception as error:
            shutil.rmtree(staging, ignore_errors=True)
            raise
        return Backup(backup_id, target, target / "calendar.db", target / "uploads.tar")

    def restore(self, backup: Backup) -> None:
        if backup.root.resolve(strict=False).parent != self.paths.backups or backup.root.is_symlink():
            raise ContractError("Backup is outside the managed backup root.", code="backup_unsafe")
        self.verify(backup)
        staging = self.paths.production / f"data.restore-{os.urandom(6).hex()}"
        recovery = self.paths.production / f"data.previous-{os.urandom(6).hex()}"
        ensure_private_directory(self.paths.production, managed_paths=self.paths)
        ensure_private_directory(staging, managed_paths=self.paths)
        try:
            shutil.copyfile(backup.database, staging / "calendar.db")
            extract_upload_archive(backup.uploads_archive, staging / "uploads")
            _integrity_check(staging / "calendar.db")
            if self.paths.data.exists():
                os.replace(self.paths.data, recovery)
            os.replace(staging, self.paths.data)
        except Exception:
            if not self.paths.data.exists() and recovery.exists():
                os.replace(recovery, self.paths.data)
            shutil.rmtree(staging, ignore_errors=True)
            raise
        shutil.rmtree(recovery, ignore_errors=True)

    def verify(self, backup: Backup) -> dict[str, object]:
        """Verify the canonical backup receipt and every data byte before mutation."""
        self.paths.assert_safe(backup.root, allow_missing=False)
        manifest = strict_json_read(
            backup.root / "manifest.json",
            max_bytes=256 * 1024,
            managed_paths=self.paths,
        )
        expected = {
            "kind", "schema_version", "backup_id", "created_at", "files",
            "upload_files", "upload_bytes", "runtime_files", "installation_sha256",
        }
        if set(manifest) != expected or manifest["kind"] != "anote-backup" or manifest["schema_version"] != 1 or manifest["backup_id"] != backup.backup_id:
            raise ContractError("Backup receipt is invalid.", code="backup_invalid")
        files = manifest["files"]
        if not isinstance(files, dict) or set(files) != {"calendar.db", "uploads.tar"}:
            raise ContractError("Backup data inventory is invalid.", code="backup_invalid")
        for name, path in (("calendar.db", backup.database), ("uploads.tar", backup.uploads_archive)):
            entry = files[name]
            if not isinstance(entry, dict) or set(entry) != {"size", "sha256"}:
                raise ContractError("Backup file receipt is invalid.", code="backup_invalid")
            if path.is_symlink() or not path.is_file() or path.stat().st_size != entry["size"] or file_sha256(path) != entry["sha256"]:
                raise ContractError("Backup file does not match its receipt.", code="backup_invalid")
        if not isinstance(manifest["upload_files"], int) or not isinstance(manifest["upload_bytes"], int):
            raise ContractError("Backup upload inventory is invalid.", code="backup_invalid")
        with backup.uploads_archive.open("rb") as stream:
            inventory = inspect_upload_archive_stream(stream)
        if inventory != (manifest["upload_files"], manifest["upload_bytes"]):
            raise ContractError("Backup upload inventory does not match its receipt.", code="backup_invalid")
        runtime_entries = manifest["runtime_files"]
        installation_digest = manifest["installation_sha256"]
        if not isinstance(runtime_entries, dict) or set(runtime_entries) not in (set(), {"compose.yaml", "production.env"}):
            raise ContractError("Backup runtime inventory is invalid.", code="backup_invalid")
        if bool(runtime_entries) != (isinstance(installation_digest, str) and SHA256_PATTERN.fullmatch(installation_digest) is not None):
            raise ContractError("Backup runtime identity is incomplete.", code="backup_invalid")
        for name, entry in runtime_entries.items():
            source = backup.root / "runtime" / name
            if not isinstance(entry, dict) or set(entry) != {"size", "sha256"} or source.is_symlink() or not source.is_file() or source.stat().st_size != entry["size"] or file_sha256(source) != entry["sha256"]:
                raise ContractError("Backup runtime file does not match its receipt.", code="backup_invalid")
        _integrity_check(backup.database)
        return manifest

    def record_runtime(self, backup: Backup, installation: Installation, sources: tuple[Path, ...]) -> None:
        manifest = self.verify(backup)
        runtime_root = backup.root / "runtime"
        ensure_private_directory(runtime_root, managed_paths=self.paths)
        receipt: dict[str, dict[str, object]] = {}
        for source in sources:
            self.paths.assert_safe(source, allow_missing=False)
            if source.is_symlink() or not source.is_file():
                raise ContractError("Installed runtime files are unavailable or unsafe.", code="runtime_config_missing")
            destination = runtime_root / source.name
            shutil.copyfile(source, destination)
            receipt[source.name] = {"size": destination.stat().st_size, "sha256": file_sha256(destination)}
        manifest["runtime_files"] = receipt
        encoded = json.dumps(asdict(installation), sort_keys=True, separators=(",", ":")).encode("utf-8")
        manifest["installation_sha256"] = sha256(encoded).hexdigest()
        atomic_json_write(backup.root / "manifest.json", manifest, managed_paths=self.paths)

    def verified_runtime_files(self, backup: Backup, installation: Installation) -> dict[str, Path]:
        manifest = self.verify(backup)
        encoded = json.dumps(asdict(installation), sort_keys=True, separators=(",", ":")).encode("utf-8")
        if manifest["installation_sha256"] != sha256(encoded).hexdigest():
            raise ContractError("Backup release identity does not match recovery state.", code="recovery_failed")
        entries = manifest["runtime_files"]
        expected_names = {"compose.yaml", "production.env"}
        if not isinstance(entries, dict) or set(entries) != expected_names:
            raise ContractError("Runtime recovery receipt is incomplete.", code="recovery_failed")
        result: dict[str, Path] = {}
        for name in expected_names:
            entry = entries[name]
            source = backup.root / "runtime" / name
            if not isinstance(entry, dict) or set(entry) != {"size", "sha256"} or source.is_symlink() or not source.is_file() or source.stat().st_size != entry["size"] or file_sha256(source) != entry["sha256"]:
                raise ContractError("Runtime recovery file failed receipt verification.", code="recovery_failed")
            result[name] = source
        return result


@dataclass(frozen=True)
class CheckpointManifest:
    dataset_id: str
    checkpoint_id: str
    parent_checkpoint_id: str | None
    sequence: int
    created_at: int
    source_installation_id: str
    release_id: str
    version: str
    source_commit: str
    data_schema: int
    database_size: int
    database_sha256: str
    uploads_size: int
    uploads_sha256: str
    upload_files: int
    upload_bytes: int

    def __post_init__(self) -> None:
        if RELEASE_PATTERN.fullmatch(self.checkpoint_id) is None:
            raise ContractError("Checkpoint identity is invalid.", code="checkpoint_invalid")
        if len(self.dataset_id) != 32 or any(character not in "0123456789abcdef" for character in self.dataset_id):
            raise ContractError("Checkpoint dataset identity is invalid.", code="checkpoint_invalid")
        if self.parent_checkpoint_id is not None and RELEASE_PATTERN.fullmatch(self.parent_checkpoint_id) is None:
            raise ContractError("Checkpoint parent identity is invalid.", code="checkpoint_invalid")
        if isinstance(self.sequence, bool) or not isinstance(self.sequence, int) or self.sequence <= 0:
            raise ContractError("Checkpoint sequence is invalid.", code="checkpoint_invalid")
        if (self.sequence == 1) != (self.parent_checkpoint_id is None):
            raise ContractError("Checkpoint lineage is contradictory.", code="checkpoint_invalid")
        if len(self.source_installation_id) != 32 or RELEASE_PATTERN.fullmatch(self.release_id) is None:
            raise ContractError("Checkpoint source identity is invalid.", code="checkpoint_invalid")
        if VERSION_PATTERN.fullmatch(self.version) is None:
            raise ContractError("Checkpoint release version is invalid.", code="checkpoint_invalid")
        if len(self.source_commit) != 40 or any(character not in "0123456789abcdef" for character in self.source_commit):
            raise ContractError("Checkpoint source commit is invalid.", code="checkpoint_invalid")
        if any(SHA256_PATTERN.fullmatch(value) is None for value in (self.database_sha256, self.uploads_sha256)):
            raise ContractError("Checkpoint digest is invalid.", code="checkpoint_invalid")
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (
            self.data_schema, self.database_size, self.uploads_size, self.upload_files, self.upload_bytes
        )):
            raise ContractError("Checkpoint size or schema is invalid.", code="checkpoint_invalid")
        if self.database_size <= 0 or self.database_size > MAX_DATABASE_BYTES or self.uploads_size > MAX_UPLOAD_ARCHIVE_BYTES:
            raise ContractError("Checkpoint size exceeds supported bounds.", code="checkpoint_too_large")

    @classmethod
    def parse(cls, payload: bytes) -> "CheckpointManifest":
        if len(payload) > 256 * 1024:
            raise ContractError("Checkpoint manifest is too large.", code="checkpoint_invalid")
        try:
            raw = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ContractError("Checkpoint manifest is unreadable.", code="checkpoint_invalid") from error
        fields = set(cls.__dataclass_fields__)
        if not isinstance(raw, dict) or set(raw) != {"kind", "schema_version", *fields} or raw["kind"] != "anote-checkpoint" or raw["schema_version"] != CHECKPOINT_SCHEMA:
            raise ContractError("Checkpoint manifest schema is unsupported.", code="checkpoint_invalid")
        try:
            return cls(**{field: raw[field] for field in fields})
        except TypeError as error:
            raise ContractError("Checkpoint manifest values are invalid.", code="checkpoint_invalid") from error


@dataclass(frozen=True)
class VerifiedCheckpoint:
    path: Path
    package_sha256: str
    manifest: CheckpointManifest


def stage_verified_checkpoint(checkpoint: VerifiedCheckpoint, destination: Path) -> None:
    """Copy one selected package into owned storage while binding every byte."""
    if is_link_or_junction(checkpoint.path) or not checkpoint.path.is_file():
        raise ContractError("Selected checkpoint changed after verification.", code="checkpoint_changed")
    digest = sha256()
    try:
        with checkpoint.path.open("rb") as source, destination.open("xb") as output:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    except OSError as error:
        destination.unlink(missing_ok=True)
        raise ContractError("Selected checkpoint could not be staged safely.", code="checkpoint_changed") from error
    if digest.hexdigest() != checkpoint.package_sha256:
        destination.unlink(missing_ok=True)
        raise ContractError("Selected checkpoint changed after verification.", code="checkpoint_changed")


class CheckpointService:
    def __init__(
        self,
        paths: ManagedPaths,
        registry: InstallationRegistry,
        *,
        clock: Callable[[], int] = lambda: int(time.time()),
    ) -> None:
        self.paths = paths
        self.registry = registry
        self.clock = clock
        self.journal = OperationJournal(paths)

    def create(
        self,
        destination: Path,
        *,
        prove_stopped: Callable[[Installation], bool],
        lock_held: bool = False,
    ) -> VerifiedCheckpoint:
        if not lock_held:
            with OperationLock(self.paths):
                return self.create(destination, prove_stopped=prove_stopped, lock_held=True)
        if self.journal.load() is not None:
            raise ContractError("Recover the interrupted operation before creating a checkpoint.", code="recovery_required")
        installation = self._installation()
        if installation.role != "source" or installation.state not in {"checkpoint_required", "stopped_dirty"}:
            raise ContractError("Create checkpoints only from a stopped source computer.", code="checkpoint_source_required")
        if not prove_stopped(installation):
            raise ContractError("Docker still reports Anote running; stop it before creating a checkpoint.", code="stop_required")
        self.paths.assert_safe(self.paths.database, allow_missing=False)
        self.paths.assert_safe(self.paths.uploads)
        if destination.parent.exists():
            if is_link_or_junction(destination.parent) or not destination.parent.is_dir():
                raise ContractError("Choose a safe checkpoint destination folder.", code="checkpoint_destination_invalid")
        else:
            ensure_private_directory(destination.parent)
        if (
            destination.suffix != ".anote-checkpoint" or destination.exists() or destination.is_symlink()
            or is_link_or_junction(destination.parent)
        ):
            raise ContractError("Choose a new .anote-checkpoint destination.", code="checkpoint_destination_invalid")
        destination = destination.parent.resolve(strict=True) / destination.name
        work_name = f"checkpoint.work-{os.urandom(6).hex()}"
        operation = OperationRecord(
            os.urandom(12).hex(), "create_checkpoint", "snapshotting", installation.installation_id,
            self.clock(), {
                "destination": str(destination),
                "state": installation.state,
                "release_id": installation.release_id,
                "version": installation.version,
                "source_commit": installation.source_commit,
                "data_schema": str(installation.data_schema),
                "dataset_id": installation.dataset_id or "",
                "checkpoint_parent_id": installation.last_checkpoint_id or "",
                "checkpoint_sequence": str(installation.checkpoint_sequence),
                "checkpoint_work_name": work_name,
            },
        )
        self.journal.save(operation)
        ensure_private_directory(self.paths.root, managed_paths=self.paths)
        staging = checkpoint_work_path(self.paths, work_name)
        staging.mkdir(mode=0o700)
        temporary = destination.with_name(f".{destination.name}.{operation.operation_id}.tmp")
        published = False
        committed = False
        try:
            database = staging / "calendar.db"
            uploads = staging / "uploads.tar"
            backup_database(self.paths.database, database)
            sanitize_checkpoint_database(database)
            upload_files, upload_bytes = create_upload_archive(self.paths.uploads, uploads)
            checkpoint_id = f"cp-{self.clock()}-{os.urandom(4).hex()}"
            dataset_id = installation.dataset_id or os.urandom(16).hex()
            sequence = installation.checkpoint_sequence + 1
            manifest = CheckpointManifest(
                dataset_id, checkpoint_id, installation.last_checkpoint_id, sequence,
                self.clock(), installation.installation_id, installation.release_id,
                installation.version, installation.source_commit, installation.data_schema,
                database.stat().st_size, file_sha256(database), uploads.stat().st_size,
                file_sha256(uploads), upload_files, upload_bytes,
            )
            manifest_bytes = json.dumps(
                {"kind": "anote-checkpoint", "schema_version": CHECKPOINT_SCHEMA, **asdict(manifest)},
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                archive.writestr("manifest.json", manifest_bytes)
                archive.write(database, "calendar.db")
                archive.write(uploads, "uploads.tar")
            operation = replace(operation, phase="package_prepared", details={
                **operation.details,
                "checkpoint_id": checkpoint_id,
                "dataset_id": dataset_id,
                "checkpoint_parent_id": manifest.parent_checkpoint_id or "",
                "checkpoint_sequence": str(sequence),
                "checkpoint_package_sha256": file_sha256(temporary),
            })
            self.journal.save(operation)
            os.replace(temporary, destination)
            published = True
            verified = self.verify(destination)
            self.registry.save(replace(
                installation,
                state="ready_stopped",
                dataset_id=dataset_id,
                last_checkpoint_id=checkpoint_id,
                checkpoint_parent_id=manifest.parent_checkpoint_id,
                checkpoint_sequence=sequence,
                updated_at=self.clock(),
            ))
            committed = True
            self.journal.save(replace(operation, phase="registry_committed"))
            self.journal.clear()
            return verified
        except Exception:
            if published and not committed:
                destination.unlink(missing_ok=True)
            raise
        finally:
            temporary.unlink(missing_ok=True)
            shutil.rmtree(staging, ignore_errors=True)

    def recover_create(self, record: OperationRecord) -> Installation:
        """Converge the publish/registry crash window without losing a valid package."""
        installation = self._installation()
        if record.installation_id != installation.installation_id:
            raise ContractError("Checkpoint recovery installation identity differs.", code="recovery_failed")
        try:
            destination = Path(record.details["destination"])
            if (
                not destination.is_absolute() or destination.suffix != ".anote-checkpoint"
                or is_link_or_junction(destination.parent)
                or destination.parent.resolve(strict=True) / destination.name != destination
            ):
                raise ValueError("unsafe destination")
        except (KeyError, OSError, ValueError) as error:
            raise ContractError("Checkpoint recovery destination is unsafe.", code="recovery_failed") from error
        temporary = destination.with_name(f".{destination.name}.{record.operation_id}.tmp")
        checkpoint_id = record.details.get("checkpoint_id")
        if not checkpoint_id:
            if temporary.exists() and temporary.is_file() and not temporary.is_symlink():
                temporary.unlink()
            self.journal.clear()
            return installation
        if not destination.exists():
            if temporary.exists() and temporary.is_file() and not temporary.is_symlink():
                temporary.unlink()
            self.journal.clear()
            return installation
        try:
            verified = self.verify(destination)
            expected = (
                checkpoint_id,
                record.details["dataset_id"],
                record.details.get("checkpoint_parent_id") or None,
                int(record.details["checkpoint_sequence"]),
                record.details["release_id"],
                record.details["version"],
                record.details["source_commit"],
                int(record.details["data_schema"]),
                record.details["checkpoint_package_sha256"],
            )
        except (ContractError, KeyError, ValueError) as error:
            raise ContractError("Published checkpoint cannot be proven from its recovery journal.", code="recovery_failed") from error
        observed = (
            verified.manifest.checkpoint_id,
            verified.manifest.dataset_id,
            verified.manifest.parent_checkpoint_id,
            verified.manifest.sequence,
            verified.manifest.release_id,
            verified.manifest.version,
            verified.manifest.source_commit,
            verified.manifest.data_schema,
            verified.package_sha256,
        )
        if observed != expected:
            raise ContractError("Published checkpoint differs from its recovery journal.", code="recovery_failed")
        committed = (
            installation.dataset_id,
            installation.last_checkpoint_id,
            installation.checkpoint_parent_id,
            installation.checkpoint_sequence,
        ) == (
            verified.manifest.dataset_id,
            verified.manifest.checkpoint_id,
            verified.manifest.parent_checkpoint_id,
            verified.manifest.sequence,
        )
        if not committed:
            prior = (
                installation.state,
                installation.release_id,
                installation.version,
                installation.source_commit,
                installation.data_schema,
                installation.last_checkpoint_id,
                installation.checkpoint_sequence,
            )
            expected_prior = (
                record.details["state"],
                record.details["release_id"],
                record.details["version"],
                record.details["source_commit"],
                int(record.details["data_schema"]),
                record.details.get("checkpoint_parent_id") or None,
                int(record.details["checkpoint_sequence"]) - 1,
            )
            if prior != expected_prior:
                raise ContractError("Checkpoint recovery lineage is inconsistent.", code="recovery_failed")
            installation = replace(
                installation,
                state="ready_stopped",
                dataset_id=verified.manifest.dataset_id,
                last_checkpoint_id=verified.manifest.checkpoint_id,
                checkpoint_parent_id=verified.manifest.parent_checkpoint_id,
                checkpoint_sequence=verified.manifest.sequence,
                updated_at=self.clock(),
            )
            self.registry.save(installation)
        self.journal.clear()
        return installation

    def verify(self, path: Path) -> VerifiedCheckpoint:
        if path.is_symlink():
            raise ContractError("Select a regular .anote-checkpoint file.", code="checkpoint_invalid")
        resolved = path.resolve(strict=True)
        if resolved.is_symlink() or not resolved.is_file() or resolved.suffix != ".anote-checkpoint":
            raise ContractError("Select a regular .anote-checkpoint file.", code="checkpoint_invalid")
        try:
            with resolved.open("rb") as package_stream:
                opened = os.fstat(package_stream.fileno())
                if not stat.S_ISREG(opened.st_mode):
                    raise ContractError("Select a regular .anote-checkpoint file.", code="checkpoint_invalid")
                package_digest = sha256()
                for chunk in iter(lambda: package_stream.read(1024 * 1024), b""):
                    package_digest.update(chunk)
                package_stream.seek(0)
                with zipfile.ZipFile(package_stream) as archive:
                    infos = archive.infolist()
                    names = [info.filename for info in infos]
                    if set(names) != CHECKPOINT_MEMBERS or len(names) != len(CHECKPOINT_MEMBERS):
                        raise ContractError("Checkpoint files are incomplete or duplicated.", code="checkpoint_invalid")
                    _validate_checkpoint_zip_layout(archive, infos)
                    for info in infos:
                        mode = info.external_attr >> 16
                        member = PurePosixPath(info.filename)
                        if (
                            info.is_dir() or info.flag_bits & ~0x800 or info.compress_type != zipfile.ZIP_STORED
                            or stat.S_IFMT(mode) not in {0, stat.S_IFREG}
                            or member.is_absolute() or any(part in {"", ".", ".."} for part in member.parts)
                        ):
                            raise ContractError("Checkpoint contains an unsafe member.", code="checkpoint_unsafe")
                        limit = 256 * 1024 if info.filename == "manifest.json" else MAX_DATABASE_BYTES if info.filename == "calendar.db" else MAX_UPLOAD_ARCHIVE_BYTES
                        if info.file_size > limit or (info.compress_size and info.file_size / info.compress_size > 200):
                            raise ContractError("Checkpoint member exceeds supported bounds.", code="checkpoint_too_large")
                    manifest = CheckpointManifest.parse(archive.read("manifest.json"))
                    database_info = archive.getinfo("calendar.db")
                    uploads_info = archive.getinfo("uploads.tar")
                    if (database_info.file_size, uploads_info.file_size) != (manifest.database_size, manifest.uploads_size):
                        raise ContractError("Checkpoint sizes do not match its manifest.", code="checkpoint_invalid")
                    with tempfile.TemporaryDirectory(prefix="anote-checkpoint-verify.") as directory:
                        database_path = Path(directory) / "calendar.db"
                        database_digest = sha256()
                        with archive.open("calendar.db") as source, database_path.open("xb") as output:
                            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                                database_digest.update(chunk)
                                output.write(chunk)
                        if database_digest.hexdigest() != manifest.database_sha256:
                            raise ContractError("Checkpoint digest does not match its manifest.", code="checkpoint_invalid")
                        _validate_checkpoint_database(
                            database_path,
                            expected_schema=manifest.data_schema,
                            require_empty_sessions=True,
                        )
                    uploads_digest = sha256()
                    with archive.open("uploads.tar") as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            uploads_digest.update(chunk)
                    if uploads_digest.hexdigest() != manifest.uploads_sha256:
                        raise ContractError("Checkpoint digest does not match its manifest.", code="checkpoint_invalid")
                    with archive.open("uploads.tar") as stream:
                        inventory = inspect_upload_archive_stream(stream)
                    if inventory != (manifest.upload_files, manifest.upload_bytes):
                        raise ContractError("Checkpoint upload inventory does not match its manifest.", code="checkpoint_invalid")
        except (zipfile.BadZipFile, OSError) as error:
            raise ContractError("Checkpoint could not be read safely.", code="checkpoint_invalid") from error
        return VerifiedCheckpoint(resolved, package_digest.hexdigest(), manifest)

    def apply(
        self,
        checkpoint: VerifiedCheckpoint,
        release: ReleaseManifest,
        *,
        prove_stopped: Callable[[Installation], bool],
        validate: Callable[[Installation], int] | None = None,
        confirm_full_replace: bool = False,
        lock_held: bool = False,
    ) -> Installation:
        if not lock_held:
            with OperationLock(self.paths):
                return self.apply(
                    checkpoint,
                    release,
                    prove_stopped=prove_stopped,
                    validate=validate,
                    confirm_full_replace=confirm_full_replace,
                    lock_held=True,
                )
        installation = self._installation()
        if installation.role != "standby" or installation.state not in {"awaiting_checkpoint", "ready_stopped"}:
            raise ContractError("Apply checkpoints only to a prepared or stopped standby computer.", code="checkpoint_standby_required")
        if not prove_stopped(installation):
            raise ContractError("Docker still reports Anote running; stop it before applying a checkpoint.", code="stop_required")
        if checkpoint.manifest.source_installation_id == installation.installation_id:
            raise ContractError("A computer cannot apply its own source checkpoint as standby data.", code="checkpoint_role_conflict")
        if (
            checkpoint.manifest.release_id,
            checkpoint.manifest.version,
            checkpoint.manifest.source_commit,
        ) != (release.release_id, release.version, release.source_commit) or not release.supports_data_schema(checkpoint.manifest.data_schema):
            raise ContractError("Checkpoint data schema is incompatible with the installed release.", code="checkpoint_incompatible")
        if checkpoint.manifest.checkpoint_id == installation.last_checkpoint_id:
            return installation
        baseline = installation.checkpoint_sequence == 0 and checkpoint.manifest.sequence == 1
        exact_child = (
            installation.dataset_id == checkpoint.manifest.dataset_id
            and checkpoint.manifest.parent_checkpoint_id == installation.last_checkpoint_id
            and checkpoint.manifest.sequence == installation.checkpoint_sequence + 1
        )
        if not baseline and not exact_child and not confirm_full_replace:
            raise ContractError("Checkpoint lineage replacement requires explicit confirmation.", code="checkpoint_replace_confirmation_required")
        ensure_private_directory(self.paths.production, managed_paths=self.paths)
        required_space = checkpoint.manifest.database_size + checkpoint.manifest.uploads_size + checkpoint.manifest.upload_bytes
        if shutil.disk_usage(self.paths.production).free < required_space:
            raise ContractError("There is not enough free space to apply this checkpoint safely.", code="insufficient_disk_space")
        package_copy = checkpoint_staging_path(
            self.paths,
            f"checkpoint.package-{os.urandom(6).hex()}.anote-checkpoint",
        )
        staging_name = f"data.checkpoint-{os.urandom(6).hex()}"
        previous_name = f"data.previous-{os.urandom(6).hex()}"
        failed_name = f"data.failed-{os.urandom(6).hex()}"
        operation = OperationRecord(
            os.urandom(12).hex(), "apply_checkpoint", "extracting", installation.installation_id,
            self.clock(), {
                "checkpoint_id": checkpoint.manifest.checkpoint_id,
                "checkpoint_staging_name": package_copy.name,
                "checkpoint_data_staging_name": staging_name,
                "checkpoint_previous_name": previous_name,
                "checkpoint_failed_name": failed_name,
            },
        )
        staging = checkpoint_data_path(self.paths, staging_name, "staging")
        previous = checkpoint_data_path(self.paths, previous_name, "previous")
        failed_candidate = checkpoint_data_path(self.paths, failed_name, "failed")
        if any(path.exists() or path.is_symlink() for path in (staging, previous, failed_candidate)):
            raise ContractError("Checkpoint data staging identity already exists.", code="recovery_required")
        swapped = False
        committed = False
        journal_started = False
        try:
            self.journal.save(operation)
            journal_started = True
            stage_verified_checkpoint(checkpoint, package_copy)
            ensure_private_directory(staging, managed_paths=self.paths)
            with zipfile.ZipFile(package_copy) as archive:
                with archive.open("calendar.db") as source, (staging / "calendar.db").open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                uploads_archive = staging / "uploads.tar"
                with archive.open("uploads.tar") as source, uploads_archive.open("xb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
            if file_sha256(staging / "calendar.db") != checkpoint.manifest.database_sha256:
                raise ContractError("Extracted checkpoint database digest is invalid.", code="checkpoint_invalid")
            if file_sha256(uploads_archive) != checkpoint.manifest.uploads_sha256:
                raise ContractError("Extracted checkpoint uploads digest is invalid.", code="checkpoint_invalid")
            _validate_checkpoint_database(
                staging / "calendar.db",
                expected_schema=checkpoint.manifest.data_schema,
                require_empty_sessions=True,
            )
            extract_upload_archive(uploads_archive, staging / "uploads")
            uploads_archive.unlink()
            self.journal.save(replace(operation, phase="swapping"))
            if self.paths.data.exists():
                os.replace(self.paths.data, previous)
            os.replace(staging, self.paths.data)
            swapped = True
            candidate = installation.transition(
                "ready_stopped", now=self.clock(), data_schema=checkpoint.manifest.data_schema,
                dataset_id=checkpoint.manifest.dataset_id,
                last_checkpoint_id=checkpoint.manifest.checkpoint_id,
                checkpoint_parent_id=checkpoint.manifest.parent_checkpoint_id,
                checkpoint_sequence=checkpoint.manifest.sequence,
            )
            if validate is not None:
                validated_schema = validate(candidate)
                candidate = replace(candidate, data_schema=validated_schema, updated_at=self.clock())
            self.registry.save(candidate)
            committed = True
            self.journal.save(replace(operation, phase="registry_committed"))
            self.journal.clear()
            shutil.rmtree(previous, ignore_errors=True)
            return candidate
        except Exception as error:
            if not journal_started:
                shutil.rmtree(staging, ignore_errors=True)
                raise
            if committed:
                self.journal.save(replace(operation, phase="recovery_required"))
                raise
            if isinstance(error, RuntimeStillActiveError):
                self.registry.save(replace(installation, state="recovery_required", updated_at=self.clock()))
                self.journal.save(replace(operation, phase="recovery_required"))
                raise
            if swapped and self.paths.data.exists():
                os.replace(self.paths.data, failed_candidate)
            if previous.exists():
                os.replace(previous, self.paths.data)
            shutil.rmtree(failed_candidate, ignore_errors=True)
            shutil.rmtree(staging, ignore_errors=True)
            self.journal.save(replace(operation, phase="recovery_required"))
            raise
        finally:
            package_copy.unlink(missing_ok=True)

    def _installation(self) -> Installation:
        installation = self.registry.load()
        if installation is None:
            raise ContractError("Anote is not set up on this computer.", code="not_installed")
        return installation
