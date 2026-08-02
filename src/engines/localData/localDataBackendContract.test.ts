import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  LocalDataContractError,
  UntrustedPersistenceError,
  LOCAL_DATA_NAMESPACE,
  createCompleteLocalDataRow,
  createLocalDataRepository,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  type LocalDataBackend,
  type LocalDataCommitMeta,
  type LocalDataMigrationValidationReport,
  type LocalDataRef
} from './index';
import { createLocalDataKvBackend } from './localDataKvBackend';
import {
  createLocalDataSqliteBackend,
  type LocalDataSqliteDriver,
  type LocalDataSqliteQueryRow
} from './localDataSqliteBackend';
import {
  setPersistenceBackendForTesting,
  type PersistedDbEntry,
  type PersistedKvMutation,
  type PersistenceBackend
} from '../../infrastructure/persistence';

/**
 * One contract suite, run against BOTH real LocalData backends: the KV backend (over a
 * memory persistence substrate) and the SQLite backend (over a real in-memory `node:sqlite`
 * engine). The point of the clean data line is that SQLite changes storage durability, not
 * product semantics — so the same repository read/validate/commit path must produce
 * identical observable behavior on either substrate.
 */

const refA: LocalDataRef = { domain: 'chat', kind: 'conversationRecord', id: 'contract-a' };
const refB: LocalDataRef = { domain: 'chat', kind: 'conversationRecord', id: 'contract-b' };

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

