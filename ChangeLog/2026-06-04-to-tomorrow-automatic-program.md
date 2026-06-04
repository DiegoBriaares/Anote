# To Tomorrow Automatic Program

- Added a Programs user-menu section with CRUD-style rows for To Tomorrow Program name, activation time, and enabled state.
- Implemented the tomorrow program parameter cascade so today's incomplete events move to tomorrow while completed, past, and future events stay unchanged.
- Added automatic session-clock activation that closes the session with the required protocol message after a scheduled run.
- Fixed activation-time editing so profile refreshes do not overwrite unsaved program drafts.
- Added focused Vitest coverage and a TLA+ contract with a finite TLC model configuration for the behavior.
