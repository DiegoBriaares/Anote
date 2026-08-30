from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from anote_control_center.errors import ContractError
from anote_control_center.model import ALLOWED_TRANSITIONS, Installation
from anote_control_center.platform_paths import ManagedPaths
from anote_control_center.storage import InstallationRegistry, OperationJournal, OperationLock, OperationRecord


def installation(state: str = "checkpoint_required", role: str = "source") -> Installation:
    lineage = state in {"ready_stopped", "running_dirty", "stopped_dirty"}
    return Installation(
        "a" * 32, role, state, "anote", "1.0.0", "b" * 40, "c" * 64,
        "anote-api:test", "sha256:" + "e" * 64, "anote-web:test", "sha256:" + "f" * 64,
        "macos", "arm64", "arm64", 15173, "America/Mexico_City", "127.0.0.1",
        "anote-aaaaaaaaaaaa", 1,
        ("production", "backups", "checkpoints", "releases", "logs", "operations"),
        "d" * 32 if lineage else None, None, 1 if lineage else 0, 100, 100,
        "cp-1" if lineage else None,
    )


class ModelStorageTests(unittest.TestCase):
    def test_transition_table_accepts_exactly_declared_edges(self) -> None:
        for source, allowed in ALLOWED_TRANSITIONS.items():
            role = "standby" if source == "awaiting_checkpoint" else "source"
            if source == "runtime_removed_data_retained":
                value = replace(installation(), state=source, retained_data=True, retained_resume_state="checkpoint_required")
            elif source == "recovery_required":
                value = replace(installation(), state=source)
            else:
                value = installation(source, role)
            for target in ALLOWED_TRANSITIONS:
                changes: dict[str, object] = {}
                if target == "runtime_removed_data_retained":
                    changes = {"retained_data": True, "retained_resume_state": "checkpoint_required"}
                if source == "runtime_removed_data_retained" and target != source:
                    changes.update({"retained_data": False, "retained_resume_state": None})
                if target == "awaiting_checkpoint":
                    changes["role"] = "standby"
                elif target in {"checkpoint_required", "running_dirty"}:
                    changes["role"] = "source"
                if target in {"ready_stopped", "running_dirty", "stopped_dirty"} and value.checkpoint_sequence == 0:
                    changes.update({
                        "dataset_id": "d" * 32,
                        "last_checkpoint_id": "cp-1",
                        "checkpoint_sequence": 1,
                    })
                if target in allowed or target == source:
                    value.transition(target, now=101, **changes)
                else:
                    with self.assertRaises(ContractError):
                        value.transition(target, now=101, **changes)

    def test_registry_round_trip_and_exact_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = ManagedPaths(Path(directory) / "state")
            registry = InstallationRegistry(paths)
            expected = installation()
            registry.save(expected)
            self.assertEqual(expected, registry.load())
            text = paths.registry.read_text(encoding="utf-8").replace('"state": "checkpoint_required"', '"unknown": 1, "state": "checkpoint_required"')
            paths.registry.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "fields"):
                registry.load()

    def test_journal_rejects_secret_material(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            journal = OperationJournal(ManagedPaths(Path(directory) / "state"))
            with self.assertRaisesRegex(ContractError, "Secrets"):
                journal.save(OperationRecord("op", "setup", "start", None, 100, {"password_value": "never"}))
            with self.assertRaisesRegex(ContractError, "Secrets"):
                journal.save(OperationRecord("op", "setup", "start", None, 100, {"release": "password=never"}))
            with self.assertRaisesRegex(ContractError, "undeclared"):
                journal.save(OperationRecord("op", "setup", "start", None, 100, {"arbitrary": "value"}))

    def test_single_operation_lock_refuses_a_live_second_writer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = ManagedPaths(Path(directory) / "state")
            with OperationLock(paths):
                with self.assertRaisesRegex(ContractError, "Another"):
                    with OperationLock(paths):
                        self.fail("unreachable")

    def test_managed_root_refuses_a_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            link = root / "link"
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(ContractError, "link"):
                ManagedPaths(link)

    def test_intermediate_managed_link_is_rejected_before_registry_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ManagedPaths(root / "state")
            paths.root.mkdir()
            outside = root / "outside"
            outside.mkdir()
            (paths.root / "registry").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ContractError, "link"):
                InstallationRegistry(paths).save(installation())
            self.assertEqual([], list(outside.iterdir()))


if __name__ == "__main__":
    unittest.main()
