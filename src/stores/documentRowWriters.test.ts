import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDocumentLocalDataUnitOfWork,
  createLocalDataKvBackend,
  createLocalDataRepository,
  getDocumentDomainMetaLocalDataRef,
  getDocumentObjectLocalDataRef,
  getLocalDataActiveDataSourceKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type DocumentBodyRow,
  type DocumentDomainMetaRow,
  type DocumentLocalDataObjectKind,
  type DocumentObjectSeed,
  type LocalDataActiveDataSourceRow,
  type LocalDataCommitMeta,
  type LocalDataStoredRow
} from '../engines/localData';
import {
  kvGet,
  kvSet,
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../infrastructure/persistence';
import { commitDocumentRowChangesIfActive, readDocumentBodyIfActive } from './documentLocalDataPersistence';

let commitCount = 0;

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
      return Array.from(getStore(storeName).entries()).map(([key, value]) => ({ key, value: value as T }));
    },
    async dbStoreKeys(storeName: string) {
      return Array.from(getStore(storeName).keys());
    },
    async dbStoreClear(storeName: string) {
      getStore(storeName).clear();
    },
    async kvApplyMutations(mutations: PersistedKvMutation[]) {
      commitCount += 1;
      const store = getStore('kv');
      for (const mutation of mutations) {
        if (mutation.type === 'set') store.set(mutation.key, mutation.value);
        else store.delete(mutation.key);
      }
    },
    async kvReplaceAll(entries) {
      stores.set('kv', new Map(entries.map((entry) => [entry.key, entry.value])));
    }
  };
}

function workspaceDocSeed(seed: {
  id: string;
  content?: string;
  declaredCharCount?: number;
  missing?: boolean;
  kind?: DocumentLocalDataObjectKind;
  ownerRefs?: DocumentObjectSeed['ownerRefs'];
  updatedAt?: number;
}): DocumentObjectSeed {
  const content = seed.content ?? '';
  const ownerRefs = seed.ownerRefs ?? [{ kind: 'workspace-doc', id: seed.id, label: seed.id }];
  return {
    id: seed.id,
    kind: seed.kind ?? 'workspace-reference-doc',
    title: seed.id,
    summary: '',
    declaredCharCount: seed.declaredCharCount ?? content.length,
    contentLoaded: !seed.missing,
    body: seed.missing
      ? { source: 'missing', content: null, keys: [], chunkIndexes: [], chunkCount: 0, contiguous: false }
      : { source: 'inline', content, keys: [], chunkIndexes: [], chunkCount: 0, contiguous: true },
    ownerRefs,
    updatedAt: seed.updatedAt ?? 1,
    expectsBody: true
  };
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
      document: { domain: 'document', version: meta.version, committedAt: meta.committedAt, commitId: meta.commitId }
    }
  };
}

async function promoteDocumentState(seeds: DocumentObjectSeed[]) {
  const repository = createLocalDataRepository({
    backend: createLocalDataKvBackend(),
    now: () => 100,
    createCommitId: () => 'document:initial'
  });
  const meta = await repository.commit(buildDocumentLocalDataUnitOfWork({
    state: { documents: seeds },
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: 100
  }));
  await kvSet(getLocalDataActiveDataSourceKey(), activeSourceRow(meta));
}

function rawRow(kind: DocumentLocalDataObjectKind, id: string) {
  return kvGet<LocalDataStoredRow<DocumentBodyRow>>(getLocalDataRowKey(getDocumentObjectLocalDataRef(kind, id)));
}

async function readDomainMeta() {
  const row = await kvGet<LocalDataStoredRow<DocumentDomainMetaRow>>(
    getLocalDataRowKey(getDocumentDomainMetaLocalDataRef())
  );
  if (!row || row.state !== 'complete') throw new Error('document domain meta is not complete');
  return row.value;
}

