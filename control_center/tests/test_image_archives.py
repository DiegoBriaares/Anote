from __future__ import annotations

import io
import gzip
from pathlib import Path
import tarfile
import tempfile
import unittest

from anote_control_center.errors import ContractError
from anote_control_center.image_archives import inspect_image_archive

from helpers import docker_archive


class ImageArchiveTests(unittest.TestCase):
    def test_compressed_inner_image_archive_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.tar"
            path.write_bytes(gzip.compress(docker_archive("anote-api:test")[0]))
            with self.assertRaisesRegex(ContractError, "unreadable"):
                inspect_image_archive(path, "anote-api:test", operating_system="linux", architecture="arm64")

    def test_derives_distinct_config_manifest_and_nested_load_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.tar"
            payload, config, manifest, load = docker_archive("anote-api:test", nested_index=True)
            path.write_bytes(payload)
            identity = inspect_image_archive(path, "anote-api:test", operating_system="linux", architecture="arm64")
            self.assertEqual((config, manifest, load), (identity.config_digest, identity.manifest_digest, identity.load_digest))
            self.assertNotEqual(manifest, load)

    def test_rejects_invalid_attestation_reference_and_wrong_platform(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.tar"
            path.write_bytes(docker_archive("anote-api:test", nested_index=True, invalid_attestation_reference=True)[0])
            with self.assertRaisesRegex(ContractError, "attestation"):
                inspect_image_archive(path, "anote-api:test", operating_system="linux", architecture="arm64")
            valid = Path(directory) / "valid.tar"
            valid.write_bytes(docker_archive("anote-api:test", architecture="arm64")[0])
            with self.assertRaisesRegex(ContractError, "platform"):
                inspect_image_archive(valid, "anote-api:test", operating_system="linux", architecture="amd64")

    def test_configuration_content_tamper_is_detected_before_docker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "original.tar"
            original.write_bytes(docker_archive("anote-api:test")[0])
            tampered = root / "tampered.tar"
            with tarfile.open(original, "r:") as source, tarfile.open(tampered, "w") as output:
                for member in source:
                    stream = source.extractfile(member) if member.isfile() else None
                    value = stream.read() if stream is not None else b""
                    if member.name.startswith("blobs/sha256/") and b'"architecture"' in value:
                        value = value.replace(b'"arm64"', b'"amd64"')
                        member.size = len(value)
                    output.addfile(member, io.BytesIO(value) if member.isfile() else None)
            with self.assertRaisesRegex(ContractError, "content"):
                inspect_image_archive(tampered, "anote-api:test", operating_system="linux", architecture="arm64")


if __name__ == "__main__":
    unittest.main()
