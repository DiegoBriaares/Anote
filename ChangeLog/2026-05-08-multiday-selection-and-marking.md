# Multi-Day Selection And Marking

Fixed a long-standing calendar issue where dragging across multiple days could open the legacy range input flow and leave the app showing only the background. Multi-day drag selection now stays on the calendar and preserves the selected day range after mouseup.

The release also improves group event day marking: in Select Days mode, users can hold click and hover across a continuous range to mark each day in that range.

Prompt archival was updated so new resolved bug and enhancement records are written directly under `Bugs/Solved` and `Enhancements/Solved`.

Validation:
- `npx vitest run src/components/Calendar/CalendarView.selection.test.tsx src/components/Calendar/MonthGrid.test.tsx src/components/Calendar/GroupEventPublisher.test.tsx`
- `npm run build`
