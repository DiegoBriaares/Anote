---
doc_id: specs.architecture.application-system-design
title: Anote Application System Design
doc_type: system_design
status: accepted
graph_level: 2
references:
  - data-security-system-design.md
  - automatic-programs-system-design.md
  - ../control-center/control-center-system-design.md
  - ../../docs/architecture/anote-architecture-assessment.md
---

# Anote application system design

## 1. Purpose and decision

This document owns Anote's application boundaries, dependency direction,
startup contract, transport contract, frontend state ownership, and production
health identity. The data/security and automatic-program specifications own
their narrower invariants.

The backend remains Node CommonJS for this change. Type safety at the network
boundary is provided by explicit runtime validators and matching TypeScript
contracts, not by a simultaneous server-language migration. Express, Zustand,
and `better-sqlite3` remain implementation choices; no dependency-injection
container or generic repository layer is introduced.

Anote has one effective browser origin. The gateway serves the application and
proxies `/api` to the internal API. Direct LAN/Tailscale HTTP uses the gateway
host and scheme. A TLS terminator such as Tailscale Serve may supply one
complete, syntactically valid forwarded host/scheme pair; partial, multi-valued
or malformed forwarding fails before proxying. Browser code never constructs a
host-specific API URL, reads the database, interprets Docker state, or owns
production lifecycle policy.

## 2. Ownership and dependency direction

| ID | Concept/invariant | Single owner | Allowed callers |
| --- | --- | --- | --- |
| APP-OWN-001 | Express construction, middleware order, route mounting, scheduler lifetime and controlled shutdown | application composition root | process entrypoint and integration harness |
| APP-OWN-002 | Schema version, connection policy, migrations and transaction execution | database owner | domain services only |
| APP-OWN-003 | Authentication/session commands and authorization facts | authentication and policy services | route adapters; other services consume an authenticated principal |
| APP-OWN-004 | Event, note, role, friendship, profile, configuration, attachment and program invariants | domain-named services | route adapters and scheduler; services may call another service only through its intent API |
| APP-OWN-005 | HTTP parsing, status mapping, request ID and JSON envelope | route adapters plus the error responder | Express only; domain services do not receive `req` or `res` |
| APP-OWN-006 | Browser transport, cookie credentials, envelope parsing and error-code classification | typed API client | focused frontend state owners |
| APP-OWN-007 | Auth/session, events, social, configuration, notes and programs client state | focused Zustand slices/actions | React screens through selectors and intent actions |
| APP-OWN-008 | Current language and every person-visible string | runtime language provider and EN/ES catalogs | render boundaries and shared components through localized props |
| APP-OWN-009 | Release ID, version, source commit and schema version reported by readiness | build/runtime configuration owner | health route and Control Center validator |
| APP-OWN-010 | Lossless partition of inconsistent legacy rows and any future recovery authorization | versioned migration owner and an explicitly specified recovery service | no HTTP caller exists in schema 5; raw administration and diagnostics are forbidden |

Dependency direction is:

```text
React view -> focused frontend owner -> typed API client
                                      -> same-origin /api
Express route adapter -> domain service -> database owner
scheduler --------------------------------^
Control Center -> gateway/readiness only; never application business tables
```

Routes validate and translate. Services authorize and perform complete domain
operations. The database owner exposes prepared statements and explicit
transaction callbacks, not callback-emulating wrappers. Views render state and
request intent; they do not reproduce server guards.

## 3. Backend composition and lifecycle

`server/index.js` is a process entrypoint, not a domain module. It must only
load validated configuration, create the application, start after initialization
succeeds, and install signal handlers. The composed application can be imported
without binding a socket so integration tests and offline administration can
use the real middleware graph.

Startup ordering is strict:

1. Parse configuration and create owned directories with restrictive defaults.
2. Open SQLite and apply connection policy.
3. Run versioned migrations to completion; any failure terminates startup.
4. Compose routes and start the automatic-program worker.
5. Bind the listener and mark readiness true.

Readiness is false before step 5 and after shutdown begins. Shutdown first
stops accepting work, then stops the scheduler, drains the HTTP server, performs
a bounded WAL checkpoint, and closes SQLite. Failure is logged with a request or
operation identifier and produces a non-zero process exit.

The backend is split by stable domain ownership, not by generic controller,
helper, or repository names. A module may expose pure validation separately
when it has multiple real callers. Raw SQL belongs to the database/migration
owner or the domain service that owns the transaction; callers never decode a
service's table representation.

## 4. HTTP and public contracts

All application API routes are under `/api` at the browser boundary; the
gateway removes that prefix only when proxying internally. Existing feature
route names remain unless a governing security contract replaces them.

