from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from anote_control_center.application import ControlCenterApplication, INTERACTION_IDS
from anote_control_center.docker_runtime import HealthIdentity, LegacyContainer, LegacyRuntime, RuntimeConfiguration
from anote_control_center.errors import ContractError, RuntimeCommandError
from anote_control_center.i18n import CATALOGS, validate_catalogs
from anote_control_center.lifecycle import ERASE_CONFIRMATION, LifecycleService
from anote_control_center.platform_paths import ManagedPaths
from anote_control_center.storage import InstallationRegistry

from helpers import MAC, write_release


class FakeRuntime:
    def __init__(self, paths: ManagedPaths, registry: InstallationRegistry) -> None:
        self.paths = paths
        self.registry = registry
        self.events: list[str] = []
        self.configuration: RuntimeConfiguration | None = None
        self.running = False
        self.fail_next_up = False
        self.fail_down = False
        self.fail_retire = False
        self.bootstrap_payload: dict[str, str] | None = None
        self.legacy: LegacyRuntime | None = None

    def load_release_images(self, release: object) -> dict[str, str]:
        release.assert_current()  # type: ignore[attr-defined]
        self.events.append("load")
        return {"api": "sha256:" + "7" * 64, "web": "sha256:" + "8" * 64}

    def write_runtime(self, release: object, configuration: RuntimeConfiguration) -> None:
        self.configuration = configuration
        self.paths.runtime.mkdir(parents=True, exist_ok=True)
        self.paths.data.mkdir(parents=True, exist_ok=True)
        self.paths.uploads.mkdir(parents=True, exist_ok=True)
        self.paths.compose.write_text("services: {}\n", encoding="utf-8")
        self.paths.environment.write_text("managed\n", encoding="utf-8")
        self.events.append("write")

    def run_release_command(self, installation: object, command: tuple[str, ...], *, input_bytes: bytes | None = None) -> None:
        self.events.append("command:" + " ".join(command))
        if command == ("node", "migrate.js"):
            connection = sqlite3.connect(self.paths.database)
            connection.execute("CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, title TEXT)")
            connection.commit()
            connection.close()
        if command == ("node", "bootstrap-admin.js"):
            assert input_bytes is not None
            self.bootstrap_payload = json.loads(input_bytes)

    def up(self, installation: object) -> HealthIdentity:
        state = self.registry.load()
        self.events.append("up-registry:" + (state.state if state else "none"))
        self.running = True
        if self.fail_next_up:
            self.fail_next_up = False
            raise RuntimeCommandError("injected readiness failure", code="health_timeout")
        return HealthIdentity(installation.release_id, installation.version, installation.source_commit, 1)  # type: ignore[attr-defined]

    def stop(self, _installation: object) -> None:
        self.events.append("stop")
        self.running = False

    def down(self, _installation: object) -> None:
        self.events.append("down")
        if self.fail_down:
            raise RuntimeCommandError("injected down failure", code="docker_command_failed")
        self.running = False

    def is_running(self, _installation: object) -> bool:
        return self.running

    def read_configuration(self) -> RuntimeConfiguration:
        assert self.configuration is not None
        return self.configuration

    def remove_images(self, _release: object) -> None:
        self.events.append("remove-images")

    def remove_registered_images(self, _installation: object) -> None:
        self.events.append("remove-registered-images")

    def inspect_legacy(self, _project_name: str) -> LegacyRuntime:
        if self.legacy is None:
            raise RuntimeCommandError("missing", code="legacy_not_found")
        return self.legacy

    def stop_legacy(self, _legacy: LegacyRuntime) -> None:
        self.events.append("stop-legacy")

    def restore_legacy(self, _legacy: LegacyRuntime) -> None:
        self.events.append("restore-legacy")

    def retire_legacy(self, _legacy: LegacyRuntime) -> None:
        self.events.append("retire-legacy")
        state = self.registry.load()
        self.events.append("retire-registry:" + (state.state if state else "none"))
        if self.fail_retire:
            raise RuntimeCommandError("injected retirement failure", code="docker_command_failed")

    def require_ready(self, _manifest: object | None = None) -> None:
        return None


