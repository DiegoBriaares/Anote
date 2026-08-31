# Anote Control Center

Anote Control Center is a payload-free Python/Tk desktop application. It enrolls one Anote installation, verifies local `.anote-release` packages before Docker sees them, journals every mutation, and leaves production stopped after setup, adoption, update, checkpoint apply, recovery, and reinstall. Docker Desktop is the only target-machine prerequisite.

## Developer verification

From the repository root:

```sh
PYTHONPATH=control_center/src python3 -m unittest discover -s control_center/tests -v
PYTHONPATH=control_center/src python3 -m anote_control_center.cli --self-check --host-platform macos-arm64
```

The self-check uses a temporary isolated state root and never contacts Docker. `--verify-release PATH` validates one local package. `--doctor` is the only diagnostic command that contacts Docker.

The destructive native release gate is executable and deliberately separate
from unit verification. It accepts only a uniquely prefixed direct child of the
system temporary directory, uses isolated registry/data/Compose identities,
and removes it only after every workflow succeeds:

```sh
PYTHONPATH=control_center/src python3 control_center/acceptance/full_docker_lifecycle.py \
  --previous-release /path/to/anote-1.0.0-macos-arm64.anote-release \
  --current-release /path/to/anote-1.0.1-macos-arm64.anote-release \
  --work-root "${TMPDIR%/}/anote-control-center-acceptance-unique" \
  --acknowledge-ephemeral-destruction 'ERASE DISPOSABLE ANOTE'
```

It covers fresh setup, explicit start/stop and same-origin health, checkpoint
creation and transfer, safe uninstall, exact retained reinstall, legacy
adoption, standby preparation/apply/promotion, an injected real update rollback,
successful update, and registry-owned erase. A failure preserves the exact
temporary root for diagnosis; it never discovers or targets a live installation.

## Native packaging

- Apple Silicon: `control_center/release/build-macos.sh` builds a pinned-PyInstaller `.app`, verifies it is payload-free, runs its self-check, and produces a DMG. `REQUIRE_SIGNING=1` fails unless the complete signing and notarization inputs are present.
- Windows x64: `control_center/release/build-windows.ps1` builds a pinned-PyInstaller directory and per-user Inno Setup installer. `-RequireSigning` fails unless all Authenticode inputs are valid.
- Application releases: `scripts/release/build_anote_release.py` requires a clean worktree and exact HEAD identity. Build both native packages, then run `scripts/release/verify_anote_release_pair.py` to prove their shared logical identity and architecture-specific OCI identities.

Native tag workflows sign when a complete credential set is configured. A
partial credential set, or an explicit required-signing run without complete
credentials, fails closed. Otherwise the workflow and release notes must
disclose that the native package is unsigned.

No package may contain an application release, checkpoint, database, environment file, registry, journal, or image archive.

## Stable interactions and operation phases

The Setup, Updates, Orchestra, and Uninstall buttons use the stable semantic IDs declared in `application.INTERACTION_IDS`. `orchestra.recover` is the explicit recovery intent and is enabled only for an interrupted journal or `recovery_required` installation. `operation.cancel` is enabled only in the bounded pre-mutation phase. Once protected mutation starts, cancellation is disabled and the owner must complete or preserve recoverable journal state.

Full erase displays the exact canonical registry, operations, production, backup, checkpoint, release, log, Docker project, and immutable image targets before accepting `ERASE ANOTE`. It is unavailable while running or while recovery is required.

## Native manual release gates

These checks cannot be truthfully replaced by mocked CI:

1. On Apple Silicon with Docker Desktop, run `acceptance/full_docker_lifecycle.py` with the exact release packages. Confirm API UID/GID can write only the disposable `/data` bind and both services run with `cap_drop: ALL`.
2. Inspect the macOS EN/ES UI for focus order, progress, pre-mutation cancellation, exact erase targets, recovery errors, and destructive confirmation. Sign/notarize the final DMG when publication policy requires it.
3. On Windows 11 x64 with Docker Desktop, repeat the disposable lifecycle with the amd64 package; verify port allocation is limited to 15173–15193, the per-user installer install/repair/uninstall flow, EN/ES layout, keyboard operation, and signed executable/installer when required.
4. Retain `native-pair-identity.json`, package hashes, bundle self-check output, and the manual acceptance record as release evidence. Never point these gates at a live installation.
