from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "acceptance" / "full_docker_lifecycle.py"
SPEC = importlib.util.spec_from_file_location("anote_full_docker_lifecycle", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
ACCEPTANCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCEPTANCE)


class AcceptanceSafetyTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "Creating a Windows symlink requires optional privileges")
    def test_work_root_rejects_a_symlink_before_canonicalization(self) -> None:
        temporary = Path(tempfile.gettempdir())
        target = Path(tempfile.mkdtemp(prefix="anote-control-center-acceptance-target-"))
        link = temporary / f"{ACCEPTANCE.WORK_PREFIX}link-{os.urandom(5).hex()}"
        link.symlink_to(target, target_is_directory=True)
        try:
            with self.assertRaises(SystemExit):
                ACCEPTANCE.require_safe_work_root(link)
            self.assertTrue(target.is_dir())
        finally:
            link.unlink(missing_ok=True)
            target.rmdir()


if __name__ == "__main__":
    unittest.main()
