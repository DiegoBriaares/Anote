# Anote Production Architecture

## Contract

The user sees one application origin. Frontend code calls relative `/api/*`
paths and never derives an API port from the browser hostname.

```text
Browser / MagicDNS / LAN
        |
        v
Nginx gateway (host 15173, container 8080)
        |-- / and /assets -> compiled React application
        |-- /admin/       -> API-owned administration UI
        `-- /api/*        -> Node API container:3001
                                  |
                                  `-> /data/calendar.db + /data/uploads
```

The Tailscale `anote` identity proxies HTTP 80 and HTTPS 443 to the Mac's
managed gateway. Port `3001` is never a Tailscale, LAN, or host interface.

## Ownership

| Invariant | Owner | Evidence |
| --- | --- | --- |
| Browser API requests are same-origin `/api` requests | `src/utils/api.ts` | URL regression test |
| Development and production internal routing | Vite and Nginx configs | config/build checks |
| API host, port, secret, database, and uploads | `server/config.js` | startup/config checks |
| API/database/upload readiness | `/health/ready` | API and Compose health checks |
| Persistent production state | managed production home | backup integrity and manifests |
| Build, backup, cutover, readiness, rollback | deployment scripts | isolated deployment rehearsal |

## Deployment Transition

| State | Guard | Action | Result |
| --- | --- | --- | --- |
| Source ready | clean commit on `origin/main`; verification passed | build images | immutable commit-tagged images |
| Images ready | production DB integrity is `ok` | backup | self-contained DB/uploads backup and manifest |
| Backup ready | candidate config and images exist | Compose replacement | internal API and gateway start |
| Starting | API/database/uploads ready | gateway health succeeds | release manifest records ready state |
| Failed | readiness or cutover fails | stop candidate and restore backup/prior env | prior persisted state/runtime restored |

Production data is stored under `ANOTE_PRODUCTION_HOME`, whose portable default
is resolved by `scripts/production_paths.sh`. A legacy source checkout may be
provided once through `ANOTE_LEGACY_DIR` for initial data import, but it is not
a deployment target.
