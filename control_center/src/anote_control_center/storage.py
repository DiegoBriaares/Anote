from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any, Callable
import re

from .errors import ContractError
from .model import Installation
from .platform_paths import ManagedPaths


def ensure_private_directory(path: Path, *, managed_paths: ManagedPaths | None = None) -> None:
    if managed_paths is not None:
        managed_paths.assert_safe(path)
    path.mkdir(parents=True, exist_ok=True)
    is_junction = getattr(path, "is_junction", lambda: False)
    if path.is_symlink() or is_junction():
        raise ContractError("A managed directory must not be a symbolic link.", code="unsafe_path")
    if os.name != "nt":
        path.chmod(0o700)


def atomic_json_write(
    path: Path,
    value: dict[str, Any],
    *,
    managed_paths: ManagedPaths | None = None,
) -> None:
    if managed_paths is not None:
        managed_paths.assert_safe(path)
    ensure_private_directory(path.parent, managed_paths=managed_paths)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f"{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, indent=2, sort_keys=True, separators=(",", ": "))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if os.name != "nt":
            temporary.chmod(0o600)
        os.replace(temporary, path)
        temporary = None
        if os.name != "nt":
            directory_descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
    except OSError as error:
        raise ContractError("Managed state could not be saved atomically.", code="state_write_failed") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def strict_json_read(
    path: Path,
    *,
    max_bytes: int = 1024 * 1024,
    managed_paths: ManagedPaths | None = None,
) -> dict[str, Any]:
    if managed_paths is not None:
        managed_paths.assert_safe(path, allow_missing=False)
    if path.is_symlink() or not path.is_file():
        raise ContractError("Managed state is not a regular file.", code="invalid_state_file")
    try:
        if path.stat().st_size > max_bytes:
            raise ContractError("Managed state is too large.", code="invalid_state_file")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContractError("Managed state is unreadable.", code="invalid_state_file") from error
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ContractError("Managed state must be a JSON object.", code="invalid_state_file")
    return value


class InstallationRegistry:
    SCHEMA = 1
    FIELDS = frozenset(Installation.__dataclass_fields__)

    def __init__(self, paths: ManagedPaths) -> None:
        self.paths = paths

    def load(self) -> Installation | None:
        if not self.paths.registry.exists():
            return None
        raw = strict_json_read(self.paths.registry, managed_paths=self.paths)
        if set(raw) != {"schema", "installation"} or raw["schema"] != self.SCHEMA:
            raise ContractError("Installation registry schema is unsupported.", code="invalid_registry")
        value = raw["installation"]
        if not isinstance(value, dict) or set(value) != self.FIELDS:
            raise ContractError("Installation registry fields are invalid.", code="invalid_registry")
        try:
            value = dict(value)
            owned_paths = value.get("owned_paths")
            if not isinstance(owned_paths, list) or not all(isinstance(item, str) for item in owned_paths):
                raise TypeError
            value["owned_paths"] = tuple(owned_paths)
            return Installation(**value)
        except TypeError as error:
            raise ContractError("Installation registry values are invalid.", code="invalid_registry") from error

    def save(self, installation: Installation) -> None:
        installation.__post_init__()
        atomic_json_write(
            self.paths.registry,
            {"schema": self.SCHEMA, "installation": asdict(installation)},
            managed_paths=self.paths,
        )

    def clear(self) -> None:
        self.paths.assert_safe(self.paths.registry)
        if self.paths.registry.is_symlink():
            raise ContractError("Installation registry is unsafe.", code="unsafe_path")
        self.paths.registry.unlink(missing_ok=True)


