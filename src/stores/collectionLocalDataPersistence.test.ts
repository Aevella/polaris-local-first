import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCollectionLocalDataUnitOfWork,
  createLocalDataKvBackend,
  createLocalDataRepository,
  getCollectionDomainMetaLocalDataRef,
  getCollectionObjectLocalDataRef,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type LocalDataActiveDataSourceRow,
  type LocalDataCommitMeta
} from '../engines/localData';
import {
  kvGet,
  kvSet,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../infrastructure/persistence';
import type { CodeCard, RoomProject } from '../types/domain';
import { readCollectionState, writeCollectionState, type PersistedCollectionState } from './collectionStorePersistence';

function createMemoryPersistenceBackend(
  initialKv: PersistedDbEntry[] = [],
  options: { onKvApplyMutations?: (mutations: PersistedKvMutation[]) => void } = {}
): PersistenceBackend {
  const stores = new Map<string, Map<string, unknown>>();
  stores.set('kv', new Map(initialKv.map((entry) => [entry.key, entry.value])));

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
    async dbStoreKeys(storeName: string) {
      return Array.from(getStore(storeName).keys());
    },
    async dbStoreClear(storeName: string) {
      getStore(storeName).clear();
    },
    async kvApplyMutations(mutations: PersistedKvMutation[]) {
      options.onKvApplyMutations?.(mutations);
      const store = getStore('kv');
      for (const mutation of mutations) {
        if (mutation.type === 'set') {
          store.set(mutation.key, mutation.value);
        } else {
          store.delete(mutation.key);
        }
      }
    },
    async kvReplaceAll(entries) {
      stores.set('kv', new Map(entries.map((entry) => [entry.key, entry.value])));
    }
  };
}

function card(seed: Partial<CodeCard> & Pick<CodeCard, 'id'>): CodeCard {
  return {
    title: seed.id,
    language: 'html',
    code: '',
    tags: [],
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...seed
  };
}

function project(seed: Partial<RoomProject> & Pick<RoomProject, 'id'>): RoomProject {
  return {
    title: seed.id,
    slug: seed.id,
    fileIds: [],
    tags: [],
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...seed
  };
}

function collectionState(state: Partial<PersistedCollectionState> = {}): PersistedCollectionState {
  return {
    cards: [],
    imageCards: [],
    roomProjects: [],
    projectFiles: [],
    workspaceReferenceDocs: [],
    deletedBundledCardIds: [],
    ...state
  };
}

async function promoteCollectionState(state: PersistedCollectionState, activeProjectId: string | null) {
  const repository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 100,
    createCommitId: () => 'collection:initial'
  });
  const meta = await repository.commit(buildCollectionLocalDataUnitOfWork({
    activeProjectId,
    state,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 100
  }));
  await kvSet(getLocalDataActiveDataSourceKey(), activeSourceRow(meta));
}

function activeSourceRow(meta: LocalDataCommitMeta): LocalDataActiveDataSourceRow {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataActiveDataSourceKey(),
    activeDataSource: 'repository',
    activeCommitId: meta.commitId,
    stagingCommitId: null,
    updatedAt: meta.committedAt,
    domains: {
      collection: {
        domain: 'collection',
        version: meta.version,
        committedAt: meta.committedAt,
        commitId: meta.commitId
      }
    }
  };
}

