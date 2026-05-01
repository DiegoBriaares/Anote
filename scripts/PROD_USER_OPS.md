# Production User Ops

This document explains the developer-facing commands used from the development repository to manage users in the production copy.

## Purpose

These commands let you change production users without `cd`-ing into the production directory and without editing the SQLite database manually.

Default production path:

```bash
/Users/digogonz/Desktop/Calendario/cal-ap
```

Current resolution order:

1. `--dir=...` or `--target-dir=...`
2. `PROD_DIR=...`
3. saved local default in `scripts/prod_user_ops.local.json`
4. built-in fallback `/Users/digogonz/Desktop/Calendario/cal-ap`

All commands are intended to be run from the development repository root:

```bash
/Users/digogonz/Desktop/Desarrollo/plan-administration-management-system
```

## Commands

Promote a user to admin:

```bash
npm run --silent prod:user:make-admin -- --username=USACO
```

Promote a user to admin against an explicit production directory:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --dir=/Users/digogonz/Desktop/Calendario/cal-ap
```

Promote a user and save that directory as the new default:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --dir=/Users/digogonz/Desktop/Calendario/cal-ap --dir-default
```

Remove admin and revert to the highest active previous role:

```bash
npm run --silent prod:user:remove-admin -- --username=USACO
```

Change a username:

```bash
npm run --silent prod:user:change-username -- --username=oldname --new-username=newname
```

Inspect role history:

```bash
npm run --silent prod:user:history -- --username=USACO
```

Show the currently resolved default production directory:

```bash
node scripts/prod_user_ops.cjs show-default-dir
```

Set a new saved default directory without running a user operation:

```bash
node scripts/prod_user_ops.cjs set-default-dir --dir=/Users/digogonz/Desktop/Calendario/cal-ap
```

You can also target by user id:

```bash
npm run --silent prod:user:make-admin -- --id=user-123
```

## Role History

Role changes are recorded in the production database table `user_role_events`.

Current built-in role ranks:

- `user` -> rank `0`
- `admin` -> rank `100`

When a user is first touched by these commands and has no history yet, the script seeds history from the current `users` row:

- every user gets an initial `user` grant
- current admins also get an initial `admin` grant

When admin is removed, the command revokes `admin`, recalculates the highest remaining active role, and updates `users.is_admin` from that result.

Right now that means:

- removing admin usually falls back to `user`
- the model can support higher roles later without redesigning the command family

## Safety Model

The command family refuses to run "in place" from inside the target production directory.

That is intentional. The idea is:

- development repo is the control point
- production repo is the target
- database path is resolved explicitly

If you ever truly need to bypass that guard, use:

```bash
--allow-in-place
```

## Target Overrides

Override the production directory for a single command:

```bash
PROD_DIR=/custom/prod/copy npm run --silent prod:user:make-admin -- --username=USACO
```

Or pass it directly:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --target-dir=/custom/prod/copy
```

Short alias:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --dir=/custom/prod/copy
```

Persist the current explicit directory as the new default:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --dir=/custom/prod/copy --dir-default
```

Override the database directly:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --db=/tmp/test.db
```

Show adapter and fallback diagnostics:

```bash
npm run --silent prod:user:make-admin -- --username=USACO --verbose
```

## Notes

- The server now refreshes `is_admin` from the database on authenticated requests, so role changes do not require logging out and back in after the updated server code is deployed and restarted.
- Username changes may still require a browser refresh to update the cached username shown in the UI.
- Role history is authoritative for changes made through these CLI commands. The current admin UI still writes `users.is_admin` directly, so it does not yet record the same history.
