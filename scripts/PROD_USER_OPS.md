# Production User Operations

These commands manage users in the production database without exposing or
editing SQLite data manually. Run them from the development repository root.

The default production home is resolved portably in the same way as deployment:
the per-user application-state directory plus `Anote/production`. Override it
with `ANOTE_PRODUCTION_HOME`, `PROD_DIR`, `--dir`, or `--target-dir`. A saved
local override may live in the ignored `scripts/prod_user_ops.local.json` file.

## Commands

```bash
npm run --silent prod:user:make-admin -- --username=example-user
npm run --silent prod:user:remove-admin -- --username=example-user
npm run --silent prod:user:change-username -- --username=old-name --new-username=new-name
npm run --silent prod:user:history -- --username=example-user
```

Use an explicit production home when needed:

```bash
ANOTE_PRODUCTION_HOME=/path/to/private/production-home \
  npm run --silent prod:user:make-admin -- --username=example-user
```

Or override the database directly:

```bash
npm run --silent prod:user:history -- \
  --username=example-user --db=/path/to/private/calendar.db
```

The command family refuses to run in place from inside its selected production
home unless `--allow-in-place` is explicitly provided. Role changes are recorded
in `user_role_events`; current role ranks are `user` at 0 and `admin` at 100.

Never commit the resolved production path, local configuration, database,
uploads, usernames, role-history output, or credentials.
