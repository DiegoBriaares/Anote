# Event Completion Toggle Persistence

Implemented a consistent completed/uncompleted event flow. The selected-day event board now persists completion changes through a dedicated completion action, falls back to full event updates when the running API does not expose the newer PATCH route, and prevents stale background refreshes from rolling back a newer completed state.

Validation:
- `npx vitest run`
- `npm run build`
