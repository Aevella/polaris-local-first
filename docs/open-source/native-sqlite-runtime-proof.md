# Native SQLite Runtime Proof And Storage Fallback Decision

This document records where the LocalData fact source physically lives per platform, what is
automatically proven about the native SQLite path, and what has been verified on native runtimes. It
keeps the current backend choice explicit for each platform.

It does not claim a physical device run that was not performed. Where device evidence is owed, it
says so.

## Per-Platform Current Fact Source

| Platform | Current LocalData source | How it is chosen |
| --- | --- | --- |
| iOS / Android (native shell) | **SQLite**, behind the LocalData backend host | `installRuntimeStoreLocalDataBackend()` installs `createNativeLocalDataSqliteBackend()` at the startup composition root when `canUseNativeLocalDataSqlite()` reports a native platform with the `LocalDataSqlite` plugin registered. |
| Web / self-host (browser) | **KV (IndexedDB)** | Nothing is installed, so `storeLocalDataBackendHost` keeps its KV default. KV is the single current source here, never a second source running alongside SQLite. |
| Automated tests | memory / KV / Node SQLite (see below) | Each test installs the backend it needs, or relies on the KV default. |

There is never more than one current source on a given platform. SQLite and KV are alternatives
selected once at startup, not concurrent current-data sources.

## Web / Self-Host Decision

Web and self-host **intentionally remain KV (IndexedDB) backed for now.** A browser SQLite/WASM
backend is a deliberately deferred, separate decision; it is not part of this slice. Until that
decision is made and proven, the browser path stays on the KV default and is treated as a real
supported substrate. The store layer reads/writes only through the backend host, so
moving the browser to SQLite later is a host-install change, not a store-layer rewrite.

## Native Startup Timing

The native SQLite path is available early enough to be the source from first save:

- The `LocalDataSqlite` plugin is registered during native bridge init — iOS in
  `AppDelegate` (`registerPluginInstance(LocalDataSqlitePlugin())`), Android in
  `MainActivity.onCreate` (`registerPlugin(LocalDataSqlitePlugin.class)`) — before the web app
  loads.
- `src/main.tsx` calls `installRuntimeStoreLocalDataBackend()` before React renders, so the backend
  is chosen before any store hydrates or persists. Bootstrap then reconciles metadata-only pointer
  drift from older clean builds before pending asset-stage recovery, and only then mounts React.
- The native plugin opens/creates `local-data.sqlite3` lazily on first `execute`/`query`, and the
  backend runs `CREATE TABLE IF NOT EXISTS` before its first read/commit. A fresh install therefore
  creates the table on first ordinary save with no migration step.

## Roles Of Each Backend In Tests

- **Memory backend** (`createLocalDataMemoryBackend`): fast unit/contract fixture; also the inactive
  backend installed by store tests that previously leaned on a partial KV mock.
- **KV backend** (`createLocalDataKvBackend`): the host default and the web/self-host substrate;
  exercised by the repository contract suite and the store persistence tests.
- **Node SQLite driver** (`node:sqlite` via `createLocalDataSqliteBackend`): proves the real SQLite
  engine semantics in CI without a device — used by the backend contract suite and by the startup
  bootstrap proof that a fresh ordinary save lands in SQLite and reloads from the same backend.
- **Native parity proof** (`src/native/localDataSqliteNativeParity.test.ts`): reads the real iOS and
  Android plugin sources and asserts every statement the JS SQLite backend can issue exists in both
  native allowlists, so the native plugins cannot fall behind the JS contract.

## Old Data Is Never Migrated At Startup

Installing SQLite only chooses where ordinary reads/writes land. It performs no promote, migrate, or
catalog conversion. Existing package data becomes current SQLite-backed rows ONLY through the
explicit import, migration, validation, and restore boundaries. Ordinary startup reads the current
repository path and self-activates a domain from its own first committed rows.

Older public clean builds could leave an already-active pointer at commit A after a later ordinary
save committed rows and pointer B. Before hydration, startup may strictly validate those current B
rows and advance that existing active pointer through the repository's trusted promotion path. This
is a metadata reconciliation inside the installed backend: it copies no rows or bodies, reads no old
store, and cannot activate a domain absent from the prior active row. Failed validation leaves A and
all rows unchanged and reports degraded integrity. The `startupFactSourceBoundary` tests continue to
lock out old-store migration, catalog conversion, and query-triggered promotion.

## What Is Automatically Proven

- The startup install routes the backend host to SQLite when native SQLite is available, and to the
  KV default otherwise (`storeLocalDataBackendBootstrap.test.ts`).
- A fresh ordinary save writes into the installed SQLite backend and a reload reads it back through
  the same backend, with a throwing KV substrate proving no KV fork
  (`storeLocalDataBackendBootstrap.test.ts`).
- Installing SQLite performs no promote/activate; a fresh SQLite store reports every domain inactive
  until self-activation (`storeLocalDataBackendBootstrap.test.ts`).
