from __future__ import annotations

from dataclasses import replace
from hashlib import sha256
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
from typing import Callable
import unittest
from unittest.mock import patch
import zipfile

from anote_control_center.checkpoints import (
    CheckpointService,
    SnapshotService,
    create_upload_archive,
    extract_upload_archive,
)
from anote_control_center.errors import ContractError
from anote_control_center.model import Installation
from anote_control_center.platform_paths import ManagedPaths, is_link_or_junction
from anote_control_center.storage import InstallationRegistry, OperationJournal

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
            "CREATE TABLE schema_migrations("
            "version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT, checksum TEXT);"
            "INSERT INTO schema_migrations VALUES (1, 'test', 'now', 'digest');"
            "CREATE TABLE events(id INTEGER PRIMARY KEY, title TEXT);"
            "INSERT INTO events(title) VALUES ('protected');"
            "CREATE TABLE sessions(id TEXT PRIMARY KEY);"
            "INSERT INTO sessions VALUES ('local-session');"
            "CREATE TABLE legacy_event_note_recovery("
            "id TEXT PRIMARY KEY, source_content, state TEXT NOT NULL);"
            "INSERT INTO legacy_event_note_recovery VALUES ("
            "'legacy-note-1', X'006F727068616E', 'unresolved');"
        )
        connection.commit()
    finally:
        connection.close()


