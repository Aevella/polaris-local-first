# Data And Storage

Polaris treats product data as durable facts plus runtime projections. Durable facts belong to
LocalData domain rows, typed SQLite tables where a domain needs indexed reads, and owned blob
stores for large binary payloads. Zustand stores and UI components project those facts for
interaction; they are not hidden databases.

## Core Contract

LocalData is the product-facing row contract:

- Domains: `asset`, `chat`, `collection`, `document`, `persona`, `runtime`, and `space`.
- Row states: `complete`, `unloaded`, `incomplete`, `timedOut`, and `deleted`.
- Commit metadata: domain, version, commit id, commit time, and validation/readback evidence.
- Active source: each domain can be promoted into the repository-backed source through its
  active-data-source row.

A domain with an active repository pointer reads from the repository only. A domain without an
active repository pointer may read only its current canonical fallback. Old Polaris storage formats
are external evidence for import, migration, census, health, validation, or explicit recovery; they
must not participate in ordinary startup hydration, lazy body reads, ordinary saves, or first-paint
cleanup.

`legacy` is not a valid active source value. The active source row names `repository` when the
repository is the current product truth.

## Source Map

| Domain | Current repository truth | Canonical fallback before activation | Auxiliary bodies |
| --- | --- | --- | --- |
| `chat` | LocalData chat rows selected by `local-data-v1:active-data-source` | `chat-catalog-v1` + `chat-conversation-record-v1:*` | none |
| `collection` | LocalData collection rows selected by `local-data-v1:active-data-source` | `collection-state-v2` | workspace document body rows |
| `document` | LocalData document rows selected by `local-data-v1:active-data-source` | legacy split body stores until guarded activation is safe | persona memory and workspace reference bodies |
| `persona` | LocalData persona rows selected by `local-data-v1:active-data-source` | `persona-state-v2` before guarded activation | persona memory document body rows |
| `runtime` | LocalData runtime rows selected by `local-data-v1:active-data-source` | `runtime-providers-v2` before activation | none |
| `space` | LocalData space rows selected by `local-data-v1:active-data-source` | `polaris-space-store-v1` and `space-theme-state-v1` before activation | none |
| `asset` | LocalData asset metadata and owner rows when active | `asset-meta`, `asset-binary`, `asset-preview` until guarded activation is safe | blob payloads |

`polaris-space-store-v1` remains the current frontstage fallback despite the key name. Its payload is
owned by the space store contract, so it should not be treated as legacy recovery material unless
the space owner changes.

## Ordinary Startup

Normal startup may install the platform LocalData backend, reconcile in-memory workspace bindings,
hydrate current projections, and report leftover durable asset-stage evidence. Before any store
hydrates, it may also repair metadata drift left by older public clean builds: only a domain already
present in the active row is eligible, its latest current-backend rows must pass strict hydration and
coherence validation, and only its existing active pointer is advanced. No content is copied and no
old store is read.

Normal startup must not scan old storage to decide live data, read v1 store keys as product
fallbacks, run LocalData auto-upgrade, activate a never-active domain, promote from old-source
evidence, compact old source keys, recover theme state from unrelated persistence backends, or apply
legacy runtime/collection/persona fields as compatibility fallbacks.

The metadata repair above is not domain activation or a data migration. A never-active domain,
missing commit pointer, or incomplete domain metadata remains untouched and is reported degraded.

When a repository read proves a row is missing, deleted, incomplete, or timed out, that state is
evidence. It cannot become an authoritative empty object.

## Body State

Directory rows and bodies are separate facts. Chat bodies use explicit store-level states:

- `notLoaded`: the directory is known and the body has not been read.
- `loading`: a body read or archive copy is in flight.
- `loaded`: the body was read or created; an empty message array is real only in this state.
- `missing`: the directory expects a body and the current read proved it absent.
- `failed`: the read failed for a non-missing persistence reason.

Persona memory documents and workspace reference documents follow the same completeness rule across
the `persona`, `collection`, and `document` domains. A chunked body must have contiguous chunks and
enough joined content to satisfy the owning directory row's `charCount`; shorter content is
incomplete evidence, not a smaller valid document.

## Object-Row Ownership

Product actions write the durable object they changed. Whole-domain snapshot traversal is reserved
for import, export, census, health, recovery, migration rehearsal, validation, and tests.

