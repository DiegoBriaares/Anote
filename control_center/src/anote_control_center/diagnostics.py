from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import time

from . import __version__
from .docker_runtime import DockerRuntime
from .errors import ControlCenterError
from .platform_paths import ManagedPaths, PlatformIdentity
from .releases import ReleaseCandidate
from .storage import InstallationRegistry, OperationJournal


def build_diagnostics(
    *,
    paths: ManagedPaths,
    platform: PlatformIdentity,
    registry: InstallationRegistry,
    journal: OperationJournal,
    candidates: tuple[ReleaseCandidate, ...],
    runtime: DockerRuntime,
) -> str:
    installation = registry.load()
    pending = journal.load()
    docker_status = "ready"
    docker_error_code = None
    try:
        runtime.require_ready()
    except ControlCenterError as error:
        docker_status = "unavailable"
        docker_error_code = error.code
    except Exception:
        docker_status = "unavailable"
        docker_error_code = "docker_command_failed"
    payload: dict[str, object] = {
        "schema": 1,
        "generated_at": int(time.time()),
        "control_center_version": __version__,
        "platform": asdict(platform),
        "managed_root": "<ANOTE_ROOT>",
        "docker": docker_status,
        "docker_error_code": docker_error_code,
        "installation": None,
        "pending_operation": None,
        "release_candidates": [
            {
                "name": "<release-package>",
                "status": "verified" if candidate.release else "rejected",
                "error_code": candidate.error_code,
                "release_id": candidate.release.manifest.release_id if candidate.release else None,
                "version": candidate.release.manifest.version if candidate.release else None,
                "signed": candidate.release.signed if candidate.release else None,
            }
            for candidate in candidates
        ],
    }
    if installation is not None:
        payload["installation"] = {
            "installation_id": installation.installation_id,
            "role": installation.role,
            "state": installation.state,
            "release_id": installation.release_id,
            "version": installation.version,
            "source_commit": installation.source_commit,
            "host_os": installation.host_os,
            "host_architecture": installation.host_architecture,
            "container_architecture": installation.container_architecture,
            "public_port": installation.public_port,
            "data_schema": installation.data_schema,
            "last_checkpoint_id": installation.last_checkpoint_id,
            "retained_data": installation.retained_data,
        }
    if pending is not None:
        payload["pending_operation"] = {
            "operation_id": pending.operation_id,
            "kind": pending.kind,
            "phase": pending.phase,
            "installation_id": pending.installation_id,
            "started_at": pending.started_at,
        }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def save_diagnostics(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
