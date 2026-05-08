# Read Events Distribution

Added a Read Events flow to the selected-day event distribution workflow. After marking days, users can open a merged view where each selected day is rendered as a responsive column of events; wide selections wrap into additional rows.

Added an X cancellation action for selected-day operations. The action clears marked days, queued events, active drafts, read/input panels, and action errors without publishing anything.

The release also updates README and terminology documentation for the Read Events View, Group Event Reader, and Execution Cancellation Action.

Validation:
- `npx vitest run src/components/Calendar/GroupEventReader.test.tsx src/components/Calendar/CalendarView.selection.test.tsx src/components/Calendar/GroupEventPublisher.test.tsx src/components/Calendar/MonthGrid.test.tsx`
- `npm run build`
