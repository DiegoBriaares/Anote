---
doc_id: architecture.anote-assessment
title: Anote Architecture Assessment and Closure Ledger
doc_type: architecture_assessment
status: active
graph_level: 2
references:
  - index.md
  - ../../specs/architecture/application-system-design.md
  - ../../specs/architecture/data-security-system-design.md
  - ../../specs/architecture/automatic-programs-system-design.md
  - ../../specs/control-center/control-center-system-design.md
  - ../../specs/control-center/release-checkpoint-contract.md
---

# Anote architecture assessment and closure ledger

## 1. Scope, method and status semantics

This is the evidence-backed improvement ledger for the architecture-hardening
and Anote Control Center delivery. The baseline is commit
`4f93ce99cc74c4bd5758ba62c5632a186b73a168` on 2026-07-28, inspected from a
clean worktree. The audit covers application composition, database integrity,
security, automatic programs, frontend architecture/localization/accessibility,
production topology and lifecycle/distribution.

Reasoning used the nearest code owner and concrete counterexamples. A finding
is material when it can cause unauthorized access, partial/corrupt state,
non-deterministic automation, unrecoverable production operation, cross-layer
contract drift, or disproportionate change locality. File size alone is not a
finding; it is evidence when unrelated responsibilities and invariants coexist.

Status values are:

- **Accepted — implementation required:** the target contract is decided and
  the named implementation/evidence must land in this delivery.
- **Implemented — evidence pending:** code exists, but the focused closure
  evidence named here has not yet passed for the final source state.
- **Closed:** implementation and focused evidence both satisfy the governing
  contract on the final source state.
- **Rejected:** no implementation is desired; the reason is a durable decision,
  not deferred debt.

**Closed** in this ledger means the repository implementation and the focused
evidence for the finding are complete. It does not claim that a stable release
has passed every external host, Docker Desktop, signing, publication or human
acceptance gate; those are recorded separately in Section 6.

Final repository evidence on 2026-08-30 is:

- **APP-GATE:** `npm run verify` passed the privacy guard, ESLint, the production
  TypeScript/Vite build, 30/30 test files and 115/115 tests on the final source.
  `server/backendHardening.test.ts` passed 21/21, including migration,
  transaction, session/origin, authorization, attachment and automatic-program
  owner evidence. The initial JavaScript chunk was 349.01 kB and the lazy note
  surface 132.44 kB, with no bundle-size warning.
- **CC-GATE:** the Control Center owner suite passed 41/41 tests. The macOS-arm64
  and Windows-amd64 payload-free self-checks and native-pair identity verifier
  passed in isolated roots without contacting a live installation.
- **MAC-PACKAGE-GATE:** the native macOS PyInstaller build, embedded self-check,
  arm64 Mach-O inspection and package inspection passed. This evidence does not
  substitute for the external gates listed in Section 6.
- **LEGACY-DATA-GATE:** a fresh SQLite backup of the operator-selected `cal-ap`
  dataset migrated twice idempotently to schema 4: 40 active plus three private
  recovery notes conserved all 43 source rows, two programs received distinct
  deterministic identities, sessions were empty, all four upload files remained,
  and integrity/foreign-key checks passed. Source hash, size and modification
  time were unchanged before and after the read-only copy/migration exercise.

A broad gate alone does not close authorization, failure atomicity, migration
or recovery. The rows below name the focused owner evidence within those final
results.

## 2. Baseline strengths to preserve

- Production already uses one gateway origin: the web container exposes the
  stable host port and proxies `/api` to internal API port 3001.
- SQLite and uploads already live in one configurable bind-mounted production
  data root rather than container layers.
- API and gateway have basic readiness checks; frontend fingerprinted assets
  have immutable caching while the application shell is no-store.
- Production scripts already attempt pre-deploy SQLite backup, readiness and
  rollback, establishing the correct operator intent even though they depend
  on host tools and cannot coexist as lifecycle owner with Control Center.
- Production configuration is environment-driven, and development seeding is
  opt-in rather than an implicit startup side effect.