describe('commitDocumentRowChangesIfActive', () => {
  beforeEach(() => {
    commitCount = 0;
    setPersistenceBackendForTesting(createMemoryPersistenceBackend());
  });

  afterEach(() => {
    setPersistenceBackendForTesting(null);
  });

  it.each(['timedOut', 'unloaded'] as const)('does not turn a %s read into a missing body', async (state) => {
    await promoteDocumentState([workspaceDocSeed({ id: 'doc-wait', content: 'retained' })]);
    const row = await rawRow('workspace-reference-doc', 'doc-wait');
    await kvSet(getLocalDataRowKey(getDocumentObjectLocalDataRef('workspace-reference-doc', 'doc-wait')), {
      ...row, state, reason: 'temporarily unavailable'
    });
    await expect(readDocumentBodyIfActive('workspace-reference-doc', 'doc-wait'))
      .rejects.toThrow('temporarily unreadable');
  });

  it('upserts one document body and counts it in the domain meta in a single commit', async () => {
    await promoteDocumentState([]);
    commitCount = 0;

    const wrote = await commitDocumentRowChangesIfActive({
      changes: [{ type: 'upsert', seed: workspaceDocSeed({ id: 'doc-a', content: 'hello' }) }]
    });

    expect(wrote).toBe(true);
    expect(commitCount).toBe(1);
    const row = await rawRow('workspace-reference-doc', 'doc-a');
    expect(row?.state).toBe('complete');
    const meta = await readDomainMeta();
    expect(meta.objectCounts['workspace-reference-doc']).toBe(1);
    expect(meta.activeObjectCount).toBe(1);
    expect(meta.totalObjectCount).toBe(1);
    expect(meta.totalCharCount).toBe(5);
  });

  it('writes a missing body as an incomplete row, never an empty loaded body', async () => {
    await promoteDocumentState([]);
    commitCount = 0;

    await commitDocumentRowChangesIfActive({
      changes: [{ type: 'upsert', seed: workspaceDocSeed({ id: 'doc-missing', declaredCharCount: 10, missing: true }) }]
    });

    const row = await rawRow('workspace-reference-doc', 'doc-missing');
    expect(row?.state).toBe('incomplete');
    const meta = await readDomainMeta();
    expect(meta.missingBodyCount).toBe(1);
    expect(meta.activeObjectCount).toBe(0);
    expect(meta.totalObjectCount).toBe(1);
    expect(meta.totalCharCount).toBe(0);
  });

  it('writes a chunk-incomplete body as an incomplete row and counts it as incompleteChunk', async () => {
    await promoteDocumentState([]);
    commitCount = 0;

    const chunkedIncomplete: DocumentObjectSeed = {
      id: 'doc-chunked',
      kind: 'workspace-reference-doc',
      title: 'doc-chunked',
      summary: '',
      declaredCharCount: 10,
      contentLoaded: false,
      body: { source: 'chunked', content: 'partial', keys: ['chunk-key-0'], chunkIndexes: [0], chunkCount: 2, contiguous: false },
      ownerRefs: [{ kind: 'workspace-doc', id: 'doc-chunked', label: 'doc-chunked' }],
      updatedAt: 1,
      expectsBody: true
    };

    await commitDocumentRowChangesIfActive({
      changes: [{ type: 'upsert', seed: chunkedIncomplete }]
    });

    const row = await rawRow('workspace-reference-doc', 'doc-chunked');
    expect(row?.state).toBe('incomplete');
    const meta = await readDomainMeta();
    expect(meta.incompleteChunkCount).toBe(1);
    expect(meta.missingBodyCount).toBe(0);
    expect(meta.activeObjectCount).toBe(0);
    expect(meta.totalObjectCount).toBe(1);
    expect(meta.totalCharCount).toBe(0);
  });

  it('updates the meta incrementally when an existing body grows, without double counting', async () => {
    await promoteDocumentState([workspaceDocSeed({ id: 'doc-a', content: 'hello' })]);
    commitCount = 0;

    await commitDocumentRowChangesIfActive({
      changes: [{ type: 'upsert', seed: workspaceDocSeed({ id: 'doc-a', content: 'hello world', updatedAt: 2 }) }]
    });

    const meta = await readDomainMeta();
    expect(meta.totalObjectCount).toBe(1);
    expect(meta.activeObjectCount).toBe(1);
    expect(meta.totalCharCount).toBe(11);
  });

  it('writes several documents and one refreshed domain meta in one commit', async () => {
    await promoteDocumentState([workspaceDocSeed({ id: 'doc-a', content: 'aaa' })]);
    commitCount = 0;

    await commitDocumentRowChangesIfActive({
      changes: [
        { type: 'upsert', seed: workspaceDocSeed({ id: 'doc-b', content: 'bb' }) },
        { type: 'upsert', seed: workspaceDocSeed({ id: 'doc-c', kind: 'persona-memory-doc', content: 'cccc' }) }
      ]
    });

    expect(commitCount).toBe(1);
    const meta = await readDomainMeta();
    expect(meta.objectCounts['workspace-reference-doc']).toBe(2);
    expect(meta.objectCounts['persona-memory-doc']).toBe(1);
    expect(meta.totalObjectCount).toBe(3);
    expect(meta.totalCharCount).toBe(3 + 2 + 4);
  });

  it('tombstones a document and drops it from the meta', async () => {
    await promoteDocumentState([
      workspaceDocSeed({ id: 'doc-a', content: 'aaa' }),
      workspaceDocSeed({ id: 'doc-b', content: 'bb' })
    ]);
    const docARowBefore = await rawRow('workspace-reference-doc', 'doc-a');
    commitCount = 0;

    await commitDocumentRowChangesIfActive({
      changes: [{ type: 'delete', kind: 'workspace-reference-doc', id: 'doc-b' }]
    });

    expect((await rawRow('workspace-reference-doc', 'doc-b'))?.state).toBe('deleted');
    expect(await rawRow('workspace-reference-doc', 'doc-a')).toEqual(docARowBefore);
    const meta = await readDomainMeta();
    expect(meta.objectCounts['workspace-reference-doc']).toBe(1);
    expect(meta.totalObjectCount).toBe(1);
    expect(meta.totalCharCount).toBe(3);
  });

  it('throws when a change set writes the same document twice', async () => {
    await promoteDocumentState([workspaceDocSeed({ id: 'doc-a', content: 'aaa' })]);
    commitCount = 0;

    await expect(commitDocumentRowChangesIfActive({
      changes: [
        { type: 'upsert', seed: workspaceDocSeed({ id: 'doc-a', content: 'edit' }) },
        { type: 'delete', kind: 'workspace-reference-doc', id: 'doc-a' }
      ]
    })).rejects.toThrow(/same document twice/);
    expect(commitCount).toBe(0);
  });

  it('returns false without writing when the document repository is inactive', async () => {
    const wrote = await commitDocumentRowChangesIfActive({
      changes: [{ type: 'upsert', seed: workspaceDocSeed({ id: 'doc-a', content: 'a' }) }]
    });
    expect(wrote).toBe(false);
    expect(commitCount).toBe(0);
  });
});
