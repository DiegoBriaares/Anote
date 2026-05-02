Added the Today postponed-events domain.

The postponed-events workflow now uses a shared domain registry for This week, All events, and Today. Users can select Today when copying or moving events from the calendar into postponed events, switch to the Today page from the postponed-events toggle, and transfer postponed events into Today using the same controls as the existing domains.

Tests cover Today filtering, calendar-to-postponed transfers, postponed-to-postponed transfers, and API metadata parsing for the new domain.