- The current Vitest suite protects important event status, sharing,
  postponed-event, schema and program histories. These tests remain useful but
  do not by themselves prove the new security/lifecycle boundaries.

## 3. Findings and selected dispositions

### Application ownership and change locality

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| ARCH-001 Monolithic backend composition | `server/index.js` is 2,092 lines and owns startup, schema creation/rebuild, auth, all routes, uploads, admin, notes and errors; it declares about 60 route handlers. | A schema/auth/lifecycle change can alter unrelated route behavior; initialization can answer before a hidden callback chain is truly safe. | Apply `APP-OWN-*`: composition-only entrypoint and domain-named modules with route/service/database separation. Retain CommonJS. | **Closed.** `server/index.js` now owns only process/listener lifetime, `server/app.js` is importable composition, and database, HTTP and domain modules own their contracts. APP-GATE includes fail-closed startup/migration, scheduler-stop and API integration evidence. |
| ARCH-002 Monolithic frontend state/transport | `src/store/calendarStore.ts` is 2,335 baseline lines with 43 direct `fetch` calls, auth headers, serialization, all domains, navigation and automatic-program clocks. | One 401/error/wire change is interpreted many times; browser state becomes a second backend. | One typed same-origin client and focused auth/events/social/config/notes/program owners; server remains authority. | **Closed.** `src/api/client.ts` owns relative cookie transport/error classification and focused store owners call typed runtime-validated APIs. Static review found no bearer-token construction or raw component transport; APP-GATE includes client contract and focused owner tests. |
| ARCH-003 Duplicate/ad hoc route contracts | `/admin/users` is registered twice; response/error shapes and raw database messages vary by route. | Express order silently shadows a handler and clients must infer errors from prose/status combinations. | One route per intent and the `APP-HTTP-*` request-ID/error envelope. | **Closed.** `server/app.js` mounts one router per intent and `server/http.js` owns bounded request IDs and one safe error envelope. APP-GATE includes the representative API origin/session/error integration and frontend stable-code contract tests. |
| ARCH-004 Configuration polling and eager workspaces | `App.tsx` polls `/config` every three seconds and eagerly imports calendar, profile, programs, friends, roles and admin surfaces; baseline build reports a >500 KiB main chunk. | Every open client creates needless load; unrelated workspaces inflate initial startup. | Bootstrap/focus/invalidation configuration reads and stable lazy workspace boundaries. | **Closed.** Final `App.tsx` performs bootstrap/focus configuration reads and lazy-loads non-calendar workspaces; `DayModal` gives the note/Markdown surface its own lazy boundary. Final APP-GATE production build passed on 2026-08-30 with a 348.80 kB initial JavaScript chunk and a separate 132.44 kB `NoteEnvironment` chunk, without Vite's bundle-size warning. |

