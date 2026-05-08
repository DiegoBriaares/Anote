# Calendar Page

**Component anchors:** `src/App.tsx`, `src/components/Calendar/CalendarView.tsx`

The **Calendar Page** is the main planning workspace. Users navigate months, inspect day events, select ranges, read selected-day event distributions, share selected-day events to friends, mark days for group event publishing, open day administration, and enter postponed event management.

## Page-Level Terms

- **Calendar Workspace**: The two-month interactive calendar area.
- **Calendar Status Header**: The self/friend indicator above the calendar workspace.
- **Friend Read-Only Header**: The header shown while viewing a friend calendar.
- **Postponed Entry Button**: The button that opens Postponed Events Administration.
- **Selection Window**: The in-calendar day range selected by dragging across month boards.
- **Read Events View**: The selected-day event distribution panel with one column per marked day.
- **Share Events View**: The selected-day event distribution panel for copying all or selected marked-day events into selected friends' calendars.
- **Group Publishing Steps**: The Select Days, Read Events, Input Events, Publish Events, Share Events, and cancellation controls used for selected-day event distribution work.

## Components

- **Calendar Workspace**: Month navigation, compare toggle, and month boards.
- **Month Board**: One rendered month.
- **Day Inspector**: The double-click day detail modal.
- **Day Visual Settings Dialog**: The modal for day background and context label.
- **Group Event Reader**: The responsive selected-day event distribution view.
- **Group Event Sharer**: The friend and event checkbox panel for sharing all or selected marked-day events to friend calendars.
- **Group Event Publisher**: The input surface for queued or active event drafts that will be published across marked days.
- **Role Picker Dialog**: Role selection for event notes.
- **Subrole Picker Dialog**: Subrole selection for event notes.
- **Role Note Workspace**: Full-screen markdown note editor for an event role.
