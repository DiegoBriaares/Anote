# Non-Functional Requirements

## Performance SLAs
Role and subrole lists should load within 300 ms on a local network; opening role/subrole modals should render within 100 ms after data is available.

## Availability targets
Feature availability matches existing app uptime; no additional availability target beyond current single-node deployment.

## Security requirements
All subrole CRUD endpoints require authentication and enforce user ownership checks; no subrole data is exposed to unauthenticated requests.

## Scalability limits
Support at least 500 roles and 2,000 subroles per user without UI degradation; server queries remain simple indexed scans by user_id.

## Compliance rules
No additional compliance scope beyond existing user data handling; no new PII stored.
