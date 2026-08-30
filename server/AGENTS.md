# Backend Agent Instructions

## Required design path

Read, as applicable:

1. [Application system design](../specs/architecture/application-system-design.md)
2. [Data integrity and security design](../specs/architecture/data-security-system-design.md)
3. [Automatic programs design](../specs/architecture/automatic-programs-system-design.md)
4. [Release/checkpoint contract](../specs/control-center/release-checkpoint-contract.md)
   when changing readiness, migrations, bootstrap or production data layout.

## Ownership rules

- `index.js` is process composition only. HTTP adapters validate/translate;
  domain services authorize and own complete commands; the synchronous database
  owner owns connection policy, migrations and explicit transactions.
- Do not recreate callback-emulating SQLite APIs, log-and-continue migrations,
  raw-error responses, optional revision overwrites or route-local ownership
  policies.
- Unsafe cookie-authenticated requests pass the origin guard. Notes and note
  attachments are owner-only; friend views use a safe event projection.
- Automatic-program clocks, run claims and event movement live in the server
  program transaction. Browser presence is not a precondition.
- Offline administration calls the normal domain service and never accepts a
  production secret through an HTTP route or command argument.
- Health readiness stays false until migrations complete and reports the exact
  non-secret release/data-schema identity expected by Control Center.
- An inconsistent legacy row is conserved in a private migration-owned
  recovery partition; do not fabricate parents, discard content, treat an
  ownership hint as authority, or expose recovery content through HTTP,
  administration, logs or diagnostics. Preserve SQLite value/storage types in
  SQL-native staging, derive hints from a pre-repair snapshot, use canonical
  typed identities, and assert source-row conservation before dropping a
  legacy table.

## Evidence

Reason from the owner and counterexample. Use focused database/API integration
for atomicity, migration, authorization, session/origin, attachment and
scheduler risks. A frontend or broad build cannot prove those properties.
Failure/refusal tests must assert protected state is unchanged. Use a temporary
database/data root; never inspect or mutate live production data in a test.
