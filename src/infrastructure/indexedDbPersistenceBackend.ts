import type {
  PersistedDbEntry,
  PersistedKvMutation,
  PersistenceBackend
} from './persistence';

type IndexedDbPersistenceBackendConfig = {
  dbName: string;
  dbVersion: number;
  kvStore: string;
  assetBinaryStore: string;
  assetMetaStore: string;
  assetPreviewStore: string;
  additionalStores?: string[];
  obsoleteStores?: string[];
  openTimeoutMs: number;
  transactionTimeoutMs: number;
};

export function createIndexedDbPersistenceBackend(config: IndexedDbPersistenceBackendConfig): PersistenceBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      const req = indexedDB.open(config.dbName, config.dbVersion);
      const timeoutId = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        dbPromise = null;
        reject(new Error(`IndexedDB 打开超时（${config.openTimeoutMs}ms）`));
      }, config.openTimeoutMs);

      const rejectOpen = (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        dbPromise = null;
        reject(error);
      };

      req.onupgradeneeded = () => {
        const db = req.result;
        (config.obsoleteStores ?? []).forEach((storeName) => {
          if (db.objectStoreNames.contains(storeName)) db.deleteObjectStore(storeName);
        });
        [
          config.kvStore,
          config.assetBinaryStore,
          config.assetMetaStore,
          config.assetPreviewStore,
          ...(config.additionalStores ?? [])
        ].forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        });
      };

      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeoutId);
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          dbPromise = null;
          db.close();
        };
        resolve(db);
      };
      req.onerror = () => {
        rejectOpen(req.error);
      };
      req.onblocked = () => {
        rejectOpen(req.error ?? new Error('IndexedDB 打开被阻塞'));
      };
    });

    return dbPromise;
  };

  const resetOpenConnection = (db: IDBDatabase) => {
    dbPromise = null;
    try {
      db.close();
    } catch {
      // A lost WebKit IndexedDB connection may already be gone; reopening is the useful recovery.
    }
  };

  const runIdbTransaction = <T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: string,
    executor: (store: IDBObjectStore, setResult: (value: T) => void, tx: IDBTransaction) => void
  ): Promise<T> =>
    openDb().then((db) => new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode);
      } catch (error) {
        resetOpenConnection(db);
        reject(error);
        return;
      }
      const store = tx.objectStore(storeName);
      let settled = false;
      let result = undefined as T;
      const timeoutId = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          tx.abort();
        } catch {
          // The transaction may already be closing; the timeout error is the useful signal.
        }
        resetOpenConnection(db);
        reject(new Error(`IndexedDB ${operation} 超时（${config.transactionTimeoutMs}ms）`));
      }, config.transactionTimeoutMs);

      const rejectTransaction = (error: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        resetOpenConnection(db);
        reject(error);
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        resolve(result);
      };
      tx.onerror = () => {
        rejectTransaction(tx.error ?? new Error(`IndexedDB ${operation} 失败`));
      };
      tx.onabort = () => {
        rejectTransaction(tx.error ?? new Error(`IndexedDB ${operation} 已中止`));
      };

      executor(store, (value) => {
        result = value;
      }, tx);
    }));

  return {
    localDataCommitMode: 'transactional',

    async dbStoreGet<T>(storeName: string, key: string): Promise<T | null> {
      if (typeof indexedDB === 'undefined') return null;
      return await runIdbTransaction<T | null>(storeName, 'readonly', `${storeName}.get`, (store, setResult, tx) => {
        const req = store.get(key);

        req.onsuccess = () => setResult((req.result as T | undefined) ?? null);
        req.onerror = () => {
          try {
            tx.abort();
          } catch {
            // The transaction error handler will report the failure.
          }
        };
      });
    },

    async dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      await runIdbTransaction<void>(storeName, 'readwrite', `${storeName}.set`, (store) => {
        store.put(value, key);
      });
    },

    async dbStoreDelete(storeName: string, key: string): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      await runIdbTransaction<void>(storeName, 'readwrite', `${storeName}.delete`, (store) => {
        store.delete(key);
      });
    },

    async dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]> {
      if (typeof indexedDB === 'undefined') return [];
      const entries: PersistedDbEntry<T>[] = [];
      await runIdbTransaction<void>(storeName, 'readonly', `${storeName}.entries`, (store, _setResult, tx) => {
        const req = store.openCursor();

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          entries.push({
            key: String(cursor.key),
            value: cursor.value
          });
          cursor.continue();
        };
        req.onerror = () => {
          try {
            tx.abort();
          } catch {
            // The transaction error handler will report the failure.
          }
        };
      });
      return entries;
    },

    async dbStoreEntrySizes(storeName: string) {
      if (typeof indexedDB === 'undefined') return [];
      const entries: Array<{ key: string; size: number }> = [];
      await runIdbTransaction<void>(storeName, 'readonly', `${storeName}.entrySizes`, (store, _setResult, tx) => {
        const req = store.openCursor();

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const value = cursor.value;
          const serialized = value instanceof Blob
            ? ''
            : JSON.stringify(value);
          entries.push({
            key: String(cursor.key),
            size: value instanceof Blob
              ? value.size
              : serialized
                ? new TextEncoder().encode(serialized).length
                : 0
          });
          cursor.continue();
        };
        req.onerror = () => {
          try {
            tx.abort();
          } catch {
            // The transaction error handler will report the failure.
          }
        };
      });
      return entries;
    },

    async dbStoreKeys(storeName: string): Promise<string[]> {
      if (typeof indexedDB === 'undefined') return [];
      const keys: string[] = [];
      await runIdbTransaction<void>(storeName, 'readonly', `${storeName}.keys`, (store, _setResult, tx) => {
        const req = store.openKeyCursor();

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          keys.push(String(cursor.key));
          cursor.continue();
        };
        req.onerror = () => {
          try {
            tx.abort();
          } catch {
            // The transaction error handler will report the failure.
          }
        };
      });
      return keys;
    },

    async dbStoreKeysWithPrefix(storeName: string, prefix: string): Promise<string[]> {
      if (typeof indexedDB === 'undefined') return [];
      const keys: string[] = [];
      const range = prefix.length > 0 ? IDBKeyRange.bound(prefix, `${prefix}\uffff`) : undefined;
      await runIdbTransaction<void>(storeName, 'readonly', `${storeName}.keysWithPrefix`, (store, _setResult, tx) => {
        const req = store.openKeyCursor(range);

        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          keys.push(String(cursor.key));
          cursor.continue();
        };
        req.onerror = () => {
          try {
            tx.abort();
          } catch {
            // The transaction error handler will report the failure.
          }
        };
      });
      return keys;
    },

    async dbStoreClear(storeName: string): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      await runIdbTransaction<void>(storeName, 'readwrite', `${storeName}.clear`, (store) => {
        store.clear();
      });
    },

    async kvApplyMutations(mutations: PersistedKvMutation[]): Promise<void> {
      if (typeof indexedDB === 'undefined' || mutations.length === 0) return;
      await runIdbTransaction<void>(config.kvStore, 'readwrite', `${config.kvStore}.applyMutations`, (store) => {
        for (const mutation of mutations) {
          if (mutation.type === 'set') {
            store.put(mutation.value, mutation.key);
          } else {
            store.delete(mutation.key);
          }
        }
      });
    },

    async kvReplaceAll(entries: PersistedDbEntry[]): Promise<void> {
      if (typeof indexedDB === 'undefined') return;
      await runIdbTransaction<void>(config.kvStore, 'readwrite', `${config.kvStore}.replaceAll`, (store) => {
        store.clear();
        for (const entry of entries) {
          store.put(entry.value, entry.key);
        }
      });
    },

    async getStorageDiagnostic() {
      return {
        mode: 'indexeddb',
        label: 'IndexedDB',
        detail: '当前环境使用浏览器 IndexedDB。'
      };
    }
  };
}
