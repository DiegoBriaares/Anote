#!/usr/bin/env python3
"""Exercise every material Control Center workflow against disposable Docker state."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import tempfile
from urllib.request import urlopen

from anote_control_center.application import load_application
from anote_control_center.errors import RuntimeCommandError
from anote_control_center.lifecycle import ERASE_CONFIRMATION


ACKNOWLEDGEMENT = "ERASE DISPOSABLE ANOTE"
WORK_PREFIX = "anote-control-center-acceptance-"


def emit(phase: str, **details: object) -> None:
    print(json.dumps({"phase": phase, **details}, sort_keys=True), flush=True)


def require_safe_work_root(path: Path) -> Path:
    root = path.expanduser().resolve(strict=False)
    temporary = Path(tempfile.gettempdir()).resolve()
    if root.parent != temporary or not root.name.startswith(WORK_PREFIX) or root.is_symlink():
        raise SystemExit(f"--work-root must be a direct {temporary}/{WORK_PREFIX}* child")
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise SystemExit("--work-root must not exist or must be an empty directory")
    root.mkdir(mode=0o700, parents=False, exist_ok=True)
    return root


def smoke(port: int, version: str) -> None:
    with urlopen(f"http://127.0.0.1:{port}/", timeout=20) as response:
        assert response.status == 200
    with urlopen(f"http://127.0.0.1:{port}/api/health/ready", timeout=20) as response:
        ready = json.load(response)
    assert ready["status"] == "ready", ready
    assert ready["data"]["releaseId"] == "anote", ready
    assert ready["data"]["version"] == version, ready
    assert ready["data"]["schemaVersion"] >= 1, ready


def checkpoint(application: object, destination: Path) -> Path:
    application.lifecycle.create_checkpoint(destination)  # type: ignore[attr-defined]
    return destination


def start_smoke_stop(application: object, version: str) -> None:
    started = application.lifecycle.start(confirm_exclusive=True)  # type: ignore[attr-defined]
    smoke(started.public_port, version)
    application.lifecycle.stop()  # type: ignore[attr-defined]


def erase(application: object) -> None:
    application.lifecycle.erase_all(ERASE_CONFIRMATION)  # type: ignore[attr-defined]
    assert application.registry.load() is None  # type: ignore[attr-defined]


def run(args: argparse.Namespace) -> None:
    if args.acknowledge_ephemeral_destruction != ACKNOWLEDGEMENT:
        raise SystemExit(f"Pass --acknowledge-ephemeral-destruction '{ACKNOWLEDGEMENT}'")
    root = require_safe_work_root(args.work_root)
    exchange = root / "exchange"
    exchange.mkdir(mode=0o700)
    source = load_application(state_root=root / "source")
    standby = load_application(state_root=root / "standby")
    updater = load_application(state_root=root / "update")
    current = source.verify_release(args.current_release.resolve(strict=True))
    previous = updater.verify_release(args.previous_release.resolve(strict=True))
    if current.manifest.version == previous.manifest.version:
        raise SystemExit("Current and previous releases must have different versions")

    try:
        # Fresh source, explicit start/stop, checkpoint, safe uninstall and retained reinstall.
        installed = source.lifecycle.fresh_source(
            current,
            username="acceptance-admin",
            password="acceptance-password-2026",
            timezone=args.timezone,
        )
        checkpoint(source, exchange / "fresh.anote-checkpoint")
        start_smoke_stop(source, current.manifest.version)
        checkpoint(source, exchange / "after-start.anote-checkpoint")
        retained = source.lifecycle.safe_uninstall(current)
        assert retained.state == "runtime_removed_data_retained"
        source.lifecycle.reinstall_retained(current)
        start_smoke_stop(source, current.manifest.version)
        transfer = checkpoint(source, exchange / "transfer.anote-checkpoint")
        emit("fresh-retained", project=installed.project_name)

        # Convert only this disposable managed runtime into a faithful legacy fixture and adopt it.
        legacy = source.lifecycle.start(confirm_exclusive=True)
        source.paths.registry.unlink()
        adopter = load_application(state_root=root / "source")
        adopted = adopter.lifecycle.adopt_legacy(
            adopter.verify_release(args.current_release),
            timezone=args.timezone,
            project_name=legacy.project_name,
        )
        assert adopted.state == "checkpoint_required" and adopted.project_name != legacy.project_name
        transfer = checkpoint(adopter, exchange / "adopted.anote-checkpoint")
        erase(adopter)
        emit("legacy-adoption", old_project=legacy.project_name, new_project=adopted.project_name)

        # Prepare/apply/promote an independent standby and prove the same-origin application.
        standby_release = standby.verify_release(args.current_release)
        prepared = standby.lifecycle.prepare_standby(standby_release, timezone=args.timezone)
        assert prepared.state == "awaiting_checkpoint"
        applied = standby.lifecycle.apply_checkpoint(standby.lifecycle.checkpoints.verify(transfer), standby_release)
        assert applied.role == "standby" and applied.state == "ready_stopped"
        start_smoke_stop(standby, current.manifest.version)
        checkpoint(standby, exchange / "standby-final.anote-checkpoint")
        erase(standby)
        emit("standby-transfer")

        # Prove a failed real update restores the exact previous stopped installation.
        old = updater.lifecycle.fresh_source(
            previous,
            username="acceptance-admin",
            password="acceptance-password-2026",
            timezone=args.timezone,
        )
        checkpoint(updater, exchange / "previous.anote-checkpoint")
        original_up = updater.runtime.up
        fail_once = True

        def injected_up(installation: object, *up_args: object, **up_kwargs: object) -> object:
            nonlocal fail_once
            if fail_once and getattr(installation, "version") == current.manifest.version:
                fail_once = False
                raise RuntimeCommandError("Acceptance failure injection.", code="acceptance_injected")
            return original_up(installation, *up_args, **up_kwargs)

        updater.runtime.up = injected_up  # type: ignore[method-assign]
        try:
            updater.lifecycle.update(updater.verify_release(args.current_release))
            raise AssertionError("Injected update unexpectedly succeeded")
        except RuntimeCommandError as error:
            assert error.code == "acceptance_injected"
        finally:
            updater.runtime.up = original_up  # type: ignore[method-assign]
        restored = updater.registry.load()
        assert restored is not None and restored.version == old.version and restored.state == "ready_stopped"
        start_smoke_stop(updater, previous.manifest.version)
        checkpoint(updater, exchange / "rollback-restored.anote-checkpoint")
        updated = updater.lifecycle.update(updater.verify_release(args.current_release))
        assert updated.version == current.manifest.version and updated.state == "checkpoint_required"
        checkpoint(updater, exchange / "updated.anote-checkpoint")
        start_smoke_stop(updater, current.manifest.version)
        checkpoint(updater, exchange / "updated-final.anote-checkpoint")
        erase(updater)
        emit("update-rollback-and-success", previous=old.version, current=updated.version)
    except Exception:
        emit("failed", work_root=str(root))
        raise
    else:
        shutil.rmtree(root)
        emit("complete", cleaned=True)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--current-release", required=True, type=Path)
    result.add_argument("--previous-release", required=True, type=Path)
    result.add_argument("--work-root", required=True, type=Path)
    result.add_argument("--timezone", default="America/Mexico_City")
    result.add_argument("--acknowledge-ephemeral-destruction", required=True)
    return result


if __name__ == "__main__":
    run(parser().parse_args())
