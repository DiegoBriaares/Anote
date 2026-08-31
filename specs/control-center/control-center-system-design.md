---
doc_id: specs.control-center.control-center-system-design
title: Anote Control Center System Design
doc_type: system_design
status: accepted
graph_level: 2
references:
  - release-checkpoint-contract.md
  - ../architecture/application-system-design.md
  - ../architecture/data-security-system-design.md
  - ../../docs/architecture/anote-architecture-assessment.md
---

# Anote Control Center system design

## 1. Purpose and decision

Anote Control Center is the only distributed operator application for local
Anote production. It is a payload-free Python/Tkinter desktop program with
Setup, Updates, Orchestra and Uninstall modules over one lifecycle service and
read model. Anote application releases are separate files manually placed in a
verified local inbox. There are no automatic downloads, registries, background
self-update or embedded application payloads.

The supported target matrix is exact:

| Host | Docker server required | Control Center artifact |
| --- | --- | --- |
| Windows 11 x64 | Linux `amd64` Docker Desktop/WSL 2 | per-user x64 installer |
| Apple Silicon macOS | Linux `arm64` Docker Desktop | arm64 application/DMG |

Docker Desktop is the sole separately installed target prerequisite. Git,
Node, npm, Python, SQLite CLI, `rsync`, a compiler and a package-registry login
are build/release concerns and must not be invoked on the target. Unsupported
OS/architecture or mismatched Docker server fails before installation mutation.

The initial application release contract is 1.0.0 and uses `anote-v*` tags.
The initial Control Center version is 0.1.0 and uses
`anote-control-center-v*`. Their workflows and GitHub releases remain separate.

## 2. Ownership architecture

| ID | Invariant | Authoritative owner |
| --- | --- | --- |
| CC-SHELL-001 | One shell renders all modules from one immutable read model; widgets never interpret registry JSON, manifests, Docker output or filesystem ownership. | Control Center application/read-model builder |
| CC-REL-001 | Only a compatible `VerifiedRelease` can cross into a lifecycle mutation. | `ReleaseInbox` and release codec |
| CC-STATE-001 | Installation identity, role, release, port, owned paths, lineage and retained/recovery state have one atomic owner. | `InstallationRegistry` |
| CC-LOCK-001 | Every mutation holds one installation-wide operation lock and writes a recoverable journal before external effects. | lifecycle command boundary |
| CC-RUNTIME-001 | Docker inspection, image loading, Compose generation, start/stop/readiness and exact resource removal are platform details hidden behind one installed-runtime adapter. | `DockerRuntime` |
| CC-DATA-001 | Consistent backup, restore, checkpoint creation/apply and directory swap have one owner and never write application business rows. | data snapshot/checkpoint services |
| CC-SETUP-001 | Fresh source, legacy adoption, standby preparation and retained reinstall are distinct commands with distinct guards/postconditions. | `SetupService` |
| CC-SETUP-002 | Existing unmanaged production data disables fresh/standby setup and routes the operator to legacy adoption before any mutation. | application read model + `ManagedPaths` |
| CC-UPDATE-001 | Classification, backup-before-migration, exact readiness validation, rollback and stopped result are one transaction-like operation. | `UpdateService` |
| CC-ORCH-001 | Explicit start/stop, source/standby capability, checkpoint lineage and dirty/clean state have one owner. | `OrchestraService` |
| CC-UNIN-001 | Safe uninstall and exact-confirmed erase have disjoint target/preservation policies. | `UninstallService` |
| CC-I18N-001 | Every visible label, state, refusal, progress, success and recovery instruction has EN/ES catalog parity. | Control Center text catalog |

Services accept small concrete adapters for clock, filesystem, process/Docker,
ports and dialogs so owner tests can use deterministic fakes. There is no
dependency-injection framework. Common-path command ordering, subprocess cost,
timeouts, cleanup and recovery remain visible in each service.

The installed-runtime process adapter resolves the Docker CLI independently of
an interactive shell. It checks the process search path and the native Docker
Desktop installation locations supported on each host, then invokes the
resolved executable without changing the process or system `PATH`. A missing
CLI and an installed CLI whose engine cannot answer are distinct safe failure
codes in localized UI and redacted diagnostics.

