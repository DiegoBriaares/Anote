#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "control_center" / "src"))

from anote_control_center.platform_paths import PlatformIdentity  # noqa: E402
from anote_control_center.releases import ReleaseVerifier, VerifiedRelease  # noqa: E402


def _verify(
    path: Path,
    platform: PlatformIdentity,
    cache: Path,
    signing_keys: dict[str, bytes],
) -> VerifiedRelease:
    return ReleaseVerifier(
        platform=platform,
        cache_root=cache,
        signing_keys=signing_keys,
        require_signed=bool(signing_keys),
    ).verify(path)


def verify_pair(
    amd64_path: Path,
    arm64_path: Path,
    *,
    signing_keys: dict[str, bytes] | None = None,
) -> dict[str, object]:
    keys = signing_keys or {}
    with tempfile.TemporaryDirectory(prefix="anote-pair-") as directory:
        root = Path(directory)
        amd64 = _verify(amd64_path, PlatformIdentity("windows", "x86_64"), root / "amd64", keys)
        arm64 = _verify(arm64_path, PlatformIdentity("macos", "arm64"), root / "arm64", keys)
    left = amd64.manifest
    right = arm64.manifest
    logical_left = (
        left.release_id, left.version, left.source_commit, left.minimum_control_center_version,
        left.minimum_installed_version, left.minimum_data_schema, left.maximum_data_schema,
        left.minimum_docker_engine, left.minimum_docker_compose,
    )
    logical_right = (
        right.release_id, right.version, right.source_commit, right.minimum_control_center_version,
        right.minimum_installed_version, right.minimum_data_schema, right.maximum_data_schema,
        right.minimum_docker_engine, right.minimum_docker_compose,
    )
    if logical_left != logical_right:
        raise RuntimeError("Native packages do not share one logical release contract")
    if amd64.commands != arm64.commands:
        raise RuntimeError("Native packages declare different offline lifecycle commands")
    stable_roles = {"compose_template", "gateway_template", "runtime_commands"}
    stable_left = {item.role: (item.path, item.sha256) for item in left.files if item.role in stable_roles}
    stable_right = {item.role: (item.path, item.sha256) for item in right.files if item.role in stable_roles}
    if stable_left != stable_right:
        raise RuntimeError("Native packages contain different runtime contracts")
    if (amd64.signed, amd64.signer_key_id) != (arm64.signed, arm64.signer_key_id):
        raise RuntimeError("Native packages have inconsistent signing disclosure")
    return {
        "release_id": left.release_id,
        "version": left.version,
        "source_commit": left.source_commit,
        "packages": {
            "linux/amd64": amd64.package_sha256,
            "linux/arm64": arm64.package_sha256,
        },
        "images": {
            "linux/amd64": {image.role: image.config_digest for image in left.images},
            "linux/arm64": {image.role: image.config_digest for image in right.images},
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the two native packages for one Anote release.")
    parser.add_argument("--amd64", type=Path, required=True)
    parser.add_argument("--arm64", type=Path, required=True)
    parser.add_argument("--signing-key-file", type=Path)
    parser.add_argument("--signing-key-id")
    arguments = parser.parse_args()
    if (arguments.signing_key_file is None) != (arguments.signing_key_id is None):
        parser.error("provide both --signing-key-file and --signing-key-id")
    keys = {}
    if arguments.signing_key_file is not None:
        key = arguments.signing_key_file.read_bytes()
        if len(key) < 32:
            parser.error("signing key must contain at least 32 bytes")
        keys[arguments.signing_key_id] = key
    print(json.dumps(verify_pair(arguments.amd64, arguments.arm64, signing_keys=keys), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
