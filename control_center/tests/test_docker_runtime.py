from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from anote_control_center.docker_runtime import (
    CommandResult,
    DockerRuntime,
    SubprocessExecutor,
    resolve_docker_executable,
)
from anote_control_center.errors import RuntimeCommandError
from anote_control_center.model import Installation
from anote_control_center.platform_paths import ManagedPaths
from anote_control_center.releases import RuntimeImage

from helpers import MAC, write_release


OWNED = ("production", "backups", "checkpoints", "releases", "logs", "operations")


def installation() -> Installation:
    return Installation(
        "a" * 32, "source", "checkpoint_required", "anote", "1.0.0", "b" * 40, "c" * 64,
        "anote-api:test", "sha256:" + "d" * 64, "anote-web:test", "sha256:" + "e" * 64,
        "macos", "arm64", "arm64", 15173, "UTC", "127.0.0.1", "anote-aaaaaaaaaaaa",
        4, OWNED, None, None, 0, 100, 100,
    )


class ScriptedExecutor:
    def __init__(self, responses: dict[tuple[str, ...], CommandResult]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, ...]] = []

    def run(self, arguments: object, *, input_bytes: bytes | None = None, timeout: int = 300) -> CommandResult:
        del input_bytes, timeout
        command = tuple(arguments)  # type: ignore[arg-type]
        self.calls.append(command)
        return self.responses.get(command, CommandResult(1, "", "unexpected"))


def container_row(
    *,
    service: str,
    container_id: str,
    image_id: str,
    data: Path,
) -> dict[str, object]:
    api = service == "api"
    return {
        "Id": container_id,
        "Image": image_id,
        "State": {"Running": True},
        "Config": {
            "Image": f"legacy-{service}:1",
            "Labels": {
                "com.docker.compose.project": "anote-production",
                "com.docker.compose.service": service,
            },
            "Env": (["SECRET_KEY=" + "f" * 64, "ANOTE_DEFAULT_TIME_ZONE=UTC"] if api else ["NGINX_ENTRYPOINT_QUIET_LOGS=1"]),
        },
        "Mounts": ([{"Destination": "/data", "Type": "bind", "Source": str(data)}] if api else []),
        "NetworkSettings": {
            "Networks": {"anote-production_default": {}},
            "Ports": ({"3001/tcp": None} if api else {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "15173"}]}),
        },
    }