The operation lock's process adapter is observational: Windows uses process
query access, never `os.kill`, while POSIX uses signal zero. Only a proven-dead
owner is reclaimed; permission or probe ambiguity fails closed. Any staged
external input is named and journaled before its first byte is copied so crash
recovery has one exact cleanup target.

The GUI executes long work on one worker thread, publishes bounded progress,
and disables conflicting commands. Cancellation is accepted only before a
phase that can mutate runtime/data; afterward the action becomes complete or
recover, never abandon. Closing the window during a mutation cannot erase the
journal.

Package and checkpoint hashing, extraction, database integrity checks and
inventory validation are worker work even though they are read-only. The
worker returns a verified typed result; only the Tk thread derives the visible
confirmation and then dispatches the protected mutation. No package size or
removable-media latency may block the Tk event loop.

## 3. Lifecycle state model

Durable states are:

```text
checkpoint_required             source installed/changed; stopped; baseline required
awaiting_checkpoint             standby runtime staged; stopped; cannot start
ready_stopped                   clean source/standby with committed checkpoint
running_dirty                   writers may be active; dirty recorded before start
stopped_dirty                   runtime stopped after writers; checkpoint required
runtime_removed_data_retained   recreatable runtime removed; data/identity retained
recovery_required               last stable postcondition cannot be proved
```

`not_installed` is absence of a registry. `installing`, `updating`, `applying`,
`uninstalling` and `erasing` are journaled operation phases, not registry states
that can masquerade as stable. Erase returns to `not_installed` only after the
captured target set is gone and the registry is removed last.

| Model ID | Source | Intent | Guard | Durable result | Refusal/recovery |
| --- | --- | --- | --- | --- | --- |
| CC-INSTALL-001 | not installed | fresh source | compatible release, Docker, free port/disk, admin input | `checkpoint_required`, healthy and stopped | provisional managed resources removed; no registry |
| CC-ADOPT-001 | detected legacy | adopt source | exact legacy topology/data capture and verified release | `checkpoint_required`, managed and stopped | managed attempt removed; safety data restored; captured legacy restarted |
| CC-STAGE-001 | not installed | prepare standby | compatible release and Docker | `awaiting_checkpoint`, stopped, no independent user data | provisional resources removed |
| CC-REIN-001 | retained | reinstall | exact recorded release/platform | recorded clean/dirty stopped state restored | retained data/state unchanged |
| CC-UPD-001 | stopped source | change release | compatibility, explicit non-newer confirmation, verified backup | selected release, `checkpoint_required`, stopped | prior release/data restored and stopped or recovery required |
| CC-UPD-002 | stopped standby | stage release | compatibility and clean stopped state | selected pending release, `awaiting_checkpoint` | old runtime/data state retained |
| CC-CHK-001 | source checkpoint-required/dirty stopped | create checkpoint | stopped proof and writable destination | published clean lineage, `ready_stopped` | dirty state preserved; incomplete output removed |
| CC-CHK-002 | awaiting/clean stopped standby | apply checkpoint | exact release, lineage/replacement confirmation, stopped proof | data swapped, `ready_stopped` | old data preserved/restored or recovery required |
| CC-START-001 | ready stopped | explicit start | source capability, confirmation, no journal/recovery | mark `running_dirty`, then start and verify | dirty stopped if readiness fails; never mark clean |
| CC-STOP-001 | running | stop | exact managed runtime | `stopped_dirty` after API no longer answers | ambiguity disables other mutation |
| CC-SAFE-001 | any proven stopped installed state | uninstall and keep data | shared lock and exact owned set | retained state | journaled retry; business data not removed |
| CC-ERASE-001 | proven stopped installed/retained | erase | exact `ERASE ANOTE`, safe immutable target set | not installed | wrong/unsafe/ambiguous target: no deletion |
| CC-REC-001 | interrupted operation | recover | journal and captured identities | last proven stable result | `recovery_required`; start and unrelated mutation blocked |

Every setup path validates the supplied IANA timezone against bundled pinned
timezone data before taking the operation lock, writing runtime files, loading
images or committing registry state. A merely nonempty timezone is not valid.
The packaged self-check resolves a non-UTC IANA zone so Windows builds cannot
silently omit the bundled timezone database.

