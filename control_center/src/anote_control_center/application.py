from __future__ import annotations

import base64
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Mapping

from .diagnostics import build_diagnostics
from .docker_runtime import DockerRuntime
from .errors import ContractError
from .lifecycle import LifecycleService
from .model import Installation
from .platform_paths import ManagedPaths, PlatformIdentity, current_platform, default_root
from .releases import (
    ReleaseChange,
    ReleaseInbox,
    ReleaseVerifier,
    VerifiedRelease,
    classify_release_change,
)
from .storage import InstallationRegistry, OperationJournal, strict_json_read


INTERACTION_IDS = frozenset({
    "nav.setup", "nav.updates", "nav.orchestra", "nav.uninstall",
    "release.refresh", "release.open-inbox",
    "setup.install-source", "setup.adopt-legacy", "setup.prepare-standby",
    "setup.reinstall-retained", "updates.apply-source", "updates.stage-standby",
    "orchestra.start", "orchestra.stop", "orchestra.create-checkpoint",
    "orchestra.apply-checkpoint", "orchestra.open-data",
    "orchestra.open-checkpoints", "orchestra.open-backups", "diagnostics.copy",
    "uninstall.keep-data", "uninstall.erase", "orchestra.recover",
    "operation.cancel",
})


@dataclass(frozen=True)
class ActionAvailability:
    visible: bool
    enabled: bool
    reason_code: str | None = None


@dataclass(frozen=True)
class InstallationSummary:
    installation_id: str
    role: str
    state: str
    version: str
    address: str
    last_checkpoint_id: str | None


@dataclass(frozen=True)
class ControlCenterReadModel:
    installation: InstallationSummary | None
    actions: Mapping[str, ActionAvailability]
    setup_guidance_code: str

    def action(self, interaction_id: str) -> ActionAvailability:
        return self.actions.get(interaction_id, ActionAvailability(False, False, "unavailable"))


@dataclass(frozen=True)
class CheckpointApplyIntent:
    requires_full_replace_confirmation: bool


def load_signing_policy(paths: ManagedPaths) -> tuple[Mapping[str, bytes], bool]:
    policy_path = paths.root / "release-security-policy.json"
    keys_path = paths.root / "trusted-signing-keys.json"
    require_signed = False
    keys: dict[str, bytes] = {}
    if policy_path.exists():
        value = strict_json_read(policy_path, max_bytes=64 * 1024, managed_paths=paths)
        if set(value) != {"schema", "require_signed"} or value["schema"] != 1 or not isinstance(value["require_signed"], bool):
            raise ContractError("Release security policy is invalid.", code="signing_policy_invalid")
        require_signed = value["require_signed"]
    if keys_path.exists():
        value = strict_json_read(keys_path, max_bytes=1024 * 1024, managed_paths=paths)
        if set(value) != {"schema", "keys"} or value["schema"] != 1 or not isinstance(value["keys"], dict):
            raise ContractError("Trusted release keys are invalid.", code="signing_policy_invalid")
        for key_id, encoded in value["keys"].items():
            if not isinstance(key_id, str) or not isinstance(encoded, str):
                raise ContractError("Trusted release key entry is invalid.", code="signing_policy_invalid")
            try:
                key = base64.b64decode(encoded, validate=True)
            except ValueError as error:
                raise ContractError("Trusted release key is not valid base64.", code="signing_policy_invalid") from error
            if len(key) < 32:
                raise ContractError("Trusted release key is too short.", code="signing_policy_invalid")
            keys[key_id] = key
    if require_signed and not keys:
        raise ContractError("Signed releases are required but no trusted keys are configured.", code="signing_policy_invalid")
    return keys, require_signed


