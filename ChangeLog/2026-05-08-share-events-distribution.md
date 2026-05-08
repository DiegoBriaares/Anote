# Share Events Distribution

Added a Share Events flow to selected-day event distributions. After marking days, users can open a friend checklist and copy every event from each selected day into the matching day on selected friends' calendars.

The backend now validates that every target is an existing friend before cloning events, and the frontend exposes a dedicated share panel with selected day, event, and friend counts.

Documentation was updated in README and Calendar Page terminology, including the new Group Event Sharer component vocabulary.

Validation:
- `npx vitest run src/components/Calendar/CalendarView.selection.test.tsx src/store/calendarStore.share.test.ts`
- `npm run build`
- `node --check server/index.js`

Known check status:
- `npm run lint` still fails on existing lint issues in server tests, App preference typing, admin/calendar effect rules, ProfilePanel effect rules, and store typing/unused variables.
