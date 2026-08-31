# Frontend Agent Instructions

## Required design path

Read [the application design](../specs/architecture/application-system-design.md),
[data/security public contracts](../specs/architecture/data-security-system-design.md),
and [automatic-program design](../specs/architecture/automatic-programs-system-design.md)
for affected work.

## Ownership and interaction rules

- All HTTP crosses the typed relative `/api` client with same-origin cookie
  credentials and stable error-code parsing. Components and state slices do not
  construct bearer tokens, hostnames or duplicate response classification.
- Browser correlation IDs come from the transport-owned capability fallback;
  callers never invoke secure-context-only UUID APIs directly.
- Persisted domain identities never reuse request-correlation fallbacks. The
  API owns durable event UUIDs; browser-only draft/queue labels are omitted
  from create payloads and replaced by the authoritative response/read model.
- Focused state owners coordinate client histories; server authorization,
  revisions, transactions, schedule clocks and run ledgers remain authoritative.
- Write every visible label, status, error, dialog, generated label, tooltip and
  aria name in English and Spanish together. Inject current-language text at
  render time and map backend codes/enums before display. Do not hardcode normal
  workflow copy in JSX.
- Use Anote/user workflow language, not Chronos, API/backend, schema, stage or
  implementation jargon.
- Operable controls use semantic elements and keyboard behavior. Dialogs are
  named, manage/restore focus and preserve resumable edits on refusal. Native
  `alert()`/`confirm()` are not application primitives.
- Lazy-load feature-heavy workspaces. Poll only independently changing facts at
  a justified interval; automatic programs never depend on browser polling.
- Subscribe to the smallest stable Zustand projection a view needs. Whole-store
  subscriptions and long shell-wide transitions are prohibited; preload known
  lazy destinations at an intent boundary when first-navigation latency matters.

## Evidence

Use owner tests for client/state rules, catalog shape/parity for ordinary copy,
and focused component/browser histories only for independently fallible focus,
keyboard, routing or transport behavior. Prove both success and meaningful
no-request/no-mutation refusal for destructive or security-sensitive controls.