The operation lock removes concurrent lifecycle writers. A finite transition
checker must enumerate all state/intent pairs and assert that unlisted pairs
refuse without registry/data mutation. This checker provides more useful
counterexamples than a second general formal model.

## 4. Setup workflows

### Fresh source

Setup revalidates the selected release, Docker Engine/Compose version and
Linux architecture; selects 15173 or the first free port through 15193; creates
an installation ID, managed Compose project and random production secrets; and
stages runtime under the owned root. It loads exact images, generates runtime
assets, runs versioned application migrations and invokes the offline
administrator bootstrap with credentials through protected stdin or a
permission-restricted ephemeral file descriptor—not command arguments or logs.

It starts only for bounded loopback/same-origin validation, requires the exact
release readiness identity, then stops. Registry commit is last and records
`checkpoint_required`. Failure stops/removes only provisional managed Docker
resources, clears secret-bearing work and leaves no installation registry.

The setup read model and lifecycle preflight share
`ManagedPaths.has_existing_data` as the single fail-closed classifier. If the
managed data location is nonempty, unreadable, or not a directory while no
registry exists, fresh source and standby preparation are disabled and the
localized setup guidance directs the operator to legacy adoption. Adoption is
enabled only in that state. This workflow guard does not replace adoption's
exact Docker topology checks.

### Legacy production adoption

Discovery is read-only and recognizes only the explicit Anote production
topology: API/gateway containers, labels, image IDs, port binding and the
production data bind mount. Before mutation, adoption captures exact container
IDs/inspection, immutable image identities, environment digest, secret/port,
legacy Compose project, database/uploads root, backups and release manifests.
It rejects ambiguity, running non-Anote dependents, unknown extra mounts or a
data path outside the selected Anote production root.

While the legacy API is stopped, Python's SQLite backup API and canonical
uploads archive create and verify a safety snapshot. The legacy containers
remain stopped and intact while a new uniquely named managed Compose project
uses the same preserved port/data/secret with the selected verified release.
This deliberately avoids the historic Compose checkout, which may no longer
exist, and prevents the managed attempt from destroying rollback containers.

After migration and exact health validation, managed services stop, registry
commits `checkpoint_required`, and only then may the exact obsolete containers
be removed. Before commit, any failure removes the managed project, restores
the verified safety snapshot when data changed, and restarts the captured
container IDs/images. Failure to prove that rollback becomes
`recovery_required` with both target sets identified; it never starts both.

### Standby preparation

Standby setup loads and prepares the platform runtime but does not create an
administrator, migrate an independent legacy database, start production or
invent dataset lineage. It records `awaiting_checkpoint`. Only a matching full
checkpoint can make it ready.

### Retained reinstall

Safe-uninstall state records its exact prior release and stopped resume state.
Reinstall accepts only that platform package, recreates generated runtime and
loads images, validates without altering retained production information, and
returns to the recorded stopped state. Failure restores the prior retained
layout/state. It never starts production.

## 5. Updates and rollback

The shared release classifier returns exact no-op, upgrade, downgrade,
equal-version replacement or incompatible. The service recomputes the result
under the operation lock. Downgrade/equal replacement requires explicit
localized confirmation.

Source update ordering is:

1. Prove API/writers stopped and recheck under lock.
2. Revalidate selected package and free space.
3. Create and verify installation-local database/uploads/runtime backup.
4. Load selected immutable images and stage generated runtime.
5. Run application migration exactly once for the staged attempt.
6. Start temporarily; validate database/upload readiness, gateway same-origin
   behavior and exact release identity.
7. Stop; commit registry/release and `checkpoint_required`, clearing the prior
   dataset/checkpoint lineage so the updated release's next checkpoint is a new
   sequence-1 baseline.

No previous recovery input is deleted before commit. Failure after data/runtime
mutation restores the exact prior data and runtime, validates it, stops it and
commits the prior identity. If validation cannot prove restoration, the journal
and inputs remain and state is `recovery_required`. A restored old release is
never left running implicitly.

Standby release change stages runtime only, leaves old data unmigrated, clears
ready lineage and returns `awaiting_checkpoint` for a checkpoint made by the
updated source. Its exact generated work-directory basename is journaled before
creation. The old Compose/environment pair is atomically copied, bound by one
durable size/digest receipt, and receipt-verified before image loading or live
runtime replacement. Recovery restores only that exact complete pair; a
pre-receipt interruption removes only its exact work directory and never treats
partial files as rollback authority.

