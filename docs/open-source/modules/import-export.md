# Import And Export

## Purpose

Import and export move data across a user-controlled package boundary. They let a deployment bring
supported package contents into the current LocalData model and produce backups from current facts.

Existing formats enter as package evidence at explicit import or migration edges. Ordinary startup
and ordinary saves use the current LocalData model.

## Owns

- Structured export import.
- Migration staging and validation.
- Package export from current LocalData facts.
- Complete-backup hydration of referenced document bodies before the snapshot is serialized.
- Census, health, and dry-run reporting for importability.
- Rollback and failed-import safety.

## Does Not Own

- Ordinary startup truth.
- Ordinary save paths.
- Silent fallback that treats missing data as current data.
- Placeholder replacement data.
- Old-user in-place upgrade promises.

## Main Entrypoints

- `src/stores/storeImportPackage.ts`
- `src/stores/storeImportLocalDataRestore.ts`
- `src/stores/storeExportPackage.ts`
- migration and census modules under `src/engines/localData/`
- `src/native/importRollbackFile.ts`

## Data It Reads

- Imported package contents.
- Existing-format package data as external evidence.
- LocalData staging rows.
- Rollback files and validation reports.

## Data It Writes

- Reconstructed LocalData rows after validation.
- Export package contents generated from current LocalData facts.
- Import diagnostics and rollback evidence.
- Promoted active-source rows only after the domain is coherent.

## Important Failure States

- Imported body, binary, or owner data is missing.
- A complete backup cannot load a referenced document body; export stops instead of emitting a partial archive.
- Package evidence is unreadable or malformed.
- Import refuses to promote a domain that cannot become coherent current rows.
- Import rollback must restore the previous visible state.

## Tests And Verification

- `npm run test:data-boundary`
- import/package tests under `src/stores/`.
- migration, census, and rehearsal tests under `src/engines/localData/`.
- native rollback tests under `src/native/`.

## Known Cleanup Still Owed

- Real package import/export/performance checks on actual device/browser runtimes remain release
  gates, even when source-level import tests pass.
