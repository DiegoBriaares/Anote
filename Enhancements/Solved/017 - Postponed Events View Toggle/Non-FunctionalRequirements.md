# Non-Functional Requirements

## Performance SLAs
Postponed view switching filters within 100 ms for up to 2,000 postponed events.

## Availability targets
Feature availability matches existing app uptime; no new services added.

## Security requirements
Postponed view metadata is stored with existing postponed event data and remains scoped to the authenticated user.

## Scalability limits
Support at least 2,000 postponed events per user with acceptable client-side filtering.

## Compliance rules
No new compliance scope; no additional PII stored.
