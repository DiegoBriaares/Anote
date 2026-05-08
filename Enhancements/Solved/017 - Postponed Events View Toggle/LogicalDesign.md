# Logical Design

## System structure (components, modules, domains)
Postponed page UI (PostponedEventsView + subcomponents), calendar day administration (RangeBoard), calendar store, and postponed events API.

## Responsibilities and interfaces
PostponedEventsView owns the active view state and passes it to subcomponents. Subcomponents filter postponed events by view. RangeBoard supplies the target view when moving/copying to postponed. Store persists view in event resources.

## Data & behavior models
Postponed event includes postponedView: 'week' | 'all'. The UI filters by postponedView; missing values default to 'all'.

## Control & interaction flows
User toggles view -> subcomponents render filtered lists. User copies/moves day events -> selects view -> postponed events created with that view.

## Invariants & constraints
Each postponed event has exactly one view; edits do not change view unless explicitly set during creation.