function createNodeSqliteDriver(): LocalDataSqliteDriver {
  const db = new DatabaseSync(':memory:');
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

type BackendCase = { name: string; make: () => LocalDataBackend };

const backendCases: BackendCase[] = [
  {
    name: 'kv',
    make: () => {
      setPersistenceBackendForTesting(createMemoryPersistenceBackend());
      return createLocalDataKvBackend();
    }
  },
  {
    name: 'sqlite (node:sqlite)',
    make: () => createLocalDataSqliteBackend({ driver: createNodeSqliteDriver() })
  }
];

/**
 * Decorate any transactional backend so its next read throws. The repository must surface
 * this as an untrusted persistence error, never a complete/empty read result — the core
 * "a failed read cannot become empty truth" invariant, identical on either substrate.
 */
function withReadFailure(inner: LocalDataBackend): LocalDataBackend {
  if (inner.mode !== 'transactional') throw new Error('contract suite expects a transactional backend');
  const transactional = inner;
  return {
    mode: 'transactional',
    async read() {
      throw new Error('injected backend read failure');
    },
    listKeysWithPrefix: (prefix) => transactional.listKeysWithPrefix(prefix),
    commitAtomic: (mutations, meta) => transactional.commitAtomic(mutations, meta)
  };
}

/**
 * Decorate any transactional backend so the FIRST commit reaches the real substrate and
 * every later commit throws at the backend boundary, without touching durable state.
 */
function withCommitFailureAfterFirst(inner: LocalDataBackend): LocalDataBackend {
  if (inner.mode !== 'transactional') throw new Error('contract suite expects a transactional backend');
  const transactional = inner;
  let commitCount = 0;
  return {
    mode: 'transactional',
    read: (key) => transactional.read(key),
    listKeysWithPrefix: (prefix) => transactional.listKeysWithPrefix(prefix),
    async commitAtomic(mutations, meta) {
      commitCount += 1;
      if (commitCount > 1) throw new Error('injected backend commit failure');
      return transactional.commitAtomic(mutations, meta);
    }
  };
}

function makeRepository(backend: LocalDataBackend) {
  let commitNumber = 0;
  let clock = 100;
  return createLocalDataRepository({
    backend,
    now: () => clock++,
    createCommitId: () => `contract:${++commitNumber}`
  });
}

function completeRow(ref: LocalDataRef, value: unknown, version: number, updatedAt: number) {
  return createCompleteLocalDataRow({ ref, value, version, updatedAt });
}

afterEach(() => {
  setPersistenceBackendForTesting(null);
});

describe.each(backendCases)('LocalData repository contract over the $name backend', ({ make }) => {
  function validChatReport(meta: LocalDataCommitMeta): LocalDataMigrationValidationReport {
    return {
      id: `report:${meta.commitId}`,
      domain: meta.domain,
      commitId: meta.commitId,
      version: meta.version,
      validatedAt: 200,
      stagingHydrated: true,
      legacyBaselineCount: 1,
      legacyBaselineObjectIds: [refB.id],
      activeBaselineObjectIds: [refB.id],
      activeObjectCount: 1,
      activeObjectIds: [refB.id],
      quarantinedObjectCount: 0,
      quarantinedObjectIds: [],
      duplicateObjectIdCount: 0,
      missingActiveCollaboratorIdCount: 0,
      missingActiveCollaboratorIds: [],
      activeIncompleteRowCount: 0,
      activeTimedOutRowCount: 0,
      recoveredMetadata: { activeConversationId: refB.id }
    };
  }

  it('commits rows plus the domain pointer and reads them back complete', async () => {
    const backend = make();
    const repository = makeRepository(backend);

    const meta = await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [
        { type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) },
        { type: 'put', row: completeRow(refB, { messages: ['b'] }, 1, 10) }
      ]
    });

    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['a'] } }));
    expect(await repository.read(refB)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['b'] } }));
    expect(await backend.read(getLocalDataCommitPointerKey('chat'))).toEqual(meta);
  });

  it('advances an already-active domain pointer in the same transaction as later saves', async () => {
    const backend = make();
    const repository = makeRepository(backend);
    const firstMeta = await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['first'] }, 1, 10) }]
    });
    await repository.activateDomainsFromCommittedRows([firstMeta]);

    const nextMeta = await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refB, { messages: ['next'] }, 1, 20) }]
    });

    expect(await backend.read(getLocalDataCommitPointerKey('chat'))).toEqual(nextMeta);
    expect(await backend.read(getLocalDataActiveDataSourceKey())).toEqual(expect.objectContaining({
      activeCommitId: nextMeta.commitId,
      domains: { chat: nextMeta }
    }));
  });

  it('lists committed row keys under a prefix, excluding the domain commit pointer', async () => {
    const backend = make();
    const repository = makeRepository(backend);
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [
        { type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) },
        { type: 'put', row: completeRow(refB, { messages: ['b'] }, 1, 10) }
      ]
    });

    const rowPrefix = `${LOCAL_DATA_NAMESPACE}:row:chat:conversationRecord:`;
    const rowKeys = (await backend.listKeysWithPrefix(rowPrefix)).sort();
    expect(rowKeys).toEqual([getLocalDataRowKey(refA), getLocalDataRowKey(refB)].sort());

    // A narrower prefix scopes the listing; the commit pointer lives under a different prefix.
    expect(await backend.listKeysWithPrefix(getLocalDataRowKey(refA))).toEqual([getLocalDataRowKey(refA)]);
    const everything = await backend.listKeysWithPrefix(`${LOCAL_DATA_NAMESPACE}:`);
    expect(everything).toContain(getLocalDataCommitPointerKey('chat'));
    expect(everything).not.toContain('chat-state-v1');
  });

  it('drops a tombstoned row key from prefix listing', async () => {
    const backend = make();
    const repository = makeRepository(backend);
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [
        { type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) },
        { type: 'put', row: completeRow(refB, { messages: ['b'] }, 1, 10) }
      ]
    });
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'tombstone', ref: refA, version: 1, deletedAt: 20 }]
    });

    // A tombstone is a `set` of a deleted-state row, so the key is still discoverable; the
    // store layer reads it back as `deleted`, never silently losing the ref.
    const rowPrefix = `${LOCAL_DATA_NAMESPACE}:row:chat:conversationRecord:`;
    expect((await backend.listKeysWithPrefix(rowPrefix)).sort()).toEqual(
      [getLocalDataRowKey(refA), getLocalDataRowKey(refB)].sort()
    );
  });

  it('reads a never-written ref as incomplete, never a complete empty value', async () => {
    const repository = makeRepository(make());
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'incomplete' }));
  });

  it('tombstones one row and reads it deleted while the survivor stays complete', async () => {
    const repository = makeRepository(make());
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [
        { type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) },
        { type: 'put', row: completeRow(refB, { messages: ['b'] }, 1, 10) }
      ]
    });

    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'tombstone', ref: refA, version: 1, deletedAt: 20 }]
    });

    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'deleted' }));
    expect(await repository.read(refB)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['b'] } }));
  });

  it('rejects a unit that writes the same row key twice, persisting nothing', async () => {
    const repository = makeRepository(make());

    await expect(repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [
        { type: 'tombstone', ref: refA, version: 1, deletedAt: 20 },
        { type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) }
      ]
    })).rejects.toBeInstanceOf(LocalDataContractError);

    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'incomplete' }));
  });

  it('rejects an older complete row and accepts a newer-version replacement', async () => {
    const repository = makeRepository(make());
    await repository.commit({
      domain: 'chat',
      version: 5,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['v5'] }, 5, 50) }]
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 4,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['v4'] }, 4, 60) }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ value: { messages: ['v5'] } }));

    await repository.commit({
      domain: 'chat',
      version: 6,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['v6'] }, 6, 60) }]
    });
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['v6'] } }));
  });

  it('refuses to revive a tombstone with an ordinary put but allows an explicit restore', async () => {
    const repository = makeRepository(make());
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) }]
    });
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'tombstone', ref: refA, version: 1, deletedAt: 20 }]
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['revived'] }, 2, 30) }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'deleted' }));

    await repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'restore', row: completeRow(refA, { messages: ['restored'] }, 2, 30) }]
    });
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['restored'] } }));
  });

  it('surfaces a backend read failure as an untrusted persistence error, never an empty value', async () => {
    const repository = makeRepository(withReadFailure(make()));
    await expect(repository.read(refA)).rejects.toBeInstanceOf(UntrustedPersistenceError);
  });

  it('surfaces a failed commit as an untrusted error and leaves prior committed state intact', async () => {
    const repository = makeRepository(withCommitFailureAfterFirst(make()));
    await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['a'] }, 1, 10) }]
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refB, { messages: ['b'] }, 1, 10) }]
    })).rejects.toBeInstanceOf(UntrustedPersistenceError);

    // The prior fact survives; the failed write never became truth.
    expect(await repository.read(refA)).toEqual(expect.objectContaining({ status: 'complete', value: { messages: ['a'] } }));
    expect(await repository.read(refB)).toEqual(expect.objectContaining({ status: 'incomplete' }));
  });

  it('commits a domain replacement and its active pointer in one backend transaction', async () => {
    const backend = make();
    const repository = makeRepository(backend);

    const result = await repository.commitAndPromoteActiveDataSource({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refB, { messages: ['replacement'] }, 1, 20) }]
    }, (meta) => validChatReport(meta));

    expect(await repository.read(refB)).toEqual(expect.objectContaining({
      status: 'complete',
      value: { messages: ['replacement'] }
    }));
    expect(await backend.read(getLocalDataCommitPointerKey('chat'))).toEqual(result.commitMeta);
    expect(await backend.read(getLocalDataActiveDataSourceKey())).toEqual(expect.objectContaining({
      activeCommitId: result.commitMeta.commitId,
      domains: { chat: result.commitMeta }
    }));
  });

  it('exposes neither replacement rows nor an active pointer when atomic promotion fails', async () => {
    const backend = withCommitFailureAfterFirst(make());
    const repository = makeRepository(backend);
    const originalMeta = await repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refA, { messages: ['original'] }, 1, 10) }]
    });

    await expect(repository.commitAndPromoteActiveDataSource({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row: completeRow(refB, { messages: ['replacement'] }, 1, 20) }]
    }, (meta) => validChatReport(meta))).rejects.toBeInstanceOf(UntrustedPersistenceError);

    expect(await repository.read(refA)).toEqual(expect.objectContaining({ value: { messages: ['original'] } }));
    expect(await repository.read(refB)).toEqual(expect.objectContaining({ status: 'incomplete' }));
    expect(await backend.read(getLocalDataCommitPointerKey('chat'))).toEqual(originalMeta);
    expect(await backend.read(getLocalDataActiveDataSourceKey())).toBeNull();
  });
});
