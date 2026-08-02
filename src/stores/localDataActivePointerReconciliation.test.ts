import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  createIncompleteLocalDataRow,
  createCompleteLocalDataRow,
  createLocalDataKvBackend,
  createLocalDataSqliteBackend,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type CommitPointerRow,
  type LocalDataActiveDataSourceRow,
  type LocalDataBackend,
  type LocalDataDomain,
  type LocalDataSqliteDriver,
  type LocalDataSqliteQueryRow,
  type LocalDataTransactionalBackend
} from '../engines/localData';
import {
  ASSET_BINARY_STORE,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../infrastructure/persistence';
import { getAssetBlob } from '../infrastructure/assetStore';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import { migratePersistedSpaceState } from './spaceStorePersistence';
import { restoreStructuredImportToLocalDataRepository } from './storeImportLocalDataRestore';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from './storeLocalDataBackendHost';
import {
  createStoreLocalDataRepository,
  isLocalDataRepositoryDomainActive
} from './localDataStorePersistence';
import { reconcileLegacyActiveLocalDataPointers } from './localDataActivePointerReconciliation';
import { initializeRuntimeStoreLocalDataBackend } from '../app/bootstrap/storeLocalDataBackendBootstrap';

const DOMAINS = [
  'chat',
  'collection',
  'persona',
  'runtime',
  'space',
  'asset',
  'document'
] satisfies LocalDataDomain[];

function createMemoryPersistenceBackend(): PersistenceBackend {
  const stores = new Map<string, Map<string, unknown>>();
  const store = (name: string) => {
    let value = stores.get(name);
    if (!value) {
      value = new Map();
      stores.set(name, value);
    }
    return value;
  };
  return {
    localDataCommitMode: 'transactional',
    async dbStoreGet<T>(name: string, key: string) {
      return (store(name).get(key) as T | undefined) ?? null;
    },
    async dbStoreSet(name, key, value) {
      store(name).set(key, value);
    },
    async dbStoreDelete(name, key) {
      store(name).delete(key);
    },
    async dbStoreEntries<T>(name: string) {
      return Array.from(store(name), ([key, value]) => ({ key, value: value as T }));
    },
    async dbStoreKeys(name) {
      return Array.from(store(name).keys());
    },
    async dbStoreKeysWithPrefix(name, prefix) {
      return Array.from(store(name).keys()).filter((key) => key.startsWith(prefix));
    },
    async dbStoreClear(name) {
      store(name).clear();
    },
    async kvApplyMutations(mutations: PersistedKvMutation[]) {
      for (const mutation of mutations) {
        if (mutation.type === 'set') store('kv').set(mutation.key, mutation.value);
        else store('kv').delete(mutation.key);
      }
    },
    async kvReplaceAll(entries: PersistedDbEntry[]) {
      stores.set('kv', new Map(entries.map((entry) => [entry.key, entry.value])));
    }
  };
}

function createNodeSqliteDriver(db: DatabaseSync): LocalDataSqliteDriver {
  return {
    async execute(sql: string, params: readonly unknown[] = []) {
      if (params.length === 0) db.exec(sql);
      else db.prepare(sql).run(...(params as never[]));
    },
    async query<T extends LocalDataSqliteQueryRow = LocalDataSqliteQueryRow>(
      sql: string,
      params: readonly unknown[] = []
    ) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    }
  };
}

function trackTransactionalBackend(backend: LocalDataBackend) {
  if (backend.mode !== 'transactional') throw new Error('Test contract requires a transactional backend.');
  const commits: Parameters<LocalDataTransactionalBackend['commitAtomic']>[] = [];
  const tracked: LocalDataTransactionalBackend = {
    ...backend,
    async commitAtomic(...args) {
      commits.push(args);
      await backend.commitAtomic(...args);
    }
  };
  return { backend: tracked, commits };
}

const backendContracts = [
  {
    name: 'default transactional IndexedDB contract',
    installResult: { installed: false, backend: 'kv-default' as const },
    create() {
      return trackTransactionalBackend(createLocalDataKvBackend());
    }
  },
  {
    name: 'SQLite contract',
    installResult: { installed: true, backend: 'native-sqlite' as const },
    create() {
      return trackTransactionalBackend(createLocalDataSqliteBackend({
        driver: createNodeSqliteDriver(new DatabaseSync(':memory:'))
      }));
    }
  }
];

async function seedAllDomains(backend: LocalDataTransactionalBackend) {
  installStoreLocalDataBackend(backend);
  const result = await restoreStructuredImportToLocalDataRepository({
    chatState: { conversations: [], activeConversationId: null },
    collectionState: {
      cards: [],
      imageCards: [],
      roomProjects: [],
      projectFiles: [],
      workspaceReferenceDocs: [],
      deletedBundledCardIds: []
    },
    personaState: {
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    },
    personaMemoryDocContent: { version: 1, docs: {} },
    runtimeState: normalizeRuntimePayload(null),
    spaceState: migratePersistedSpaceState({}),
    assetEntries: []
  }, { committedAt: 200 });
  expect(result.restoredDomains).toEqual(DOMAINS);
}

