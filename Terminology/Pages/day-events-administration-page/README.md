# Day Events Administration Page

**Component anchors:** `src/components/Calendar/DayEventsAdministrationPage.tsx`, `src/components/Calendar/DayAdministration.tsx`

The **Day Events Administration Page** is the focused workbench for one selected date.

## Page-Level Terms

- **Day Administration Header**: The page header with selected date and Back to Calendar action.
- **Active Administration Date**: The selected date being administered.
- **Day Administration Stack**: The ordered stack of day-specific management boards.
- **Empty Administration State**: The fallback shown when no date is selected.

## Components

- **Day Administration Stack**: The page's board layout.
- **Day Event Board**: Create, update, complete, sort, and delete events for the active day.
- **Day Event Information Board**: Read-only event history and completion information.
- **Range Transfer Board**: Copy, move, or postpone selected events from a source day to a target.
