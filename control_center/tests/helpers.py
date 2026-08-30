from __future__ import annotations

from hashlib import sha256
import io
import json
from pathlib import Path
import tarfile
import zipfile

from anote_control_center.platform_paths import PlatformIdentity
from anote_control_center.releases import ReleaseVerifier, VerifiedRelease


MAC = PlatformIdentity("macos", "arm64")
WINDOWS = PlatformIdentity("windows", "x86_64")


def docker_archive(
    tag: str,
    architecture: str = "arm64",
    *,
    nested_index: bool = False,
    invalid_attestation_reference: bool = False,
) -> tuple[bytes, str, str, str]:
    config = json.dumps({"architecture": architecture, "os": "linux"}, sort_keys=True).encode()
    config_hash = sha256(config).hexdigest()
    config_digest = f"sha256:{config_hash}"
    config_name = f"blobs/sha256/{config_hash}"
    image_manifest = json.dumps({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": {
            "mediaType": "application/vnd.oci.image.config.v1+json",
            "digest": config_digest,
            "size": len(config),
        },
        "layers": [],
    }, sort_keys=True, separators=(",", ":")).encode()
    manifest_digest = f"sha256:{sha256(image_manifest).hexdigest()}"
    manifest_name = f"blobs/sha256/{manifest_digest.removeprefix('sha256:')}"
    files: list[tuple[str, bytes]] = [(config_name, config), (manifest_name, image_manifest)]
    top_digest = manifest_digest
    top_size = len(image_manifest)
    top_media_type = "application/vnd.oci.image.manifest.v1+json"
    if nested_index:
        attestation = json.dumps({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json"}, sort_keys=True, separators=(",", ":")).encode()
        attestation_digest = f"sha256:{sha256(attestation).hexdigest()}"
        nested = json.dumps({
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.index.v1+json",
            "manifests": [{
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "digest": manifest_digest,
                "size": len(image_manifest),
                "platform": {"os": "linux", "architecture": architecture},
            }, {
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "digest": attestation_digest,
                "size": len(attestation),
                "platform": {"os": "unknown", "architecture": "unknown"},
                "annotations": {
                    "vnd.docker.reference.type": "attestation-manifest",
                    "vnd.docker.reference.digest": "sha256:" + "f" * 64 if invalid_attestation_reference else manifest_digest,
                },
            }],
        }, sort_keys=True, separators=(",", ":")).encode()
        top_digest = f"sha256:{sha256(nested).hexdigest()}"
        top_size = len(nested)
        top_media_type = "application/vnd.oci.image.index.v1+json"
        files.extend((
            (f"blobs/sha256/{attestation_digest.removeprefix('sha256:')}", attestation),
            (f"blobs/sha256/{top_digest.removeprefix('sha256:')}", nested),
        ))
    legacy_manifest = json.dumps([{
        "Config": config_name,
        "RepoTags": [tag],
        "Layers": [],
    }], sort_keys=True, separators=(",", ":")).encode()
    index = json.dumps({
        "schemaVersion": 2,
        "manifests": [{
            "mediaType": top_media_type,
            "digest": top_digest,
            "size": top_size,
            "annotations": {"io.containerd.image.name": tag},
        }],
    }, sort_keys=True, separators=(",", ":")).encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, value in (
            ("manifest.json", legacy_manifest),
            ("index.json", index),
            ("oci-layout", b'{"imageLayoutVersion":"1.0.0"}'),
            *files,
        ):
            info = tarfile.TarInfo(name)
            info.size = len(value)
            info.mode = 0o600
            info.mtime = 0
            archive.addfile(info, io.BytesIO(value))
    return buffer.getvalue(), config_digest, manifest_digest, top_digest


def write_release(
    root: Path,
    *,
    version: str = "1.0.0",
    commit: str = "a" * 40,
    platform: PlatformIdentity = MAC,
    release_id: str = "anote",
    signing_key: bytes | None = None,
) -> VerifiedRelease:
    root.mkdir(parents=True, exist_ok=True)
    tag_suffix = f"{version}-{commit[:8]}-{platform.container_architecture}"
    api_tag = f"anote-api:{tag_suffix}"
    web_tag = f"anote-web:{tag_suffix}"
    api, api_config, api_manifest, api_load = docker_archive(api_tag, platform.container_architecture)
    web, web_config, web_manifest, web_load = docker_archive(web_tag, platform.container_architecture)
    commands = json.dumps({
        "schema_version": 1,
        "migrate": ["node", "migrate.js"],
        "bootstrap_admin": ["node", "bootstrap-admin.js"],
    }, sort_keys=True, separators=(",", ":")).encode()
    assets = {
        "images/api.tar": (api, "api_image"),
        "images/web.tar": (web, "web_image"),
        "runtime/compose.yaml": (b"services: {}\n", "compose_template"),
        "runtime/nginx.conf": (b"server {}\n", "gateway_template"),
        "runtime/commands.json": (commands, "runtime_commands"),
    }
    manifest = {
        "kind": "anote-release",
        "schema_version": 1,
        "release": {
            "id": release_id,
            "version": version,
            "source_commit": commit,
            "minimum_control_center_version": "0.1.0",
            "minimum_installed_version": "0.0.0",
            "minimum_data_schema": 0,
            "maximum_data_schema": 99,
        },
        "platform": {
            "host_os": platform.host_os,
            "host_arch": platform.host_architecture,
            "container_os": "linux",
            "container_arch": platform.container_architecture,
        },
        "prerequisites": {"docker_engine": "23.0", "docker_compose": "2.20"},
        "images": [
            {"role": "api", "tag": api_tag, "archive_path": "images/api.tar", "config_digest": api_config, "manifest_digest": api_manifest, "load_digest": api_load, "operating_system": "linux", "architecture": platform.container_architecture},
            {"role": "web", "tag": web_tag, "archive_path": "images/web.tar", "config_digest": web_config, "manifest_digest": web_manifest, "load_digest": web_load, "operating_system": "linux", "architecture": platform.container_architecture},
        ],
        "files": [
            {"path": name, "role": role, "size": len(value), "sha256": sha256(value).hexdigest()}
            for name, (value, role) in assets.items()
        ],
        "publication": {"signing_policy": "signed" if signing_key else "unsigned-disclosed"},
    }
    manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    package = root / f"anote-{version}-{platform.host_os}.anote-release"
    with zipfile.ZipFile(package, "x", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", manifest_bytes)
        if signing_key:
            import hmac
            signature = {
                "schema_version": 1,
                "algorithm": "hmac-sha256",
                "key_id": "test-key",
                "manifest_sha256": sha256(manifest_bytes).hexdigest(),
                "signature": hmac.new(signing_key, manifest_bytes, sha256).hexdigest(),
            }
            archive.writestr("signature.json", json.dumps(signature, sort_keys=True, separators=(",", ":")))
        for name, (value, _role) in assets.items():
            archive.writestr(name, value)
    verifier = ReleaseVerifier(
        platform=platform,
        cache_root=root / "verified",
        signing_keys={"test-key": signing_key} if signing_key else {},
    )
    return verifier.verify(package)