class ControlCenterApplication:
    def __init__(
        self,
        *,
        paths: ManagedPaths,
        platform: PlatformIdentity,
        runtime: DockerRuntime | None = None,
    ) -> None:
        self.paths = paths
        self.platform = platform
        self.registry = InstallationRegistry(paths)
        paths.assert_safe(paths.release_cache)
        paths.assert_safe(paths.release_inbox)
        signing_keys, require_signed = load_signing_policy(paths)
        self.verifier = ReleaseVerifier(
            platform=platform,
            cache_root=paths.release_cache,
            signing_keys=signing_keys,
            require_signed=require_signed,
            managed_paths=paths,
        )
        self.releases = ReleaseInbox(paths.release_inbox, self.verifier, managed_paths=paths)
        self.runtime = runtime or DockerRuntime(paths, platform)
        self.lifecycle = LifecycleService(paths, platform, self.registry, self.runtime)

    def verify_release(self, path: Path) -> VerifiedRelease:
        return self.verifier.verify(path)

    def read_model(
        self,
        *,
        release_available: bool,
        operation_cancellable: bool = False,
    ) -> ControlCenterReadModel:
        installation = self.registry.load()
        interrupted = OperationJournal(self.paths).load() is not None
        summary = None if installation is None else InstallationSummary(
            installation.installation_id,
            installation.role,
            installation.state,
            installation.version,
            f"http://127.0.0.1:{installation.public_port}",
            installation.last_checkpoint_id,
        )

        def availability(condition: bool, reason: str) -> ActionAvailability:
            if interrupted:
                return ActionAvailability(True, False, "recovery_required")
            return ActionAvailability(True, condition, None if condition else reason)

        exists = installation is not None
        existing_data = not exists and self.paths.has_existing_data()
        role = installation.role if installation else None
        state = installation.state if installation else None
        setup_guidance_code = "installed" if exists else "existing_data" if existing_data else "choose_role"
        actions = {
            interaction_id: ActionAvailability(True, True)
            for interaction_id in INTERACTION_IDS
        }
        actions.update({
            "setup.install-source": availability(
                not exists and not existing_data and release_available,
                "existing_data" if existing_data else "verified_release_required",
            ),
            "setup.prepare-standby": availability(
                not exists and not existing_data and release_available,
                "existing_data" if existing_data else "verified_release_required",
            ),
            "setup.adopt-legacy": availability(
                not exists and existing_data and release_available,
                "existing_data_required" if not existing_data else "verified_release_required",
            ),
            "setup.reinstall-retained": availability(
                exists and state == "runtime_removed_data_retained" and release_available,
                "retained_exact_release_required",
            ),
            "updates.apply-source": availability(
                exists and role == "source" and state in {"checkpoint_required", "ready_stopped", "stopped_dirty"} and release_available,
                "stopped_source_release_required",
            ),
            "updates.stage-standby": availability(
                exists and role == "standby" and state in {"awaiting_checkpoint", "ready_stopped"} and release_available,
                "stopped_standby_release_required",
            ),
            "orchestra.start": availability(exists and state == "ready_stopped", "current_checkpoint_required"),
            "orchestra.stop": availability(exists and state == "running_dirty", "running_installation_required"),
            "orchestra.create-checkpoint": availability(
                exists and role == "source" and state in {"checkpoint_required", "stopped_dirty"},
                "stopped_source_required",
            ),
            "orchestra.apply-checkpoint": availability(
                exists and role == "standby" and state in {"awaiting_checkpoint", "ready_stopped"},
                "stopped_standby_required",
            ),
            "orchestra.recover": ActionAvailability(True, interrupted or state == "recovery_required", None if interrupted else "no_recovery_needed"),
            "orchestra.open-data": ActionAvailability(True, exists, None if exists else "not_installed"),
            "uninstall.keep-data": availability(
                exists and state in {"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty"},
                "stopped_installation_required",
            ),
            "uninstall.erase": availability(
                exists and state not in {"running_dirty", "recovery_required"},
                "recovery_required" if state == "recovery_required" else "stopped_installation_required",
            ),
            "operation.cancel": ActionAvailability(True, operation_cancellable, None if operation_cancellable else "mutation_started"),
        })
        return ControlCenterReadModel(summary, actions, setup_guidance_code)

    def erase_targets(self) -> tuple[str, ...]:
        """Return the exact canonical registry-owned erase authority for confirmation UI."""
        installation = self._installation()
        filesystem = (
            self.paths.registry,
            self.paths.operations,
            *self.paths.owned_erase_paths(),
        )
        return (
            *(f"filesystem: {path}" for path in filesystem),
            f"docker-project: {installation.project_name}",
            f"docker-image: {installation.api_image_tag}@{installation.api_image_digest}",
            f"docker-image: {installation.web_image_tag}@{installation.web_image_digest}",
        )

    def release_change(self, release: VerifiedRelease) -> ReleaseChange:
        installation = self._installation()
        return classify_release_change(
            release.manifest,
            installed_release_id=installation.release_id,
            installed_version=installation.version,
            installed_source_commit=installation.source_commit,
        )

    def installed_release(self, candidates: tuple[VerifiedRelease, ...]) -> VerifiedRelease:
        installation = self._installation()
        for release in candidates:
            if release.package_sha256 == installation.package_sha256:
                return release
        raise ContractError("The exact installed release is not in the verified inbox.", code="exact_release_required")

    def checkpoint_apply_intent(self, checkpoint_id: str, dataset_id: str, parent_id: str | None, sequence: int) -> CheckpointApplyIntent:
        installation = self._installation()
        same = installation.last_checkpoint_id == checkpoint_id
        baseline = installation.checkpoint_sequence == 0 and sequence == 1
        child = (
            installation.dataset_id == dataset_id
            and parent_id == installation.last_checkpoint_id
            and sequence == installation.checkpoint_sequence + 1
        )
        return CheckpointApplyIntent(not (same or baseline or child))

    def diagnostics(self) -> str:
        return build_diagnostics(
            paths=self.paths,
            platform=self.platform,
            registry=self.registry,
            journal=OperationJournal(self.paths),
            candidates=self.releases.discover(),
            runtime=self.runtime,
        )

    def _installation(self) -> Installation:
        installation = self.registry.load()
        if installation is None:
            raise ContractError("Anote is not installed.", code="not_installed")
        return installation


def load_application(
    *,
    state_root: Path | None = None,
    platform_identity: PlatformIdentity | None = None,
) -> ControlCenterApplication:
    platform_value = platform_identity or current_platform()
    root = state_root or default_root(platform_value.host_os)
    return ControlCenterApplication(paths=ManagedPaths(root), platform=platform_value)
