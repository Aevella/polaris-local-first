import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function source(filePath: string) {
  return readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function sourceFilesUnder(relativePath: string): string[] {
  const root = path.join(repoRoot, relativePath);
  const walk = (current: string): string[] => readdirSync(current).flatMap((entry) => {
    const fullPath = path.join(current, entry);
    if (statSync(fullPath).isDirectory()) return walk(fullPath);
    if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) return [];
    return [path.relative(repoRoot, fullPath)];
  });
  return walk(root).sort();
}

function sourceFilesContaining(pattern: RegExp) {
  return sourceFilesUnder('src').filter((filePath) => pattern.test(source(filePath)));
}

function sourceBetween(contents: string, start: string, end: string) {
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return contents.slice(startIndex, endIndex);
}

describe('startup fact source boundary', () => {
  it('keeps the startup source boundary aligned with current data docs', () => {
    const dataContract = source('docs/handbook/DATA_AND_STORAGE.md');
    const dataSourceDecisions = source('docs/open-source/data-source-decisions.md');

    for (const contents of [dataContract, dataSourceDecisions]) {
      expect(contents).toContain('LocalData');
      expect(contents).toContain('repository');
      expect(contents).toContain('startup');
      expect(contents).toMatch(/old|older|legacy/i);
    }

    expect(dataContract).toContain('Normal startup must not');
    expect(dataContract).toContain('Object-Row Ownership');
    expect(dataSourceDecisions).toContain('Domain Decisions');
  });

  it('keeps the object-row ownership map complete enough for row-first work', () => {
    const ownership = source('docs/handbook/DATA_AND_STORAGE.md');

    for (const domain of ['chat', 'collection', 'document', 'persona', 'runtime', 'space', 'asset']) {
      expect(ownership).toContain(`\`${domain}\``);
    }

    for (const rowShape of ['append', 'keyed upsert', 'pointer', 'Derived evidence']) {
      expect(ownership).toContain(rowShape);
    }

    for (const fact of [
      'Chat message body',
      'project files',
      'Persona memory document body',
      'Collaborator profile',
      'saved skins',
      'Provider profile',
      'Asset owner references'
    ]) {
      expect(ownership).toContain(fact);
    }

    expect(ownership).toContain('Whole-domain snapshot traversal is reserved');
    expect(ownership).toContain('Object-Row Ownership');
  });

  it('routes ordinary store saves through object-row writers, not whole-domain snapshot writers', () => {
    // Every domain's ordinary persist path goes through its value-diff row writer.
    expect(source('src/stores/chat/index.ts')).toContain('commitChatConversationRowChangesIfActive');
    expect(source('src/stores/collection/index.ts')).toContain('commitCollectionRowChangesFromStateActivating');
    expect(source('src/stores/persona/localData.ts')).toContain('commitPersonaRowChangesFromStateIfActive');
    expect(source('src/stores/space/index.ts')).toContain('commitSpaceRowChangesFromStateActivating');
    expect(source('src/stores/runtime/index.ts')).toContain('commitRuntimeRowChangesFromStateActivating');

    // The per-domain whole-state snapshot repository writers were retired entirely.
    for (const retired of [
      'writeCollectionStateToLocalDataRepositoryIfActive',
      'writePersonaStateToLocalDataRepositoryIfActive',
      'writeRuntimePayloadToLocalDataRepositoryIfActive',
      'writeSpaceStateToLocalDataRepositoryIfActive'
    ]) {
      expect(sourceFilesContaining(new RegExp(retired)), retired).toEqual([]);
    }

    // The chat snapshot writer survives only in the chat LocalData persistence modules, as
    // the inactive fallback path — never in another domain's ordinary write path.
    expect(sourceFilesContaining(/writeChatStateToLocalDataRepositoryIfActive/)).toEqual([
      'src/stores/chat/index.ts',
      'src/stores/chat/localData.ts',
      'src/stores/chat/snapshotWrite.ts'
    ]);
  });

  it('keeps the snapshot prune helper out of ordinary product write paths', () => {
    // pruneLocalDataUnitOfWorkToChangedRows is a maintenance helper only: after the row-first
    // routing, no ordinary store persist path prunes a whole-domain snapshot. The only caller
    // is the explicit backup-import replacement boundary, where absent rows become tombstones.
    expect(sourceFilesContaining(/pruneLocalDataUnitOfWorkToChangedRows/)).toEqual([
      'src/stores/localDataStorePersistence.ts',
      'src/stores/storeImportLocalDataRestore.ts'
    ]);
  });

  it('keeps collection owner derivation out of the persistence read path', () => {
    // The collection persistence read / hydrate layer returns stored owner facts verbatim; it
    // never derives an owner from origin conversations during a repository read. Owner
    // resolution from conversations is a presentation concern (resolveOwnerCollaboratorId in the
    // scope filters) plus one explicit `backfillOwnership` store action driven by the app-shell
    // effect — never a substitution baked in while reading durable rows.
    for (const persistenceModule of [
      'src/stores/collection/localData.ts',
      'src/stores/collection/index.ts'
    ]) {
      const contents = source(persistenceModule);
      expect(contents, persistenceModule).not.toContain('backfillOwnership');
      expect(contents, persistenceModule).not.toContain('resolveFallbackCollaboratorId');
    }

    // The eager owner backfill (a derived projection that can persist back) is confined to the
    // store action and the app-shell effect that drives it — it is not a persistence-layer fact.
    expect(sourceFilesContaining(/backfillOwnershipFromConversations/)).toEqual([
      'src/app/shell/useAppShellStoreBindings.ts',
      'src/stores/collectionStore.ts',
      'src/ui/app-shell/useAppRuntime.ts',
      'src/ui/app-shell/useAppShellController.ts',
      'src/ui/app-shell/useCollectionOwnershipBackfill.ts'
    ]);
  });

  it('keeps collection legacy recovery out of the normal store projection', () => {
    const collectionStore = source('src/stores/collectionStore.ts');

    expect(collectionStore).not.toContain("from './collectionLegacyRecoveryPersistence'");
    expect(collectionStore).not.toContain('legacyCollectionLifecycleById');
    expect(collectionStore).not.toContain('recoverArchivedCollectionObject');
    // The collection legacy recovery stratum was deleted; its symbol may not reappear anywhere.
    expect(sourceFilesContaining(/recoverArchivedCollectionObject/)).toEqual([]);
  });

  it('keeps the persona active pointer faithful in the repository read', () => {
    // The persona repository read returns the stored active-collaborator pointer verbatim — it
    // does not guess "the first persona" when the pointer is dangling. The single resolution is
    // in personaStore.hydrateFromDb, against the post-migration (visible) persona list.
    const personaPersistence = source('src/stores/persona/localData.ts');
    const readSlice = sourceBetween(
      personaPersistence,
      'export async function readPersonaStateFromLocalDataRepositoryIfActive',
      'export async function writePersonaState'
    );
    expect(readSlice).not.toContain('resolveActiveCollaboratorId');
    expect(readSlice).toContain('activeCollaboratorId: preview.state.activeCollaboratorId');
    expect(source('src/stores/personaStore.ts')).toContain('resolveActiveCollaboratorId');
  });

  it('keeps persona legacy recovery out of the normal store projection', () => {
    const personaStore = source('src/stores/personaStore.ts');

    expect(personaStore).not.toContain("from './personaLegacyRecoveryPersistence'");
    expect(personaStore).not.toContain('legacyPersonaLifecycleById');
    expect(personaStore).not.toContain('recoverArchivedCollaborator');
    // The persona legacy recovery stratum was deleted; its symbol may not reappear anywhere.
    expect(sourceFilesContaining(/recoverArchivedPersonaCollaborator/)).toEqual([]);
  });

  it('keeps normal store hydration on current keys only', () => {
    const collection = source('src/stores/collection/index.ts');
    const persona = source('src/stores/personaStore.ts');
    const runtime = source('src/stores/runtime/index.ts');
    const spaceTheme = source('src/stores/space/index.ts');

    expect(collection).not.toContain('collection-state-v2');
    expect(collection).not.toContain('collection-state-v1');

    expect(persona).toContain('persona-state-v2');
    expect(persona).not.toContain('persona-state-v1');

    expect(runtime).toContain('runtime-providers-v2');
    expect(runtime).not.toContain('runtime-api-v1');

    expect(spaceTheme).toContain('space-theme-state-v1');
    expect(spaceTheme).not.toContain('readLegacyLocalStorageSpaceThemePayload');
    expect(spaceTheme).not.toContain('createIndexedDbPersistenceBackendForRecovery');
  });

  it('keeps runtime legacy recovery out of the normal store projection', () => {
    const runtimeStore = source('src/stores/runtimeStore.ts');

    expect(runtimeStore).not.toContain("from './runtimeLegacyRecoveryPersistence'");
    expect(runtimeStore).not.toContain('legacyRuntimeLifecycleById');
    expect(runtimeStore).not.toContain('recoverArchivedRuntimeObject');
    // The runtime legacy recovery stratum was deleted; its symbol may not reappear anywhere.
    expect(sourceFilesContaining(/recoverArchivedRuntimeObject/)).toEqual([]);
  });

  it('keeps the space store off the zustand localStorage mirror (LocalData-only ordinary persistence)', () => {
    // The space store persists/hydrates ONLY through LocalData (writePersistedSpaceThemeState /
    // readPersistedSpaceThemeState). It must not use the zustand `persist` middleware, so it never
    // writes or rehydrates the legacy `polaris-space-store-v1` localStorage mirror at runtime.
    const spaceStore = source('src/stores/spaceStore.ts');
    expect(spaceStore).not.toMatch(/\bpersist\s*\(/);
    expect(spaceStore).not.toContain('createJSONStorage');
    expect(spaceStore).not.toContain("from 'zustand/middleware'");

    // `polaris-space-store-v1` survives only at the explicit import / export / migration /
    // recovery / census / health boundaries — never in an ordinary store/persistence module.
    expect(sourceFilesContaining(/polaris-space-store-v1|SPACE_STORE_KEY|SPACE_LOCAL_STATE_KEY/).filter(
      (filePath) => filePath !== 'src/stores/spaceStore.ts' // doc comment only, not code
    )).toEqual([
      'src/engines/localData/localDataCensus.ts',
      'src/engines/localData/localDataCensusReport.ts',
      'src/engines/localData/localDataExportRehearsal.ts',
      'src/infrastructure/localDataHealth/buckets.ts',
      'src/stores/kelivoImportAdapter.ts',
      'src/stores/space/migrationPlanner.ts',
      'src/stores/storeExportPackage.ts',
      'src/stores/storeImportApply.ts',
      'src/stores/storeImportPackage.ts'
    ]);
  });

  it('keeps space legacy recovery out of the normal store projection', () => {
    const spaceTypes = source('src/stores/spaceStoreTypes.ts');
    const spaceThemeSlice = source('src/stores/spaceStoreThemeSessionSlice.ts');
    const spaceThemeState = source('src/stores/spaceStoreThemeState.ts');
    const spacePersistence = source('src/stores/space/index.ts');
    const startupHydration = source('src/app/bootstrap/persistentStoreHydration.ts');

    for (const [label, contents] of [
      ['spaceStoreTypes', spaceTypes],
      ['spaceStoreThemeSessionSlice', spaceThemeSlice],
      ['spaceStoreThemeState', spaceThemeState],
      ['spaceStorePersistence', spacePersistence],
      ['persistentStoreHydration', startupHydration]
    ] as const) {
      expect(contents, label).not.toContain('legacySpaceLifecycleById');
      expect(contents, label).not.toContain('recoverArchivedSpaceObject');
    }
    // The space legacy recovery stratum was deleted; its symbol may not reappear anywhere.
    expect(sourceFilesContaining(/recoverArchivedSpaceObject/)).toEqual([]);
  });

  it('keeps chat-state-v1 out of normal chat startup reads', () => {
    const chat = source('src/stores/chat/index.ts');

    expect(chat).not.toContain("operation: 'read-legacy'");
    expect(chat).not.toMatch(/kvGet<[\s\S]*?>\(LEGACY_CHAT_STATE_KEY\)/);
    expect(chat).not.toMatch(/kvGet<[\s\S]*?>\('chat-state-v1'\)/);
  });

  it('keeps legacy chat state constants out of current startup readers', () => {
    const chatCurrentPersistence = source('src/stores/chat/index.ts');
    const chatStore = source('src/stores/chatStore.ts');

    expect(chatCurrentPersistence).not.toMatch(/chat-state-v1|chat-index-v2|chat-messages-v2|chat-manifest-v1|chat-message-v1|chat-conversation-v1/);
    expect(chatStore).toContain("from './chatCurrentPersistence'");
    expect(chatStore).not.toContain("from './chatLegacyRecoveryPersistence'");
  });

  it('keeps legacy chat committed-index readers out of current startup and lazy body reads', () => {
    const chatStore = source('src/stores/chatStore.ts');
    const chatCurrentPersistence = source('src/stores/chat/index.ts');
    const lazyBodyReader = sourceBetween(
      chatCurrentPersistence,
      'export async function readConversationMessages',
      'export async function clearPersistedConversationAttachmentsByAssetIds'
    );

    expect(chatStore).not.toContain('includeRecoverySources');
    for (const reader of [lazyBodyReader, chatCurrentPersistence]) {
      expect(reader).not.toContain('CHAT_COMMIT_POINTER_KEY');
      expect(reader).not.toContain('CHAT_MANIFEST_PREFIX');
      expect(reader).not.toContain('CHAT_COMMIT_MESSAGE_PREFIX');
      expect(reader).not.toContain('CHAT_CONVERSATION_ENVELOPE_PREFIX');
      expect(reader).not.toContain('CHAT_INDEX_KEY');
      expect(reader).not.toContain('CHAT_INDEX_PENDING_KEY');
      expect(reader).not.toContain('readLegacyFallbackMessages');
      expect(reader).not.toContain('readCommittedChatManifest');
      expect(reader).not.toContain('readLatestConversationEnvelopes');
      expect(reader).not.toContain('recoverOrphanedConversationRecords');
    }
  });

  it('keeps legacy catalog sealing out of ordinary startup hydration', () => {
    const startupFiles = [
      'src/app/bootstrap/persistentStoreHydration.ts',
      'src/stores/chatStore.ts',
      'src/stores/collectionStore.ts',
      'src/stores/personaStore.ts',
      'src/stores/runtime/index.ts'
    ];

    for (const filePath of startupFiles) {
      const contents = source(filePath);
      expect(contents, filePath).not.toMatch(/sealLegacy[A-Za-z]+CatalogIntoLocalDataDirectoryIfNeeded/);
      expect(contents, filePath).not.toMatch(/operation: 'seal-legacy-catalog'/);
    }
  });

  it('keeps the legacy chat archive merge out of ordinary chat hydration', () => {
    const chatStore = source('src/stores/chatStore.ts');

    // Ordinary hydrate reads the current layer; it must not read the old chat-catalog-v1
    // archive shells or merge them into the product list.
    expect(chatStore).not.toContain('readChatArchiveState');
    expect(chatStore).not.toContain('mergeLiveAndArchiveChatPayloads');
    expect(chatStore).not.toContain('recoverArchivedChatConversation');
  });

  it('keeps the legacy chat catalog reader and recovery transaction fully retired', () => {
    // The old catalog-only directory reader and the archive recovery transaction were deleted
    // with the chat legacy stratum. Polaris does not restore the old chat line, so neither
    // symbol may reappear in any module.
    expect(sourceFilesContaining(/readLegacyChatCatalogDirectory/)).toEqual([]);
    expect(sourceFilesContaining(/recoverArchivedChatConversation/)).toEqual([]);
  });

  it('confines the legacy chat catalog writer to import / export-rehearsal / recovery', () => {
    // serializeChatStateEntries is the only writer of the legacy `chat-catalog-v1` /
    // `chat-conversation-record-v1:*` format. Polaris is not an in-place compatibility
    // runtime: that writer may live only at explicit import / export-rehearsal / recovery
    // boundaries (plus its own definition module), never in an ordinary store/save path.
    expect(sourceFilesContaining(/serializeChatStateEntries/)).toEqual([
      'src/engines/localData/localDataExportRehearsal.ts',
      'src/stores/chat/index.ts',
      'src/stores/kelivoImportAdapter.ts'
    ]);
    // The ordinary chat save router writes new-layer rows; it never reaches the legacy
    // catalog serializer. (persistChatStateChange routes through the row writer / the
    // new-layer overlay writer, both keyed LocalData rows — see
    // chatOrdinarySaveLegacyCatalogBoundary.test.ts for the behavioral proof.)
    const chatCurrentPersistence = source('src/stores/chat/index.ts');
    const persistRouter = sourceBetween(
      chatCurrentPersistence,
      'export async function persistChatStateChange',
      'async function tryPersistChatStateChangeThroughRowWriters'
    );
    expect(persistRouter).not.toContain('serializeChatStateEntries');
    expect(persistRouter).not.toContain('chat-catalog-v1');
  });

  it('keeps the old chat catalog out of ordinary recall, attachment, and export paths', () => {
    const chatCurrentPersistence = source('src/stores/chat/index.ts');
    const exportPackage = source('src/stores/storeExportPackage.ts');

    // Lazy body recall reads the active LocalData body only — no chat-catalog-v1 /
    // chat-conversation-record-v1 fallback.
    const recall = sourceBetween(
      chatCurrentPersistence,
      'export async function readConversationMessages',
      'export async function clearPersistedConversationAttachmentsByAssetIds'
    );
    expect(recall).not.toContain('chat-catalog-v1');
    expect(recall).not.toContain('readSelfContained');
    expect(recall).not.toContain('CHAT_CATALOG_KEY');

    // Attachment cleanup reads the new layer (readCompleteLiveChatState), not the old overlay.
    const attachmentCleanup = sourceBetween(
      chatCurrentPersistence,
      'export async function clearPersistedConversationAttachmentsByAssetIds',
      'export async function writeChatState'
    );
    expect(attachmentCleanup).toContain('readCompleteLiveChatState');
    expect(attachmentCleanup).not.toContain('readCompleteChatState');

    // The old-overlay readers are gone from the current chat module entirely.
    for (const removed of [
      'function readChatState(',
      'function readCompleteChatState(',
      'function readChatArchiveState(',
      'function readCurrentChatStateWithOptions(',
      'function readSelfContainedChatCatalog(',
      'function hydrateSelfContainedChatPayload('
    ]) {
      expect(chatCurrentPersistence, removed).not.toContain(removed);
    }

    // Export reads the live local-data layer completely; it no longer routes through any legacy
    // recovery reader or the current module's old-overlay reader.
    expect(exportPackage).not.toContain('readCompleteChatState');
    expect(exportPackage).not.toContain('readLegacyChatRecoveryState');
    expect(exportPackage).toContain('readCompleteLiveChatState');
  });

  it('keeps the old mixed chat persistence module out of production imports', () => {
    expect(sourceFilesContaining(/chatStorePersistence/)).toEqual([]);
    expect(sourceFilesContaining(/chatLegacyRecoveryPersistence/)).toEqual([]);
  });

  it('keeps diagnostics from mutating old chat localStorage mirrors', () => {
    const clientErrorLog = source('src/infrastructure/clientErrorLog.ts');

    expect(clientErrorLog).not.toContain('localStorageMaintenance');
    expect(clientErrorLog).not.toContain('polaris-chat-index-v2-mirror');
    expect(clientErrorLog).not.toContain('polaris-chat-messages-v2-mirror');
  });

  it('keeps whole-KV scans behind explicit maintenance/export boundaries', () => {
    expect(sourceFilesContaining(/\bkvEntries\(/)).toEqual([
      'src/infrastructure/localDataHealth/source.ts',
      'src/infrastructure/persistence.ts',
      'src/stores/document/migrationPlanner.ts'
    ]);
  });

  it('routes ordinary store LocalData access through the backend host, never a direct KV backend', () => {
    // Ordinary store/domain persistence must obtain its LocalData backend from the store host
    // (createStoreLocalDataRepository / getStoreLocalDataBackend), never by constructing a KV
    // backend itself. createLocalDataKvBackend is therefore confined to its own engine module
    // and the host that owns the default fallback.
    expect(sourceFilesContaining(/createLocalDataKvBackend\b/)).toEqual([
      'src/engines/localData/localDataKvBackend.ts',
      'src/stores/storeLocalDataBackendHost.ts'
    ]);

    // The staged migration backend is a separate, explicit migration/staging entry point. It
    // stays whitelisted to the migration persistence files (plus its own definition module) and
    // never leaks into an ordinary store/save path.
    expect(sourceFilesContaining(/createStagedLocalDataKvBackendForMigration/)).toEqual([
      'src/engines/localData/localDataKvBackend.ts',
      'src/stores/asset/migrationPlanner.ts',
      'src/stores/chat/migrationPlanner.ts',
      'src/stores/collection/migrationPlanner.ts',
      'src/stores/document/migrationPlanner.ts',
      'src/stores/localDataSourcePromotionPersistence.ts',
      'src/stores/persona/migrationPlanner.ts',
      'src/stores/runtime/migrationPlanner.ts',
      'src/stores/space/migrationPlanner.ts'
    ]);
  });

  it('keeps the SQLite LocalData backend out of the store layer (only the startup root installs it)', () => {
    // SQLite is now installed at startup, but ONLY from the app composition root. No store-layer
    // module (nor the asset store) may import or construct a SQLite / native-SQLite LocalData
    // backend; storage choice stays a single decision the host owns.
    expect(
      sourceFilesContaining(
        /createLocalDataSqliteBackend|createNativeLocalDataSqliteBackend/
      ).filter((filePath) =>
        filePath.startsWith('src/stores/') || filePath === 'src/infrastructure/assetStore.ts'
      )
    ).toEqual([]);
  });

  it('confines the LocalData SQLite backend construction and the runtime backend install to the startup root', () => {
    // The native LocalData SQLite backend is built only by its native wrapper and the single
    // startup composition root; the engine constructor stays in its own module + that wrapper.
    expect(sourceFilesContaining(/\bcreateLocalDataSqliteBackend\b/)).toEqual([
      'src/engines/localData/localDataSqliteBackend.ts',
      'src/native/localDataSqlite.ts'
    ]);
    expect(sourceFilesContaining(/\bcreateNativeLocalDataSqliteBackend\b/)).toEqual([
      'src/app/bootstrap/storeLocalDataBackendBootstrap.ts',
      'src/native/localDataSqlite.ts'
    ]);

    // installStoreLocalDataBackend is the host's own writer; the ONLY product runtime caller is the
    // startup composition root, so there is exactly one place that swaps the active backend.
    expect(sourceFilesContaining(/\binstallStoreLocalDataBackend\b/)).toEqual([
      'src/app/bootstrap/storeLocalDataBackendBootstrap.ts',
      'src/stores/storeLocalDataBackendHost.ts'
    ]);
  });

  it('keeps legacy LocalData KV shadow cleanup out of the current store backend', () => {
    // Raw KV LocalData namespace deletion is a post-import cleanup for installations whose
    // current LocalData facts live in a dedicated backend such as native SQLite. It must not
    // become another read/write path for current repository facts.
    expect(sourceFilesContaining(/clearLegacyLocalDataKvShadowIfStoreBackendInstalled/)).toEqual([
      'src/stores/localDataLegacyKvShadowCleanup.ts',
      'src/stores/storeImportPackage.ts'
    ]);
  });

  it('keeps LocalData row discovery off raw KV scans (no kvKeysWithPrefix on a row prefix)', () => {
    // Any module that builds a `${LOCAL_DATA_NAMESPACE}:row:` prefix is doing LocalData row
    // discovery over CURRENT repository facts. It must go through the store backend host
    // (listStoreLocalDataKeysWithPrefix / backend.listKeysWithPrefix), never a raw kvKeysWithPrefix
    // scan — otherwise SQLite-default forks the fact source (rows in SQLite, scan over empty KV).
    const rowPrefixFiles = sourceFilesContaining(/LOCAL_DATA_NAMESPACE\}:row:/);
    expect(rowPrefixFiles.length).toBeGreaterThan(0);
    for (const filePath of rowPrefixFiles) {
      expect(source(filePath), filePath).not.toMatch(/\bkvKeysWithPrefix\b/);
    }
  });

  it('keeps the ordinary LocalData current-fact store modules off raw KV read APIs', () => {
    // These modules read CURRENT LocalData repository facts (the active-data-source pointer,
    // domain meta rows, object-row directories). They must reach them ONLY through the store
    // backend host (readStoreLocalDataValue / listStoreLocalDataKeysWithPrefix /
    // createStoreLocalDataRepository), never a raw kvGet/kvKeysWithPrefix that bypasses whichever
    // backend is installed. Legacy/migration/recovery reads of OLD keys live in their own modules.
    const localDataCurrentFactModules = [
      'src/stores/localDataStorePersistence.ts',
      'src/stores/chat/localData.ts',
      'src/infrastructure/assetStore.ts'
    ];
    for (const filePath of localDataCurrentFactModules) {
      const contents = source(filePath);
      expect(contents, filePath).not.toMatch(/\bkvGet\b/);
      expect(contents, filePath).not.toMatch(/\bkvKeysWithPrefix\b/);
    }
  });

  it('keeps startup entrypoints from promoting or migrating LocalData', () => {
    const startupFiles = sourceFilesUnder('src/app/bootstrap');
    const startupSources = startupFiles.map((filePath) => ({
      filePath,
      contents: source(filePath)
    }));

    for (const { filePath, contents } of startupSources) {
      expect(contents, filePath).not.toContain('promoteLocalDataLiveSourceDomains');
      expect(contents, filePath).not.toContain('commitLocalDataLiveSourceStagingMigrationsFromCurrentPersistence');
      expect(contents, filePath).not.toContain('commitAndPromoteLocalDataLiveSourceDomainsFromCurrentPersistence');
      expect(contents, filePath).not.toContain('localDataAutoUpgrade');
      expect(contents, filePath).not.toContain('auto-upgrade');
    }
  });

  it('keeps app entrypoints from query-param LocalData promotion', () => {
    const entrypointFiles = [
      'src/main.tsx',
      'src/ui/AppShell.tsx',
      'src/ui/app-shell/useAppShellController.ts'
    ];

    for (const filePath of entrypointFiles) {
      const contents = source(filePath);
      expect(contents, filePath).not.toContain('promoteLocalDataLiveSourceDomains');
      expect(contents, filePath).not.toMatch(/URLSearchParams[\s\S]{0,400}promote/i);
      expect(contents, filePath).not.toMatch(/location\.search[\s\S]{0,400}promote/i);
    }
  });

  it('mounts the persistent store lifecycle from a single app runtime owner', () => {
    expect(sourceFilesContaining(/usePersistentStoreLifecycle/)).toEqual([
      'src/app/bootstrap/usePersistentStoreLifecycle.ts',
      'src/ui/app-shell/useAppRuntime.ts'
    ]);
    expect(sourceFilesContaining(/useAppStateLifecycle/)).toEqual([]);
  });

  it('keeps global runtime hooks behind the app runtime root', () => {
    const appShell = source('src/ui/AppShell.tsx');
    const appRuntime = source('src/ui/app-shell/useAppRuntime.ts');
    expect(appShell).toContain('useAppRuntime');
    for (const hookName of [
      'useDeveloperModeRuntime',
      'usePersistentStoreLifecycle',
      'useIosKeyboardAccessoryBar',
      'useViewportShellVars',
      'useCompanionRuntime',
      'useMcpCatalogHeartbeat',
      'useDesktopWorkspaceAutoSync',
      'useAndroidApkUpdateRuntime',
      'useAutomaticConversationSummaryMemory',
      'useAppTriggerRuntime'
    ]) {
      expect(appShell, hookName).not.toContain(hookName);
      expect(appRuntime, hookName).toContain(hookName);
    }
  });

  it('gates background app runtime work behind the startup lifecycle readiness', () => {
    const appRuntime = source('src/ui/app-shell/useAppRuntime.ts');
    const automaticSummary = source('src/app/chat/useAutomaticConversationSummaryMemory.ts');

    expect(appRuntime).toContain('const backgroundRuntimeReady = (');
    expect(appRuntime).toContain('persistentStoreLifecycle.startupThemeReady');
    expect(appRuntime).toContain('persistentStoreLifecycle.startupStoresReady');

    for (const call of [
      'useCompanionRuntime({ enabled: backgroundRuntimeReady })',
      'useMcpCatalogHeartbeat({ enabled: backgroundRuntimeReady })',
      'useAndroidApkUpdateRuntime({ enabled: backgroundRuntimeReady })',
      'useAutomaticConversationSummaryMemory({ startupReady: backgroundRuntimeReady })',
      'useCollectionOwnershipBackfill({',
      'startupReady: backgroundRuntimeReady',
      'useAppTriggerRuntime({ chatRuntime, startupReady: backgroundRuntimeReady })'
    ]) {
      expect(appRuntime).toContain(call);
    }

    expect(automaticSummary).toContain('startupReady: boolean');
    expect(automaticSummary).toContain('state.startupReady');
    expect(source('src/ui/app-shell/useCollectionOwnershipBackfill.ts')).toContain('if (!startupReady');
  });

  it('keeps the app runtime trigger port separate from ChatWorld render props', () => {
    const appShell = source('src/ui/AppShell.tsx');
    const appRuntime = source('src/ui/app-shell/useAppRuntime.ts');
    const appShellController = source('src/ui/app-shell/useAppShellController.ts');

    expect(appShell).toContain('chatRuntime: controller.chatRuntimePort');
    expect(appShell).not.toContain('chatWorldProps.ui');
    expect(appRuntime).toContain('AppTriggerChatRuntimePort');
    expect(appRuntime).not.toContain('ChatUiState');
    expect(appShellController).toContain('chatRuntimePort');
    expect(appShellController).toContain('chatWorldProps');
  });

  it('keeps AppShellView as a render-only component', () => {
    const appShellView = source('src/ui/app-shell/AppShellView.tsx');
    const viewController = source('src/ui/app-shell/useAppShellViewController.ts');

    for (const hookName of ['useState', 'useEffect', 'useMemo', 'useRef']) {
      expect(appShellView, hookName).not.toContain(hookName);
      expect(viewController, hookName).toContain(hookName);
    }

    for (const sideEffectOwner of [
      'useAppearanceDomEffects',
      'useCustomFontDomEffects',
      'annotateCurrentWorldSwitchThemePhase',
      'recordWorldSwitchStage',
      'blurChatWorldFocus',
      'polarisCustomBackgroundOverride',
      'polarisDesktopSidebar'
    ]) {
      expect(appShellView, sideEffectOwner).not.toContain(sideEffectOwner);
      expect(viewController, sideEffectOwner).toContain(sideEffectOwner);
    }
  });

  it('keeps auxiliary document body payload scans out of migration and startup paths', () => {
    const startup = source('src/app/bootstrap/persistentStoreHydration.ts');
    const personaMigration = source('src/stores/persona/migrationPlanner.ts');
    const collectionMigration = source('src/stores/collection/migrationPlanner.ts');
    const assetMigration = source('src/stores/asset/migrationPlanner.ts');

    for (const contents of [startup, personaMigration, collectionMigration, assetMigration]) {
      expect(contents).not.toContain('readPersonaMemoryDocContentPayload');
      expect(contents).not.toContain('readWorkspaceReferenceDocContentPayload');
    }
  });
});
