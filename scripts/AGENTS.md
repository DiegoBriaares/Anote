# Production Script Instructions

Read [Control Center system design](../specs/control-center/control-center-system-design.md)
and [the registry contract](../specs/control-center/release-checkpoint-contract.md)
before changing production, backup, rollback or user-administration scripts.

- An enrolled installation is mutated only by Control Center. Production
  deploy/patch/backup/rollback scripts must detect its registry before any
  Docker, database or filesystem mutation and refuse with operator guidance.
- Legacy unmanaged operations use a consistent SQLite backup API/boundary;
  never copy a live database/WAL/SHM set as independent files.
- Offline user administration must reuse backend domain policy, avoid secrets
  in arguments/logs and use explicit production paths.
- Tests use temporary owned roots and fake/disposable projects, never the live
  application home.