### Data integrity and migration

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| DATA-001 Callback emulation hides synchronous SQLite failure | Baseline `server/db.js` wraps `better-sqlite3`, catches statement errors, may return `undefined`, and implements `serialize(fn)` as only `fn()`. | A caller omits/misorders a callback, then commits or returns success after a failed statement; `serialize` suggests an atomicity guarantee it does not provide. | Remove adapter; one synchronous database owner with thrown errors and explicit `transaction()`. | **Closed.** `server/db.js` exposes native synchronous statements and explicit immediate transactions; errors throw. APP-GATE includes injected nth-write failures proving event, admin, migration and program commands roll back. |
| DATA-002 Startup schema mutation is not fail-closed | `initDb` interleaves `CREATE`, `ALTER`, table rebuild/drop/rename, default seeding and callback completion; errors are frequently logged and processing continues. Historic scripts duplicate migration behavior. | A failed copy/drop/rename can expose a partially migrated database while readiness later reports ready. | Immutable ordered `schema_migrations`, transaction/rebuild verification, listener only after success, unknown-newer refusal. | **Closed.** Ordered checksummed migrations run before route/scheduler/listener readiness and reject gaps, drift, newer schemas and invalid production timezones. Inconsistent but preservable legacy note rows enter a private recovery partition; structurally impossible rows fail the complete phase unchanged. APP-GATE includes representative preservation, conservation, unchanged-version failure and repair/retry evidence. |
| DATA-003 Multi-row commands can partially succeed | Bulk event/postponed/share/admin flows manually issue `BEGIN`/`COMMIT`; callback/best-effort loops can log individual insert failure and still derive success/count from requested work. | The nth failure leaves earlier writes or reports rows that did not commit. | Service-owned synchronous transactions; committed SQLite change counts only. | **Closed.** Event, administration, program, role/social/user and notification owners use synchronous service transactions and committed change counts. APP-GATE includes nth-selection, nth-event, bulk revision and notification/session rollback post-state assertions. |
| DATA-004 Optimistic lock is racy and not owner-scoped | Event update reads `updated_at WHERE id=?`, optionally skips the check when version is absent, then performs a separate owner-scoped update; `Date.now()` is the token. | Two requests can both pass the read; guessed IDs disclose existence; same-millisecond versions collide; legacy writes overwrite. | Positive integer revision; require expected revision; atomic `id + owner + revision` predicate and non-enumerating classification. | **Closed.** Mutable event/program commands require positive revisions and mutate with one ID/owner/revision predicate. APP-GATE includes stale/foreign non-enumeration, no-mutation refusal and exactly-once revision increment evidence. |
| DATA-005 Relational ownership is implicit | Core tables have sparse foreign keys/ownership constraints; role/subrole/note/friend deletion performs multi-step manual cleanup. | Orphaned/cross-owner rows survive or partial cascade destroys only part of a domain aggregate. | Required foreign keys, canonical friendship uniqueness, owner/lookup indexes and transaction-owned cascades. | **Closed.** Versioned schema owners add required foreign keys, ownership triggers, canonical friendship uniqueness and owner/query indexes. Notes without a valid parent are kept outside the operational graph and cannot borrow authority from an unrelated role. APP-GATE includes representative legacy graph rebuild, `foreign_key_check` and cross-owner preservation/refusal evidence. |
| DATA-006 Requested legacy dataset contains inconsistent private rows and duplicate program identities | Read-only inspection of the operator-selected `cal-ap` copy found 43 legacy event-note rows: 40 can form a valid owner graph after deterministic role repair and three reference deleted events. Two user preferences also reuse one non-empty program ID. | Failing the whole transfer strands otherwise valid production data; deleting rows loses private content; fabricating events or trusting role ownership reveals or misattributes it; nondeterministic collision repair makes release migration non-reproducible. | Partition missing-event notes losslessly into non-routable recovery storage, preserve SQLite value type and digest, treat role owner only as a hint, assert row conservation, and derive collision IDs deterministically in stable user order. | **Closed.** Schema migration 3 preserves the three unresolved rows without an HTTP/admin/log surface and migrates 40 valid rows; migration 4 produces two distinct deterministic program IDs while preserving unrelated preferences. Focused fixtures cover missing-role hints, typed values, replay and rollback; the requested copied dataset is verified separately without changing its source. |

