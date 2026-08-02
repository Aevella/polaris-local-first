import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('./indexedDbPersistenceBackend');
vi.unmock('./nativePersistenceBackend');

type PersistedDbEntry<T = unknown> = {
  key: string;
  value: T;
};

type PersistedKvMutation =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'delete'; key: string };

type PersistenceStorageMode =
  | 'indexeddb'
  | 'native'
  | 'android-native-indexeddb-bridge'
  | 'indexeddb-session-fallback';

type PersistenceBackend = {
  localDataCommitMode?: 'transactional' | 'staged';
  dbStoreGet<T>(storeName: string, key: string): Promise<T | null>;
  dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void>;
  dbStoreDelete(storeName: string, key: string): Promise<void>;
  dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]>;
  dbStoreEntrySizes?(storeName: string): Promise<Array<{ key: string; size: number }>>;
  dbStoreKeys?(storeName: string): Promise<string[]>;
  dbStoreKeysWithPrefix?(storeName: string, prefix: string): Promise<string[]>;
  dbStoreClear(storeName: string): Promise<void>;
  kvApplyMutations(mutations: PersistedKvMutation[]): Promise<void>;
  kvReplaceAll(entries: PersistedDbEntry[]): Promise<void>;
  getStorageDiagnostic?(): Promise<{ mode: PersistenceStorageMode; label: string; detail: string }>;
};

type FakeOpenRequest = {
  result: FakeDb;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  error: Error | null;
};

type FakeRequest<T> = {
  result?: T;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

type FakeTransaction = {
  objectStore: () => FakeStore;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
  abort: () => void;
};

type FakeStore = {
  get: (key: string) => FakeRequest<unknown>;
};

type FakeDb = {
  objectStoreNames: { contains: () => boolean };
  createObjectStore: () => void;
  deleteObjectStore: (name: string) => void;
  transaction: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onclose: (() => void) | null;
  onversionchange: (() => void) | null;
};

function createSuccessfulTransaction(value: unknown): FakeTransaction {
  const tx: FakeTransaction = {
    objectStore: () => ({
      get: () => {
        const request: FakeRequest<unknown> = {
          result: value,
          onsuccess: null,
          onerror: null
        };
        queueMicrotask(() => {
          request.onsuccess?.();
          tx.oncomplete?.();
        });
        return request;
      }
    }),
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
    abort: vi.fn()
  };
  return tx;
}

function createFakeDb(transaction: FakeDb['transaction']): FakeDb {
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: vi.fn(),
    deleteObjectStore: vi.fn(),
    transaction,
    close: vi.fn(),
    onclose: null,
    onversionchange: null
  };
}