async function readActiveRow(backend: LocalDataBackend) {
  return await backend.read<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
}

async function writeActiveRow(
  backend: LocalDataTransactionalBackend,
  row: LocalDataActiveDataSourceRow
) {
  await backend.commitAtomic([{
    type: 'set',
    key: getLocalDataActiveDataSourceKey(),
    value: row
  }], {
    domain: 'runtime',
    version: LOCAL_DATA_SCHEMA_VERSION,
    committedAt: 201,
    commitId: 'legacy-public-main-active-row'
  });
}

async function driftActiveDomains(
  backend: LocalDataTransactionalBackend,
  domains: LocalDataDomain[] = DOMAINS
) {
  const current = await readActiveRow(backend);
  if (!current) throw new Error('Fixture active row is missing.');
  const nextDomains = { ...current.domains };
  for (const domain of domains) {
    const latest = await backend.read<CommitPointerRow>(getLocalDataCommitPointerKey(domain));
    if (!latest) throw new Error(`Fixture pointer is missing: ${domain}`);
    nextDomains[domain] = {
      ...latest,
      committedAt: latest.committedAt - 1,
      commitId: `${domain}:legacy-active-A`
    };
  }
  await writeActiveRow(backend, { ...current, domains: nextDomains, updatedAt: 201 });
}

async function appendHistoricalChatEvidence() {
  await createStoreLocalDataRepository({ now: () => 205 }).commit({
    domain: 'chat',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [{
      type: 'put',
      row: createCompleteLocalDataRow({
        ref: { domain: 'chat', kind: 'conversationCatalog', id: 'historical-chat' },
        version: LOCAL_DATA_SCHEMA_VERSION,
        updatedAt: 205,
        value: {
          id: 'historical-chat',
          title: '',
          collaboratorId: null,
          activeProjectId: null,
          pinnedAt: null,
          updatedAt: 205,
          messageCount: 0,
          latestMessageTimestamp: 0,
          state: 'archive',
          legacyRef: { layer: 'chat-catalog-v1', recordKey: 'historical-chat' },
          lifecycleReason: 'historical upgrade fixture',
          recordVersion: LOCAL_DATA_SCHEMA_VERSION
        }
      })
    }]
  });
}

afterEach(() => {
  resetStoreLocalDataBackendForTesting();
  setPersistenceBackendForTesting(null);
});

