from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import tempfile
import time
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .checkpoints import (
    Backup,
    CheckpointService,
    SnapshotService,
    VerifiedCheckpoint,
    checkpoint_data_path,
    checkpoint_staging_path,
    checkpoint_work_path,
)
from .docker_runtime import DockerRuntime, LegacyContainer, LegacyRuntime, RuntimeConfiguration
from .errors import ContractError, RuntimeStillActiveError
from .model import Installation
from .platform_paths import ManagedPaths, PlatformIdentity
from .releases import ReleaseChange, VerifiedRelease, classify_release_change, file_sha256
from .storage import (
    InstallationRegistry,
    OperationJournal,
    OperationLock,
    OperationRecord,
    atomic_file_copy,
    atomic_json_write,
    ensure_private_directory,
    strict_json_read,
)


ERASE_CONFIRMATION = "ERASE ANOTE"
PREFERRED_PORT = 15173
LAST_FALLBACK_PORT = 15193
STANDBY_UPDATE_WORK_PATTERN = re.compile(r"standby-update\.[0-9a-f]{16}")
STANDBY_RUNTIME_FILES = ("compose.yaml", "production.env")


def standby_update_work_path(paths: ManagedPaths, name: str) -> Path:
    if not isinstance(name, str) or STANDBY_UPDATE_WORK_PATTERN.fullmatch(name) is None:
        raise ContractError("Standby update recovery identity is invalid.", code="recovery_failed")
    candidate = paths.assert_safe(paths.release_work / name)
    if candidate.parent != paths.release_work:
        raise ContractError("Standby update recovery identity escaped its work root.", code="recovery_failed")
    return candidate