### Authentication, authorization and content security

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| SEC-001 Persistent bearer JWT in browser storage | Login/register return a JWT signed without an expiration; the store persists it and repeats Authorization construction. | Any same-origin script compromise extracts a durable reusable credential; server cannot selectively revoke it. | 256-bit opaque sessions, hashed rows, HttpOnly Strict cookie, idle/absolute expiry and revocation; legacy JWT invalidation. | **Closed.** Sessions store only SHA-256 token hashes and issue `HttpOnly`, `SameSite=Strict`, path-scoped cookies with idle/absolute expiry and transactional revocation. APP-GATE includes cookie/origin/expiry tests and static evidence that browser storage and API responses contain no bearer credential. |
| SEC-002 Public secret-based administrator initialization | `POST /admin/init` accepts the production secret in an HTTP body and creates the first admin. | A deployment secret crosses browser/network/logging boundaries and remains an attack endpoint. | Remove route; one-time offline bootstrap through protected stdin/file descriptor using the normal user service. | **Closed.** The HTTP initialization route and shared-secret dependency are absent; offline bootstrap accepts protected stdin, delegates to the user service, redacts credentials and refuses replay. APP-GATE includes absent-route and two-attempt command evidence. |
| SEC-003 Weak and unbounded account entry | Registration accepts four-character passwords, is implicitly public, and login/registration have no rate limiting. | Online guessing and unsolicited account creation remain cheap; response branches can enumerate account state. | 12-character new password minimum, bcrypt cost 12, bounded limiter, generic failures, explicit fresh/legacy registration policy. | **Closed.** The auth/user owners enforce 12 Unicode characters, bcrypt cost 12, bounded account/IP windows, generic login/registration failures and explicit registration configuration. APP-GATE includes password, uniqueness, policy, limiter and refusal coverage. |
| SEC-004 Inconsistent resource authorization | `GET /events/:eventId/notes` reads by event ID without first proving owner/friend entitlement; related role constraints are dispersed. | An authenticated user guesses an event ID and reads another user's private role notes. | Central policy matrix: notes and note attachments owner-only; friend calendar and administration use minimal safe projections. | **Closed.** Note and note-attachment services authorize the parent event owner and use non-enumerating absence/denial; friend reads use a safe event projection. Administration cannot read event note/link fields or any raw table and receives only an explicit typed role projection. APP-GATE includes cross-user note/file and friend/admin boundary histories. |
| SEC-005 Public unrestricted upload namespace | Multer preserves arbitrary extension/type, returns `/uploads/...`, and `express.static(uploadDir)` serves files without authentication; gateway permits 25 MiB. | Uploaded HTML/SVG/script becomes trusted-origin active content; guessed URLs disclose private attachments. | Metadata-owned attachments, opaque IDs, MIME/size allowlist, authenticated policy streaming, `nosniff`, no static mount; replay-safe legacy mapping. | **Closed.** Attachments use opaque metadata, size/MIME/signature/path validation, authenticated policy streaming and gateway `nosniff`/sandbox headers; no public static upload mount remains. APP-GATE includes owner-only notes, authenticated avatar, tamper/path and legacy-reference evidence. |
| SEC-006 Raw operational details cross boundaries | Several routes return `err.message`; logs include upload filesystem paths and ad hoc exception content. | SQL/path/internal state becomes user-visible or diagnostic output leaks secrets/content. | Stable codes/request IDs, sanitized structured logs and bounded redacted diagnostics. | **Closed.** One responder emits stable codes and bounded request IDs while logs/diagnostics retain only safe structured facts. APP-GATE passed the privacy guard and responder/client contract fixtures without raw SQL, paths, tokens, secrets or content crossing the boundary. |

### Automatic program correctness

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| PROG-001 Browser is the execution authority | Programs live in profile JSON; `App.tsx` calls `checkAutomaticPrograms` every 30 seconds; run/pending/skip facts use browser storage and local clock. | Closed browsers never run; multiple devices race with distinct ledgers/timezones; storage deletion replays work. | Normalized server programs/run ledger, IANA timezone and worker lifecycle per automatic-program spec. | **Closed.** Normalized programs, durable run claims and the API-owned scheduler execute independently of browser presence; the client only configures and observes. APP-GATE includes migration, queued-worker shutdown, idempotent replay and focused client-owner histories. |
| PROG-002 Program movement is not one atomic command | Browser loops through occurrences and event HTTP calls, writing run markers only after each result. | Network/process failure moves a prefix and retries the wrong set; logout can occur after partial work. | One database transaction claims source date, moves exact pending set, records committed count and advances schedule. | **Closed.** One immediate transaction moves the exact pending set, records the committed count/run and advances the schedule; automatic notification acknowledgement and current-session revocation are also atomic. APP-GATE includes nth-event rollback, duplicate replay and notification-conflict unchanged-state evidence. |
| PROG-003 Timezone/DST/restart semantics are implicit | Browser `Date` and local storage define activation/catch-up; no persisted IANA zone or server next-run instant exists. | Different devices disagree and gap/repeated wall times produce missing/duplicate runs. | Explicit IANA zone, UTC next instant, documented gap/repeat rules and future-only legacy migration. | **Closed.** IANA zones and UTC next instants have deterministic gap/repeat rules; production refuses a missing/invalid migration timezone. Durable `automaticProgramArrivalDate` provenance prevents same-day catch-up cascades across bounded ticks/restarts while original current-day events still move. APP-GATE includes ordinary, DST, missed-day, restart and fresh-service evidence. |

