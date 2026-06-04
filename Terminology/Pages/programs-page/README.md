# Programs Page

**Component anchor:** `src/components/Programs/ProgramsPanel.tsx`

The **Programs Page** is the user-menu page for automatic program configuration. It currently manages To Tomorrow Program rows.

## Page-Level Terms

- **Program Control Header**: The page header, back action, and primary program commands.
- **Programs Table**: The editable table of persisted Program Rows.
- **Program Row**: A row with a program name, activation time, enabled state, and row actions.
- **Activation Time Field**: The `HH:mm` text input for the session-clock trigger time.
- **Program Enabled Toggle**: The checkbox that allows a Program Row to run automatically.
- **Run Now Action**: The command that executes the To Tomorrow Program immediately without closing the session.
- **Save Programs Action**: The command that persists current Program Row values to the user's profile preferences.
- **Program Status Message**: The feedback text below the Programs Table.

## Program Terms

- **To Tomorrow Program**: The automatic program that moves today's incomplete Day Events to Tomorrow.
- **Tomorrow Program Parameter**: The boolean cascade trigger that executes the To Tomorrow Program when true.
- **Automatic Activation Protocol**: The scheduled path that runs the To Tomorrow Program, records that the program ran for the current activation time, and closes the session with the activation message.

## Behavior Contract

When the To Tomorrow Program runs:

- Today's incomplete Day Events move to Tomorrow.
- Completed Day Events stay on their current date.
- Past and future Day Events stay on their current date.
- Event completion state is not changed.
- Manual Run Now execution keeps the session open.
- Automatic execution closes the session with `Tomorrow program activated, to disable, please go to Programs section.`