@dataclass(frozen=True)
class OperationRecord:
    operation_id: str
    kind: str
    phase: str
    installation_id: str | None
    started_at: int
    details: dict[str, str]

    SAFE_DETAIL_KEYS = frozenset({
        "api_image_digest", "api_image_tag", "backup_id", "bind_address", "change",
        "checkpoint_id", "checkpoint_package_sha256", "checkpoint_parent_id", "checkpoint_sequence", "container_architecture", "created_at",
        "data_schema", "dataset_id", "destination", "host_architecture", "host_os",
        "legacy_api_env_digest", "legacy_api_id", "legacy_api_image", "legacy_api_ref",
        "legacy_containers", "legacy_project",
        "last_checkpoint_id", "legacy_running", "legacy_web_env_digest", "legacy_web_id",
        "legacy_web_image", "legacy_web_ref", "owned_paths",
        "package_sha256", "pending_release_id", "pending_source_commit", "pending_version",
        "project", "public_port", "release", "release_id", "retained_data",
        "retained_resume_state", "role", "selected_version", "source_commit", "state",
        "timezone", "version", "web_image_digest", "web_image_tag", "work_dir",
    })

    def __post_init__(self) -> None:
        if not self.operation_id or len(self.operation_id) > 80:
            raise ContractError("Operation identity is invalid.", code="invalid_journal")
        if not self.kind or not self.phase or len(self.kind) > 80 or len(self.phase) > 80:
            raise ContractError("Operation state is invalid.", code="invalid_journal")
        if self.installation_id is not None and len(self.installation_id) != 32:
            raise ContractError("Operation installation identity is invalid.", code="invalid_journal")
        if isinstance(self.started_at, bool) or not isinstance(self.started_at, int) or self.started_at <= 0:
            raise ContractError("Operation timestamp is invalid.", code="invalid_journal")
        if not isinstance(self.details, dict) or not all(
            isinstance(key, str) and isinstance(value, str) and len(key) <= 80 and len(value) <= 500
            for key, value in self.details.items()
        ):
            raise ContractError("Operation details are invalid.", code="invalid_journal")
        forbidden = {"secret", "password", "token", "credential"}
        if any(any(word in key.lower() for word in forbidden) for key in self.details):
            raise ContractError("Secrets must not be written to the operation journal.", code="unsafe_journal")
        if not set(self.details).issubset(self.SAFE_DETAIL_KEYS):
            raise ContractError("Operation details contain an undeclared field.", code="unsafe_journal")
        secret_value = re.compile(
            r"(?i)(?:password|secret|token|credential)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----"
        )
        if any(secret_value.search(value) for value in self.details.values()):
            raise ContractError("Secrets must not be written to the operation journal.", code="unsafe_journal")


class OperationJournal:
    SCHEMA = 1

    def __init__(self, paths: ManagedPaths) -> None:
        self.paths = paths

    def load(self) -> OperationRecord | None:
        if not self.paths.operation_journal.exists():
            return None
        raw = strict_json_read(self.paths.operation_journal, managed_paths=self.paths)
        expected = {"schema", "operation_id", "kind", "phase", "installation_id", "started_at", "details"}
        if set(raw) != expected or raw["schema"] != self.SCHEMA:
            raise ContractError("Operation journal schema is unsupported.", code="invalid_journal")
        return OperationRecord(*(raw[key] for key in (
            "operation_id", "kind", "phase", "installation_id", "started_at", "details"
        )))

    def save(self, record: OperationRecord) -> None:
        record.__post_init__()
        atomic_json_write(
            self.paths.operation_journal,
            {"schema": self.SCHEMA, **asdict(record)},
            managed_paths=self.paths,
        )

    def clear(self) -> None:
        self.paths.assert_safe(self.paths.operation_journal)
        if self.paths.operation_journal.is_symlink():
            raise ContractError("Operation journal is unsafe.", code="unsafe_path")
        self.paths.operation_journal.unlink(missing_ok=True)


class OperationLock(AbstractContextManager["OperationLock"]):
    """One crash-detecting filesystem lock for every mutating lifecycle operation."""

    def __init__(self, paths: ManagedPaths, *, now: Callable[[], float] = time.time) -> None:
        self.paths = paths
        self.now = now
        self._token = f"{os.getpid()}-{os.urandom(8).hex()}"
        self._owned = False

    def __enter__(self) -> "OperationLock":
        ensure_private_directory(self.paths.root, managed_paths=self.paths)
        ensure_private_directory(self.paths.operation_lock.parent, managed_paths=self.paths)
        self.paths.assert_safe(self.paths.operation_lock)
        for attempt in range(2):
            try:
                descriptor = os.open(self.paths.operation_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                if attempt == 0 and self._clear_dead_owner():
                    continue
                raise ContractError(
                    "Another Anote operation is active or needs recovery.",
                    code="operation_locked",
                )
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump({"schema": 1, "pid": os.getpid(), "token": self._token, "started_at": int(self.now())}, stream)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            self._owned = True
            return self
        raise AssertionError("unreachable")

    def _clear_dead_owner(self) -> bool:
        try:
            raw = strict_json_read(self.paths.operation_lock, max_bytes=4096, managed_paths=self.paths)
            if set(raw) != {"schema", "pid", "token", "started_at"} or raw["schema"] != 1:
                return False
            pid = raw["pid"]
            if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
                return False
            os.kill(pid, 0)
            return False
        except ProcessLookupError:
            self.paths.operation_lock.unlink(missing_ok=True)
            return True
        except (PermissionError, OSError, ContractError):
            return False

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if not self._owned:
            return
        try:
            raw = strict_json_read(self.paths.operation_lock, max_bytes=4096, managed_paths=self.paths)
            if raw.get("token") == self._token:
                self.paths.operation_lock.unlink(missing_ok=True)
        finally:
            self._owned = False
