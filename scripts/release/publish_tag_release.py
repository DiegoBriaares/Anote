#!/usr/bin/env python3
"""Publish one exact-commit GitHub Release from a verified local asset set."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
TAG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class PublicationAsset:
    path: Path
    name: str
    size: int
    digest: str


def publication_assets(paths: list[Path]) -> tuple[PublicationAsset, ...]:
    if not paths or len(paths) > 10:
        raise ValueError("A release must contain between one and ten assets.")
    assets: list[PublicationAsset] = []
    names: set[str] = set()
    for supplied_path in paths:
        path = supplied_path.resolve(strict=True)
        if supplied_path.is_symlink() or not path.is_file():
            raise ValueError(f"Release asset is not a regular file: {supplied_path}")
        if path.name in names:
            raise ValueError(f"Duplicate release asset name: {path.name}")
        names.add(path.name)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        assets.append(PublicationAsset(path, path.name, path.stat().st_size, f"sha256:{digest.hexdigest()}"))
    return tuple(sorted(assets, key=lambda asset: asset.name))


def verify_remote_assets(expected: tuple[PublicationAsset, ...], remote: list[dict[str, Any]]) -> None:
    if any(item.get("state") != "uploaded" for item in remote):
        raise RuntimeError("GitHub Release contains an asset that is not fully uploaded.")
    actual = sorted(
        (
            str(item.get("name", "")),
            int(item.get("size", -1)),
            str(item.get("digest", "")),
        )
        for item in remote
    )
    wanted = [(asset.name, asset.size, asset.digest) for asset in expected]
    if actual != wanted:
        raise RuntimeError("GitHub Release assets do not match the exact local name, size, and SHA-256 set.")


def verify_release_metadata(release: dict[str, Any], *, tag: str, title: str, notes: str) -> None:
    if (release.get("tag_name"), release.get("name"), release.get("body"), release.get("prerelease")) != (
        tag, title, notes, False
    ):
        raise RuntimeError("GitHub Release metadata does not match the exact stable publication contract.")


def run_checked(arguments: list[str], *, input_value: dict[str, Any] | None = None) -> str:
    result = subprocess.run(
        arguments,
        input=None if input_value is None else json.dumps(input_value),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "command failed"
        raise RuntimeError(f"{arguments[0]} {arguments[1]} failed: {message}")
    return result.stdout


def github_api(repository: str, endpoint: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    arguments = ["gh", "api", f"repos/{repository}/{endpoint}"]
    if method != "GET":
        arguments.extend(["--method", method])
    if body is not None:
        arguments.extend(["--input", "-"])
    return json.loads(run_checked(arguments, input_value=body))


def find_release(repository: str, tag: str) -> dict[str, Any] | None:
    result = subprocess.run(
        ["gh", "api", f"repos/{repository}/releases/tags/{tag}"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode == 0:
        return json.loads(result.stdout)
    if "HTTP 404" in result.stderr:
        return None
    message = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "command failed"
    raise RuntimeError(f"GitHub release lookup failed: {message}")


def verify_exact_tag(tag: str, commit: str) -> None:
    local_commit = run_checked(["git", "rev-list", "-n", "1", tag]).strip()
    if local_commit != commit:
        raise RuntimeError("The release tag does not resolve locally to the expected exact commit.")
    output = run_checked([
        "git", "ls-remote", "--exit-code", "--tags", "origin",
        f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}",
    ])
    references = {}
    for line in output.splitlines():
        value, separator, reference = line.partition("\t")
        if not separator or not COMMIT_PATTERN.fullmatch(value):
            raise RuntimeError("The remote release tag response is malformed.")
        references[reference] = value
    remote_commit = references.get(f"refs/tags/{tag}^{{}}") or references.get(f"refs/tags/{tag}")
    if remote_commit != commit:
        raise RuntimeError("The remote release tag does not resolve to the expected exact commit.")


def publish(
    *,
    repository: str,
    tag: str,
    commit: str,
    title: str,
    notes: str,
    assets: tuple[PublicationAsset, ...],
) -> None:
    verify_exact_tag(tag, commit)

    release = find_release(repository, tag)
    if release is None:
        release = github_api(repository, "releases", method="POST", body={
            "tag_name": tag,
            "target_commitish": commit,
            "name": title,
            "body": notes,
            "draft": True,
            "prerelease": False,
            "make_latest": "false",
        })
    verify_release_metadata(release, tag=tag, title=title, notes=notes)
    release_id = int(release["id"])
    if release_id < 1:
        raise RuntimeError("GitHub returned an invalid release identity.")
    if release.get("draft") is False:
        remote_assets = github_api(repository, f"releases/{release_id}/assets?per_page=100")
        verify_remote_assets(assets, remote_assets)
        return

    run_checked(["gh", "release", "upload", tag, *(str(asset.path) for asset in assets), "--clobber"])
    remote_assets = github_api(repository, f"releases/{release_id}/assets?per_page=100")
    verify_remote_assets(assets, remote_assets)
    github_api(repository, f"releases/{release_id}", method="PATCH", body={
        "draft": False,
        "make_latest": "false",
    })
    published = github_api(repository, f"releases/tags/{tag}")
    if published.get("draft") is not False:
        raise RuntimeError("GitHub did not publish the exact verified draft.")
    verify_release_metadata(published, tag=tag, title=title, notes=notes)
    verify_remote_assets(assets, github_api(repository, f"releases/{release_id}/assets?per_page=100"))
    verify_exact_tag(tag, commit)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--notes-file", type=Path, required=True)
    parser.add_argument("--asset", type=Path, action="append", required=True)
    arguments = parser.parse_args()

    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if not REPOSITORY_PATTERN.fullmatch(repository):
        parser.error("GITHUB_REPOSITORY must identify one owner/repository")
    if not TAG_PATTERN.fullmatch(arguments.tag):
        parser.error("invalid release tag")
    if not COMMIT_PATTERN.fullmatch(arguments.commit):
        parser.error("release commit must be 40 lowercase hexadecimal characters")
    if not arguments.title.strip() or len(arguments.title) > 200:
        parser.error("release title must contain 1-200 characters")
    notes_path = arguments.notes_file.resolve(strict=True)
    if arguments.notes_file.is_symlink() or not notes_path.is_file() or notes_path.stat().st_size > 64 * 1024:
        parser.error("release notes must be one regular file no larger than 64 KiB")
    if not os.environ.get("GH_TOKEN"):
        parser.error("GH_TOKEN is required")

    try:
        publish(
            repository=repository,
            tag=arguments.tag,
            commit=arguments.commit,
            title=arguments.title.strip(),
            notes=notes_path.read_text(encoding="utf-8"),
            assets=publication_assets(arguments.asset),
        )
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"Publication refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
