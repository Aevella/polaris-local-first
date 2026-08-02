import { afterEach, describe, expect, it } from 'vitest';
import {
  createCompleteLocalDataRow,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type LocalDataActiveDataSourceRow,
  type LocalDataDomain,
  type LocalDataStoredRow,
  type LocalDataTransactionalBackend,
  type LocalDataUnitOfWork,
  type LocalDataRef
} from '../engines/localData';
import {
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../infrastructure/persistence';
import {
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  pruneLocalDataUnitOfWorkToChangedRows,
  readLocalDataDomainRows
} from './localDataStorePersistence';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from './storeLocalDataBackendHost';

function createKeyOnlyPersistenceBackend(keys: string[]): PersistenceBackend {
  return {
    async dbStoreGet() {
      return null;
    },
    async dbStoreSet() {},
    async dbStoreDelete() {},
    async dbStoreEntries() {
      throw new Error('discoverLocalDataDomainRefs must not read full KV entries');
    },
    async dbStoreKeys() {
      return keys;
    },
    async dbStoreClear() {},
    async kvApplyMutations(_mutations: PersistedKvMutation[]) {},
    async kvReplaceAll(_entries: PersistedDbEntry[]) {}
  };
}

function createValuePersistenceBackend(values: Map<string, unknown>): PersistenceBackend {
  return {
    async dbStoreGet<T>(_storeName: string, key: string) {
      return (values.get(key) ?? null) as T | null;
    },
    async dbStoreSet(_storeName, key, value) {
      values.set(key, value);
    },
    async dbStoreDelete(_storeName, key) {
      values.delete(key);
    },
    async dbStoreEntries<T>() {
      return Array.from(values.entries()).map(([key, value]) => ({
        key,
        value: value as T
      }));
    },
    async dbStoreKeys() {
      return Array.from(values.keys());
    },
    async dbStoreClear() {
      values.clear();
    },
    async kvApplyMutations(mutations: PersistedKvMutation[]) {
      for (const mutation of mutations) {
        if (mutation.type === 'set') values.set(mutation.key, mutation.value);
        if (mutation.type === 'delete') values.delete(mutation.key);
      }
    },
    async kvReplaceAll(entries: PersistedDbEntry[]) {
      values.clear();
      entries.forEach((entry) => values.set(entry.key, entry.value));
    }
  };
}

const localDataDomains = [
  'asset',
  'chat',
  'collection',
  'document',
  'persona',
  'runtime',
  'space'
] satisfies LocalDataDomain[];

function activeSourceForDomain(domain: LocalDataDomain, overrides: Partial<LocalDataActiveDataSourceRow> = {}) {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataActiveDataSourceKey(),
    activeDataSource: 'repository',
    activeCommitId: `${domain}-commit`,
    stagingCommitId: null,
    updatedAt: 10,
    domains: {
      [domain]: {
        domain,
        version: LOCAL_DATA_SCHEMA_VERSION,
        committedAt: 10,
        commitId: `${domain}-commit`
      }
    },
    ...overrides
  } satisfies LocalDataActiveDataSourceRow;
}

function completeDomainMetaRow(domain: LocalDataDomain) {
  const domainMetaRef: LocalDataRef = { domain, kind: 'domainMeta', id: domain };
  return createCompleteLocalDataRow({
    ref: domainMetaRef,
    value: { id: domain },
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 10
  });
}