- Public-clean A→B active-pointer drift is repaired only after strict current-row validation, with
  parity coverage on the default transactional KV backend and Node SQLite; never-active and
  incomplete domains remain untouched (`localDataActivePointerReconciliation.test.ts`).
- Repository read/validate/commit semantics are identical on the KV and real Node SQLite engines
  (`localDataBackendContract.test.ts`).
- Both native plugins declare the full LocalData SQLite statement surface, including row discovery
  (`localDataSqliteNativeParity.test.ts`).

### Blockers Found And Fixed

While building the proof, the row-discovery statement
`SELECT key FROM local_data_entries WHERE substr(key, 1, ?) = ?` (the backend's
`listKeysWithPrefix`, used by every domain-ref / catalog / asset row scan) was **absent from both
native plugin allowlists**. Every JS/Node test passed because the native tests mock the plugin, so
the gap was invisible until the source-parity proof was added. On a real device the native plugin
would have rejected that query as disallowed, leaving SQLite installed but unusable for ordinary
reads. The statement was added to both native allowlists and is now guarded by the parity test.

The Android real-device proof also exposed an allowlist-normalization mismatch: JS sends multiline
SQL templates with spaces before closing punctuation, while Java/Swift source constants can format
the same statement without those spaces. The native allowlist now canonicalizes insignificant spaces
around SQL punctuation before comparison, and `localDataSqliteNativeParity.test.ts` locks that rule.

## Android Real-Device Runtime Proof - 2026-06-28

Status: **passed on an Android real device using the isolated debug package**.

The run used `com.alyssa.polaris.debug`, leaving the existing `com.alyssa.polaris` installation
untouched. The debug package was cleared before launch, so this was a fresh boot for that package.

Evidence recorded:

- The debug app launched successfully and remained the resumed foreground activity.
- The native plugin created `files/PolarisLocalDataSqlite/local-data.sqlite3` in the app sandbox.
- The SQLite file contained `local_data_entries`.
- `local_data_entries` contained 15 current LocalData rows after first boot:
  - 1 active pointer row
  - 4 space rows
  - 8 collection rows
  - 2 other LocalData rows
- Required current-fact keys were present:
  - `local-data-v1:active-data-source`
  - `local-data-v1:row:space:domainMeta:space`
  - `local-data-v1:row:collection:domainMeta:collection`
- After force-stop and relaunch, the same database still contained 15 rows and the active pointer
  read back `activeDataSource = repository`.
- A post-reload log scan found no `LocalDataSqliteException`, no `disallowedSql`, no
  `执行 LocalData SQLite 写入失败`, no `执行 LocalData SQLite 读取失败`, and no store/space persist failure.

This proves the Android native startup path can install SQLite, create the current LocalData table,
persist rows, and reload through the same on-device database.

## iOS Simulator Runtime Proof - 2026-06-28

Status: **passed on a fresh iOS simulator created for this proof**.

The run used a temporary iPhone 17 simulator on iOS 26.3. The simulator was created for the proof,
booted, used for one install/run/reload cycle, and deleted afterward.

Evidence recorded:

- `npm run ios:sync` completed before the native build.
- `xcodebuild` built the iOS Debug app for the proof simulator.
- The app launched successfully on the simulator.
- The native plugin created `Library/Application Support/PolarisLocalDataSqlite/local-data.sqlite3`
  in the app data container.
- The SQLite file contained `local_data_entries`.
- `local_data_entries` contained 15 current LocalData rows after first boot:
  - 1 active pointer row
  - 4 space rows
  - 8 collection rows
  - 2 other LocalData rows
- Required current-fact keys were present:
  - `local-data-v1:active-data-source`
  - `local-data-v1:row:space:domainMeta:space`
  - `local-data-v1:row:collection:domainMeta:collection`
- After terminate and relaunch, the same database still contained 15 rows and the active pointer
  read back `activeDataSource = repository`.
- A process log scan found no `LocalDataSqlite` rejection, no `disallowedSql`, no
  `执行 LocalData SQLite 写入失败`, no `执行 LocalData SQLite 读取失败`, and no store/space persist failure.

This proves the iOS native startup path can install SQLite, create the current LocalData table,
persist rows, and reload through the same simulator database.

## Native Release Checks

The native storage proof is complete for open-source source readiness: Android has a real-device
proof, and iOS has a fresh-simulator proof. The remaining checks are only needed before making a
new native release or TestFlight/App Store readiness claim:

1. Run the same iOS proof on a physical iPhone before making a TestFlight/App Store release claim.
2. Manually inspect the in-app storage health/census panel on native runtime and confirm it presents
   the same SQLite-backed row facts.
3. Keep confirming no startup migration/promotion runs when old-data fixtures are introduced.

Until those optional checks are recorded, treat native SQLite as source-complete, CI-proven,
Android-device verified, and iOS-simulator verified, but do not describe it as iPhone-device release
verified.
