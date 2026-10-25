import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildStructuredExportPackage,
  EXPORT_REPORT_PATH,
  PERSONA_MEMORY_DOC_CONTENT_PATH,
  streamStructuredExportPackageEntries
} from './storeExportPackage';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import { writeChatStateToLocalDataRepository } from './chat/snapshotWrite';
import {
  buildCollectionLocalDataUnitOfWork,
  buildPersonaLocalDataUnitOfWork,
  buildRuntimeLocalDataUnitOfWork,
  createLocalDataKvBackend,
  createLocalDataRepository,
  getLocalDataActiveDataSourceKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type LocalDataActiveDataSourceRow,
  type LocalDataCommitMeta
} from '../engines/localData';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import {
  ASSET_BINARY_STORE,
  ASSET_META_STORE,
  ASSET_PREVIEW_STORE,
  KV_STORE,
  kvSet,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistenceBackend
} from '../infrastructure/persistence';
import { DEFAULT_PROVIDER } from './runtimeStoreProviders';
import type { RuntimePayload } from './runtimeStorePersistence';
import type { WorkspaceReferenceDoc } from '../types/domain';

function createMemoryPersistenceBackend(initialKv: Array<[string, unknown]> = []): PersistenceBackend {
  const stores = new Map<string, Map<string, unknown>>([
    [KV_STORE, new Map(initialKv)],
    [ASSET_BINARY_STORE, new Map()],
    [ASSET_META_STORE, new Map()],
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
    async dbStoreGet(storeName, key) {
      return (getStore(storeName).get(key) ?? null) as never;
    },
    async dbStoreSet(storeName, key, value) {
      getStore(storeName).set(key, value);
    },
    async dbStoreDelete(storeName, key) {
      getStore(storeName).delete(key);
    },
    async dbStoreEntries<T>(storeName: string) {
      return [...getStore(storeName).entries()].map(([key, value]) => ({ key, value: value as T })) satisfies PersistedDbEntry<T>[];
    },
    async dbStoreClear(storeName) {
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

describe('storeExportPackage', () => {
  afterEach(() => {
    setPersistenceBackendForTesting(null);
  });

  it('exports active LocalData persona and runtime rows instead of stale legacy KV', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend([
      ['persona-state-v2', {
        personas: [createPersonaTemplate({ id: 'persona-legacy', name: 'Legacy', description: '' })],
        activeCollaboratorId: 'persona-legacy',
        seededDefaultPersonaIds: []
      }],
      ['runtime-providers-v2', runtimePayload('provider-legacy')]
    ]));
    await promotePersonaAndRuntimeForExport({
      personas: [createPersonaTemplate({ id: 'persona-repository', name: 'Repository', description: '' })],
      activeCollaboratorId: 'persona-repository',
      runtime: runtimePayload('provider-repository')
    });

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
      },
      collectionState: {
        cards: [],
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards: [],
        deletedBundledCardIds: []
      },
      personaMemoryDocContent: {
        version: 1,
        docs: {}
      },
      assetEntries: []
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const personaState = JSON.parse(await zip.file('stores/persona.json')!.async('string'));
    const runtimeState = JSON.parse(await zip.file('stores/runtime.json')!.async('string'));

    expect(personaState.activeCollaboratorId).toBe('persona-repository');
    expect(personaState.personas.map((persona: { id: string }) => persona.id)).toEqual(['persona-repository']);
    expect(runtimeState.activeProviderId).toBe('provider-repository');
    expect(runtimeState.providers.map((provider: { id: string }) => provider.id)).toEqual(['provider-repository']);
  });

  it('exports active LocalData persona memory docs without scanning stale legacy doc chunks', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend([
      ['persona-memory-doc-content-v3:stale:broken:1', 'orphan tail']
    ]));
    await promotePersonaAndRuntimeForExport({
      personas: [createPersonaTemplate({
        id: 'persona-repository',
        name: 'Repository',
        description: '',
        memory: {
          inheritGlobal: true,
          excludedGlobalIds: [],
          personalMemories: [],
          referenceDocs: [{
            id: 'doc-1',
            title: 'Repository doc',
            summary: '',
            content: 'repository body',
            charCount: 'repository body'.length,
            contentLoaded: true,
            source: 'user',
            updatedAt: 1
          }]
        }
      })],
      activeCollaboratorId: 'persona-repository',
      runtime: runtimePayload('provider-repository')
    });

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
      },
      collectionState: {
        cards: [],
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards: [],
        deletedBundledCardIds: []
      },
      assetEntries: []
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const memoryDocContent = JSON.parse(await zip.file(PERSONA_MEMORY_DOC_CONTENT_PATH)!.async('string'));

    expect(memoryDocContent.docs['persona-repository:doc-1']).toBe('repository body');
    expect(memoryDocContent.docs['stale:broken']).toBeUndefined();
  });

  it('exports active LocalData workspace docs without scanning stale workspace chunks', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend([
      ['workspace-reference-doc-content-v2:stale-workspace-doc:1', 'orphan tail']
    ]));
    await promoteCollectionForExport({
      workspaceReferenceDocs: [{
        id: 'workspace-doc-1',
        projectId: 'project-1',
        ownerCollaboratorId: 'persona-repository',
        title: 'Workspace doc',
        summary: '',
        content: 'workspace body',
        charCount: 'workspace body'.length,
        contentLoaded: true,
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
      runtimeState: normalizeRuntimePayload(null),
      assetEntries: []
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const collectionState = JSON.parse(await zip.file('stores/collection.json')!.async('string'));

    expect(collectionState.workspaceReferenceDocs[0].content).toBe('workspace body');
    expect(collectionState.workspaceReferenceDocs[0].contentLoaded).toBe(true);
  });

  it('exports persona memory document bodies outside the persona store file', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
        personas: [{
          id: 'persona-1',
          name: 'A',
          description: '',
          memory: {
            inheritGlobal: true,
            excludedGlobalIds: [],
            personalMemories: [],
            referenceDocs: [{
              id: 'doc-1',
              title: 'Long doc',
              summary: 'summary',
              content: 'new loaded body',
              charCount: 10,
              contentLoaded: true,
              source: 'upload',
              updatedAt: 1
            }]
          }
        } as never],
        activeCollaboratorId: 'persona-1',
        seededDefaultPersonaIds: []
      },
      personaMemoryDocContent: {
        version: 1,
        docs: {
          'persona-1:doc-1': 'large body'
        }
      },
      runtimeState: normalizeRuntimePayload(null)
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const personaState = JSON.parse(await zip.file('stores/persona.json')!.async('string'));
    const memoryDocContent = JSON.parse(await zip.file(PERSONA_MEMORY_DOC_CONTENT_PATH)!.async('string'));

    expect(manifest.stores.personaMemoryDocContent).toBe(PERSONA_MEMORY_DOC_CONTENT_PATH);
    expect(personaState.personas[0].memory.referenceDocs[0].content).toBe('');
    expect(memoryDocContent.docs['persona-1:doc-1']).toBe('new loaded body');
  });

  it('exports complete inactive conversation bodies from persisted chat storage', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend([
      ['runtime-providers-v2', normalizeRuntimePayload(null)],
      ['persona-state-v2', {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      }]
    ]));
    await writeChatStateToLocalDataRepository({
      conversations: [
        {
          id: 'c-active',
          title: '当前对话',
          kind: 'direct',
          collaboratorId: 'pharos',
          activeProjectId: null,
          draft: '',
          pinnedAt: null,
          updatedAt: 2,
          messages: [{ id: 'm-active', role: 'user', content: '当前正文', timestamp: 2 }]
        },
        {
          id: 'c-inactive',
          title: '旧对话',
          kind: 'direct',
          collaboratorId: 'pharos',
          activeProjectId: null,
          draft: '',
          pinnedAt: null,
          updatedAt: 1,
          messages: [{ id: 'm-inactive', role: 'user', content: '旧正文不能因为懒加载导出成空', timestamp: 1 }]
        }
      ],
      activeConversationId: 'c-active'
    }, 'active');

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      collectionState: {
        cards: [],
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards: [],
        deletedBundledCardIds: []
      },
      personaMemoryDocContent: {
        version: 1,
        docs: {}
      }
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const chatState = JSON.parse(await zip.file('stores/chat.json')!.async('string'));

    expect(chatState.conversations.find((conversation: { id: string }) => conversation.id === 'c-inactive')?.messages).toEqual([
      expect.objectContaining({
        id: 'm-inactive',
        content: '旧正文不能因为懒加载导出成空'
      })
    ]);
  });

  it('fails export instead of packaging empty chat when chat persistence cannot be read', async () => {
    const backend = createMemoryPersistenceBackend([
      ['runtime-providers-v2', normalizeRuntimePayload(null)],
      ['persona-state-v2', {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      }]
    ]);
    const readError = new Error('chat storage unavailable');
    backend.dbStoreGet = vi.fn(async (_storeName: string, key: string) => {
      if (key.includes('chat')) {
        throw readError;
      }
      return null;
    }) as PersistenceBackend['dbStoreGet'];
    setPersistenceBackendForTesting(backend);

    await expect(buildStructuredExportPackage({
      spaceState: {},
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
    })).rejects.toBe(readError);
  });

  it('does not read legacy collection KV while exporting a current-source snapshot', async () => {
    const backend = createMemoryPersistenceBackend([
      ['runtime-providers-v2', normalizeRuntimePayload(null)],
      ['persona-state-v2', {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      }]
    ]);
    const readError = new Error('collection storage unavailable');
    backend.dbStoreGet = vi.fn(async (_storeName: string, key: string) => {
      if (key.startsWith('collection-state-')) {
        throw readError;
      }
      return null;
    }) as PersistenceBackend['dbStoreGet'];
    setPersistenceBackendForTesting(backend);

    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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

    expect(exported.fileName).toMatch(/^polaris-export-/);
    expect(backend.dbStoreGet).not.toHaveBeenCalledWith('kv', 'collection-state-v2');
  });

  it('can package asset entries supplied by an external adapter', async () => {
    const exported = await buildStructuredExportPackage({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
      runtimeState: normalizeRuntimePayload(null),
      assetEntries: [{
        meta: {
          id: 'kelivo-avatar',
          kind: 'image',
          name: 'avatar.png',
          mimeType: 'image/png',
          size: 3,
          createdAt: 1
        },
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        previewBlob: null
      }]
    });

    const zip = await JSZip.loadAsync(await exported.blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const assetIndex = JSON.parse(await zip.file('assets/index.json')!.async('string'));

    expect(manifest.assets).toMatchObject({
      count: 1,
      imageCount: 1,
      attachmentCount: 0
    });
    expect(assetIndex[0]).toMatchObject({
      id: 'kelivo-avatar',
      filePath: 'assets/images/kelivo-avatar.png',
      previewPath: 'previews/images/kelivo-avatar.jpg'
    });
    await expect(zip.file('assets/images/kelivo-avatar.png')!.async('uint8array')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('streams persisted assets with a report instead of aborting on broken asset rows', async () => {
    const backend = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(backend);
    await backend.dbStoreSet(ASSET_META_STORE, 'asset-preview-only', {
      id: 'asset-preview-only',
      kind: 'image',
      name: 'preview-only.png',
      mimeType: 'image/png',
      size: 99,
      createdAt: 1
    });
    await backend.dbStoreSet(
      ASSET_PREVIEW_STORE,
      'asset-preview-only',
      new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' })
    );
    await backend.dbStoreSet(ASSET_META_STORE, 'asset-missing', {
      id: 'asset-missing',
      kind: 'image',
      name: 'missing.png',
      mimeType: 'image/png',
      size: 4,
      createdAt: 2
    });

    const textEntries = new Map<string, string>();
    const binaryEntries = new Map<string, Blob>();
    const result = await streamStructuredExportPackageEntries({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
    }, {
      onTextEntry: async (path, text) => {
        textEntries.set(path, text);
      },
      onBinaryEntry: async (path, blob) => {
        binaryEntries.set(path, blob);
      }
    });

    const assetIndex = JSON.parse(textEntries.get('assets/index.json') ?? '[]');
    const report = JSON.parse(textEntries.get(EXPORT_REPORT_PATH) ?? '{}');

    expect(result.report.assets).toMatchObject({
      indexed: 2,
      exported: 1,
      skipped: 1,
      degraded: 1
    });
    expect(assetIndex).toEqual([
      expect.objectContaining({
        id: 'asset-preview-only',
        size: 3,
        mimeType: 'image/jpeg',
        filePath: 'assets/images/asset-preview-only.png',
        previewPath: 'previews/images/asset-preview-only.jpg'
      })
    ]);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        kind: 'asset-preview-fallback',
        assetId: 'asset-preview-only'
      }),
      expect.objectContaining({
        severity: 'error',
        kind: 'asset-missing-binary',
        assetId: 'asset-missing'
      })
    ]));
    expect(new Uint8Array(await binaryEntries.get('assets/images/asset-preview-only.png')!.arrayBuffer()))
      .toEqual(new Uint8Array([9, 8, 7]));
    expect(binaryEntries.has('assets/images/asset-missing.png')).toBe(false);
  });

  it('lets native Android export persisted asset binaries without reading blobs into JavaScript', async () => {
    const backend = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(backend);
    await backend.dbStoreSet(ASSET_META_STORE, 'asset-native', {
      id: 'asset-native',
      kind: 'image',
      name: 'native.png',
      mimeType: 'image/png',
      size: 150_000_000,
      createdAt: 1
    });

    const textEntries = new Map<string, string>();
    const binaryEntries = new Map<string, Blob>();
    const storedEntries: Array<{ storeName: string; key: string; path: string }> = [];
    const result = await streamStructuredExportPackageEntries({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
    }, {
      onTextEntry: async (path, text) => {
        textEntries.set(path, text);
      },
      onBinaryEntry: async (path, blob) => {
        binaryEntries.set(path, blob);
      },
      onStoredBinaryEntry: async (storeName, key, path) => {
        storedEntries.push({ storeName, key, path });
        return true;
      }
    });

    const assetIndex = JSON.parse(textEntries.get('assets/index.json') ?? '[]');

    expect(result.report.assets).toMatchObject({
      indexed: 1,
      exported: 1,
      skipped: 0,
      degraded: 0
    });
    expect(assetIndex).toEqual([
      expect.objectContaining({
        id: 'asset-native',
        filePath: 'assets/images/asset-native.png',
        previewPath: 'previews/images/asset-native.jpg'
      })
    ]);
    expect(storedEntries).toEqual([
      { storeName: ASSET_BINARY_STORE, key: 'asset-native', path: 'assets/images/asset-native.png' },
      { storeName: ASSET_PREVIEW_STORE, key: 'asset-native', path: 'previews/images/asset-native.jpg' }
    ]);
    expect(binaryEntries.size).toBe(0);
  });

  it('can avoid reading large persisted image blobs and export the preview fallback', async () => {
    const backend = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(backend);
    await backend.dbStoreSet(ASSET_META_STORE, 'asset-large-image', {
      id: 'asset-large-image',
      kind: 'image',
      name: 'large.png',
      mimeType: 'image/png',
      size: 150_000_000,
      createdAt: 1
    });
    await backend.dbStoreSet(ASSET_BINARY_STORE, 'asset-large-image', new Blob([new Uint8Array([1, 2, 3])]));
    await backend.dbStoreSet(ASSET_PREVIEW_STORE, 'asset-large-image', new Blob([new Uint8Array([9, 8, 7])]));

    const textEntries = new Map<string, string>();
    const binaryEntries = new Map<string, Blob>();
    const result = await streamStructuredExportPackageEntries({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
    }, {
      onTextEntry: async (path, text) => {
        textEntries.set(path, text);
      },
      onBinaryEntry: async (path, blob) => {
        binaryEntries.set(path, blob);
      },
      onStoredBinaryEntry: async () => false,
      onShouldReadPersistedAssetBlob: (_asset, role) => role === 'preview'
    });

    const report = JSON.parse(textEntries.get(EXPORT_REPORT_PATH) ?? '{}');

    expect(result.report.assets).toMatchObject({
      indexed: 1,
      exported: 1,
      skipped: 0,
      degraded: 1
    });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        kind: 'asset-preview-fallback',
        assetId: 'asset-large-image'
      })
    ]));
    expect(new Uint8Array(await binaryEntries.get('assets/images/asset-large-image.png')!.arrayBuffer()))
      .toEqual(new Uint8Array([9, 8, 7]));
  });

  it('reports large persisted files instead of reading unsafe bridge fallbacks', async () => {
    const backend = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(backend);
    await backend.dbStoreSet(ASSET_META_STORE, 'asset-large-file', {
      id: 'asset-large-file',
      kind: 'file',
      name: 'large.bin',
      mimeType: 'application/octet-stream',
      size: 150_000_000,
      createdAt: 1
    });
    await backend.dbStoreSet(ASSET_BINARY_STORE, 'asset-large-file', new Blob([new Uint8Array([1, 2, 3])]));

    const textEntries = new Map<string, string>();
    const binaryEntries = new Map<string, Blob>();
    const result = await streamStructuredExportPackageEntries({
      spaceState: {},
      chatState: {
        conversations: [],
        activeConversationId: null
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
    }, {
      onTextEntry: async (path, text) => {
        textEntries.set(path, text);
      },
      onBinaryEntry: async (path, blob) => {
        binaryEntries.set(path, blob);
      },
      onStoredBinaryEntry: async () => false,
      onShouldReadPersistedAssetBlob: () => false
    });

    const report = JSON.parse(textEntries.get(EXPORT_REPORT_PATH) ?? '{}');

    expect(result.report.assets).toMatchObject({
      indexed: 1,
      exported: 0,
      skipped: 1,
      degraded: 0
    });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        kind: 'asset-bridge-fallback-too-large',
        assetId: 'asset-large-file'
      })
    ]));
    expect(binaryEntries.size).toBe(0);
  });
});

