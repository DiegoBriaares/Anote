# Functional Requirements

## Use cases / user stories
As a user, I can add subroles under a role so I can separate notes by sub-discipline without creating new top-level roles. As a user, when I click a role for a day, I can pick a subrole (if any exist) before opening notes.

## Functional specs
Roles dashboard lists subroles under each role; each role row has an "Add subrole" icon that opens a prompt to create a subrole. Subroles can be renamed or deleted from the role list. In the day roles popup, selecting a role with subroles opens a subrole picker with a back action; selecting a subrole opens the notes view for that subrole.

## State transitions
Day modal -> Roles modal -> select role with no subroles -> Notes. Day modal -> Roles modal -> select role with subroles -> Subroles modal -> select subrole -> Notes. Subroles modal -> Back -> Roles modal.

## Business rules
Subroles belong to exactly one role and one user. Subrole labels are required and unique per role by user convention. Deleting a role deletes its subroles. Users can only CRUD their own roles/subroles.
