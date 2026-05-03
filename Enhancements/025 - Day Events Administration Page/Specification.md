# Day Events Administration Page Specification

## Goal

Move the existing day administration surface out of the calendar page and into a dedicated application view. The calendar keeps day selection and the double-click day modal. The modal exposes a new administration action that opens the dedicated page for the selected day.

## User Flow

1. The user double-clicks a calendar day.
2. The day modal opens with the existing settings and close actions plus a new event-list administration icon.
3. Clicking the administration icon switches the app to the Day Events Administration page for that date.
4. The page renders the existing administration sections:
   - Day Events Administration
   - Day Events Information
   - Day Events Management
5. The page provides a back action that returns to the calendar without changing self/friend view mode.

## Component API

- `useCalendarStore.navigateToDayAdministration(date)` is the public navigation API for components that need to open day administration.
- `useCalendarStore.dayAdministrationDate` stores the selected date as `yyyy-MM-dd` so page rendering is stable and testable.
- `DayEventsAdministrationPage` owns page layout and delegates all existing event behavior to `DayAdministration`.
- `DayEventsAdministrationPage` refreshes self or friend events while open, matching the calendar view's data freshness behavior.
- `DayAdministration` remains the composition point for `EventBoard`, `DayEventsInformation`, and `RangeBoard`.

## Interaction Rules

- The calendar page must not render `DayAdministration` below the month grids.
- Existing store-backed behavior in `EventBoard`, `DayEventsInformation`, and `RangeBoard` is preserved.
- Range management continues to read the global `selection`, so calendar-selected ranges are available on the dedicated page.
- Friend calendar behavior remains read-only through the existing child board contracts.

## Tests

- Store navigation tests cover the new view and selected date state.
- Modal tests cover the new administration icon action.
- Page tests cover rendering the selected day, preserving the three administration sections, and returning to the calendar.
