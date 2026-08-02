# LocalData Import/Export Intent

LocalData is the durable storage layer for Polaris. Import and export are the
package boundary around that storage: they let a user move current facts into
and out of the app while preserving ownership, bodies, blobs, runtime settings,
and validation evidence.

The product goal is to make continuity portable. A backup should restore into
visible current data, and an export should come from current facts rather than
from stale projections.

## Product Principles

### Durable rows have named owners

LocalData stores chat, collection, persona, runtime, document, asset, and space
facts in domain rows. Stores project those rows into UI state.

Implementation evidence:

- `src/engines/localData/`
- `src/engines/localData/localDataOwnerRegistry.ts`
- `src/stores/storeLocalDataBackendHost.ts`
- `src/app/bootstrap/storeLocalDataBackendBootstrap.ts`
- `src/infrastructure/nativePersistenceBackend.ts`

### Import promotes coherent current facts

Import reads package evidence, stages rows, validates bodies and owners, and
promotes data only when a domain can become current visible state.

Package preflight completes before current facts change. Blobs are staged by asset id, while each
structured domain replaces rows atomically on the installed LocalData backend and tombstones rows absent
from the package in that same commit. A failed domain retains its previous facts. Other domains may commit,
but the user receives an explicit partial-import result naming what changed and what was retained.

Implementation evidence:

- `src/stores/storeImportPackage.ts`
- `src/stores/storeImportLocalDataRestore.ts`
- `src/stores/localDataMigrationStagingPersistence.ts`
- `src/engines/localData/chatMigrationPlanner.ts`
- `src/engines/localData/storeHydrationValidation.ts`

### Export reads from the current model

Export packages are produced from current LocalData facts, with staging readback
and rehearsal checks available for validation.

Complete backup reads are strict: incomplete current rows or bodies stop export. Ordinary startup uses a
separate recoverable read policy that isolates optional damaged rows, continues with healthy data, and keeps
failed bodies out of empty-state writeback.

Implementation evidence:

- `src/stores/storeExportPackage.ts`
- `src/app/shell/completeBackupExport.ts`
- `src/app/shell/persistedBackupExport.ts`
- `src/engines/localData/localDataExportRehearsal.ts`
- `src/engines/localData/localDataExportStagingReadback.ts`

## Adjacent Responsibilities

- Product stores own UI projection and user interaction.
- Native bridges provide SQLite and file capabilities on installed platforms.
- Evidence and inspection surfaces report storage health.
- Cross-platform shell owns platform-specific backup entry points.
