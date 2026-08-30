from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from typing import Callable, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .errors import ContractError, RuntimeCommandError
from .model import Installation
from .platform_paths import ManagedPaths, PlatformIdentity
from .releases import ReleaseManifest, RuntimeImage, VerifiedRelease
from .storage import ensure_private_directory


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class CommandExecutor(Protocol):
    def run(
        self,
        arguments: Sequence[str],
        *,
        input_bytes: bytes | None = None,
        timeout: int = 300,
    ) -> CommandResult: ...


class SubprocessExecutor:
    def run(
        self,
        arguments: Sequence[str],
        *,
        input_bytes: bytes | None = None,
        timeout: int = 300,
    ) -> CommandResult:
        try:
            completed = subprocess.run(
                list(arguments),
                input=input_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeCommandError("Docker Desktop did not complete the requested operation.", code="docker_command_failed") from error
        return CommandResult(
            completed.returncode,
            completed.stdout.decode("utf-8", errors="replace"),
            completed.stderr.decode("utf-8", errors="replace"),
        )


@dataclass(frozen=True)
class RuntimeConfiguration:
    timezone: str
    public_port: int
    bind_address: str = "0.0.0.0"

    def __post_init__(self) -> None:
        if not self.timezone or len(self.timezone) > 128 or any(character in self.timezone for character in "\r\n\x00"):
            raise ContractError("Runtime timezone is invalid.", code="invalid_runtime_config")
        if isinstance(self.public_port, bool) or not 1024 <= self.public_port <= 65535:
            raise ContractError("Runtime public port is invalid.", code="invalid_runtime_config")
        if self.bind_address not in {"0.0.0.0", "127.0.0.1"}:
            raise ContractError("Runtime bind address is unsupported.", code="invalid_runtime_config")


@dataclass(frozen=True)
class HealthIdentity:
    release_id: str
    version: str
    source_commit: str
    data_schema: int


@dataclass(frozen=True)
class LegacyContainer:
    service: str
    container_id: str
    image_reference: str
    image_id: str
    environment_digest: str
    was_running: bool


@dataclass(frozen=True)
class LegacyRuntime:
    project_name: str
    containers: tuple[LegacyContainer, ...]
    data_path: Path
    public_port: int
    bind_address: str
    timezone: str | None
    secret_key: str | None = field(default=None, repr=False, compare=False)

    @property
    def container_ids(self) -> tuple[str, ...]:
        return tuple(container.container_id for container in self.containers)

    @property
    def running_container_ids(self) -> tuple[str, ...]:
        return tuple(container.container_id for container in self.containers if container.was_running)

    @property
    def image_references(self) -> tuple[str, ...]:
        return tuple(container.image_reference for container in self.containers)


def _checked_value(value: str) -> str:
    if not value or any(character in value for character in "\r\n\x00"):
        raise ContractError("Runtime environment value is unsafe.", code="invalid_runtime_config")
    return value


def _env_value(value: str) -> str:
    """Compose env files use JSON-compatible double-quoted escaping."""
    return json.dumps(_checked_value(value), ensure_ascii=False)


class DockerRuntime:
    """Own every Docker CLI shape and translate transport failures once."""

    def __init__(
        self,
        paths: ManagedPaths,
        platform: PlatformIdentity,
        *,
        executor: CommandExecutor | None = None,
        reporter: Callable[[str], None] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.paths = paths
        self.platform = platform
        self.executor = executor or SubprocessExecutor()
        self.reporter = reporter or (lambda _message: None)
        self.sleeper = sleeper

    def _run(
        self,
        arguments: Sequence[str],
        *,
        input_bytes: bytes | None = None,
        timeout: int = 300,
        message: str = "Docker Desktop could not complete the operation.",
    ) -> CommandResult:
        result = self.executor.run(arguments, input_bytes=input_bytes, timeout=timeout)
        if result.returncode != 0:
            raise RuntimeCommandError(message, code="docker_command_failed")
        return result

    @staticmethod
    def _numeric_version(value: str) -> tuple[int, ...]:
        match = re.search(r"[0-9]+(?:\.[0-9]+)+", value)
        if match is None:
            raise RuntimeCommandError("Docker returned an unreadable version.", code="docker_invalid_response")
        return tuple(int(part) for part in match.group(0).split("."))

    def require_ready(self, manifest: ReleaseManifest | None = None) -> None:
        result = self._run(
            ["docker", "version", "--format", "{{json .Server}}"],
            timeout=30,
            message="Start Docker Desktop, wait until it is ready, and try again.",
        )
        try:
            server = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeCommandError("Docker Desktop returned unreadable platform information.", code="docker_invalid_response") from error
        if not isinstance(server, dict):
            raise RuntimeCommandError("Docker Desktop server information is incomplete.", code="docker_invalid_response")
        operating_system = str(server.get("Os", "")).lower()
        architecture = str(server.get("Arch", "")).lower().replace("x86_64", "amd64").replace("aarch64", "arm64")
        if (operating_system, architecture) != (self.platform.container_os, self.platform.container_architecture):
            raise RuntimeCommandError(
                "Docker Desktop is using an incompatible container platform.",
                code="docker_platform_mismatch",
            )
        compose = self._run(
            ["docker", "compose", "version", "--short"],
            timeout=30,
            message="Docker Compose is unavailable in Docker Desktop.",
        )
        if manifest is not None:
            engine_version = str(server.get("Version", ""))
            if self._numeric_version(engine_version) < self._numeric_version(manifest.minimum_docker_engine):
                raise RuntimeCommandError("Docker Desktop is older than this Anote release requires.", code="docker_version_too_old")
            if self._numeric_version(compose.stdout) < self._numeric_version(manifest.minimum_docker_compose):
                raise RuntimeCommandError("Docker Compose is older than this Anote release requires.", code="docker_version_too_old")

    def load_release_images(self, release: VerifiedRelease) -> None:
        release.assert_current()
        self.require_ready(release.manifest)
        for image in release.manifest.images:
            self.reporter(f"Loading {image.role} image")
            self._run(
                ["docker", "load", "--input", str(release.cache_root / image.archive_path)],
                timeout=1800,
                message="A verified Anote image could not be loaded.",
            )
            self._verify_image(image)

    def _verify_image(self, image: RuntimeImage) -> None:
        result = self._run(
            ["docker", "image", "inspect", image.tag, "--format", "{{json .}}"],
            timeout=60,
            message="A loaded Anote image could not be inspected.",
        )
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeCommandError("A loaded image returned unreadable identity information.", code="image_identity_mismatch") from error
        actual_arch = str(value.get("Architecture", "")).replace("x86_64", "amd64").replace("aarch64", "arm64") if isinstance(value, dict) else ""
        if not isinstance(value, dict) or (
            value.get("Id"), value.get("Os"), actual_arch
        ) != (image.config_digest, image.operating_system, image.architecture):
            raise RuntimeCommandError("A loaded image does not match the verified release manifest.", code="image_identity_mismatch")

    def write_runtime(self, release: VerifiedRelease, configuration: RuntimeConfiguration) -> None:
        ensure_private_directory(self.paths.runtime, managed_paths=self.paths)
        ensure_private_directory(self.paths.data, managed_paths=self.paths)
        ensure_private_directory(self.paths.uploads, managed_paths=self.paths)
        release.assert_current()
        compose_source = release.asset("compose_template")
        if compose_source.is_symlink() or not compose_source.is_file():
            raise ContractError("Verified Compose runtime asset is unavailable.", code="invalid_release_cache")
        self._atomic_copy(compose_source, self.paths.compose, mode=0o600, managed_paths=self.paths)
        values = {
            "ANOTE_DATA_DIR": self.paths.data.as_posix(),
            "ANOTE_API_UID": str(os.getuid()) if hasattr(os, "getuid") else "1000",
            "ANOTE_API_GID": str(os.getgid()) if hasattr(os, "getgid") else "1000",
            "ANOTE_API_IMAGE": release.manifest.image_for_role("api").tag,
            "ANOTE_WEB_IMAGE": release.manifest.image_for_role("web").tag,
            "ANOTE_BIND_ADDRESS": configuration.bind_address,
            "ANOTE_PUBLIC_PORT": str(configuration.public_port),
            "ANOTE_DEFAULT_TIME_ZONE": configuration.timezone,
            "ANOTE_RELEASE_ID": release.manifest.release_id,
            "ANOTE_RELEASE_VERSION": release.manifest.version,
            "ANOTE_SOURCE_COMMIT": release.manifest.source_commit,
        }
        content = "".join(f"{key}={_env_value(value)}\n" for key, value in values.items())
        self._atomic_bytes(content.encode("utf-8"), self.paths.environment, mode=0o600, managed_paths=self.paths)

    @staticmethod
    def _atomic_copy(
        source: Path,
        destination: Path,
        *,
        mode: int,
        managed_paths: ManagedPaths | None = None,
    ) -> None:
        with source.open("rb") as stream:
            DockerRuntime._atomic_bytes(stream.read(), destination, mode=mode, managed_paths=managed_paths)

    @staticmethod
    def _atomic_bytes(
        payload: bytes,
        destination: Path,
        *,
        mode: int,
        managed_paths: ManagedPaths | None = None,
    ) -> None:
        if managed_paths is not None:
            managed_paths.assert_safe(destination)
        ensure_private_directory(destination.parent, managed_paths=managed_paths)
        temporary: Path | None = None
        try:
            descriptor, name = tempfile.mkstemp(prefix=f"{destination.name}.", suffix=".tmp", dir=destination.parent)
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            if os.name != "nt":
                temporary.chmod(mode)
            os.replace(temporary, destination)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def read_configuration(self) -> RuntimeConfiguration:
        self.paths.assert_safe(self.paths.environment, allow_missing=False)
        if self.paths.environment.is_symlink() or not self.paths.environment.is_file():
            raise ContractError("Anote runtime configuration is unavailable.", code="runtime_config_missing")
        values: dict[str, str] = {}
        try:
            for line in self.paths.environment.read_text(encoding="utf-8").splitlines():
                if not line or line.startswith("#"):
                    continue
                key, separator, encoded = line.partition("=")
                if not separator:
                    raise ValueError
                value = json.loads(encoded)
                if not isinstance(value, str):
                    raise ValueError
                values[key] = value
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            raise ContractError("Anote runtime configuration is unreadable.", code="runtime_config_invalid") from error
        try:
            return RuntimeConfiguration(
                values["ANOTE_DEFAULT_TIME_ZONE"],
                int(values["ANOTE_PUBLIC_PORT"]),
                values["ANOTE_BIND_ADDRESS"],
            )
        except (KeyError, ValueError) as error:
            raise ContractError("Anote runtime configuration is incomplete.", code="runtime_config_invalid") from error

    def _compose(self, installation: Installation, arguments: Sequence[str], *, input_bytes: bytes | None = None, timeout: int = 600) -> CommandResult:
        return self._run(
            [
                "docker", "compose",
                "--project-name", installation.project_name,
                "--env-file", str(self.paths.environment),
                "--file", str(self.paths.compose),
                *arguments,
            ],
            input_bytes=input_bytes,
            timeout=timeout,
            message="The managed Anote runtime command failed.",
        )

    def run_release_command(self, installation: Installation, command: Sequence[str], *, input_bytes: bytes | None = None) -> None:
        self._verify_registered_images(installation)
        self._compose(
            installation,
            ["run", "--rm", "--no-deps", "-T", "api", *command],
            input_bytes=input_bytes,
            timeout=600,
        )

    def up(self, installation: Installation, *, wait_seconds: int = 180) -> HealthIdentity:
        self._verify_registered_images(installation)
        self._compose(installation, ["up", "--detach", "--remove-orphans"], timeout=600)
        return self.wait_for_health(installation, timeout_seconds=wait_seconds)

    def stop(self, installation: Installation) -> None:
        self._compose(installation, ["stop"], timeout=300)

    def down(self, installation: Installation) -> None:
        self._compose(installation, ["down", "--remove-orphans"], timeout=300)

    def remove_images(self, release: VerifiedRelease) -> None:
        for image in release.manifest.images:
            inspected = self.executor.run(
                ["docker", "image", "inspect", image.tag, "--format", "{{json .}}"],
                timeout=60,
            )
            if inspected.returncode != 0:
                self.require_ready()
                continue
            try:
                value = json.loads(inspected.stdout)
            except json.JSONDecodeError as error:
                raise RuntimeCommandError("Release image identity is unreadable.", code="image_identity_mismatch") from error
            if not isinstance(value, dict) or value.get("Id") != image.config_digest:
                raise RuntimeCommandError("A release image tag now identifies different bytes.", code="image_identity_mismatch")
            self._run(
                ["docker", "image", "rm", image.config_digest],
                timeout=300,
                message="Anote runtime images could not be removed.",
            )

    def remove_registered_images(self, installation: Installation) -> None:
        """Remove only tags whose current config identity is recorded in the registry."""
        for tag, expected_digest in (
            (installation.api_image_tag, installation.api_image_digest),
            (installation.web_image_tag, installation.web_image_digest),
        ):
            inspected = self.executor.run(
                ["docker", "image", "inspect", tag, "--format", "{{json .}}"],
                timeout=60,
            )
            if inspected.returncode != 0:
                self.require_ready()
                continue
            try:
                value = json.loads(inspected.stdout)
            except json.JSONDecodeError as error:
                raise RuntimeCommandError("Registered image identity is unreadable.", code="image_identity_mismatch") from error
            if not isinstance(value, dict) or value.get("Id") != expected_digest:
                raise RuntimeCommandError("A registered image tag now identifies different bytes.", code="image_identity_mismatch")
            self._run(
                ["docker", "image", "rm", expected_digest],
                timeout=300,
                message="Registered Anote images could not be removed.",
            )

    def _verify_registered_images(self, installation: Installation) -> None:
        for tag, expected_digest in (
            (installation.api_image_tag, installation.api_image_digest),
            (installation.web_image_tag, installation.web_image_digest),
        ):
            result = self._run(
                ["docker", "image", "inspect", tag, "--format", "{{json .}}"],
                timeout=60,
                message="A registered Anote image is unavailable.",
            )
            try:
                value = json.loads(result.stdout)
            except json.JSONDecodeError as error:
                raise RuntimeCommandError("Registered image identity is unreadable.", code="image_identity_mismatch") from error
            if not isinstance(value, dict) or value.get("Id") != expected_digest:
                raise RuntimeCommandError("A registered image tag now identifies different bytes.", code="image_identity_mismatch")

    def is_running(self, installation: Installation) -> bool:
        result = self._compose(installation, ["ps", "--status", "running", "--format", "json"], timeout=60)
        output = result.stdout.strip()
        if not output:
            return False
        try:
            value = json.loads(output)
            rows = value if isinstance(value, list) else [value]
        except json.JSONDecodeError:
            try:
                rows = [json.loads(line) for line in output.splitlines() if line.strip()]
            except json.JSONDecodeError as error:
                raise RuntimeCommandError("Docker returned unreadable Anote status.", code="docker_invalid_response") from error
        return any(isinstance(row, dict) and row.get("State") == "running" for row in rows)

    def wait_for_health(self, installation: Installation, *, timeout_seconds: int) -> HealthIdentity:
        deadline = time.monotonic() + timeout_seconds
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                request = Request(
                    f"http://127.0.0.1:{installation.public_port}/api/health/ready",
                    headers={"Accept": "application/json"},
                )
                with urlopen(request, timeout=3) as response:
                    value = json.loads(response.read(1024 * 1024).decode("utf-8"))
                identity = self._parse_health(value)
                if (
                    identity.release_id,
                    identity.version,
                    identity.source_commit,
                ) != (installation.release_id, installation.version, installation.source_commit):
                    raise RuntimeCommandError("Anote became ready with the wrong release identity.", code="health_identity_mismatch")
                return identity
            except (HTTPError, URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError, RuntimeCommandError) as error:
                last_error = error
                self.sleeper(2)
        raise RuntimeCommandError("Anote did not become healthy before the timeout.", code="health_timeout") from last_error

    @staticmethod
    def _parse_health(value: object) -> HealthIdentity:
        if not isinstance(value, dict) or set(value) != {"status", "data"} or value["status"] != "ready":
            raise RuntimeCommandError("Anote health response is incomplete.", code="health_identity_mismatch")
        data = value["data"]
        if not isinstance(data, dict) or set(data) != {"releaseId", "version", "sourceCommit", "schemaVersion"}:
            raise RuntimeCommandError("Anote release identity is missing from health.", code="health_identity_mismatch")
        data_schema = data["schemaVersion"]
        if (
            not isinstance(data["releaseId"], str)
            or not isinstance(data["version"], str)
            or not isinstance(data["sourceCommit"], str)
            or isinstance(data_schema, bool)
            or not isinstance(data_schema, int)
            or data_schema < 0
        ):
            raise RuntimeCommandError("Anote data schema is missing from health.", code="health_identity_mismatch")
        return HealthIdentity(data["releaseId"], data["version"], data["sourceCommit"], data_schema)

    def inspect_legacy(self, project_name: str = "anote-production") -> LegacyRuntime:
        result = self._run(
            ["docker", "ps", "--all", "--filter", f"label=com.docker.compose.project={project_name}", "--format", "{{.ID}}"],
            timeout=60,
            message="Existing Anote containers could not be inspected.",
        )
        discovered_ids = tuple(line.strip() for line in result.stdout.splitlines() if line.strip())
        if not discovered_ids:
            raise RuntimeCommandError("No existing anote-production containers were found.", code="legacy_not_found")
        inspections: list[dict[str, object]] = []
        for container_id in discovered_ids:
            inspected = self._run(["docker", "container", "inspect", container_id], timeout=60).stdout
            try:
                rows = json.loads(inspected)
            except json.JSONDecodeError as error:
                raise RuntimeCommandError("Existing Anote container information is unreadable.", code="docker_invalid_response") from error
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
                raise RuntimeCommandError("Existing Anote container information is incomplete.", code="docker_invalid_response")
            inspections.append(rows[0])
        if len(inspections) != 2:
            raise RuntimeCommandError("Existing Anote must contain exactly one API and one web container.", code="legacy_ambiguous")
        data_paths: set[Path] = set()
        public_bindings: set[tuple[str, int]] = set()
        containers: list[LegacyContainer] = []
        secret_key: str | None = None
        timezone: str | None = None
        services: set[str] = set()
        network_names: set[str] = set()
        for row in inspections:
            state = row.get("State")
            config = row.get("Config")
            container_id = row.get("Id")
            image_id = row.get("Image")
            if (
                not isinstance(container_id, str)
                or re.fullmatch(r"[0-9a-f]{64}", container_id) is None
                or not isinstance(image_id, str)
                or re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is None
                or not isinstance(config, dict)
            ):
                raise RuntimeCommandError("Existing Anote container identity is incomplete.", code="legacy_ambiguous")
            labels = config.get("Labels")
            service = labels.get("com.docker.compose.service") if isinstance(labels, dict) else None
            declared_project = labels.get("com.docker.compose.project") if isinstance(labels, dict) else None
            image_reference = config.get("Image")
            if service not in {"api", "web"} or service in services or declared_project != project_name or not isinstance(image_reference, str) or not image_reference:
                raise RuntimeCommandError("Existing Anote Compose topology is not exactly API plus web.", code="legacy_ambiguous")
            services.add(service)
            environment = config.get("Env")
            if not isinstance(environment, list) or not all(isinstance(item, str) and "\x00" not in item for item in environment):
                raise RuntimeCommandError("Existing Anote environment identity is incomplete.", code="legacy_ambiguous")
            environment_values = dict(item.split("=", 1) for item in environment if "=" in item)
            if service == "api":
                candidate_secret = environment_values.get("SECRET_KEY")
                if candidate_secret is not None and re.fullmatch(r"[0-9a-f]{64}", candidate_secret) is None:
                    raise RuntimeCommandError("Existing Anote secret cannot be preserved safely.", code="legacy_config_invalid")
                secret_key = candidate_secret
                timezone = environment_values.get("ANOTE_DEFAULT_TIME_ZONE") or None
            mounts = row.get("Mounts")
            if not isinstance(mounts, list):
                raise RuntimeCommandError("Existing Anote mount identity is incomplete.", code="legacy_ambiguous")
            if service == "api":
                if len(mounts) != 1 or not isinstance(mounts[0], dict) or mounts[0].get("Destination") != "/data" or mounts[0].get("Type") != "bind" or not isinstance(mounts[0].get("Source"), str):
                    raise RuntimeCommandError("Existing Anote API must own exactly one /data bind mount.", code="legacy_ambiguous")
                data_paths.add(Path(str(mounts[0]["Source"])).resolve(strict=False))
            elif mounts:
                raise RuntimeCommandError("Existing Anote web container has unexpected mounts.", code="legacy_ambiguous")
            network = row.get("NetworkSettings")
            ports = network.get("Ports") if isinstance(network, dict) else None
            networks = network.get("Networks") if isinstance(network, dict) else None
            if not isinstance(networks, dict) or len(networks) != 1:
                raise RuntimeCommandError("Existing Anote network topology is ambiguous.", code="legacy_ambiguous")
            network_names.add(next(iter(networks)))
            published = {
                key: value for key, value in ports.items()
                if isinstance(ports, dict) and value not in (None, [])
            } if isinstance(ports, dict) else {}
            if service == "web":
                mappings = published.get("8080/tcp")
                if set(published) != {"8080/tcp"} or not isinstance(mappings, list) or len(mappings) != 1 or not isinstance(mappings[0], dict) or not str(mappings[0].get("HostPort", "")).isdigit():
                    raise RuntimeCommandError("Existing Anote web port is ambiguous.", code="legacy_ambiguous")
                host_ip = str(mappings[0].get("HostIp") or "0.0.0.0")
                bind_address = "127.0.0.1" if host_ip in {"127.0.0.1", "::1"} else "0.0.0.0" if host_ip in {"0.0.0.0", "::", ""} else ""
                if not bind_address:
                    raise RuntimeCommandError("Existing Anote bind address is unsupported.", code="legacy_ambiguous")
                public_bindings.add((bind_address, int(mappings[0]["HostPort"])))
            elif published:
                raise RuntimeCommandError("Existing Anote API has an unexpected public port.", code="legacy_ambiguous")
            containers.append(LegacyContainer(
                service,
                container_id,
                image_reference,
                image_id,
                sha256("\n".join(sorted(environment)).encode("utf-8")).hexdigest(),
                isinstance(state, dict) and state.get("Running") is True,
            ))
        if services != {"api", "web"} or len(data_paths) != 1 or len(public_bindings) != 1 or len(network_names) != 1:
            raise RuntimeCommandError("Existing Anote data mount or public port is ambiguous.", code="legacy_ambiguous")
        network_name = next(iter(network_names))
        network_raw = self._run(
            ["docker", "network", "inspect", network_name],
            timeout=60,
            message="Existing Anote network dependents could not be inspected.",
        ).stdout
        try:
            network_rows = json.loads(network_raw)
        except json.JSONDecodeError as error:
            raise RuntimeCommandError("Existing Anote network information is unreadable.", code="docker_invalid_response") from error
        expected_ids = {container.container_id for container in containers}
        if not isinstance(network_rows, list) or len(network_rows) != 1 or not isinstance(network_rows[0], dict):
            raise RuntimeCommandError("Existing Anote network information is incomplete.", code="legacy_ambiguous")
        dependents = network_rows[0].get("Containers")
        if not isinstance(dependents, dict) or set(dependents) != expected_ids:
            raise RuntimeCommandError("Existing Anote network has extra or missing dependents.", code="legacy_ambiguous")
        bind_address, public_port = next(iter(public_bindings))
        return LegacyRuntime(
            project_name,
            tuple(sorted(containers, key=lambda item: item.service)),
            next(iter(data_paths)),
            public_port,
            bind_address,
            timezone,
            secret_key,
        )

    def stop_legacy(self, legacy: LegacyRuntime) -> None:
        if legacy.running_container_ids:
            self._run(["docker", "stop", *legacy.running_container_ids], timeout=300, message="Existing Anote containers could not be stopped.")

    def restore_legacy(self, legacy: LegacyRuntime) -> None:
        if legacy.running_container_ids:
            self._run(["docker", "start", *legacy.running_container_ids], timeout=300, message="Existing Anote containers could not be restored.")

    def retire_legacy(self, legacy: LegacyRuntime) -> None:
        existing: list[str] = []
        for container_id in legacy.container_ids:
            result = self.executor.run(["docker", "container", "inspect", container_id], timeout=60)
            if result.returncode == 0:
                existing.append(container_id)
            else:
                self.require_ready()
        if existing:
            self._run(
                ["docker", "container", "rm", *existing],
                timeout=300,
                message="The enrolled legacy Anote containers could not be retired.",
            )