def select_available_port(preferred: int = PREFERRED_PORT, last: int = LAST_FALLBACK_PORT) -> int:
    if preferred < 1024 or last > 65535 or preferred > last:
        raise ContractError("Port selection range is invalid.", code="invalid_port_range")
    for port in range(preferred, last + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
            candidate.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            try:
                candidate.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise ContractError("No Anote port is available in the managed range.", code="port_unavailable")


def validate_timezone(timezone: str) -> None:
    if not timezone or len(timezone) > 128 or any(character in timezone for character in "\r\n\x00"):
        raise ContractError("Time zone is invalid.", code="invalid_setup_input")
    try:
        ZoneInfo(timezone)
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise ContractError("Time zone is invalid.", code="invalid_setup_input") from error


def _validate_setup_input(username: str, password: str, timezone: str) -> None:
    if not username.strip() or len(username.strip()) > 80 or any(character in username for character in "\r\n\x00"):
        raise ContractError("Administrator username is invalid.", code="invalid_setup_input")
    if len(password) < 12 or len(password) > 1024 or "\x00" in password:
        raise ContractError("Administrator password must contain at least 12 characters.", code="invalid_setup_input")
    validate_timezone(timezone)


class LifecycleService:
    """Own all installation state transitions and their rollback obligations."""

    def __init__(
        self,
        paths: ManagedPaths,
        platform: PlatformIdentity,
        registry: InstallationRegistry,
        runtime: DockerRuntime,
        *,
        clock: Callable[[], int] = lambda: int(time.time()),
        port_selector: Callable[[], int] = select_available_port,
    ) -> None:
        self.paths = paths
        self.platform = platform
        self.registry = registry
        self.runtime = runtime
        self.clock = clock
        self.port_selector = port_selector
        self.journal = OperationJournal(paths)
        self.snapshots = SnapshotService(paths, clock=clock)
        self.checkpoints = CheckpointService(paths, registry, clock=clock)

    def fresh_source(
        self,
        release: VerifiedRelease,
        *,
        username: str,
        password: str,
        timezone: str,
        public_port: int | None = None,
        bind_address: str = "0.0.0.0",
    ) -> Installation:
        _validate_setup_input(username, password, timezone)
        release.assert_current()
        with OperationLock(self.paths):
            self._require_no_installation_or_journal()
            if self.paths.database.exists() or (self.paths.data.exists() and any(self.paths.data.iterdir())):
                raise ContractError("Managed Anote data already exists; use legacy adoption instead.", code="existing_data")
            installation = self._candidate(
                release, role="source", state="checkpoint_required", timezone=timezone,
                public_port=self._setup_port(public_port), bind_address=bind_address,
            )
            record = self._record("fresh_source", "preflight", installation, {"release": release.manifest.version})
            self.journal.save(record)
            configuration = RuntimeConfiguration(timezone, installation.public_port, bind_address)
            try:
                loaded = self.runtime.load_release_images(release)
                installation = self._with_loaded_image_ids(installation, loaded)
                record = self._with_record_image_ids(record, installation)
                self.journal.save(record)
                self.runtime.write_runtime(release, configuration)
                self.journal.save(replace(record, phase="runtime_prepared"))
                self.runtime.run_release_command(installation, release.commands.migrate)
                bootstrap = json.dumps({
                    "username": username.strip(),
                    "password": password,
                }, separators=(",", ":")).encode("utf-8")
                self.runtime.run_release_command(
                    installation,
                    release.commands.bootstrap_admin,
                    input_bytes=bootstrap,
                )
                self.journal.save(replace(record, phase="database_initialized"))
                health = self.runtime.up(installation)
                self.runtime.stop(installation)
                committed = replace(
                    installation,
                    state="checkpoint_required",
                    data_schema=self._compatible_health_schema(release, health.data_schema),
                    updated_at=self.clock(),
                )
                self.registry.save(committed)
                self.journal.clear()
                return committed
            except Exception:
                self._rollback_new_installation(installation, release)
                raise

    def prepare_standby(
        self,
        release: VerifiedRelease,
        *,
        timezone: str,
        public_port: int | None = None,
        bind_address: str = "0.0.0.0",
    ) -> Installation:
        release.assert_current()
        validate_timezone(timezone)
        with OperationLock(self.paths):
            self._require_no_installation_or_journal()
            if self.paths.database.exists() or (self.paths.data.exists() and any(self.paths.data.iterdir())):
                raise ContractError("Managed Anote data already exists; standby preparation requires an empty data root.", code="existing_data")
            installation = self._candidate(
                release, role="standby", state="awaiting_checkpoint", timezone=timezone,
                public_port=self._setup_port(public_port), bind_address=bind_address,
            )
            record = self._record("prepare_standby", "preflight", installation, {"release": release.manifest.version})
            self.journal.save(record)
            try:
                loaded = self.runtime.load_release_images(release)
                installation = self._with_loaded_image_ids(installation, loaded)
                record = self._with_record_image_ids(record, installation)
                self.journal.save(record)
                self.runtime.write_runtime(
                    release,
                    RuntimeConfiguration(timezone, installation.public_port, bind_address),
                )
                self.registry.save(installation)
                self.journal.clear()
                return installation
            except Exception:
                self._rollback_new_installation(installation, release)
                raise

    def adopt_legacy(
        self,
        release: VerifiedRelease,
        *,
        timezone: str,
        project_name: str = "anote-production",
    ) -> Installation:
        release.assert_current()
        validate_timezone(timezone)
        with OperationLock(self.paths):
            self._require_no_installation_or_journal()
            legacy = self.runtime.inspect_legacy(project_name)
            if legacy.data_path != self.paths.data.resolve(strict=False):
                raise ContractError(
                    "Existing Anote uses a different data directory; move it with an explicit checkpoint first.",
                    code="legacy_data_mismatch",
                )
            configuration = self._legacy_configuration(timezone, legacy)
            installation = self._candidate(
                release, role="source", state="checkpoint_required", timezone=configuration.timezone,
                public_port=legacy.public_port, bind_address=configuration.bind_address,
            )
            details = {
                "release": release.manifest.version,
                "legacy_project": legacy.project_name,
                "legacy_containers": ",".join(legacy.container_ids),
                "legacy_running": ",".join(legacy.running_container_ids),
                "legacy_api_id": next(item.container_id for item in legacy.containers if item.service == "api"),
                "legacy_api_ref": next(item.image_reference for item in legacy.containers if item.service == "api"),
                "legacy_web_id": next(item.container_id for item in legacy.containers if item.service == "web"),
                "legacy_web_ref": next(item.image_reference for item in legacy.containers if item.service == "web"),
                "legacy_api_image": next(item.image_id for item in legacy.containers if item.service == "api"),
                "legacy_web_image": next(item.image_id for item in legacy.containers if item.service == "web"),
                "legacy_api_env_digest": next(item.environment_digest for item in legacy.containers if item.service == "api"),
                "legacy_web_env_digest": next(item.environment_digest for item in legacy.containers if item.service == "web"),
            }
            record = self._record("adopt_legacy", "preflight", installation, details)
            self.journal.save(record)
            backup: Backup | None = None
            try:
                self.runtime.stop_legacy(legacy)
                backup = self.snapshots.create("pre-adoption")
                record = replace(record, phase="legacy_snapshotted", details={**record.details, "backup_id": backup.backup_id})
                self.journal.save(record)
                loaded = self.runtime.load_release_images(release)
                installation = self._with_loaded_image_ids(installation, loaded)
                record = self._with_record_image_ids(record, installation)
                self.journal.save(record)
                self.runtime.write_runtime(release, configuration)
                self.runtime.run_release_command(installation, release.commands.migrate)
                health = self.runtime.up(installation)
                self.runtime.stop(installation)
                data_schema = self._compatible_health_schema(release, health.data_schema)
                committed = replace(installation, state="checkpoint_required", data_schema=data_schema, updated_at=self.clock())
                self.registry.save(committed)
            except Exception:
                rollback_error: Exception | None = None
                try:
                    if self.paths.compose.exists() and self.paths.environment.exists():
                        self.runtime.down(installation)
                    if backup is not None:
                        self.snapshots.restore(backup)
                    self.runtime.restore_legacy(legacy)
                    if self.paths.runtime.exists() and not self.paths.runtime.is_symlink():
                        self.paths.assert_safe(self.paths.runtime, allow_missing=False)
                        shutil.rmtree(self.paths.runtime)
                except Exception as error:
                    rollback_error = error
                if rollback_error is None:
                    self.journal.clear()
                else:
                    self.journal.save(replace(record, phase="recovery_required"))
                raise
            postcommit = replace(record, phase="managed_committed", details={**record.details, "data_schema": str(committed.data_schema)})
            self.journal.save(postcommit)
            try:
                self.runtime.retire_legacy(legacy)
            except Exception:
                self.journal.save(replace(postcommit, phase="legacy_retirement_required"))
                raise
            self.journal.clear()
            return committed

    def update(
        self,
        release: VerifiedRelease,
        *,
        confirm_non_newer: bool = False,
    ) -> Installation:
        release.assert_current()
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            stopped_states = {"checkpoint_required", "ready_stopped", "stopped_dirty"}
            if installation.role == "standby":
                return self._stage_standby_update(installation, release, confirm_non_newer=confirm_non_newer)
            if installation.state not in stopped_states or self.runtime.is_running(installation):
                raise ContractError("Stop Anote through Orchestra before updating it.", code="stop_required")
            change = self._require_update_change(installation, release, confirm_non_newer)
            if not release.manifest.supports_data_schema(installation.data_schema):
                raise ContractError("The selected release does not support this installation's data schema.", code="release_incompatible")
            record = self._record("update", "preflight", installation, {
                "selected_version": release.manifest.version,
                "change": change.kind,
            })
            self.journal.save(record)
            try:
                backup = self.snapshots.create(f"pre-update-{installation.version}")
                self._save_runtime_backup(backup, installation)
            except Exception:
                self.journal.clear()
                raise
            record = replace(record, phase="snapshotted", details={**record.details, "backup_id": backup.backup_id})
            self.journal.save(record)
            configuration = RuntimeConfiguration(
                installation.timezone,
                installation.public_port,
                installation.bind_address,
            )
            target = replace(
                installation,
                state="checkpoint_required",
                release_id=release.manifest.release_id,
                version=release.manifest.version,
                source_commit=release.manifest.source_commit,
                package_sha256=release.package_sha256,
                api_image_tag=release.manifest.image_for_role("api").tag,
                api_image_digest=release.manifest.image_for_role("api").config_digest,
                web_image_tag=release.manifest.image_for_role("web").tag,
                web_image_digest=release.manifest.image_for_role("web").config_digest,
                dataset_id=None,
                last_checkpoint_id=None,
                checkpoint_parent_id=None,
                checkpoint_sequence=0,
            )
            try:
                loaded = self.runtime.load_release_images(release)
                target = self._with_loaded_image_ids(target, loaded)
                self.runtime.write_runtime(release, configuration)
                self.journal.save(replace(record, phase="migrating"))
                self.runtime.run_release_command(target, release.commands.migrate)
                health = self.runtime.up(target)
                self.runtime.stop(target)
                committed = replace(
                    target,
                    state="checkpoint_required",
                    data_schema=self._compatible_health_schema(release, health.data_schema),
                    updated_at=self.clock(),
                )
                self.registry.save(committed)
                self.journal.clear()
                return committed
            except Exception:
                self._rollback_update(installation, target, backup, record)
                raise

    def reinstall_retained(self, release: VerifiedRelease) -> Installation:
        release.assert_current()
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            if installation.state != "runtime_removed_data_retained" or not installation.retained_data:
                raise ContractError("No retained Anote installation is available to reinstall.", code="retained_not_available")
            if (
                release.manifest.release_id,
                release.manifest.version,
                release.package_sha256,
            ) != (installation.release_id, installation.version, installation.package_sha256):
                raise ContractError("Select the exact retained Anote release package.", code="exact_release_required")
            record = self._record("reinstall_retained", "preflight", installation, {"release": installation.version})
            self.journal.save(record)
            recovering = installation
            try:
                loaded = self.runtime.load_release_images(release)
                recovering = self._with_loaded_image_ids(recovering, loaded)
                record = self._with_record_image_ids(record, recovering)
                self.journal.save(record)
                self.runtime.write_runtime(
                    release,
                    RuntimeConfiguration(
                        installation.timezone,
                        installation.public_port, installation.bind_address,
                    ),
                )
                health = self.runtime.up(recovering)
                self.runtime.stop(recovering)
                committed = replace(
                    recovering,
                    state=installation.retained_resume_state,
                    data_schema=self._compatible_health_schema(release, health.data_schema),
                    retained_data=False,
                    retained_resume_state=None,
                    updated_at=self.clock(),
                )
                self.registry.save(committed)
                self.journal.clear()
                return committed
            except Exception:
                try:
                    if self.paths.compose.exists() and self.paths.environment.exists():
                        self.runtime.down(recovering)
                except Exception:
                    self.registry.save(replace(
                        recovering,
                        state="recovery_required",
                        retained_resume_state=None,
                        updated_at=self.clock(),
                    ))
                    self.journal.save(replace(record, phase="recovery_required"))
                    raise
                self.registry.save(installation)
                self.journal.clear()
                raise

    def _stage_standby_update(
        self,
        installation: Installation,
        release: VerifiedRelease,
        *,
        confirm_non_newer: bool,
    ) -> Installation:
        if installation.state not in {"ready_stopped", "awaiting_checkpoint"} or self.runtime.is_running(installation):
            raise ContractError("Only a clean stopped standby can stage a release.", code="stop_required")
        self._require_update_change(installation, release, confirm_non_newer)
        if not release.manifest.supports_data_schema(installation.data_schema):
            raise ContractError("Release does not support the installed data schema.", code="incompatible_data_schema")
        configuration = self.runtime.read_configuration()
        work_name = f"standby-update.{secrets.token_hex(8)}"
        record = self._record("stage_standby_update", "preflight", installation, {
            "selected_version": release.manifest.version,
            "work_dir": work_name,
        })
        self.journal.save(record)
        ensure_private_directory(self.paths.release_work, managed_paths=self.paths)
        temporary = standby_update_work_path(self.paths, work_name)
        temporary.mkdir()
        backup_ready = False
        image_load_started = False
        try:
            self._create_standby_runtime_backup(temporary)
            record = replace(record, phase="runtime_backup_ready")
            self.journal.save(record)
            backup_ready = True
            image_load_started = True
            loaded = self.runtime.load_release_images(release)
            self.runtime.write_runtime(release, configuration)
            staged = replace(
                installation,
                state="awaiting_checkpoint",
                release_id=release.manifest.release_id,
                version=release.manifest.version,
                source_commit=release.manifest.source_commit,
                package_sha256=release.package_sha256,
                api_image_tag=release.manifest.image_for_role("api").tag,
                api_image_digest=loaded["api"],
                web_image_tag=release.manifest.image_for_role("web").tag,
                web_image_digest=loaded["web"],
                updated_at=self.clock(),
            )
            self.registry.save(staged)
            shutil.rmtree(temporary)
            self.journal.clear()
            return staged
        except Exception:
            try:
                if backup_ready:
                    self._restore_standby_runtime_backup(temporary)
                    self.registry.save(installation)
                if image_load_started:
                    self.runtime.remove_images(release)
            except Exception:
                self.journal.save(replace(record, phase="recovery_required"))
                raise
            self.journal.clear()
            shutil.rmtree(temporary, ignore_errors=True)
            raise

    def _create_standby_runtime_backup(self, work: Path) -> None:
        ensure_private_directory(work, managed_paths=self.paths)
        files: dict[str, dict[str, object]] = {}
        for source in (self.paths.compose, self.paths.environment):
            self.paths.assert_safe(source, allow_missing=False)
            destination = work / source.name
            atomic_file_copy(source, destination, managed_paths=self.paths)
            files[source.name] = {
                "size": destination.stat().st_size,
                "sha256": file_sha256(destination),
            }
        atomic_json_write(
            work / "receipt.json",
            {"schema": 1, "files": files},
            managed_paths=self.paths,
        )
        self._verified_standby_runtime_backup(work)

    def _verified_standby_runtime_backup(self, work: Path) -> dict[str, Path]:
        self.paths.assert_safe(work, allow_missing=False)
        if work.is_symlink() or not work.is_dir():
            raise ContractError("Standby update work directory is unsafe.", code="recovery_failed")
        receipt = strict_json_read(
            work / "receipt.json",
            max_bytes=16 * 1024,
            managed_paths=self.paths,
        )
        if set(receipt) != {"schema", "files"} or receipt["schema"] != 1:
            raise ContractError("Standby runtime backup receipt is invalid.", code="recovery_failed")
        entries = receipt["files"]
        if not isinstance(entries, dict) or set(entries) != set(STANDBY_RUNTIME_FILES):
            raise ContractError("Standby runtime backup receipt is incomplete.", code="recovery_failed")
        verified: dict[str, Path] = {}
        for name in STANDBY_RUNTIME_FILES:
            source = work / name
            entry = entries[name]
            if (
                not isinstance(entry, dict)
                or set(entry) != {"size", "sha256"}
                or isinstance(entry["size"], bool)
                or not isinstance(entry["size"], int)
                or entry["size"] < 0
                or not isinstance(entry["sha256"], str)
                or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None
                or source.is_symlink()
                or not source.is_file()
                or source.stat().st_size != entry["size"]
                or file_sha256(source) != entry["sha256"]
            ):
                raise ContractError("Standby runtime backup failed receipt verification.", code="recovery_failed")
            verified[name] = source
        return verified

    def _restore_standby_runtime_backup(self, work: Path) -> None:
        sources = self._verified_standby_runtime_backup(work)
        for destination in (self.paths.compose, self.paths.environment):
            atomic_file_copy(sources[destination.name], destination, managed_paths=self.paths)

    def start(self, *, confirm_exclusive: bool = False) -> Installation:
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            if installation.state != "ready_stopped":
                raise ContractError("Create or apply a current checkpoint before starting Anote.", code="checkpoint_required")
            if not confirm_exclusive:
                raise ContractError("Confirm that no other Anote computer is active.", code="exclusive_start_confirmation_required")
            record = self._record("start", "preflight", installation, {})
            self.journal.save(record)
            dirty = replace(
                installation,
                role="source",
                state="running_dirty",
                updated_at=self.clock(),
            )
            self.registry.save(dirty)
            self.journal.save(replace(record, phase="dirty_recorded"))
            try:
                health = self.runtime.up(dirty)
            except Exception:
                try:
                    self.runtime.down(dirty)
                except Exception:
                    self.registry.save(replace(dirty, state="recovery_required", updated_at=self.clock()))
                    self.journal.save(replace(record, phase="recovery_required"))
                    raise
                self.registry.save(replace(dirty, state="stopped_dirty", updated_at=self.clock()))
                self.journal.clear()
                raise
            started = replace(dirty, data_schema=health.data_schema, updated_at=self.clock())
            self.registry.save(started)
            self.journal.clear()
            return started

    def stop(self) -> Installation:
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            if installation.state in {"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty"}:
                return installation
            if installation.state != "running_dirty":
                raise ContractError("Anote cannot stop while another lifecycle operation is active.", code="invalid_transition")
            record = self._record("stop", "preflight", installation, {})
            self.journal.save(record)
            try:
                self.runtime.stop(installation)
            except Exception:
                self.registry.save(replace(installation, state="recovery_required", updated_at=self.clock()))
                self.journal.save(replace(record, phase="recovery_required"))
                raise
            stopped = replace(installation, state="stopped_dirty", updated_at=self.clock())
            self.registry.save(stopped)
            self.journal.clear()
            return stopped

    def create_checkpoint(self, destination: Path) -> VerifiedCheckpoint:
        with OperationLock(self.paths):
            self._require_clean_journal()
            return self.checkpoints.create(
                destination,
                prove_stopped=lambda installation: not self.runtime.is_running(installation),
                lock_held=True,
            )

    def apply_checkpoint(
        self,
        checkpoint: VerifiedCheckpoint,
        release: VerifiedRelease,
        *,
        confirm_full_replace: bool = False,
    ) -> Installation:
        with OperationLock(self.paths):
            self._require_clean_journal()
            installation = self._require_installation()
            release.assert_current()
            selected_identity = (
                release.manifest.release_id,
                release.manifest.version,
                release.manifest.source_commit,
                release.package_sha256,
            )
            installed_identity = (
                installation.release_id,
                installation.version,
                installation.source_commit,
                installation.package_sha256,
            )
            if selected_identity != installed_identity:
                raise ContractError(
                    "Selected release no longer matches the installed standby release.",
                    code="checkpoint_incompatible",
                )

            def validate(installation: Installation) -> int:
                try:
                    health = self.runtime.up(installation)
                    self.runtime.stop(installation)
                    return self._compatible_health_schema(release, health.data_schema)
                except Exception as error:
                    try:
                        self.runtime.down(installation)
                    except Exception as stop_error:
                        raise RuntimeStillActiveError(
                            "The temporary validation runtime could not be stopped.",
                            code="recovery_required",
                        ) from stop_error
                    raise error

            return self.checkpoints.apply(
                checkpoint,
                release.manifest,
                prove_stopped=lambda installation: not self.runtime.is_running(installation),
                validate=validate,
                confirm_full_replace=confirm_full_replace,
                lock_held=True,
            )

    def safe_uninstall(self, release: VerifiedRelease | None = None) -> Installation:
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            if installation.state == "running_dirty" or self.runtime.is_running(installation):
                raise ContractError("Stop Anote through Orchestra before uninstalling its runtime.", code="stop_required")
            if installation.state not in {"checkpoint_required", "awaiting_checkpoint", "ready_stopped", "stopped_dirty"}:
                raise ContractError("Finish recovery before uninstalling Anote.", code="recovery_required")
            runtime_path = self._validated_runtime_path()
            record = self._record("safe_uninstall", "preflight", installation, {"release": installation.version})
            self.journal.save(record)
            self.runtime.down(installation)
            self.runtime.remove_registered_images(installation)
            if runtime_path is not None:
                shutil.rmtree(runtime_path)
            retained = replace(
                installation,
                state="runtime_removed_data_retained",
                retained_data=True,
                retained_resume_state=installation.state,
                updated_at=self.clock(),
            )
            self.registry.save(retained)
            self.journal.clear()
            return retained

    def erase_all(self, confirmation: str) -> None:
        if confirmation != ERASE_CONFIRMATION:
            raise ContractError(f"Type {ERASE_CONFIRMATION} exactly to erase Anote.", code="erase_confirmation_required")
        with OperationLock(self.paths):
            installation = self._require_installation()
            self._require_clean_journal()
            if installation.state == "recovery_required":
                raise ContractError("Recover and prove stopped ownership before erasing Anote.", code="recovery_required")
            if installation.state == "running_dirty" or (
                self.paths.compose.exists() and self.runtime.is_running(installation)
            ):
                raise ContractError("Stop Anote before erasing it.", code="stop_required")
            erase_targets = self._validated_erase_targets()
            record = self._record("erase_all", "preflight", installation, {})
            self.journal.save(record)
            if self.paths.compose.exists() and self.paths.environment.exists():
                self.runtime.down(installation)
            self.runtime.remove_registered_images(installation)
            self.journal.save(replace(record, phase="runtime_removed"))
            for path in erase_targets:
                if path.is_dir():
                    shutil.rmtree(path)
                elif path.exists():
                    path.unlink()
            self.registry.clear()
            self.journal.clear()
        for directory in (self.paths.registry.parent, self.paths.operations):
            try:
                directory.rmdir()
            except OSError:
                pass

    def recover_interrupted(self) -> Installation | None:
        """Converge an interrupted operation to its documented safe state."""
        with OperationLock(self.paths):
            record = self.journal.load()
            installation = self.registry.load()
            if record is None:
                if installation is None or not self.paths.compose.exists() or not self.paths.environment.exists():
                    return installation
                running = self.runtime.is_running(installation)
                if installation.state == "running_dirty" and not running:
                    installation = replace(installation, state="stopped_dirty", updated_at=self.clock())
                    self.registry.save(installation)
                elif installation.state != "running_dirty" and running:
                    self.runtime.stop(installation)
                return installation

            if record.kind in {"fresh_source", "prepare_standby"}:
                if installation is not None:
                    self.journal.clear()
                    return installation
                candidate = self._installation_from_record(record)
                if self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(candidate)
                if self.paths.production.exists() and not self.paths.production.is_symlink():
                    shutil.rmtree(self.paths.production)
                self.journal.clear()
                return None

            if record.kind == "adopt_legacy":
                if installation is not None:
                    if installation.installation_id != record.installation_id:
                        raise ContractError("Adoption recovery registry identity is inconsistent.", code="recovery_failed")
                    if self.paths.compose.exists() and self.paths.environment.exists() and self.runtime.is_running(installation):
                        self.runtime.stop(installation)
                    self.runtime.retire_legacy(self._legacy_from_record(record))
                    self.journal.clear()
                    return installation
                candidate = self._installation_from_record(record)
                if self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(candidate)
                backup_id = record.details.get("backup_id")
                if backup_id:
                    self.snapshots.restore(self._backup(backup_id))
                legacy = self._legacy_from_record(record)
                self.runtime.restore_legacy(legacy)
                self.journal.clear()
                return None

            if record.kind == "update":
                if installation is None:
                    raise ContractError("Update recovery is missing its installation registry.", code="recovery_failed")
                if "backup_id" not in record.details:
                    self.journal.clear()
                    return installation
                previous = self._installation_from_record(record)
                backup = self._backup(record.details["backup_id"])
                if self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(installation)
                if installation.package_sha256 != previous.package_sha256:
                    self.runtime.remove_registered_images(installation)
                self.snapshots.restore(backup)
                self._restore_runtime_backup(backup, previous)
                recovered = replace(previous, state="recovery_required", updated_at=self.clock())
                self.runtime.up(recovered)
                self.runtime.stop(recovered)
                recovered = replace(previous, updated_at=self.clock())
                self.registry.save(recovered)
                self.journal.clear()
                return recovered

            if record.kind == "stage_standby_update":
                if installation is None:
                    raise ContractError("Standby update recovery is missing its installation registry.", code="recovery_failed")
                work = standby_update_work_path(self.paths, record.details.get("work_dir", ""))
                if record.phase == "preflight":
                    if work.exists():
                        if work.is_symlink() or not work.is_dir():
                            raise ContractError("Standby update work directory is unsafe.", code="recovery_failed")
                        shutil.rmtree(work)
                    self.journal.clear()
                    return installation
                if record.phase not in {"runtime_backup_ready", "recovery_required"}:
                    raise ContractError("Standby update recovery phase is invalid.", code="recovery_failed")
                self._restore_standby_runtime_backup(work)
                previous = self._installation_from_record(record)
                self.registry.save(previous)
                shutil.rmtree(work)
                self.journal.clear()
                return previous

            if record.kind == "start":
                if installation is None:
                    raise ContractError("Start recovery is missing its installation registry.", code="recovery_failed")
                if record.phase == "preflight" and installation.state == "ready_stopped":
                    self.journal.clear()
                    return installation
                try:
                    self.runtime.stop(installation)
                except Exception as error:
                    recovered = replace(installation, state="recovery_required", updated_at=self.clock())
                    self.registry.save(recovered)
                    self.journal.save(replace(record, phase="recovery_required"))
                    raise ContractError("Interrupted start could not be stopped safely.", code="recovery_failed") from error
                recovered = replace(installation, state="stopped_dirty", updated_at=self.clock())
                self.registry.save(recovered)
                self.journal.clear()
                return recovered

            if record.kind == "stop":
                if installation is None:
                    raise ContractError("Stop recovery is missing its installation registry.", code="recovery_failed")
                try:
                    self.runtime.stop(installation)
                except Exception as error:
                    recovered = replace(installation, state="recovery_required", updated_at=self.clock())
                    self.registry.save(recovered)
                    self.journal.save(replace(record, phase="recovery_required"))
                    raise ContractError("Interrupted stop could not be completed safely.", code="recovery_failed") from error
                recovered = replace(installation, state="stopped_dirty", updated_at=self.clock())
                self.registry.save(recovered)
                self.journal.clear()
                return recovered

            if record.kind == "apply_checkpoint":
                if installation is None:
                    raise ContractError("Checkpoint recovery is missing its installation registry.", code="recovery_failed")
                staged_name = record.details.get("checkpoint_staging_name")
                if staged_name:
                    checkpoint_staging_path(self.paths, staged_name).unlink(missing_ok=True)
                staging = checkpoint_data_path(
                    self.paths, record.details.get("checkpoint_data_staging_name", ""), "staging",
                )
                previous = checkpoint_data_path(
                    self.paths, record.details.get("checkpoint_previous_name", ""), "previous",
                )
                failed = checkpoint_data_path(
                    self.paths, record.details.get("checkpoint_failed_name", ""), "failed",
                )
                for candidate in (staging, previous, failed):
                    self._validate_checkpoint_directory(candidate)
                committed_checkpoint = record.details.get("checkpoint_id")
                if committed_checkpoint and installation.last_checkpoint_id == committed_checkpoint:
                    self._remove_checkpoint_directory(previous)
                elif previous.exists():
                    if failed.exists():
                        raise ContractError("Checkpoint recovery found an ambiguous failed candidate.", code="recovery_failed")
                    if self.paths.data.exists():
                        os.replace(self.paths.data, failed)
                    os.replace(previous, self.paths.data)
                elif not self.paths.data.exists():
                    raise ContractError("Checkpoint recovery is missing both current and previous data.", code="recovery_failed")
                self._remove_checkpoint_directory(staging)
                self._remove_checkpoint_directory(failed)
                self.journal.clear()
                return installation

            if record.kind == "reinstall_retained":
                if installation is None:
                    raise ContractError("Retained reinstall recovery is missing its registry.", code="recovery_failed")
                candidate = self._installation_from_record(record)
                if self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(candidate)
                self.runtime.remove_registered_images(candidate)
                if self.paths.runtime.exists() and not self.paths.runtime.is_symlink():
                    shutil.rmtree(self.paths.runtime)
                retained = replace(
                    installation,
                    state="runtime_removed_data_retained",
                    retained_data=True,
                    retained_resume_state=record.details.get("retained_resume_state") or "checkpoint_required",
                    updated_at=self.clock(),
                )
                self.registry.save(retained)
                self.journal.clear()
                return retained

            if record.kind == "safe_uninstall":
                if installation is None:
                    raise ContractError("Safe uninstall recovery is missing its registry.", code="recovery_failed")
                runtime_path = self._validated_runtime_path()
                if self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(installation)
                self.runtime.remove_registered_images(installation)
                if runtime_path is not None:
                    shutil.rmtree(runtime_path)
                retained = replace(
                    installation,
                    state="runtime_removed_data_retained",
                    retained_data=True,
                    retained_resume_state=record.details.get("state", "checkpoint_required"),
                    updated_at=self.clock(),
                )
                self.registry.save(retained)
                self.journal.clear()
                return retained

            if record.kind == "erase_all":
                erase_targets = self._validated_erase_targets()
                if installation is not None and self.paths.compose.exists() and self.paths.environment.exists():
                    self.runtime.down(installation)
                if installation is not None:
                    self.runtime.remove_registered_images(installation)
                for path in erase_targets:
                    if path.is_dir() and not path.is_symlink():
                        shutil.rmtree(path)
                    elif path.exists() and not path.is_symlink():
                        path.unlink()
                self.registry.clear()
                self.journal.clear()
                return None

            if record.kind == "create_checkpoint":
                work_name = record.details.get("checkpoint_work_name")
                if work_name:
                    candidate = checkpoint_work_path(self.paths, work_name)
                    if candidate.exists():
                        if not candidate.is_dir() or candidate.is_symlink():
                            raise ContractError("Checkpoint recovery work path is unsafe.", code="recovery_failed")
                        shutil.rmtree(candidate)
                return self.checkpoints.recover_create(record)

            raise ContractError("Interrupted operation type is unsupported.", code="recovery_failed")

    def inspect(self) -> Installation | None:
        return self.registry.load()

    def _validated_erase_targets(self) -> tuple[Path, ...]:
        """Freeze and validate every filesystem authority before Docker mutation."""
        self.paths.assert_safe(self.paths.registry)
        self.paths.assert_safe(self.paths.operations)
        return self.paths.owned_erase_paths()

    def _validated_runtime_path(self) -> Path | None:
        if not self.paths.runtime.exists() and not self.paths.runtime.is_symlink():
            return None
        runtime = self.paths.assert_safe(self.paths.runtime, allow_missing=False)
        if not runtime.is_dir() or runtime.is_symlink():
            raise ContractError("Anote runtime path is unsafe.", code="unsafe_owned_path")
        return runtime

    @staticmethod
    def _remove_checkpoint_directory(path: Path) -> None:
        LifecycleService._validate_checkpoint_directory(path)
        if not path.exists():
            return
        shutil.rmtree(path)

    @staticmethod
    def _validate_checkpoint_directory(path: Path) -> None:
        if not path.exists() and not path.is_symlink():
            return
        if not path.is_dir() or path.is_symlink():
            raise ContractError("Checkpoint recovery data path is unsafe.", code="recovery_failed")

    def _candidate(
        self,
        release: VerifiedRelease,
        *,
        role: str,
        state: str,
        timezone: str,
        public_port: int,
        bind_address: str,
    ) -> Installation:
        if release.manifest.platform != self.platform:
            raise ContractError("Release package does not match this computer.", code="incompatible_platform")
        now = self.clock()
        installation_id = secrets.token_hex(16)
        return Installation(
            installation_id,
            role,  # type: ignore[arg-type]
            state,  # type: ignore[arg-type]
            release.manifest.release_id,
            release.manifest.version,
            release.manifest.source_commit,
            release.package_sha256,
            release.manifest.image_for_role("api").tag,
            release.manifest.image_for_role("api").config_digest,
            release.manifest.image_for_role("web").tag,
            release.manifest.image_for_role("web").config_digest,
            self.platform.host_os,
            self.platform.host_architecture,
            self.platform.container_architecture,
            public_port,
            timezone,
            bind_address,
            f"anote-{installation_id[:12]}",
            release.manifest.minimum_data_schema,
            ("production", "backups", "checkpoints", "releases", "logs", "operations"),
            None,
            None,
            0,
            now,
            now,
        )

    @staticmethod
    def _with_loaded_image_ids(installation: Installation, loaded: dict[str, str]) -> Installation:
        if set(loaded) != {"api", "web"}:
            raise ContractError("Loaded release image identity is incomplete.", code="image_identity_mismatch")
        return replace(
            installation,
            api_image_digest=loaded["api"],
            web_image_digest=loaded["web"],
        )

    @staticmethod
    def _with_record_image_ids(record: OperationRecord, installation: Installation) -> OperationRecord:
        return replace(record, details={
            **record.details,
            "api_image_digest": installation.api_image_digest,
            "web_image_digest": installation.web_image_digest,
        })

    def _record(self, kind: str, phase: str, installation: Installation, details: dict[str, str]) -> OperationRecord:
        identity = {
            "project": installation.project_name,
            "release_id": installation.release_id,
            "version": installation.version,
            "source_commit": installation.source_commit,
            "package_sha256": installation.package_sha256,
            "api_image_tag": installation.api_image_tag,
            "api_image_digest": installation.api_image_digest,
            "web_image_tag": installation.web_image_tag,
            "web_image_digest": installation.web_image_digest,
            "role": installation.role,
            "state": installation.state,
            "host_os": installation.host_os,
            "host_architecture": installation.host_architecture,
            "container_architecture": installation.container_architecture,
            "public_port": str(installation.public_port),
            "timezone": installation.timezone,
            "bind_address": installation.bind_address,
            "data_schema": str(installation.data_schema),
            "owned_paths": ",".join(installation.owned_paths),
            "dataset_id": installation.dataset_id or "",
            "checkpoint_parent_id": installation.checkpoint_parent_id or "",
            "checkpoint_sequence": str(installation.checkpoint_sequence),
            "created_at": str(installation.created_at),
            "last_checkpoint_id": installation.last_checkpoint_id or "",
            "retained_data": "1" if installation.retained_data else "0",
            "retained_resume_state": installation.retained_resume_state or "",
            "pending_release_id": installation.pending_release_id or "",
            "pending_version": installation.pending_version or "",
            "pending_source_commit": installation.pending_source_commit or "",
        }
        return OperationRecord(
            secrets.token_hex(12), kind, phase, installation.installation_id,
            self.clock(), {**identity, **details},
        )

    def _installation_from_record(self, record: OperationRecord) -> Installation:
        details = record.details
        if record.installation_id is None:
            raise ContractError("Recovery journal is missing an installation identity.", code="recovery_failed")
        try:
            return Installation(
                record.installation_id,
                details["role"],  # type: ignore[arg-type]
                details["state"],  # type: ignore[arg-type]
                details["release_id"],
                details["version"],
                details["source_commit"],
                details["package_sha256"],
                details["api_image_tag"],
                details["api_image_digest"],
                details["web_image_tag"],
                details["web_image_digest"],
                details["host_os"],
                details["host_architecture"],
                details["container_architecture"],
                int(details["public_port"]),
                details["timezone"],
                details["bind_address"],
                details["project"],
                int(details["data_schema"]),
                tuple(filter(None, details["owned_paths"].split(","))),
                details["dataset_id"] or None,
                details["checkpoint_parent_id"] or None,
                int(details["checkpoint_sequence"]),
                int(details["created_at"]),
                self.clock(),
                details["last_checkpoint_id"] or None,
                details["retained_data"] == "1",
                details["retained_resume_state"] or None,
                details["pending_release_id"] or None,
                details["pending_version"] or None,
                details["pending_source_commit"] or None,
            )
        except (KeyError, ValueError) as error:
            raise ContractError("Recovery journal is missing runtime identity.", code="recovery_failed") from error

    def _backup(self, backup_id: str) -> Backup:
        root = self.paths.backups / backup_id
        return Backup(backup_id, root, root / "calendar.db", root / "uploads.tar")

    def _require_no_installation_or_journal(self) -> None:
        if self.registry.load() is not None:
            raise ContractError("Anote is already set up on this computer.", code="already_installed")
        self._require_clean_journal()

    def _require_clean_journal(self) -> None:
        if self.journal.load() is not None:
            raise ContractError("An interrupted operation must be recovered first.", code="recovery_required")

    def _require_installation(self) -> Installation:
        installation = self.registry.load()
        if installation is None:
            raise ContractError("Anote is not set up on this computer.", code="not_installed")
        return installation

    @staticmethod
    def _require_update_change(
        installation: Installation,
        release: VerifiedRelease,
        confirm_non_newer: bool,
    ) -> ReleaseChange:
        change = classify_release_change(
            release.manifest,
            installed_release_id=installation.release_id,
            installed_version=installation.version,
            installed_source_commit=installation.source_commit,
        )
        if change.kind == "current":
            raise ContractError("The selected release is already installed.", code="release_current")
        if change.kind == "incompatible":
            raise ContractError("The selected release cannot upgrade this installed version.", code="release_incompatible")
        if change.requires_confirmation and not confirm_non_newer:
            raise ContractError("Confirm the selected non-newer or replacement release.", code="release_confirmation_required")
        return change

    def _rollback_new_installation(self, installation: Installation, release: VerifiedRelease) -> None:
        rollback_error: Exception | None = None
        try:
            if self.paths.compose.exists() and self.paths.environment.exists():
                self.runtime.down(installation)
            self.runtime.remove_images(release)
            if self.paths.production.exists() and not self.paths.production.is_symlink():
                self.paths.assert_safe(self.paths.production, allow_missing=False)
                shutil.rmtree(self.paths.production)
            self.registry.clear()
        except Exception as error:
            rollback_error = error
        if rollback_error is None:
            self.journal.clear()
        else:
            record = self.journal.load()
            if record is not None:
                self.journal.save(replace(record, phase="recovery_required"))

    def _rollback_update(
        self,
        previous: Installation,
        candidate: Installation,
        backup: Backup,
        record: OperationRecord,
    ) -> None:
        try:
            self.runtime.down(candidate)
            self.runtime.remove_registered_images(candidate)
            self.snapshots.restore(backup)
            self._restore_runtime_backup(backup, previous)
            recovering = replace(previous, state="recovery_required", updated_at=self.clock())
            self.registry.save(recovering)
            self.runtime.up(recovering)
            self.runtime.stop(recovering)
            self.registry.save(replace(previous, updated_at=self.clock()))
            self.journal.clear()
        except Exception:
            self.registry.save(replace(previous, state="recovery_required", updated_at=self.clock()))
            self.journal.save(replace(record, phase="recovery_required"))

    def _save_runtime_backup(self, backup: Backup, installation: Installation) -> None:
        self.snapshots.record_runtime(backup, installation, (self.paths.compose, self.paths.environment))

    def _restore_runtime_backup(self, backup: Backup, installation: Installation) -> None:
        sources = self.snapshots.verified_runtime_files(backup, installation)
        ensure_private_directory(self.paths.runtime, managed_paths=self.paths)
        for name, source in sources.items():
            shutil.copyfile(source, self.paths.runtime / name)

    def _setup_port(self, requested: int | None) -> int:
        port = self.port_selector() if requested is None else requested
        if isinstance(port, bool) or not isinstance(port, int) or not PREFERRED_PORT <= port <= LAST_FALLBACK_PORT:
            raise ContractError(
                f"Choose a setup port from {PREFERRED_PORT} through {LAST_FALLBACK_PORT}.",
                code="invalid_setup_input",
            )
        return port

    def _legacy_configuration(self, timezone: str, legacy: LegacyRuntime) -> RuntimeConfiguration:
        return RuntimeConfiguration(
            legacy.timezone or timezone,
            legacy.public_port,
            legacy.bind_address,
        )

    def _legacy_from_record(self, record: OperationRecord) -> LegacyRuntime:
        details = record.details
        running = set(filter(None, details.get("legacy_running", "").split(",")))
        containers = tuple(
            LegacyContainer(
                service,
                details[f"legacy_{service}_id"],
                details[f"legacy_{service}_ref"],
                details[f"legacy_{service}_image"],
                details[f"legacy_{service}_env_digest"],
                details[f"legacy_{service}_id"] in running,
            )
            for service in ("api", "web")
        )
        return LegacyRuntime(
            details["legacy_project"],
            containers,
            self.paths.data,
            int(details["public_port"]),
            details["bind_address"],
            details.get("timezone") or None,
            "",
        )

    @staticmethod
    def _compatible_health_schema(release: VerifiedRelease, schema: int) -> int:
        if not release.manifest.supports_data_schema(schema):
            raise ContractError("Anote reported a data schema outside the selected release contract.", code="release_incompatible")
        return schema
