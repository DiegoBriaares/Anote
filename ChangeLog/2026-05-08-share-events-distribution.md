# Share Events Distribution

Added a Share Events flow to selected-day event distributions. After marking days, users can open a friend checklist and copy every event from each selected day into the matching day on selected friends' calendars.

Improved the flow with a Select Events section. When disabled, sharing still sends all events from the selected days. When enabled, the panel shows selected-day events grouped like the Read Events view, defaults every event to selected, and provides Select All, Unselect All, and Select Active actions before sharing only checked events.

The backend now validates that every target is an existing friend before cloning events, and it accepts optional event IDs so filtered shares cannot include unselected events.

Documentation was updated in README and Calendar Page terminology, including the new Group Event Sharer component vocabulary.

Validation:
- `npx vitest run src/components/Calendar/CalendarView.selection.test.tsx src/store/calendarStore.share.test.ts src/App.test.ts src/store/calendarStore.profile.test.ts`
- `npm run build`
- `node --check server/index.js`
- `bash scripts/archive_prod_snapshot.sh` archived production to `/Users/digogonz/Desktop/Calendario/VersionesPasadas/30` and `/Users/digogonz/Desktop/Calendario/VersionesPasadas/31`
- `bash scripts/deploy_to_prod.sh`

Known check status:
- `npm run lint` still fails on existing lint issues in server tests, admin/calendar effect rules, ProfilePanel effect rules, and store typing/unused variables.
