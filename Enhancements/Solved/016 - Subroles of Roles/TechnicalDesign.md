# Technical Design

## Concrete technologies
React + TypeScript + Zustand on the client; Express + Node.js + SQLite on the server; Lucide icons for UI actions.

## Deployment topology
Single-page app served by Vite; API server on port 3001 with SQLite database on local disk.

## Data storage choices
SQLite tables: `roles` and new `subroles` table keyed by user_id, with `event_notes` storing content keyed by role/subrole id.

## Protocols and formats
REST JSON endpoints over HTTP with Bearer token authentication; JSON request/response bodies.

## Resource sizing
Single-node deployment with minimal memory overhead; subrole queries are simple reads by user_id and role_id.

## Failure & recovery mechanisms
API returns 4xx/5xx on invalid ownership or DB errors; client logs errors and refreshes state after mutations.
