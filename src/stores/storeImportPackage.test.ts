import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importStructuredExportPackage,
  mapWithConcurrency
} from './storeImportPackage';
import {
  ASSET_INDEX_PATH,
  buildStructuredExportPackage,
  PERSONA_MEMORY_DOC_CONTENT_PATH,
  SPACE_STORE_VERSION
} from './storeExportPackage';
import { readCompleteLiveChatState } from './chatCurrentPersistence';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import type { PersistedKvEntry } from '../infrastructure/persistence';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import {
  type LocalDataBackendMutation,
  type LocalDataCommitMeta,
  type LocalDataTransactionalBackend
} from '../engines/localData';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from './storeLocalDataBackendHost';

const persistenceMocks = vi.hoisted(() => ({
  ASSET_BINARY_STORE: 'asset-binary',
  ASSET_META_STORE: 'asset-meta',
  ASSET_PREVIEW_STORE: 'asset-preview',
  acquireExclusiveKvWriteGate: vi.fn(),
  dbStoreEntries: vi.fn(),
  dbStoreEntrySizes: vi.fn(),
  dbStoreKeys: vi.fn(),
  getPersistenceLocalDataCommitMode: vi.fn(),
  getPersistenceStorageDiagnostic: vi.fn(),
  kvApplyMutations: vi.fn(),
  kvEntries: vi.fn(),
  kvEntrySizes: vi.fn(),
  kvGet: vi.fn(),
  kvKeys: vi.fn(),
  kvKeysWithPrefix: vi.fn(),
  kvReplaceAll: vi.fn(),
  withExclusiveKvWriteGate: vi.fn()
}));

const assetStoreMocks = vi.hoisted(() => ({
  exportAssetEntries: vi.fn(),
  recoverPendingAssetImportStage: vi.fn(),
  stageAssetImportEntries: vi.fn()
}));

const pageLifecycleMocks = vi.hoisted(() => ({
  flushPageLifecycleHandlers: vi.fn()
}));

const importApplyMocks = vi.hoisted(() => ({
  applyImportedPersistedStores: vi.fn()
}));

vi.mock('../infrastructure/persistence', () => ({
  ASSET_BINARY_STORE: persistenceMocks.ASSET_BINARY_STORE,
  ASSET_META_STORE: persistenceMocks.ASSET_META_STORE,
  ASSET_PREVIEW_STORE: persistenceMocks.ASSET_PREVIEW_STORE,
  acquireExclusiveKvWriteGate: persistenceMocks.acquireExclusiveKvWriteGate,
  dbStoreEntries: persistenceMocks.dbStoreEntries,
  dbStoreEntrySizes: persistenceMocks.dbStoreEntrySizes,
  dbStoreKeys: persistenceMocks.dbStoreKeys,
  getPersistenceLocalDataCommitMode: persistenceMocks.getPersistenceLocalDataCommitMode,
  getPersistenceStorageDiagnostic: persistenceMocks.getPersistenceStorageDiagnostic,
  kvApplyMutations: persistenceMocks.kvApplyMutations,
  kvEntries: persistenceMocks.kvEntries,
  kvEntrySizes: persistenceMocks.kvEntrySizes,
  kvGet: persistenceMocks.kvGet,
  kvKeys: persistenceMocks.kvKeys,
  kvKeysWithPrefix: persistenceMocks.kvKeysWithPrefix,
  kvReplaceAll: persistenceMocks.kvReplaceAll,
  withExclusiveKvWriteGate: persistenceMocks.withExclusiveKvWriteGate
}));

vi.mock('../infrastructure/assetStore', () => ({
  exportAssetEntries: assetStoreMocks.exportAssetEntries,
  getActiveAssetStorageKey: async (assetId: string) => assetId,
  listActiveAssetBinaryKeys: async () => Array.from(getDbStore(persistenceMocks.ASSET_BINARY_STORE).keys()),
  listActiveAssetMetaEntries: async () =>
    Array.from(getDbStore(persistenceMocks.ASSET_META_STORE).entries()).map(([key, value]) => ({ key, value })),
  listActiveAssetPreviewKeys: async () => Array.from(getDbStore(persistenceMocks.ASSET_PREVIEW_STORE).keys()),
  recoverPendingAssetImportStage: assetStoreMocks.recoverPendingAssetImportStage,
  stageAssetImportEntries: assetStoreMocks.stageAssetImportEntries
}));

vi.mock('../infrastructure/pageLifecycleFlush', () => ({
  flushPageLifecycleHandlers: pageLifecycleMocks.flushPageLifecycleHandlers
}));

vi.mock('./storeImportApply', () => ({
  applyImportedPersistedStores: importApplyMocks.applyImportedPersistedStores
}));

function createLocalStorageMock(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    get length() {
      return values.size;
    },
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    setRaw: (key: string, value: string) => {
      values.set(key, value);
    },
    entries: () => Array.from(values.entries())
  };
}

async function buildMinimalImportBlob(options: {
  spaceState?: Record<string, unknown>;
  chatState?: Record<string, unknown>;
  collectionState?: Record<string, unknown>;
  assetFiles?: Array<{ id: string; content: string; name?: string; mimeType?: string }>;
} = {}) {
  const zip = new JSZip();
  const assetFiles = options.assetFiles ?? [];
  zip.file('manifest.json', JSON.stringify({
    format: 'polaris-export',
    version: 1,
    createdAt: 1,
    appVersion: '1.0.0',
    stores: {
      space: 'stores/space.json',
      chat: 'stores/chat.json',
      collection: 'stores/collection.json',
      persona: 'stores/persona.json',
      runtime: 'stores/runtime.json'
    },
    assets: {
      count: assetFiles.length,
      imageCount: assetFiles.length,
      attachmentCount: assetFiles.length,
      index: ASSET_INDEX_PATH
    }
  }));
  zip.file('stores/space.json', JSON.stringify(options.spaceState ?? {}));
  zip.file('stores/chat.json', JSON.stringify(options.chatState ?? { conversations: [], activeConversationId: null }));
  zip.file('stores/collection.json', JSON.stringify({
    cards: [],
    projectFiles: [],
    workspaceReferenceDocs: [],
    roomProjects: [],
    imageCards: [],
    deletedBundledCardIds: [],
    ...(options.collectionState ?? {})
  }));
  zip.file('stores/persona.json', JSON.stringify({
    personas: [],
    activeCollaboratorId: null,
    seededDefaultPersonaIds: []
  }));
  zip.file('stores/runtime.json', JSON.stringify({ providers: [] }));
  zip.file(ASSET_INDEX_PATH, JSON.stringify(assetFiles.map((asset) => {
    const filePath = `assets/${asset.id}.txt`;
    zip.file(filePath, asset.content);
    return {
      id: asset.id,
      kind: 'file',
      name: asset.name ?? `${asset.id}.txt`,
      mimeType: asset.mimeType ?? 'text/plain',
      size: asset.content.length,
      createdAt: 1,
      filePath
    };
  })));
  return await zip.generateAsync({ type: 'blob' });
}

