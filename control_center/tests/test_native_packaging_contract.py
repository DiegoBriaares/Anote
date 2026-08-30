from __future__ import annotations

import importlib.util
from pathlib import Path
import tomllib
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONTROL_CENTER_ROOT = REPOSITORY_ROOT / "control_center"


class NativePackagingContractTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
