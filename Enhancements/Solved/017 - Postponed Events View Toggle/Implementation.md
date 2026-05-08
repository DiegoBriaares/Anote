# Implementation

## Plan
Add postponed view metadata to postponed events, add view toggle to postponed administration, filter all postponed subcomponents by view, and add view selection when copying/moving to postponed.

## Running code artifacts (binaries, services, packages)
Client: Vite SPA (`npm run dev`). Server: Express API (`node server/index.js`). SQLite DB at `server/calendar.db`.

## Source code aligned with design
Store updates in `src/store/calendarStore.ts`, UI updates in `src/components/Calendar/PostponedEventsView.tsx`, `src/components/Calendar/PostponedEventBoard.tsx`, `src/components/Calendar/PostponedEventsInformation.tsx`, `src/components/Calendar/PostponedRangeBoard.tsx`, and `src/components/Calendar/RangeBoard.tsx`.

## Automated tests
No new tests added for this change.

## Buildable & deployable units
Client build via `npm run build`; server runs as a single Node process with SQLite.
