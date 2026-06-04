# Programs Table

**Component anchor:** `src/components/Programs/ProgramsPanel.tsx`

The **Programs Table** is the editable table on the Programs Page.

## Part Terms

- **Name Cell**: The text input for a Program Row label.
- **Activation Time Cell**: The `HH:mm` text input for the row's automatic activation time.
- **Enabled Cell**: The checkbox that enables or disables automatic execution.
- **Delete Program Action**: Removes the Program Row from the draft table and persists the change on Save.
- **Dirty Draft**: A local row edit that has not been replaced by profile refresh data.

## Editing Rules

- Activation time values use `00:00` through `23:59`.
- Unsaved edits remain local until Save Programs is pressed.
- Profile refreshes must not overwrite Dirty Draft values.
- All current Program Rows execute the To Tomorrow Program behavior.