describe('legacy clean active-pointer reconciliation', () => {
  it.each(backendContracts)('repairs public/main A→B drift across all seven domains on $name', async ({ create, installResult }) => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const tracked = create();
    await seedAllDomains(tracked.backend);
    await appendHistoricalChatEvidence();
    await driftActiveDomains(tracked.backend);
    tracked.commits.length = 0;
    const recoverAssetImport = vi.fn(async () => {
      await expect(isLocalDataRepositoryDomainActive('asset')).resolves.toBe(true);
      return 'none' as const;
    });

    const initialization = await initializeRuntimeStoreLocalDataBackend({
      installBackend: () => installResult,
      reconcileActivePointers: () => reconcileLegacyActiveLocalDataPointers({ now: () => 300 }),
      recoverAssetImport
    });
    const result = initialization.activePointerReconciliation;

    expect(result).toEqual({
      status: 'reconciled',
      reconciledDomains: DOMAINS,
      unchangedDomains: [],
      failures: []
    });
    expect(recoverAssetImport).toHaveBeenCalledTimes(1);
    expect(tracked.commits).toHaveLength(DOMAINS.length);
    const repository = createStoreLocalDataRepository();
    for (const domain of DOMAINS) {
      const active = await readActiveRow(tracked.backend);
      const latest = await tracked.backend.read<CommitPointerRow>(getLocalDataCommitPointerKey(domain));
      expect(active?.domains[domain]).toEqual(latest);
      await expect(isLocalDataRepositoryDomainActive(domain)).resolves.toBe(true);
      await expect(repository.read({ domain, kind: 'domainMeta', id: domain })).resolves.toEqual(
        expect.objectContaining({ status: 'complete' })
      );
    }
  });

  it('is idempotent when active pointer A already equals latest pointer B', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const tracked = backendContracts[0].create();
    await seedAllDomains(tracked.backend);
    tracked.commits.length = 0;

    const result = await reconcileLegacyActiveLocalDataPointers();

    expect(result.status).toBe('unchanged');
    expect(result.unchangedDomains).toEqual(DOMAINS);
    expect(tracked.commits).toHaveLength(0);
  });

  it('never activates a domain absent from the legacy active row', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const tracked = backendContracts[0].create();
    await seedAllDomains(tracked.backend);
    const active = await readActiveRow(tracked.backend);
    if (!active) throw new Error('Fixture active row is missing.');
    const { asset: _removed, ...domains } = active.domains;
    await writeActiveRow(tracked.backend, { ...active, domains, updatedAt: 202 });
    tracked.commits.length = 0;

    await reconcileLegacyActiveLocalDataPointers();

    expect((await readActiveRow(tracked.backend))?.domains.asset).toBeUndefined();
    await expect(isLocalDataRepositoryDomainActive('asset')).resolves.toBe(false);
    expect(tracked.commits).toHaveLength(0);
  });

  it('does not advance an already-active domain when its latest commit pointer is missing', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const tracked = backendContracts[0].create();
    await seedAllDomains(tracked.backend);
    const activeBefore = await readActiveRow(tracked.backend);
    await tracked.backend.commitAtomic([{
      type: 'delete',
      key: getLocalDataCommitPointerKey('asset')
    }], {
      domain: 'asset',
      version: LOCAL_DATA_SCHEMA_VERSION,
      committedAt: 204,
      commitId: 'fixture-missing-latest-asset-pointer'
    });
    tracked.commits.length = 0;

    const result = await reconcileLegacyActiveLocalDataPointers({ reportDegraded: vi.fn() });

    expect(result.failures).toContainEqual({ domain: 'asset', stage: 'pointer-read', rowCount: 0 });
    expect((await readActiveRow(tracked.backend))?.domains.asset).toEqual(activeBefore?.domains.asset);
    await expect(tracked.backend.read(getLocalDataRowKey({
      domain: 'asset',
      kind: 'domainMeta',
      id: 'asset'
    }))).resolves.toEqual(expect.objectContaining({ state: 'complete' }));
    expect(tracked.commits).toHaveLength(0);
  });

  it('keeps drifted rows and pointer A untouched when current B hydration is incomplete', async () => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    const tracked = backendContracts[0].create();
    await seedAllDomains(tracked.backend);
    await driftActiveDomains(tracked.backend, ['runtime']);
    const metaRef = { domain: 'runtime' as const, kind: 'domainMeta', id: 'runtime' };
    const incompleteMeta = createIncompleteLocalDataRow({
      ref: metaRef,
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: 203,
      reason: 'fixture-incomplete'
    });
    await tracked.backend.commitAtomic([{
      type: 'set',
      key: getLocalDataRowKey(metaRef),
      value: incompleteMeta
    }], {
      domain: 'runtime',
      version: LOCAL_DATA_SCHEMA_VERSION,
      committedAt: 203,
      commitId: 'fixture-corrupt-current-row-without-pointer-change'
    });
    const activeBefore = await readActiveRow(tracked.backend);
    const reportDegraded = vi.fn();
    tracked.commits.length = 0;

    const result = await reconcileLegacyActiveLocalDataPointers({ reportDegraded });

    expect(result.status).toBe('degraded');
    expect(result.failures).toContainEqual({
      domain: 'runtime',
      stage: 'strict-hydration',
      rowCount: 3
    });
    expect((await readActiveRow(tracked.backend))?.domains.runtime).toEqual(activeBefore?.domains.runtime);
    expect(await tracked.backend.read(getLocalDataRowKey(metaRef))).toEqual(incompleteMeta);
    expect(tracked.commits).toHaveLength(0);
    expect(reportDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'runtime',
        stage: 'strict-hydration',
        integrity: 'degraded'
      }),
      expect.any(Error)
    );
  });

  it('reads an old asset row without storageKey from the original assetId blob key', async () => {
    const persistence = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(persistence);
    const tracked = backendContracts[0].create();
    await seedAllDomains(tracked.backend);
    const assetId = 'legacy-asset-id';
    const blob = new Blob(['legacy-bytes'], { type: 'image/png' });
    await persistence.dbStoreSet(ASSET_BINARY_STORE, assetId, blob);
    const repository = createStoreLocalDataRepository({ now: () => 400 });
    const meta = await repository.commit({
      domain: 'asset',
      version: LOCAL_DATA_SCHEMA_VERSION,
      mutations: [{
        type: 'put',
        row: {
          schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
          key: getLocalDataRowKey({ domain: 'asset', kind: 'asset', id: assetId }),
          ref: { domain: 'asset', kind: 'asset', id: assetId },
          version: LOCAL_DATA_SCHEMA_VERSION,
          updatedAt: 400,
          state: 'complete',
          value: {
            id: assetId,
            objectId: assetId,
            kind: 'image',
            name: 'legacy.png',
            mimeType: 'image/png',
            size: blob.size,
            createdAt: 1,
            hasMeta: true,
            hasBinary: true,
            hasPreview: false,
            binaryBytes: blob.size,
            previewBytes: 0,
            ownerRefs: [],
            ownerCount: 0,
            orphan: true,
            updatedAt: 400
          }
        }
      }]
    });
    expect(meta.domain).toBe('asset');

    await expect(getAssetBlob(assetId)).resolves.toEqual(blob);
  });
});