### Frontend experience and localization

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| FE-001 Localization covers only a narrow service/status subset | Baseline `src/i18n/appText.ts` is 44 lines while navigation, auth, programs, admin, calendar, dialogs, errors and aria labels contain hardcoded English. | Language selection yields a mixed-language application; generated backend prose is shown directly. | Runtime provider, structurally equal comprehensive EN/ES catalogs, stable code/enum mappings and scan guard. | **Closed.** `AppText` makes English the structural contract and requires the Spanish catalog to provide the same nested keys, including every API error code; all reviewed visible component copy is injected through `LanguageProvider`. The final visible-literal review found only user/domain data and deliberately language-neutral tokens. TypeScript, focused provider/component tests and the production build passed on 2026-08-30. |
| FE-002 Legacy/system-facing copy and inaccessible controls | Login/calendar contain legacy Chronos/system-console wording; user menu uses a clickable `div`; native `confirm`/`alert` occur across workspaces. | Product identity drifts; keyboard/screen-reader users cannot reliably operate or recover from actions. | Anote/user-centered copy, semantic menus, accessible application dialogs/toasts and focus restoration. | **Closed.** Static scans over `src/components`/`src/i18n` find no Chronos branding or native `alert`, `confirm` or `prompt`; reviewed click targets are semantic or carry complete keyboard semantics. Application dialogs own labels, readiness, Escape/Tab behavior and focus restoration. The focused dialog/calendar suite passed 33 tests, with the final focus changes rechecked by 9 discriminating tests on 2026-08-30. |
| FE-003 Effect/type debt obscures state ownership | Baseline verification passes with 38 lint warnings, including effect-driven state updates, a missing dependency and unsafe `any` across major surfaces. | Stale closure/render loops and unvalidated wire data can bypass focused owners. | Resolve warnings in the redesigned owners; typed API/runtime parsing; no new warning budget. | **Closed.** Touched owners derive keyed/effective drafts instead of effect-resetting local state, parse unknown data at boundaries and contain no explicit `any`. `npx eslint src/components src/i18n`, `npx tsc -b --noEmit`, `git diff --check` and `npm run build` all passed with zero source warnings/errors on 2026-08-30. |

### Production lifecycle and distribution

