# Day Events Administration Page

Moved day events administration from below the calendar into a dedicated page opened from the day modal.

The change adds a custom event-list administration icon, a store navigation API for selected-day administration, and a page-level composition that preserves the existing administration, information, and management sections. It also fixes follow-up runtime issues where user-directory errors appeared on the calendar, failed event saves cleared the draft, and the administration page felt slow or briefly regressed to a blank subtree.

Validation:
- `npx vitest run`
- `npm run build`
