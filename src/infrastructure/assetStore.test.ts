import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from '../stores/storeLocalDataBackendHost';

const persistenceMocks = vi.hoisted(() => ({
  dbStoreClear: vi.fn(),
  dbStoreDelete: vi.fn(),
  dbStoreEntries: vi.fn(),
  dbStoreEntrySizes: vi.fn(),
  dbStoreGet: vi.fn(),
  dbStoreKeys: vi.fn(),
  dbStoreSet: vi.fn(),
  kvGet: vi.fn(),
  kvKeysWithPrefix: vi.fn()
}));

const assetPersistenceContracts = [
  {
    name: 'IndexedDB object storage',
    persist(value: unknown) {
      return value;
    }
  },
  {
    name: 'native JSON/binary bridge storage',
    persist(value: unknown) {
      if (value instanceof Blob) return value.slice(0, value.size, value.type);
      return JSON.parse(JSON.stringify(value)) as unknown;
    }
  }
] as const;

vi.mock('./persistence', () => ({
  ASSET_IMPORT_STAGE_STORE: 'asset-import-stage',
  ASSET_BINARY_STORE: 'asset-binary',
  ASSET_META_STORE: 'asset-meta',
  ASSET_PREVIEW_STORE: 'asset-preview',
  dbStoreClear: persistenceMocks.dbStoreClear,
  dbStoreDelete: persistenceMocks.dbStoreDelete,
  dbStoreEntries: persistenceMocks.dbStoreEntries,
  dbStoreEntrySizes: persistenceMocks.dbStoreEntrySizes,
  dbStoreGet: persistenceMocks.dbStoreGet,
  dbStoreKeys: persistenceMocks.dbStoreKeys,
  dbStoreSet: persistenceMocks.dbStoreSet,
  kvGet: persistenceMocks.kvGet,
  kvKeysWithPrefix: persistenceMocks.kvKeysWithPrefix
}));

afterEach(() => {
  vi.unstubAllGlobals();
  Object.values(persistenceMocks).forEach((mock) => mock.mockReset());
  resetStoreLocalDataBackendForTesting();
});

