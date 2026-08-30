from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

from anote_control_center.docker_runtime import DockerRuntime, RuntimeCommandError
from anote_control_center.errors import ContractError
from anote_control_center.releases import ReleaseVerifier, classify_release_change

from helpers import MAC, WINDOWS, write_release


class ReleaseTests(unittest.TestCase):
    def test_valid_release_is_verified_and_cache_is_bound(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            release = write_release(Path(directory))
            self.assertEqual(("node", "migrate.js"), release.commands.migrate)
            release.assert_current()
            release.asset("runtime_commands").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "cache changed"):
                release.assert_current()

    def test_signed_release_requires_the_trusted_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = write_release(root, signing_key=b"k" * 32)
            self.assertTrue(release.signed)
            verifier = ReleaseVerifier(platform=MAC, cache_root=root / "other", require_signed=True)
            with self.assertRaisesRegex(ContractError, "trusted"):
                verifier.verify(release.package_path)

    def test_symlink_duplicate_and_nonregular_members_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = write_release(root)
            link = root / "linked.anote-release"
            link.symlink_to(release.package_path)
            with self.assertRaises(ContractError):
                ReleaseVerifier(platform=MAC, cache_root=root / "link-cache").verify(link)

            duplicate = root / "duplicate.anote-release"
            with zipfile.ZipFile(release.package_path) as source, zipfile.ZipFile(duplicate, "w", compression=zipfile.ZIP_STORED) as output:
                for info in source.infolist():
                    output.writestr(info.filename, source.read(info))
                output.writestr("manifest.json", source.read("manifest.json"))
            with self.assertRaisesRegex(ContractError, "duplicate"):
                ReleaseVerifier(platform=MAC, cache_root=root / "dup-cache").verify(duplicate)

    def test_platform_and_release_change_are_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            release = write_release(Path(directory))
            with self.assertRaisesRegex(ContractError, "computer"):
                ReleaseVerifier(platform=WINDOWS, cache_root=Path(directory) / "win").verify(release.package_path)
            current = classify_release_change(release.manifest, installed_release_id="anote", installed_version="1.0.0", installed_source_commit="a" * 40)
            self.assertEqual("current", current.kind)
            upgrade_manifest = replace(release.manifest, version="1.1.0", source_commit="d" * 40)
            self.assertEqual("upgrade", classify_release_change(upgrade_manifest, installed_release_id="anote", installed_version="1.0.0", installed_source_commit="a" * 40).kind)
            downgrade_manifest = replace(release.manifest, version="0.9.0", source_commit="e" * 40)
            self.assertTrue(classify_release_change(downgrade_manifest, installed_release_id="anote", installed_version="1.0.0", installed_source_commit="a" * 40).requires_confirmation)

    def test_health_identity_requires_the_exact_nested_contract(self) -> None:
        valid = {"status": "ready", "data": {"releaseId": "anote", "version": "1.0.0", "sourceCommit": "a" * 40, "schemaVersion": 4}}
        self.assertEqual(4, DockerRuntime._parse_health(valid).data_schema)
        for invalid in (
            {**valid, "extra": True},
            {"status": "ready", "data": {**valid["data"], "extra": True}},
            {"status": "ready", "data": {**valid["data"], "schemaVersion": True}},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeCommandError):
                DockerRuntime._parse_health(invalid)


if __name__ == "__main__":
    unittest.main()
