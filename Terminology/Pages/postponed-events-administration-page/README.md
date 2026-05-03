# Postponed Events Administration Page

**Component anchor:** `src/components/Calendar/PostponedEventsView.tsx`

The **Postponed Events Administration Page** manages events that are not assigned to a calendar day.

## Page-Level Terms

- **Postponed Header**: The page title and Back to Calendar action.
- **Postponed Vault**: The page-level summary block for postponed storage.
- **View Scope**: The active bucket: `This week events` or `All events`.
- **Postponed Board Stack**: The ordered stack of postponed boards.

## Components

- **Postponed Event Board**: Create, update, delete, sort, and scope postponed events.
- **Postponed Information Board**: Read-only history for postponed events.
- **Postponed Transfer Board**: Copy or move postponed events back to a calendar day or between postponed scopes.
