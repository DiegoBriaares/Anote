---
doc_id: specs.index
title: Anote Specifications Index
doc_type: specification_index
status: accepted
graph_level: 1
references:
  - architecture/application-system-design.md
  - architecture/data-security-system-design.md
  - architecture/automatic-programs-system-design.md
  - control-center/control-center-system-design.md
  - control-center/release-checkpoint-contract.md
---

# Anote specifications

These documents are normative. Code, tests, operator interfaces, release
artifacts, and automation must agree with the applicable owner here. A change
that alters a listed invariant updates its owning specification in the same
change; a new narrative must not compete with an existing owner.

| Change surface | Governing specification |
| --- | --- |
| Application boundaries, API envelope, frontend ownership, startup, health | [Application system design](architecture/application-system-design.md) |
| SQLite, migrations, transactions, sessions, authorization, attachments | [Data and security system design](architecture/data-security-system-design.md) |
| Scheduled/manual automatic programs, timezone and replay behavior | [Automatic programs system design](architecture/automatic-programs-system-design.md) |
| Desktop lifecycle, Setup, Updates, Orchestra, uninstall, recovery | [Control Center system design](control-center/control-center-system-design.md) |
| `.anote-release`, `.anote-checkpoint`, registry and filesystem contracts | [Release and checkpoint contract](control-center/release-checkpoint-contract.md) |

The evidence-backed baseline and closure ledger is maintained separately in
[the architecture assessment](../docs/architecture/anote-architecture-assessment.md).
That assessment records what was found; these specifications own what must be
true.
