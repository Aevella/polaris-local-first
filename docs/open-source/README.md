# Polaris Documentation

Documentation for the Polaris codebase. Chinese counterparts are in [zh/](zh/).

Source code is licensed under AGPL-3.0-only.

## Start Here

- [Product intent](product-intent.md): product goal and design principles.
- [Product design notes](product-design/README.md): product philosophy with
  implementation references for the main Polaris product surfaces.
- [Open-source principles](open-source-principles.md): publication stance, source-package boundary, data ownership standard, and release-channel rules.
- [Architecture overview](architecture-overview.md): major runtime pieces and dependency direction.
- [Module guide](module-guide.md): each feature area, what it owns, and what it must not own.
- [Memory and group chat intent](memory-and-group-chat-intent.md): intent-to-implementation map for memory lanes, recall, group turn-taking, private lanes, and room artifacts.
- [Module design notes](modules/README.md): per-module notes for chat, collection, persona, runtime, tools, LocalData, import/export, native bridges, and server/selfhost.
- [Data and storage intent](data-and-storage-intent.md): LocalData, SQLite, blobs, projections, and import boundaries.
- [Data source decisions](data-source-decisions.md): active-source model, domain differences, and storage gates.
- [Backend and selfhost intent](backend-and-selfhost-intent.md): optional API surfaces and user-owned backend setup.
- [Public package boundary](public-package-boundary.md): source tree and archive contents.
- [Documentation policy](documentation-policy.md): documentation scope and style.
- [Publication checklist](publication-checklist.md): verification gates.
- [Module design template](module-design-template.md): format for new module design notes.

## Scope

- Product intent and architecture decisions
- Module ownership and responsibility boundaries
- Command names, pass/fail status, invariant names, and aggregate counts
- Source-readiness, publication-gate, and release-channel status

- [2026-11-15 public source maintenance](sync-2026-11-15.md): applicable product fixes, deliberate SQLite boundaries, and verification status.
