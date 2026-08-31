---
doc_id: specs.architecture.data-security-system-design
title: Anote Data Integrity and Security System Design
doc_type: system_design
status: accepted
graph_level: 3
references:
  - application-system-design.md
  - automatic-programs-system-design.md
  - ../control-center/release-checkpoint-contract.md
---

# Anote data integrity and security system design

## 1. Purpose and security boundary

This document owns SQLite configuration and migration, atomic mutation,
revision semantics, sessions, origin protection, authentication throttling,
authorization and attachment access. It assumes one API process and one SQLite
database per installed Anote instance. A trusted LAN or Tailscale network does
not weaken application authentication or resource ownership.

Control Center may stop, snapshot and replace the complete data directory. It
does not issue business SQL. Offline administrator bootstrap is the only
non-HTTP account creation boundary and calls the same user/password service.

## 2. Database and migration contract

The database owner opens `better-sqlite3` synchronously and fails closed. It
sets and verifies:

```text
PRAGMA foreign_keys = ON
PRAGMA journal_mode = WAL
PRAGMA busy_timeout = 5000
```

The runtime supplies `ANOTE_POSIX_MODE_ENFORCEMENT=required|unsupported` from
the verified host platform. Database, upload, staging and retirement owners use
one mode-application boundary. `required` fails on every `chmod` error;
`unsupported` tolerates only `EPERM`, `ENOTSUP` or `EOPNOTSUPP` from a Windows
Docker bind mount. It never tolerates access denial or ordinary I/O failure.
The Windows host's per-user managed-root ACL remains the confidentiality owner;
the Linux container OS is not evidence of host filesystem semantics.

There is no callback compatibility adapter. A statement error throws to its
owning service; no wrapper converts failure into `undefined`, logs-and-continues,
or invokes later commit work.

`schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL,
checksum TEXT NOT NULL)` is the single schema-version owner. Migrations are
ordered immutable modules. Each migration runs inside one immediate SQLite
transaction unless SQLite itself forbids the operation; an exceptional migration
must stage a replacement database and atomically publish it before its version
is recorded. Startup refuses duplicate versions, gaps, checksum/identity drift,
an unknown newer database, or any migration error.

Table rebuilds copy all intended columns explicitly, verify row counts and
required invariants before dropping the old table, and preserve the original on
failure. Schema creation or repair is never interleaved with route registration.
Historic one-off migration scripts may inspect or delegate to the migration
owner but must not carry a second destructive schema definition.

Minimum relational rules include:

- every owned row references `users(id)` and deletes according to its domain
  policy;
- event notes reference an owned event and role; role ownership must match the
  event owner;
- subroles reference their owning role;
- friendships use a canonical ordered user pair and forbid self-friendship;
- sessions and attachments reference their owner;
- program runs reference a program and preserve their historical source date;
- event/postponed-event revisions are positive integers;
- query paths for owner/date, owner/status, session hash/expiry, attachment
  owner/purpose and due programs have matching indexes.

Legacy rows that cannot satisfy the new graph are never silently deleted and
never left operational through invented business data. Orphan events,
postponed events, roles, subroles, friendships and calendar metadata move to
`legacy_owned_row_recovery`, which preserves every source column as a typed SQL
literal plus canonical digest. Temporary technical parents may exist only
inside the same migration transaction when SQLite requires them to rebuild a
historic foreign-key shape; their exact IDs and dependent rows are removed
before commit, after the original row is conserved privately.

A legacy event-note row whose event is absent, whose role is absent, or whose
role owner differs from the event owner moves in the same migration transaction
to `legacy_event_note_recovery`. That private table preserves the source event
and role IDs, SQLite content value and storage class, source timestamp, a stable
source ordinal, canonical payload digest, reason, and revision. SQL-native
staging preserves NULL, BLOB, integral REAL and full-width INTEGER values
without JavaScript-number coercion; operational fallback values are derived
separately. A pre-migration event or role owner may be recorded only as an
`event_owner_hint` or `role_owner_hint`. A hint supports a future explicit
recovery decision but is not an authorization fact; migration never synthesizes
a role to turn the hint into access.

