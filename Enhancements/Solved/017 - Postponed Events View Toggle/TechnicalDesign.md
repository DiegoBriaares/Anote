# Technical Design

## Concrete technologies
React + TypeScript + Zustand, Express API, SQLite, date-fns for date utilities.

## Deployment topology
Vite SPA frontend with a single Node/Express backend and SQLite file storage.

## Data storage choices
Store postponedView in postponed_events.resources JSON alongside existing origin data.

## Protocols and formats
REST JSON over HTTP with Bearer token auth; resources encoded as JSON.

## Resource sizing
No additional resource requirements beyond current postponed event handling.

## Failure & recovery mechanisms
Client logs API failures and keeps local UI state unchanged; server returns 4xx/5xx on invalid data or DB errors.