describe('persistence IndexedDB connection recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('drops a cached IndexedDB connection after transaction creation fails', async () => {
    const connectionLost = new Error('Connection to Indexed Database server lost. Refresh the page to try again');
    const firstDb = createFakeDb(vi.fn()
      .mockReturnValueOnce(createSuccessfulTransaction('first'))
      .mockImplementationOnce(() => {
        throw connectionLost;
      }));
    const secondDb = createFakeDb(vi.fn().mockReturnValue(createSuccessfulTransaction('reopened')));
    const openRequests: FakeOpenRequest[] = [];
    const indexedDB = {
      open: vi.fn(() => {
        const request: FakeOpenRequest = {
          result: openRequests.length === 0 ? firstDb : secondDb,
          onsuccess: null,
          onerror: null,
          onblocked: null,
          onupgradeneeded: null,
          error: null
        };
        openRequests.push(request);
        queueMicrotask(() => request.onsuccess?.());
        return request;
      })
    };
    vi.stubGlobal('indexedDB', indexedDB);

    const { kvGet } = await import('./persistence');

    await expect(kvGet('key')).resolves.toBe('first');
    await expect(kvGet('key')).rejects.toBe(connectionLost);
    await expect(kvGet('key')).resolves.toBe('reopened');

    expect(indexedDB.open).toHaveBeenCalledTimes(2);
    expect(firstDb.close).toHaveBeenCalledTimes(1);
    expect(secondDb.transaction).toHaveBeenCalledTimes(1);
  });

  it('upgrades IndexedDB v3 to v4 by adding only the durable asset stage store', async () => {
    const stores = new Set(['kv', 'asset-binary', 'asset-meta', 'asset-preview', 'import-rollback']);
    const transaction = vi.fn().mockReturnValue(createSuccessfulTransaction('preserved-kv'));
    const db = createFakeDb(transaction);
    db.objectStoreNames = { contains: (name?: string) => Boolean(name && stores.has(name)) };
    db.createObjectStore = vi.fn((name?: string) => {
      if (name) stores.add(name);
    });
    db.deleteObjectStore = vi.fn((name: string) => {
      stores.delete(name);
    });
    const indexedDB = {
      open: vi.fn((_name: string, _version: number) => {
        const request: FakeOpenRequest = {
          result: db,
          onsuccess: null,
          onerror: null,
          onblocked: null,
          onupgradeneeded: null,
          error: null
        };
        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      })
    };
    vi.stubGlobal('indexedDB', indexedDB);

    const { kvGet } = await import('./persistence');
    await expect(kvGet('legacy-key')).resolves.toBe('preserved-kv');

    expect(indexedDB.open).toHaveBeenCalledWith('polaris-db', 4);
    expect(db.createObjectStore).toHaveBeenCalledTimes(1);
    expect(db.createObjectStore).toHaveBeenCalledWith('asset-import-stage');
    expect(db.deleteObjectStore).toHaveBeenCalledTimes(1);
    expect(db.deleteObjectStore).toHaveBeenCalledWith('import-rollback');
    expect(stores).toEqual(new Set([
      'kv',
      'asset-binary',
      'asset-meta',
      'asset-preview',
      'asset-import-stage'
    ]));
  });

  it('routes public persistence helpers through the selected backend', async () => {
    const dbStoreGet: PersistenceBackend['dbStoreGet'] = async <T>(_storeName: string, key: string) => ({ key } as T);
    const dbStoreEntries: PersistenceBackend['dbStoreEntries'] = async <T>() => [{ key: 'entry', value: 1 as T }];
    const backend: PersistenceBackend = {
      dbStoreGet: vi.fn(dbStoreGet) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(dbStoreEntries) as PersistenceBackend['dbStoreEntries'],
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };

    const {
      KV_STORE,
      kvGet,
      kvApplyMutations,
      kvEntries,
      kvKeysWithPrefix,
      setPersistenceBackendForTesting
    } = await import('./persistence');
    setPersistenceBackendForTesting(backend);

    await expect(kvGet('chat-index-v2')).resolves.toEqual({ key: 'chat-index-v2' });
    await kvApplyMutations([{ type: 'delete', key: 'old' }]);
    await expect(kvEntries()).resolves.toEqual([{ key: 'entry', value: 1 }]);
    await expect(kvKeysWithPrefix('chat-')).resolves.toEqual([]);

    expect(backend.dbStoreGet).toHaveBeenCalledWith(KV_STORE, 'chat-index-v2');
    expect(backend.kvApplyMutations).toHaveBeenCalledWith([{ type: 'delete', key: 'old' }]);
    expect(backend.dbStoreEntries).toHaveBeenCalledTimes(2);
  });

  it('uses backend prefix key scans when available', async () => {
    const backend: PersistenceBackend = {
      dbStoreGet: vi.fn(async () => null),
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async () => {
        throw new Error('prefix scans must not read entries');
      }),
      dbStoreKeys: vi.fn(async () => {
        throw new Error('prefix scans must not read all keys');
      }),
      dbStoreKeysWithPrefix: vi.fn(async (_storeName, prefix) => [`${prefix}one`, `${prefix}two`]),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };

    const { KV_STORE, kvKeysWithPrefix, setPersistenceBackendForTesting } = await import('./persistence');
    setPersistenceBackendForTesting(backend);

    await expect(kvKeysWithPrefix('chat-')).resolves.toEqual(['chat-one', 'chat-two']);

    expect(backend.dbStoreKeysWithPrefix).toHaveBeenCalledWith(KV_STORE, 'chat-');
    expect(backend.dbStoreKeys).not.toHaveBeenCalled();
    expect(backend.dbStoreEntries).not.toHaveBeenCalled();
  });

  it('uses the native backend directly when the iOS native plugin is available', async () => {
    const nativeBackend: PersistenceBackend = {
      dbStoreGet: vi.fn(async <T>(_storeName: string, key: string) => ({ key } as T)) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async () => []),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };
    const createIndexedDbPersistenceBackend = vi.fn();
    const getNativePersistencePlatform = vi.fn(() => 'ios');
    const createNativePersistenceBackend = vi.fn(() => nativeBackend);
    vi.doMock('./indexedDbPersistenceBackend', () => ({ createIndexedDbPersistenceBackend }));
    vi.doMock('./nativePersistenceBackend', () => ({
      getNativePersistencePlatform,
      createNativePersistenceBackend
    }));

    const { KV_STORE, kvGet } = await import('./persistence');

    await expect(kvGet('chat-index-v2')).resolves.toEqual({ key: 'chat-index-v2' });

    expect(createIndexedDbPersistenceBackend).not.toHaveBeenCalled();
    expect(createNativePersistenceBackend).toHaveBeenCalledWith(KV_STORE);
    expect(nativeBackend.dbStoreGet).toHaveBeenCalledWith(KV_STORE, 'chat-index-v2');
  });

  it('bridges Android native persistence with old IndexedDB data during upgrade', async () => {
    const nativeBackend: PersistenceBackend = {
      localDataCommitMode: 'staged',
      dbStoreGet: vi.fn(async <T>(_storeName: string, key: string) => (
        key === 'native-only' || key === 'shared' ? { source: 'native', key } as T : null
      )) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async <T>() => [
        { key: 'shared', value: { source: 'native' } as T },
        { key: 'native-only', value: { source: 'native' } as T }
      ]) as PersistenceBackend['dbStoreEntries'],
      dbStoreEntrySizes: vi.fn(async () => [
        { key: 'shared', size: 20 },
        { key: 'native-only', size: 30 }
      ]),
      dbStoreKeys: vi.fn(async () => ['shared', 'native-only']),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };
    const indexedDbBackend: PersistenceBackend = {
      localDataCommitMode: 'transactional',
      dbStoreGet: vi.fn(async <T>(_storeName: string, key: string) => (
        key === 'legacy-only' || key === 'shared' ? { source: 'indexeddb', key } as T : null
      )) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async <T>() => [
        { key: 'legacy-only', value: { source: 'indexeddb' } as T },
        { key: 'shared', value: { source: 'indexeddb' } as T }
      ]) as PersistenceBackend['dbStoreEntries'],
      dbStoreEntrySizes: vi.fn(async () => {
        throw new Error('legacy IndexedDB blobs should not be read for Android bridge sizes');
      }),
      dbStoreKeys: vi.fn(async () => ['legacy-only', 'shared']),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };
    const createIndexedDbPersistenceBackend = vi.fn(() => indexedDbBackend);
    const getNativePersistencePlatform = vi.fn(() => 'android');
    const createNativePersistenceBackend = vi.fn(() => nativeBackend);
    vi.doMock('./indexedDbPersistenceBackend', () => ({ createIndexedDbPersistenceBackend }));
    vi.doMock('./nativePersistenceBackend', () => ({
      getNativePersistencePlatform,
      createNativePersistenceBackend
    }));

    const {
      KV_STORE,
      dbStoreDelete,
      dbStoreEntrySizes,
      getPersistenceLocalDataCommitMode,
      getPersistenceStorageDiagnostic,
      kvApplyMutations,
      kvEntries,
      kvGet,
      kvKeys,
      kvKeysWithPrefix,
      kvReplaceAll,
      kvSet
    } = await import('./persistence');

    await expect(kvGet('legacy-only')).resolves.toEqual({ source: 'indexeddb', key: 'legacy-only' });
    await expect(kvGet('shared')).resolves.toEqual({ source: 'native', key: 'shared' });
    await expect(kvEntries()).resolves.toEqual([
      { key: 'legacy-only', value: { source: 'indexeddb' } },
      { key: 'shared', value: { source: 'native' } },
      { key: 'native-only', value: { source: 'native' } }
    ]);
    await expect(kvKeys()).resolves.toEqual(['legacy-only', 'shared', 'native-only']);
    await expect(kvKeysWithPrefix('native')).resolves.toEqual(['native-only']);
    await expect(dbStoreEntrySizes(KV_STORE)).resolves.toEqual([
      { key: 'legacy-only', size: 0 },
      { key: 'shared', size: 20 },
      { key: 'native-only', size: 30 }
    ]);

    await kvSet('new-key', { ok: true });
    await kvApplyMutations([
      { type: 'set', key: 'native-write', value: { ok: true } },
      { type: 'delete', key: 'legacy-delete' }
    ]);
    await dbStoreDelete(KV_STORE, 'direct-delete');
    await kvReplaceAll([{ key: 'replacement', value: { ok: true } }]);

    expect(getPersistenceLocalDataCommitMode()).toBe('staged');
    await expect(getPersistenceStorageDiagnostic()).resolves.toMatchObject({
      mode: 'android-native-indexeddb-bridge'
    });
    expect(nativeBackend.dbStoreSet).toHaveBeenCalledWith(KV_STORE, 'new-key', { ok: true });
    expect(indexedDbBackend.dbStoreSet).not.toHaveBeenCalled();
    expect(indexedDbBackend.dbStoreEntrySizes).not.toHaveBeenCalled();
    expect(nativeBackend.kvApplyMutations).toHaveBeenCalledWith([
      { type: 'set', key: 'native-write', value: { ok: true } },
      { type: 'delete', key: 'legacy-delete' }
    ]);
    expect(indexedDbBackend.kvApplyMutations).toHaveBeenCalledWith([
      { type: 'delete', key: 'legacy-delete' }
    ]);
    expect(nativeBackend.dbStoreDelete).toHaveBeenCalledWith(KV_STORE, 'direct-delete');
    expect(indexedDbBackend.dbStoreDelete).toHaveBeenCalledWith(KV_STORE, 'direct-delete');
    expect(nativeBackend.kvReplaceAll).toHaveBeenCalledWith([{ key: 'replacement', value: { ok: true } }]);
    expect(indexedDbBackend.kvReplaceAll).toHaveBeenCalledWith([]);
  });

  it('falls back to old IndexedDB reads when Android native reads fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nativeBackend: PersistenceBackend = {
      localDataCommitMode: 'staged',
      dbStoreGet: vi.fn(async () => {
        throw new Error('native get failed');
      }) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async () => {
        throw new Error('native entries failed');
      }) as PersistenceBackend['dbStoreEntries'],
      dbStoreKeys: vi.fn(async () => {
        throw new Error('native keys failed');
      }),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };
    const indexedDbBackend: PersistenceBackend = {
      localDataCommitMode: 'transactional',
      dbStoreGet: vi.fn(async <T>(_storeName: string, key: string) => ({ source: 'indexeddb', key } as T)) as PersistenceBackend['dbStoreGet'],
      dbStoreSet: vi.fn(async () => {}),
      dbStoreDelete: vi.fn(async () => {}),
      dbStoreEntries: vi.fn(async <T>() => [
        { key: 'legacy-only', value: { source: 'indexeddb' } as T }
      ]) as PersistenceBackend['dbStoreEntries'],
      dbStoreKeys: vi.fn(async () => ['legacy-only']),
      dbStoreClear: vi.fn(async () => {}),
      kvApplyMutations: vi.fn(async () => {}),
      kvReplaceAll: vi.fn(async () => {})
    };
    const createIndexedDbPersistenceBackend = vi.fn(() => indexedDbBackend);
    const getNativePersistencePlatform = vi.fn(() => 'android');
    const createNativePersistenceBackend = vi.fn(() => nativeBackend);
    vi.doMock('./indexedDbPersistenceBackend', () => ({ createIndexedDbPersistenceBackend }));
    vi.doMock('./nativePersistenceBackend', () => ({
      getNativePersistencePlatform,
      createNativePersistenceBackend
    }));

    const { kvEntries, kvGet, kvKeys, kvSet } = await import('./persistence');

    await expect(kvGet('legacy-only')).resolves.toEqual({ source: 'indexeddb', key: 'legacy-only' });
    await expect(kvEntries()).resolves.toEqual([
      { key: 'legacy-only', value: { source: 'indexeddb' } }
    ]);
    await expect(kvKeys()).resolves.toEqual(['legacy-only']);
    await kvSet('must-write-native', { ok: true });

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(nativeBackend.dbStoreSet).toHaveBeenCalledWith('kv', 'must-write-native', { ok: true });
    expect(indexedDbBackend.dbStoreSet).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
