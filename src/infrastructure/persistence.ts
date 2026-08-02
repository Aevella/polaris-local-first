import { createIndexedDbPersistenceBackend } from './indexedDbPersistenceBackend';
import { createNativePersistenceBackend, getNativePersistencePlatform } from './nativePersistenceBackend';

const DB_NAME = 'polaris-db';
const DB_VERSION = 4;
const IDB_OPEN_TIMEOUT_MS = 30000;
const IDB_TRANSACTION_TIMEOUT_MS = 60000;
export const KV_STORE = 'kv';
export const ASSET_BINARY_STORE = 'asset-binary';
export const ASSET_META_STORE = 'asset-meta';
export const ASSET_PREVIEW_STORE = 'asset-preview';
export const ASSET_IMPORT_STAGE_STORE = 'asset-import-stage';

export type PersistedDbEntry<T = unknown> = {
  key: string;
  value: T;
};
export type PersistedDbEntrySize = {
  key: string;
  size: number;
};
export type PersistedKvMutation =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'delete'; key: string };

export type PersistenceStorageMode =
  | 'indexeddb'
  | 'native'
  | 'android-native-indexeddb-bridge'
  | 'indexeddb-session-fallback';

export type PersistenceLocalDataCommitMode = 'transactional' | 'staged';

export type PersistenceStorageDiagnostic = {
  mode: PersistenceStorageMode;
  label: string;
  detail: string;
};

export type PersistenceBackend = {
  localDataCommitMode?: PersistenceLocalDataCommitMode;
  dbStoreGet<T>(storeName: string, key: string): Promise<T | null>;
  dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void>;
  dbStoreDelete(storeName: string, key: string): Promise<void>;
  dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]>;
  dbStoreEntrySizes?(storeName: string): Promise<PersistedDbEntrySize[]>;
  dbStoreKeys?(storeName: string): Promise<string[]>;
  dbStoreKeysWithPrefix?(storeName: string, prefix: string): Promise<string[]>;
  dbStoreClear(storeName: string): Promise<void>;
  kvApplyMutations(mutations: PersistedKvMutation[]): Promise<void>;
  kvReplaceAll(entries: PersistedDbEntry[]): Promise<void>;
  getStorageDiagnostic?(): Promise<PersistenceStorageDiagnostic>;
};

const KV_WRITE_GATE_TOKEN = Symbol('persistence-kv-write-gate-token');

export type PersistenceKvWriteGateToken = {
  readonly [KV_WRITE_GATE_TOKEN]: true;
};

export type PersistenceKvWriteGateLease = {
  token: PersistenceKvWriteGateToken;
  release(): void;
};

type PersistenceKvWriteOptions = {
  gateToken?: PersistenceKvWriteGateToken;
};

let persistenceBackend: PersistenceBackend | null = null;
let kvWriteGateTail: Promise<void> = Promise.resolve();

function createIndexedDbBackend() {
  return createIndexedDbPersistenceBackend({
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    kvStore: KV_STORE,
    assetBinaryStore: ASSET_BINARY_STORE,
    assetMetaStore: ASSET_META_STORE,
    assetPreviewStore: ASSET_PREVIEW_STORE,
    additionalStores: [ASSET_IMPORT_STAGE_STORE],
    obsoleteStores: ['import-rollback'],
    openTimeoutMs: IDB_OPEN_TIMEOUT_MS,
    transactionTimeoutMs: IDB_TRANSACTION_TIMEOUT_MS
  });
}

export function createIndexedDbPersistenceBackendForRecovery() {
  return createIndexedDbBackend();
}

function createDefaultPersistenceBackend() {
  const nativePlatform = getNativePersistencePlatform();
  if (nativePlatform === null) {
    return createIndexedDbBackend();
  }

  const nativeBackend = createNativePersistenceBackend(KV_STORE);
  if (nativePlatform !== 'android') {
    return nativeBackend;
  }

  return createAndroidNativeIndexedDbBridgeBackend(nativeBackend, createIndexedDbBackend());
}