class DockerRuntimeTests(unittest.TestCase):
    def test_macos_resolver_finds_docker_outside_finder_path(self) -> None:
        inspected: list[str] = []

        def only_desktop_cli(candidate: str) -> str | None:
            inspected.append(candidate)
            return candidate if candidate == "/usr/local/bin/docker" else None

        resolved = resolve_docker_executable(
            system_name="Darwin",
            environment={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"},
            which=only_desktop_cli,
        )

        self.assertEqual("/usr/local/bin/docker", resolved)
        self.assertEqual(("docker", "/usr/local/bin/docker"), tuple(inspected[:2]))

    def test_windows_resolver_finds_docker_outside_desktop_path(self) -> None:
        expected = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
        resolved = resolve_docker_executable(
            system_name="Windows",
            environment={"PATH": r"C:\Windows\System32", "ProgramFiles": r"C:\Program Files"},
            which=lambda candidate: candidate if candidate == expected else None,
        )

        self.assertEqual(expected, resolved)

    def test_subprocess_executor_uses_resolved_docker_executable(self) -> None:
        completed = subprocess.CompletedProcess([], 0, b"ready", b"")
        with patch("anote_control_center.docker_runtime.subprocess.run", return_value=completed) as run:
            result = SubprocessExecutor(docker_executable="/usr/local/bin/docker").run(
                ["docker", "version"],
            )

        self.assertEqual(0, result.returncode)
        self.assertEqual("ready", result.stdout)
        self.assertEqual(["/usr/local/bin/docker", "version"], run.call_args.args[0])

    def test_missing_docker_cli_has_specific_safe_error(self) -> None:
        with self.assertRaises(RuntimeCommandError) as raised:
            resolve_docker_executable(system_name="Darwin", which=lambda _candidate: None)
        self.assertEqual("docker_cli_missing", raised.exception.code)

    def test_loaded_image_accepts_the_verified_top_level_oci_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = RuntimeImage(
                "api", "anote-api:test", "images/api.tar",
                "sha256:" + "a" * 64, "sha256:" + "b" * 64, "sha256:" + "c" * 64,
                "linux", "arm64",
            )
            response = CommandResult(0, json.dumps({
                "Id": image.load_digest,
                "Os": "linux",
                "Architecture": "arm64",
            }), "")
            executor = ScriptedExecutor({
                ("docker", "image", "inspect", image.tag, "--format", "{{json .}}"): response,
            })
            runtime = DockerRuntime(ManagedPaths(Path(directory) / "state"), MAC, executor=executor)
            self.assertEqual(image.load_digest, runtime._verify_image(image))

    def test_registered_image_removal_uses_exact_recorded_host_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            value = installation()
            responses: dict[tuple[str, ...], CommandResult] = {}
            for tag, digest in ((value.api_image_tag, value.api_image_digest), (value.web_image_tag, value.web_image_digest)):
                responses[("docker", "image", "inspect", tag, "--format", "{{json .}}")] = CommandResult(0, json.dumps({"Id": digest}), "")
                responses[("docker", "image", "rm", digest)] = CommandResult(0, "", "")
            executor = ScriptedExecutor(responses)
            DockerRuntime(ManagedPaths(Path(directory) / "state"), MAC, executor=executor).remove_registered_images(value)
            self.assertIn(("docker", "image", "rm", value.api_image_digest), executor.calls)
            self.assertIn(("docker", "image", "rm", value.web_image_digest), executor.calls)
            self.assertNotIn(("docker", "image", "rm", value.api_image_tag), executor.calls)

    def test_release_image_removal_uses_verified_host_load_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = write_release(root / "release")
            responses: dict[tuple[str, ...], CommandResult] = {}
            for image in release.manifest.images:
                responses[("docker", "image", "inspect", image.tag, "--format", "{{json .}}")] = CommandResult(
                    0, json.dumps({"Id": image.load_digest}), "",
                )
                responses[("docker", "image", "rm", image.load_digest)] = CommandResult(0, "", "")
            executor = ScriptedExecutor(responses)
            DockerRuntime(ManagedPaths(root / "state"), MAC, executor=executor).remove_images(release)
            for image in release.manifest.images:
                self.assertIn(("docker", "image", "rm", image.load_digest), executor.calls)
                self.assertNotIn(("docker", "image", "rm", image.tag), executor.calls)
                self.assertNotIn(("docker", "image", "rm", image.config_digest), executor.calls)

    def test_legacy_adoption_rejects_an_extra_network_dependent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = ManagedPaths(Path(directory) / "state")
            api_id, web_id = "1" * 64, "2" * 64
            responses = {
                ("docker", "ps", "--all", "--filter", "label=com.docker.compose.project=anote-production", "--format", "{{.ID}}"): CommandResult(0, "api\nweb\n", ""),
                ("docker", "container", "inspect", "api"): CommandResult(0, json.dumps([container_row(service="api", container_id=api_id, image_id="sha256:" + "a" * 64, data=paths.data)]), ""),
                ("docker", "container", "inspect", "web"): CommandResult(0, json.dumps([container_row(service="web", container_id=web_id, image_id="sha256:" + "b" * 64, data=paths.data)]), ""),
                ("docker", "network", "inspect", "anote-production_default"): CommandResult(0, json.dumps([{"Containers": {api_id: {}, web_id: {}, "3" * 64: {}}}]), ""),
            }
            runtime = DockerRuntime(paths, MAC, executor=ScriptedExecutor(responses))
            with self.assertRaisesRegex(RuntimeCommandError, "extra or missing"):
                runtime.inspect_legacy()


if __name__ == "__main__":
    unittest.main()