let kvValues = new Map<string, unknown>();
let dbStoreValues = new Map<string, Map<string, unknown>>();

function currentKvEntries(): PersistedKvEntry[] {
  return Array.from(kvValues.entries()).map(([key, value]) => ({ key, value }));
}

function currentKvValue<T = unknown>(key: string): T | undefined {
  return kvValues.get(key) as T | undefined;
}

function currentKvKeys() {
  return Array.from(kvValues.keys());
}

function createMemoryStoreLocalDataBackend() {
  const values = new Map<string, unknown>();
  const commits: LocalDataCommitMeta[] = [];
  const backend: LocalDataTransactionalBackend = {
    mode: 'transactional',
    async read<T>(key: string) {
      return (values.get(key) ?? null) as T | null;
    },
    async listKeysWithPrefix(prefix: string) {
      return Array.from(values.keys()).filter((key) => key.startsWith(prefix));
    },
    async commitAtomic(mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta) {
      commits.push(meta);
      for (const mutation of mutations) {
        if (mutation.type === 'delete') {
          values.delete(mutation.key);
        } else {
          values.set(mutation.key, mutation.value);
        }
      }
    }
  };

  return { backend, commits, values };
}

function currentLocalDataDiagnosticShape() {
  const keys = currentKvKeys();
  const rowPrefix = 'local-data-v1:row:';
  const pointerPrefix = 'local-data-v1:pointer:';
  const repositoryRowsByDomain: Record<string, number> = {};
  for (const key of keys) {
    if (!key.startsWith(rowPrefix)) continue;
    const domain = key.slice(rowPrefix.length).split(':')[0];
    if (!domain) continue;
    repositoryRowsByDomain[domain] = (repositoryRowsByDomain[domain] ?? 0) + 1;
  }
  const activeSource = currentKvValue<{ activeDataSource?: unknown; domains?: Record<string, unknown> }>(
    'local-data-v1:active-data-source'
  );
  const activeDomains = Object.keys(activeSource?.domains ?? {})
    .filter((domain) => keys.includes(`${pointerPrefix}${domain}`))
    .sort();
  return {
    activeDataSource: activeSource?.activeDataSource === 'repository' ? 'repository' : 'unknown',
    activeDataSourceRowPresent: Boolean(activeSource),
    activeDomainCount: activeDomains.length,
    activeDomains,
    repositoryKeyCount: keys.filter((key) => key.startsWith('local-data-v1:')).length,
    repositoryRowCount: keys.filter((key) => key.startsWith(rowPrefix)).length,
    repositoryPointerCount: keys.filter((key) => key.startsWith(pointerPrefix)).length,
    repositoryRowsByDomain,
    nonRepositoryKvKeyCount: keys.filter((key) => !key.startsWith('local-data-v1:')).length
  };
}

const PRODUCTION_DIAGNOSTICS_STRESS_SHAPE = {
  activeDomains: ['collection', 'persona', 'runtime', 'space'],
  repositoryPointerCount: 7,
  repositoryRowsByDomain: {
    chat: 789,
    collection: 125,
    persona: 11,
    runtime: 62,
    document: 20,
    space: 14,
    asset: 91
  },
  nonRepositoryKvKeyCount: 422,
  storage: {
    assetMetaKeyCount: 446,
    assetBinaryKeyCount: 446,
    assetPreviewKeyCount: 281
  }
} as const;

function deriveDiagnosticsStressPlan(shape = PRODUCTION_DIAGNOSTICS_STRESS_SHAPE) {
  const roomProjectCount = 1;
  const projectFileCount = 0;
  const workspaceDocCount = 0;
  const imageCardCount = Math.min(
    shape.repositoryRowsByDomain.asset - 1,
    shape.repositoryRowsByDomain.collection - 1 - roomProjectCount,
    shape.storage.assetPreviewKeyCount
  );
  const codeCardCount = shape.repositoryRowsByDomain.collection
    - 1
    - roomProjectCount
    - imageCardCount
    - projectFileCount
    - workspaceDocCount;

  return {
    sourceShape: shape,
    conversationCount: Math.floor((shape.repositoryRowsByDomain.chat - 1) / 2),
    messagesPerConversation: 8,
    personaCount: shape.repositoryRowsByDomain.persona - 1,
    personaReferenceDocCount: shape.repositoryRowsByDomain.document - 1,
    assetCount: shape.storage.assetMetaKeyCount,
    previewAssetCount: shape.storage.assetPreviewKeyCount,
    codeCardCount,
    imageCardCount,
    projectFileCount,
    workspaceDocCount,
    roomProjectCount
  };
}

function applyKvMutationsToMemory(mutations: Array<{ type: 'set' | 'delete'; key: string; value?: unknown }>) {
  for (const mutation of mutations) {
    if (mutation.type === 'delete') {
      kvValues.delete(mutation.key);
    } else {
      kvValues.set(mutation.key, mutation.value);
    }
  }
}

function getDbStore(storeName: string) {
  let store = dbStoreValues.get(storeName);
  if (!store) {
    store = new Map();
    dbStoreValues.set(storeName, store);
  }
  return store;
}

function readSpaceLocalStorageState(localStorage: { entries: () => Array<[string, string]> }) {
  const value = localStorage.entries().find(([key]) => key === 'polaris-space-store-v1')?.[1];
  expect(value).toBeTypeOf('string');
  return JSON.parse(value as string) as { state: { activeCardId?: string }; version: number };
}