function mergeEntries<T>(
  fallbackEntries: PersistedDbEntry<T>[],
  nativeEntries: PersistedDbEntry<T>[]
): PersistedDbEntry<T>[] {
  const merged = new Map<string, PersistedDbEntry<T>>();
  fallbackEntries.forEach((entry) => merged.set(entry.key, entry));
  nativeEntries.forEach((entry) => merged.set(entry.key, entry));
  return [...merged.values()];
}

function mergeEntrySizes(
  fallbackEntries: PersistedDbEntrySize[],
  nativeEntries: PersistedDbEntrySize[]
): PersistedDbEntrySize[] {
  const merged = new Map<string, PersistedDbEntrySize>();
  fallbackEntries.forEach((entry) => merged.set(entry.key, entry));
  nativeEntries.forEach((entry) => merged.set(entry.key, entry));
  return [...merged.values()];
}

function estimatePersistedEntrySize(value: unknown) {
  if (value instanceof Blob) return value.size;
  if (typeof value === 'string') return new TextEncoder().encode(value).length;
  const serialized = JSON.stringify(value);
  return serialized ? new TextEncoder().encode(serialized).length : 0;
}

async function readBackendKeys(backend: PersistenceBackend, storeName: string) {
  return backend.dbStoreKeys
    ? await backend.dbStoreKeys(storeName)
    : (await backend.dbStoreEntries(storeName)).map((entry) => entry.key);
}

async function readBackendKeysWithPrefix(backend: PersistenceBackend, storeName: string, prefix: string) {
  return backend.dbStoreKeysWithPrefix
    ? await backend.dbStoreKeysWithPrefix(storeName, prefix)
    : (await readBackendKeys(backend, storeName)).filter((key) => key.startsWith(prefix));
}

async function readBackendEntrySizes(backend: PersistenceBackend, storeName: string) {
  if (backend.dbStoreEntrySizes) {
    return await backend.dbStoreEntrySizes(storeName);
  }
  return (await backend.dbStoreEntries(storeName)).map((entry) => ({
    key: entry.key,
    size: estimatePersistedEntrySize(entry.value)
  }));
}

async function readBackendEntrySizesFromKeys(backend: PersistenceBackend, storeName: string) {
  return (await readBackendKeys(backend, storeName)).map((key) => ({ key, size: 0 }));
}

function createAndroidNativeIndexedDbBridgeBackend(
  nativeBackend: PersistenceBackend,
  indexedDbBackend: PersistenceBackend
): PersistenceBackend {
  return {
    localDataCommitMode: nativeBackend.localDataCommitMode ?? 'staged',

    async dbStoreGet<T>(storeName: string, key: string): Promise<T | null> {
      const nativeValue = await readAndroidNativeValue<T>(nativeBackend, storeName, key);
      return nativeValue !== null ? nativeValue : await indexedDbBackend.dbStoreGet<T>(storeName, key);
    },

    async dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void> {
      await nativeBackend.dbStoreSet(storeName, key, value);
    },

    async dbStoreDelete(storeName: string, key: string): Promise<void> {
      await nativeBackend.dbStoreDelete(storeName, key);
      await indexedDbBackend.dbStoreDelete(storeName, key);
    },

    async dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]> {
      return mergeEntries(
        await indexedDbBackend.dbStoreEntries<T>(storeName),
        await readAndroidNativeEntries<T>(nativeBackend, storeName)
      );
    },

    async dbStoreEntrySizes(storeName: string): Promise<PersistedDbEntrySize[]> {
      return mergeEntrySizes(
        await readBackendEntrySizesFromKeys(indexedDbBackend, storeName),
        await readAndroidNativeEntrySizes(nativeBackend, storeName)
      );
    },

    async dbStoreKeys(storeName: string): Promise<string[]> {
      return [...new Set([
        ...(await readBackendKeys(indexedDbBackend, storeName)),
        ...(await readAndroidNativeKeys(nativeBackend, storeName))
      ])];
    },

    async dbStoreKeysWithPrefix(storeName: string, prefix: string): Promise<string[]> {
      return [...new Set([
        ...(await readBackendKeysWithPrefix(indexedDbBackend, storeName, prefix)),
        ...(await readAndroidNativeKeysWithPrefix(nativeBackend, storeName, prefix))
      ])];
    },

    async dbStoreClear(storeName: string): Promise<void> {
      await nativeBackend.dbStoreClear(storeName);
      await indexedDbBackend.dbStoreClear(storeName);
    },

    async kvApplyMutations(mutations: PersistedKvMutation[]): Promise<void> {
      await nativeBackend.kvApplyMutations(mutations);
      const deletedKeys = mutations
        .filter((mutation): mutation is Extract<PersistedKvMutation, { type: 'delete' }> => mutation.type === 'delete')
        .map((mutation) => mutation.key);
      if (deletedKeys.length === 0) return;
      await indexedDbBackend.kvApplyMutations(deletedKeys.map((key) => ({ type: 'delete', key })));
    },

    async kvReplaceAll(entries: PersistedDbEntry[]): Promise<void> {
      await nativeBackend.kvReplaceAll(entries);
      await indexedDbBackend.kvReplaceAll([]);
    },

    async getStorageDiagnostic() {
      return {
        mode: 'android-native-indexeddb-bridge',
        label: 'Android 原生存储',
        detail: '当前数据写入 Android 原生存储；旧 IndexedDB 数据只作为升级兜底读取，并会在删除或替换时清理。'
      };
    }
  };
}