class LifecycleApplicationTests(unittest.TestCase):
    def environment(self, root: Path) -> tuple[ManagedPaths, InstallationRegistry, FakeRuntime, LifecycleService]:
        paths = ManagedPaths(root / "state")
        registry = InstallationRegistry(paths)
        runtime = FakeRuntime(paths, registry)
        service = LifecycleService(paths, MAC, registry, runtime, clock=lambda: 100, port_selector=lambda: 15173)  # type: ignore[arg-type]
        return paths, registry, runtime, service

    def fresh(self, root: Path) -> tuple[object, ManagedPaths, InstallationRegistry, FakeRuntime, LifecycleService]:
        release = write_release(root / "release")
        paths, registry, runtime, service = self.environment(root)
        installed = service.fresh_source(
            release,
            username="administrator",
            password="a-secure-password",
            timezone="America/Mexico_City",
            bind_address="127.0.0.1",
        )
        return release, paths, registry, runtime, service

    def test_fresh_setup_bootstraps_offline_and_finishes_stopped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _release, _paths, registry, runtime, _service = self.fresh(Path(directory))
            installed = registry.load()
            self.assertEqual("checkpoint_required", installed.state)  # type: ignore[union-attr]
            self.assertEqual("sha256:" + "7" * 64, installed.api_image_digest)  # type: ignore[union-attr]
            self.assertEqual("sha256:" + "8" * 64, installed.web_image_digest)  # type: ignore[union-attr]
            self.assertFalse(runtime.running)
            self.assertEqual({"username": "administrator", "password": "a-secure-password"}, runtime.bootstrap_payload)
            self.assertNotIn("America/Mexico_City", json.dumps(runtime.bootstrap_payload))
            self.assertLess(runtime.events.index("command:node migrate.js"), runtime.events.index("command:node bootstrap-admin.js"))
            self.assertEqual("stop", runtime.events[-1])

    def test_start_records_dirty_before_docker_and_stop_requires_new_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            release, paths, registry, runtime, service = self.fresh(Path(directory))
            service.create_checkpoint(Path(directory) / "baseline.anote-checkpoint")
            started = service.start(confirm_exclusive=True)
            self.assertEqual("running_dirty", started.state)
            self.assertIn("up-registry:running_dirty", runtime.events)
            stopped = service.stop()
            self.assertEqual("stopped_dirty", stopped.state)
            self.assertFalse(runtime.running)

    def test_failed_start_stops_runtime_and_never_claims_clean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _release, _paths, registry, runtime, service = self.fresh(Path(directory))
            service.create_checkpoint(Path(directory) / "baseline.anote-checkpoint")
            runtime.fail_next_up = True
            with self.assertRaises(RuntimeCommandError):
                service.start(confirm_exclusive=True)
            self.assertEqual("stopped_dirty", registry.load().state)  # type: ignore[union-attr]
            self.assertFalse(runtime.running)
            self.assertIsNone(service.journal.load())

    def test_update_failure_restores_previous_release_data_and_stopped_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _release, paths, registry, runtime, service = self.fresh(root)
            service.create_checkpoint(root / "baseline.anote-checkpoint")
            connection = sqlite3.connect(paths.database)
            connection.execute("INSERT INTO events(title) VALUES ('before-update')")
            connection.commit()
            connection.close()
            selected = write_release(root / "release-2", version="1.1.0", commit="d" * 40)
            runtime.fail_next_up = True
            with self.assertRaises(RuntimeCommandError):
                service.update(selected)
            restored = registry.load()
            self.assertEqual(("1.0.0", "ready_stopped"), (restored.version, restored.state))  # type: ignore[union-attr]
            connection = sqlite3.connect(paths.database)
            try:
                self.assertEqual("before-update", connection.execute("SELECT title FROM events").fetchone()[0])
            finally:
                connection.close()
            self.assertIsNone(service.journal.load())
            self.assertFalse(runtime.running)

    def test_interrupted_update_uses_journaled_previous_identity_after_candidate_registry_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _release, paths, registry, runtime, service = self.fresh(root)
            service.create_checkpoint(root / "baseline.anote-checkpoint")
            previous = registry.load()
            assert previous is not None
            backup = service.snapshots.create("pre-update")
            service._save_runtime_backup(backup, previous)
            selected = write_release(root / "release-2", version="1.1.0", commit="d" * 40)
            candidate = replace(
                previous,
                release_id=selected.manifest.release_id,
                version=selected.manifest.version,
                source_commit=selected.manifest.source_commit,
                package_sha256=selected.package_sha256,
                api_image_tag=selected.manifest.image_for_role("api").tag,
                api_image_digest=selected.manifest.image_for_role("api").config_digest,
                web_image_tag=selected.manifest.image_for_role("web").tag,
                web_image_digest=selected.manifest.image_for_role("web").config_digest,
            )
            registry.save(candidate)
            connection = sqlite3.connect(paths.database)
            connection.execute("INSERT INTO events(title) VALUES ('candidate-only')")
            connection.commit()
            connection.close()
            record = service._record("update", "migrating", previous, {
                "selected_version": selected.manifest.version,
                "change": "upgrade",
                "backup_id": backup.backup_id,
            })
            service.journal.save(record)
            recovered = service.recover_interrupted()
            self.assertEqual((previous.version, previous.package_sha256), (recovered.version, recovered.package_sha256))  # type: ignore[union-attr]
            connection = sqlite3.connect(paths.database)
            try:
                self.assertEqual(0, connection.execute("SELECT count(*) FROM events WHERE title = 'candidate-only'").fetchone()[0])
            finally:
                connection.close()
            self.assertIn("remove-registered-images", runtime.events)
            self.assertIsNone(service.journal.load())

    def test_interrupted_start_recovery_converges_to_stopped_dirty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _release, _paths, registry, runtime, service = self.fresh(root)
            service.create_checkpoint(root / "baseline.anote-checkpoint")
            ready = registry.load()
            record = service._record("start", "dirty_recorded", ready, {})  # type: ignore[arg-type]
            service.journal.save(record)
            registry.save(replace(ready, state="running_dirty"))  # type: ignore[arg-type]
            runtime.running = True
            recovered = service.recover_interrupted()
            self.assertEqual("stopped_dirty", recovered.state)  # type: ignore[union-attr]
            self.assertFalse(runtime.running)
            self.assertIsNone(service.journal.load())

    def test_safe_uninstall_retains_data_and_erase_is_registry_scoped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release, paths, registry, runtime, service = self.fresh(root)
            retained = service.safe_uninstall(release)  # type: ignore[arg-type]
            self.assertEqual("runtime_removed_data_retained", retained.state)
            self.assertTrue(paths.database.exists())
            self.assertFalse(paths.runtime.exists())
            unrelated = root / "unrelated-private-archive"
            unrelated.write_text("keep", encoding="utf-8")
            service.erase_all(ERASE_CONFIRMATION)
            self.assertIsNone(registry.load())
            self.assertEqual("keep", unrelated.read_text(encoding="utf-8"))

    def test_application_read_model_is_the_single_capability_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ManagedPaths(root / "state")
            registry = InstallationRegistry(paths)
            runtime = FakeRuntime(paths, registry)
            application = ControlCenterApplication(paths=paths, platform=MAC, runtime=runtime)  # type: ignore[arg-type]
            empty = application.read_model(release_available=True)
            self.assertTrue(empty.action("setup.install-source").enabled)
            self.assertFalse(empty.action("orchestra.start").enabled)
            release = write_release(root / "release")
            application.lifecycle.fresh_source(
                release,
                username="administrator",
                password="a-secure-password",
                timezone="UTC",
                public_port=15173,
                bind_address="127.0.0.1",
            )
            installed = application.read_model(release_available=True)
            self.assertFalse(installed.action("setup.install-source").enabled)
            self.assertTrue(installed.action("orchestra.create-checkpoint").enabled)
            self.assertEqual(INTERACTION_IDS, set(installed.actions))
            cancellable = application.read_model(release_available=True, operation_cancellable=True)
            self.assertTrue(cancellable.action("operation.cancel").enabled)
            targets = application.erase_targets()
            self.assertIn(f"docker-project: {registry.load().project_name}", targets)  # type: ignore[union-attr]
            self.assertTrue(any(str(paths.production) in target for target in targets))

    def test_operator_intents_are_exhaustively_guarded_by_lifecycle_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release, paths, registry, runtime, service = self.fresh(root)
            application = ControlCenterApplication(paths=paths, platform=MAC, runtime=runtime)  # type: ignore[arg-type]
            checkpoint = service.create_checkpoint(root / "baseline.anote-checkpoint")
            del checkpoint, release
            ready = registry.load()
            assert ready is not None
            source_empty = replace(
                ready, state="checkpoint_required", dataset_id=None, last_checkpoint_id=None,
                checkpoint_parent_id=None, checkpoint_sequence=0,
            )
            states = {
                "checkpoint_required": source_empty,
                "awaiting_checkpoint": replace(source_empty, role="standby", state="awaiting_checkpoint"),
                "ready_stopped": ready,
                "running_dirty": replace(ready, state="running_dirty"),
                "stopped_dirty": replace(ready, state="stopped_dirty"),
                "runtime_removed_data_retained": replace(
                    ready, state="runtime_removed_data_retained", retained_data=True,
                    retained_resume_state="ready_stopped",
                ),
                "recovery_required": replace(ready, state="recovery_required"),
            }
            expected = {
                "checkpoint_required": {"updates.apply-source", "orchestra.create-checkpoint", "uninstall.keep-data", "uninstall.erase"},
                "awaiting_checkpoint": {"updates.stage-standby", "orchestra.apply-checkpoint", "uninstall.keep-data", "uninstall.erase"},
                "ready_stopped": {"updates.apply-source", "orchestra.start", "uninstall.keep-data", "uninstall.erase"},
                "running_dirty": {"orchestra.stop"},
                "stopped_dirty": {"updates.apply-source", "orchestra.create-checkpoint", "uninstall.keep-data", "uninstall.erase"},
                "runtime_removed_data_retained": {"setup.reinstall-retained", "uninstall.erase"},
                "recovery_required": {"orchestra.recover"},
            }
            intents = {
                "setup.reinstall-retained", "updates.apply-source", "updates.stage-standby",
                "orchestra.start", "orchestra.stop", "orchestra.create-checkpoint",
                "orchestra.apply-checkpoint", "orchestra.recover", "uninstall.keep-data", "uninstall.erase",
            }
            for state, installation in states.items():
                registry.save(installation)
                model = application.read_model(release_available=True)
                enabled = {intent for intent in intents if model.action(intent).enabled}
                self.assertEqual(expected[state], enabled, state)

    def test_adoption_commits_managed_state_before_retiring_exact_legacy_containers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = write_release(root / "release")
            paths, registry, runtime, service = self.environment(root)
            paths.data.mkdir(parents=True)
            connection = sqlite3.connect(paths.database)
            connection.execute("CREATE TABLE events(id INTEGER PRIMARY KEY)")
            connection.commit()
            connection.close()
            runtime.legacy = LegacyRuntime(
                "anote-production",
                (
                    LegacyContainer("api", "1" * 64, "legacy-api:1", "sha256:" + "a" * 64, "b" * 64, True),
                    LegacyContainer("web", "2" * 64, "legacy-web:1", "sha256:" + "c" * 64, "d" * 64, True),
                ),
                paths.data.resolve(),
                15173,
                "127.0.0.1",
                "UTC",
                "e" * 64,
            )
            runtime.fail_retire = True
            with self.assertRaises(RuntimeCommandError):
                service.adopt_legacy(release, timezone="UTC")
            self.assertIsNotNone(registry.load())
            self.assertIn("retire-registry:checkpoint_required", runtime.events)
            self.assertIsNotNone(service.journal.load())
            runtime.fail_retire = False
            recovered = service.recover_interrupted()
            self.assertEqual("checkpoint_required", recovered.state)  # type: ignore[union-attr]
            self.assertIsNone(service.journal.load())

    def test_setup_rejects_ports_outside_the_documented_range(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = write_release(root / "release")
            _paths, _registry, _runtime, service = self.environment(root)
            with self.assertRaisesRegex(ContractError, "15173"):
                service.fresh_source(
                    release, username="administrator", password="a-secure-password",
                    timezone="UTC", public_port=15172,
                )

    def test_english_spanish_catalogs_have_exact_structural_parity(self) -> None:
        validate_catalogs()
        self.assertEqual(set(CATALOGS["en"]), set(CATALOGS["es"]))
        for state in ("checkpoint_required", "awaiting_checkpoint", "ready_stopped", "running_dirty", "stopped_dirty", "runtime_removed_data_retained", "recovery_required"):
            self.assertIn(f"state.{state}", CATALOGS["en"])


if __name__ == "__main__":
    unittest.main()
