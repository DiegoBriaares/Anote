from __future__ import annotations

import ctypes
from ctypes.util import find_library
from pathlib import Path
import sys
from tkinter import TclError
from typing import Any, Callable


WINDOWS_APP_USER_MODEL_ID = "Anote.ControlCenter"


def asset_path(name: str) -> Path:
    return Path(__file__).resolve().parent / "assets" / name


def prepare_process_identity(
    *,
    platform_name: str | None = None,
    windows_setter: Callable[[str], int] | None = None,
) -> bool:
    """Assign the Windows taskbar identity before Tk creates any UI."""
    if (platform_name or sys.platform) != "win32":
        return False
    try:
        setter = windows_setter or ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID
        return setter(WINDOWS_APP_USER_MODEL_ID) == 0
    except (AttributeError, OSError):
        return False


def _macos_set_application_icon(image_path: Path) -> bool:
    try:
        appkit_path = find_library("AppKit")
        objc_path = find_library("objc")
        if not appkit_path or not objc_path:
            return False
        ctypes.cdll.LoadLibrary(appkit_path)
        objc = ctypes.cdll.LoadLibrary(objc_path)
        objc.objc_getClass.argtypes = [ctypes.c_char_p]
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        message_address = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value
        if message_address is None:
            return False

        def send(receiver: int, selector: bytes, *arguments: int) -> int:
            signature = ctypes.CFUNCTYPE(
                ctypes.c_void_p,
                ctypes.c_void_p,
                ctypes.c_void_p,
                *([ctypes.c_void_p] * len(arguments)),
            )
            result = signature(message_address)(receiver, objc.sel_registerName(selector), *arguments)
            return int(result or 0)

        def send_void(receiver: int, selector: bytes, *arguments: int) -> None:
            signature = ctypes.CFUNCTYPE(
                None,
                ctypes.c_void_p,
                ctypes.c_void_p,
                *([ctypes.c_void_p] * len(arguments)),
            )
            signature(message_address)(receiver, objc.sel_registerName(selector), *arguments)

        application_class = int(objc.objc_getClass(b"NSApplication") or 0)
        string_class = int(objc.objc_getClass(b"NSString") or 0)
        image_class = int(objc.objc_getClass(b"NSImage") or 0)
        if not application_class or not string_class or not image_class:
            return False
        application = send(application_class, b"sharedApplication")
        encoded_path = ctypes.c_char_p(str(image_path).encode("utf-8"))
        native_path = send(
            string_class,
            b"stringWithUTF8String:",
            int(ctypes.cast(encoded_path, ctypes.c_void_p).value or 0),
        )
        image = send(send(image_class, b"alloc"), b"initWithContentsOfFile:", native_path)
        if not application or not image:
            return False
        send_void(application, b"setApplicationIconImage:", image)
        send_void(image, b"release")
        return True
    except (AttributeError, OSError, TypeError, ValueError):
        return False


def apply_window_identity(
    root: Any,
    photo_factory: Callable[..., Any],
    *,
    platform_name: str | None = None,
    macos_setter: Callable[[Path], bool] | None = None,
) -> Any | None:
    """Apply the owned glyph to the live window and native app surface."""
    platform = platform_name or sys.platform
    if platform == "win32":
        ico = asset_path("anote-control-center.ico")
        if ico.is_file():
            try:
                root.iconbitmap(default=str(ico))
            except TclError:
                pass

    photo = None
    png = asset_path("icon-128.png")
    if png.is_file():
        try:
            photo = photo_factory(file=png)
            root.iconphoto(True, photo)
        except TclError:
            photo = None

    if platform == "darwin":
        dock_icon = asset_path("icon-512.png")
        if dock_icon.is_file():
            (macos_setter or _macos_set_application_icon)(dock_icon)
    return photo
