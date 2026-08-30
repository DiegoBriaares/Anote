from __future__ import annotations

from dataclasses import replace
import io
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
import zipfile

from anote_control_center.checkpoints import CheckpointService, SnapshotService, extract_upload_archive
from anote_control_center.errors import ContractError
from anote_control_center.model import Installation
from anote_control_center.platform_paths import ManagedPaths
from anote_control_center.storage import InstallationRegistry

from helpers import write_release


OWNED = ("production", "backups", "checkpoints", "releases", "logs", "operations")


def install(role: str, state: str, *, installation_id: str, sequence: int = 0) -> Installation:
    has_checkpoint = sequence > 0
    return Installation(
        installation_id, role, state, "anote", "1.0.0", "a" * 40, "b" * 64,
        "anote-api:test", "sha256:" + "e" * 64, "anote-web:test", "sha256:" + "f" * 64,
        "macos", "arm64", "arm64", 15173, "UTC", "127.0.0.1",
        f"anote-{installation_id[:12]}", 1, OWNED,
        "d" * 32 if has_checkpoint else None,
        None,
        sequence,
        100,
        100,
        "cp-previous" if has_checkpoint else None,
    )


def create_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            "CREATE TABLE events(id INTEGER PRIMARY KEY, title TEXT);"
            "INSERT INTO events(title) VALUES ('protected');"
            "CREATE TABLE sessions(id TEXT PRIMARY KEY);"
            "INSERT INTO sessions VALUES ('local-session');"
        )
        connection.commit()
    finally:
        connection.close()


class CheckpointTests(unittest.TestCase):
    def test_checkpoint_refuses_a_runtime_that_is_not_proven_stopped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ManagedPaths(root / "source")
            registry = InstallationRegistry(paths)
            registry.save(install("source", "checkpoint_required", installation_id="1" * 32))
            create_database(paths.database)
            destination = root / "blocked.anote-checkpoint"
            with self.assertRaisesRegex(ContractError, "Docker still reports"):
                CheckpointService(paths, registry).create(
                    destination, prove_stopped=lambda _installation: False,
                )
            self.assertFalse(destination.exists())

    def test_snapshot_restore_verifies_receipt_before_mutating_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = ManagedPaths(Path(directory) / "state")
            create_database(paths.database)
            service = SnapshotService(paths, clock=lambda: 200)
            backup = service.create("before")
            original = paths.database.read_bytes()
            backup.uploads_archive.write_bytes(b"tampered")
            with self.assertRaisesRegex(ContractError, "receipt"):
                service.restore(backup)
            self.assertEqual(original, paths.database.read_bytes())

    def test_checkpoint_is_portable_sanitized_and_round_trips_to_standby(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_paths = ManagedPaths(root / "source")
            source_registry = InstallationRegistry(source_paths)
            source_registry.save(install("source", "checkpoint_required", installation_id="1" * 32))
            create_database(source_paths.database)
            source_paths.uploads.mkdir(parents=True)
            (source_paths.uploads / "note.txt").write_text("attachment", encoding="utf-8")
            destination = root / "baseline.anote-checkpoint"
            checkpoint = CheckpointService(source_paths, source_registry, clock=lambda: 200).create(
                destination, prove_stopped=lambda _installation: True,
            )
            self.assertEqual({"manifest.json", "calendar.db", "uploads.tar"}, set(zipfile.ZipFile(destination).namelist()))
            with zipfile.ZipFile(destination) as archive, tempfile.NamedTemporaryFile(suffix=".db") as database:
                database.write(archive.read("calendar.db"))
                database.flush()
                connection = sqlite3.connect(database.name)
                try:
                    self.assertEqual(0, connection.execute("SELECT count(*) FROM sessions").fetchone()[0])
                    self.assertEqual("protected", connection.execute("SELECT title FROM events").fetchone()[0])
                finally:
                    connection.close()

            standby_paths = ManagedPaths(root / "standby")
            standby_registry = InstallationRegistry(standby_paths)
            standby_registry.save(install("standby", "awaiting_checkpoint", installation_id="2" * 32))
            release = write_release(root / "release")
            applied = CheckpointService(standby_paths, standby_registry, clock=lambda: 300).apply(
                checkpoint,
                release.manifest,
            )
            self.assertEqual("ready_stopped", applied.state)
            self.assertEqual(checkpoint.manifest.checkpoint_id, applied.last_checkpoint_id)
            self.assertEqual("attachment", (standby_paths.uploads / "note.txt").read_text(encoding="utf-8"))

    def test_apply_rolls_data_back_when_validation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_paths = ManagedPaths(root / "source")
            source_registry = InstallationRegistry(source_paths)
            source_registry.save(install("source", "checkpoint_required", installation_id="1" * 32))
            create_database(source_paths.database)
            checkpoint = CheckpointService(source_paths, source_registry, clock=lambda: 200).create(
                root / "transfer.anote-checkpoint", prove_stopped=lambda _installation: True,
            )

            standby_paths = ManagedPaths(root / "standby")
            standby_registry = InstallationRegistry(standby_paths)
            original = install("standby", "awaiting_checkpoint", installation_id="2" * 32)
            standby_registry.save(original)
            create_database(standby_paths.database)
            connection = sqlite3.connect(standby_paths.database)
            connection.execute("UPDATE events SET title = 'original'")
            connection.commit()
            connection.close()
            release = write_release(root / "release")
            with self.assertRaisesRegex(RuntimeError, "injected"):
                CheckpointService(standby_paths, standby_registry, clock=lambda: 300).apply(
                    checkpoint,
                    release.manifest,
                    validate=lambda _installation: (_ for _ in ()).throw(RuntimeError("injected")),
                )
            connection = sqlite3.connect(standby_paths.database)
            try:
                self.assertEqual("original", connection.execute("SELECT title FROM events").fetchone()[0])
            finally:
                connection.close()
            self.assertEqual(original, standby_registry.load())

    def test_same_installation_and_non_child_lineage_require_explicit_intent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ManagedPaths(root / "source")
            registry = InstallationRegistry(paths)
            source = install("source", "checkpoint_required", installation_id="1" * 32)
            registry.save(source)
            create_database(paths.database)
            checkpoint = CheckpointService(paths, registry, clock=lambda: 200).create(
                root / "transfer.anote-checkpoint", prove_stopped=lambda _installation: True,
            )
            registry.save(replace(registry.load(), role="standby"))  # type: ignore[arg-type]
            with self.assertRaisesRegex(ContractError, "own source"):
                CheckpointService(paths, registry).apply(checkpoint, write_release(root / "release").manifest)

    def test_upload_tar_traversal_is_rejected_without_writing_outside(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "bad.tar"
            with tarfile.open(archive_path, "w") as archive:
                payload = b"escape"
                info = tarfile.TarInfo("../escape.txt")
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            with self.assertRaisesRegex(ContractError, "unsafe"):
                extract_upload_archive(archive_path, root / "target")
            self.assertFalse((root / "escape.txt").exists())


if __name__ == "__main__":
    unittest.main()