describe('assetStore', () => {
  beforeEach(() => {
    // These unit tests exercise the legacy blob-store surface of an install where LocalData is NOT the
    // active asset source. A preexisting legacy entry keeps an ordinary save on the legacy stores and
    // declines self-activation (fresh-install first-write self-activation is covered against a real
    // backend in assetLocalDataPersistence.test.ts).
    persistenceMocks.kvGet.mockResolvedValue(null);
    persistenceMocks.dbStoreKeys.mockResolvedValue(['asset-legacy']);
    // The asset active-source check now reads through the store backend host; install an inactive
    // backend so it reports "LocalData inactive" without constructing a KV backend against the
    // partial persistence mock.
    installStoreLocalDataBackend({
      mode: 'transactional',
      read: async () => null,
      listKeysWithPrefix: async () => [],
      commitAtomic: async () => {}
    });
  });

  it('writes asset metadata only after binary and preview data are stored', async () => {
    const calls: string[] = [];
    persistenceMocks.dbStoreSet.mockImplementation(async (storeName: string) => {
      calls.push(`set:${storeName}`);
    });

    const { saveAsset } = await import('./assetStore');
    await saveAsset({
      id: 'asset-1',
      kind: 'image',
      name: 'image.png',
      mimeType: 'image/png',
      blob: new Blob(['image']),
      previewBlob: new Blob(['preview'])
    });

    expect(calls).toEqual([
      'set:asset-binary',
      'set:asset-preview',
      'set:asset-meta'
    ]);
  });

  it('does not publish metadata when binary storage fails', async () => {
    persistenceMocks.dbStoreSet.mockImplementation(async (storeName: string) => {
      if (storeName === 'asset-binary') {
        throw new Error('binary failed');
      }
    });

    const { saveAsset } = await import('./assetStore');
    await expect(saveAsset({
      id: 'asset-1',
      kind: 'file',
      name: 'note.txt',
      mimeType: 'text/plain',
      blob: new Blob(['note'])
    })).rejects.toThrow('binary failed');

    expect(persistenceMocks.dbStoreSet).not.toHaveBeenCalledWith(
      'asset-meta',
      expect.any(String),
      expect.anything()
    );
  });

  it('decodes legacy asset snapshots before clearing current asset stores', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('bad data url');
    }));

    const { replaceAssetSnapshot } = await import('./assetStore');
    await expect(replaceAssetSnapshot([{
      id: 'asset-1',
      kind: 'image',
      name: 'broken.png',
      mimeType: 'image/png',
      size: 0,
      createdAt: 1,
      dataUrl: 'data:image/png;base64,broken'
    }])).rejects.toThrow('bad data url');

    expect(persistenceMocks.dbStoreClear).not.toHaveBeenCalled();
  });

  it('writes replacement assets as stable cache entries without clearing or switching active truth', async () => {
    const calls: string[] = [];
    persistenceMocks.kvGet.mockResolvedValue(null);
    persistenceMocks.dbStoreSet.mockImplementation(async (storeName: string, key: string) => {
      calls.push(`set:${storeName}:${key}`);
    });
    persistenceMocks.dbStoreDelete.mockImplementation(async (storeName: string, key: string) => {
      calls.push(`delete:${storeName}:${key}`);
    });

    const { replaceAssetEntries } = await import('./assetStore');
    await replaceAssetEntries([{
      meta: {
        id: 'asset-new',
        kind: 'image',
        name: 'new.png',
        mimeType: 'image/png',
        size: 3,
        createdAt: 1
      },
      blob: new Blob(['new']),
      previewBlob: null
    }]);

    expect(persistenceMocks.dbStoreClear).not.toHaveBeenCalled();
    const binaryCallIndex = calls.findIndex((call) => call === 'set:asset-binary:asset-new');
    const metaCallIndex = calls.findIndex((call) => call === 'set:asset-meta:asset-new');
    expect(binaryCallIndex).toBeGreaterThanOrEqual(0);
    expect(metaCallIndex).toBeGreaterThan(binaryCallIndex);
    expect(calls.some((call) => call.startsWith('kv:'))).toBe(false);
  });

  it('does not publish replacement metadata when binary cache write fails', async () => {
    persistenceMocks.kvGet.mockResolvedValue(null);
    persistenceMocks.dbStoreSet.mockImplementation(async (storeName: string) => {
      if (storeName === 'asset-binary') {
        throw new Error('binary failed');
      }
    });

    const { replaceAssetEntries } = await import('./assetStore');
    await expect(replaceAssetEntries([{
      meta: {
        id: 'asset-new',
        kind: 'file',
        name: 'new.txt',
        mimeType: 'text/plain',
        size: 3,
        createdAt: 1
      },
      blob: new Blob(['new']),
      previewBlob: null
    }])).rejects.toThrow('binary failed');

    expect(persistenceMocks.dbStoreClear).not.toHaveBeenCalled();
    expect(persistenceMocks.dbStoreSet).not.toHaveBeenCalledWith(
      'asset-meta',
      expect.any(String),
      expect.anything()
    );
  });

  it.each(assetPersistenceContracts)('abandons a partially written durable stage after simulated $name process loss', async ({ persist }) => {
    const stores = new Map<string, Map<string, unknown>>([
      ['asset-binary', new Map([['asset-old', new Blob(['old'])]])],
      ['asset-meta', new Map([['asset-old', {
        id: 'asset-old', kind: 'file', name: 'old.txt', mimeType: 'text/plain', size: 3, createdAt: 1
      }]])],
      ['asset-preview', new Map()],
      ['asset-import-stage', new Map()]
    ]);
    const store = (name: string) => stores.get(name)!;
    persistenceMocks.dbStoreGet.mockImplementation(async (name: string, key: string) => store(name).get(key) ?? null);
    persistenceMocks.dbStoreKeys.mockImplementation(async (name: string) => Array.from(store(name).keys()));
    persistenceMocks.dbStoreDelete.mockImplementation(async (name: string, key: string) => {
      store(name).delete(key);
    });
    persistenceMocks.dbStoreSet.mockImplementation(async (name: string, key: string, value: unknown) => {
      store(name).set(key, persist(value));
    });

    const { recoverPendingAssetImportStage, stageAssetImportEntries } = await import('./assetStore');
    await expect(stageAssetImportEntries([
      {
        meta: { id: 'asset-old', kind: 'file', name: 'new-old.txt', mimeType: 'text/plain', size: 3, createdAt: 2 },
        blob: new Blob(['new']),
        previewBlob: null
      },
      {
        meta: { id: 'asset-new-2', kind: 'file', name: 'new.txt', mimeType: 'text/plain', size: 3, createdAt: 2 },
        blob: new Blob(['new']),
        previewBlob: null
      }
    ], {
      assetCommitId: 'import-asset-process-loss',
      onProgress: (current) => {
        if (current === 1) throw new Error('simulated process exit');
      }
    })).rejects.toThrow('simulated process exit');

    expect(store('asset-import-stage').has('pending')).toBe(true);
    expect(Array.from(store('asset-binary').keys()).some((key) => key.startsWith('asset-import-stage:'))).toBe(true);

    // A new startup has no receipt or closure from the dead process; it recovers from persisted
    // manifest + LocalData state only.
    await expect(recoverPendingAssetImportStage()).resolves.toBe('abandoned');

    expect(await (store('asset-binary').get('asset-old') as Blob).text()).toBe('old');
    expect(store('asset-meta').get('asset-old')).toMatchObject({ name: 'old.txt' });
    expect(Array.from(store('asset-binary').keys()).some((key) => key.startsWith('asset-import-stage:'))).toBe(false);
    expect(store('asset-import-stage').has('pending')).toBe(false);
  });

  it.each(assetPersistenceContracts)('finishes a published stage after $name restart without deleting its newly active bytes', async ({ persist }) => {
    const stores = new Map<string, Map<string, unknown>>([
      ['asset-binary', new Map([['asset-old', new Blob(['old'])]])],
      ['asset-meta', new Map([['asset-old', {
        id: 'asset-old', kind: 'file', name: 'old.txt', mimeType: 'text/plain', size: 3, createdAt: 1
      }]])],
      ['asset-preview', new Map()],
      ['asset-import-stage', new Map()]
    ]);
    const store = (name: string) => stores.get(name)!;
    persistenceMocks.dbStoreGet.mockImplementation(async (name: string, key: string) => store(name).get(key) ?? null);
    persistenceMocks.dbStoreKeys.mockImplementation(async (name: string) => Array.from(store(name).keys()));
    persistenceMocks.dbStoreDelete.mockImplementation(async (name: string, key: string) => {
      store(name).delete(key);
    });
    persistenceMocks.dbStoreSet.mockImplementation(async (name: string, key: string, value: unknown) => {
      store(name).set(key, persist(value));
    });

    const { recoverPendingAssetImportStage, stageAssetImportEntries } = await import('./assetStore');
    const stage = await stageAssetImportEntries([{
      meta: { id: 'asset-old', kind: 'file', name: 'new.txt', mimeType: 'text/plain', size: 3, createdAt: 2 },
      blob: new Blob(['new']),
      previewBlob: null
    }], { assetCommitId: 'import-asset-published' });
    const pointer = {
      domain: 'asset', version: 1, committedAt: 20, commitId: 'import-asset-published'
    };
    const localData = new Map<string, unknown>([
      ['local-data-v1:pointer:asset', pointer],
      ['local-data-v1:active-data-source', {
        schemaVersion: 1,
        key: 'local-data-v1:active-data-source',
        activeDataSource: 'repository',
        activeCommitId: pointer.commitId,
        stagingCommitId: null,
        updatedAt: 20,
        domains: { asset: pointer }
      }],
      ['local-data-v1:row:asset:asset:asset-old', {
        schemaVersion: 1,
        key: 'local-data-v1:row:asset:asset:asset-old',
        ref: { domain: 'asset', kind: 'asset', id: 'asset-old' },
        version: 1,
        updatedAt: 20,
        state: 'complete',
        value: {
          id: 'asset-old',
          objectId: 'asset:asset-old',
          storageKey: stage.entries[0]!.storageKey,
          kind: 'file',
          name: 'new.txt',
          mimeType: 'text/plain',
          size: 3,
          createdAt: 2,
          hasMeta: true,
          hasBinary: true,
          hasPreview: false,
          binaryBytes: 3,
          previewBytes: 0,
          ownerRefs: [],
          ownerCount: 0,
          orphan: true,
          updatedAt: 2
        }
      }],
      ['local-data-v1:row:asset:domainMeta:asset', {
        schemaVersion: 1,
        key: 'local-data-v1:row:asset:domainMeta:asset',
        ref: { domain: 'asset', kind: 'domainMeta', id: 'asset' },
        version: 1,
        updatedAt: 20,
        state: 'complete',
        value: { id: 'asset', totalObjectCount: 1 }
      }]
    ]);
    installStoreLocalDataBackend({
      mode: 'transactional',
      read: async <T>(key: string) => (localData.get(key) as T | undefined) ?? null,
      listKeysWithPrefix: async (prefix: string) => Array.from(localData.keys()).filter((key) => key.startsWith(prefix)),
      commitAtomic: async () => {}
    });

    // If durable commit evidence exists but storage lost the staged body, recovery must keep the
    // old bytes and manifest for diagnosis/retry instead of classifying the stage as unpublished.
    store('asset-binary').delete(stage.entries[0]!.storageKey);
    await expect(recoverPendingAssetImportStage()).rejects.toThrow(
      'Published asset import bytes do not match their durable stage'
    );
    expect(await (store('asset-binary').get('asset-old') as Blob).text()).toBe('old');
    expect(store('asset-import-stage').has('pending')).toBe(true);

    store('asset-binary').set(stage.entries[0]!.storageKey, persist(stage.entries[0]!.blob));
    await expect(recoverPendingAssetImportStage()).resolves.toBe('published');

    expect(store('asset-binary').has('asset-old')).toBe(false);
    expect(await (store('asset-binary').get(stage.entries[0]!.storageKey) as Blob).text()).toBe('new');
    expect(store('asset-import-stage').has('pending')).toBe(false);
  });
});