Every JSON failure uses:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "details": {}
  },
  "requestId": "opaque-support-id"
}
```

`details` is optional, bounded, contains only safe structured values, and is
never required to choose a security-sensitive client branch. Raw exception,
SQL, filesystem path, token, stack, username-existence, or secret information
is forbidden. The frontend localizes `code`; the backend does not send normal
workflow prose. Unknown failures map to `INTERNAL_ERROR`.

Success responses use the smallest stable data shape needed by the caller.
Mutable resources carry integer `revision`. A stale mutation returns HTTP 409
with `REVISION_CONFLICT` and the current revision only when the principal is
authorized to know the resource exists. Invalid input is 400/422,
unauthenticated is 401, authenticated-but-denied is 403, and owner-scoped
missing/denied resources use the same 404 result where enumeration matters.

Every request receives or generates a bounded request ID. A syntactically valid
incoming gateway ID may be retained; otherwise the API generates one. It is
returned in `X-Request-ID`, included in the JSON error, and used in sanitized
logs.

`GET /health/live` proves only that the process can answer. `GET /health/ready`
proves migrations completed, SQLite responds, the upload root is readable and
writable, and the process is accepting requests. Its non-secret payload is:

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

Control Center accepts a replacement only when all four data identities equal the
selected verified release contract.

## 5. Frontend architecture and interaction contract

The typed API client is the only browser transport owner. It always uses
relative `/api`, `credentials: 'same-origin'`, parses the stable envelope, and
turns status/error codes into a closed error type. Its correlation-ID generator
uses `randomUUID`, random bytes, or a non-secret monotonic fallback in that
order, so an insecure-context browser cannot fail before issuing a request.
Correlation labels are transport-only and may never become persisted domain
identities. Event creation omits `id`, `revision`, and `version`; the API creates
the durable event ID with its OS-backed cryptographic UUID owner and ignores any
caller-supplied create ID from stale or direct clients. The validated create
response contains the complete persisted event and is applied before an optional
list reconciliation, so a committed event remains visible if that later read is
offline. A 401 invalidates the session
once through the auth owner; other state owners do not implement their own
logout rules. This applies uniformly to reads and every mutation command; an
owner must not retain authenticated state or issue a reconciliation read after
the server has rejected the session.

Focused state owners may coordinate a user history but must not become a second
server. In particular, authorization, optimistic-revision acceptance,
automatic-program clocks, run ledgers and multi-row atomicity remain on the
server. Server results replace or reconcile affected local values only after
success. Mutation owners expose an explicit success result to interaction
callers. Failed mutations retain resumable non-secret edits, surface the
localized error, and never close or navigate away from the editing surface as
though the command committed.

All visible strings—including dialogs, statuses, errors, empty/loading states,
generated labels, tooltips and accessibility names—exist in both English and
Spanish and are selected at runtime. Backend codes and enum values are mapped;
they are never printed directly. Spanish must convey the same action and
recovery, not mirror English word order. `Anote` is the only product identity;
legacy Chronos/system-console copy is not user-facing.

Operable controls use native semantics. Menus expose button/menu state and
keyboard behavior; dialogs trap focus, name their purpose, and restore focus;
destructive actions state their scope and require the governing confirmation.
`alert()` and `confirm()` are not application interaction owners.

Feature-heavy authenticated surfaces are lazy-loaded at stable view boundaries.
The shell, login and ordinary calendar remain the initial path; administrator,
profile, programs, social, roles and note-heavy workspaces load on demand.
The shell preloads authenticated menu workspaces when the menu opens. React
views subscribe only to the focused Zustand values/actions they render or
invoke; whole-store subscriptions are prohibited because unrelated polling or
domain changes would invalidate the calendar tree. Navigation state changes
synchronously and shell styling must not impose a one-second transition on
route changes.
Polling is permitted only when the server fact can change independently and no
event/read-on-focus boundary suffices. Configuration is loaded at bootstrap and
on deliberate invalidation/focus, not every three seconds.

## 6. Cross-boundary workflow traceability

| Model ID | Command/result | Guard owner | Required result | Focused evidence |
| --- | --- | --- | --- | --- |
| APP-HTTP-001 | Any invalid API command | route validator and error responder | stable localized code; no domain mutation | envelope/validation integration contract |
| APP-HTTP-002 | Authorized revisioned mutation | domain service transaction | exactly one committed revision increment | service transaction plus API contract test |
| APP-HTTP-003 | Stale or owner-invalid mutation | policy/service atomic predicate | conflict or non-enumerating not-found; no mutation | owner/revision integration test |
| APP-BOOT-001 | Process startup | composition/database owners | listener and scheduler exist only after migrations | initialization failure/success integration test |
| APP-STOP-001 | SIGTERM/container stop | composition root | no new scheduled work; SQLite closes cleanly | controlled-shutdown owner test |
| APP-I18N-001 | Language change | language provider | coherent EN or ES text and aria labels | catalog shape/parity plus representative render |
| APP-WRITE-001 | Profile/day-setting mutation | domain transaction, focused state owner and editing surface | one combined day command commits all changed fields; confirmed success applies/navigates; failure preserves server state, draft and surface with localized recovery | injected server rollback, owner request-shape tests and representative profile/day dialog interactions |
| APP-UI-001 | Guarded/destructive control | backend policy plus interaction owner | visible state agrees with effective result; refusal preserves edits/data | owner contract; browser evidence only for focus/routing risks |
| APP-HEALTH-001 | Control Center validation | runtime identity and readiness owner | exact selected release and usable data/upload boundary | packaged gateway readiness check |

## 7. Rejected alternatives

- A full TypeScript backend conversion is rejected for this delivery because it
  adds migration surface without itself fixing transaction, authorization or
  lifecycle ownership.
- A generic repository/service/controller stack is rejected; domain modules
  keep SQL cost and transaction boundaries visible.
- A second frontend data framework or dependency-injection container is
  rejected because there is one concrete transport and runtime graph.
- Browser-owned schedules, Docker-aware browser code, direct frontend database
  access, host-specific API URLs and independently translated backend prose are
  prohibited.

## 8. Acceptance

The design is satisfied when the entrypoint is composition-only, each mutable
workflow has one service/transaction owner, all frontend traffic crosses the
typed same-origin client, readiness reports exact release identity, visible
copy is bilingual and semantic interactions are operable. The architecture
assessment records implementation and evidence status; this specification does
not treat planned work as completed evidence.
