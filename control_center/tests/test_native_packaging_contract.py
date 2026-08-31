from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONTROL_CENTER_ROOT = REPOSITORY_ROOT / "control_center"


class NativePackagingContractTests(unittest.TestCase):
    def test_calendar_icon_is_reproducible_and_wired_to_both_native_packages(self) -> None:
        generator = CONTROL_CENTER_ROOT / "release" / "generate-icons.py"
        source = REPOSITORY_ROOT / "public" / "anote.svg"
        windows = (CONTROL_CENTER_ROOT / "release" / "build-windows.ps1").read_text(encoding="utf-8")
        macos = (CONTROL_CENTER_ROOT / "release" / "build-macos.sh").read_text(encoding="utf-8")
        installer = (CONTROL_CENTER_ROOT / "release" / "control-center.iss").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory(prefix="anote-icon-test-") as directory:
            output = Path(directory)
            subprocess.run(
                [sys.executable, str(generator), "--source", str(source), "--output", str(output)],
                check=True,
                timeout=60,
            )
            self.assertTrue((output / "icon-128.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertTrue((output / "anote-control-center.ico").read_bytes().startswith(b"\x00\x00\x01\x00"))

        for build in (windows, macos):
            self.assertIn("generate-icons.py", build)
            self.assertIn("--icon", build)
            self.assertIn("icon-128.png", build)
            self.assertIn("icon-512.png", build)
        self.assertIn("iconutil --convert icns", macos)
        self.assertIn("CFBundleIconFile", macos)
        self.assertIn('--add-data "$iconFile;anote_control_center/assets"', windows)
        self.assertIn("Copy-Item -LiteralPath $iconFile", windows)
        self.assertIn("SetupIconFile={#IconFile}", installer)
        self.assertEqual(installer.count('IconFilename: "{app}\\AnoteControlCenter.ico"'), 2)
        self.assertEqual(installer.count('AppUserModelID: "{#AppUserModelId}"'), 2)

    def test_runtime_and_distribution_versions_match(self) -> None:
        project = tomllib.loads((CONTROL_CENTER_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        package_path = CONTROL_CENTER_ROOT / "src" / "anote_control_center" / "__init__.py"
        spec = importlib.util.spec_from_file_location("anote_control_center_identity", package_path)
        assert spec is not None and spec.loader is not None
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)

        self.assertEqual(project["project"]["version"], package.__version__)

    def test_windows_build_uses_ci_python_and_bounds_packaged_self_check(self) -> None:
        build_script = (CONTROL_CENTER_ROOT / "release" / "build-windows.ps1").read_text(encoding="utf-8")

        self.assertNotIn("py -3", build_script)
        self.assertIn("Get-Command python -CommandType Application", build_script)
        self.assertIn("Select-Object -First 1 -ExpandProperty Source", build_script)
        self.assertIn("WaitForExit(60000)", build_script)
        self.assertIn("Stop-Process -Id $check.Id -Force", build_script)

    def test_windows_ci_bounds_build_install_check_and_uninstall(self) -> None:
        workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "anote-control-center-packages.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("Build, inspect, and self-check Windows installer\n        shell: pwsh\n        timeout-minutes: 10", workflow)
        self.assertIn("Install, self-check, and uninstall exact package\n        shell: pwsh\n        timeout-minutes: 5", workflow)
        self.assertIn("Invoke-CheckedProcess", workflow)
        self.assertIn("TimeoutSeconds 60", workflow)
        self.assertIn("Installed launcher does not own the Anote calendar icon.", workflow)
        self.assertIn('ExtendedProperty("System.AppUserModel.ID")', workflow)
        self.assertIn("Installed launcher does not own the Anote application identity.", workflow)

    def test_macos_bundle_metadata_and_runtime_share_one_version(self) -> None:
        build_script = (CONTROL_CENTER_ROOT / "release" / "build-macos.sh").read_text(encoding="utf-8")

        self.assertIn("Set :CFBundleShortVersionString $package_version", build_script)
        self.assertIn("Add :CFBundleVersion string $package_version", build_script)
        self.assertIn('bundle_short_version" != "$package_version"', build_script)
        self.assertIn('bundle_build_version" != "$package_version"', build_script)
        self.assertIn('codesign --force --deep --sign - "$app_path"', build_script)

    def test_native_packages_bundle_pinned_cross_platform_timezone_data(self) -> None:
        project = tomllib.loads((CONTROL_CENTER_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        windows = (CONTROL_CENTER_ROOT / "release" / "build-windows.ps1").read_text(encoding="utf-8")
        macos = (CONTROL_CENTER_ROOT / "release" / "build-macos.sh").read_text(encoding="utf-8")
        verification = (
            REPOSITORY_ROOT / ".github" / "workflows" / "anote-control-center-verify.yml"
        ).read_text(encoding="utf-8")
        cli = (CONTROL_CENTER_ROOT / "src" / "anote_control_center" / "cli.py").read_text(encoding="utf-8")

        self.assertIn("tzdata==2026.3", project["project"]["dependencies"])
        for source in (windows, macos, verification):
            self.assertIn("tzdata", source)
            self.assertIn("2026.3", source)
        self.assertIn('validate_timezone("America/Mexico_City")', cli)

    def test_tag_publication_is_exact_bounded_and_does_not_publish_validation_runs(self) -> None:
        application = (REPOSITORY_ROOT / ".github" / "workflows" / "anote-application-release.yml").read_text(
            encoding="utf-8"
        )
        control_center = (
            REPOSITORY_ROOT / ".github" / "workflows" / "anote-control-center-packages.yml"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/anote-v')",
            application,
        )
        self.assertIn(
            "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/anote-control-center-v')",
            control_center,
        )
        for workflow, upload_count in ((application, 2), (control_center, 2)):
            self.assertEqual(workflow.count("retention-days: 1"), upload_count)
            self.assertNotIn("retention-days: 14", workflow)
            self.assertIn("actions: write", workflow)
            self.assertEqual(workflow.count("contents: write"), 1)
            self.assertIn("scripts/release/publish_tag_release.py", workflow)
            self.assertIn("Remove successful run transfer artifacts", workflow)
            self.assertIn("actions/runs/$GITHUB_RUN_ID/artifacts?per_page=100", workflow)


if __name__ == "__main__":
    unittest.main()
