from __future__ import annotations

from dataclasses import dataclass, replace
import re
import time
from typing import Literal

from .errors import ContractError


Role = Literal["source", "standby"]
LifecycleState = Literal[
    "checkpoint_required",
    "awaiting_checkpoint",
    "ready_stopped",
    "running_dirty",
    "stopped_dirty",
    "runtime_removed_data_retained",
    "recovery_required",
]

ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
RELEASE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
VERSION_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")

ALLOWED_TRANSITIONS: dict[LifecycleState, frozenset[LifecycleState]] = {
    "checkpoint_required": frozenset({"ready_stopped", "runtime_removed_data_retained", "recovery_required"}),
    "awaiting_checkpoint": frozenset({"ready_stopped", "runtime_removed_data_retained", "recovery_required"}),
    "ready_stopped": frozenset({"running_dirty", "checkpoint_required", "awaiting_checkpoint", "runtime_removed_data_retained", "recovery_required"}),
    "running_dirty": frozenset({"stopped_dirty", "recovery_required"}),
    "stopped_dirty": frozenset({"ready_stopped", "checkpoint_required", "runtime_removed_data_retained", "recovery_required"}),
    "runtime_removed_data_retained": frozenset({"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty", "recovery_required"}),
    "recovery_required": frozenset({"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty", "runtime_removed_data_retained"}),
}


