from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from anote_control_center.desktop_identity import (
    WINDOWS_APP_USER_MODEL_ID,
    apply_window_identity,
    prepare_process_identity,
)


class FakeRoot:
    def __init__(self) -> None:
        self.bitmap: str | None = None
        self.photo: object | None = None

    def iconbitmap(self, *, default: str) -> None:
        self.bitmap = default

    def iconphoto(self, _default: bool, photo: object) -> None:
        self.photo = photo


class DesktopIdentityTests(unittest.TestCase):
    def test_windows_process_identity_is_assigned_before_ui_creation(self) -> None:
        assigned: list[str] = []

        self.assertTrue(prepare_process_identity(
            platform_name="win32",
            windows_setter=lambda value: assigned.append(value) or 0,
        ))
        self.assertEqual(assigned, [WINDOWS_APP_USER_MODEL_ID])
        self.assertFalse(prepare_process_identity(platform_name="darwin", windows_setter=lambda _value: 0))

    def test_windows_window_uses_packaged_ico_and_png(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anote-desktop-identity-") as directory:
            root_path = Path(directory)
            for name in ("anote-control-center.ico", "icon-128.png"):
                (root_path / name).write_bytes(b"owned-icon")
            root = FakeRoot()
            created: list[Path] = []

            with patch(
                "anote_control_center.desktop_identity.asset_path",
                side_effect=lambda name: root_path / name,
            ):
                photo = apply_window_identity(
                    root,
                    lambda **options: created.append(options["file"]) or object(),
                    platform_name="win32",
                )

            self.assertEqual(root.bitmap, str(root_path / "anote-control-center.ico"))
            self.assertEqual(created, [root_path / "icon-128.png"])
            self.assertIs(root.photo, photo)

    def test_macos_window_sets_the_native_dock_icon(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anote-desktop-identity-") as directory:
            root_path = Path(directory)
            for name in ("icon-128.png", "icon-512.png"):
                (root_path / name).write_bytes(b"owned-icon")
            root = FakeRoot()
            dock_icons: list[Path] = []

            with patch(
                "anote_control_center.desktop_identity.asset_path",
                side_effect=lambda name: root_path / name,
            ):
                apply_window_identity(
                    root,
                    lambda **_options: object(),
                    platform_name="darwin",
                    macos_setter=lambda path: dock_icons.append(path) or True,
                )

            self.assertEqual(dock_icons, [root_path / "icon-512.png"])


if __name__ == "__main__":
    unittest.main()
