# Implementation

## Plan
Add subrole data model and API routes, update store to fetch/manage subroles, extend Roles dashboard UI to CRUD subroles, and add subrole selection modal to the day roles flow.

## Running code artifacts (binaries, services, packages)
Client: Vite SPA (`npm run dev`). Server: Express API (`node server/index.js`). SQLite database at `server/calendar.db`.

## Source code aligned with design
Server routes and schema in `server/index.js`. Store and types in `src/store/calendarStore.ts`. UI updates in `src/components/Roles/RolesPanel.tsx`, `src/components/Calendar/RolesModal.tsx`, `src/components/Calendar/SubrolesModal.tsx`, and `src/components/Calendar/DayModal.tsx`.

## Automated tests
No new automated tests added for this change; existing test suite remains unchanged.

## Buildable & deployable units
Client build via `npm run build`; server runs as a single Node process with the SQLite DB file.
