# LocalData

## Purpose

LocalData is the durable facts contract for app data.

## Owns

- Domain row ownership.
- Row states such as complete, unloaded, incomplete, timed out, and deleted.
- Commit validation and readback.
- Backend abstraction across KV, memory, Node SQLite, and native SQLite.
- Domain promotion, import, migration, health, and census invariants.
- Atomic domain replacement: row mutations, the domain commit pointer, and that domain's active
  pointer are one backend transaction.

## Does Not Own

- UI layout.
- Provider networking.
- Model request construction.
- Native product semantics.

## Main Entrypoints

- `src/engines/localData/`
- `src/stores/localDataStorePersistence.ts`
- `src/stores/localDataActivePointerReconciliation.ts`
- `src/stores/storeLocalDataBackendHost.ts`
- `src/app/bootstrap/storeLocalDataBackendBootstrap.ts`
- `src/native/localDataSqlite.ts`

## Data It Reads

- LocalData rows and active-source rows.
- Domain metadata rows.
- Backend key discovery results.
- Imported or migrated staging rows when called through explicit boundaries.

## Data It Writes

- Domain rows.
- Domain metadata rows.
- Active source rows.
- Tombstones and historical lifecycle marker rows.

## Important Failure States

- Duplicate row keys in a commit.
- Attempted downgrade or cross-domain write.
- Deleted row overwrite without explicit restore.
- Backend verification/readback failure.
- Split current data path, where one reader bypasses the installed backend host.
- Active-source drift, where an active domain pointer does not exactly match the current domain
  commit pointer.
- Older clean-build pointer drift is reconciled before hydration only for domains already named in
  the active row. Current rows must pass strict hydration and coherence validation before the
  repository advances the pointer; failure preserves the prior pointer and rows and reports
  degraded integrity without content.
- Strict backup reads reject any incomplete active row. Ordinary hydration isolates an optional damaged
  row, loads healthy rows, and records a degraded integrity event without projecting a failed body as empty.

## Tests And Verification

- `npm run test:data-boundary`
- `src/engines/localData/localDataRepository.test.ts`
- `src/engines/localData/localDataBackendContract.test.ts`
- `src/app/bootstrap/storeLocalDataBackendBootstrap.test.ts`
- `src/native/localDataSqliteNativeParity.test.ts`

## Known Cleanup Still Owed

- Browser/self-host stays KV-backed until a separate browser SQLite/WASM decision is designed and proven.
- Future storage work should keep LocalData as the contract and avoid direct SQLite reads from stores or UI.