function runtimePayload(providerId: string): RuntimePayload {
  return normalizeRuntimePayload({
    providers: [{
      ...DEFAULT_PROVIDER,
      id: providerId,
      name: providerId,
      baseUrl: 'https://api.example.com',
      model: 'model-a'
    }],
    activeProviderId: providerId
  });
}

async function promotePersonaAndRuntimeForExport(args: {
  personas: ReturnType<typeof createPersonaTemplate>[];
  activeCollaboratorId: string | null;
  runtime: RuntimePayload;
}) {
  const personaRepository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 100,
    createCommitId: () => 'persona:export-test'
  });
  const personaMeta = await personaRepository.commit(buildPersonaLocalDataUnitOfWork({
    state: {
      personas: args.personas,
      activeCollaboratorId: args.activeCollaboratorId,
      seededDefaultPersonaIds: []
    },
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 100
  }));

  const runtimeRepository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 101,
    createCommitId: () => 'runtime:export-test'
  });
  const runtimeMeta = await runtimeRepository.commit(buildRuntimeLocalDataUnitOfWork({
    state: args.runtime,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 101
  }));

  await kvSet(getLocalDataActiveDataSourceKey(), activeSourceRow({
    personaMeta,
    runtimeMeta
  }));
}

async function promoteCollectionForExport(args: {
  workspaceReferenceDocs: WorkspaceReferenceDoc[];
}) {
  const collectionRepository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 102,
    createCommitId: () => 'collection:export-test'
  });
  const collectionMeta = await collectionRepository.commit(buildCollectionLocalDataUnitOfWork({
    activeProjectId: null,
    state: {
      cards: [],
      projectFiles: [],
      workspaceReferenceDocs: args.workspaceReferenceDocs,
      roomProjects: [],
      imageCards: [],
      deletedBundledCardIds: []
    },
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 102
  }));

  await kvSet(getLocalDataActiveDataSourceKey(), activeSourceRow({
    collectionMeta
  }));
}

