# Anote

Anote is a personal calendar system for turning plans into managed event state. It is not only a date grid: it is a full-stack event administration workspace with day-level CRUD, completion tracking, postponed-event queues, event transfer history, role-scoped Markdown notes, friend calendar distribution, automatic carryover programs, profile-level visual configuration, and an admin console for system oversight.

The product is designed for users who need a calendar that can preserve context while plans change. A Day Event can be completed, copied, moved, postponed, restored, shared with friends, annotated by role or subrole, and traced through origin history. The Calendar Page supports lightweight planning and social distribution, while administration pages provide controlled workflows for editing event state without losing the record of how the plan evolved.

Anote's current automation layer is the To Tomorrow Program: a user-configured automatic program that moves today's incomplete events to tomorrow at a chosen session-clock activation time. This gives the calendar an explicit end-of-day carryover protocol instead of relying on manual cleanup or stale unfinished events.

The shared product vocabulary lives in [`Terminology/`](Terminology/README.md). Use those names when writing prompts, issues, changelogs, pull requests, and implementation notes.

## Current Product Shape

Anote is organized around an authenticated **App Shell** that renders one active page from Zustand view state:

- **Calendar Page**: two-month planning workspace with in-calendar day selection, friend read-only mode, day inspection, day visual settings, selected-day event reading, selected-day event sharing with optional event filtering, and explicit group event day marking.
- **Day Events Administration Page**: focused event workbench for one day, with event CRUD, completion, event history, copy/move, and postponed transfer actions.
- **Postponed Events Administration Page**: manages postponed events in `This week events` and `All events` scopes, including restoration back to calendar days.
- **Profile Page**: username, background image, accent color, noise overlay, and theme preferences.
- **Programs Page**: user-level automatic program settings, including the To Tomorrow Program activation time and enabled state.
- **Friends Page**: friend management and read-only friend calendar access.
- **Roles Page**: role and subrole labels used by event notes.
- **Admin Page**: admin-only app configuration, event/user management, raw table inspection, and bulk deletion.
- **Authentication Page**: login and registration surface.

Core event data supports title, date, hour, priority, note, link, completion state, postponed scope, and origin history. Role notes support Markdown and uploaded files. Program data currently supports To Tomorrow Program rows with a name, `HH:mm` activation time, and enabled flag.

## Why Use Anote

Anote is useful when calendar items are not disposable reminders but active records of work, study, routines, coordination, or personal planning.

- **Plan with continuity**: move or copy events across days while retaining origin metadata through Track Record surfaces.
- **Separate unfinished work from completed work**: completion state is preserved across event editing, sharing, postponed transfer, and automatic carryover.
- **Control today's execution**: use the Day Events Administration Page for focused event management on one date.
- **Hold deferred work outside the grid**: keep postponed events in scoped postponed views until they should return to a calendar day.
- **Coordinate with trusted users**: view friend calendars read-only and share all or selected marked-day events to friends' matching dates.
- **Attach structured context**: maintain role and subrole Markdown notes with uploaded files for event-specific documentation.
- **Automate daily carryover**: configure To Tomorrow Program rows so incomplete events from today move forward at a predictable activation time.
- **Administer the system**: use the Admin Page for app configuration, user/event management, raw table inspection, and controlled bulk operations.

The result is a calendar that behaves like an event-state management system: it supports planning, execution, deferral, collaboration, auditability, and daily reset workflows from one authenticated application.

## To Tomorrow Program

The **To Tomorrow Program** is an automatic calendar program configured from the **Programs Page** in the user menu. When an enabled row reaches its activation time according to the connected browser session clock, Anote activates the tomorrow program parameter, moves today's incomplete events to tomorrow, and closes the current session with this message:

```text
Tomorrow program activated, to disable, please go to Programs section.
```

The program does not move completed events, past events, future events, or events that are not assigned to the current day. This keeps the automation scoped to the user's active daily plan rather than rewriting calendar history.

Users can:

- Set one or more To Tomorrow Program rows with a descriptive name.
- Enter an activation time in `00:00` through `23:59` format.
- Enable or disable each row without deleting it.
- Run the program manually from the Programs Page to move today's incomplete events immediately.
- Keep completed work fixed on its original date while carrying unfinished work into tomorrow.

Example workflow:

1. Open the user menu from the avatar in the top-right corner.
2. Choose **Programs**.
3. Add or edit a To Tomorrow Program row named `Daily Carryover`.
4. Set activation time to `23:30` and enable the row.
5. Save Programs.
6. Continue using the calendar during the day and mark finished events as completed.
7. If the session is open at `23:30`, Anote moves only today's incomplete events to tomorrow and closes the session with the activation message.

This is useful for daily review routines, end-of-day carryover, and preserving completion records while keeping unfinished events visible on the next day's calendar.

## Architecture