function throwingPersistenceBackend(label: string): PersistenceBackend {
  const fail = () => {
    throw new Error(`${label} must not touch the KV persistence backend`);
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

describe('localDataStorePersistence', () => {
  afterEach(() => {
    resetStoreLocalDataBackendForTesting();
    setPersistenceBackendForTesting(null);
  });

  it('discovers domain refs through the installed backend, not KV-specific APIs', async () => {
    const cardRef: LocalDataRef = { domain: 'collection', kind: 'card', id: 'card:with:colon' };
    const projectRef: LocalDataRef = { domain: 'collection', kind: 'project', id: 'project-1' };
    const observedPrefixes: string[] = [];
    const installedBackend: LocalDataTransactionalBackend = {
      mode: 'transactional',
      async read() {
        return null;
      },
      async listKeysWithPrefix(prefix: string) {
        observedPrefixes.push(prefix);
        return [
          getLocalDataRowKey(cardRef),
          'local-data-v1:row:collection:malformed',
          getLocalDataRowKey(projectRef)
        ];
      },
      async commitAtomic() {
        throw new Error('commit is not exercised by discovery');
      }
    };
    installStoreLocalDataBackend(installedBackend);
    // If discovery reached for kvKeysWithPrefix / dbStoreKeys instead of the backend, this
    // throwing persistence substrate would surface it.
    setPersistenceBackendForTesting(throwingPersistenceBackend('discoverLocalDataDomainRefs'));

    await expect(discoverLocalDataDomainRefs('collection')).resolves.toEqual([cardRef, projectRef]);
    expect(observedPrefixes).toEqual(['local-data-v1:row:collection:']);
  });

  it('reads the active source and domain meta through the installed backend, not KV-specific APIs', async () => {
    const domain: LocalDataDomain = 'collection';
    const activeSource = activeSourceForDomain(domain);
    const domainMetaRow = completeDomainMetaRow(domain);
    const domainMetaKey = getLocalDataRowKey({ domain, kind: 'domainMeta', id: domain });
    const observedKeys: string[] = [];
    const installedBackend: LocalDataTransactionalBackend = {
      mode: 'transactional',
      async read<T>(key: string) {
        observedKeys.push(key);
        if (key === getLocalDataActiveDataSourceKey()) return activeSource as unknown as T;
        if (key === getLocalDataCommitPointerKey(domain)) return activeSource.domains[domain] as unknown as T;
        if (key === domainMetaKey) return domainMetaRow as unknown as T;
        return null;
      },
      async listKeysWithPrefix() {
        return [];
      },
      async commitAtomic() {
        throw new Error('commit is not exercised by the active-source read');
      }
    };
    installStoreLocalDataBackend(installedBackend);
    // The active-source pointer and domain meta are CURRENT LocalData facts: a raw kvGet here
    // would fork once SQLite is the installed backend, so this throwing KV substrate proves the
    // read never bypasses the backend.
    setPersistenceBackendForTesting(throwingPersistenceBackend('readActiveLocalDataSourceForDomain'));

    await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(true);
    expect(observedKeys).toContain(getLocalDataActiveDataSourceKey());
    expect(observedKeys).toContain(domainMetaKey);
  });

  it('discovers domain refs from keys without loading KV values', async () => {
    const collectionCardRef: LocalDataRef = {
      domain: 'collection',
      kind: 'card',
      id: 'card:with:colon'
    };
    const collectionProjectRef: LocalDataRef = {
      domain: 'collection',
      kind: 'project',
      id: 'project-1'
    };
    const personaRef: LocalDataRef = {
      domain: 'persona',
      kind: 'collaborator',
      id: 'pharos'
    };

    setPersistenceBackendForTesting(createKeyOnlyPersistenceBackend([
      getLocalDataRowKey(personaRef),
      'local-data-v1:row:collection:malformed',
      getLocalDataRowKey(collectionCardRef),
      'legacy-key',
      getLocalDataRowKey(collectionProjectRef)
    ]));

    await expect(discoverLocalDataDomainRefs('collection')).resolves.toEqual([
      collectionCardRef,
      collectionProjectRef
    ]);
  });

  it('requires every repository domain to have an active pointer and complete domain meta row', async () => {
    for (const domain of localDataDomains) {
      const activeSource = activeSourceForDomain(domain);
      const values = new Map<string, unknown>([
        [getLocalDataActiveDataSourceKey(), activeSource],
        [getLocalDataCommitPointerKey(domain), activeSource.domains[domain]]
      ]);
      setPersistenceBackendForTesting(createValuePersistenceBackend(values));

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);

      values.set(getLocalDataRowKey({ domain, kind: 'domainMeta', id: domain }), completeDomainMetaRow(domain));

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(true);
    }
  });

  it('rejects partial or non-repository active source rows for every domain', async () => {
    for (const domain of localDataDomains) {
      const domainMetaRef: LocalDataRef = { domain, kind: 'domainMeta', id: domain };
      const values = new Map<string, unknown>([
        [getLocalDataRowKey(domainMetaRef), completeDomainMetaRow(domain)]
      ]);
      setPersistenceBackendForTesting(createValuePersistenceBackend(values));

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);

      values.set(getLocalDataActiveDataSourceKey(), {
        ...activeSourceForDomain(domain),
        activeDataSource: 'legacy'
      });

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);

      values.set(getLocalDataActiveDataSourceKey(), activeSourceForDomain(domain, { domains: {} }));

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);

      const wrongPointerDomain: LocalDataDomain = domain === 'chat' ? 'asset' : 'chat';
      values.set(getLocalDataActiveDataSourceKey(), activeSourceForDomain(domain, {
        domains: {
          [domain]: {
            domain: wrongPointerDomain,
            version: LOCAL_DATA_SCHEMA_VERSION,
            committedAt: 10,
            commitId: `${domain}-commit`
          }
        }
      } as Partial<LocalDataActiveDataSourceRow>));

      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(false);
    }
  });

  it('does not treat a repository domain as active when its domain meta row is missing', async () => {
    const activeSource = activeSourceForDomain('collection');
    const values = new Map<string, unknown>([
      [getLocalDataActiveDataSourceKey(), activeSource],
      [getLocalDataCommitPointerKey('collection'), activeSource.domains.collection]
    ]);
    setPersistenceBackendForTesting(createValuePersistenceBackend(values));

    await expect(isLocalDataRepositoryDomainActive('collection')).resolves.toBe(false);

    values.set(getLocalDataRowKey({ domain: 'collection', kind: 'domainMeta', id: 'collection' }), completeDomainMetaRow('collection'));

    await expect(isLocalDataRepositoryDomainActive('collection')).resolves.toBe(true);
  });

  it('rejects an active domain pointer that does not name the current domain commit', async () => {
    const activeSource = activeSourceForDomain('collection');
    const values = new Map<string, unknown>([
      [getLocalDataActiveDataSourceKey(), activeSource],
      [getLocalDataCommitPointerKey('collection'), {
        ...activeSource.domains.collection,
        commitId: 'collection-newer-unpromoted'
      }],
      [
        getLocalDataRowKey({ domain: 'collection', kind: 'domainMeta', id: 'collection' }),
        completeDomainMetaRow('collection')
      ]
    ]);
    setPersistenceBackendForTesting(createValuePersistenceBackend(values));

    await expect(isLocalDataRepositoryDomainActive('collection')).resolves.toBe(false);
  });

  it('prunes repository commits to changed rows and fresh tombstones', () => {
    const stableRef: LocalDataRef = { domain: 'collection', kind: 'card', id: 'stable' };
    const changedRef: LocalDataRef = { domain: 'collection', kind: 'card', id: 'changed' };
    const staleRef: LocalDataRef = { domain: 'collection', kind: 'card', id: 'stale' };
    const deletedRef: LocalDataRef = { domain: 'collection', kind: 'card', id: 'deleted' };
    const domainMetaRef: LocalDataRef = { domain: 'collection', kind: 'domainMeta', id: 'collection' };
    const stableRow = createCompleteLocalDataRow({
      ref: stableRef,
      value: { title: 'stable' },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1
    });
    const changedRow = createCompleteLocalDataRow({
      ref: changedRef,
      value: { title: 'old' },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1
    });
    const staleRow = createCompleteLocalDataRow({
      ref: staleRef,
      value: { title: 'stale' },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1
    });
    const deletedRow: LocalDataStoredRow = {
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      key: getLocalDataRowKey(deletedRef),
      ref: deletedRef,
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1,
      state: 'deleted',
      deletedAt: 1
    };
    const domainMetaRow = createCompleteLocalDataRow({
      ref: domainMetaRef,
      value: { activeObjectCount: 2 },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1
    });
    const nextChangedRow = createCompleteLocalDataRow({
      ref: changedRef,
      value: { title: 'new' },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 2
    });
    const unitOfWork: LocalDataUnitOfWork = {
      domain: 'collection',
      version: LOCAL_DATA_SCHEMA_VERSION,
      mutations: [
        { type: 'put', row: domainMetaRow },
        { type: 'put', row: stableRow },
        { type: 'put', row: nextChangedRow }
      ]
    };

    const hasChanges = pruneLocalDataUnitOfWorkToChangedRows({
      unitOfWork,
      currentRows: [domainMetaRow, stableRow, changedRow, staleRow, deletedRow],
      deletedAt: 3
    });

    expect(hasChanges).toBe(true);
    expect(unitOfWork.mutations).toEqual([
      { type: 'put', row: nextChangedRow },
      {
        type: 'tombstone',
        ref: staleRef,
        version: LOCAL_DATA_SCHEMA_VERSION,
        deletedAt: 3
      }
    ]);
  });

  it.each(localDataDomains)('isolates one unreadable optional %s row in recover mode but rejects it in strict mode', async (domain) => {
    const domainMeta = completeDomainMetaRow(domain);
    const healthyRef: LocalDataRef = { domain, kind: 'object', id: 'healthy' };
    const badRef: LocalDataRef = { domain, kind: 'object', id: 'bad' };
    const values = new Map<string, unknown>([
      [domainMeta.key, domainMeta],
      [getLocalDataRowKey(healthyRef), createCompleteLocalDataRow({
        ref: healthyRef,
        value: { id: 'healthy' },
        version: LOCAL_DATA_SCHEMA_VERSION,
        updatedAt: 10
      })],
      [getLocalDataRowKey(badRef), { malformed: true }]
    ]);
    installStoreLocalDataBackend({
      mode: 'transactional',
      async read<T>(key: string) {
        return (values.get(key) ?? null) as T | null;
      },
      async listKeysWithPrefix(prefix: string) {
        return Array.from(values.keys()).filter((key) => key.startsWith(prefix));
      },
      async commitAtomic() {}
    });

    await expect(readLocalDataDomainRows({
      domain,
      integrity: 'recover',
      isRequiredRef: (ref) => ref.kind === 'domainMeta'
    })).resolves.toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ key: domainMeta.key }), expect.objectContaining({ ref: healthyRef })]),
      isolatedRows: [{ ref: badRef, status: 'incomplete' }]
    });

    await expect(readLocalDataDomainRows({
      domain,
      integrity: 'strict',
      isRequiredRef: (ref) => ref.kind === 'domainMeta'
    })).rejects.toThrow(`Active ${domain} LocalData row object:bad is incomplete`);
  });

  it('turns an imported complete row into an explicit restore when the installed row is tombstoned', () => {
    const ref: LocalDataRef = { domain: 'collection', kind: 'card', id: 'revived' };
    const deletedRow: LocalDataStoredRow = {
      schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
      key: getLocalDataRowKey(ref),
      ref,
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 1,
      state: 'deleted',
      deletedAt: 1
    };
    const restoredRow = createCompleteLocalDataRow({
      ref,
      value: { title: 'restored by backup' },
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 2
    });
    const unitOfWork: LocalDataUnitOfWork = {
      domain: 'collection',
      version: LOCAL_DATA_SCHEMA_VERSION,
      mutations: [{ type: 'put', row: restoredRow }]
    };

    pruneLocalDataUnitOfWorkToChangedRows({
      unitOfWork,
      currentRows: [deletedRow],
      deletedAt: 2
    });

    expect(unitOfWork.mutations).toEqual([{ type: 'restore', row: restoredRow }]);
  });
});