function activeSourceRow(args: {
  collectionMeta?: LocalDataCommitMeta;
  personaMeta?: LocalDataCommitMeta;
  runtimeMeta?: LocalDataCommitMeta;
}): LocalDataActiveDataSourceRow {
  const committedAt = args.runtimeMeta?.committedAt ?? args.collectionMeta?.committedAt ?? args.personaMeta?.committedAt ?? 0;
  const commitId = args.runtimeMeta?.commitId ?? args.collectionMeta?.commitId ?? args.personaMeta?.commitId ?? null;
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataActiveDataSourceKey(),
    activeDataSource: 'repository',
    activeCommitId: commitId,
    stagingCommitId: null,
    updatedAt: committedAt,
    domains: {
      ...(args.collectionMeta ? {
        collection: {
          domain: 'collection',
          version: args.collectionMeta.version,
          committedAt: args.collectionMeta.committedAt,
          commitId: args.collectionMeta.commitId
        }
      } : {}),
      ...(args.personaMeta ? { persona: {
        domain: 'persona',
        version: args.personaMeta.version,
        committedAt: args.personaMeta.committedAt,
        commitId: args.personaMeta.commitId
      } } : {}),
      ...(args.runtimeMeta ? { runtime: {
        domain: 'runtime',
        version: args.runtimeMeta.version,
        committedAt: args.runtimeMeta.committedAt,
        commitId: args.runtimeMeta.commitId
      } } : {})
    }
  };
}