| Durable fact | Owner | Row shape |
| --- | --- | --- |
| Chat conversation metadata | `chat` | keyed upsert |
| Chat message body | `chat` | append/upsert message rows keyed by conversation and sequence/id |
| Chat task and workspace ledger | `chat` | keyed conversation sidecar or append ledger rows |
| Active chat conversation | `chat` | pointer |
| Cards, image cards, projects, and project files | `collection` | keyed upsert |
| Workspace reference document directory | `collection` | keyed upsert directory row |
| Persona memory document body | `document` | keyed upsert body row with completeness contract |
| Workspace reference document body | `document` | keyed upsert body row with completeness contract |
| Collaborator profile | `persona` | keyed upsert |
| Active collaborator | `persona` | pointer |
| Provider profile, MCP server, companion connection, trigger rule | `runtime` | keyed upsert |
| Active provider and scoped runtime settings | `runtime` | pointer or keyed upsert |
| Frontstage state, theme, customization, saved skins | `space` | pointer or keyed upsert |
| Asset metadata and integrity facts | `asset` | keyed upsert |
| Asset owner references | `asset` and owning domains | append/upsert owner evidence |
| Asset binary and preview payloads | blob store or platform file layer | blob payload addressed by asset id |

Append rows are for naturally ordered facts such as chat messages, tool ledger events, workspace
ledger events, and audit events. Keyed upsert rows are for current facts such as collaborators,
cards, skins, files, projects, providers, and settings. Pointer rows are for active selections.
Derived evidence rows are allowed for census, health, asset ownership, and readiness, but they must
not become the only owner of a product fact.

Row writers must know their owner and object id before writing. Do not add defensive lower-layer
null checks until the source chain proves the value can actually arrive invalid.

## Import, Migration, And Recovery

Import and migration are explicit boundaries:

```txt
legacy/package evidence -> staging rows -> readback -> validation -> coherent domain promotion
```

Old data can be counted, staged, validated, quarantined, or recovered by id inside these boundaries.
It does not become a second live source. Failed, missing, incomplete, or timed-out reads remain
diagnostics or quarantine evidence until a coherent domain row set is produced.

Structured export follows the current-directory boundary. When a domain is active in the
repository, export reads repository facts and owned blob/body payloads. It does not silently fill
missing current facts from old auxiliary stores.

Important files:

```txt
src/stores/storeImportPackage.ts
src/stores/storeImportLocalDataRestore.ts
src/stores/storeExportPackage.ts
src/stores/localDataMigrationStagingPersistence.ts
src/stores/localDataSourcePromotionPersistence.ts
src/engines/localData/*Migration*.ts
src/engines/localData/localDataExportRehearsal.ts
```

## Backends

LocalData has multiple physical backends behind one contract:

- KV/IndexedDB-backed browser storage.
- In-memory backend for tests.
- SQLite-backed implementations where supported.
- Native SQLite bridge through `src/native/localDataSqlite.ts`.

Stores and UI do not read SQLite directly. They use the LocalData contract.

SQLite is durable storage, not a new product authority. It should keep related writes together,
surface transaction/readback failures as repository failures, and preserve the same missing,
loaded, partial, deleted, and quarantined semantics as the row contract.

## Typed Chat SQLite

Typed chat SQLite tables provide the indexed/windowed shape for chat:

- `chat_conversation` owns list-level facts and metadata sidecars.
- `chat_message` owns window-readable message facts and payload sidecars.
- Summary reads avoid full metadata and message payload reads.
- Full conversation reconstruction reads metadata explicitly.
- Message reads are windowed by `conversation_id` and `seq`.
- Missing conversations, loaded empty conversations, partial windows, and invalid payload JSON are
  distinct states.

`src/engines/localData/chatSqliteLocalDataRows.ts` maps typed chat SQLite back into the current
LocalData chat row contract for validation and future repository integration.

## Blob And Body Boundaries

Large binary assets and long document bodies are not the same thing as directory rows.

- Asset metadata rows live in the asset domain; binary and preview blobs live in
  `src/infrastructure/assetStore.ts`.
- Workspace reference document directory rows live in collection; their bodies live in document.
- Persona memory document heads live in persona; their bodies live in document.

Missing metadata, missing body text, and missing binary payloads are separate failure states.

## Verification

Run these after storage changes:

```bash
npm run typecheck
npm run test:data-boundary
npm test
npm run build
```

Storage changes that touch native SQLite should also cover
`src/native/localDataSqliteNativeParity.test.ts` and at least one native channel sync/build before
making a channel-specific readiness claim.