The migration asserts the conservation equation
`valid event_notes + recovery rows = legacy event_notes` before dropping the
legacy table. The recovery partition has no browser, ordinary API,
administrator raw-table, log, or diagnostics surface. Future recovery requires
a separately specified ownership-proof workflow; neither an administrator nor
a guessed role relationship may read or assign private note content by default.
Already-published schema-4 migration checksums are accepted as explicit legacy
identities. If such a database contains rows matching its old generated-parent
pattern, schema 5 copies the affected ownership graph into private recovery and
sets a fail-closed startup flag. It does not delete ambiguous historical data
or expose it while provenance remains unprovable.

Replay uses canonical typed tuples rather than delimiter-concatenated IDs, so
ambiguous strings and identical duplicate payloads remain collision-safe and
cannot duplicate a preserved row.

## 3. Transaction and revision invariants

Every command that can affect more than one row has one service-owned
transaction. Validation and authorization happen before mutation where
possible and are rechecked in the mutating SQL predicate where a race or stale
client matters. A thrown validation, constraint, storage or injected failure
rolls back the complete command.

| ID | Invariant | Owner |
| --- | --- | --- |
| DATA-TXN-001 | Bulk create/move/share/delete either commits the declared complete set or commits nothing. Returned counts come from committed changes, never requested input length. | corresponding domain service transaction |
| DATA-TXN-002 | Role/subrole, friendship, user deletion and note replacement preserve all foreign-key and ownership rules in one transaction. | corresponding domain service transaction |
| DATA-TXN-003 | Registration hashes before the write lock, then rechecks policy and commits the user plus initial session in one immediate transaction. | authentication and user/session services |
| DATA-TXN-004 | Saving a day's fact and background is one calendar-metadata command; both changed fields and any retired background attachment commit or roll back together. | calendar metadata and attachment retirement services |
| DATA-TXN-005 | Password comparison/hashing outside the write lock is provisional evidence: login rechecks the exact current hash before session insertion, and administrator user commands recheck the actor's current database-backed privilege in the final immediate transaction. | authentication and administration services |
| DATA-REV-001 | Mutable resource creation starts at revision 1. Every successful mutation increments exactly once. | resource service and schema constraint |
| DATA-REV-002 | Revision acceptance is one SQL predicate over resource ID, owner ID and expected revision. A preliminary read cannot authorize a later write. | resource service |
| DATA-REV-003 | Missing expected revision is invalid for an existing revisioned mutation; there is no legacy force-overwrite route. | route validator |
| DATA-FAIL-001 | A domain failure is translated once to a safe code. Raw database errors never cross HTTP. | service error type and responder |

An event update has the semantic shape:

```sql
UPDATE events
SET ..., revision = revision + 1
WHERE id = ? AND user_id = ? AND revision = ?
```

Zero changes are classified with an owner-scoped read inside the same
transaction only when the caller is allowed to distinguish stale from absent.
Deletes follow the same predicate. Timestamp fields are audit information, not
concurrency tokens.

## 4. Session and request protection

The browser session token is at least 256 random bits generated by the OS. Only
`SHA-256(token)` is stored in `sessions`; the plaintext exists only in the
cookie and request memory. Session rows contain owner, created time, last-seen
time, idle expiry and absolute expiry; revocation deletes the row.

The cookie is named `anote_session`, has `Path=/api`, `HttpOnly` and
`SameSite=Strict`. It has `Secure` whenever the effective gateway scheme is
HTTPS; local HTTP is an explicit documented deployment mode, not an implicit
downgrade. The gateway is the only trusted proxy. It rebuilds the effective
host/scheme from either its direct request or one complete validated
`X-Forwarded-Host`/`X-Forwarded-Proto` pair supplied by a TLS terminator and
rebuilds the client-address chain from its immediate peer. JavaScript never
stores or receives the token.

Sessions expire after 7 days idle or 30 days absolute, whichever is sooner.
The authentication owner may coalesce last-seen writes to one per five minutes.
Logout revokes the current row before expiring the cookie. Password change,
administrator account disable/delete, and explicit sign-out-all revoke all
affected sessions. Legacy JWTs are not accepted after the migration.

