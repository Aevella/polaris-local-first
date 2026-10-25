# Persona

## Purpose

Persona defines collaborator identity, behavior settings, and long-lived reference heads used by chat and memory features.

## Owns

- Collaborator/persona directory.
- Persona settings and builder configuration.
- Product-level ownership of persona reference documents and memory heads.
- Persona projection state for UI and chat selection.

## Does Not Own

- Document body storage internals.
- Provider credentials.
- Global request transport.
- Collection card storage.

## Main Entrypoints

- `src/app/persona/`
- `src/config/persona/personaBuilder.ts`
- `src/stores/personaStore.ts`
- `src/stores/personaLocalDataPersistence.ts`
- `src/stores/personaMemoryReferenceDocPersistence.ts`

## Data It Reads

- Persona LocalData rows.
- Persona memory/reference document rows.
- Runtime settings needed to choose model-facing collaborator behavior.

## Data It Writes

- Persona directory rows.
- Persona settings projections.
- Reference document ownership links.
- Persona memory document references.

## Important Failure States

- Persona row is missing while another domain still references its id.
- Reference document metadata exists but the body is missing.
- Imported memory documents cannot be promoted because their content is incomplete.
- A historical persona lifecycle row remains outside live collaborator projection.

## Tests And Verification

- `npm run test:data-boundary`
- `src/stores/personaStoreHydrationPersistence.test.ts`
- `src/stores/personaMemoryReferenceDocPersistence.test.ts`
- `src/engines/localData/personaRows.test.ts`

## Known Cleanup Still Owed

- Keep persona reference-document ownership explicit as document/body storage continues to move toward cleaner LocalData boundaries.

## Related Intent

- [Memory and group chat intent](../memory-and-group-chat-intent.md)

## World Books And Missing Collaborators

World-book saves validate entries, enter the persona commit queue, persist the selected collaborator
row, and publish the in-memory result only after commit success. They do not read or rewrite document
bodies. The editor retains its draft after failure and detects edits made since it opened.

Missing-collaborator recovery reads the current repository. A complete live row can be reloaded into
the current list without rehydrating other collaborators. A missing row can be explicitly rebuilt;
a tombstone or damaged existing row cannot be replaced by this action.

New installations seed Pharos where bundled collaborators are enabled. Existing Xiao Assistant
records remain editable user data and are not reseeded or refreshed.
