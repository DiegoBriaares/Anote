---
doc_id: specs.architecture.automatic-programs-system-design
title: Anote Automatic Programs System Design
doc_type: system_design
status: accepted
graph_level: 3
references:
  - application-system-design.md
  - data-security-system-design.md
  - ../ToTomorrowProgram.tla
---

# Anote automatic programs system design

## 1. Purpose and decision

This document owns automatic and manual calendar-program execution. Programs
are server-owned durable schedules. A browser may configure a program and
observe a run; it is not a clock, execution worker, replay ledger, transaction
coordinator or availability prerequisite.

The previous profile-preference/browser-storage implementation is migrated once
and removed. The legacy TLA module's event-movement safety properties remain,
but its connected-session clock and in-memory `hasRun` ownership are
superseded by the server schedule and durable run ledger defined here.

## 2. Representation and ownership

`programs` contains:

```text
id, user_id, name, enabled, activation_time, target_offset_days,
time_zone, next_run_at, revision, created_at, updated_at
```

- `activation_time` is a validated `HH:mm` wall-clock time.
- `target_offset_days` is an integer in the product-supported range 0 through
  365.
- `time_zone` is either a supported IANA timezone or a normalized fixed GMT
  offset from `GMT-12` through `GMT+14`, including minute offsets.
- `next_run_at` is the next UTC instant derived by the schedule owner.
- revision follows `DATA-REV-*`.

`program_runs` contains:

```text
id, program_id, user_id, source_local_date, target_local_date,
scheduled_for, trigger, moved_event_count, completed_at
```

`trigger` is `automatic` or `manual`. The database uniquely constrains
`(program_id, source_local_date)`. This is the durable exactly-once decision;
poll interval, process restart, browser count and retry count cannot create a
second run.

Events moved by a missed automatic occurrence carry reserved scheduling
provenance in their existing `resources` object:

```text
automaticProgramArrivalDate = YYYY-MM-DD
```

The program service is the only owner of this field. It records observation
date `O` when a missed source `S < O` arrives on `O`, in the same transaction as
the event move and run ledger. This is not another run claim and clients do not
interpret it. It exists so a later same-day occurrence can distinguish an event
that just arrived through catch-up from an event that was already scheduled on
that day, even when the worker batch ends or the process restarts.

Ownership transfer does not transfer scheduler provenance. When an event is
shared to another user, the event owner preserves ordinary resource history but
removes `automaticProgramArrivalDate` from the new copy; the recipient's
scheduler may establish its own marker only through a committed program run.

The program service owns validation, CRUD, execution, ledger creation and the
next occurrence. The scheduler owns only wake-up and bounded due-work
selection; it calls the service. The frontend program owner calls the API and
renders results. Program notification acknowledgement never owns or revokes an
authentication session.

## 3. Scheduling semantics

Dates and activation time are interpreted in each program's IANA timezone or
fixed GMT offset.
The server stores execution instants in UTC and source/target calendar dates as
ISO `YYYY-MM-DD` local dates.

For daylight-saving transitions:

- if an activation wall time does not exist because clocks move forward, use
  the first valid local instant after the gap;
- if it occurs twice because clocks move backward, use the first occurrence;
- one source local date still has at most one run.

On create, enable, activation/timezone change, or legacy migration,
`next_run_at` is the first occurrence strictly after the command commits.
Editing a schedule never retrospectively creates runs. Disabling clears
`next_run_at`; enabling computes a new future occurrence.

The worker starts only after migrations and stops before database shutdown. It
uses an injected clock in owner tests and the system clock in production. A
scan selects a bounded ordered batch by `(next_run_at, id)`. Each selected
program is re-read inside its transaction; disabled, edited, deleted, already
run or no-longer-due entries are harmless no-ops.

## 4. Run transaction

For program `P`, source local date `S`, observation local date `O`, and offset
`D`:

- an on-time occurrence (`S = O`) targets `S + D` calendar days;
- a missed occurrence (`S < O`) targets `O`, preserving the established
  catch-up behavior;
- a future source date cannot run;
- only the owner's pending events exactly on `S` move; completed and failed
  events, postponed events, other users' events and other dates do not change.

One immediate transaction:

1. Revalidates program owner/enabled/revision and due/manual command.
2. Inserts the `(program_id, source_local_date)` run claim.
3. Moves all eligible events, increments each moved event revision once and
   preserves/adds its origin-date history. A missed automatic move to `O`
   records `automaticProgramArrivalDate = O`; another eligible move clears or
   replaces stale arrival provenance as appropriate.
4. Stores the committed moved count and target date on the run.
5. Advances `next_run_at` to the first occurrence after this source date and
   the current observation instant.

Any failure rolls back the ledger, event moves and schedule advance. A unique
claim conflict returns the existing completed run without moving data. The
reported count is the committed SQLite change count.

When several programs become due, the deterministic worker order applies.
Before a current-date source `S = O` moves events, it excludes only rows whose
reserved arrival provenance equals `O`. Original current-day events have no
such marker and remain eligible for the ordinary `S + D` move. A missed source
on another date is not excluded by unrelated provenance. Because the marker is
committed with the catch-up move, this same-day no-cascade rule survives the
100-program scan bound, later worker ticks and process restart; it is not an
in-memory batch set.