describe('collection LocalData persistence', () => {
  beforeEach(() => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
  });

  afterEach(() => {
    setPersistenceBackendForTesting(null);
  });

  it('hydrates collection state from repository when collection is the active source', async () => {
    await promoteCollectionState(collectionState({
      cards: [card({ id: 'card-1', title: 'Repository Card' })],
      roomProjects: [project({ id: 'project-1' })],
      deletedBundledCardIds: ['starter-card']
    }), 'project-1');

    const state = await readCollectionState({ throwOnReadFailure: true });

    expect(state).toEqual(expect.objectContaining({
      cards: [expect.objectContaining({ id: 'card-1', title: 'Repository Card' })],
      roomProjects: [expect.objectContaining({ id: 'project-1' })],
      deletedBundledCardIds: ['starter-card']
    }));
  });

  it('self-activates a fresh collection save and leaves the old KV store unwritten', async () => {
    await writeCollectionState(collectionState({
      cards: [card({ id: 'card-1', title: 'Fresh Card' })],
      roomProjects: [project({ id: 'project-1' })]
    }));

    const legacyPayload = await kvGet('collection-state-v2');
    const activeSource = await kvGet<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
    const hydrated = await readCollectionState({ throwOnReadFailure: true });

    expect(legacyPayload).toBeNull();
    expect(activeSource?.activeDataSource).toBe('repository');
    expect(activeSource?.domains.collection?.commitId).toBe(activeSource?.activeCommitId);
    expect(hydrated).toEqual(expect.objectContaining({
      cards: [expect.objectContaining({ id: 'card-1', title: 'Fresh Card' })],
      roomProjects: [expect.objectContaining({ id: 'project-1' })]
    }));
  });

  it('ignores preexisting legacy collection KV during ordinary saves and reads', async () => {
    const legacyPayload = collectionState({
      cards: [card({ id: 'old-card', title: 'Old Card' })]
    });
    await kvSet('collection-state-v2', legacyPayload);

    await writeCollectionState(collectionState({
      cards: [card({ id: 'new-card', title: 'New Card' })],
      roomProjects: [project({ id: 'project-1' })]
    }));

    const hydrated = await readCollectionState({ throwOnReadFailure: true });

    expect(await kvGet('collection-state-v2')).toEqual(legacyPayload);
    expect(hydrated?.cards).toEqual([expect.objectContaining({ id: 'new-card', title: 'New Card' })]);
  });

  it('writes collection state to repository and tombstones stale collection rows when active', async () => {
    await promoteCollectionState(collectionState({
      cards: [card({ id: 'card-old' })],
      roomProjects: [project({ id: 'project-1' })]
    }), 'project-1');

    await writeCollectionState(collectionState({
      cards: [card({ id: 'card-new' })],
      roomProjects: [project({ id: 'project-1' })],
      deletedBundledCardIds: ['starter-card']
    }));

    const legacyPayload = await kvGet('collection-state-v2');
    const staleRow = await kvGet(getLocalDataRowKey(getCollectionObjectLocalDataRef('card', 'card-old')));
    const hydrated = await readCollectionState({ throwOnReadFailure: true });

    expect(legacyPayload).toBeNull();
    expect(staleRow).toEqual(expect.objectContaining({
      state: 'deleted'
    }));
    expect(hydrated).toEqual(expect.objectContaining({
      cards: [expect.objectContaining({ id: 'card-new' })],
      deletedBundledCardIds: ['starter-card']
    }));
  });

  it('skips repository commits when the collection state is unchanged', async () => {
    const state = collectionState({
      cards: [card({ id: 'card-1' })],
      roomProjects: [project({ id: 'project-1' })]
    });
    await promoteCollectionState(state, 'project-1');

    await writeCollectionState(state);

    await expect(kvGet(getLocalDataCommitPointerKey('collection'))).resolves.toEqual({
      domain: 'collection',
      version: LOCAL_DATA_SCHEMA_VERSION,
      committedAt: 100,
      commitId: 'collection:initial'
    });
  });

  it('commits only changed collection rows when repository state changes', async () => {
    const mutationBatches: PersistedKvMutation[][] = [];
    setPersistenceBackendForTesting(createMemoryPersistenceBackend([], {
      onKvApplyMutations: (mutations) => {
        if (mutations.length === 0) return;
        mutationBatches.push(mutations);
      }
    }));
    await promoteCollectionState(collectionState({
      cards: [
        card({ id: 'card-1', title: 'Stable Card' }),
        card({ id: 'card-2', title: 'Draft Card' })
      ],
      roomProjects: [project({ id: 'project-1' })]
    }), 'project-1');
    mutationBatches.length = 0;

    await writeCollectionState(collectionState({
      cards: [
        card({ id: 'card-1', title: 'Stable Card' }),
        card({ id: 'card-2', title: 'Updated Card', updatedAt: 2 })
      ],
      roomProjects: [project({ id: 'project-1' })]
    }));

    expect(mutationBatches).toHaveLength(1);
    expect(mutationBatches[0]?.map((mutation) => mutation.key).sort()).toEqual([
      getLocalDataActiveDataSourceKey(),
      getLocalDataCommitPointerKey('collection'),
      getLocalDataRowKey(getCollectionObjectLocalDataRef('card', 'card-2')),
      getLocalDataRowKey(getCollectionDomainMetaLocalDataRef())
    ].sort());
  });
});
