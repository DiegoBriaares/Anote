# Functional Requirements

## Use cases / user stories
As a user, I can toggle between "This week events" and "All events" when managing postponed items. As a user, when I move/copy day events to postponed, I can choose which view they belong to.

## Functional specs
The postponed administration header shows a two-state toggle for views with default "This week events". The postponed list, information panel, and range management panel only display events that match the selected view. Day administration copy/move to postponed includes a view selector, and new postponed events inherit the selected view.

## State transitions
Postponed page loads -> view defaults to "week". Toggling view updates all three postponed subcomponents. Day administration copy/move -> select view -> submit -> events saved into chosen view.

## Business rules
Postponed events belong to exactly one view. View value persists on the event and is preserved on edits; legacy events without a view map to "all".
