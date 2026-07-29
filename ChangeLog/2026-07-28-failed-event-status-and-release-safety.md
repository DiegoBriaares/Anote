# Failed event status and pre-deploy version preservation

Added `pending`, `completed`, and `failed` as mutually exclusive event outcomes.
Failed events use a red visual state throughout calendar, day, range, group, and
postponed-event views. The API persists the new state for regular and postponed
events, existing completion calls remain compatible, and schema migration adds
the `failed` flag with a safe default. Automatic programs now act only on pending
events, so neither completed nor failed events are moved to another day.

Production deployment continues to create an integrity-checked database and
uploads backup and copy the active runtime environment before cutover. Candidate
images now use a release-specific tag in addition to the Git revision, keeping
the previous image references intact even when the same commit is redeployed.
Rollback can therefore restore the saved data and runtime version without a tag
collision. A deployment contract test verifies the immutable tag and backup
ordering.

Verification covers status normalization, schema migration, store persistence,
program eligibility, localized controls, visual state hooks, and the production
recovery contract. Deployment remains gated on a merged pull request and a clean
local `main` that exactly matches `origin/main`.