```text
anote/
├── src/
│   ├── App.tsx                 # App Shell and active page selection
│   ├── components/
│   │   ├── Auth/               # Authentication Page
│   │   ├── Calendar/           # Calendar, day administration, postponed, notes
│   │   ├── Profile/            # Profile Page
│   │   ├── Programs/           # Programs Page
│   │   ├── Friends/            # Friends Page
│   │   ├── Roles/              # Roles Page
│   │   └── Admin/              # Admin Page
│   ├── store/                  # Zustand state, API actions, tests
│   ├── utils/                  # API, date, storage, priority helpers
│   ├── index.css               # Base styles and design tokens
│   └── App.css                 # App-level visual system
├── server/
│   ├── index.js                # Express API
│   ├── db.js                   # SQLite connection/helpers
│   ├── static_admin/           # Static admin support
│   └── uploads/                # Uploaded note files
├── Terminology/                # Shared page and component vocabulary
├── ChangeLog/                  # Release and change records
├── Enhancements/               # Enhancement specs
├── Bugs/                       # Bug records
└── scripts/                    # Release, deploy, and production user ops
```

The frontend uses React, TypeScript, Vite, Zustand, Tailwind CSS utilities, lucide-react icons, and React Markdown. The backend uses Express with SQLite through `better-sqlite3`, JWT authentication, and file uploads.

## Terminology

Terminology is arranged by page, then by page-relative component:

```text
Terminology/
├── README.md
└── Pages/
    ├── calendar-page/
    ├── day-events-administration-page/
    ├── postponed-events-administration-page/
    ├── profile-page/
    ├── programs-page/
    ├── friends-page/
    ├── roles-page/
    ├── admin-page/
    ├── authentication-page/
    └── app-shell/
```

Examples of canonical terms:

- **Day Event Board**: the editable event board on the Day Events Administration Page.
- **Range Transfer Board**: the day-administration board for copying, moving, and postponing selected day events.
- **Postponed Vault**: the page-level postponed storage context.
- **View Scope**: the postponed bucket, either `This week events` or `All events`.
- **Track Record**: event origin and transfer history.
- **Role Note Workspace**: the full-screen Markdown note editor for an event role or subrole.
- **Programs Page**: the user-menu page for automatic program rows.
- **To Tomorrow Program**: the automatic program that moves today's incomplete events to tomorrow.

For detailed component-part names, start at [`Terminology/README.md`](Terminology/README.md).

## Development

Install dependencies once:

```bash
npm install
cd server && npm install && cd ..
```

Run both development services with one command. The script selects Node 20 and
stops the API when Vite exits:

```bash
npm run dev
```

Default local URLs:

| Service | URL |
| --- | --- |
| Frontend | http://127.0.0.1:5174 |
| Development API (through the frontend) | http://127.0.0.1:5174/api |
| Direct development API diagnostics | http://127.0.0.1:3002/health/ready |

## Verification

```bash
npm run verify
```

Tests currently cover store behavior, calendar boards, postponed boards, day administration behavior, priority utilities, and backend migration/profile helpers.

## Server And Data

The development API expects `server/calendar.db` beside `server/index.js`. A fresh database is created on startup if the file is missing.

To reset local development data:

```bash
rm -f server/calendar.db server/calendar.db-shm server/calendar.db-wal
rm -rf server/uploads/*
cd server && PORT=3002 node index.js
```

Do not commit local databases, uploads, secrets, or production data. Production
state is owned by `ANOTE_PRODUCTION_HOME`. Its portable default is the operating
system's per-user application-state directory, outside the source checkout and
images.

## Production Operations

Production is a two-container stack modeled after Barcelonnette ERP:

- Nginx serves the compiled frontend and owns the only public gateway.
- `/api/*` is proxied to an internal Node 20 API container.
- SQLite, uploads, secrets, backups, and release manifests remain outside images.
- The API is never published directly on host port `3001`.

Users access production through:

- `http://anote` over MagicDNS/Tailscale;
- `https://<anote-device>.<tailnet>.ts.net` for browser-trusted HTTPS;
- `http://<host>.local:15173` on the trusted local network.

From a clean `main` commit that is present on `origin/main`, deploy with:

```bash
npm run prod:deploy
```

The compiled publish-and-deploy actions deploy their current verified branch
before merge with:

```bash
npm run prod:deploy:pushed
```

That command requires local `HEAD` to exactly match the current branch on
`origin`, creates an isolated clean checkout of that commit, and then invokes
the same production deployment. Unrelated local worktree changes are never
included in the release.

The deploy command builds commit-tagged images first, creates an SQLite-safe
pre-deploy backup, starts the replacement, waits for `/api/health/ready`, and
writes a release manifest. It automatically restores the prior data/runtime if
readiness fails.

Backup and rollback commands:

```bash
npm run prod:backup
npm run prod:rollback -- <backup-id>
```

`ALLOW_DIRTY=1` exists only for the one-time architecture bootstrap. Routine
production deployments must use either a clean `main` or the isolated exact
pushed-branch workflow; they must never use the dirty override.

Production user operations run from the development repo:

```bash
npm run --silent prod:user:make-admin -- --username=example-user
npm run --silent prod:user:remove-admin -- --username=example-user
npm run --silent prod:user:change-username -- --username=oldname --new-username=newname
npm run --silent prod:user:history -- --username=example-user
```

See [`scripts/PROD_USER_OPS.md`](scripts/PROD_USER_OPS.md) for full production user operation notes.

## Contribution Notes

Use TypeScript, React function components, typed props/state, single quotes, semicolons, and 4-space indentation. Prefer existing Zustand actions, utility helpers, and page/component vocabulary before introducing new abstractions.

When adding or changing a user-facing page component, update the matching terminology file in `Terminology/Pages/...` in the same change.
