# Calendar Workspace

**Component anchor:** `src/components/Calendar/CalendarView.tsx`

The **Calendar Workspace** is the main interactive calendar component.

## Part Terms

- **Chronos Header**: The calendar-specific header with title, coordinates, and navigation controls.
- **Month Coordinates**: The `YYYY.MM` indicator for the first visible month.
- **Month Stepper**: The previous/next month control.
- **Compare Toggle**: Friend-view control that overlays the user's matching events as ghost events.
- **Postponed Entry Button**: Opens Postponed Events Administration.
- **Group Publishing Steps**: The Select Days, Share Events, Read Events, Input Events, Publish Events, and X cancellation controls.
- **Marked Day Set**: The days selected for group event publishing.
- **Execution Cancellation Action**: The X button that clears the current marked-day operation and returns the workspace to idle.
- **Group Event Reader**: The responsive selected-day event distribution panel.
- **Group Event Sharer**: The friend checkbox panel that shares marked-day events into selected friends' calendars.
- **Group Event Publisher**: The event draft and queue panel shown after marked days are accepted.
- **Month Board Grid**: The two-column area that renders the visible months.
- **Selection Prompt**: The footer hint shown when no date range is selected.
