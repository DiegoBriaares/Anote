---
doc_id: specs.control-center.release-checkpoint-contract
title: Anote Release, Registry and Checkpoint Contract
doc_type: protocol_contract
status: accepted
graph_level: 3
references:
  - control-center-system-design.md
  - ../architecture/application-system-design.md
  - ../architecture/data-security-system-design.md
---

# Anote release, registry and checkpoint contract

## 1. Boundary and versions

This document owns the untrusted archive boundary, logical application release
identity, installed filesystem/registry representation, portable checkpoint
identity and compatibility. Control Center services accept immutable verified
values from these codecs; they never accept an arbitrary manifest dictionary or
unverified extraction path.

Initial protocol versions are:

```text
.anote-release schema_version = 1
.anote-checkpoint schema_version = 1
installation registry schema_version = 1
operation journal schema_version = 1
```

Schema version and product version are independent. Unknown versions fail
closed. A future schema requires a new validator/migration and must not loosen
the current path, identity, size, ownership or stopped-state invariants.

## 2. Stable per-user layout

Roots are `%LOCALAPPDATA%\Anote` on Windows and
`~/Library/Application Support/Anote` on macOS:

```text
registry/installation.json
operations/operation.lock
operations/journal.json
releases/inbox/
releases/verified/<package-sha256>/
releases/work/
production/data/calendar.db
production/data/uploads/
production/runtime/compose.yaml
production/runtime/production.env
backups/<backup-id>/
checkpoints/
logs/
```

The root, registry and journal are atomic ownership boundaries. Temporary files
are created in the target directory, flushed, permission-restricted, then
replaced atomically. Production credentials exist only in `production.env`,
with the most restrictive per-user permissions the platform supports.

The registry owns every mutable/destructive path as a canonical path relative
to the validated application root. Absolute targets, `..`, symlinks/reparse
points, hardlink aliases outside the root and paths discovered only from Docker
labels are never erase authority. Legacy adoption records only the existing
production root and exact children necessary to manage it. Unrelated sibling
archives or development data are outside ownership even when their names
contain Anote.

## 3. `.anote-release` schema 1

The package is a ZIP whose suffix is `.anote-release`. It contains one UTF-8
`manifest.json` and only members declared by that manifest. Required logical
fields are:

```text
kind = "anote-release"
schema_version
release.id
release.version                 # SemVer
release.source_commit           # exact 40-lowercase-hex commit
release.minimum_control_center_version
release.minimum_installed_version
release.minimum_data_schema
release.maximum_data_schema
platform.host_os                # windows | macos
platform.host_arch              # x86_64 | arm64
platform.container_os = linux
platform.container_arch         # amd64 | arm64
prerequisites.docker_engine
prerequisites.docker_compose
images[]                        # api and web exact archive identities
files[]                         # path, role, size, sha256
publication.signing_policy      # unsigned-disclosed | signed
```

The complete file-role set is exactly one Docker image archive, Compose
template, gateway template and release metadata/runtime command bundle. The
image set is exactly `api` and `web`. Each image records tag, Linux architecture,
configuration digest and OCI/runtime-manifest digest derived from the exact
archive. Loading succeeds only when Docker reports the declared tags and one of
the archive-derived immutable identities; tag presence alone is insufficient.
Classic Docker commonly exposes the configuration digest as `.Id`, while
Docker Desktop's containerd image store may expose the verified top-level OCI
load digest. Control Center records the exact host-observed member of that
verified identity set in the installation registry, then requires that same ID
for every later start, command, update, rollback and removal operation.

Windows x64 packages declare Linux `amd64`. Apple Silicon packages declare
Linux `arm64`. Two packages for one logical release have identical release ID,
version, source commit and data-schema compatibility and differ only in host,
container and native image/file identities. Checkpoints compare the logical
fields and deliberately ignore host architecture.

Release compatibility is:

- host OS/architecture and Docker server OS/architecture equal the package;
- installed Control Center meets its minimum;
- installed data schema is within the package's declared range;
- for a release change, installed application version is at least the selected
  package's minimum directly upgradable version.

The sign of target-version minus installed-version classifies upgrade,
downgrade or equal-version replacement but does not itself decide compatibility.
An exact installed identity is a no-op. A downgrade or different equal-version
identity requires explicit confirmation. A retained-data reinstall accepts
only the exact recorded ID/version/commit and platform package.

## 4. Archive verification

Before extraction, `ReleaseInbox` rejects:

- duplicate, absolute, drive-qualified, empty, backslash/noncanonical,
  traversal or Unicode-confusable member paths;
- symlink, hardlink, device or other non-regular members;
- encrypted members, unsupported compression, data-descriptor ambiguity the
  codec cannot bound, overlapping entries or inconsistent header identities;