Every unsafe browser HTTP method (`POST`, `PUT`, `PATCH`, `DELETE`) validates
that `Origin` exactly equals the effective scheme and `Host`. The two explicit
Vite development origins are accepted only outside production. Missing,
opaque, multi-valued or mismatched origins fail before authentication-backed
mutation. Offline bootstrap and Control Center do not bypass this middleware by
calling browser routes.

Passwords for registration, administrator creation and password changes have a
minimum of 12 Unicode characters and are bcrypt-hashed at cost 12. Existing
valid hashes remain usable until changed. Logs, command arguments and response
details never contain passwords.

The single-process authentication limiter uses a bounded in-memory keyed
window: five failed login attempts per normalized account plus source IP in 15
minutes, and three registration attempts per source IP in one hour. Successful
login clears its account/IP failure bucket. Eviction is time-based and the map
has a hard cardinality bound. All invalid account/password/throttled login
responses are non-enumerating; HTTP 429 may include a bounded retry delay.

Registration is an immutable product rule: account creation is always open.
Schema migration 6 normalizes fresh and upgraded installations to
`registration_enabled = true`; offline administrator bootstrap cannot change
it. The public configuration projection retains that true key for compatibility.
A request attempting to disable it returns `IMMUTABLE_CONFIG_KEY` without
changing configuration or version state. Password, rate-limit, uniqueness and
non-enumeration rules continue to govern every registration attempt.

## 5. Authorization matrix

Frontend visibility is never authorization. The backend policy owner evaluates
the current database principal for every request.

| Resource/command | Owner | Friend | Administrator |
| --- | --- | --- | --- |
| Own profile, events, postponed events, roles/subroles, notes and programs | full domain operations | none | administration routes only; ordinary owner routes do not impersonate |
| Friend calendar | read only after canonical friendship exists | read friend's event projection | may use explicit audited admin event surface |
| Event notes and note attachments | read/write only when owning the parent event | none, even when the event projection is shared | none for note content or bytes; administration may manage the owning event projection but cannot inspect role notes |
| Avatar attachment | read/write own | any authenticated user may read an avatar referenced by a visible user/profile | same as authenticated user; account administration may clear reference |
| Background attachment | read/write own | none; current friend projections do not expose day-background attachment IDs | account administration may clear reference but does not receive attachment bytes by default |
| Application configuration | read allowed according to public config projection | same | write |
| Users/friendships | safe directory projection and own relationship commands | same | explicit administration commands |

Owner-scoped absent and denied note/attachment/event resources return the same
404 code. Friend event projections omit private note bodies, role note content,
attachment identifiers not meant for the projection, and internal ownership
metadata.

Administrator routes validate that the caller remains an administrator from
the database on each request and again inside a mutating transaction after any
awaited password hash. Static administration assets may be public, but
every data command is authenticated and authorized; serving a static screen is
not a privilege grant.

## 6. Attachment contract and migration

`attachments` owns an opaque ID, owner user ID, purpose (`avatar`, `note` or
`background`), optional event ID, original display name, server-generated stored
name, normalized MIME type, byte size, SHA-256 digest and creation time. The
filesystem path is derived only from the stored name under the configured
upload root; a request value never becomes a path.

Uploads are streamed/bounded to 10 MiB. Allowed inline content is JPEG, PNG,
GIF, WebP and PDF. Plain text, Markdown, CSV and common passive office/archive
documents may be retained only as downloads. HTML, XHTML, SVG, JavaScript,
ambiguous executable formats, device files and MIME/extension disagreement are
rejected. Server-generated names contain no user extension semantics.

`GET /api/attachments/:id` authenticates and applies the matrix above. Image
and PDF responses may be inline with their exact safe type; all other types use
`Content-Disposition: attachment`. Every response has `nosniff`, a restrictive
resource policy and no-store/private caching appropriate to authenticated data.
There is no unauthenticated static uploads mount.

Legacy migration does not rename bytes:

