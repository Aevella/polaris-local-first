import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import {
  buildPersonaLocalDataUnitOfWork,
  createLocalDataKvBackend,
  createLocalDataRepository,
  getDocumentObjectLocalDataRef,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  getPersonaDomainMetaLocalDataRef,
  getPersonaObjectLocalDataRef,
  LOCAL_DATA_SCHEMA_VERSION,
  type LocalDataActiveDataSourceRow,
  type LocalDataCommitMeta,
  type LocalDataStoredRow,
  type PersonaDomainMetaRow,
  type PersonaObjectRow
} from '../engines/localData';
import {
  kvGet,
  kvSet,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../infrastructure/persistence';
import type { Persona } from '../types/domain';
import { readPersonaStateFromLocalDataRepositoryIfActive, writePersonaState } from './personaLocalDataPersistence';
import { usePersonaStore } from './personaStore';

function createMemoryPersistenceBackend(initialKv: PersistedDbEntry[] = []): PersistenceBackend {
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

function persona(id: string, content = ''): Persona {
  return createPersonaTemplate({
    id,
    name: id,
    description: '',
    memory: {
      inheritGlobal: true,
      crossConversationRecallEnabled: true,
      excludedGlobalIds: [],
      personalMemories: [],
      referenceDocs: content ? [{
        id: 'doc-1',
        title: 'Doc',
        summary: '',
        content,
        contentLoaded: true,
        source: 'upload',
        updatedAt: 1
      }] : []
    }
  });
}

async function promotePersonaState(args: {
  personas: Persona[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds?: string[];
}) {
  const repository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 100,
    createCommitId: () => 'persona:initial'
  });
  const meta = await repository.commit(buildPersonaLocalDataUnitOfWork({
    state: {
      personas: args.personas,
      activeCollaboratorId: args.activeCollaboratorId,
      seededDefaultPersonaIds: args.seededDefaultPersonaIds ?? []
    },
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
      persona: {
        domain: 'persona',
        version: meta.version,
        committedAt: meta.committedAt,
        commitId: meta.commitId
      }
    }
  };
}

async function readActiveSource() {
  return await kvGet<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
}

function rawPersonaRow(id: string) {
  return kvGet<LocalDataStoredRow<PersonaObjectRow>>(getLocalDataRowKey(getPersonaObjectLocalDataRef(id)));
}

async function readDomainMeta() {
  const row = await kvGet<LocalDataStoredRow<PersonaDomainMetaRow>>(
    getLocalDataRowKey(getPersonaDomainMetaLocalDataRef())
  );
  if (!row || row.state !== 'complete') throw new Error('persona domain meta is not complete');
  return row.value;
}

describe('persona LocalData persistence', () => {
  beforeEach(() => {
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
    usePersonaStore.setState({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: [],
      hydrated: false
    });
  });

  afterEach(() => {
    setPersistenceBackendForTesting(null);
  });

  it('saves worldbook rules durably without rewriting another collaborator', async () => {
    const first = persona('first');
    const other = persona('other');
    await promotePersonaState({ personas: [first, other], activeCollaboratorId: 'first' });
    usePersonaStore.setState({ personas: [first], activeCollaboratorId: 'first' });
    const before = await rawPersonaRow('other');
    await usePersonaStore.getState().saveWorldBookRules('first', [{ pattern: 'hello', flags: 'i', prompt: 'world' }]);
    const row = await rawPersonaRow('first');
    expect(row?.state === 'complete' && row.value.value.advanced.regexTriggers).toContain('world');
    expect(await rawPersonaRow('other')).toEqual(before);
    await expect(usePersonaStore.getState().saveWorldBookRules('first', [], { expectedPrevious: 'stale' })).rejects.toThrow('其他修改');
    expect(await rawPersonaRow('first')).toEqual(row);
  });

  it('does not edit a sealed collaborator through a stale worldbook drawer', async () => {
    const first = persona('first');
    await promotePersonaState({ personas: [first], activeCollaboratorId: 'first' });
    usePersonaStore.setState({ personas: [first] });
    const row = await rawPersonaRow('first');
    if (row?.state !== 'complete') throw new Error('Expected a complete fixture');
    const sealed = { ...row, value: { ...row.value, state: 'archive' } };
    await kvSet(getLocalDataRowKey(getPersonaObjectLocalDataRef('first')), sealed);
    await expect(usePersonaStore.getState().saveWorldBookRules('first', []))
      .rejects.toThrow('不在可编辑资料');
    expect(await rawPersonaRow('first')).toEqual(sealed);
  });

  it('does not publish a worldbook save after a durable write fails', async () => {
    const first = persona('first');
    const backend = createMemoryPersistenceBackend();
    setPersistenceBackendForTesting(backend);
    await promotePersonaState({ personas: [first], activeCollaboratorId: 'first' });
    usePersonaStore.setState({ personas: [first] });
    backend.kvApplyMutations = async () => { throw new Error('disk unavailable'); };
    await expect(usePersonaStore.getState().saveWorldBookRules('first', [{ pattern: 'x', flags: '', prompt: 'body' }])).rejects.toThrow();
    expect(usePersonaStore.getState().personas[0].advanced.regexTriggers).toBe(first.advanced.regexTriggers);
  });

  it('reloads only a missing collaborator and preserves unsaved changes in another', async () => {
    const first = persona('first');
    const other = persona('other');
    await promotePersonaState({ personas: [first, other], activeCollaboratorId: 'first' });
    usePersonaStore.setState({ personas: [{ ...other, name: 'unsaved name' }], activeCollaboratorId: 'other' });
    expect(await usePersonaStore.getState().reloadMissingCollaborator('first')).toBe(true);
    expect(usePersonaStore.getState().personas.find(item => item.id === 'other')?.name).toBe('unsaved name');
    expect(usePersonaStore.getState().activeCollaboratorId).toBe('other');
  });

  it('hydrates persona state from repository while keeping memory document bodies split', async () => {
    await promotePersonaState({
      personas: [persona('persona-1', 'repository body')],
      activeCollaboratorId: 'persona-1'
    });

    const shouldPersistAfterHydration = await usePersonaStore.getState().hydrateFromDb();
    const hydratedPersona = usePersonaStore.getState().personas.find((item) => item.id === 'persona-1');
    await usePersonaStore.getState().persistToDb();

    expect(shouldPersistAfterHydration).toBe(false);
    expect(hydratedPersona?.memory.referenceDocs[0]).toEqual(expect.objectContaining({
      id: 'doc-1',
      content: '',
      contentLoaded: false,
      charCount: 'repository body'.length
    }));
    // The first persistToDb self-activates the document domain (no legacy chunked-KV present),
    // so the persona memory body lands as a document row, not the legacy chunked-KV store.
    await expect(kvGet('persona-memory-doc-content-v2:persona-1:doc-1')).resolves.toBeNull();
    await expect(
      kvGet(getLocalDataRowKey(getDocumentObjectLocalDataRef('persona-memory-doc', 'persona-1:doc-1')))
    ).resolves.toEqual(expect.objectContaining({
      state: 'complete',
      value: expect.objectContaining({ content: 'repository body' })
    }));
  });

  it('skips repository commits when the persona directory is unchanged', async () => {
    const payload = {
      personas: [persona('persona-1', 'repository body')],
      activeCollaboratorId: 'persona-1',
      seededDefaultPersonaIds: []
    };
    await promotePersonaState(payload);
    usePersonaStore.setState({
      ...payload,
      hydrated: true
    });

    await usePersonaStore.getState().persistToDb();

    await expect(kvGet(getLocalDataCommitPointerKey('persona'))).resolves.toEqual({
      domain: 'persona',
      version: LOCAL_DATA_SCHEMA_VERSION,
      committedAt: 100,
      commitId: 'persona:initial'
    });
    // The first persistToDb self-activates the document domain (no legacy chunked-KV present),
    // so the persona memory body lands as a document row, not the legacy chunked-KV store.
    await expect(kvGet('persona-memory-doc-content-v2:persona-1:doc-1')).resolves.toBeNull();
    await expect(
      kvGet(getLocalDataRowKey(getDocumentObjectLocalDataRef('persona-memory-doc', 'persona-1:doc-1')))
    ).resolves.toEqual(expect.objectContaining({
      state: 'complete',
      value: expect.objectContaining({ content: 'repository body' })
    }));
  });

  it('writes persona state to repository and tombstones stale collaborator rows when active', async () => {
    await promotePersonaState({
      personas: [persona('persona-old')],
      activeCollaboratorId: 'persona-old'
    });
    usePersonaStore.setState({
      personas: [persona('persona-new')],
      activeCollaboratorId: 'persona-new',
      seededDefaultPersonaIds: [],
      hydrated: true
    });

    await usePersonaStore.getState().persistToDb();

    const legacyPayload = await kvGet('persona-state-v2');
    const staleRow = await kvGet(getLocalDataRowKey(getPersonaObjectLocalDataRef('persona-old')));
    const activeRow = await kvGet(getLocalDataRowKey(getPersonaObjectLocalDataRef('persona-new')));

    expect(legacyPayload).toBeNull();
    expect(staleRow).toEqual(expect.objectContaining({
      state: 'deleted'
    }));
    expect(activeRow).toEqual(expect.objectContaining({
      state: 'complete',
      value: expect.objectContaining({
        id: 'persona-new',
        active: true
      })
    }));
  });

  it('returns a dangling stored active pointer verbatim, never substituting the first persona', async () => {
    // The stored active-collaborator pointer references a persona with no live row. The
    // persistence read is a faithful projection of stored facts: it must surface the real
    // (dangling) pointer, not silently self-repair to "the first persona". Resolution is the
    // store hydrate's job, against the list the user actually sees.
    await promotePersonaState({
      personas: [persona('persona-1')],
      activeCollaboratorId: 'ghost-collaborator'
    });

    const payload = await readPersonaStateFromLocalDataRepositoryIfActive();

    expect(payload?.activeCollaboratorId).toBe('ghost-collaborator');
    expect(payload?.personas.map((item) => item.id)).toEqual(['persona-1']);
  });

  it('degrades a dangling active pointer only at the visible-list resolution in store hydrate', async () => {
    await promotePersonaState({
      personas: [persona('persona-1')],
      activeCollaboratorId: 'ghost-collaborator'
    });

    await usePersonaStore.getState().hydrateFromDb();

    const { personas, activeCollaboratorId } = usePersonaStore.getState();
    // The dangling pointer never survives into store truth, and it never becomes null while a
    // live persona exists: it degrades to a persona present in the hydrated (visible) list.
    expect(activeCollaboratorId).not.toBe('ghost-collaborator');
    expect(activeCollaboratorId).not.toBeNull();
    expect(personas.map((item) => item.id)).toContain(activeCollaboratorId);
  });

  it('self-activates the persona directory on the first ordinary save of a fresh install', async () => {
    expect(await readActiveSource()).toBeNull();

    await writePersonaState({
      personas: [persona('persona-1')],
      activeCollaboratorId: 'persona-1',
      seededDefaultPersonaIds: []
    });

    const active = await readActiveSource();
    expect(active?.activeDataSource).toBe('repository');
    expect(active?.domains.persona?.commitId).toBeTruthy();
    expect(await kvGet('persona-state-v2')).toBeNull();
    expect(await rawPersonaRow('persona-1')).toEqual(expect.objectContaining({
      state: 'complete',
      value: expect.objectContaining({ id: 'persona-1', active: true })
    }));
    expect((await readDomainMeta()).totalObjectCount).toBe(1);
  });

  it('self-activates an empty fresh persona directory so the active source is explicit', async () => {
    await writePersonaState({
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    });

    const active = await readActiveSource();
    expect(active?.activeDataSource).toBe('repository');
    expect(active?.domains.persona?.commitId).toBeTruthy();
    expect(await kvGet('persona-state-v2')).toBeNull();
    const meta = await readDomainMeta();
    expect(meta.totalObjectCount).toBe(0);
    expect(meta.activeObjectCount).toBe(0);
  });

  it('does not self-activate over an inactive legacy persona-state-v2 directory', async () => {
    await kvSet('persona-state-v2', {
      personas: [persona('legacy-persona')],
      activeCollaboratorId: 'legacy-persona',
      seededDefaultPersonaIds: []
    });

    await writePersonaState({
      personas: [persona('new-persona')],
      activeCollaboratorId: 'new-persona',
      seededDefaultPersonaIds: []
    });

    expect(await readActiveSource()).toBeNull();
    expect(await rawPersonaRow('new-persona')).toBeNull();
    expect(await kvGet('persona-state-v2')).toEqual(expect.objectContaining({
      activeCollaboratorId: 'new-persona',
      personas: [expect.objectContaining({ id: 'new-persona' })]
    }));
  });
});
