# Anote

Anote is a personal calendar system for turning plans into managed event state.
It combines day-level event administration, completion tracking, postponed
queues, transfer history, role-scoped Markdown notes, friend calendar sharing,
automatic carryover programs, profile customization and administrator tools in
one bilingual application.

Anote preserves context while plans change. A calendar event can be completed,
copied, moved, postponed, restored, shared, annotated and traced through its
origin history. Automatic programs are durable server schedules: they continue
to run when every browser is closed and use an explicit IANA timezone rather
than a connected device's clock.

The shared product vocabulary lives in [`Terminology/`](Terminology/README.md).
Use those names in issues, changelogs, pull requests and implementation notes.
The normative architecture starts at the [specification index](specs/index.md).

## Current Product Shape

Anote has one authenticated application shell with these principal workspaces:

- **Calendar Page**: two-month planning, day selection, day inspection, visual
  settings, selected-day reading and friend read-only mode.
- **Day Events Administration Page**: event creation and editing, completion,
  history, copy/move and postponed transfer for one day.
- **Postponed Events Administration Page**: deferred-event views and restoration
  to calendar dates.
- **Profile Page**: background, accent, texture, theme and language preferences.
- **Programs Page**: automatic-program definitions and manual execution. Each
  definition has a name, enabled state, `HH:mm` activation time, target-day
  offset, IANA timezone, next execution and revision.
- **Friends Page**: relationship management, read-only friend calendars and
  event sharing.
- **Roles Page**: ordered role and subrole labels for event notes.
- **Admin Page**: an administrator-only React workspace for application
  configuration and explicit user/event administration.
- **Authentication Page**: cookie-session sign-in and, when enabled by an
  administrator, account registration.

The Admin Page is part of the same compiled React application and uses
authenticated `/api/admin/*` commands. The API does not serve a separate
`/admin` web interface, and administrator bootstrap is never exposed as an HTTP
endpoint.

## Why Use Anote

- **Plan with continuity**: copy or move events while preserving origin history.
- **Separate unfinished and completed work**: event state survives editing,
  sharing, postponement and automatic movement.
- **Focus on one date**: administer a day's work without losing calendar context.
- **Hold deferred work outside the grid**: return postponed events when a date
  becomes appropriate.
- **Coordinate with trusted users**: view friend calendars read-only and share
  selected events.
- **Attach structured context**: keep owner-private role notes and files on an
  event.
- **Automate carryover**: let the server move unfinished events at a predictable
  local time even when no browser is connected.
- **Administer deliberately**: use authenticated application workflows without
  exposing database, bootstrap or lifecycle authority to the browser.

## Automatic Programs

Programs are owned by the API runtime, not by a browser timer or local-storage
ledger. For every program, Anote stores its IANA timezone, activation wall time,
target-day offset, next UTC execution and integer revision. A unique durable run
record permits at most one execution for each program and source local date.

Scheduled and manual execution use the same atomic service operation:

1. Revalidate the current program and source date.
2. Claim the program/source-date run.
3. Move only the owner's unfinished events from that source date.
4. Record the committed count and advance the schedule.

If any step fails, the claim, event moves and schedule change all roll back. An
on-time run uses the configured target-day offset. A legitimately missed run
moves unfinished source events to the current local date. Completed, failed,
postponed, foreign and differently dated events do not move.

When an open client observes a completed automatic run, it shows the localized
notification and closes that browser session through the normal session owner.
The run is already committed and does not depend on notification delivery.
Manual runs do not sign the user out.

See the [automatic-program system design](specs/architecture/automatic-programs-system-design.md)
for timezone, daylight-saving, migration, replay and failure semantics.

## Architecture

```text
anote/
├── src/
│   ├── App.tsx                  # Application shell and lazy workspace routing
│   ├── api/                     # Typed same-origin API clients/contracts
│   ├── components/              # Calendar, auth, profile, programs and admin UI
│   ├── i18n/                    # Runtime language provider and EN/ES catalogs
│   ├── store/
│   │   └── owners/              # Session, event, social, config and program owners
│   └── utils/                   # Dates, preferences and presentation helpers
├── server/
│   ├── index.js                 # Process startup and controlled shutdown
│   ├── app.js                   # Express composition root
│   ├── db.js / migrations.js    # SQLite connection policy and schema owner
│   ├── auth.js / users.js       # Opaque sessions, accounts and bootstrap service
│   ├── events.js / notes.js     # Transaction-owned calendar domains
│   ├── attachments.js           # Private attachment metadata and streaming
│   ├── programs.js / time.js    # Durable schedules, worker and timezone rules
│   └── health.js / http.js      # Readiness, request IDs and safe error envelopes
├── control_center/              # Desktop lifecycle, archive and recovery owners
├── docker/                      # API and same-origin gateway images
├── scripts/release/             # Native offline Anote release builder
├── specs/                       # Normative application and lifecycle contracts
└── Terminology/                 # Shared product vocabulary
```

React/TypeScript renders the browser application. A typed client is the only
browser transport owner and always calls relative `/api` routes with cookie
credentials. Focused Zustand owners coordinate session, event, social,
configuration, resource and program state; authorization, transactions,
revisions and clocks remain server-owned.

The CommonJS API is composed from domain modules around synchronous
`better-sqlite3`. Startup opens SQLite, enables foreign keys/WAL/busy timeout,
applies fail-closed versioned migrations, verifies the attachment root and only
then starts the scheduler and listener. Multi-row commands use explicit SQLite
transactions and mutable resources use integer revisions.

