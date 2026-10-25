import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, Conversation } from '../types/domain';
import {
  ASSET_BINARY_STORE,
  ASSET_META_STORE,
  ASSET_PREVIEW_STORE,
  KV_STORE,
  kvGet,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistenceBackend
} from '../infrastructure/persistence';
import type { StoredAssetMeta } from '../infrastructure/assetStore';
import {
  buildConversationLocalDataUnitOfWork,
  getConversationCatalogLocalDataRef,
  getConversationRecordLocalDataRef,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type CommitPointerRow,
  type ConversationRecordRow,
  type LocalDataCompleteRow
} from '../engines/localData';
import {
  buildChatMigrationDryRunReportFromCurrentPersistence,
  commitChatMigrationStagingFromCurrentPersistence
} from './chatMigrationDryRunPersistence';
import { serializeChatStateEntries } from './chatCurrentPersistence';

function createMemoryPersistenceBackend(args: {
  kv?: PersistedDbEntry[];
  assetMeta?: Array<[string, StoredAssetMeta]>;
} = {}): PersistenceBackend {
  const stores = new Map<string, Map<string, unknown>>([
    [KV_STORE, new Map((args.kv ?? []).map((entry) => [entry.key, entry.value]))],
    [ASSET_BINARY_STORE, new Map()],
    [ASSET_META_STORE, new Map(args.assetMeta ?? [])],
    [ASSET_PREVIEW_STORE, new Map()]
  ]);
  const getStore = (storeName: string) => {
    let store = stores.get(storeName);
    if (!store) {
      store = new Map();
      stores.set(storeName, store);
    }
    return store;
  };

  return {
    async dbStoreGet<T>(storeName: string, key: string) {
      return (getStore(storeName).get(key) as T | undefined) ?? null;
    },
    async dbStoreSet(storeName: string, key: string, value: unknown) {
      getStore(storeName).set(key, value);
    },
    async dbStoreDelete(storeName: string, key: string) {
      getStore(storeName).delete(key);
    },
    async dbStoreEntries<T>(storeName: string) {
      return Array.from(getStore(storeName).entries()).map(([key, value]) => ({
        key,
        value: value as T
      }));
    },
    async dbStoreClear(storeName: string) {
      getStore(storeName).clear();
    },
    async kvApplyMutations(mutations) {
      const kv = getStore(KV_STORE);
      for (const mutation of mutations) {
        if (mutation.type === 'set') {
          kv.set(mutation.key, mutation.value);
        } else {
          kv.delete(mutation.key);
        }
      }
    },
    async kvReplaceAll(entries) {
      stores.set(KV_STORE, new Map(entries.map((entry) => [entry.key, entry.value])));
    }
  };
}

function message(id: string, timestamp: number, content = id): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c-current',
    title: 'Current',
    collaboratorId: 'pharos',
    activeProjectId: null,
    messages: [message('m-current', 10, 'body polaris-asset://asset-current')],
    workspaceLedger: [],
    task: null,
    draft: '',
    pinnedAt: null,
    updatedAt: 20,
    ...overrides
  };
}

function assetMeta(id: string): StoredAssetMeta {
  return {
    id,
    kind: 'file',
    name: `${id}.txt`,
    mimeType: 'text/plain',
    size: 1,
    createdAt: 1
  };
}

function personaStateEntry(ids = ['pharos']) {
  return {
    key: 'persona-state-v2',
    value: {
      personas: ids.map((id) => ({
        id,
        name: id,
        description: '',
        compiledPrompt: '',
        version: 1
      })),
      activeCollaboratorId: ids[0] ?? null,
      seededDefaultPersonaIds: []
    }
  };
}

function localDataChatEntries(conversations: Conversation[], activeConversationId: string | null) {
  const unit = buildConversationLocalDataUnitOfWork({
    activeConversationId,
    conversations: conversations.map((entry) => ({
      conversation: entry,
      bodyState: 'complete',
      version: LOCAL_DATA_SCHEMA_VERSION,
      committedAt: 90
    })),
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 90,
    id: 'unpromoted-local-data-chat'
  });
  return unit.mutations.flatMap((mutation): PersistedDbEntry[] => {
    if (mutation.type !== 'put' && mutation.type !== 'restore') return [];
    return [{
      key: mutation.row.key,
      value: mutation.row
    }];
  });
}

