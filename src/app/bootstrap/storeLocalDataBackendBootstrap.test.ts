import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  createCompleteLocalDataRow,
  createLocalDataSqliteBackend,
  getLocalDataRowKey,
  type LocalDataBackend,
  type LocalDataRef,
  type LocalDataSqliteDriver,
  type LocalDataSqliteQueryRow
} from '../../engines/localData';
import {
  getStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from '../../stores/storeLocalDataBackendHost';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive
} from '../../stores/localDataStorePersistence';
import {
  setPersistenceBackendForTesting,
  type PersistenceBackend
} from '../../infrastructure/persistence';
import {
  initializeRuntimeStoreLocalDataBackend,
  installRuntimeStoreLocalDataBackend
} from './storeLocalDataBackendBootstrap';

function createNodeSqliteDriver(db: DatabaseSync): LocalDataSqliteDriver {
  return {
    async execute(sql: string, params: readonly unknown[] = []) {
      if (params.length === 0) {
        db.exec(sql);
        return;
      }
      db.prepare(sql).run(...(params as never[]));
    },
    async query<T extends LocalDataSqliteQueryRow = LocalDataSqliteQueryRow>(
      sql: string,
      params: readonly unknown[] = []
    ) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    }
  };
}

function throwingKvPersistenceBackend(): PersistenceBackend {
  const fail = () => {
    throw new Error('SQLite-backed runtime must never touch the KV persistence backend');
  };
  return {
    async dbStoreGet() {
      return fail();
    },
    async dbStoreSet() {
      fail();
    },
    async dbStoreDelete() {
      fail();
    },
    async dbStoreEntries() {
      return fail();
    },
    async dbStoreKeys() {
      return fail();
    },
    async dbStoreKeysWithPrefix() {
      return fail();
    },
    async dbStoreClear() {
      fail();
    },
    async kvApplyMutations() {
      fail();
    },
    async kvReplaceAll() {
      fail();
    }
  };
}

afterEach(() => {
  resetStoreLocalDataBackendForTesting();
  setPersistenceBackendForTesting(null);
});

describe('installRuntimeStoreLocalDataBackend', () => {
  it('reconciles legacy active pointers before recovering assets and before store hydration can start', async () => {
    const calls: string[] = [];
    const activePointerReconciliation = {
      status: 'reconciled' as const,
      reconciledDomains: ['asset' as const],
      unchangedDomains: [],
      failures: []
    };

    await expect(initializeRuntimeStoreLocalDataBackend({
      installBackend: () => {
        calls.push('install');
        return { installed: true, backend: 'native-sqlite' };
      },
      reconcileActivePointers: async () => {
        calls.push('reconcile');
        return activePointerReconciliation;
      },
      recoverAssetImport: async () => {
        calls.push('recover');
        return 'published';
      }
    })).resolves.toEqual({
      installed: true,
      backend: 'native-sqlite',
      activePointerReconciliation,
      assetImportRecovery: 'published'
    });
    expect(calls).toEqual(['install', 'reconcile', 'recover']);
  });

  it('installs the native SQLite backend into the store host when native SQLite is available', () => {
    const sqliteBackend: LocalDataBackend = createLocalDataSqliteBackend({
      driver: createNodeSqliteDriver(new DatabaseSync(':memory:'))
    });

    const result = installRuntimeStoreLocalDataBackend({
      canUseNativeSqlite: () => true,
      createNativeBackend: () => sqliteBackend
    });

    expect(result).toEqual({ installed: true, backend: 'native-sqlite' });
    // The store host now hands every caller the SAME installed SQLite backend.
    expect(getStoreLocalDataBackend()).toBe(sqliteBackend);
  });

  it('installs nothing and keeps the KV default when native SQLite is unavailable', () => {
    let installed: LocalDataBackend | null = null;
    const result = installRuntimeStoreLocalDataBackend({
      canUseNativeSqlite: () => false,
      createNativeBackend: () => {
        throw new Error('must not build the SQLite backend off-native');
      },
      install: (backend) => {
        installed = backend;
      }
    });

    expect(result).toEqual({ installed: false, backend: 'kv-default' });
    expect(installed).toBeNull();
    // Nothing installed: the host falls back to a KV backend (its transactional default).
    expect(getStoreLocalDataBackend().mode).toBe('transactional');
  });

  it('does not promote or activate any domain at install time (fresh SQLite stays inactive)', async () => {
    const sqliteBackend = createLocalDataSqliteBackend({
      driver: createNodeSqliteDriver(new DatabaseSync(':memory:'))
    });
    setPersistenceBackendForTesting(throwingKvPersistenceBackend());

    installRuntimeStoreLocalDataBackend({
      canUseNativeSqlite: () => true,
      createNativeBackend: () => sqliteBackend
    });

    // Installing the backend is purely a routing choice — it performs no legacy promote/migration,
    // so a fresh SQLite store reports every domain inactive until an ordinary save self-activates.
    for (const domain of ['chat', 'collection', 'document', 'persona', 'runtime', 'space', 'asset'] as const) {
      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);
    }
  });

  it('writes a fresh ordinary save into the installed SQLite backend and reads it back from the same backend', async () => {
    const db = new DatabaseSync(':memory:');
    const sqliteBackend = createLocalDataSqliteBackend({ driver: createNodeSqliteDriver(db) });
    // Any accidental KV read/write would throw, proving the whole cycle stays on SQLite.
    setPersistenceBackendForTesting(throwingKvPersistenceBackend());

    installRuntimeStoreLocalDataBackend({
      canUseNativeSqlite: () => true,
      createNativeBackend: () => sqliteBackend
    });

    const domainMetaRef: LocalDataRef = { domain: 'runtime', kind: 'domainMeta', id: 'runtime' };
    const providerRef: LocalDataRef = { domain: 'runtime', kind: 'provider', id: 'provider-1' };

    // A fresh ordinary save: write the domain rows through the host-routed repository, then
    // self-activate from the just-committed rows (the shared first-write self-activation path).
    const writeRepository = createStoreLocalDataRepository();
    const meta = await writeRepository.commit({
      domain: 'runtime',
      version: 1,
      mutations: [
        { type: 'put', row: createCompleteLocalDataRow({ ref: domainMetaRef, value: { id: 'runtime' }, version: 1, updatedAt: 10 }) },
        { type: 'put', row: createCompleteLocalDataRow({ ref: providerRef, value: { id: 'provider-1', name: 'Local' }, version: 1, updatedAt: 10 }) }
      ]
    });
    await writeRepository.activateDomainsFromCommittedRows([meta]);

    // The bytes physically landed in the SQLite table, not anywhere else.
    const storedKeys = db
      .prepare('SELECT key FROM local_data_entries ORDER BY key')
      .all()
      .map((row) => (row as { key: string }).key);
    expect(storedKeys).toContain(getLocalDataRowKey(providerRef));

    // "Reload": a brand-new repository over the SAME installed backend reads the row back complete.
    const reloadRepository = createStoreLocalDataRepository();
    await expect(reloadRepository.read(providerRef)).resolves.toEqual(
      expect.objectContaining({ status: 'complete', value: { id: 'provider-1', name: 'Local' } })
    );
    await expect(isLocalDataRepositoryDomainActive('runtime')).resolves.toBe(true);
    await expect(discoverLocalDataDomainRefs('runtime')).resolves.toEqual(
      expect.arrayContaining([providerRef, domainMetaRef])
    );
  });
});