The detailed contracts are:

- [Application system design](specs/architecture/application-system-design.md)
- [Data integrity and security](specs/architecture/data-security-system-design.md)
- [Automatic programs](specs/architecture/automatic-programs-system-design.md)
- [Control Center lifecycle](specs/control-center/control-center-system-design.md)
- [Release, registry and checkpoint contract](specs/control-center/release-checkpoint-contract.md)

## Sessions, Authorization and Attachments

Login creates an opaque random session. Only its SHA-256 hash is stored in
SQLite; the token is sent in an `HttpOnly`, `SameSite=Strict` cookie scoped to
`/api` and is never returned to or persisted by JavaScript. Sessions have idle
and absolute expirations and are revoked on logout. Unsafe requests must pass
strict same-origin validation, and account-entry routes have bounded rate
limits.

Every resource command is authorized by the API. Notes and note attachments are
owner-only. Avatars referenced by visible users can be read by authenticated
users; backgrounds remain owner-private. Uploads receive opaque metadata and a
server-generated stored name, must pass size/type/content checks and are
streamed through `/api/attachments/:id`. There is no public `/uploads` static
namespace.

Fresh installations create their first administrator through Control Center's
offline bootstrap command. Public account registration remains permanently
available. The bootstrap command accepts credentials through protected
standard input, refuses after an administrator exists and never logs the
secret. There is no `/admin/init` route.

## Development

Install dependencies once:

```bash
npm install
cd server && npm install && cd ..
```

Run both development services with Node 20:

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Frontend | `http://127.0.0.1:5174` |
| Development API through the frontend | `http://127.0.0.1:5174/api` |
| Direct development readiness | `http://127.0.0.1:3002/health/ready` |

The development API uses `server/calendar.db` and `server/uploads` unless
`ANOTE_DATABASE_PATH` and `ANOTE_UPLOAD_DIR` select isolated alternatives. It
runs the same migrations, session, authorization, attachment and program
owners as production.

To reset only the checkout's development data while the API is stopped:

```bash
rm -f server/calendar.db server/calendar.db-shm server/calendar.db-wal
find server/uploads -mindepth 1 -maxdepth 1 ! -name .gitkeep -delete
```

Never use these commands against a production or Control Center path. Do not
commit databases, uploaded content, production environments, session material
or secrets.

## Verification

```bash
npm run verify
```

The gate runs the privacy guard, lint, a production build and the Vitest suite,
including frontend owners, backend integration and production-script guards.
Control Center's Python owner tests and native Docker/installer acceptance are
separate release evidence rather than ordinary browser-development tests.

## Production Operations

### Managed installations

[Anote Control Center](specs/control-center/control-center-system-design.md) is
the sole production lifecycle owner after enrollment. It supports Windows 11
x64 with Linux/amd64 Docker Desktop images and Apple Silicon macOS with
Linux/arm64 images. Docker Desktop is the only separately installed target
prerequisite; target machines do not need Git, Node, npm, Python, a compiler,
`sqlite3`, `rsync` or registry credentials.

Control Center stores installation state beneath:

- `%LOCALAPPDATA%\Anote` on Windows;
- `~/Library/Application Support/Anote` on macOS.

Application releases are platform-native `.anote-release` files placed in the
local release inbox. Control Center verifies the archive, manifest, digests,
platform and compatibility before Docker is invoked. Setup offers fresh source,
legacy adoption, standby preparation and retained-data reinstall. Updates
create a consistent backup, validate exact release identity through the
same-origin gateway and roll back on failure.

Setup, adoption, update, checkpoint apply, restore and reinstall all finish
stopped. Starting production is an explicit Orchestra action. Orchestra also
owns stop, source/standby roles, checkpoint creation/application and access to
owned data, backups and diagnostics. There is no automatic failover or network
replication.

Portable `.anote-checkpoint` files contain a verified SQLite backup and
canonical uploads archive, but no secrets, sessions, Docker artifacts or host
paths. Safe uninstall retains business data and exact-release reinstall state;
full erase is separately scoped to validated registry-owned targets and requires
the literal confirmation `ERASE ANOTE`.

See [production architecture](docs/production-architecture.md) and the
[release/checkpoint contract](specs/control-center/release-checkpoint-contract.md)
for the topology, lifecycle states, offline package boundary and recovery
rules.

### Unmanaged legacy installations

The repository's `prod:deploy`, `prod:backup`, `prod:rollback` and production
user-operation scripts remain only for installations that have not been
enrolled. When `registry/installation.json` exists beside the production root,
these scripts refuse before mutation and direct the operator to Control Center.
They must never be used to bypass its lock, journal or registry.

For an explicitly unmanaged legacy installation only:

```bash
npm run prod:deploy
npm run prod:backup
npm run prod:rollback -- <backup-id>
```

Legacy production user operations are documented in
[`scripts/PROD_USER_OPS.md`](scripts/PROD_USER_OPS.md). Once enrolled, use the
authenticated Anote administrator workflow and Control Center lifecycle actions
instead.

## Contribution Notes

Follow [`AGENTS.md`](AGENTS.md) and the specification governing the changed
owner. Browser requests stay same-origin under `/api`; business authorization,
automatic-program decisions and multi-row transactions stay on the server;
production lifecycle mutations stay in Control Center after enrollment; and
all visible copy and accessibility names ship in English and Spanish together.

When changing a user-facing page component, update the matching terminology
file in `Terminology/Pages/...` when its canonical product vocabulary changes.
