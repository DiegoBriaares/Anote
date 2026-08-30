from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPOSITORY_ROOT / "scripts" / "release" / "publish_tag_release.py"
SPEC = importlib.util.spec_from_file_location("anote_release_publication", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
publication = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = publication
SPEC.loader.exec_module(publication)


class ReleasePublicationTests(unittest.TestCase):
    def test_assets_are_a_sorted_exact_name_size_and_digest_set(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            second = root / "second.exe"
            first = root / "first.dmg"
            second.write_bytes(b"windows")
            first.write_bytes(b"macos")

            assets = publication.publication_assets([second, first])

            self.assertEqual([asset.name for asset in assets], ["first.dmg", "second.exe"])
            self.assertEqual(assets[0].size, 5)
            self.assertEqual(assets[0].digest, f"sha256:{hashlib.sha256(b'macos').hexdigest()}")
            publication.verify_remote_assets(assets, [
                {"name": asset.name, "size": asset.size, "digest": asset.digest, "state": "uploaded"}
                for asset in reversed(assets)
            ])

    def test_remote_asset_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "installer.dmg"
            path.write_bytes(b"trusted")
            assets = publication.publication_assets([path])

            with self.assertRaisesRegex(RuntimeError, "exact local name, size, and SHA-256"):
                publication.verify_remote_assets(assets, [{
                    "name": "installer.dmg",
                    "size": len(b"trusted"),
                    "digest": f"sha256:{'0' * 64}",
                    "state": "uploaded",
                }])

    def test_exact_tag_requires_matching_local_and_peeled_remote_commits(self) -> None:
        commit = "c" * 40
        tag_object = "d" * 40
        with mock.patch.object(publication, "run_checked", side_effect=[
            commit,
            f"{tag_object}\trefs/tags/anote-v1.0.0\n{commit}\trefs/tags/anote-v1.0.0^{{}}\n",
        ]):
            publication.verify_exact_tag("anote-v1.0.0", commit)

        with mock.patch.object(publication, "run_checked", side_effect=[
            commit,
            f"{'e' * 40}\trefs/tags/anote-v1.0.0\n",
        ]):
            with self.assertRaisesRegex(RuntimeError, "remote release tag"):
                publication.verify_exact_tag("anote-v1.0.0", commit)

    def test_an_already_published_exact_release_is_an_idempotent_noop(self) -> None:
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "installer.dmg"
            path.write_bytes(b"trusted")
            assets = publication.publication_assets([path])
            remote = [{
                "name": assets[0].name, "size": assets[0].size,
                "digest": assets[0].digest, "state": "uploaded"
            }]

            with mock.patch.object(publication, "verify_exact_tag") as verify_tag, \
                    mock.patch.object(publication, "find_release", return_value={
                        "id": 7, "draft": False, "tag_name": "anote-v1.0.0",
                        "name": "Anote 1.0.0", "body": "Verified", "prerelease": False
                    }), \
                    mock.patch.object(publication, "github_api", return_value=remote) as api:
                publication.publish(
                    repository="owner/repository",
                    tag="anote-v1.0.0",
                    commit=commit,
                    title="Anote 1.0.0",
                    notes="Verified",
                    assets=assets,
                )

            verify_tag.assert_called_once_with("anote-v1.0.0", commit)
            api.assert_called_once_with("owner/repository", "releases/7/assets?per_page=100")

    def test_draft_is_published_only_after_uploaded_assets_are_verified(self) -> None:
        commit = "b" * 40
        events: list[str] = []
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "installer.dmg"
            path.write_bytes(b"trusted")
            assets = publication.publication_assets([path])
            remote = [{
                "name": assets[0].name, "size": assets[0].size,
                "digest": assets[0].digest, "state": "uploaded"
            }]

            def run_command(arguments: list[str], **_kwargs: object) -> str:
                if arguments[0] == "git":
                    return commit
                events.append("upload")
                return ""

            def api(
                _repository: str,
                endpoint: str,
                *,
                method: str = "GET",
                body: dict[str, object] | None = None,
            ) -> object:
                if endpoint == "releases" and method == "POST":
                    events.append("draft")
                    self.assertEqual(body["draft"], True)
                    return {
                        "id": 9, "draft": True, "tag_name": "anote-v1.0.0",
                        "name": "Anote 1.0.0", "body": "Verified", "prerelease": False
                    }
                if endpoint == "releases/9" and method == "PATCH":
                    events.append("publish")
                    self.assertEqual(body, {"draft": False, "make_latest": "false"})
                    return {"id": 9, "draft": False}
                if endpoint == "releases/tags/anote-v1.0.0":
                    events.append("published-check")
                    return {
                        "id": 9, "draft": False, "tag_name": "anote-v1.0.0",
                        "name": "Anote 1.0.0", "body": "Verified", "prerelease": False
                    }
                if endpoint == "releases/9/assets?per_page=100":
                    events.append("assets-check")
                    return remote
                raise AssertionError(f"Unexpected API call: {method} {endpoint}")

            with mock.patch.object(publication, "verify_exact_tag") as verify_tag, \
                    mock.patch.object(publication, "run_checked", side_effect=run_command), \
                    mock.patch.object(publication, "find_release", return_value=None), \
                    mock.patch.object(publication, "github_api", side_effect=api):
                publication.publish(
                    repository="owner/repository",
                    tag="anote-v1.0.0",
                    commit=commit,
                    title="Anote 1.0.0",
                    notes="Verified",
                    assets=assets,
                )

            self.assertEqual(events, [
                "draft", "upload", "assets-check", "publish", "published-check", "assets-check"
            ])
            self.assertEqual(verify_tag.call_args_list, [
                mock.call("anote-v1.0.0", commit), mock.call("anote-v1.0.0", commit)
            ])


if __name__ == "__main__":
    unittest.main()
