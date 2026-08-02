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
- Per-domain atomic replacement and failed-import safety.

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
- Validation reports and any legacy rollback artifact presented at the explicit recovery boundary.

## Data It Writes

- Reconstructed LocalData rows after validation, including tombstones for rows absent from the package.
- Staged/upserted blobs; old blobs are not cleared before the matching asset domain is committed.
- Export package contents generated from current LocalData facts.
- Content-free import diagnostics: backend, domain/row counts, stage, integrity state, and anonymous fingerprints.
- Promoted active-source rows only after the domain is coherent.

## Important Failure States

- Imported body, binary, or owner data is missing.
- A complete backup cannot load a referenced document body; export stops instead of emitting a partial archive.
- Package evidence is unreadable or malformed.
- Import refuses to promote a domain that cannot become coherent current rows.
- A failed domain commit leaves that domain's prior rows intact. Other domains may commit independently,
  and the import result must name both updated and retained domains instead of reporting silent success.
- A localStorage replacement failure restores the previous Polaris values. Asset staging failure restores
  every touched blob and leaves the prior asset index active.
- Package structure, required files, row shapes, asset indexes, and blob sizes must be validated before
  any current fact is mutated.

## Tests And Verification

- `npm run test:data-boundary`
- import/package tests under `src/stores/`.
- migration, census, and rehearsal tests under `src/engines/localData/`.
- native rollback tests under `src/native/`.

## Known Cleanup Still Owed

- Real package import/export/performance checks on actual device/browser runtimes remain release
  gates, even when source-level import tests pass.
