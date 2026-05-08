# Group Event Publishing

Fixed the group event publishing flow so clicking `Publish Events` persists a filled event draft across the selected days, even when the event has not first been added to the queued list.

The change centralizes group publish payload creation, keeps publish eligibility aligned with either queued events or an active draft, and adds regression coverage for publishing a draft directly.

Validation:
- `npx vitest run src/components/Calendar/GroupEventPublisher.test.tsx src/components/Calendar/MonthGrid.test.tsx`
- `npm run build`
