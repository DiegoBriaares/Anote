from __future__ import annotations

from collections import deque
from pathlib import Path
import threading
import time
from types import SimpleNamespace
from typing import Callable
import unittest
from unittest.mock import patch

from anote_control_center.gui import ControlCenterWindow


class _Variable:
    def __init__(self) -> None:
        self.value = ""

    def set(self, value: str) -> None:
        self.value = value


class _Progress:
    def __init__(self) -> None:
        self.value = 0

    def configure(self, *, value: int) -> None:
        self.value = value


class _Translator:
    @staticmethod
    def text(key: str) -> str:
        return key


class _Root:
    def __init__(self) -> None:
        self.callbacks: deque[Callable[[], None]] = deque()
        self.after_threads: list[int] = []
        self.next_id = 0

    def after(self, _delay: int, callback: Callable[[], None]) -> str:
        self.after_threads.append(threading.get_ident())
        self.callbacks.append(callback)
        self.next_id += 1
        return f"after-{self.next_id}"

    def drain_until(self, predicate: Callable[[], bool]) -> None:
        deadline = time.monotonic() + 2
        while not predicate():
            if self.callbacks:
                callback = self.callbacks.popleft()
                callback()
            elif time.monotonic() >= deadline:
                self.fail_timeout()
            else:
                time.sleep(0.001)

    @staticmethod
    def fail_timeout() -> None:
        raise AssertionError("The asynchronous UI operation did not finish.")


def _window() -> tuple[ControlCenterWindow, _Root, list[Exception]]:
    window = object.__new__(ControlCenterWindow)
    root = _Root()
    errors: list[Exception] = []
    window.root = root  # type: ignore[assignment]
    window.translator = _Translator()  # type: ignore[assignment]
    window.progress = _Progress()  # type: ignore[assignment]
    window.status = _Variable()  # type: ignore[assignment]
    window.password = _Variable()  # type: ignore[assignment]
    window.busy = False
    window.cancellable = False
    window._pending_operation = None
    window._set_controls = lambda: None  # type: ignore[method-assign]
    window._refresh_installation_view = lambda: None  # type: ignore[method-assign]
    window._show_error = errors.append  # type: ignore[method-assign]
    return window, root, errors


class GuiOperationTests(unittest.TestCase):
    def test_worker_failure_returns_to_ready_ui_on_main_thread(self) -> None:
        window, root, errors = _window()
        main_thread = threading.get_ident()
        worker_threads: list[int] = []
        expected = RuntimeError("preflight failed")

        def operation() -> object:
            worker_threads.append(threading.get_ident())
            raise expected

        window._run_async(operation, cancellable=False)
        root.drain_until(lambda: not window.busy)

        self.assertEqual(errors, [expected])
        self.assertEqual(window.status.value, "status.failed")  # type: ignore[attr-defined]
        self.assertEqual(window.progress.value, 100)  # type: ignore[attr-defined]
        self.assertEqual(len(worker_threads), 1)
        self.assertNotEqual(worker_threads[0], main_thread)
        self.assertEqual(set(root.after_threads), {main_thread})

    def test_success_callback_failure_returns_to_ready_ui(self) -> None:
        window, root, errors = _window()
        expected = RuntimeError("invalid discovery result")

        def reject_result(_value: object) -> None:
            raise expected

        window._run_async(
            lambda: (),
            on_success=reject_result,
            cancellable=False,
        )
        root.drain_until(lambda: not window.busy)

        self.assertEqual(errors, [expected])
        self.assertEqual(window.status.value, "status.failed")  # type: ignore[attr-defined]
        self.assertEqual(window.progress.value, 100)  # type: ignore[attr-defined]

    def test_worker_success_delivers_result_before_completing(self) -> None:
        window, root, errors = _window()
        received: list[object] = []

        window._run_async(
            lambda: 42,
            on_success=received.append,
            success_message=False,
            cancellable=False,
        )
        root.drain_until(lambda: not window.busy)

        self.assertEqual(received, [42])
        self.assertEqual(errors, [])
        self.assertEqual(window.status.value, "status.ready")  # type: ignore[attr-defined]
        self.assertEqual(window.progress.value, 100)  # type: ignore[attr-defined]

    def test_checkpoint_verification_and_apply_run_off_the_tk_thread(self) -> None:
        window, root, errors = _window()
        main_thread = threading.get_ident()
        verify_threads: list[int] = []
        apply_threads: list[int] = []
        dialog_threads: list[int] = []
        checkpoint = SimpleNamespace(manifest=SimpleNamespace(
            checkpoint_id="cp-1",
            dataset_id="dataset-1",
            parent_checkpoint_id=None,
            sequence=1,
        ))
        release = object()

        class _Checkpoints:
            @staticmethod
            def verify(_path: Path) -> object:
                verify_threads.append(threading.get_ident())
                return checkpoint

        class _Lifecycle:
            checkpoints = _Checkpoints()

            @staticmethod
            def apply_checkpoint(_checkpoint: object, _release: object, *, confirm_full_replace: bool) -> object:
                apply_threads.append(threading.get_ident())
                return confirm_full_replace

        window.application = SimpleNamespace(
            paths=SimpleNamespace(checkpoints=Path("/tmp/checkpoints")),
            lifecycle=_Lifecycle(),
            checkpoint_apply_intent=lambda *_args: SimpleNamespace(requires_full_replace_confirmation=False),
        )
        window._installed_release = lambda: release  # type: ignore[method-assign]

        with (
            patch("anote_control_center.gui.filedialog.askopenfilename", return_value="/tmp/input.anote-checkpoint"),
            patch("anote_control_center.gui.messagebox.showwarning", side_effect=lambda *_args, **_kwargs: dialog_threads.append(threading.get_ident())),
            patch("anote_control_center.gui.messagebox.showinfo"),
        ):
            window._apply_checkpoint()
            root.drain_until(lambda: len(apply_threads) == 1 and not window.busy)

        self.assertEqual(errors, [])
        self.assertEqual(len(verify_threads), 1)
        self.assertNotEqual(verify_threads[0], main_thread)
        self.assertEqual(len(apply_threads), 1)
        self.assertNotEqual(apply_threads[0], main_thread)
        self.assertEqual(dialog_threads, [main_thread])


if __name__ == "__main__":
    unittest.main()