- missing, unknown or undeclared members and duplicate roles;
- malformed/oversized manifest, integer overflow, size disagreement, digest
  mismatch, unsupported schema/kind/platform or incompatible prerequisites;
- more than 64 members, a manifest over 256 KiB, a member over 10 GiB, total
  expanded content over 12 GiB, or a compression ratio over 200:1.

The builder may set a lower package-specific disk requirement. Verification
streams every declared byte through SHA-256 into `releases/work`, then atomically
publishes a digest-addressed verified cache with a receipt binding whole-package
digest and manifest digest. A selected release is revalidated at use time to
close the scan-to-use race. Unchanged packages may reuse a complete
receipt/cache; partial work is never usable.

`VerifiedRelease` exposes typed immutable identity and owned cache roots. GUI
code sees only a safe summary and localized rejection code.

Signing policy concerns the native Control Center installer/DMG publication.
Unsigned publication is permitted only when the workflow and UI disclose it.
When signing is required, incomplete Windows certificate or Apple
signing/notarization credentials fail the build; there is no unsigned fallback.
Release-package SHA-256 detects corruption but is not claimed as authenticity.

## 5. Installation registry and journal

Registry schema 1 contains:

```text
installation_id, role, lifecycle_state
host_os, host_arch, container_arch
compose_project, public_port
installed_release, pending_release
data_schema_version
owned_paths
retained_data, recovery
dataset/checkpoint lineage
created_at, updated_at
```

`role` is `source` or `standby`. `public_port` prefers 15173 and fresh setup may
choose the first available value through 15193. The allocated value is durable
identity and updates never silently change it. A legacy adopted installation
keeps its captured port. Its managed Compose project is a new installation-ID
name so the captured stopped legacy containers remain intact until adoption
commits; the legacy project/containers are journaled rollback identity, not the
new runtime owner.

The registry stores release identity, not package paths. It never stores
passwords, cookie/session tokens, database content or full environment values.
Malformed, contradictory or path-escaping state prevents mutation and requires
diagnosis/recovery.

One cross-module operation lock excludes Setup, Updates, Orchestra, uninstall
and recovery mutations. The operation journal is written before external
mutation and records operation ID/kind, prior/target registry identities,
immutable owned target set, backup/checkpoint ID, durable phase, timestamps and
safe recovery data. Secrets and business content are forbidden.

Stale-lock reclamation is permitted only when process death is positively
established. POSIX hosts may use signal-zero probing; Windows must use a
read-only process query handle and must never map liveness probing to process
termination. Access denial or any indeterminate result preserves the lock and
requires recovery instead of admitting another writer.

Each operation defines which phases are pre-destructive, reversible, validated
and committed. On process restart, Control Center offers/resumes the named
recovery before any unrelated mutation. Registry commit happens only after the
operation postcondition is observed. Ambiguity becomes `recovery_required`,
never an inferred healthy state.

Standby update work identities are exact `standby-update.<16 lowercase hex>`
basenames under `releases/work`; a journal value is never joined or deleted
until that codec proves it is a canonical child. Its runtime rollback authority
exists only after both files are atomically published and one receipt binds
their exact names, sizes and SHA-256 digests. Missing, partial or mismatched
receipts preserve the live runtime and journal for diagnosis.

## 6. Backups

An update/adoption safety backup is installation-local and not a transfer
checkpoint. It is created only while application writers are stopped. Python's
SQLite backup API creates a self-consistent `calendar.db`; WAL/SHM files are not
copied as independent truth. Uploads and the exact prior runtime/registry
identity are archived canonically. Every member has recorded size and SHA-256,
and restoration is verified before the prior release is considered recovered.

Backups may include local secrets required to restore the same installation
and therefore remain inside its permission-restricted backup root. They are
never GitHub assets, release package members, diagnostics or checkpoints.

## 7. `.anote-checkpoint` schema 1

The package is a self-contained platform-neutral ZIP with exactly:

```text
manifest.json
calendar.db
uploads.tar
```

The manifest records kind/schema, dataset ID, checkpoint ID, optional parent
ID, sequence, source installation ID, creation time, application logical
release ID/version/source commit, data schema version, and each payload's
stored/expanded size and SHA-256. Sequence 1 has no parent. Later checkpoints
name their exact predecessor but still carry every byte needed to restore.