| Finding | Observed baseline evidence | Failed obligation/counterexample | Selected disposition | Status and closure |
| --- | --- | --- | --- | --- |
| OPS-001 Shell scripts and Control Center would compete | Existing `prod:deploy`, backup and rollback scripts can mutate the live Compose/data state independently. | Registry/journal assertions become false after an out-of-band deployment. | After enrollment, production-mutating scripts detect the registry and refuse with Control Center guidance; development helpers remain. | **Closed.** Legacy mutation entrypoints resolve the installation registry before opening production data and refuse enrolled roots with Control Center guidance. APP-GATE includes production-path, user-operation and Control Center guard tests while unmanaged paths remain available. |
| OPS-002 Target installation depends on source/build host tools | Compose builds source images; scripts use host Git/npm/SQLite/rsync and historic checkout paths. | A target update depends on mutable registries/toolchains/checkouts; the current live container label can point to a temporary checkout that no longer exists. | Native immutable offline `.anote-release`, Docker Desktop only, generated managed runtime and exact archive identity. | **Closed.** The release codec/builder owns immutable image/config identities and Control Center writes a source-free managed runtime with host UID/GID data access. CC-GATE, native-pair verification and MAC-PACKAGE-GATE close implementation/package-contract risk; real application release builds and Docker lifecycle remain external Section 6 gates. |
| OPS-003 No durable cross-module lifecycle/recovery owner | Existing deployment metadata is not an installation registry with a shared operation lock, phase journal, role or retained state. | Crash/interleaved commands infer healthy state or delete the wrong resources. | Atomic registry, one mutation lock/journal and finite lifecycle per Control Center specs. | **Closed.** Atomic registry/storage, one operation lock, phase journal and lifecycle intent owner now gate every mutation/recovery path. CC-GATE includes exhaustive transition/refusal, second-writer, interrupted start/update and rollback convergence tests. |
| OPS-004 Production transfer format absent | Backups are local recovery artifacts; no platform-neutral self-contained dataset/checkpoint lineage exists. | Moving data between amd64/arm64 hosts either transfers raw live WAL state or loses uploads/ordering. | Verified SQLite backup plus canonical uploads `.anote-checkpoint`, logical release/lineage guards and staged swap. | **Closed.** The checkpoint codec uses SQLite backup, physical session scrubbing, canonical uploads, database/schema/digest/privacy checks, whole-package owned staging, live-runtime stopped proof, lineage guards and staged rollback. CC-GATE includes typed recovery/unreferenced-file round trip, raw session-marker absence, corrupt/private verifier refusal, nested link/reparse refusal, running-state refusal, validation rollback and same-installation refusal. |
| OPS-005 Legacy adoption cannot trust original Compose file | Current production labels may identify a temporary release checkout; only running container/image/mount state is durable. | Adoption invokes a missing path or destroys the only restartable legacy runtime before validation. | Capture exact legacy runtime, preserve it stopped, use a uniquely named managed project, commit only after validation, rollback by captured IDs/images/data. | **Closed.** Adoption captures inspected container/image/mount/network identity, rejects unsupported dependents, journals rollback state and commits managed identity before retiring exact legacy containers. CC-GATE includes missing-source-independent adoption and failure/recovery histories; live disposable Docker remains an external Section 6 gate. |
| OPS-006 Destructive scope is not registry-owned | Current production root has private sibling archives/development artifacts outside the live `production` subtree. | Name-based recursive erase can destroy unrelated user data. | Canonical registry-owned relative targets, path containment/link guards, separate safe uninstall and typed `ERASE ANOTE`. | **Closed.** Validated relative registry paths, root/link guards, exact-resource Docker identities and separate retain-data/typed-erase intents own destructive scope. CC-GATE includes symlink/intermediate-link, unrelated-sibling, exact-image and registry-scoped uninstall/erase evidence. |

## 4. Requirements-to-owner-to-evidence matrix

This matrix is the release-level drift check; detailed predicates remain in the
owning specification. “Closed” refers to repository implementation/evidence.
An entry marked **external release gate** is intentionally not claimed as run.

