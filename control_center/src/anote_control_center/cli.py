from __future__ import annotations

import argparse
from importlib import resources
from pathlib import Path
import sys
import tempfile

from . import __version__
from .application import load_application
from .errors import ControlCenterError
from .i18n import validate_catalogs
from .platform_paths import PlatformIdentity


def _platform(value: str | None) -> PlatformIdentity | None:
    if value is None:
        return None
    if value == "windows-amd64":
        return PlatformIdentity("windows", "x86_64")
    if value == "macos-arm64":
        return PlatformIdentity("macos", "arm64")
    raise argparse.ArgumentTypeError("platform must be windows-amd64 or macos-arm64")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(prog="anote-control-center")
    value.add_argument("--version", action="version", version=__version__)
    value.add_argument("--state-root", type=Path)
    value.add_argument("--host-platform", choices=("windows-amd64", "macos-arm64"))
    value.add_argument("--self-check", action="store_true")
    value.add_argument("--doctor", action="store_true")
    value.add_argument("--verify-release", type=Path)
    return value


def main(arguments: list[str] | None = None) -> int:
    options = parser().parse_args(arguments)
    try:
        platform_identity = _platform(options.host_platform)
        if options.self_check:
            validate_catalogs()
            compose = resources.files("anote_control_center").joinpath("runtime/compose.yaml")
            content = compose.read_text(encoding="utf-8")
            if "cap_drop:" not in content or "ANOTE_RELEASE_ID" not in content:
                raise ControlCenterError("Bundled runtime contract is incomplete.", code="self_check_failed")
            with tempfile.TemporaryDirectory(prefix="anote-control-center-self-check-") as directory:
                application = load_application(
                    state_root=Path(directory) / "state",
                    platform_identity=platform_identity,
                )
                if application.registry.load() is not None:
                    raise ControlCenterError("Self-check state root was not isolated.", code="self_check_failed")
            print(f"Anote Control Center {__version__}: self-check passed")
            return 0
        application = load_application(state_root=options.state_root, platform_identity=platform_identity)
        if options.doctor:
            application.runtime.require_ready()
            print("Docker Desktop is ready for this Anote platform.")
            return 0
        if options.verify_release:
            release = application.verify_release(options.verify_release)
            signature = f"signed:{release.signer_key_id}" if release.signed else "unsigned"
            print(
                f"{release.manifest.release_id} {release.manifest.version} "
                f"{release.manifest.platform.host_os}-{release.manifest.platform.host_architecture} {signature}"
            )
            return 0
        from .gui import run
        run(application)
        return 0
    except ControlCenterError as error:
        print(f"{error.code}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
