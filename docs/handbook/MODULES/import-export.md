# Import And Export

Import and export move user-controlled packages across a fenced boundary. They are not ordinary
startup, and they are not a hidden runtime compatibility layer.

## Purpose

Export current facts into a package. Import package evidence by parsing, validating, reconstructing
current LocalData rows, and promoting only coherent domains.

## Boundaries

Import/export owns:

- Structured package parsing and writing.
- Foreign-format conversion where explicitly supported.
- LocalData reconstruction.
- Migration staging and validation.
- Durable blob staging and startup recovery for interrupted import.

Import/export does not own:

- Ordinary save paths.
- Ordinary startup truth.
- Silent fallback that treats old or partial evidence as current data.
- Release-channel readiness by itself.

## Source Map

```txt
src/stores/storeImportPackage.ts
src/stores/storeImportLocalDataRestore.ts
src/stores/storeImportApply.ts
src/stores/storeImportProgress.ts
src/stores/storeExportPackage.ts
src/stores/kelivoImportAdapter.ts
src/engines/localData/*Migration*.ts
src/engines/localData/localDataExportRehearsal.ts
src/engines/localData/localDataExportStagingReadback.ts
```

## Data Flow

Import:

```txt
package -> parse -> validate -> stage blobs -> atomically replace and activate each domain -> refresh stores
```

Export:

```txt
active LocalData facts + owned blobs/bodies -> package manifest -> zip
```

## Public Usage

- Use import for package evidence crossing into the current model.
- Use migration planners for legacy source evidence.
- Resolve interrupted asset stages from their durable manifest and the committed asset-domain pointer.

## Extension Rules

- New package fields need validation and tests.
- New foreign formats must convert into current package/domain rows, not into ordinary legacy KV.
- A failed domain should skip promotion rather than poisoning other domains.
- Do not write placeholder data to make a broken package look coherent.

## Verification

```bash
npm run typecheck
npm run test:data-boundary
npm test -- src/stores/storeImportPackage.test.ts src/stores/storeExportPackage.test.ts src/stores/kelivoImportAdapter.test.ts src/infrastructure/assetStore.test.ts
npm test
npm run build
```