| Requirement | Authoritative owner/spec | Closed repository evidence | Independent boundary/release status |
| --- | --- | --- | --- |
| Startup cannot serve a partially migrated schema | database/composition owners; `APP-BOOT-001`, `DATA-MIG-001` | APP-GATE migration success/failure and readiness integration | Packaged container readiness is an **external release gate**. |
| Invalid/stale/denied commands do not partially mutate | domain transaction/policy; `DATA-TXN-*`, `DATA-REV-*` | APP-GATE failure injection, authorization matrix and API no-mutation contract | Closed; no additional platform boundary owns the transaction. |
| Browser credentials are revocable and script-inaccessible | session owner; `SEC-SES-001` | APP-GATE session/cookie integration and frontend storage/static scan | Closed by the same-origin browser/server contract. |
| Private content remains owner-scoped | policy/attachment owners; `SEC-AUTHZ-001`, `SEC-UP-001` | APP-GATE cross-user API/file tests, gateway configuration and absence of a static upload path | Live gateway smoke is an **external release gate**. |
| Automatic programs run once without a browser | program service/ledger; `PROG-RUN-*` | APP-GATE deterministic clock, transaction, restart/provenance and scheduler-lifetime tests | Live API-container scheduling is an **external release gate**. |
| UI is coherent EN/ES and operable | language/interaction owners; `APP-I18N-001`, `APP-UI-001` | APP-GATE catalog/static/component/focus histories | Native packaged UI and Windows human acceptance are **external release gates**. |
| One reviewed commit yields two compatible offline releases | release builder/codec; `PKG-REL-*` | CC-GATE native-pair contract and MAC-PACKAGE-GATE | Real paired `.anote-release` build/load/health is an **external release gate**. |
| Every Control Center mutation is serialized/recoverable/stopped | registry/journal/services; `CC-LOCK-001`, lifecycle model | CC-GATE exhaustive transitions, lock and phase-injection recovery | Disposable Docker Desktop lifecycle is an **external release gate**. |
| Checkpoint carries all logical data and no host identity/secrets | checkpoint codec; `PKG-CHK-*`, `PKG-PRIV-001` | CC-GATE deterministic typed recovery-row cross-root round trip and privacy guard | Opposite-host packaged apply is an **external release gate**. |
| Erase cannot escape Anote ownership | uninstall/path owner; `PKG-PATH-001`, `CC-ERASE-001` | CC-GATE containment/link/confirmation and unrelated-sibling tests | Disposable exact-resource removal is an **external release gate**. |

## 5. Deliberately rejected expansion

| Proposal | Disposition and rationale |
| --- | --- |
| Convert the backend to TypeScript in this delivery | **Rejected.** Runtime validation, transaction ownership and safe modular boundaries solve the observed risks; simultaneous language migration increases failure surface without closing another invariant. |
| Replace SQLite or add a distributed worker/queue | **Rejected.** One API instance and `better-sqlite3` transactions/unique constraints naturally own current load and exactly-once decisions. |
| Add a generic repository/DI framework | **Rejected.** There is one concrete database/runtime; domain-named services with explicit adapter injection give better cost and failure visibility. |
| Automatic failover or network replication | **Rejected.** No distributed lease can prove a single writer. Source/standby transfer remains operator-directed and stopped. |
| Control Center downloads/releases itself or embeds Anote | **Rejected.** Manual verified inbox and separate release tracks minimize target network/supply-chain authority. |
| Copy live SQLite/WAL or raw Docker volumes | **Rejected.** SQLite backup API plus canonical uploads is the portable consistency boundary. |
| Mutate the user's live production while developing the PR | **Rejected.** All native evidence uses isolated roots/projects/ports; live adoption is a later deliberate operator action. |

## 6. Closure boundary and external release gates

All material implementation findings in Section 3 are **Closed** by their
focused owner evidence and the final APP-GATE, CC-GATE or MAC-PACKAGE-GATE
results. No finding was relabeled cosmetic or closed by an unrelated build.

The following evidence is independently release-owned. This source assessment
does not infer or claim it from repository tests; the PR and eventual release
record must state which gates actually ran for the exact commit:

1. A disposable Compose/Docker Desktop smoke using the generated managed
   runtime and real application images, including gateway health, scheduler,
   checkpoint and exact-resource removal histories.
2. Real paired Windows-amd64 and macOS-arm64 `.anote-release` builds followed by
   Docker image load and exact readiness-identity validation.
3. Windows 11 x64 installer install/repair/uninstall, embedded self-check,
   Docker Desktop lifecycle and human EN/ES, keyboard and layout acceptance.
4. Native packaged UI/Computer Use review and the remaining macOS Docker
   lifecycle history.
5. Signing, notarization and publication, when the selected release policy
   requires them.

**Rejected as a PR-closure condition, not as a release requirement:** treating
those native/manual gates as a reason to leave implemented architecture
findings open, or inferring they passed from unit evidence. They remain
mandatory before publishing the affected stable release under the Control
Center specification.
