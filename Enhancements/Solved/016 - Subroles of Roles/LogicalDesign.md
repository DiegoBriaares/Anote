# Logical Design

## System structure (components, modules, domains)
Frontend components: Roles dashboard and role selection modals. Store: calendar store for roles, subroles, and notes. Backend: Express routes for roles and subroles with SQLite persistence.

## Responsibilities and interfaces
UI triggers subrole CRUD and selection flows; store exposes fetch/manage methods; server validates ownership and persists subroles; notes remain keyed by role/subrole id in event_notes.

## Data & behavior models
Role: { id, user_id, label, color, order_index }. Subrole: { id, role_id, user_id, label, color, order_index }. Event note: { event_id, role_id, content } where role_id may be a role or subrole id.

## Control & interaction flows
Roles dashboard -> add/rename/delete role or subrole -> store call -> API -> DB -> refresh store. Day modal -> roles modal -> optional subroles modal -> note environment.

## Invariants & constraints
Subrole must reference a valid role and user; subrole labels are non-empty; delete role cascades to subroles.
