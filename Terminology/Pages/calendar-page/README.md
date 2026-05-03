# Calendar Page

**Component anchors:** `src/App.tsx`, `src/components/Calendar/CalendarView.tsx`, `src/components/Input/RangeEventInput.tsx`

The **Calendar Page** is the main planning workspace. Users navigate months, inspect day events, select ranges, open day administration, and enter postponed event management.

## Page-Level Terms

- **Calendar Workspace**: The two-month interactive calendar area.
- **Calendar Status Header**: The self/friend indicator above the calendar workspace.
- **Friend Read-Only Header**: The header shown while viewing a friend calendar.
- **Postponed Entry Button**: The button that opens Postponed Events Administration.
- **Range Sequence Console**: The modal opened after selecting a multi-day range on the calendar page.

## Components

- **Calendar Workspace**: Month navigation, compare toggle, and month boards.
- **Month Board**: One rendered month.
- **Day Inspector**: The double-click day detail modal.
- **Day Visual Settings Dialog**: The modal for day background and context label.
- **Range Sequence Console**: Multi-day bulk creation and quick copy modal.
- **Role Picker Dialog**: Role selection for event notes.
- **Subrole Picker Dialog**: Subrole selection for event notes.
- **Role Note Workspace**: Full-screen markdown note editor for an event role.