beforeEach(() => {
  resetStoreLocalDataBackendForTesting();
  kvValues = new Map();
  dbStoreValues = new Map();
  persistenceMocks.acquireExclusiveKvWriteGate.mockResolvedValue({
    token: 'test-gate',
    release: vi.fn()
  });
  persistenceMocks.dbStoreEntries.mockImplementation(async (storeName: string) =>
    Array.from(getDbStore(storeName).entries()).map(([key, value]) => ({ key, value }))
  );
  persistenceMocks.dbStoreEntrySizes.mockImplementation(async (storeName: string) =>
    Array.from(getDbStore(storeName).entries()).map(([key, value]) => ({
      key,
      bytes: value instanceof Blob ? value.size : JSON.stringify(value).length
    }))
  );
  persistenceMocks.dbStoreKeys.mockImplementation(async (storeName: string) =>
    Array.from(getDbStore(storeName).keys())
  );
  persistenceMocks.getPersistenceLocalDataCommitMode.mockReturnValue('transactional');
  persistenceMocks.getPersistenceStorageDiagnostic.mockResolvedValue(null);
  persistenceMocks.kvEntries.mockImplementation(async () => currentKvEntries());
  persistenceMocks.kvEntrySizes.mockImplementation(async () =>
    currentKvEntries().map((entry) => ({
      key: entry.key,
      bytes: JSON.stringify(entry.value).length
    }))
  );
  persistenceMocks.kvGet.mockImplementation(async (key: string) => kvValues.get(key) ?? null);
  persistenceMocks.kvKeys.mockImplementation(async () => Array.from(kvValues.keys()));
  persistenceMocks.kvKeysWithPrefix.mockImplementation(async (prefix: string) =>
    (await persistenceMocks.kvKeys()).filter((key: string) => key.startsWith(prefix))
  );
  persistenceMocks.kvApplyMutations.mockImplementation(async (mutations: Array<{ type: 'set' | 'delete'; key: string; value?: unknown }>) => {
    applyKvMutationsToMemory(mutations);
  });
  persistenceMocks.kvReplaceAll.mockImplementation(async (entries: PersistedKvEntry[]) => {
    kvValues = new Map(entries.map((entry) => [entry.key, entry.value]));
  });
  persistenceMocks.withExclusiveKvWriteGate.mockImplementation(async (operation: (gateToken: string) => Promise<unknown>) =>
    await operation('test-gate')
  );
  assetStoreMocks.exportAssetEntries.mockResolvedValue([]);
  let pendingAssetStage = false;
  assetStoreMocks.stageAssetImportEntries.mockImplementation(async (
    entries: Array<{ meta: { id: string }; blob: Blob; previewBlob: Blob | null }>,
    options: { assetCommitId: string; onProgress?: (current: number, total: number) => void }
  ) => {
    pendingAssetStage = true;
    const staged = entries.map((entry) => ({ ...entry, storageKey: `staged:${entry.meta.id}` }));
    for (let index = 0; index < staged.length; index += 1) {
      const entry = staged[index]!;
      getDbStore(persistenceMocks.ASSET_BINARY_STORE).set(entry.storageKey, entry.blob);
      if (entry.previewBlob) getDbStore(persistenceMocks.ASSET_PREVIEW_STORE).set(entry.storageKey, entry.previewBlob);
      options?.onProgress?.(index + 1, entries.length);
    }
    return {
      stageId: 'stage-test',
      assetCommitId: options.assetCommitId,
      entries: staged
    };
  });
  assetStoreMocks.recoverPendingAssetImportStage.mockImplementation(async () => {
    if (!pendingAssetStage) return 'none';
    pendingAssetStage = false;
    return 'published';
  });
  importApplyMocks.applyImportedPersistedStores.mockResolvedValue(undefined);
});

afterEach(() => {
  resetStoreLocalDataBackendForTesting();
  vi.unstubAllGlobals();
  persistenceMocks.acquireExclusiveKvWriteGate.mockReset();
  persistenceMocks.dbStoreEntries.mockReset();
  persistenceMocks.dbStoreEntrySizes.mockReset();
  persistenceMocks.dbStoreKeys.mockReset();
  persistenceMocks.getPersistenceLocalDataCommitMode.mockReset();
  persistenceMocks.getPersistenceStorageDiagnostic.mockReset();
  persistenceMocks.kvApplyMutations.mockReset();
  persistenceMocks.kvEntries.mockReset();
  persistenceMocks.kvEntrySizes.mockReset();
  persistenceMocks.kvGet.mockReset();
  persistenceMocks.kvKeys.mockReset();
  persistenceMocks.kvKeysWithPrefix.mockReset();
  persistenceMocks.kvReplaceAll.mockReset();
  persistenceMocks.withExclusiveKvWriteGate.mockReset();
  assetStoreMocks.exportAssetEntries.mockReset();
  assetStoreMocks.recoverPendingAssetImportStage.mockReset();
  assetStoreMocks.stageAssetImportEntries.mockReset();
  pageLifecycleMocks.flushPageLifecycleHandlers.mockReset();
  importApplyMocks.applyImportedPersistedStores.mockReset();
});