## 6. Orchestra

There is no automatic failover, network replication, remote stop proof or
distributed lease. The operator explicitly decides which machine runs. Each
host preserves installation ID, port, secret, Compose project and native
runtime; a checkpoint transfers logical data/lineage only.

Start is allowed only from `ready_stopped`, with explicit confirmation that no
other machine is active. A clean standby is promoted locally to source before
`running_dirty` is durably recorded; then Docker starts. The dirty-before-writer
ordering is mandatory. Stop waits until the managed API no longer answers and
records `stopped_dirty`.

Only a stopped source can create a checkpoint. A new/adopted/updated source
creates sequence 1; later checkpoints are exact children. A stopped-dirty
source becomes clean only after a checkpoint publishes atomically. Standby
apply follows the release/checkpoint contract and always remains stopped.

## 7. Uninstall and destructive scope

Safe uninstall removes only recreatable registered containers, networks,
images when no other registered installation owns them, generated runtime and
active-runtime registry state. It retains production data, backups,
checkpoints, verified release cache/inbox, installation identity, exact release
and stopped resume state. The runtime path is validated under the operation
lock before the journal or any Docker mutation, in both ordinary execution and
interrupted recovery. Start is unavailable until exact reinstall succeeds.

Full erase is a separate command. It displays the canonical registry-owned
targets in EN/ES, requires literal `ERASE ANOTE`, proves stopped state, acquires
the lock, validates every registry/operation/owned path, and captures the
immutable target set in the journal before any Docker or filesystem effect. It removes only
registered Anote Docker resources and paths, with registry last. It never
follows from uninstall, a failed update/reinstall, deleting Control Center from
the OS, a broad home directory, a glob, a symlink target or discovery labels.
The completion result names removed and still recoverable material.

## 8. Operator interface

The shell exposes stable semantic IDs:

```text
nav.setup                      nav.updates
nav.orchestra                  nav.uninstall
release.refresh                release.open-inbox
setup.install-source           setup.adopt-legacy
setup.prepare-standby          setup.reinstall-retained
updates.apply-source           updates.stage-standby
orchestra.start                orchestra.stop
orchestra.create-checkpoint    orchestra.apply-checkpoint
orchestra.open-data            orchestra.open-checkpoints
orchestra.open-backups         diagnostics.copy
uninstall.keep-data            uninstall.erase
```

The read model supplies visible/enabled state and localized reason codes, while
services recheck every guard. Each action shows intent, scope, progress,
outcome and next safe step. Destructive dialogs own focus, confirmation and
recovery. English and Spanish catalogs have structural parity and never expose
Docker/Compose/manifest jargon in ordinary workflow copy; diagnostics may use
technical terms with secrets redacted.

## 9. Packaging, release and evidence

Control Center builds with pinned Python 3.11+, Tk 8.6+, PyInstaller and native
packaging tools. The Windows workflow builds a per-user Inno Setup installer;
the macOS workflow builds the arm64 application/DMG. Stable publication is
serialized by exact tag, targets the intended commit, uploads only the exact
native asset set and verifies the tag after publication. Unsigned mode is
disclosed; required-signing mode fails closed.

Application release CI builds `linux/amd64` and `linux/arm64` API/web images
from one clean commit and immutable multi-platform base digests, inspects the
exact archives, and creates one native `.anote-release` per host. The target
never rebuilds or pulls them.

Focused deterministic tests cover codecs, classifier, registry/journal,
transitions, paths, fake runtime ordering, backup/checkpoint, adoption rollback,
update rollback, uninstall and localization. Native Linux architecture jobs
load and inspect exact images and exercise disposable source/checkpoint/standby
lifecycle. Apple Silicon acceptance exercises a disposable owned root and
Computer Use validates both languages, focus, progress and destructive
recovery. Windows CI installs/self-checks/uninstalls the exact artifact; a real
Windows 11 Docker Desktop human pass remains the first stable-release gate.

No test or acceptance run may point at the user's live Anote root, Compose
project or port. Disposable tests require an owned temporary root, unique
Compose projects and an exact destructive-ephemeral acknowledgement before
Docker cleanup.
