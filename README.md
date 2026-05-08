# Anote

Anote is a full-stack calendar and event administration system. It combines calendar planning, day-level event administration, postponed event workflows, role-based notes, friend calendar viewing, profile preferences, and an admin console.

The shared product vocabulary lives in [`Terminology/`](Terminology/README.md). Use those names when writing prompts, issues, changelogs, pull requests, and implementation notes.

## Current Product Shape

Anote is organized around an authenticated **App Shell** that renders one active page from Zustand view state:

- **Calendar Page**: two-month planning workspace with in-calendar day selection, friend read-only mode, day inspection, day visual settings, selected-day event reading, selected-day event sharing with optional event filtering, and explicit group event day marking.
- **Day Events Administration Page**: focused event workbench for one day, with event CRUD, completion, event history, copy/move, and postponed transfer actions.
- **Postponed Events Administration Page**: manages postponed events in `This week events` and `All events` scopes, including restoration back to calendar days.
- **Profile Page**: username, background image, accent color, noise overlay, and theme preferences.
- **Friends Page**: friend management and read-only friend calendar access.
- **Roles Page**: role and subrole labels used by event notes.
- **Admin Page**: admin-only app configuration, event/user management, raw table inspection, and bulk deletion.
- **Authentication Page**: login and registration surface.

Core event data supports title, date, hour, priority, note, link, completion state, postponed scope, and origin history. Role notes support Markdown and uploaded files.

## Architecture

```text
anote/
├── src/
│   ├── App.tsx                 # App Shell and active page selection
│   ├── components/
│   │   ├── Auth/               # Authentication Page
│   │   ├── Calendar/           # Calendar, day administration, postponed, notes
│   │   ├── Profile/            # Profile Page
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

For detailed component-part names, start at [`Terminology/README.md`](Terminology/README.md).

## Development

Install dependencies once:

```bash
npm install
cd server && npm install && cd ..
```

Run the app with separate frontend and backend terminals:

```bash
cd server && PORT=3002 node index.js
```

```bash
npm run dev
```

Default local URLs:

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Development API/Admin | http://localhost:3002 |
| Production API/Admin | http://localhost:3001 |

## Verification

```bash
npm run lint
npm run build
npx vitest
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

Do not commit local databases, uploads, secrets, or production data. Production paths and secrets should be environment-driven before broader deployment.

## Production Operations

Patch the production copy while preserving database and uploads:

```bash
npm run prod:deploy
```

Useful options:

```bash
DRY_RUN=1 bash scripts/deploy_to_prod.sh
SKIP_INSTALL=1 bash scripts/deploy_to_prod.sh
PROD_DIR=/custom/path bash scripts/deploy_to_prod.sh
```

Production user operations run from the development repo:

```bash
npm run --silent prod:user:make-admin -- --username=USACO
npm run --silent prod:user:remove-admin -- --username=USACO
npm run --silent prod:user:change-username -- --username=oldname --new-username=newname
npm run --silent prod:user:history -- --username=USACO
```

See [`scripts/PROD_USER_OPS.md`](scripts/PROD_USER_OPS.md) for full production user operation notes.

## Contribution Notes

Use TypeScript, React function components, typed props/state, single quotes, semicolons, and 4-space indentation. Prefer existing Zustand actions, utility helpers, and page/component vocabulary before introducing new abstractions.

When adding or changing a user-facing page component, update the matching terminology file in `Terminology/Pages/...` in the same change.