async function readAndroidNativeValue<T>(
  nativeBackend: PersistenceBackend,
  storeName: string,
  key: string
): Promise<T | null> {
  try {
    return await nativeBackend.dbStoreGet<T>(storeName, key);
  } catch (error) {
    console.warn('Android native persistence read failed; falling back to IndexedDB.', { storeName, key, error });
    return null;
  }
}

async function readAndroidNativeEntries<T>(
  nativeBackend: PersistenceBackend,
  storeName: string
): Promise<PersistedDbEntry<T>[]> {
  try {
    return await nativeBackend.dbStoreEntries<T>(storeName);
  } catch (error) {
    console.warn('Android native persistence entries read failed; falling back to IndexedDB.', { storeName, error });
    return [];
  }
}

async function readAndroidNativeEntrySizes(
  nativeBackend: PersistenceBackend,
  storeName: string
): Promise<PersistedDbEntrySize[]> {
  try {
    return await readBackendEntrySizes(nativeBackend, storeName);
  } catch (error) {
    console.warn('Android native persistence size read failed; falling back to IndexedDB.', { storeName, error });
    return [];
  }
}

async function readAndroidNativeKeys(
  nativeBackend: PersistenceBackend,
  storeName: string
): Promise<string[]> {
  try {
    return await readBackendKeys(nativeBackend, storeName);
  } catch (error) {
    console.warn('Android native persistence keys read failed; falling back to IndexedDB.', { storeName, error });
    return [];
  }
}

async function readAndroidNativeKeysWithPrefix(
  nativeBackend: PersistenceBackend,
  storeName: string,
  prefix: string
): Promise<string[]> {
  try {
    return await readBackendKeysWithPrefix(nativeBackend, storeName, prefix);
  } catch (error) {
    console.warn('Android native persistence prefix keys read failed; falling back to IndexedDB.', { storeName, prefix, error });
    return [];
  }
}

function getPersistenceBackend() {
  persistenceBackend ??= createDefaultPersistenceBackend();
  return persistenceBackend;
}

export function setPersistenceBackendForTesting(backend: PersistenceBackend | null) {
  persistenceBackend = backend;
  kvWriteGateTail = Promise.resolve();
}

export async function dbStoreGet<T>(storeName: string, key: string): Promise<T | null> {
  return await getPersistenceBackend().dbStoreGet<T>(storeName, key);
}

export async function dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void> {
  await getPersistenceBackend().dbStoreSet(storeName, key, value);
}

export async function dbStoreDelete(storeName: string, key: string): Promise<void> {
  await getPersistenceBackend().dbStoreDelete(storeName, key);
}

export async function dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]> {
  return await getPersistenceBackend().dbStoreEntries<T>(storeName);
}