describe('buildChatMigrationDryRunReportFromCurrentPersistence', () => {
  afterEach(() => {
    setPersistenceBackendForTesting(null);
  });

  it('reads current complete chat persistence into the reusable repository dry-run', async () => {
    const currentConversation = conversation();
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        ...serializeChatStateEntries({
          conversations: [currentConversation],
          activeConversationId: currentConversation.id
        }),
        personaStateEntry()
      ],
      assetMeta: [['asset-current', assetMeta('asset-current')]]
    }));

    const report = await buildChatMigrationDryRunReportFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual(expect.objectContaining({
      conversationCount: 1,
      messageCount: 1,
      activeConversationRecovered: true,
      totalMismatchCount: 0
    }));
    expect(report.projection).toEqual(expect.objectContaining({
      stagingHydrated: true,
      promotionReady: true,
      activeObjectCount: 1
    }));
    expect(report.assetRefs).toEqual(expect.objectContaining({
      referencedAssetCount: 1,
      projectedAssetRefCount: 1,
      assetIndexCount: 1,
      missingAssetRefCount: 0
    }));
  });

  it('preserves window settings from the selected record during explicit migration', async () => {
    const current = conversation({reasoningStrength: 'high', requestContext: {mode: 'recent', messageCount: 90},
      windowPreferences: {historicalImagePolicy: 'always', composerReturnKeyBehavior: 'newline', mcpScope: {mode: 'inherit'}}});
    const entries = serializeChatStateEntries({conversations: [current], activeConversationId: current.id});
    // The selected record is newer than the catalog's metadata.
    const catalog = entries.find(entry => entry.key === 'chat-catalog-v1')!;
    (catalog.value as {conversations: Array<{requestContext?: unknown}>}).conversations[0].requestContext = {mode: 'all'};
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({kv: [...entries, personaStateEntry()],
      assetMeta: [['asset-current', assetMeta('asset-current')]]}));
    const result = await commitChatMigrationStagingFromCurrentPersistence({version: 9, committedAt: 100, validatedAt: 110});
    expect(result.report.ok).toBe(true);
    const row = await kvGet<LocalDataCompleteRow<Record<string, unknown>>>(getLocalDataRowKey(getConversationCatalogLocalDataRef(current.id)));
    expect(row?.value).toMatchObject({reasoningStrength: 'high', requestContext: {mode: 'recent', messageCount: 90},
      windowPreferences: current.windowPreferences});
  });

  it('reads legacy chat-index message chunks through the same current-persistence preflight', async () => {
    const legacyConversation = conversation({
      id: 'c-legacy',
      messages: [message('m-legacy', 10, 'legacy body')]
    });
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        {
          key: 'chat-index-v2',
          value: {
            schemaVersion: 7,
            activeConversationId: legacyConversation.id,
            conversations: [{
              id: legacyConversation.id,
              title: legacyConversation.title,
              collaboratorId: legacyConversation.collaboratorId,
              activeProjectId: legacyConversation.activeProjectId,
              draft: legacyConversation.draft,
              workspaceLedger: legacyConversation.workspaceLedger,
              task: legacyConversation.task,
              pinnedAt: legacyConversation.pinnedAt,
              updatedAt: legacyConversation.updatedAt
            }],
            deletedConversationIds: []
          }
        },
        {
          key: `chat-messages-v2:${legacyConversation.id}`,
          value: legacyConversation.messages
        },
        personaStateEntry()
      ]
    }));

    const report = await buildChatMigrationDryRunReportFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual(expect.objectContaining({
      conversationCount: 1,
      messageCount: 1,
      activeConversationRecovered: true,
      totalMismatchCount: 0
    }));
    expect(report.validationReport.activeObjectIds).toEqual(['c-legacy']);
    expect(JSON.stringify(report)).not.toContain('legacy body');
  });

  it('quarantines missing legacy chat-index chunks without hydrating them as empty conversations', async () => {
    const liveConversation = conversation({
      id: 'c-live',
      messages: [message('m-live', 20, 'live body')]
    });
    const missingConversation = conversation({
      id: 'c-missing-index',
      messages: [message('m-missing-index', 10, 'missing body')]
    });
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        {
          key: 'chat-index-v2',
          value: {
            schemaVersion: 7,
            activeConversationId: missingConversation.id,
            conversations: [
              {
                id: missingConversation.id,
                title: missingConversation.title,
                collaboratorId: missingConversation.collaboratorId,
                activeProjectId: missingConversation.activeProjectId,
                draft: missingConversation.draft,
                workspaceLedger: missingConversation.workspaceLedger,
                task: missingConversation.task,
                pinnedAt: missingConversation.pinnedAt,
                updatedAt: missingConversation.updatedAt
              },
              {
                id: liveConversation.id,
                title: liveConversation.title,
                collaboratorId: liveConversation.collaboratorId,
                activeProjectId: liveConversation.activeProjectId,
                draft: liveConversation.draft,
                workspaceLedger: liveConversation.workspaceLedger,
                task: liveConversation.task,
                pinnedAt: liveConversation.pinnedAt,
                updatedAt: liveConversation.updatedAt
              }
            ],
            deletedConversationIds: []
          }
        },
        {
          key: `chat-messages-v2:${liveConversation.id}`,
          value: liveConversation.messages
        },
        personaStateEntry()
      ]
    }));

    const result = await commitChatMigrationStagingFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110,
      unitId: 'chat-staging-index-missing'
    });

    const missingCatalogRow = await kvGet<LocalDataCompleteRow<{ state: string; missingRecordKeys?: string[] }>>(
      getLocalDataRowKey(getConversationCatalogLocalDataRef(missingConversation.id))
    );

    expect(result.report.ok).toBe(false);
    expect(result.report.details.missingConversationIds).toEqual([missingConversation.id]);
    expect(result.report.projection).toEqual(expect.objectContaining({
      stagingHydrated: true,
      promotionReady: true,
      activeObjectCount: 1,
      quarantinedObjectCount: 1
    }));
    expect(result.promotionEvidence?.validationReport).toEqual(expect.objectContaining({
      activeObjectIds: [liveConversation.id],
      quarantinedObjectIds: [missingConversation.id],
      recoveredMetadata: {
        activeConversationId: null
      },
      metadataDegradationReasons: {
        activeConversationId: 'legacy active conversation did not hydrate into the active projection'
      }
    }));
    expect(missingCatalogRow?.value).toEqual(expect.objectContaining({
      state: 'incomplete',
      missingRecordKeys: [`chat-messages-v2:${missingConversation.id}`]
    }));
    expect(JSON.stringify(result.report)).not.toContain('missing body');
  });

  it('recovers missing legacy chat-index chunks from historical committed message keys', async () => {
    const recoveredConversation = conversation({
      id: 'c-history',
      messages: [message('m-history', 30, 'history body')]
    });
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        {
          key: 'chat-index-v2',
          value: {
            schemaVersion: 7,
            activeConversationId: recoveredConversation.id,
            conversations: [{
              id: recoveredConversation.id,
              title: recoveredConversation.title,
              collaboratorId: recoveredConversation.collaboratorId,
              activeProjectId: recoveredConversation.activeProjectId,
              draft: recoveredConversation.draft,
              workspaceLedger: recoveredConversation.workspaceLedger,
              task: recoveredConversation.task,
              pinnedAt: recoveredConversation.pinnedAt,
              updatedAt: recoveredConversation.updatedAt
            }],
            deletedConversationIds: []
          }
        },
        {
          key: 'chat-manifest-v1:commit-history',
          value: {
            schemaVersion: 1,
            commitId: 'commit-history',
            createdAt: 90,
            conversations: [{
              id: recoveredConversation.id,
              title: recoveredConversation.title,
              collaboratorId: recoveredConversation.collaboratorId,
              activeProjectId: recoveredConversation.activeProjectId,
              draft: recoveredConversation.draft,
              workspaceLedger: recoveredConversation.workspaceLedger,
              task: recoveredConversation.task,
              pinnedAt: recoveredConversation.pinnedAt,
              updatedAt: recoveredConversation.updatedAt,
              messageKey: `chat-message-v1:commit-history:${recoveredConversation.id}`,
              messageCount: recoveredConversation.messages.length,
              latestMessageTimestamp: 30
            }],
            activeConversationId: recoveredConversation.id,
            deletedConversationIds: []
          }
        },
        {
          key: `chat-message-v1:commit-history:${recoveredConversation.id}`,
          value: recoveredConversation.messages
        },
        personaStateEntry()
      ]
    }));

    const result = await commitChatMigrationStagingFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110,
      unitId: 'chat-staging-history-recovery'
    });
    const recordRow = await kvGet<LocalDataCompleteRow<ConversationRecordRow>>(
      getLocalDataRowKey(getConversationRecordLocalDataRef(recoveredConversation.id))
    );

    expect(result.report.ok).toBe(true);
    expect(result.report.details.missingConversationIds).toEqual([]);
    expect(result.promotionEvidence?.validationReport).toEqual(expect.objectContaining({
      activeObjectIds: [recoveredConversation.id],
      quarantinedObjectIds: []
    }));
    expect(recordRow?.value.messages).toEqual(recoveredConversation.messages);
    expect(JSON.stringify(result.report)).not.toContain('history body');
  });

  it('fails when the old persistence catalog still expects a conversation whose record is missing', async () => {
    const missingConversation = conversation({
      id: 'c-missing',
      messages: [message('m-missing', 10, 'secret body')]
    });
    const entries = [
      ...serializeChatStateEntries({
        conversations: [missingConversation],
        activeConversationId: missingConversation.id
      }),
      personaStateEntry()
    ]
      .filter((entry) => entry.key !== `chat-conversation-record-v1:${missingConversation.id}`);
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({ kv: entries }));

    const report = await buildChatMigrationDryRunReportFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110
    });

    expect(report.ok).toBe(false);
    expect(report.mismatches.missingConversationCount).toBe(1);
    expect(report.details.missingConversationIds).toEqual(['c-missing']);
    expect(JSON.stringify(report)).not.toContain('secret body');
  });

  it('commits current chat migration staging rows to the real persistence backend without promoting activeDataSource', async () => {
    const currentConversation = conversation();
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        ...serializeChatStateEntries({
          conversations: [currentConversation],
          activeConversationId: currentConversation.id
        }),
        personaStateEntry()
      ],
      assetMeta: [['asset-current', assetMeta('asset-current')]]
    }));

    const result = await commitChatMigrationStagingFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110,
      unitId: 'chat-staging-test'
    });

    const recordRow = await kvGet<LocalDataCompleteRow<ConversationRecordRow>>(
      getLocalDataRowKey(getConversationRecordLocalDataRef(currentConversation.id))
    );
    const catalogRow = await kvGet(
      getLocalDataRowKey(getConversationCatalogLocalDataRef(currentConversation.id))
    );
    const pointer = await kvGet<CommitPointerRow>(getLocalDataCommitPointerKey('chat'));
    const activeDataSource = await kvGet(getLocalDataActiveDataSourceKey());
    const promotionEvidence = result.promotionEvidence;

    expect(promotionEvidence?.commitMeta).toEqual({
      domain: 'chat',
      version: 9,
      committedAt: 100,
      commitId: 'chat-staging-test'
    });
    expect(result.report.ok).toBe(true);
    expect(promotionEvidence?.validationReport).toEqual(expect.objectContaining({
      stagingHydrated: true,
      activeObjectIds: [currentConversation.id],
      recoveredMetadata: {
        activeConversationId: currentConversation.id
      }
    }));
    expect(recordRow).toEqual(expect.objectContaining({
      state: 'complete',
      value: expect.objectContaining({
        id: currentConversation.id,
        messages: currentConversation.messages,
        assetRefs: ['asset-current']
      })
    }));
    expect(catalogRow).toEqual(expect.objectContaining({
      state: 'complete'
    }));
    expect(pointer).toEqual({
      domain: 'chat',
      version: 9,
      committedAt: 100,
      commitId: 'chat-staging-test'
    });
    expect(activeDataSource).toBeNull();
  });

  it('stages unpromoted LocalData chat rows before stale legacy catalog records', async () => {
    const staleLegacyConversation = conversation({
      id: 'c-shared',
      title: 'Shared legacy',
      messages: [message('m-old', 10, 'old body')]
    });
    const localDataConversation = conversation({
      id: 'c-shared',
      title: 'Shared local data',
      messages: [message('m-new', 30, 'new body')]
    });
    const legacyOnlyConversation = conversation({
      id: 'c-legacy-only',
      title: 'Legacy only',
      messages: [message('m-legacy-only', 20, 'legacy only body')]
    });
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({
      kv: [
        ...serializeChatStateEntries({
          conversations: [staleLegacyConversation, legacyOnlyConversation],
          activeConversationId: staleLegacyConversation.id
        }),
        ...localDataChatEntries([localDataConversation], localDataConversation.id),
        personaStateEntry()
      ]
    }));

    const result = await commitChatMigrationStagingFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110,
      unitId: 'chat-staging-unpromoted-local-data'
    });
    const sharedRecordRow = await kvGet<LocalDataCompleteRow<ConversationRecordRow>>(
      getLocalDataRowKey(getConversationRecordLocalDataRef(localDataConversation.id))
    );
    const legacyOnlyRecordRow = await kvGet<LocalDataCompleteRow<ConversationRecordRow>>(
      getLocalDataRowKey(getConversationRecordLocalDataRef(legacyOnlyConversation.id))
    );

    expect(result.report.ok).toBe(true);
    expect(result.report.summary.conversationCount).toBe(2);
    expect(result.promotionEvidence?.validationReport).toEqual(expect.objectContaining({
      activeObjectIds: ['c-legacy-only', 'c-shared'],
      recoveredMetadata: {
        activeConversationId: localDataConversation.id
      }
    }));
    expect(sharedRecordRow?.value.messages).toEqual(localDataConversation.messages);
    expect(legacyOnlyRecordRow?.value.messages).toEqual(legacyOnlyConversation.messages);
    expect(JSON.stringify(result.report)).not.toContain('old body');
  });

  it('attaches promotion evidence when missing old baseline rows are quarantined', async () => {
    const missingConversation = conversation({
      id: 'c-staging-missing',
      messages: [message('m-staging-missing', 10, 'private missing body')]
    });
    const entries = serializeChatStateEntries({
      conversations: [missingConversation],
      activeConversationId: missingConversation.id
    }).filter((entry) => entry.key !== `chat-conversation-record-v1:${missingConversation.id}`);
    setPersistenceBackendForTesting(createMemoryPersistenceBackend({ kv: entries }));

    const result = await commitChatMigrationStagingFromCurrentPersistence({
      version: 9,
      committedAt: 100,
      validatedAt: 110,
      unitId: 'chat-staging-missing'
    });

    expect(result.report.ok).toBe(false);
    expect(result.report.mismatches.missingConversationCount).toBe(1);
    expect(result.report.details.missingConversationIds).toEqual(['c-staging-missing']);
    expect(result.report.projection).toEqual(expect.objectContaining({
      stagingHydrated: true,
      promotionReady: true
    }));
    expect(result.promotionEvidence?.validationReport).toEqual(expect.objectContaining({
      activeObjectIds: [],
      quarantinedObjectIds: ['c-staging-missing'],
      recoveredMetadata: {
        activeConversationId: null
      }
    }));
    expect(JSON.stringify(result.report)).not.toContain('private missing body');
  });
});
