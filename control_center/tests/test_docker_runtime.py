from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from anote_control_center.docker_runtime import CommandResult, DockerRuntime
from anote_control_center.errors import RuntimeCommandError
from anote_control_center.model import Installation
from anote_control_center.platform_paths import ManagedPaths

from helpers import MAC


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
    def test_registered_image_removal_uses_exact_recorded_config_id(self) -> None:
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