def rewrite_checkpoint_database(source: Path, destination: Path, mutate: Callable[[Path], None]) -> None:
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        uploads = archive.read("uploads.tar")
        database_bytes = archive.read("calendar.db")
    with tempfile.TemporaryDirectory() as directory:
        database = Path(directory) / "calendar.db"
        database.write_bytes(database_bytes)
        mutate(database)
        rewritten = database.read_bytes()
    manifest["database_size"] = len(rewritten)
    manifest["database_sha256"] = sha256(rewritten).hexdigest()
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8"),
        )
        archive.writestr("calendar.db", rewritten)
        archive.writestr("uploads.tar", uploads)


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

    def test_verifier_rejects_logically_valid_package_with_private_sessions_or_corrupt_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = ManagedPaths(root / "source")
            registry = InstallationRegistry(paths)
            registry.save(install("source", "checkpoint_required", installation_id="1" * 32))
            create_database(paths.database)
            checkpoint = CheckpointService(paths, registry, clock=lambda: 200).create(
                root / "baseline.anote-checkpoint", prove_stopped=lambda _installation: True,
            )

            def add_session(database: Path) -> None:
                connection = sqlite3.connect(database)
                connection.execute("INSERT INTO sessions VALUES ('portable-session-leak')")
                connection.commit()
                connection.close()

            private = root / "private.anote-checkpoint"
            rewrite_checkpoint_database(checkpoint.path, private, add_session)
            with self.assertRaisesRegex(ContractError, "sessions"):
                CheckpointService(paths, registry).verify(private)

            def corrupt(database: Path) -> None:
                database.write_bytes(b"not a SQLite database")

            corrupt_package = root / "corrupt.anote-checkpoint"
            rewrite_checkpoint_database(checkpoint.path, corrupt_package, corrupt)
            with self.assertRaisesRegex(ContractError, "database"):
                CheckpointService(paths, registry).verify(corrupt_package)

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
            with zipfile.ZipFile(destination) as archive, tempfile.TemporaryDirectory() as database_directory:
                sanitized_database = archive.read("calendar.db")
                self.assertNotIn(b"local-session", sanitized_database)
                database = Path(database_directory) / "calendar.db"
                database.write_bytes(sanitized_database)
                connection = sqlite3.connect(database)
                try:
                    self.assertEqual(0, connection.execute("SELECT count(*) FROM sessions").fetchone()[0])
                    self.assertEqual("protected", connection.execute("SELECT title FROM events").fetchone()[0])
                    recovery = connection.execute(
                        "SELECT typeof(source_content), hex(source_content), state "
                        "FROM legacy_event_note_recovery"
                    ).fetchone()
                    self.assertEqual(("blob", "006F727068616E", "unresolved"), recovery)
                finally:
                    connection.close()

            standby_paths = ManagedPaths(root / "standby")
            standby_registry = InstallationRegistry(standby_paths)
            standby_registry.save(install("standby", "awaiting_checkpoint", installation_id="2" * 32))
            release = write_release(root / "release")
            applied = CheckpointService(standby_paths, standby_registry, clock=lambda: 300).apply(
                checkpoint,
                release.manifest,
                prove_stopped=lambda _installation: True,
            )
            self.assertEqual("ready_stopped", applied.state)
            self.assertEqual(checkpoint.manifest.checkpoint_id, applied.last_checkpoint_id)
            self.assertEqual("attachment", (standby_paths.uploads / "note.txt").read_text(encoding="utf-8"))
            connection = sqlite3.connect(standby_paths.database)
            try:
                self.assertEqual(
                    ("blob", "006F727068616E", "unresolved"),
                    connection.execute(
                        "SELECT typeof(source_content), hex(source_content), state "
                        "FROM legacy_event_note_recovery"
                    ).fetchone(),
                )
            finally:
                connection.close()

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
                    prove_stopped=lambda _installation: True,
                    validate=lambda _installation: (_ for _ in ()).throw(RuntimeError("injected")),
                )
            connection = sqlite3.connect(standby_paths.database)
            try:
                self.assertEqual("original", connection.execute("SELECT title FROM events").fetchone()[0])
            finally:
                connection.close()
            self.assertEqual(original, standby_registry.load())

    def test_apply_journals_checkpoint_staging_before_copying_package(self) -> None:
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
            standby_registry.save(install("standby", "awaiting_checkpoint", installation_id="2" * 32))
            journal = OperationJournal(standby_paths)

            def interrupt_copy(_checkpoint: object, destination: Path) -> None:
                record = journal.load()
                self.assertIsNotNone(record)
                self.assertEqual(destination.name, record.details["checkpoint_staging_name"])  # type: ignore[union-attr]
                raise RuntimeError("injected staging failure")

            with (
                patch("anote_control_center.checkpoints.stage_verified_checkpoint", side_effect=interrupt_copy),
                self.assertRaisesRegex(RuntimeError, "staging failure"),
            ):
                CheckpointService(standby_paths, standby_registry, clock=lambda: 300).apply(
                    checkpoint,
                    write_release(root / "release").manifest,
                    prove_stopped=lambda _installation: True,
                )
            self.assertEqual("recovery_required", journal.load().phase)  # type: ignore[union-attr]
            self.assertEqual([], list(standby_paths.production.glob("checkpoint.package-*")))

    def test_apply_refuses_an_externally_running_standby_without_mutation(self) -> None:
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
            original_installation = install("standby", "awaiting_checkpoint", installation_id="2" * 32)
            standby_registry.save(original_installation)
            create_database(standby_paths.database)
            original_database = standby_paths.database.read_bytes()
            with self.assertRaisesRegex(ContractError, "Docker still reports"):
                CheckpointService(standby_paths, standby_registry).apply(
                    checkpoint,
                    write_release(root / "release").manifest,
                    prove_stopped=lambda _installation: False,
                )
            self.assertEqual(original_installation, standby_registry.load())
            self.assertEqual(original_database, standby_paths.database.read_bytes())
            self.assertIsNone(OperationJournal(standby_paths).load())

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
                CheckpointService(paths, registry).apply(
                    checkpoint,
                    write_release(root / "release").manifest,
                    prove_stopped=lambda _installation: True,
                )

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

    def test_upload_archive_rejects_a_nested_link_or_windows_reparse_point(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uploads = root / "uploads"
            nested = uploads / "junction"
            nested.mkdir(parents=True)
            (nested / "outside.txt").write_text("must not archive", encoding="utf-8")
            with patch(
                "anote_control_center.checkpoints.is_link_or_junction",
                side_effect=lambda path: path == nested or is_link_or_junction(path),
            ):
                with self.assertRaisesRegex(ContractError, "links and junctions"):
                    create_upload_archive(uploads, root / "uploads.tar")
            self.assertFalse((root / "uploads.tar").exists())


if __name__ == "__main__":
    unittest.main()