1. Resolve avatar URLs to their profile owner and create `avatar` metadata.
2. Resolve upload URLs in event-note Markdown to the parent event owner and
   create `event_note` metadata; multiple authorized references may point to
   the same immutable stored byte identity.
3. Rewrite only successfully resolved references to opaque API URLs inside the
   same logical migration operation.
4. Preserve unresolved files in the data directory and backups, record a
   sanitized count, and make them unreachable over HTTP.

The migration is replay-safe: a legacy stored name plus owner/purpose/parent
has one metadata identity, and rewritten API URLs are not processed again.
Filesystem bytes are not deleted during schema migration.

Normal owner deletion is different from migration preservation. Event/account
deletion and avatar/background replacement collect only their attachment
metadata, perform the database mutation and move newly unreferenced managed
files into a same-volume retirement directory inside one immediate transaction.
Move failure rolls the database back and restores prior moves. After commit the
retired bytes are deleted; restart reconciliation restores a retired file when
its metadata still exists and deletes it when the committed metadata is absent.
The retirement directory is inside the canonical uploads root so every offline
backup and checkpoint contains pending bytes together with the database fact
that decides recovery. It never scans or deletes unrelated untracked legacy
upload files.

## 7. Headers, logs and configuration

The gateway and API provide `X-Content-Type-Options: nosniff`, a restrictive
`Referrer-Policy`, frame denial, a Content Security Policy compatible with the
reviewed Vite application, and no cache for authenticated/API responses.
Fingerprint-named frontend assets remain immutable; the application shell and
runtime configuration require revalidation/no-store.

Logs are structured enough to identify request, operation, route family,
status and safe error code. They exclude request bodies for authentication and
attachments, authorization headers, cookies, database rows, note content,
filesystem secrets and environment values. Diagnostic output is redacted
before applying a bounded head/tail limit.

## 8. Evidence obligations

| ID | Counterexample to exclude | Smallest durable evidence |
| --- | --- | --- |
| SEC-SES-001 | Stolen browser-readable storage yields a reusable token | client static/storage scan plus login cookie integration |
| SEC-SES-002 | A password change or administrator demotion completed during bcrypt work still permits the stale request to create a session or mutate users | deterministic bcrypt-gate races with no-session/no-mutation post-state assertions |
| SEC-ORG-001 | Cross-site form/fetch mutates cookie-authenticated state | mismatched/missing origin integration refusal and no-mutation assertion |
| SEC-ORG-002 | TLS termination rewrites Anote's origin or a malformed forwarding pair weakens comparison | direct/Tailscale-style exact-origin integration plus gateway malformed-pair refusal |
| SEC-REG-001 | Upgrade/bootstrap closes public account creation or an administrator disables it | schema-5 migration, bootstrap and immutable-config integration evidence |
| SEC-AUTHZ-001 | A friend or guessed ID reads/writes private notes/files | policy/service integration matrix |
| SEC-UP-001 | Active content or traversal becomes same-origin executable content | upload/serve contract tests with malicious samples |
| SEC-UP-002 | Owner deletion/replacement leaks unreachable managed bytes, deletes bytes while metadata rolls back, or omits a pending owned byte from an offline snapshot | event/account/avatar/background retirement, rename-failure rollback, restart reconciliation and snapshot/restore tests |
| DATA-MIG-001 | Legacy schema/preferences/files are lost, fabricated or partially advanced | migration on representative database/data copy, active-plus-recovery conservation, deterministic replay and injected failure |
| DATA-TXN-001 | The nth row failure leaves earlier rows committed | service failure injection and post-state assertion |
| DATA-REV-001 | Two equal/older client versions both commit | atomic predicate integration test |
| DATA-FS-001 | A Windows Docker bind mount rejects POSIX `chmod` and prevents migration/readiness, or relaxed mode handling hides a real access failure | mode-policy owner tests plus native Windows checkpoint apply |

Broad browser repetition does not add evidence for database atomicity or
authorization. Those risks are proved at the real service/database boundary;
one representative browser history covers cookie/client wiring and localized
recovery.
