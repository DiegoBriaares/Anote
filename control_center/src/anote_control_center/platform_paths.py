from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import platform
import stat
from typing import Literal

from .errors import ContractError


HostOS = Literal["windows", "macos"]
HostArchitecture = Literal["x86_64", "arm64"]


def _is_link_or_junction(path: Path) -> bool:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        return True
    if os.name == "nt" and (path.exists() or path.is_symlink()):
        try:
            attributes = getattr(path.lstat(), "st_file_attributes", 0)
        except OSError:
            return True
        return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    return False


@dataclass(frozen=True)
class PlatformIdentity:
    host_os: HostOS
    host_architecture: HostArchitecture
    container_os: str = "linux"
    container_architecture: str = ""

    def __post_init__(self) -> None:
        if not self.container_architecture:
            object.__setattr__(self, "container_architecture", "amd64" if self.host_architecture == "x86_64" else "arm64")
        supported = {
            ("windows", "x86_64", "linux", "amd64"),
            ("macos", "arm64", "linux", "arm64"),
        }
        if (
            self.host_os,
            self.host_architecture,
            self.container_os,
            self.container_architecture,
        ) not in supported:
            raise ContractError(
                "Anote Control Center supports Windows 11 x64 and Apple Silicon Mac only.",
                code="unsupported_platform",
            )


def current_platform() -> PlatformIdentity:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows" and machine in {"amd64", "x86_64"}:
        return PlatformIdentity("windows", "x86_64", container_architecture="amd64")
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return PlatformIdentity("macos", "arm64")
    raise ContractError(
        "Anote Control Center supports Windows 11 x64 and Apple Silicon Mac only.",
        code="unsupported_platform",
    )


def default_root(host_os: HostOS | None = None) -> Path:
    selected = host_os or current_platform().host_os
    if selected == "windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if not local_app_data:
            raise ContractError("LOCALAPPDATA is unavailable.", code="state_root_unavailable")
        return Path(local_app_data) / "Anote"
    return Path.home() / "Library" / "Application Support" / "Anote"


@dataclass(frozen=True)
class ManagedPaths:
    """Derive every mutating path from one explicit application root."""

    root: Path

    def __post_init__(self) -> None:
        expanded = self.root.expanduser()
        if _is_link_or_junction(expanded):
            raise ContractError("The Anote state root must not be a link or junction.", code="unsafe_state_root")
        resolved = expanded.resolve(strict=False)
        if resolved == Path(resolved.anchor) or len(resolved.parts) < 3:
            raise ContractError("The Anote state root is too broad.", code="unsafe_state_root")
        object.__setattr__(self, "root", resolved)

    def assert_safe(self, target: Path, *, allow_missing: bool = True) -> Path:
        """Prove that a lexical child cannot escape through a link/junction component.

        ``Path.resolve`` alone is not a safe ownership check: it follows an attacker-created
        intermediate link before the caller writes.  This owner walks the lexical path from
        the canonical state root and rejects every existing reparse/link component first.
        """
        candidate = target.expanduser()
        if not candidate.is_absolute():
            candidate = self.root / candidate
        candidate = Path(os.path.abspath(candidate))
        try:
            relative = candidate.relative_to(self.root)
        except ValueError as error:
            raise ContractError("A managed Anote path escaped its state root.", code="unsafe_owned_path") from error
        current = self.root
        if current.exists() and _is_link_or_junction(current):
            raise ContractError("The Anote state root became unsafe.", code="unsafe_state_root")
        for component in relative.parts:
            current = current / component
            if current.exists() or current.is_symlink():
                if _is_link_or_junction(current):
                    raise ContractError("A managed Anote path contains a link or junction.", code="unsafe_owned_path")
            elif not allow_missing:
                raise ContractError("A required managed Anote path is missing.", code="unsafe_owned_path")
        return candidate

    @property
    def registry(self) -> Path:
        return self.root / "registry" / "installation.json"

    @property
    def operation_lock(self) -> Path:
        return self.operations / "operation.lock"

    @property
    def operation_journal(self) -> Path:
        return self.operations / "journal.json"

    @property
    def operations(self) -> Path:
        return self.root / "operations"

    @property
    def production(self) -> Path:
        return self.root / "production"

    @property
    def data(self) -> Path:
        return self.production / "data"

    @property
    def database(self) -> Path:
        return self.data / "calendar.db"

    @property
    def uploads(self) -> Path:
        return self.data / "uploads"

    @property
    def runtime(self) -> Path:
        return self.production / "runtime"

    @property
    def environment(self) -> Path:
        return self.runtime / "production.env"

    @property
    def compose(self) -> Path:
        return self.runtime / "compose.yaml"

    @property
    def releases(self) -> Path:
        return self.root / "releases"

    @property
    def release_inbox(self) -> Path:
        return self.releases / "inbox"

    @property
    def release_cache(self) -> Path:
        return self.releases / "verified"

    @property
    def release_work(self) -> Path:
        return self.releases / "work"

    @property
    def backups(self) -> Path:
        return self.root / "backups"

    @property
    def checkpoints(self) -> Path:
        return self.root / "checkpoints"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    def owned_erase_paths(self) -> tuple[Path, ...]:
        paths = (
            self.production,
            self.backups,
            self.checkpoints,
            self.releases,
            self.logs,
        )
        for path in paths:
            self.assert_safe(path)
            if path.parent != self.root:
                raise ContractError("A managed Anote path is unsafe.", code="unsafe_owned_path")
        return paths
