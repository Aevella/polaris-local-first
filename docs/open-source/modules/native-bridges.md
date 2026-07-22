# Native Bridges

## Purpose

Native bridges expose platform capabilities to the shared runtime without duplicating product semantics.

This module is about native capability. Tablet adaptation is documented separately in [Layout surfaces](layout-surfaces.md); for example, iPad means iOS native bridge plus tablet layout, not a separate runtime.

## Owns

- Native SQLite plugin registration and execution.
- File picker, photo, backup, and rollback file capabilities.
- Native provider HTTP streaming and WebView shell integration.
- Chunked reads for large native JSON values that cannot safely cross the bridge in one payload.
- Local notifications and platform-specific capability availability.
- Authorized system-calendar discovery and event mutations through stable calendar identifiers.

## Does Not Own

- Chat or collection product meaning.
- LocalData row semantics.
- Provider policy beyond exposing transport capability.
- Release-channel status.
- Phone, tablet, or desktop layout selection.

## Main Entrypoints

- `ios/`
- `android/`
- `src/native/`
- `src/app/bootstrap/storeLocalDataBackendBootstrap.ts`
- `src/main.tsx`

## Data It Reads

- Platform capability state from Capacitor.
- Native SQLite database contents through the plugin boundary.
- Picked files and backup/rollback files selected by the user.
- Writable EventKit calendar identifiers, account sources, and the user-selected default calendar.

## Data It Writes

- Native SQLite rows through the LocalData backend.
- User-selected file handles or imported file payloads handed back to shared code.
- Notification scheduling state when native notifications are available.
- Calendar events written to the explicit `calendarId`, or to the iOS system default when no target
  is supplied.

## Important Failure States

- Native plugin is unavailable, so the startup host must keep the web/KV default.
- A native provider build is missing the provider HTTP plugin; provider calls fail explicitly instead of silently changing transport.
- A chunked JSON read reports a different length or checksum from the stored value.
- Native SQLite rejects a statement because the allowlist drifted.
- File import or rollback file handling fails.
- A platform check is mistaken for a release-channel claim.
- A tablet layout issue is patched as an iOS or Android bridge issue without proving it crosses a native capability boundary.

## Tests And Verification

- `src/native/localDataSqlite.test.ts`
- `src/native/localDataSqliteNativeParity.test.ts`
- `src/native/providerHttp.test.ts`
- `src/infrastructure/nativePersistenceBackend.test.ts`
- `src/app/bootstrap/storeLocalDataBackendBootstrap.test.ts`
- Native runtime proof documented in `docs/open-source/native-sqlite-runtime-proof.md`.

## Channel Verification

- Physical iPhone SQLite proof and visible health/census inspection belong to native-release
  verification, not the source publication gate.
