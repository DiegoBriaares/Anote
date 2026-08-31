# Anote Production Architecture

This document is the concise operator-facing map. Normative behavior belongs to
the [application](../specs/architecture/application-system-design.md),
[data/security](../specs/architecture/data-security-system-design.md),
[automatic-program](../specs/architecture/automatic-programs-system-design.md),
[Control Center](../specs/control-center/control-center-system-design.md) and
[release/checkpoint](../specs/control-center/release-checkpoint-contract.md)
specifications.

## Same-Origin Application Contract

The browser sees one application origin. Frontend code calls relative `/api`
paths and never derives an API port from the browser hostname.

```text
Browser / LAN / MagicDNS / Tailscale
                 |
                 v
Nginx gateway (preferred host port 15173, container 8080)
        |-- / and /assets/*       -> compiled React application
        `-- /api/*                -> Node API container:3001
                                          |
                                          |-- /data/calendar.db
                                          `-- /data/uploads/
```

API port `3001` is internal and is never published on a host, LAN or Tailscale
interface. Fresh installation may use the first available port from 15173
through 15193; adoption preserves its captured port.

The administrator workspace is a lazy-loaded part of the React application. It
uses authenticated `/api/admin/*` commands. There is no API-served `/admin` web
interface, public administrator initialization route or public upload mount.

## Application Runtime Ownership

| Invariant | Owner | Production boundary |
| --- | --- | --- |
| Browser transport and error parsing | typed clients under `src/api/` | relative `/api`, cookie credentials, stable request IDs/error codes |
| Session, event, social, configuration and program UI state | focused owners under `src/store/owners/` | views request intent; they do not reproduce server policy |
| Middleware and service composition | `server/app.js` | routes validate/translate; services authorize and mutate |
| Process startup and shutdown | `server/index.js` | scheduler/listener start after initialization and stop before SQLite closes |
| SQLite connection, migrations and transactions | `server/db.js`, `server/migrations.js`, domain services | foreign keys, WAL, busy timeout, fail-closed migrations and atomic commands |
| Authentication and authorization | `server/auth.js` plus domain policies | opaque cookie sessions and owner/admin checks on every command |
| Private file metadata and streaming | `server/attachments.js` | validated bytes under `/data/uploads`, served only through authenticated IDs |
| Automatic schedules and executions | `server/programs.js`, `server/time.js` | IANA timezone, durable next run, unique run ledger and one transaction |
| Release/data identity | `/health/ready` | exact release ID, version, source commit and schema version |

API initialization is ordered: validate configuration and directories, open
SQLite, apply immutable versioned migrations, migrate/verify attachment
metadata, compose routes and scheduler, then bind the listener. Failure before
the last step leaves readiness false. Shutdown stops scheduled work before the
database checkpoint/close boundary.

All multi-row mutations are service transactions. Mutable event/program
resources use positive integer revisions. HTTP failures use stable codes and a
request ID; raw SQL, filesystem paths, secrets and stack traces do not cross
the API boundary.

## Sessions, Requests and Private Content

Login creates an OS-random opaque token. Only its SHA-256 hash is stored in
SQLite. The plaintext exists in request memory and an `anote_session` cookie
with `Path=/api`, `HttpOnly` and `SameSite=Strict`; HTTPS adds `Secure`.
JavaScript receives no credential token. Idle, absolute and explicit logout
revocation are server-owned.

Unsafe browser methods require an exact same-origin `Origin`/effective-host
match before mutation. The gateway is the only trusted proxy. Account entry is
rate-limited, public registration remains permanently available, and the
first administrator is created only by Control Center's offline bootstrap
command through protected standard input.

Attachments have opaque IDs, owner/purpose metadata, normalized types, sizes
and digests. Note files and backgrounds are owner-private; authenticated users
may read referenced avatars. Active or mismatched content is rejected, stored
names are server-generated, and authenticated `/api/attachments/:id` responses
are integrity-checked and use restrictive headers. Legacy `/uploads/...`
references are migrated to metadata without exposing unresolved files.

## Server-Owned Automatic Programs

The API runtime owns program clocks and runs. Each program stores its activation
wall time, target-day offset, IANA timezone, next UTC instant and revision.
`program_runs` uniquely claims one program/source local date.

The scheduler and manual command call one transaction that claims the run,
moves exactly the owner's eligible unfinished events, records the committed
count and advances the schedule. A process restart retries due work
idempotently. A missed occurrence targets the current local date; an on-time
occurrence uses the configured offset. Daylight-saving gap/repeat selection is
owned by the timezone service. A browser is required only to configure or
observe a program, never to execute it.

Stopping the API through Control Center stops the scheduler and every program
execution path.

## Control Center Lifecycle Ownership

Anote Control Center is outside the application business boundary. It never
edits application tables. It verifies packages, owns the installation registry,
serializes mutations with one lock/journal, drives Docker Desktop and snapshots
or swaps the complete data boundary.

```text
verified local .anote-release
              |
              v
Anote Control Center
  |-- registry + operation lock/journal
  |-- Setup / Updates / Orchestra / Uninstall
  |-- Docker Desktop runtime adapter
  `-- backup/checkpoint services
              |
              v
managed gateway + API + production data (stopped after every mutation)
```

Supported managed targets are Windows 11 x64 with Linux/amd64 Docker Desktop
and Apple Silicon macOS with Linux/arm64 Docker Desktop. State roots are:

- `%LOCALAPPDATA%\Anote` on Windows;
- `~/Library/Application Support/Anote` on macOS.

The registry records installation/release identity, role, port, lifecycle
state, canonical owned paths and checkpoint lineage. The journal is written
before external mutation and makes each interrupted phase recoverable. Secrets
and business content are excluded from both.

Setup paths are distinct:

- **Fresh source** verifies a release, migrates, bootstraps the first
  administrator offline, validates exact health and finishes stopped.
- **Legacy adoption** snapshots and captures the exact old runtime before
  mutation, enrolls without depending on its source checkout, and restores the
  captured state if validation fails.
- **Standby preparation** creates no independent user dataset; a verified
  checkpoint is required before it can become ready.
- **Retained reinstall** accepts only the exact recorded release and preserves
  retained business data.

Update, checkpoint apply, recovery, setup and reinstall always finish stopped.
Only an explicit Orchestra Start may run production. Source/standby transfer is
operator-directed; there is no automatic failover, replication or split-brain
election.

## Releases, Backups and Checkpoints

A `.anote-release` is a schema-versioned offline ZIP containing a manifest,
exact application identity, native Linux API/web image archives and generated
runtime assets. Windows and macOS packages for one logical release share the
release ID/version/source commit but contain their native Linux container
architecture. Control Center rejects unsafe members, undeclared bytes,
unsupported platforms/schemas and digest or image-identity mismatches before
Docker is called.

An installation-local backup supports adoption/update rollback and may retain
the same installation's protected runtime secret. It is never a transfer
artifact.

A `.anote-checkpoint` is platform-neutral and contains exactly its manifest, a
consistent `calendar.db` and canonical `uploads.tar`. It is self-contained but
contains no secret, session, image, Compose identity, host path, log, backup,
WAL or SHM file. Checkpoints are created from stopped/quiesced sources and are
applied through verified staging plus an atomic directory swap. Success remains
stopped.

The precise archive schemas, bounds, compatibility and lineage rules are in the
[release, registry and checkpoint contract](../specs/control-center/release-checkpoint-contract.md).

## Lifecycle Results and Recovery

| Operator intent | Required guard | Durable result |
| --- | --- | --- |
| Fresh setup or adoption | compatible verified release, Docker and safe paths | stopped source requiring a baseline checkpoint |
| Prepare standby | compatible release, no independent dataset | stopped standby awaiting checkpoint |
| Update source | stopped proof and verified pre-update backup | selected release, rollback to prior identity on failure, stopped |
| Create checkpoint | stopped source | clean published lineage, stopped |
| Apply checkpoint | stopped compatible target and verified lineage | complete data swap, stopped |
| Start | ready stopped source capability and operator confirmation | dirty recorded before writers start |
| Stop | exact managed runtime | stopped dirty until a checkpoint is published |
| Safe uninstall | exact registry-owned runtime and stopped proof | runtime removed, business data/reinstall identity retained |
| Full erase | exact `ERASE ANOTE` and immutable safe target set | only registered Anote resources removed; registry last |
| Interrupted operation | valid journal and captured identities | last provable stable state or explicit recovery-required state |

Control Center never infers health from absence of an error. It commits registry
state only after observing the required runtime/data postcondition.

## Legacy Script Boundary

Repository deployment, backup, rollback and production-user scripts are kept
only for unmanaged legacy installations. Their shared path owner checks for
`registry/installation.json` beside the production root before mutation. Once
enrolled, every such command refuses and directs the operator to Control Center.

This separation is mandatory: a script bypass would invalidate Control Center's
lock, journal, release identity and recovery assertions. Development/test
helpers remain available only against explicit non-production paths.

## Network and Readiness

The gateway may be reached through a trusted LAN address, MagicDNS/Tailscale or
browser-trusted HTTPS termination. Trust in that network does not weaken Anote
authentication or resource ownership. The gateway supplies security headers,
keeps fingerprinted assets immutable, serves the application shell with
`no-store`, and proxies authenticated API responses without public caching.

`GET /api/health/ready` succeeds only after migrations, SQLite and the upload
root are ready. Its non-secret identity is:

```json
{
  "status": "ready",
  "data": {
    "releaseId": "anote",
    "version": "1.0.0",
    "sourceCommit": "40-lowercase-hex-commit",
    "schemaVersion": 6
  }
}
```

Control Center accepts a candidate runtime only when this identity exactly
matches the selected verified release and expected data schema.