describe('mapWithConcurrency', () => {
  it('limits active workers while preserving result order', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

describe('importStructuredExportPackage', () => {
  it('rejects a package without a manifest before mutating installed data', async () => {
    const zip = new JSZip();
    zip.file('stores/chat.json', JSON.stringify({ conversations: [], activeConversationId: null }));

    await expect(importStructuredExportPackage(await zip.generateAsync({ type: 'blob' })))
      .rejects
      .toThrow('导出包缺少 manifest.json');

    expect(pageLifecycleMocks.flushPageLifecycleHandlers).not.toHaveBeenCalled();
    expect(persistenceMocks.kvApplyMutations).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).not.toHaveBeenCalled();
  });

  it('rejects a package with a missing declared store before mutating installed data', async () => {
    const zip = await JSZip.loadAsync(await (await buildMinimalImportBlob()).arrayBuffer());
    zip.remove('stores/chat.json');

    await expect(importStructuredExportPackage(await zip.generateAsync({ type: 'blob' })))
      .rejects
      .toThrow('导出包缺少 stores/chat.json');

    expect(pageLifecycleMocks.flushPageLifecycleHandlers).not.toHaveBeenCalled();
    expect(persistenceMocks.kvApplyMutations).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).not.toHaveBeenCalled();
  });

  it('rejects an asset size mismatch before mutating installed data', async () => {
    const zip = await JSZip.loadAsync(await (await buildMinimalImportBlob({
      assetFiles: [{ id: 'asset-size-mismatch', content: 'original' }]
    })).arrayBuffer());
    zip.file('assets/asset-size-mismatch.txt', 'changed-after-index');

    await expect(importStructuredExportPackage(await zip.generateAsync({ type: 'blob' })))
      .rejects
      .toThrow('大小与资产索引不一致');

    expect(pageLifecycleMocks.flushPageLifecycleHandlers).not.toHaveBeenCalled();
    expect(persistenceMocks.kvApplyMutations).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).not.toHaveBeenCalled();
  });

  it('imports split persona memory document content when the backup contains it', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      format: 'polaris-export',
      version: 1,
      createdAt: 1,
      appVersion: '1.0.0',
      stores: {
        space: 'stores/space.json',
        chat: 'stores/chat.json',
        collection: 'stores/collection.json',
        persona: 'stores/persona.json',
        personaMemoryDocContent: PERSONA_MEMORY_DOC_CONTENT_PATH,
        runtime: 'stores/runtime.json'
      },
      assets: {
        count: 0,
        imageCount: 0,
        attachmentCount: 0,
        index: ASSET_INDEX_PATH
      }
    }));
    zip.file('stores/space.json', JSON.stringify({}));
    zip.file('stores/chat.json', JSON.stringify({ conversations: [], activeConversationId: null }));
    zip.file('stores/collection.json', JSON.stringify({
      cards: [],
      projectFiles: [],
      workspaceReferenceDocs: [],
      roomProjects: [],
      imageCards: [],
      deletedBundledCardIds: []
    }));
    zip.file('stores/persona.json', JSON.stringify({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    }));
    zip.file(PERSONA_MEMORY_DOC_CONTENT_PATH, JSON.stringify({
      version: 1,
      docs: {
        'persona-1:doc-1': 'large body'
      }
    }));
    zip.file('stores/runtime.json', JSON.stringify({ providers: [] }));
    zip.file(ASSET_INDEX_PATH, JSON.stringify([]));

    await importStructuredExportPackage(await zip.generateAsync({ type: 'blob' }));

    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    const importedKeys = currentKvKeys();
    expect(importedKeys).toContain('local-data-v1:pointer:chat');
    expect(importedKeys).toContain('local-data-v1:active-data-source');
    expect(importedKeys.some((key) => key === 'chat-catalog-v1')).toBe(false);
    expect(importedKeys.some((key) => key.startsWith('chat-manifest-v1:'))).toBe(false);
    const orphanDoc = currentKvEntries().find((entry) =>
      entry.key.startsWith('local-data-v1:row:document:orphan-body:persona-orphan')
    );
    expect(orphanDoc?.value).toMatchObject({
      state: 'complete',
      value: expect.objectContaining({
        kind: 'orphan-body',
        content: 'large body',
        storageSource: 'split'
      })
    });
  });

  it('keeps unrelated and inactive legacy KV evidence while replacing current LocalData rows', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    kvValues = new Map([
      { key: 'chat-catalog-v1', value: { old: true } },
      { key: 'stale-shadow-key', value: true },
      { key: 'local-data-v1:row:chat:domainMeta:chat', value: { oldRepository: true } }
    ].map((entry) => [entry.key, entry.value]));
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });

    await importStructuredExportPackage(await buildMinimalImportBlob());

    const importedKeys = currentKvKeys();
    expect(importedKeys).toContain('local-data-v1:pointer:chat');
    expect(importedKeys).toContain('local-data-v1:active-data-source');
    expect(importedKeys).toContain('stale-shadow-key');
    expect(importedKeys).toContain('chat-catalog-v1');
    expect(importedKeys.some((key) => key.startsWith('local-data-v1:row:chat:'))).toBe(true);
    expect(persistenceMocks.kvApplyMutations).toHaveBeenCalled();
  });

  it('restores LocalData rows through the installed store backend instead of raw KV', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });
    const installed = createMemoryStoreLocalDataBackend();
    installed.values.set('local-data-v1:active-data-source', { stale: true });
    installed.values.set('local-data-v1:pointer:chat', { stale: true });
    installed.values.set('local-data-v1:row:chat:domainMeta:chat', { stale: true });
    installed.values.set('local-data-v1:row:chat:conversationCatalog:old-conversation', { stale: true });
    installStoreLocalDataBackend(installed.backend);
    persistenceMocks.kvApplyMutations.mockImplementation(async (
      mutations: Array<{ type: 'set' | 'delete'; key: string; value?: unknown }>
    ) => {
      if (mutations.some((mutation) => mutation.key.startsWith('local-data-v1:'))) {
        throw new Error('structured import restore must not write LocalData rows through raw KV');
      }
      applyKvMutationsToMemory(mutations);
    });

    await importStructuredExportPackage(await buildMinimalImportBlob({
      chatState: {
        conversations: [{
          id: 'conversation-installed-backend',
          title: '导入到当前事实源',
          collaboratorId: null,
          messages: [],
          pinnedAt: null,
          updatedAt: 2
        }],
        activeConversationId: 'conversation-installed-backend'
      }
    }));

    expect(currentKvKeys().filter((key) => key.startsWith('local-data-v1:'))).toEqual([]);
    expect(installed.values.has('local-data-v1:active-data-source')).toBe(true);
    expect(installed.values.has('local-data-v1:row:chat:conversationCatalog:conversation-installed-backend')).toBe(true);
    expect(installed.values.get('local-data-v1:row:chat:conversationCatalog:old-conversation')).toMatchObject({
      state: 'deleted'
    });
    expect(installed.values.get('local-data-v1:row:chat:domainMeta:chat')).not.toMatchObject({ stale: true });
    expect(installed.commits[0]).toMatchObject({ domain: 'chat' });
    expect(installed.commits.map((commit) => commit.domain)).toContain('chat');
  });

  it('rejects structured import when a LocalData domain cannot be restored', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });
    let localDataCommitCount = 0;
    persistenceMocks.kvApplyMutations.mockImplementation(async (
      mutations: Array<{ type: 'set' | 'delete'; key: string; value?: unknown }>
    ) => {
      localDataCommitCount += 1;
      if (localDataCommitCount === 2) {
        throw new Error('collection commit failed');
      }
      applyKvMutationsToMemory(mutations);
    });

    const result = await importStructuredExportPackage(await buildMinimalImportBlob({
      chatState: {
        conversations: [{
          id: 'conversation-survives-partial',
          title: '能恢复的继续恢复',
          collaboratorId: null,
          messages: [],
          pinnedAt: null,
          updatedAt: 2
        }],
        activeConversationId: 'conversation-survives-partial'
      },
      collectionState: {
        cards: [{
          id: 'collection-will-fail',
          title: '这个域模拟失败',
          language: 'text',
          code: 'bad collection commit is isolated',
          tags: [],
          source: 'manual',
          createdAt: 1,
          updatedAt: 1
        }]
      }
    }));

    expect(result).toMatchObject({
      status: 'partial',
      retainedDomains: [expect.objectContaining({ domain: 'collection', stage: 'domain-commit' })]
    });

    const activeDataSource = currentKvValue<{ domains: Record<string, unknown> }>('local-data-v1:active-data-source');
    expect(activeDataSource?.domains.chat).toBeDefined();
    expect(activeDataSource?.domains.collection).toBeUndefined();
    expect(activeDataSource?.domains.persona).toBeDefined();
    expect(currentKvKeys()).toContain('local-data-v1:row:chat:conversationCatalog:conversation-survives-partial');
    expect(currentKvKeys()).not.toContain('local-data-v1:row:collection:card:collection-will-fail');
    expect(importApplyMocks.applyImportedPersistedStores).toHaveBeenCalled();
  });

  it('imports legacy project cards as project files while keeping workspace docs bound to the project', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });

    await importStructuredExportPackage(await buildMinimalImportBlob({
      collectionState: {
        cards: [{
          id: 'legacy-file-card',
          title: 'index.html',
          language: 'html',
          code: '<main>legacy project file</main>',
          tags: [],
          source: 'chat-generated',
          createdAt: 1,
          updatedAt: 2,
          projectId: 'project-1',
          filePath: './index.html',
          fileRole: 'entry'
        }],
        projectFiles: [],
        workspaceReferenceDocs: [{
          id: 'workspace-doc-1',
          projectId: 'project-1',
          title: '项目资料',
          summary: '资料摘要',
          content: 'workspace reference body',
          source: 'manual',
          createdAt: 1,
          updatedAt: 2
        }],
        roomProjects: [{
          id: 'project-1',
          title: 'Imported Project',
          slug: 'imported-project',
          fileIds: [],
          tags: [],
          source: 'manual',
          createdAt: 1,
          updatedAt: 2
        }]
      }
    }));

    const projectFileRow = currentKvValue<Record<string, unknown>>(
      'local-data-v1:row:collection:project-file:legacy-file-card'
    );
    const workspaceDocRow = currentKvValue<Record<string, unknown>>(
      'local-data-v1:row:collection:workspace-doc:workspace-doc-1'
    );
    expect(projectFileRow).toMatchObject({
      state: 'complete',
      value: expect.objectContaining({
        value: expect.objectContaining({
          id: 'legacy-file-card',
          projectId: 'project-1',
          filePath: 'index.html',
          content: '<main>legacy project file</main>'
        })
      })
    });
    expect(workspaceDocRow).toMatchObject({
      state: 'complete',
      value: expect.objectContaining({
        value: expect.objectContaining({
          id: 'workspace-doc-1',
          projectId: 'project-1',
          title: '项目资料',
          content: 'workspace reference body',
          charCount: 'workspace reference body'.length,
          contentLoaded: false
        })
      })
    });
  });

  it('flushes pending lifecycle persistence before structured KV mutation write', async () => {
    const events: string[] = [];
    pageLifecycleMocks.flushPageLifecycleHandlers.mockImplementation(async () => {
      events.push('flush');
    });
    persistenceMocks.kvApplyMutations.mockImplementation(async (mutations) => {
      events.push('write-kv');
      applyKvMutationsToMemory(mutations);
    });
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      format: 'polaris-export',
      version: 1,
      createdAt: 1,
      appVersion: '1.0.0',
      stores: {
        space: 'stores/space.json',
        chat: 'stores/chat.json',
        collection: 'stores/collection.json',
        persona: 'stores/persona.json',
        runtime: 'stores/runtime.json'
      },
      assets: {
        count: 0,
        imageCount: 0,
        attachmentCount: 0,
        index: ASSET_INDEX_PATH
      }
    }));
    zip.file('stores/space.json', JSON.stringify({}));
    zip.file('stores/chat.json', JSON.stringify({ conversations: [], activeConversationId: null }));
    zip.file('stores/collection.json', JSON.stringify({
      cards: [],
      projectFiles: [],
      workspaceReferenceDocs: [],
      roomProjects: [],
      imageCards: [],
      deletedBundledCardIds: []
    }));
    zip.file('stores/persona.json', JSON.stringify({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    }));
    zip.file('stores/runtime.json', JSON.stringify({ providers: [] }));
    zip.file(ASSET_INDEX_PATH, JSON.stringify([]));

    await importStructuredExportPackage(await zip.generateAsync({ type: 'blob' }));

    expect(events[0]).toBe('flush');
    expect(events.slice(1).every((event) => event === 'write-kv')).toBe(true);
    expect(persistenceMocks.kvApplyMutations).toHaveBeenCalled();
  });

  it('does not route structured imports through destructive whole-KV replacement', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll
      .mockRejectedValueOnce(new Error('kv failed'))
      .mockResolvedValue(undefined);
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    vi.stubGlobal('window', { localStorage });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      format: 'polaris-export',
      version: 1,
      createdAt: 1,
      appVersion: '1.0.0',
      stores: {
        space: 'stores/space.json',
        chat: 'stores/chat.json',
        collection: 'stores/collection.json',
        persona: 'stores/persona.json',
        runtime: 'stores/runtime.json'
      },
      assets: {
        count: 0,
        imageCount: 0,
        attachmentCount: 0,
        index: ASSET_INDEX_PATH
      }
    }));
    zip.file('stores/space.json', JSON.stringify({}));
    zip.file('stores/chat.json', JSON.stringify({ conversations: [], activeConversationId: null }));
    zip.file('stores/collection.json', JSON.stringify({
      cards: [],
      projectFiles: [],
      workspaceReferenceDocs: [],
      roomProjects: [],
      imageCards: [],
      deletedBundledCardIds: []
    }));
    zip.file('stores/persona.json', JSON.stringify({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    }));
    zip.file('stores/runtime.json', JSON.stringify({ providers: [] }));
    zip.file(ASSET_INDEX_PATH, JSON.stringify([]));

    await expect(importStructuredExportPackage(await zip.generateAsync({ type: 'blob' })))
      .resolves.toMatchObject({ status: 'complete' });

    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).toHaveBeenCalled();
  });

  it('imports without whole-store clearing and uses durable asset staging', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    vi.stubGlobal('window', { localStorage });

    await expect(importStructuredExportPackage(await buildMinimalImportBlob({
      spaceState: { activeCardId: 'new-card' }
    }))).resolves.toMatchObject({ status: 'complete' });

    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'new-card' },
      version: SPACE_STORE_VERSION
    });
    expect(assetStoreMocks.stageAssetImportEntries).toHaveBeenCalledWith([], expect.any(Object));
  });

  it('stops before destructive replacement when export asset files cannot be read', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    vi.stubGlobal('window', { localStorage });
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      format: 'polaris-export',
      version: 1,
      createdAt: 1,
      appVersion: '1.0.0',
      stores: {
        space: 'stores/space.json',
        chat: 'stores/chat.json',
        collection: 'stores/collection.json',
        persona: 'stores/persona.json',
        runtime: 'stores/runtime.json'
      },
      assets: {
        count: 1,
        imageCount: 0,
        attachmentCount: 1,
        index: ASSET_INDEX_PATH
      }
    }));
    zip.file('stores/space.json', JSON.stringify({ activeCardId: 'new-card' }));
    zip.file('stores/chat.json', JSON.stringify({ conversations: [], activeConversationId: null }));
    zip.file('stores/collection.json', JSON.stringify({
      cards: [],
      projectFiles: [],
      workspaceReferenceDocs: [],
      roomProjects: [],
      imageCards: [],
      deletedBundledCardIds: []
    }));
    zip.file('stores/persona.json', JSON.stringify({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    }));
    zip.file('stores/runtime.json', JSON.stringify({ providers: [] }));
    zip.file(ASSET_INDEX_PATH, JSON.stringify([{
      id: 'asset-missing',
      kind: 'file',
      name: 'missing.txt',
      mimeType: 'text/plain',
      size: 7,
      createdAt: 1,
      filePath: 'assets/missing.txt'
    }]));

    await expect(importStructuredExportPackage(await zip.generateAsync({ type: 'blob' })))
      .rejects.toThrow('导出包缺少 assets/missing.txt');

    expect(pageLifecycleMocks.flushPageLifecycleHandlers).not.toHaveBeenCalled();
    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'old-card' },
      version: 1
    });
    expect(assetStoreMocks.stageAssetImportEntries).not.toHaveBeenCalled();
  });

  it('restores previous localStorage values and retains the space domain when replacement throws', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    localStorage.setItem.mockImplementation((key: string, value: string) => {
      if (key === 'polaris-space-store-v1' && value.includes('new-card')) {
        throw new Error('localStorage failed');
      }
      localStorage.setRaw(key, value);
    });
    vi.stubGlobal('window', { localStorage });

    await expect(importStructuredExportPackage(await buildMinimalImportBlob({
      spaceState: { activeCardId: 'new-card' }
    }))).resolves.toMatchObject({
      status: 'partial',
      retainedDomains: [expect.objectContaining({ domain: 'space', stage: 'local-storage' })]
    });

    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(persistenceMocks.kvApplyMutations).toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).toHaveBeenCalled();
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'old-card' },
      version: 1
    });
  });

  it('retains the asset domain when staged asset upsert fails', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    assetStoreMocks.stageAssetImportEntries.mockRejectedValueOnce(new Error('asset failed'));
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    vi.stubGlobal('window', { localStorage });

    await expect(importStructuredExportPackage(await buildMinimalImportBlob({
      spaceState: { activeCardId: 'new-card' },
      assetFiles: [{ id: 'asset-new', content: 'new' }]
    }))).resolves.toMatchObject({
      status: 'partial',
      retainedDomains: [expect.objectContaining({ domain: 'asset', stage: 'asset-staging' })]
    });

    expect(assetStoreMocks.exportAssetEntries).not.toHaveBeenCalled();
    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).toHaveBeenCalledTimes(1);
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'new-card' },
      version: SPACE_STORE_VERSION
    });
  });

  it('does not fail structured import when in-memory hydration refresh fails after writes', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    importApplyMocks.applyImportedPersistedStores.mockRejectedValueOnce(new Error('hydrate failed'));
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}'
    });
    vi.stubGlobal('window', { localStorage });

    await expect(importStructuredExportPackage(await buildMinimalImportBlob({
      spaceState: { activeCardId: 'new-card' },
      assetFiles: [{ id: 'asset-new', content: 'new' }]
    }))).resolves.toMatchObject({ status: 'partial' });

    expect(assetStoreMocks.exportAssetEntries).not.toHaveBeenCalled();
    expect(persistenceMocks.kvReplaceAll).not.toHaveBeenCalled();
    expect(assetStoreMocks.stageAssetImportEntries).toHaveBeenCalledTimes(1);
    expect(importApplyMocks.applyImportedPersistedStores).toHaveBeenCalledTimes(1);
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'new-card' },
      version: SPACE_STORE_VERSION
    });
  });

  it('does not revive quarantined-only conversation ids as active LocalData chat rows', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    persistenceMocks.kvReplaceAll.mockResolvedValue(undefined);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });

    await importStructuredExportPackage(await buildMinimalImportBlob({
      chatState: {
        conversations: [],
        activeConversationId: null,
        quarantinedConversationIds: ['c-missing-body', 'c-missing-body', '']
      }
    }));

    expect(currentKvKeys()).not.toContain('chat-catalog-v1');
    expect(currentKvKeys()).not.toContain('local-data-v1:row:chat:conversationCatalog:c-missing-body');
    expect(currentKvValue('local-data-v1:row:chat:domainMeta:chat')).toMatchObject({
      state: 'complete',
      value: expect.objectContaining({
        activeConversationCount: 0,
        quarantinedConversationCount: 0
      })
    });
  });

  it('imports exported chat backups as committed snapshots that read back directly', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    assetStoreMocks.exportAssetEntries.mockResolvedValue([]);
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() });

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [{
          id: 'conversation-roundtrip',
          title: '备份回归',
          collaboratorId: 'pharos',
          messages: [{
            id: 'message-roundtrip',
            role: 'user',
            content: '不要从旧影子里恢复我',
            timestamp: 10
          }],
          pinnedAt: null,
          updatedAt: 10
        }],
        activeConversationId: 'conversation-roundtrip'
      },
      collectionState: {
        cards: [],
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards: [],
        deletedBundledCardIds: []
      },
      personaState: {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      },
      personaMemoryDocContent: {
        version: 1,
        docs: {}
      },
      runtimeState: normalizeRuntimePayload(null)
    });

    await importStructuredExportPackage(exported.blob);

    expect(currentKvKeys()).toEqual(expect.arrayContaining([
      'local-data-v1:row:chat:conversationCatalog:conversation-roundtrip',
      'local-data-v1:row:chat:conversationRecord:conversation-roundtrip',
      'local-data-v1:pointer:chat',
      'local-data-v1:active-data-source'
    ]));
    expect(currentKvKeys()).not.toContain('chat-catalog-v1');
    expect(currentKvKeys()).not.toContain('chat-commit-pointer-v1');
    expect(currentKvKeys().some((key) => key.startsWith('chat-manifest-v1:'))).toBe(false);
    expect(currentKvKeys().some((key) => key.startsWith('chat-message-v1:'))).toBe(false);
    const importedChat = await readCompleteLiveChatState();
    expect(importedChat?.activeConversationId).toBe('conversation-roundtrip');
    expect(importedChat?.conversations).toHaveLength(1);
    expect(importedChat?.conversations[0]?.id).toBe('conversation-roundtrip');
    expect(importedChat?.conversations[0]?.messages).toEqual([
      expect.objectContaining({
        id: 'message-roundtrip',
        role: 'user',
        content: '不要从旧影子里恢复我'
      })
    ]);
  });

  it('stress round-trips a production-diagnostics-shaped backup into a clean LocalData restore', async () => {
    pageLifecycleMocks.flushPageLifecycleHandlers.mockResolvedValue(undefined);
    assetStoreMocks.exportAssetEntries.mockResolvedValue([]);
    const localStorage = createLocalStorageMock({
      'polaris-space-store-v1': '{"state":{"activeCardId":"old-card"},"version":1}',
      'polaris-stale-panel-state': 'remove me',
      'outside-polaris-key': 'keep me'
    });
    vi.stubGlobal('window', { localStorage });

    kvValues.set('chat-catalog-v1', { old: true });
    kvValues.set('local-data-v1:row:chat:domainMeta:chat', { staleRepository: true });
    kvValues.set('stale-shadow-key', true);

    const productionStressPlan = deriveDiagnosticsStressPlan();
    expect(productionStressPlan.sourceShape).toMatchObject({
      activeDomains: ['collection', 'persona', 'runtime', 'space'],
      repositoryPointerCount: 7,
      repositoryRowsByDomain: {
        chat: 789,
        collection: 125,
        persona: 11,
        runtime: 62,
        document: 20,
        space: 14,
        asset: 91
      },
      storage: {
        assetMetaKeyCount: 446,
        assetBinaryKeyCount: 446,
        assetPreviewKeyCount: 281
      }
    });

    const conversationCount = productionStressPlan.conversationCount;
    const messagesPerConversation = productionStressPlan.messagesPerConversation;
    const assetEntries = Array.from({ length: productionStressPlan.assetCount }, (_, index) => {
      const isImage = index < productionStressPlan.previewAssetCount;
      const id = `stress-asset-${index}`;
      const body = `asset-${index}:` + 'x'.repeat(1024 + index * 37);
      return {
        meta: {
          id,
          kind: isImage ? 'image' as const : 'file' as const,
          name: isImage ? `${id}.png` : `${id}.txt`,
          mimeType: isImage ? 'image/png' : 'text/plain',
          size: body.length,
          createdAt: 100 + index,
          textContent: isImage ? undefined : `searchable text ${index}`
        },
        blob: new Blob([body], { type: isImage ? 'image/png' : 'text/plain' }),
        previewBlob: isImage ? new Blob([`preview-${index}`], { type: 'image/jpeg' }) : null
      };
    });
    const conversations = Array.from({ length: conversationCount }, (_, conversationIndex) => {
      const assetId = assetEntries[conversationIndex % assetEntries.length]!.meta.id;
      return {
        id: `stress-conversation-${conversationIndex}`,
        title: `Stress Conversation ${conversationIndex}`,
        collaboratorId: `persona-stress-${conversationIndex % 3}`,
        activeProjectId: 'project-stress',
        messages: Array.from({ length: messagesPerConversation }, (_, messageIndex) => ({
          id: `stress-message-${conversationIndex}-${messageIndex}`,
          role: messageIndex % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: [
            `conversation ${conversationIndex} message ${messageIndex}`,
            'body '.repeat(40),
            messageIndex % 5 === 0 ? `polaris-asset://${assetId}` : ''
          ].join('\n'),
          timestamp: 1_000 + conversationIndex * 100 + messageIndex,
          attachments: messageIndex === 0
            ? [{
                id: `attachment-${conversationIndex}`,
                assetId,
                kind: assetEntries[conversationIndex % assetEntries.length]!.meta.kind,
                name: assetEntries[conversationIndex % assetEntries.length]!.meta.name,
                mimeType: assetEntries[conversationIndex % assetEntries.length]!.meta.mimeType,
                size: assetEntries[conversationIndex % assetEntries.length]!.meta.size
              }]
            : undefined
        })),
        pinnedAt: conversationIndex % 4 === 0 ? 2_000 + conversationIndex : null,
        updatedAt: 10_000 + conversationIndex
      };
    });
    const personaDocBaseCount = Math.floor(
      productionStressPlan.personaReferenceDocCount / productionStressPlan.personaCount
    );
    const personaDocExtraCount = productionStressPlan.personaReferenceDocCount % productionStressPlan.personaCount;
    const personas = Array.from({ length: productionStressPlan.personaCount }, (_, personaIndex) => {
      const docCount = personaDocBaseCount + (personaIndex < personaDocExtraCount ? 1 : 0);
      return createPersonaTemplate({
        id: `persona-stress-${personaIndex}`,
        name: `Stress Persona ${personaIndex}`,
        description: 'stress import owner',
        memory: {
          referenceDocs: Array.from({ length: docCount }, (_, docIndex) => {
            const content = `persona ${personaIndex} doc ${docIndex}\n` + 'synthetic memory body '.repeat(20);
            return {
              id: `doc-${docIndex}`,
              title: `Persona doc ${docIndex}`,
              summary: `summary ${docIndex}`,
              content,
              charCount: content.length,
              contentLoaded: true,
              source: 'upload' as const,
              updatedAt: 4_000 + personaIndex * 10 + docIndex
            };
          })
        }
      });
    });
    const workspaceDocs: [] = [];
    const progressEvents: Array<{ message: string; current?: number; total?: number }> = [];

    const exported = await buildStructuredExportPackage({
      spaceState: {
        activeCardId: 'card-stress-3',
        collectionProjectId: 'project-stress'
      },
      chatState: {
        conversations,
        activeConversationId: `stress-conversation-${conversationCount - 1}`
      },
      collectionState: {
        cards: Array.from({ length: productionStressPlan.codeCardCount }, (_, index) => ({
          id: `card-stress-${index}`,
          title: `Card ${index}`,
          language: 'tsx',
          code: `export const value${index} = "polaris-asset://${assetEntries[index]!.meta.id}";`,
          tags: ['stress'],
          source: 'manual' as const,
          createdAt: 2_000 + index,
          updatedAt: 2_100 + index,
          ownerCollaboratorId: `persona-stress-${index % 3}`
        })),
        projectFiles: Array.from({ length: productionStressPlan.projectFileCount }, (_, index) => ({
          id: `project-file-stress-${index}`,
          projectId: 'project-stress',
          filePath: `src/file-${index}.tsx`,
          language: 'tsx',
          content: `export function file${index}() { return "polaris-asset://${assetEntries[index + 3]!.meta.id}"; }\n` + 'component body\n'.repeat(80),
          source: 'manual' as const,
          createdAt: 2_200 + index,
          updatedAt: 2_300 + index
        })),
        workspaceReferenceDocs: workspaceDocs,
        roomProjects: [{
          id: 'project-stress',
          title: 'Stress Project',
          slug: 'stress-project',
          fileIds: Array.from({ length: productionStressPlan.projectFileCount }, (_, index) => `project-file-stress-${index}`),
          tags: ['stress'],
          source: 'manual' as const,
          createdAt: 2_500,
          updatedAt: 2_600,
          pinnedAt: null
        }],
        imageCards: assetEntries
          .filter((entry) => entry.meta.kind === 'image')
          .slice(0, productionStressPlan.imageCardCount)
          .map((entry, index) => ({
            id: `image-card-stress-${index}`,
            title: `Image ${index}`,
            assetId: entry.meta.id,
            tags: ['stress'],
            source: 'manual' as const,
            createdAt: 2_700 + index,
            updatedAt: 2_800 + index
          })),
        deletedBundledCardIds: []
      },
      personaState: {
        personas,
        activeCollaboratorId: 'persona-stress-2',
        seededDefaultPersonaIds: []
      },
      personaMemoryDocContent: {
        version: 1,
        docs: {}
      },
      runtimeState: normalizeRuntimePayload(null),
      assetEntries
    }, {
      onProgress: (event) => progressEvents.push(event)
    });

    await importStructuredExportPackage(exported.blob, {
      onProgress: (event) => progressEvents.push(event)
    });

    const importedChat = await readCompleteLiveChatState();
    expect(importedChat?.activeConversationId).toBe(`stress-conversation-${conversationCount - 1}`);
    expect(importedChat?.conversations).toHaveLength(conversationCount);
    expect(importedChat?.conversations.find((conversation) => conversation.id === 'stress-conversation-7')?.messages)
      .toHaveLength(messagesPerConversation);
    expect(importedChat?.conversations.find((conversation) => conversation.id === 'stress-conversation-7')?.messages[0])
      .toMatchObject({
        id: 'stress-message-7-0',
        attachments: [expect.objectContaining({ assetId: 'stress-asset-7' })]
      });

    expect(currentKvKeys()).toEqual(expect.arrayContaining([
      'local-data-v1:active-data-source',
      'local-data-v1:pointer:chat',
      'local-data-v1:pointer:collection',
      'local-data-v1:pointer:persona',
      'local-data-v1:pointer:runtime',
      'local-data-v1:pointer:space',
      'local-data-v1:pointer:document',
      'local-data-v1:pointer:asset',
      `local-data-v1:row:chat:conversationCatalog:stress-conversation-${conversationCount - 1}`,
      `local-data-v1:row:chat:conversationRecord:stress-conversation-${conversationCount - 1}`,
      'local-data-v1:row:collection:card:card-stress-4',
      'local-data-v1:row:collection:image-card:image-card-stress-1',
      'local-data-v1:row:collection:project:project-stress',
      'local-data-v1:row:persona:collaborator:persona-stress-9',
      'local-data-v1:row:document:persona-memory-doc:persona-stress-8:doc-1',
      `local-data-v1:row:asset:asset:stress-asset-${assetEntries.length - 1}`
    ]));
    expect(currentKvKeys()).toContain('chat-catalog-v1');
    expect(currentKvKeys()).toContain('stale-shadow-key');
    expect(currentKvValue('local-data-v1:row:chat:domainMeta:chat')).not.toMatchObject({ staleRepository: true });
    const expectedRepositoryRowsByDomain = {
      asset: 1 + assetEntries.length,
      chat: productionStressPlan.sourceShape.repositoryRowsByDomain.chat,
      collection: productionStressPlan.sourceShape.repositoryRowsByDomain.collection,
      document: productionStressPlan.sourceShape.repositoryRowsByDomain.document,
      persona: productionStressPlan.sourceShape.repositoryRowsByDomain.persona,
      runtime: 3,
      space: 4
    };
    expect(currentLocalDataDiagnosticShape()).toMatchObject({
      activeDataSource: 'repository',
      activeDataSourceRowPresent: true,
      activeDomainCount: 7,
      activeDomains: ['asset', 'chat', 'collection', 'document', 'persona', 'runtime', 'space'],
      repositoryPointerCount: 7,
      repositoryRowsByDomain: expectedRepositoryRowsByDomain,
      repositoryRowCount: Object.values(expectedRepositoryRowsByDomain).reduce((sum, count) => sum + count, 0),
      nonRepositoryKvKeyCount: 2
    });
    expect(readSpaceLocalStorageState(localStorage)).toMatchObject({
      state: { activeCardId: 'card-stress-3' },
      version: SPACE_STORE_VERSION
    });
    expect(localStorage.entries()).toContainEqual(['outside-polaris-key', 'keep me']);
    expect(localStorage.entries()).toContainEqual(['polaris-stale-panel-state', 'remove me']);

    const lastAssetEntry = assetEntries[assetEntries.length - 1]!;
    const assetRow = currentKvValue<Record<string, unknown>>(`local-data-v1:row:asset:asset:${lastAssetEntry.meta.id}`);
    expect(assetRow).toMatchObject({
      state: 'complete',
      value: expect.objectContaining({
        hasMeta: true,
        hasBinary: true,
        binaryBytes: lastAssetEntry.blob.size
      })
    });
    expect(getDbStore(persistenceMocks.ASSET_BINARY_STORE)).toHaveLength(
      productionStressPlan.sourceShape.storage.assetBinaryKeyCount
    );
    // Imported asset metadata is structured LocalData truth. The blob substrate only owns
    // staged/live bytes and must not grow a second metadata repository.
    expect(getDbStore(persistenceMocks.ASSET_META_STORE)).toHaveLength(0);
    expect(getDbStore(persistenceMocks.ASSET_PREVIEW_STORE)).toHaveLength(
      productionStressPlan.sourceShape.storage.assetPreviewKeyCount
    );
    expect(progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: '整理附件', current: assetEntries.length, total: assetEntries.length }),
      expect.objectContaining({ message: '读取附件', current: assetEntries.length, total: assetEntries.length }),
      expect.objectContaining({ message: '写入附件', current: assetEntries.length, total: assetEntries.length })
    ]));
    expect(importApplyMocks.applyImportedPersistedStores).toHaveBeenCalledTimes(1);
  });
});
