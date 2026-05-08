# Group Event Sharer

**Component anchor:** `src/components/Calendar/GroupEventSharer.tsx`

The **Group Event Sharer** is the Calendar Page panel for sharing all or selected events from a Marked Day Set into selected friends' calendars.

## Part Terms

- **Sharer Header**: The title and selected day, event, and friend counts.
- **Friend Share Checklist**: The checkbox list of friends eligible to receive shared events.
- **Selected Friend Markbox**: A checked friend row in the Friend Share Checklist.
- **Select Events Markbox**: The checkbox that switches the share payload from all marked-day events to explicitly selected events.
- **Selected Event Checklist**: The responsive event checklist grouped by marked day.
- **Share Event Option Menu**: The Select All, Unselect All, and Select Active actions for quickly changing the Selected Event Checklist.
- **Selected Event Markbox**: A checked event row in the Selected Event Checklist.
- **Empty Friend State**: The placeholder shown when the user has no friends available.
- **No Events Notice**: The warning shown when marked days do not contain events to share.
- **Share Execution Action**: The button that copies the selected days' events into each checked friend's matching calendar day.