@dataclass(frozen=True)
class Installation:
    installation_id: str
    role: Role
    state: LifecycleState
    release_id: str
    version: str
    source_commit: str
    package_sha256: str
    api_image_tag: str
    api_image_digest: str
    web_image_tag: str
    web_image_digest: str
    host_os: str
    host_architecture: str
    container_architecture: str
    public_port: int
    timezone: str
    bind_address: str
    project_name: str
    data_schema: int
    owned_paths: tuple[str, ...]
    dataset_id: str | None
    checkpoint_parent_id: str | None
    checkpoint_sequence: int
    created_at: int
    updated_at: int
    last_checkpoint_id: str | None = None
    retained_data: bool = False
    retained_resume_state: str | None = None
    pending_release_id: str | None = None
    pending_version: str | None = None
    pending_source_commit: str | None = None

    def __post_init__(self) -> None:
        if ID_PATTERN.fullmatch(self.installation_id) is None:
            raise ContractError("Installation identity is invalid.", code="invalid_registry")
        if self.role not in {"source", "standby"} or self.state not in ALLOWED_TRANSITIONS:
            raise ContractError("Installation lifecycle state is invalid.", code="invalid_registry")
        if (
            (self.state == "checkpoint_required" and self.role != "source")
            or (self.state == "awaiting_checkpoint" and self.role != "standby")
            or (self.state == "running_dirty" and self.role != "source")
        ):
            raise ContractError("Installation role and lifecycle state disagree.", code="invalid_registry")
        if RELEASE_PATTERN.fullmatch(self.release_id) is None or VERSION_PATTERN.fullmatch(self.version) is None:
            raise ContractError("Installed release identity is invalid.", code="invalid_registry")
        if not re.fullmatch(r"[0-9a-f]{40}", self.source_commit):
            raise ContractError("Installed source commit is invalid.", code="invalid_registry")
        if SHA256_PATTERN.fullmatch(self.package_sha256) is None:
            raise ContractError("Installed package digest is invalid.", code="invalid_registry")
        if (
            re.fullmatch(r"anote-api:[A-Za-z0-9._-]{1,128}", self.api_image_tag) is None
            or re.fullmatch(r"anote-web:[A-Za-z0-9._-]{1,128}", self.web_image_tag) is None
            or SHA256_PATTERN.fullmatch(self.api_image_digest.removeprefix("sha256:")) is None
            or SHA256_PATTERN.fullmatch(self.web_image_digest.removeprefix("sha256:")) is None
        ):
            raise ContractError("Installed image identity is invalid.", code="invalid_registry")
        if self.host_os not in {"windows", "macos"}:
            raise ContractError("Installed host platform is invalid.", code="invalid_registry")
        if self.host_architecture not in {"x86_64", "arm64"} or self.container_architecture not in {"amd64", "arm64"}:
            raise ContractError("Installed architecture is invalid.", code="invalid_registry")
        if isinstance(self.public_port, bool) or not 1024 <= self.public_port <= 65535:
            raise ContractError("Installed public port is invalid.", code="invalid_registry")
        if not self.timezone or len(self.timezone) > 128 or any(character in self.timezone for character in "\r\n\x00"):
            raise ContractError("Installed timezone is invalid.", code="invalid_registry")
        if self.bind_address not in {"0.0.0.0", "127.0.0.1"}:
            raise ContractError("Installed bind address is invalid.", code="invalid_registry")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,62}", self.project_name):
            raise ContractError("Installed Docker project is invalid.", code="invalid_registry")
        if isinstance(self.data_schema, bool) or not isinstance(self.data_schema, int) or self.data_schema < 0:
            raise ContractError("Installed data schema is invalid.", code="invalid_registry")
        expected_paths = (
            "production",
            "backups",
            "checkpoints",
            "releases",
            "logs",
            "operations",
        )
        if self.owned_paths != expected_paths:
            raise ContractError("Installed owned paths are invalid.", code="invalid_registry")
        if self.dataset_id is not None and ID_PATTERN.fullmatch(self.dataset_id) is None:
            raise ContractError("Dataset identity is invalid.", code="invalid_registry")
        if self.checkpoint_parent_id is not None and RELEASE_PATTERN.fullmatch(self.checkpoint_parent_id) is None:
            raise ContractError("Checkpoint parent identity is invalid.", code="invalid_registry")
        if isinstance(self.checkpoint_sequence, bool) or not isinstance(self.checkpoint_sequence, int) or self.checkpoint_sequence < 0:
            raise ContractError("Checkpoint sequence is invalid.", code="invalid_registry")
        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in (self.created_at, self.updated_at)):
            raise ContractError("Installation timestamps are invalid.", code="invalid_registry")
        if self.updated_at < self.created_at:
            raise ContractError("Installation timestamps are inconsistent.", code="invalid_registry")
        if self.last_checkpoint_id is not None and RELEASE_PATTERN.fullmatch(self.last_checkpoint_id) is None:
            raise ContractError("Checkpoint identity is invalid.", code="invalid_registry")
        if self.checkpoint_sequence == 0 and any(value is not None for value in (self.dataset_id, self.last_checkpoint_id, self.checkpoint_parent_id)):
            raise ContractError("Empty checkpoint lineage is contradictory.", code="invalid_registry")
        if self.checkpoint_sequence > 0 and (self.dataset_id is None or self.last_checkpoint_id is None):
            raise ContractError("Checkpoint lineage is incomplete.", code="invalid_registry")
        if self.state in {"ready_stopped", "running_dirty", "stopped_dirty"} and self.checkpoint_sequence == 0:
            raise ContractError("Ready or dirty state requires checkpoint lineage.", code="invalid_registry")
        stable_resume_states = {"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty"}
        if self.state == "runtime_removed_data_retained":
            if not self.retained_data or self.retained_resume_state not in stable_resume_states:
                raise ContractError("Retained installation state is incomplete.", code="invalid_registry")
        elif self.retained_resume_state is not None:
            raise ContractError("Resume state is valid only for retained installations.", code="invalid_registry")
        pending = (self.pending_release_id, self.pending_version, self.pending_source_commit)
        if any(value is not None for value in pending) and not all(value is not None for value in pending):
            raise ContractError("Pending release identity is incomplete.", code="invalid_registry")
        if all(value is not None for value in pending) and (
            RELEASE_PATTERN.fullmatch(self.pending_release_id or "") is None
            or VERSION_PATTERN.fullmatch(self.pending_version or "") is None
            or re.fullmatch(r"[0-9a-f]{40}", self.pending_source_commit or "") is None
        ):
            raise ContractError("Pending release identity is invalid.", code="invalid_registry")

    def transition(self, target: LifecycleState, *, now: int | None = None, **changes: object) -> "Installation":
        timestamp = now or int(time.time())
        if target == self.state:
            return replace(self, updated_at=timestamp, **changes)
        if target not in ALLOWED_TRANSITIONS[self.state]:
            raise ContractError(f"Anote cannot move from {self.state} to {target}.", code="invalid_transition")
        return replace(self, state=target, updated_at=timestamp, **changes)


def version_key(value: str) -> tuple[int, int, int, int, tuple[tuple[int, object], ...]]:
    match = VERSION_PATTERN.fullmatch(value)
    if match is None:
        raise ContractError("Version must be valid semantic version text.", code="invalid_version")
    prerelease = match.group(4)
    parts: tuple[tuple[int, object], ...] = ()
    if prerelease is not None:
        parsed: list[tuple[int, object]] = []
        for part in prerelease.split("."):
            parsed.append((0, int(part)) if part.isdigit() else (1, part))
        parts = tuple(parsed)
    return int(match.group(1)), int(match.group(2)), int(match.group(3)), 1 if prerelease is None else 0, parts
