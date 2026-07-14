# Native Bridges

Native bridges expose platform capabilities to the shared Polaris runtime. They should not copy
product behavior that belongs in shared `src/` code.

## Purpose

Provide real device or shell capabilities: SQLite, file selection, personal-data access helpers,
import rollback files, notifications, photo album integration, WebDAV backup support, and native
wrapper configuration.

## Boundaries

Native bridges own:

- Platform APIs and permission-facing adapters.
- Native SQLite capability exposure.
- System file and rollback file handling.
- Wrapper-specific build/config files under `ios/` and `android/`.

Native bridges do not own:

- Chat semantics.
- Collection/project logic.
- Theme decisions.
- LocalData row ownership beyond backend capability.

## Source Map

```txt
src/native/
ios/
android/
capacitor.config.ts
```

Important shared adapters:

```txt
src/native/localDataSqlite.ts
src/native/systemPickedFiles.ts
src/native/systemBackupFiles.ts
src/native/importRollbackFile.ts
src/native/localTriggerNotifications.ts
src/native/personalData.ts
```

The personal-data bridge exposes EventKit calendar facts without guessing account ownership.
`listCalendars` returns writable calendars with stable identifiers, source metadata, and the system
default flag. `createCalendarEvent` accepts an optional `calendarId`; when it is absent, the bridge
uses the default calendar selected in iOS settings.

## Data Flow

Native capability:

```txt
shared runtime request -> native adapter -> platform API -> structured result
```

Native SQLite:

```txt
LocalData backend host -> native SQLite adapter -> platform plugin -> LocalData contract result
```

## Public Usage

Use native adapters from app/store/engine code when the capability is truly platform-bound. Keep
the returned shape structured and product-neutral so shared code can decide product behavior.

## Extension Rules

- Add a native bridge only for a real platform capability.
- Keep secrets, signing material, provisioning, and local device logs out of the repository.
- Do not add platform branches to duplicate shared product behavior.
- Source readiness and channel readiness are separate: native source compiling does not mean APK or
  TestFlight has shipped.

## Verification

```bash
npm run typecheck
npm test -- src/native/localDataSqliteNativeParity.test.ts src/native/importRollbackFile.test.ts
npm test
npm run build
```

Before a channel claim, also run the appropriate Android or iOS sync/build command.
