# Release Workflow Instructions

Read [the release/checkpoint contract](../specs/control-center/release-checkpoint-contract.md)
and [Control Center system design](../specs/control-center/control-center-system-design.md)
before changing application or desktop release workflows.

- `anote-v*` and `anote-control-center-v*` are separate exact-commit release
  tracks. Validation intent must not publish.
- One clean application commit produces paired Linux amd64/arm64 packages with
  identical logical identity and exact archive-derived image identities.
- Stable publication verifies the exact asset set and commit before publish;
  failed lanes may leave only an unpublished draft suitable for exact-commit
  replay.
- Required signing fails closed when credentials are incomplete. Deliberate
  unsigned mode is disclosed and never labeled signed.
- Never upload production data, secrets, registries, journals, inbox/cache,
  backups, checkpoints or diagnostic logs as workflow artifacts.
