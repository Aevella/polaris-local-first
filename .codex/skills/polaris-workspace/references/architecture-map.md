# Polaris Clean Architecture Map

## Persistence owner chain

- Startup composition installs one LocalData backend through `src/stores/storeLocalDataBackendHost.ts`.
- Native iOS/Android install SQLite. Web/self-host uses the LocalData KV backend over IndexedDB.
- Chat, collection, persona, runtime, space, document, and asset readers/writers call the installed
  LocalData repository. Ordinary startup has no legacy-store fallback after a domain is active.
- Large image, audio, video, and file payloads stay in blob storage. LocalData owns structured facts,
  asset metadata, and references. Secrets are not ordinary LocalData facts.

## Backup read policy

- `src/stores/storeExportPackage.ts` owns formal backup assembly.
- Formal backup reads are strict across all seven domains. An incomplete active row or body stops export.
- Ordinary hydration is recoverable. Optional damaged rows are isolated and reported; healthy rows load.
  A failed chat/document body remains failed or incomplete and is excluded from ordinary writeback.

## Import write policy

- `src/stores/storeImportPackage.ts` owns package parsing, complete preflight, localStorage rollback,
  and blob staging/upsert.
- `src/stores/storeImportLocalDataRestore.ts` owns domain replacement. Each domain commit writes incoming
  rows plus tombstones for absent installed rows through the current backend transaction.
- Domain failures retain that domain's prior facts. Successful domains may commit independently; the
  returned result and backup UI explicitly identify a partial import.
- Import never begins with whole-KV, whole-LocalData, whole-localStorage, or whole-blob clearing.
- Polaris and Kelivo ZIP inputs converge on the same structured import owner chain.

## Diagnostics boundary

- Local logs may retain error detail for the device owner.
- Remote diagnostics allow only backend, domain/row counts, failure stage, integrity state, and anonymous
  fingerprints. Chat text, titles, prompts, attachment content, identities, and credentials are excluded.