Manual run uses the same transaction with today's local date. If that source
date already ran, it returns the existing result. Manual execution does not
close the browser session. A manual run before the activation instant fulfills
that source date, while `next_run_at` advances to the next date.

## 5. Migration from profile preferences

Migration reads only the recognized `preferences.programs` shape for each
user. Valid definitions become normalized rows with stable deterministic IDs
when an existing ID is usable, or generated IDs otherwise. It preserves names,
enabled state, activation time and target offset.

Timezone precedence is:

1. a valid timezone already present in the legacy definition;
2. a valid profile timezone;
3. `ANOTE_DEFAULT_TIME_ZONE`, written by Control Center from the host;
4. `UTC` only for unmanaged legacy development installations.

Migrated programs receive a future `next_run_at`; no historical run ledger is
invented and no past events move during migration. After every recognized
definition is durably present, only the legacy `programs` key is removed from
preferences. Theme, accent, background and all unknown preferences remain.
Replay sees existing stable identities and creates no duplicate rows.

Browser `localStorage` clock, pending-day, run and skip keys cease to influence
behavior. They may be deleted as cleanup after the server migration is observed
successful; their presence or corruption cannot affect server execution.

## 6. API and client behavior

Owner-scoped API intents are:

```text
list programs
create program
update program with expected revision
delete program with expected revision
run program now with expected revision
list run notifications after a cursor
acknowledge a run notification
```

Wire values contain program/run IDs, normalized schedule fields, revision,
next-run instant, last-run summary and a stable status code. They do not expose
SQL, worker polling state or another user's schedule.

The client starts new programs with the browser timezone and exposes an editable
text field with common suggestions. Users may submit IANA identifiers or GMT
offsets such as `GMT-6` and `GMT+5:30`; suggestions do not restrict accepted
values. Unsupported timezones are rejected without mutation. The UI describes
the effective local time/zone and next run in EN and ES.

An unacknowledged automatic run is a durable user notification. When an open
client observes it, the client acknowledges the notification, records a
short-lived result notice and reloads the page. After reload the authenticated
session is preserved and the localized notice is displayed. Manual runs use the
same reload-and-notice behavior. The event transaction is already complete; a
closed browser, failed acknowledgement, second device or repeated notification
poll cannot rerun it.

## 7. Transition model

| Model ID | Source facts | Command | Guard owner | Target/result | Meaningful refusal |
| --- | --- | --- | --- | --- | --- |
| PROG-CFG-001 | valid owner draft | create | program validator/service | revision-1 schedule; future next run | invalid time/zone/offset: no row |
| PROG-CFG-002 | current revision | edit/enable/disable | atomic program service | one revision increment and recomputed/cleared next run | stale/foreign: no mutation |
| PROG-RUN-001 | enabled, due, source not claimed | worker run | program service transaction | pending source events move; ledger commits; next run advances | transaction failure: all state unchanged |
| PROG-RUN-002 | source already claimed | worker/manual retry | unique ledger owner | existing result, no event mutation | none; idempotent success |
| PROG-RUN-003 | enabled, current revision, source not claimed | manual run | program service transaction | same atomic result, trigger manual | stale/foreign/future-invalid: no mutation |
| PROG-MISS-001 | due source before observed local day | worker run | timezone/schedule owner | pending source events target observed local date with durable arrival provenance; original events on that date remain eligible while catch-up arrivals cannot cascade | invalid clock/timezone: no mutation and retry remains due |
| PROG-NOTIFY-001 | unacknowledged automatic run, open client | observe/acknowledge | notification owner | notification acknowledged; page reloads and shows localized notice while session remains active | client failure leaves notification retryable; run remains committed |
| PROG-SHARE-001 | event with automatic arrival provenance is shared | share event | event/social owners | recipient copy preserves ordinary resources and removes server-owned arrival provenance | invalid stored resources abort the complete share transaction |
| PROG-MIG-001 | legacy profile definitions | schema migration | migration/program owner | normalized future schedules and unrelated preferences preserved | any invalid persistence step rolls back user migration |

Safety properties:

- a run changes only owned pending events on its exact source date;
- a source date commits at most once per program;
- run and moves are atomic;
- a completed or failed event never moves;
- a catch-up arrival cannot be moved again by a same-day occurrence, including
  after a bounded batch or process restart;
- an original pending event on the observation date remains eligible;
- configuration edits do not create retroactive executions;
- session availability cannot affect execution.

Liveness under stated assumptions: while the API process and database remain
available, every enabled due program is retried until it commits or is changed
or disabled. There is no liveness claim while Control Center has stopped the
API.

## 8. Evidence

Use a deterministic clock and representative IANA zones plus fixed GMT offsets
to prove ordinary, spring-gap and fall-repeat scheduling. A focused database integration suite
covers unique-claim replay, multiple workers racing the same source date,
mid-transaction failure, exact moved-set and revision behavior. Catch-up
evidence must instantiate a fresh program service between scans and prove both
that durable arrivals are excluded from a later same-day program and that the
original current-day set still moves. Migration evidence uses legacy
preference fixtures and asserts unrelated JSON survives. One API/client
history covers atomic notification completion/session preservation; browser tests
do not duplicate scheduling arithmetic or transaction evidence.

The legacy TLA model is retained only as a safety-property reference until its
server-owned replacement checker is in the verification gate. It must not be
used to justify browser clock or local-storage ownership.