export async function dbStoreEntrySizes(storeName: string): Promise<PersistedDbEntrySize[]> {
  return await readBackendEntrySizes(getPersistenceBackend(), storeName);
}

export async function dbStoreKeys(storeName: string): Promise<string[]> {
  const backend = getPersistenceBackend();
  if (backend.dbStoreKeys) {
    return await backend.dbStoreKeys(storeName);
  }
  return (await backend.dbStoreEntries(storeName)).map((entry) => entry.key);
}

export async function dbStoreKeysWithPrefix(storeName: string, prefix: string): Promise<string[]> {
  return await readBackendKeysWithPrefix(getPersistenceBackend(), storeName, prefix);
}

export async function dbStoreClear(storeName: string): Promise<void> {
  await getPersistenceBackend().dbStoreClear(storeName);
}

export type PersistedKvEntry = PersistedDbEntry;

export async function kvGet<T>(key: string): Promise<T | null> {
  return await dbStoreGet<T>(KV_STORE, key);
}

export async function kvSet<T>(key: string, value: T, options: PersistenceKvWriteOptions = {}): Promise<void> {
  await runKvWrite(options.gateToken, async () => {
    await getPersistenceBackend().dbStoreSet(KV_STORE, key, value);
  });
}

export async function kvDel(key: string, options: PersistenceKvWriteOptions = {}): Promise<void> {
  await runKvWrite(options.gateToken, async () => {
    await getPersistenceBackend().dbStoreDelete(KV_STORE, key);
  });
}

export async function kvApplyMutations(
  mutations: PersistedKvMutation[],
  options: PersistenceKvWriteOptions = {}
): Promise<void> {
  await runKvWrite(options.gateToken, async () => {
    await getPersistenceBackend().kvApplyMutations(mutations);
  });
}

export async function kvEntries(): Promise<PersistedKvEntry[]> {
  return await dbStoreEntries(KV_STORE);
}

export async function kvEntrySizes(): Promise<PersistedDbEntrySize[]> {
  return await dbStoreEntrySizes(KV_STORE);
}

export async function kvKeys(): Promise<string[]> {
  return await dbStoreKeys(KV_STORE);
}

export async function kvKeysWithPrefix(prefix: string): Promise<string[]> {
  return await dbStoreKeysWithPrefix(KV_STORE, prefix);
}

export async function kvReplaceAll(
  entries: PersistedKvEntry[],
  options: PersistenceKvWriteOptions = {}
): Promise<void> {
  await runKvWrite(options.gateToken, async () => {
    await getPersistenceBackend().kvReplaceAll(entries);
  });
}

export function getPersistenceLocalDataCommitMode(): PersistenceLocalDataCommitMode {
  return getPersistenceBackend().localDataCommitMode ?? 'transactional';
}

export async function acquireExclusiveKvWriteGate(): Promise<PersistenceKvWriteGateLease> {
  let releaseCurrent: () => void = () => {};
  const previousTail = kvWriteGateTail;
  kvWriteGateTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await previousTail;
  let released = false;

  return {
    token: { [KV_WRITE_GATE_TOKEN]: true },
    release() {
      if (released) return;
      released = true;
      releaseCurrent();
    }
  };
}

export async function withExclusiveKvWriteGate<T>(
  operation: (token: PersistenceKvWriteGateToken) => Promise<T>
): Promise<T> {
  const lease = await acquireExclusiveKvWriteGate();
  try {
    return await operation(lease.token);
  } finally {
    lease.release();
  }
}

async function runKvWrite<T>(gateToken: PersistenceKvWriteGateToken | undefined, operation: () => Promise<T>): Promise<T> {
  if (gateToken?.[KV_WRITE_GATE_TOKEN] === true) {
    return await operation();
  }

  return await withExclusiveKvWriteGate(async () => await operation());
}

export async function getPersistenceStorageDiagnostic(): Promise<PersistenceStorageDiagnostic> {
  const backend = getPersistenceBackend();
  return backend.getStorageDiagnostic
    ? await backend.getStorageDiagnostic()
    : {
        mode: 'indexeddb',
        label: 'IndexedDB',
        detail: '当前环境使用浏览器 IndexedDB。'
      };
}
