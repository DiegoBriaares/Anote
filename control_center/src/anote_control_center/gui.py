from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from typing import Callable, cast

from .application import CheckpointApplyIntent, ControlCenterApplication, INTERACTION_IDS
from .checkpoints import VerifiedCheckpoint
from .errors import ControlCenterError
from .i18n import Translator
from .lifecycle import ERASE_CONFIRMATION
from .releases import ReleaseCandidate, VerifiedRelease
from .storage import ensure_private_directory


def _detected_timezone() -> str:
    environment = os.environ.get("TZ")
    if environment and "/" in environment:
        return environment
    zone = getattr(datetime.now().astimezone().tzinfo, "key", None)
    if isinstance(zone, str) and zone:
        return zone
    localtime = Path("/etc/localtime")
    if localtime.is_symlink():
        target = localtime.resolve(strict=False).as_posix()
        marker = "/zoneinfo/"
        if marker in target:
            return target.split(marker, 1)[1]
    return "UTC"


class ControlCenterWindow:
    def __init__(self, application: ControlCenterApplication, root: tk.Tk | None = None) -> None:
        self.application = application
        self.root = root or tk.Tk()
        self.translator = Translator("en")
        self.busy = False
        self.cancellable = False
        self._pending_operation: str | None = None
        self.widgets: dict[str, ttk.Button] = {}
        self.candidates: tuple[ReleaseCandidate, ...] = ()
        self.release_by_label: dict[str, VerifiedRelease] = {}
        self.language_choice = tk.StringVar(value="English")
        self.release_choice = tk.StringVar()
        self.username = tk.StringVar()
        self.password = tk.StringVar()
        self.timezone = tk.StringVar(value=_detected_timezone())
        self.port = tk.StringVar()
        self.erase_confirmation = tk.StringVar()
        self.status = tk.StringVar()
        self.release_status = tk.StringVar()
        self.installation_status = tk.StringVar()
        self.setup_guidance = tk.StringVar()
        self.root.geometry("900x680")
        self.root.minsize(760, 600)
        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self._build()
        self._run_async(
            self._discover_releases,
            on_success=self._accept_discovered_releases,
            success_message=False,
            cancellable=False,
        )

    def _build(self) -> None:
        selected_tab = 0
        old = getattr(self, "notebook", None)
        if old is not None:
            selected_tab = old.index(old.select())
            old.master.destroy()
        self.widgets = {}
        text = self.translator.text
        self.root.title(text("app.title"))
        container = ttk.Frame(self.root, padding=18)
        container.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        container.columnconfigure(0, weight=1)
        container.rowconfigure(2, weight=1)

        header = ttk.Frame(container)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text=text("app.title"), font=("TkDefaultFont", 18, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(header, text=text("app.subtitle")).grid(row=1, column=0, sticky="w", pady=(3, 0))
        language = ttk.Frame(header)
        language.grid(row=0, column=1, rowspan=2, sticky="e")
        ttk.Label(language, text=text("language.label")).grid(row=0, column=0, padx=(0, 8))
        chooser = ttk.Combobox(
            language,
            state="readonly",
            width=12,
            textvariable=self.language_choice,
            values=(text("language.english"), text("language.spanish")),
        )
        chooser.grid(row=0, column=1)
        chooser.bind("<<ComboboxSelected>>", self._change_language)
        self.language_box = chooser

        release_bar = ttk.LabelFrame(container, text=text("release.label"), padding=10)
        release_bar.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        release_bar.columnconfigure(0, weight=1)
        self.release_box = ttk.Combobox(release_bar, state="readonly", textvariable=self.release_choice)
        self.release_box.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.release_box.bind("<<ComboboxSelected>>", lambda _event: self._refresh_release_status())
        self._button(release_bar, text("release.refresh"), self._refresh_releases, "release.refresh").grid(row=0, column=1, padx=4)
        self._button(release_bar, text("release.open_inbox"), lambda: self._open(self.application.paths.release_inbox), "release.open-inbox").grid(row=0, column=2, padx=(4, 0))
        ttk.Label(release_bar, textvariable=self.release_status).grid(row=1, column=0, columnspan=3, sticky="w", pady=(7, 0))

        self.notebook = ttk.Notebook(container)
        self.notebook.grid(row=2, column=0, sticky="nsew")
        setup = ttk.Frame(self.notebook, padding=16)
        updates = ttk.Frame(self.notebook, padding=16)
        orchestra = ttk.Frame(self.notebook, padding=16)
        uninstall = ttk.Frame(self.notebook, padding=16)
        self.notebook.add(setup, text=text("tab.setup"))
        self.notebook.add(updates, text=text("tab.updates"))
        self.notebook.add(orchestra, text=text("tab.orchestra"))
        self.notebook.add(uninstall, text=text("tab.uninstall"))
        for frame, interaction_id in zip(
            (setup, updates, orchestra, uninstall),
            ("nav.setup", "nav.updates", "nav.orchestra", "nav.uninstall"),
            strict=True,
        ):
            setattr(frame, "interaction_id", interaction_id)
        self._build_setup(setup)
        self._build_updates(updates)
        self._build_orchestra(orchestra)
        self._build_uninstall(uninstall)
        self.notebook.select(min(selected_tab, 3))

        footer = ttk.Frame(container)
        footer.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        footer.columnconfigure(1, weight=1)
        self.progress = ttk.Progressbar(footer, mode="determinate", maximum=100, length=120)
        self.progress.grid(row=0, column=0, padx=(0, 10))
        ttk.Label(footer, textvariable=self.status).grid(row=0, column=1, sticky="w")
        self._button(footer, text("status.cancel"), self._cancel_pending, "operation.cancel").grid(row=0, column=2, padx=(0, 8))
        self._button(footer, text("diagnostics.save"), self._copy_diagnostics, "diagnostics.copy").grid(row=0, column=3)
        self.status.set(text("status.ready"))
        self._refresh_release_box()
        self._refresh_installation_view()
        self._set_controls()

    def _build_setup(self, parent: ttk.Frame) -> None:
        text = self.translator.text
        parent.columnconfigure(1, weight=1)
        ttk.Label(parent, text=text("setup.heading"), font=("TkDefaultFont", 14, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(parent, textvariable=self.setup_guidance, wraplength=690).grid(row=1, column=0, columnspan=2, sticky="w", pady=(5, 16))
        fields = (
            ("setup.username", self.username, False),
            ("setup.password", self.password, True),
            ("setup.timezone", self.timezone, False),
            ("setup.port", self.port, False),
        )
        for row, (label, variable, secret) in enumerate(fields, start=2):
            ttk.Label(parent, text=text(label)).grid(row=row, column=0, sticky="w", padx=(0, 12), pady=5)
            entry = ttk.Entry(parent, textvariable=variable, show="•" if secret else "")
            entry.grid(row=row, column=1, sticky="ew", pady=5)
        ttk.Label(parent, text=text("setup.secret_notice"), wraplength=690).grid(row=6, column=0, columnspan=2, sticky="w", pady=(5, 16))
        actions = ttk.Frame(parent)
        actions.grid(row=7, column=0, columnspan=2, sticky="w")
        self._button(actions, text("setup.fresh"), self._fresh_source, "setup.install-source").grid(row=0, column=0, padx=(0, 8), pady=4)
        self._button(actions, text("setup.standby"), self._prepare_standby, "setup.prepare-standby").grid(row=0, column=1, padx=8, pady=4)
        self._button(actions, text("setup.adopt"), self._adopt, "setup.adopt-legacy").grid(row=1, column=0, padx=(0, 8), pady=4)
        self._button(actions, text("setup.reinstall"), self._reinstall, "setup.reinstall-retained").grid(row=1, column=1, padx=8, pady=4)

    def _build_updates(self, parent: ttk.Frame) -> None:
        text = self.translator.text
        ttk.Label(parent, text=text("updates.heading"), font=("TkDefaultFont", 14, "bold")).pack(anchor="w")
        ttk.Label(parent, text=text("updates.description"), wraplength=690).pack(anchor="w", pady=(5, 18))
        self._button(parent, text("updates.apply"), self._update, "updates.apply-source").pack(anchor="w", pady=(0, 8))
        self._button(parent, text("updates.stage"), self._update, "updates.stage-standby").pack(anchor="w")

    def _build_orchestra(self, parent: ttk.Frame) -> None:
        text = self.translator.text
        ttk.Label(parent, text=text("orchestra.heading"), font=("TkDefaultFont", 14, "bold")).pack(anchor="w")
        ttk.Label(parent, textvariable=self.installation_status, justify="left").pack(anchor="w", pady=(8, 18))
        actions = ttk.Frame(parent)
        actions.pack(anchor="w", fill="x")
        items = (
            ("orchestra.start", self._start, "orchestra.start"),
            ("orchestra.stop", self._stop, "orchestra.stop"),
            ("orchestra.create_checkpoint", self._create_checkpoint, "orchestra.create-checkpoint"),
            ("orchestra.apply_checkpoint", self._apply_checkpoint, "orchestra.apply-checkpoint"),
            ("orchestra.recover", self._recover, "orchestra.recover"),
            ("orchestra.open_data", lambda: self._open(self.application.paths.data), "orchestra.open-data"),
            ("orchestra.open_backups", lambda: self._open(self.application.paths.backups), "orchestra.open-backups"),
            ("orchestra.open_checkpoints", lambda: self._open(self.application.paths.checkpoints), "orchestra.open-checkpoints"),
        )
        for index, (label, command, interaction_id) in enumerate(items):
            self._button(actions, text(label), command, interaction_id).grid(
                row=index // 2, column=index % 2, sticky="w", padx=(0, 12), pady=5,
            )

    def _build_uninstall(self, parent: ttk.Frame) -> None:
        text = self.translator.text
        parent.columnconfigure(0, weight=1)
        ttk.Label(parent, text=text("uninstall.heading"), font=("TkDefaultFont", 14, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(parent, text=text("uninstall.safe_description"), wraplength=690).grid(row=1, column=0, sticky="w", pady=(8, 8))
        self._button(parent, text("uninstall.safe"), self._safe_uninstall, "uninstall.keep-data").grid(row=2, column=0, sticky="w")
        ttk.Separator(parent).grid(row=3, column=0, sticky="ew", pady=20)
        ttk.Label(parent, text=text("uninstall.erase_description"), wraplength=690).grid(row=4, column=0, sticky="w", pady=(0, 8))
        ttk.Label(parent, text=text("uninstall.erase_label")).grid(row=5, column=0, sticky="w")
        ttk.Entry(parent, textvariable=self.erase_confirmation, width=28).grid(row=6, column=0, sticky="w", pady=(5, 10))
        self._button(parent, text("uninstall.erase"), self._erase, "uninstall.erase").grid(row=7, column=0, sticky="w")

    def _button(self, parent: tk.Misc, label: str, command: Callable[[], None], interaction_id: str) -> ttk.Button:
        if interaction_id not in INTERACTION_IDS or interaction_id in self.widgets:
            raise RuntimeError(f"Invalid or duplicate interaction ID: {interaction_id}")
        def guarded() -> None:
            try:
                command()
            except Exception as error:
                self._show_error(error)

        button = ttk.Button(parent, text=label, command=guarded)
        setattr(button, "interaction_id", interaction_id)
        self.widgets[interaction_id] = button
        return button

    def _change_language(self, _event: object) -> None:
        selected = self.language_choice.get()
        self.translator.language = "es" if selected in {"Español", self.translator.text("language.spanish")} else "en"
        self.language_choice.set(self.translator.text("language.spanish" if self.translator.language == "es" else "language.english"))
        self._build()

    def _discover_releases(self) -> tuple[ReleaseCandidate, ...]:
        return self.application.releases.discover()

    def _accept_discovered_releases(self, result: object) -> None:
        if not isinstance(result, tuple) or not all(isinstance(item, ReleaseCandidate) for item in result):
            raise RuntimeError("Release discovery returned an invalid result.")
        self._accept_candidates(result)

    def _accept_candidates(self, candidates: tuple[ReleaseCandidate, ...]) -> None:
        previous = self.release_choice.get()
        self.candidates = candidates
        self.release_by_label = {}
        for candidate in candidates:
            if candidate.release is not None:
                release = candidate.release
                label = f"{release.manifest.version} · {candidate.path.name}"
                self.release_by_label[label] = release
        self._refresh_release_box(previous)
        self._refresh_installation_view()

    def _refresh_release_box(self, previous: str | None = None) -> None:
        if not hasattr(self, "release_box"):
            return
        values = tuple(self.release_by_label)
        self.release_box.configure(values=values)
        if previous in self.release_by_label:
            self.release_choice.set(previous or "")
        elif values:
            self.release_choice.set(values[0])
        else:
            self.release_choice.set("")
        self._refresh_release_status()

    def _refresh_release_status(self) -> None:
        release = self.release_by_label.get(self.release_choice.get())
        if release is None:
            self.release_status.set(self.translator.text("release.none"))
        elif release.signed:
            self.release_status.set(self.translator.text("release.signed", key_id=release.signer_key_id or ""))
        else:
            self.release_status.set(self.translator.text("release.unsigned"))
        self._set_controls()

    def _selected_release(self) -> VerifiedRelease:
        release = self.release_by_label.get(self.release_choice.get())
        if release is None:
            raise ControlCenterError(self.translator.text("release.none"), code="invalid_release")
        return release

    def _installed_release(self) -> VerifiedRelease:
        return self.application.installed_release(tuple(self.release_by_label.values()))

    def _parse_port(self) -> int | None:
        value = self.port.get().strip()
        if not value:
            return None
        try:
            return int(value)
        except ValueError as error:
            raise ControlCenterError("Public port must be a number.", code="invalid_setup_input") from error

    def _fresh_source(self) -> None:
        release = self._selected_release()
        username, password, timezone, port = self.username.get(), self.password.get(), self.timezone.get(), self._parse_port()
        self._run_async(lambda: self.application.lifecycle.fresh_source(
            release, username=username, password=password, timezone=timezone, public_port=port,
        ))

    def _prepare_standby(self) -> None:
        release = self._selected_release()
        timezone, port = self.timezone.get(), self._parse_port()
        self._run_async(lambda: self.application.lifecycle.prepare_standby(release, timezone=timezone, public_port=port))

    def _adopt(self) -> None:
        release = self._selected_release()
        timezone = self.timezone.get()
        self._run_async(lambda: self.application.lifecycle.adopt_legacy(release, timezone=timezone))

    def _reinstall(self) -> None:
        release = self._selected_release()
        self._run_async(lambda: self.application.lifecycle.reinstall_retained(release))

    def _update(self) -> None:
        release = self._selected_release()
        change = self.application.release_change(release)
        confirm = False
        if change.requires_confirmation:
            confirm = messagebox.askyesno(
                self.translator.text("updates.confirm_title"),
                self.translator.text("updates.confirm_non_newer"),
                parent=self.root,
            )
            if not confirm:
                return
        self._run_async(lambda: self.application.lifecycle.update(release, confirm_non_newer=confirm))

    def _start(self) -> None:
        confirmed = messagebox.askyesno(
            self.translator.text("orchestra.start_confirm_title"),
            self.translator.text("orchestra.start_confirm"),
            parent=self.root,
        )
        if confirmed:
            self._run_async(lambda: self.application.lifecycle.start(confirm_exclusive=True))

    def _stop(self) -> None:
        self._run_async(self.application.lifecycle.stop)

    def _recover(self) -> None:
        self._run_async(self.application.lifecycle.recover_interrupted)

    def _create_checkpoint(self) -> None:
        ensure_private_directory(self.application.paths.checkpoints)
        selected = filedialog.asksaveasfilename(
            parent=self.root,
            title=self.translator.text("orchestra.create_checkpoint"),
            initialdir=self.application.paths.checkpoints,
            defaultextension=".anote-checkpoint",
            filetypes=((self.translator.text("file.checkpoint"), "*.anote-checkpoint"),),
        )
        if selected:
            self._run_async(lambda: self.application.lifecycle.create_checkpoint(Path(selected)))

    def _apply_checkpoint(self) -> None:
        selected = filedialog.askopenfilename(
            parent=self.root,
            title=self.translator.text("orchestra.apply_checkpoint"),
            initialdir=self.application.paths.checkpoints,
            filetypes=((self.translator.text("file.checkpoint"), "*.anote-checkpoint"),),
        )
        if selected:
            def verify() -> tuple[VerifiedCheckpoint, VerifiedRelease, CheckpointApplyIntent]:
                checkpoint = self.application.lifecycle.checkpoints.verify(Path(selected))
                release = self._installed_release()
                intent = self.application.checkpoint_apply_intent(
                    checkpoint.manifest.checkpoint_id,
                    checkpoint.manifest.dataset_id,
                    checkpoint.manifest.parent_checkpoint_id,
                    checkpoint.manifest.sequence,
                )
                return checkpoint, release, intent

            def confirm_and_apply(result: object) -> None:
                checkpoint, release, intent = cast(
                    tuple[VerifiedCheckpoint, VerifiedRelease, CheckpointApplyIntent],
                    result,
                )
                confirm = False
                if intent.requires_full_replace_confirmation:
                    confirm = messagebox.askyesno(
                        self.translator.text("checkpoint.replace_title"),
                        self.translator.text("checkpoint.replace_body"),
                        parent=self.root,
                    )
                    if not confirm:
                        return
                messagebox.showwarning(
                    self.translator.text("dialog.success_title"),
                    self.translator.text("checkpoint.media_warning"),
                    parent=self.root,
                )
                self.root.after(0, lambda: self._run_async(lambda: self.application.lifecycle.apply_checkpoint(
                    checkpoint,
                    release,
                    confirm_full_replace=confirm,
                )))

            self._run_async(
                verify,
                on_success=confirm_and_apply,
                success_message=False,
                cancellable=False,
            )

    def _safe_uninstall(self) -> None:
        release: VerifiedRelease | None
        try:
            release = self._installed_release()
        except ControlCenterError:
            release = None
        self._run_async(lambda: self.application.lifecycle.safe_uninstall(release))

    def _erase(self) -> None:
        if self.erase_confirmation.get() != ERASE_CONFIRMATION:
            self._show_error(ControlCenterError("Confirmation is required.", code="erase_confirmation_required"))
            return
        targets = []
        for target in self.application.erase_targets():
            kind, separator, value = target.partition(": ")
            if not separator:
                raise ControlCenterError("Erase target is invalid.", code="unsafe_owned_path")
            targets.append(self.translator.text(f"uninstall.target.{kind}", value=value))
        if not messagebox.askyesno(
            self.translator.text("uninstall.confirm_title"),
            self.translator.text(
                "uninstall.confirm_body",
                targets="\n".join(targets),
            ),
            parent=self.root,
        ):
            return
        confirmation = self.erase_confirmation.get()
        self._run_async(lambda: self.application.lifecycle.erase_all(confirmation))

    def _open(self, path: Path) -> None:
        ensure_private_directory(path)
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["open", str(path)])

    def _copy_diagnostics(self) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(self.application.diagnostics())
        self.status.set(self.translator.text("diagnostics.title"))

    def _refresh_releases(self) -> None:
        self._run_async(
            self._discover_releases,
            on_success=self._accept_discovered_releases,
            success_message=False,
            cancellable=False,
        )

    def _run_async(
        self,
        operation: Callable[[], object],
        *,
        on_success: Callable[[object], None] | None = None,
        success_message: bool = True,
        cancellable: bool = True,
    ) -> None:
        if self.busy:
            return
        self.busy = True
        self.cancellable = cancellable
        self.progress.configure(value=10)
        self.status.set(self.translator.text("status.preflight" if cancellable else "status.working"))
        self._set_controls()

        def begin() -> None:
            self._pending_operation = None
            self.cancellable = False
            self.progress.configure(value=35 if cancellable else 50)
            self.status.set(self.translator.text("status.protected" if cancellable else "status.working"))
            self._set_controls()
            results: Queue[tuple[object | None, Exception | None]] = Queue(maxsize=1)

            def worker() -> None:
                try:
                    results.put((operation(), None))
                except Exception as error:
                    results.put((None, error))

            threading.Thread(target=worker, daemon=True, name="anote-control-center-operation").start()
            self.root.after(25, lambda: self._poll_operation(results, on_success, success_message))

        if cancellable:
            self._pending_operation = self.root.after(750, begin)
        else:
            begin()

    def _poll_operation(
        self,
        results: Queue[tuple[object | None, Exception | None]],
        on_success: Callable[[object], None] | None,
        success_message: bool,
    ) -> None:
        try:
            value, error = results.get_nowait()
        except Empty:
            self.root.after(25, lambda: self._poll_operation(results, on_success, success_message))
            return
        if error is not None:
            self._finish_error(error)
            return
        try:
            if on_success is not None:
                on_success(value)
        except Exception as callback_error:
            self._finish_error(callback_error)
            return
        self._finish_success(success_message)

    def _cancel_pending(self) -> None:
        if not self.busy or not self.cancellable or self._pending_operation is None:
            return
        self.root.after_cancel(self._pending_operation)
        self._pending_operation = None
        self.cancellable = False
        self.busy = False
        self.progress.configure(value=0)
        self.password.set("")
        self.status.set(self.translator.text("status.cancelled"))
        self._set_controls()

    def _finish_success(self, show_message: bool) -> None:
        self.busy = False
        self.cancellable = False
        self.progress.configure(value=100)
        self.password.set("")
        self.status.set(self.translator.text("status.complete" if show_message else "status.ready"))
        self._refresh_installation_view()
        self._set_controls()
        if show_message:
            messagebox.showinfo(
                self.translator.text("dialog.success_title"),
                self.translator.text("dialog.success"),
                parent=self.root,
            )

    def _finish_error(self, error: Exception) -> None:
        self.busy = False
        self.cancellable = False
        self.progress.configure(value=100)
        self.password.set("")
        self.status.set(self.translator.text("status.failed"))
        self._refresh_installation_view()
        self._set_controls()
        self._show_error(error)

    def _show_error(self, error: Exception) -> None:
        code = error.code if isinstance(error, ControlCenterError) else "default"
        messagebox.showerror(
            self.translator.text("dialog.error_title"),
            self.translator.error(code),
            parent=self.root,
        )

    def _refresh_installation_view(self) -> None:
        read_model = self.application.read_model(
            release_available=self.release_by_label.get(self.release_choice.get()) is not None,
            operation_cancellable=self.busy and self.cancellable,
        )
        installation = read_model.installation
        text = self.translator.text
        self.setup_guidance.set(text(f"setup.guidance.{read_model.setup_guidance_code}"))
        if installation is None:
            self.installation_status.set(text("orchestra.not_installed"))
            self._set_controls()
            return
        role = text(f"role.{installation.role}")
        state = text(f"state.{installation.state}")
        checkpoint = installation.last_checkpoint_id or text("common.none")
        self.installation_status.set("\n".join((
            text("orchestra.role", role=role),
            text("orchestra.release", version=installation.version),
            text("orchestra.state", state=state),
            text("orchestra.address", address=installation.address),
            text("orchestra.checkpoint", checkpoint=checkpoint),
        )))
        self._set_controls()

    def _set_controls(self) -> None:
        if not self.widgets:
            return
        release_available = self.release_by_label.get(self.release_choice.get()) is not None
        read_model = self.application.read_model(
            release_available=release_available,
            operation_cancellable=self.busy and self.cancellable,
        )
        for interaction_id, widget in self.widgets.items():
            availability = read_model.action(interaction_id)
            enabled = availability.enabled and (not self.busy or interaction_id == "operation.cancel")
            widget.configure(state="normal" if enabled else "disabled")
        self.language_box.configure(state="disabled" if self.busy else "readonly")
        self.release_box.configure(state="disabled" if self.busy else "readonly")

    def _close(self) -> None:
        if self.busy:
            messagebox.showwarning(
                self.translator.text("dialog.error_title"),
                self.translator.text("dialog.close_blocked"),
                parent=self.root,
            )
            return
        self.root.destroy()


def run(application: ControlCenterApplication) -> None:
    window = ControlCenterWindow(application)
    window.root.mainloop()
