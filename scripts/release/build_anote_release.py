#!/usr/bin/env python3
from __future__ import annotations

import argparse
from hashlib import sha256
import hmac
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONTROL_CENTER_SRC = REPOSITORY_ROOT / "control_center" / "src"
sys.path.insert(0, str(CONTROL_CENTER_SRC))

from anote_control_center.platform_paths import PlatformIdentity  # noqa: E402
from anote_control_center.image_archives import inspect_image_archive  # noqa: E402
from anote_control_center.releases import ReleaseVerifier, file_sha256  # noqa: E402


NODE_BASE_IMAGE = "node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0"
NGINX_BASE_IMAGE = "nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de"


def require_pinned_base(reference: str) -> str:
    if reference.count("@") != 1 or re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", reference) is None:
        raise RuntimeError("Every release base image must use one exact sha256 digest")
    return reference


def run(arguments: list[str], *, cwd: Path | None = None, binary: bool = False) -> bytes | str:
    completed = subprocess.run(
        arguments,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Command failed ({arguments[0]}): {message}")
    return completed.stdout if binary else completed.stdout.decode("utf-8", errors="strict").strip()


def pinned_reference(reference: str) -> str:
    raw = run(["docker", "buildx", "imagetools", "inspect", "--raw", reference], binary=True)
    assert isinstance(raw, bytes)
    if not raw:
        raise RuntimeError(f"Base image manifest is empty: {reference}")
    repository = reference.split("@", 1)[0].split(":", 1)[0] if "/" not in reference else reference.rsplit(":", 1)[0]
    return f"{repository}@sha256:{sha256(raw).hexdigest()}"


def platform_identity(value: str) -> PlatformIdentity:
    if value == "windows-amd64":
        return PlatformIdentity("windows", "x86_64")
    if value == "macos-arm64":
        return PlatformIdentity("macos", "arm64")
    raise ValueError("platform must be windows-amd64 or macos-arm64")


def inspect_image(reference: str, expected_architecture: str) -> dict[str, str]:
    raw = run(["docker", "image", "inspect", reference])
    assert isinstance(raw, str)
    value = json.loads(raw)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise RuntimeError(f"Image inspection is incomplete: {reference}")
    row = value[0]
    architecture = str(row.get("Architecture", "")).replace("x86_64", "amd64").replace("aarch64", "arm64")
    if row.get("Os") != "linux" or architecture != expected_architecture:
        raise RuntimeError(f"Image platform does not match release: {reference}")
    image_id = row.get("Id")
    if not isinstance(image_id, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is None:
        raise RuntimeError(f"Image identity is invalid: {reference}")
    return {"runtime_digest": image_id, "operating_system": "linux", "architecture": architecture}


def build_image(
    *,
    root: Path,
    containerfile: Path,
    reference: str,
    platform: PlatformIdentity,
    release_id: str,
    version: str,
    source_commit: str,
    base_arguments: dict[str, str],
) -> None:
    arguments = [
        "docker", "buildx", "build",
        "--platform", f"linux/{platform.container_architecture}",
        "--load",
        "--file", str(containerfile),
        "--tag", reference,
        "--build-arg", f"ANOTE_RELEASE_ID={release_id}",
        "--build-arg", f"ANOTE_RELEASE_VERSION={version}",
        "--build-arg", f"ANOTE_SOURCE_COMMIT={source_commit}",
    ]
    for key, value in sorted(base_arguments.items()):
        try:
            require_pinned_base(value)
        except RuntimeError as error:
            raise RuntimeError(f"Base image argument is not pinned: {key}") from error
        arguments.extend(("--build-arg", f"{key}={value}"))
    arguments.append(str(root))
    run(arguments, cwd=root)


def create_package(
    *,
    root: Path,
    output: Path,
    release_id: str,
    version: str,
    source_commit: str,
    platform: PlatformIdentity,
    minimum_control_center_version: str,
    minimum_upgradable_version: str,
    minimum_data_schema: int,
    maximum_data_schema: int,
    signing_key_file: Path | None,
    signing_key_id: str | None,
    node_base_image: str = NODE_BASE_IMAGE,
    nginx_base_image: str = NGINX_BASE_IMAGE,
) -> Path:
    if output.exists():
        raise RuntimeError(f"Output already exists: {output}")
    if output.suffix != ".anote-release":
        raise RuntimeError("Output must end in .anote-release")
    tag = f"{version}-{source_commit[:12]}-{platform.container_architecture}"
    references = {"api": f"anote-api:{tag}", "web": f"anote-web:{tag}"}
    require_pinned_base(node_base_image)
    require_pinned_base(nginx_base_image)
    release_dir = root / "control_center" / "release"
    build_image(
        root=root,
        containerfile=release_dir / "Containerfile.api",
        reference=references["api"],
        platform=platform,
        release_id=release_id,
        version=version,
        source_commit=source_commit,
        base_arguments={"NODE_BASE_IMAGE": node_base_image},
    )
    build_image(
        root=root,
        containerfile=release_dir / "Containerfile.web",
        reference=references["web"],
        platform=platform,
        release_id=release_id,
        version=version,
        source_commit=source_commit,
        base_arguments={"NODE_BASE_IMAGE": node_base_image, "NGINX_BASE_IMAGE": nginx_base_image},
    )

    with tempfile.TemporaryDirectory(prefix="anote-release-") as temporary_name:
        temporary = Path(temporary_name)
        image_archives: dict[str, Path] = {}
        image_rows: list[dict[str, object]] = []
        for role, reference in references.items():
            archive_path = temporary / f"{role}.tar"
            run(["docker", "image", "save", "--output", str(archive_path), reference])
            docker_identity = inspect_image(reference, platform.container_architecture)
            archive_identity = inspect_image_archive(
                archive_path,
                reference,
                operating_system="linux",
                architecture=platform.container_architecture,
            )
            if not archive_identity.accepts_runtime_digest(docker_identity["runtime_digest"]):
                raise RuntimeError("Docker inspection and exact image archive disagree")
            identity = {
                "config_digest": archive_identity.config_digest,
                "manifest_digest": archive_identity.manifest_digest,
                "load_digest": archive_identity.load_digest,
                "operating_system": archive_identity.operating_system,
                "architecture": archive_identity.architecture,
            }
            member = f"images/{role}.tar"
            image_archives[member] = archive_path
            image_rows.append({
                "role": role,
                "tag": reference,
                "archive_path": member,
                **identity,
            })

        compose = root / "control_center" / "src" / "anote_control_center" / "runtime" / "compose.yaml"
        gateway = root / "docker" / "nginx.conf"
        runtime_commands = temporary / "commands.json"
        runtime_commands.write_text(json.dumps({
            "schema_version": 1,
            "migrate": ["node", "migrate.js"],
            "bootstrap_admin": ["node", "bootstrap-admin.js"],
        }, sort_keys=True, separators=(",", ":")), encoding="utf-8")
        assets = {
            "runtime/compose.yaml": (compose, "compose_template"),
            "runtime/nginx.conf": (gateway, "gateway_template"),
            "runtime/commands.json": (runtime_commands, "runtime_commands"),
            "images/api.tar": (image_archives["images/api.tar"], "api_image"),
            "images/web.tar": (image_archives["images/web.tar"], "web_image"),
        }
        file_rows = [
            {
                "path": member,
                "role": role,
                "size": path.stat().st_size,
                "sha256": file_sha256(path),
            }
            for member, (path, role) in assets.items()
        ]
        manifest = {
            "kind": "anote-release",
            "schema_version": 1,
            "release": {
                "id": release_id,
                "version": version,
                "source_commit": source_commit,
                "minimum_control_center_version": minimum_control_center_version,
                "minimum_installed_version": minimum_upgradable_version,
                "minimum_data_schema": minimum_data_schema,
                "maximum_data_schema": maximum_data_schema,
            },
            "platform": {
                "host_os": platform.host_os,
                "host_arch": platform.host_architecture,
                "container_os": platform.container_os,
                "container_arch": platform.container_architecture,
            },
            "prerequisites": {"docker_engine": "23.0", "docker_compose": "2.20"},
            "files": file_rows,
            "images": image_rows,
            "publication": {"signing_policy": "signed" if signing_key_file is not None else "unsigned-disclosed"},
        }
        manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
        signature_bytes: bytes | None = None
        signing_keys: dict[str, bytes] = {}
        if (signing_key_file is None) != (signing_key_id is None):
            raise RuntimeError("Provide both --signing-key-file and --signing-key-id")
        if signing_key_file is not None and signing_key_id is not None:
            key = signing_key_file.read_bytes()
            if len(key) < 32:
                raise RuntimeError("Signing key must contain at least 32 bytes")
            signing_keys[signing_key_id] = key
            signature_bytes = json.dumps({
                "schema_version": 1,
                "algorithm": "hmac-sha256",
                "key_id": signing_key_id,
                "manifest_sha256": sha256(manifest_bytes).hexdigest(),
                "signature": hmac.new(key, manifest_bytes, sha256).hexdigest(),
            }, sort_keys=True, separators=(",", ":")).encode("utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            if signature_bytes is not None:
                archive.writestr("signature.json", signature_bytes)
            for member, (path, _role) in assets.items():
                archive.write(path, member)

    with tempfile.TemporaryDirectory(prefix="anote-release-verify-") as verification_root:
        verifier = ReleaseVerifier(
            platform=platform,
            cache_root=Path(verification_root) / "verified",
            signing_keys=signing_keys,
            require_signed=bool(signing_keys),
        )
        verifier.verify(output)
    return output


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Build one offline Anote application release package.")
    value.add_argument("--repo-root", type=Path, default=REPOSITORY_ROOT)
    value.add_argument("--release-id", default="anote")
    value.add_argument("--version", required=True)
    value.add_argument("--source-commit")
    value.add_argument("--host-platform", required=True, choices=("windows-amd64", "macos-arm64"))
    value.add_argument("--output", type=Path)
    value.add_argument("--minimum-control-center-version", default="0.1.9")
    value.add_argument("--minimum-upgradable-version", default="0.0.0")
    value.add_argument("--minimum-data-schema", type=int, default=0)
    value.add_argument("--maximum-data-schema", type=int, default=6)
    value.add_argument("--signing-key-file", type=Path)
    value.add_argument("--signing-key-id")
    value.add_argument("--node-base-image", default=NODE_BASE_IMAGE)
    value.add_argument("--nginx-base-image", default=NGINX_BASE_IMAGE)
    return value


def main(arguments: list[str] | None = None) -> int:
    options = parser().parse_args(arguments)
    root = options.repo_root.resolve(strict=True)
    head_commit = str(run(["git", "rev-parse", "HEAD"], cwd=root))
    source_commit = options.source_commit or head_commit
    if re.fullmatch(r"[0-9a-f]{40}", source_commit) is None:
        raise RuntimeError("Source commit must be a full Git SHA")
    if source_commit != head_commit:
        raise RuntimeError("Release source commit must equal the exact checked-out HEAD")
    status = str(run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=root))
    if status:
        raise RuntimeError("Application releases require a clean worktree")
    platform = platform_identity(options.host_platform)
    output = options.output or root / "dist" / f"anote-{options.version}-{options.host_platform}.anote-release"
    created = create_package(
        root=root,
        output=output,
        release_id=options.release_id,
        version=options.version,
        source_commit=source_commit,
        platform=platform,
        minimum_control_center_version=options.minimum_control_center_version,
        minimum_upgradable_version=options.minimum_upgradable_version,
        minimum_data_schema=options.minimum_data_schema,
        maximum_data_schema=options.maximum_data_schema,
        signing_key_file=options.signing_key_file,
        signing_key_id=options.signing_key_id,
        node_base_image=options.node_base_image,
        nginx_base_image=options.nginx_base_image,
    )
    print(created)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
