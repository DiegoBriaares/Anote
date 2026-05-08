# Anote Terminology

This directory is the shared vocabulary for discussing Anote pages, page components, and component parts.

Use these names in prompts, issues, pull requests, changelogs, screenshots, and implementation notes. Each page has its own directory under `Pages/`; each page directory defines the page-level terms and contains a `Components/` directory for terms that are local to that page.

## Core Terms

- **App Shell**: The persistent authenticated wrapper around the active page. It owns the global banner, user menu, theme, background, and view switching.
- **Calendar Page**: The main planning page where users inspect two months, select days, open day details, and launch day or postponed administration workflows.
- **Day Events Administration Page**: The focused page for creating, editing, completing, copying, moving, postponing, and reviewing events for one selected day.
- **Postponed Events Administration Page**: The page for managing events that are not currently assigned to a calendar day.
- **Profile Page**: The page for username and visual preference changes.
- **Friends Page**: The page for friend connections and read-only friend calendar access.
- **Roles Page**: The page for maintaining role and subrole labels used by event notes.
- **Admin Page**: The admin-only console for app configuration, system event/user management, and database inspection.
- **Authentication Page**: The unauthenticated login and registration surface.

## Cross-Page Product Terms

- **Event**: A scheduled or postponed item with title, optional hour, priority, link, note, completion state, and history metadata.
- **Day Event**: An event assigned to a specific `yyyy-MM-dd` calendar day.
- **Postponed Event**: An event stored outside the calendar grid until copied or moved back to a day.
- **Event Priority**: A numeric ordering hint shown as `P#`; lower numbers sort first.
- **Completion State**: Whether an event is active or completed.
- **Origin Dates**: The event's transfer history, used by Track Record panels.
- **Track Record**: The user-facing event history disclosure for origin dates and postponed status.
- **Selection Window**: The date range selected by dragging across the calendar; it remains an in-calendar highlight until another selection or clear action replaces it.
- **Marked Day Set**: The days selected for group event publishing.
- **Execution Cancellation Action**: The X action that clears the active selected-day operation before it is published.
- **Read Events View**: A selected-day event distribution panel that wraps day columns into additional rows instead of relying on horizontal overflow.
- **Source Day**: The selected day whose events are being copied, moved, or postponed.
- **Target Day**: The destination day for copied or moved events.
- **View Scope**: The postponed bucket currently visible: `This week events` or `All events`.
- **Friend Calendar**: A read-only view of another user's calendar.
- **Role Note**: Markdown content attached to one event under one role or subrole.

## Directory Map

- `Pages/app-shell/`
- `Pages/authentication-page/`
- `Pages/calendar-page/`
- `Pages/day-events-administration-page/`
- `Pages/postponed-events-administration-page/`
- `Pages/profile-page/`
- `Pages/friends-page/`
- `Pages/roles-page/`
- `Pages/admin-page/`