The SQLite payload is produced through the backup API and passes integrity and
schema checks. `uploads.tar` has deterministic relative POSIX paths, sorted
members, normalized non-semantic metadata and regular files/directories only.
It contains no absolute paths, links, devices, sockets or traversal. The
checkpoint excludes secrets, sessions, operation state, host paths, ports,
Compose identity, release packages, Docker images, logs, backups and WAL/SHM.
All logical database state is otherwise retained, including private unresolved
legacy recovery rows and their original SQLite value types. Sanitization may
delete only runtime session material named by this contract; it must not infer
that an unreferenced or currently unreachable business row is disposable.
Likewise, unreferenced regular files below the owned uploads root remain in the
canonical archive even though the application does not expose them over HTTP.
Session exclusion is physical as well as logical: the owned checkpoint copy
enables SQLite secure deletion, removes session rows, switches to a single-file
journal, vacuums the database, and rejects/removes WAL, SHM and journal
sidecars. A deleted token marker must not remain recoverable in the packaged
database bytes.

Checkpoint verification applies archive checks equivalent to release checks,
with a 256 KiB manifest, 1,000,000 upload entries, per-file and total sizes
bounded by the manifest and available disk, and a hard expanded maximum of 1
TiB. Bounds are checked before mutation and while streaming; declared size does
not override local free-space refusal. A checkpoint becomes `VerifiedCheckpoint`
only after its database digest, integrity, foreign keys, declared schema and
empty-session invariant pass and its upload digest/inventory pass. Digest-valid
garbage or a re-manifested database containing a session is invalid.

Checkpoint creation generates and validates one owned work-directory name,
journals that exact relative identity before creating the directory, and never
uses a naming glob as recovery authority. Interrupted recovery removes only
that journaled child; unrelated root directories remain untouched.

Compatibility requires exact application release ID/version/commit and a
supported data schema. Host platform and installation identity are not copied.
Applying a checkpoint from the same installation as a standby transfer is
refused unless it is an explicit local recovery workflow.

Lineage rules are:

- applying the already committed checkpoint is a verified no-op;
- an exact child of the local checkpoint is accepted;
- a sequence-1 baseline enrolls an awaiting standby;
- a fork, older checkpoint or unrelated dataset requires explicit full-replace
  confirmation;
- tamper, identity change between preflight and import, insufficient disk,
  running state or dirty ambiguity refuses before target replacement.

Apply rechecks actual Docker stopped state under the shared operation lock,
generates and validates one owned staging name, and journals that exact relative
identity before copying any package byte. The copy hashes every byte. Recovery
removes only the journaled staging child, including a partial copy left by
process or power loss. The extracted candidate, retained previous data, and
failed-candidate directories are likewise generated, role-validated, and
journaled before extraction; recovery restores or removes only those exact
children and never discovers rollback authority by glob. Only that package identity is reopened. Both extracted database and uploads
digests are rechecked before database integrity/schema/privacy and upload
inventory validation. It then advances the journal to destructive intent, atomically swaps the
complete data directory, and records lineage. A source-path replacement,
nested upload link/junction/reparse point, or running writer refuses before
replacement. Failure before swap preserves old data; failure after swap restores
the retained old directory or remains `recovery_required`. Success is always
stopped.

Checkpoint files contain readable replaceable production data. EN/ES UI warns
that hashes provide corruption detection, not confidentiality or authenticity,
and instructs operators to protect the media.

## 8. Contract evidence

| ID | Claim | Focused evidence |
| --- | --- | --- |
| PKG-REL-001 | Only a complete compatible native package becomes `VerifiedRelease` | malicious archive corpus, digest/platform/identity tests and paired-package contract |
| PKG-REL-002 | Exact archive images, not mutable tags, are loaded | fake/classic/containerd Docker identity tests plus native archive inspection |
| PKG-REG-001 | Registry/journal writes are atomic and contradictory states fail | replace-failure, schema and replay owner tests |
| PKG-PATH-001 | Destructive/archive scope cannot escape registry-owned roots | traversal, nested symlink/junction/reparse, alias and unrelated-sibling tests |
| PKG-CHK-001 | One checkpoint independently restores all business data, including unresolved legacy rows and unreferenced uploads, across platforms | deterministic typed-row round-trip, empty-target apply and digest/inventory tests |
| PKG-CHK-002 | Interrupted creation/apply, running-writer or identity-raced apply cannot publish partial data as ready or delete unrelated staging-like paths | exact journaled-work cleanup, stopped-state refusal, whole-package staging, payload rehash, phase injection and directory-swap recovery tests |
| PKG-PRIV-001 | Release/checkpoint/log boundaries contain no secrets or recoverable session remnants | raw-byte session marker, nonempty-session verifier rejection and package/diagnostic privacy guard |

Native Docker and platform package checks are independently runtime-owned;
unit archive tests cannot substitute for them. Conversely, repeating every
malicious archive case through a GUI adds no distinct evidence.
