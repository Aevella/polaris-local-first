import { describe, expect, it, vi } from 'vitest';
import {
  LocalDataContractError,
  UntrustedPersistenceError,
  buildLocalDataCommitMutations,
  createCompleteLocalDataRow,
  createIncompleteLocalDataRow,
  createLocalDataRepository,
  createTimedOutLocalDataRow,
  createUnloadedLocalDataRow,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  type LocalDataBackendMutation,
  type LocalDataActiveDataSourceRow,
  type LocalDataRef,
  type LocalDataMigrationValidationReport,
  type LocalDataStagedBackend,
  type LocalDataStoredRow,
  type LocalDataTransactionalBackend
} from './index';

const conversationRef: LocalDataRef = {
  domain: 'chat',
  kind: 'conversationRecord',
  id: 'c-1'
};

function createTransactionalBackend(
  rows = new Map<string, unknown>()
): LocalDataTransactionalBackend & { committed: LocalDataBackendMutation[][] } {
  const committed: LocalDataBackendMutation[][] = [];
  return {
    mode: 'transactional',
    committed,
    async read<T>(key: string) {
      return (rows.get(key) as T | undefined) ?? null;
    },
    async listKeysWithPrefix(prefix: string) {
      return Array.from(rows.keys()).filter((key) => key.startsWith(prefix));
    },
    async commitAtomic(mutations) {
      committed.push(mutations);
      for (const mutation of mutations) {
        if (mutation.type === 'set') {
          rows.set(mutation.key, mutation.value as LocalDataStoredRow);
        } else {
          rows.delete(mutation.key);
        }
      }
    }
  };
}

function createPromotionReport(
  overrides: Partial<LocalDataMigrationValidationReport> = {}
): LocalDataMigrationValidationReport {
  return {
    id: 'report-1',
    domain: 'chat',
    commitId: 'chat-commit',
    version: 2,
    validatedAt: 25,
    stagingHydrated: true,
    legacyBaselineCount: 2,
    legacyBaselineObjectIds: ['c-1', 'c-2'],
    activeBaselineObjectIds: ['c-1', 'c-2'],
    activeObjectCount: 2,
    activeObjectIds: ['c-1', 'c-2'],
    quarantinedObjectCount: 0,
    quarantinedObjectIds: [],
    duplicateObjectIdCount: 0,
    missingActiveCollaboratorIdCount: 0,
    missingActiveCollaboratorIds: [],
    activeIncompleteRowCount: 0,
    activeTimedOutRowCount: 0,
    recoveredMetadata: {
      activeConversationId: 'c-1'
    },
    ...overrides
  };
}

function createCollectionPromotionReport(
  overrides: Partial<LocalDataMigrationValidationReport> = {}
): LocalDataMigrationValidationReport {
  return createPromotionReport({
    domain: 'collection',
    commitId: 'collection-commit',
    version: 4,
    validatedAt: 25,
    legacyBaselineCount: 0,
    legacyBaselineObjectIds: [],
    activeBaselineObjectIds: [],
    activeObjectCount: 0,
    activeObjectIds: [],
    recoveredMetadata: {
      activeProjectId: null
    },
    ...overrides
  });
}

describe('createLocalDataRepository', () => {
  it('maps stored row states into the five-state read contract', async () => {
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['hello'] },
      version: 1,
      updatedAt: 10
    });
    const unloadedRef: LocalDataRef = { ...conversationRef, id: 'c-unloaded' };
    const incompleteRef: LocalDataRef = { ...conversationRef, id: 'c-incomplete' };
    const timedOutRef: LocalDataRef = { ...conversationRef, id: 'c-timeout' };
    const deletedRef: LocalDataRef = { ...conversationRef, id: 'c-deleted' };
    const rows = new Map<string, LocalDataStoredRow>([
      [completeRow.key, completeRow],
      [getLocalDataRowKey(unloadedRef), createUnloadedLocalDataRow({
        ref: unloadedRef,
        version: 1,
        updatedAt: 11,
        meta: { messageCount: 3 }
      })],
      [getLocalDataRowKey(incompleteRef), createIncompleteLocalDataRow({
        ref: incompleteRef,
        version: 1,
        updatedAt: 12,
        reason: 'message body missing',
        missingKeys: ['body-key']
      })],
      [getLocalDataRowKey(timedOutRef), createTimedOutLocalDataRow({
        ref: timedOutRef,
        version: 1,
        updatedAt: 13,
        reason: 'backend did not prove success'
      })],
      [getLocalDataRowKey(deletedRef), {
        schemaVersion: 1,
        key: getLocalDataRowKey(deletedRef),
        ref: deletedRef,
        version: 2,
        updatedAt: 14,
        state: 'deleted',
        deletedAt: 14
      }]
    ]);
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(rows)
    });

    await expect(repository.read(conversationRef)).resolves.toEqual(expect.objectContaining({
      status: 'complete',
      value: { messages: ['hello'] }
    }));
    await expect(repository.read(unloadedRef)).resolves.toEqual(expect.objectContaining({
      status: 'unloaded'
    }));
    await expect(repository.read(incompleteRef)).resolves.toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'message body missing',
      missingKeys: ['body-key']
    }));
    await expect(repository.read(timedOutRef)).resolves.toEqual(expect.objectContaining({
      status: 'timedOut',
      reason: 'backend did not prove success'
    }));
    await expect(repository.read(deletedRef)).resolves.toEqual(expect.objectContaining({
      status: 'deleted',
      deletedAt: 14
    }));
  });

  it('treats a missing row as incomplete instead of a complete empty value', async () => {
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend()
    });

    await expect(repository.read(conversationRef)).resolves.toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'Local data row is missing.',
      missingKeys: [getLocalDataRowKey(conversationRef)]
    }));
  });

  it('treats persisted rows with unknown states as incomplete instead of deleted', async () => {
    const rows = new Map<string, unknown>([
      [getLocalDataRowKey(conversationRef), {
        schemaVersion: 1,
        key: getLocalDataRowKey(conversationRef),
        ref: conversationRef,
        version: 1,
        updatedAt: 10,
        state: 'mystery',
        deletedAt: 10
      }]
    ]);
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(rows)
    });

    await expect(repository.read(conversationRef)).resolves.toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'Local data row state is invalid.',
      missingKeys: [getLocalDataRowKey(conversationRef)]
    }));
  });

  it('treats persisted rows with mismatched keys or refs as incomplete', async () => {
    const wrongKeyRef: LocalDataRef = { ...conversationRef, id: 'wrong-key' };
    const wrongRef: LocalDataRef = { ...conversationRef, id: 'wrong-ref' };
    const rows = new Map<string, unknown>([
      [getLocalDataRowKey(wrongKeyRef), {
        schemaVersion: 1,
        key: 'local-data-v1:row:chat:conversationRecord:not-this-row',
        ref: wrongKeyRef,
        version: 1,
        updatedAt: 10,
        state: 'complete',
        value: { messages: [] }
      }],
      [getLocalDataRowKey(wrongRef), {
        schemaVersion: 1,
        key: getLocalDataRowKey(wrongRef),
        ref: conversationRef,
        version: 1,
        updatedAt: 10,
        state: 'complete',
        value: { messages: [] }
      }]
    ]);
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(rows)
    });

    await expect(repository.read(wrongKeyRef)).resolves.toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'Local data row key does not match requested ref.'
    }));
    await expect(repository.read(wrongRef)).resolves.toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'Local data row ref does not match requested ref.'
    }));
  });

  it('throws an untrusted persistence error when backend reads time out', async () => {
    const repository = createLocalDataRepository({
      backend: {
        mode: 'transactional',
        async read() {
          throw new Error('IndexedDB transaction timeout');
        },
        async listKeysWithPrefix() {
          return [];
        },
        async commitAtomic() {
          throw new Error('not used');
        }
      }
    });

    await expect(repository.read(conversationRef)).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'timeout'
    });
  });

  it('commits transactional backends as one atomic mutation batch with a domain pointer', async () => {
    const row = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: [] },
      version: 2,
      updatedAt: 20
    });
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({
      backend,
      now: () => 20,
      createCommitId: () => 'commit-1'
    });

    const meta = await repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'put', row }]
    });

    expect(meta).toEqual({
      commitId: 'commit-1',
      domain: 'chat',
      version: 2,
      committedAt: 20
    });
    expect(backend.committed).toHaveLength(1);
    expect(backend.committed[0]).toEqual(expect.arrayContaining([
      { type: 'set', key: row.key, value: row },
      {
        type: 'set',
        key: getLocalDataCommitPointerKey('chat'),
        value: {
          domain: 'chat',
          version: 2,
          committedAt: 20,
          commitId: 'commit-1'
        }
      }
    ]));
    expect(backend.committed[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: getLocalDataActiveDataSourceKey() })
    ]));
  });

  it('rejects units that write the same row key more than once', async () => {
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['complete'] },
      version: 2,
      updatedAt: 20
    });
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({
      backend,
      now: () => 20,
      createCommitId: () => 'commit-duplicate-key'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [
        { type: 'tombstone', ref: conversationRef, version: 2, deletedAt: 20 },
        { type: 'put', row: completeRow }
      ]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('rejects non-complete rows that would overwrite an existing complete row', async () => {
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['already complete'] },
      version: 2,
      updatedAt: 20
    });
    const unloadedRow = createUnloadedLocalDataRow({
      ref: conversationRef,
      version: 3,
      updatedAt: 30,
      meta: { messageCount: 1, latestMessageTimestamp: 20 }
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [completeRow.key, completeRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'commit-downgrade'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'put', row: unloadedRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('rejects a same-version complete row whose updatedAt is older than the existing row', async () => {
    const existingRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['newer'] },
      version: 2,
      updatedAt: 40
    });
    const staleRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['stale'] },
      version: 2,
      updatedAt: 30
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [existingRow.key, existingRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 50,
      createCommitId: () => 'commit-stale'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'put', row: staleRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('allows a same-version overwrite when the existing row was stamped by a clock that ran ahead', async () => {
    const futureRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['written while the clock ran ahead'] },
      version: 2,
      updatedAt: 1_000
    });
    const honestRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['written after the clock was corrected'] },
      version: 2,
      updatedAt: 60
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [futureRow.key, futureRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 60,
      createCommitId: () => 'commit-clock-rollback'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'put', row: honestRow }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'commit-clock-rollback'
    }));
    expect(backend.committed).toHaveLength(1);
    expect(backend.committed[0]).toContainEqual({
      type: 'set',
      key: honestRow.key,
      value: honestRow
    });
  });

  it('still rejects a version regression even when the existing row was stamped by a future clock', async () => {
    const futureRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['future v3'] },
      version: 3,
      updatedAt: 1_000
    });
    const olderVersionRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['v2'] },
      version: 2,
      updatedAt: 60
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [futureRow.key, futureRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 60,
      createCommitId: () => 'commit-version-regression'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 2,
      mutations: [{ type: 'put', row: olderVersionRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('allows complete rows to replace existing incomplete rows', async () => {
    const incompleteRow = createIncompleteLocalDataRow({
      ref: conversationRef,
      version: 2,
      updatedAt: 20,
      reason: 'old body missing'
    });
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['restored'] },
      version: 3,
      updatedAt: 30
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [incompleteRow.key, incompleteRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'commit-upgrade'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'put', row: completeRow }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'commit-upgrade'
    }));
    expect(backend.committed).toHaveLength(1);
  });

  it('rejects complete rows older than an existing complete row', async () => {
    const existingRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['newer'] },
      version: 5,
      updatedAt: 50
    });
    const staleVersionRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['old version'] },
      version: 4,
      updatedAt: 60
    });
    const staleTimestampRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['old timestamp'] },
      version: 5,
      updatedAt: 40
    });
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(new Map<string, unknown>([
        [existingRow.key, existingRow]
      ])),
      now: () => 60,
      createCommitId: () => 'commit-stale-complete'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 4,
      mutations: [{ type: 'put', row: staleVersionRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    await expect(repository.commit({
      domain: 'chat',
      version: 5,
      mutations: [{ type: 'put', row: staleTimestampRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
  });

  it('allows complete rows at a newer version to replace existing complete rows', async () => {
    const existingRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['old'] },
      version: 5,
      updatedAt: 50
    });
    const newerRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['new'] },
      version: 6,
      updatedAt: 60
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [existingRow.key, existingRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 60,
      createCommitId: () => 'commit-newer-complete'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 6,
      mutations: [{ type: 'put', row: newerRow }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'commit-newer-complete'
    }));
    expect(backend.committed).toHaveLength(1);
  });

  it('does not let ordinary complete puts revive deleted tombstones', async () => {
    const deletedRow: LocalDataStoredRow = {
      schemaVersion: 1,
      key: getLocalDataRowKey(conversationRef),
      ref: conversationRef,
      version: 2,
      updatedAt: 20,
      state: 'deleted',
      deletedAt: 20
    };
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['stale legacy body'] },
      version: 3,
      updatedAt: 30
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [deletedRow.key, deletedRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'commit-stale'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'put', row: completeRow }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('allows explicit restore mutations to replace deleted tombstones', async () => {
    const deletedRow: LocalDataStoredRow = {
      schemaVersion: 1,
      key: getLocalDataRowKey(conversationRef),
      ref: conversationRef,
      version: 2,
      updatedAt: 20,
      state: 'deleted',
      deletedAt: 20
    };
    const completeRow = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['intentional restore'] },
      version: 3,
      updatedAt: 30
    });
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [deletedRow.key, deletedRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'commit-restore'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'restore', row: completeRow }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'commit-restore'
    }));
    expect(backend.committed[0]).toEqual(expect.arrayContaining([
      { type: 'set', key: completeRow.key, value: completeRow }
    ]));
  });

  it('promotes the active data source deliberately and merges existing domain pointers', async () => {
    const existingActiveRow: LocalDataActiveDataSourceRow = {
      schemaVersion: 1,
      key: getLocalDataActiveDataSourceKey(),
      activeDataSource: 'repository',
      activeCommitId: 'collection-commit',
      stagingCommitId: null,
      updatedAt: 10,
      domains: {
        collection: {
          domain: 'collection',
          version: 7,
          committedAt: 10,
          commitId: 'collection-commit'
        }
      }
    };
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }],
      [getLocalDataActiveDataSourceKey(), existingActiveRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    const promoted = await repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport());

    expect(promoted).toEqual(expect.objectContaining({
      activeDataSource: 'repository',
      activeCommitId: 'chat-commit',
      stagingCommitId: null,
      updatedAt: 30,
      domains: {
        collection: {
          domain: 'collection',
          version: 7,
          committedAt: 10,
          commitId: 'collection-commit'
        },
        chat: {
          domain: 'chat',
          version: 2,
          committedAt: 20,
          commitId: 'chat-commit'
        }
      }
    }));
    expect(backend.committed[backend.committed.length - 1]).toEqual([
      {
        type: 'set',
        key: getLocalDataActiveDataSourceKey(),
        value: promoted
      }
    ]);
  });

  it('promotes multiple active data source domains in one active row write', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }],
      [getLocalDataCommitPointerKey('collection'), {
        domain: 'collection',
        version: 4,
        committedAt: 22,
        commitId: 'collection-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    const promoted = await repository.promoteActiveDataSources([
      {
        meta: {
          commitId: 'chat-commit',
          domain: 'chat',
          version: 2,
          committedAt: 20
        },
        validationReport: createPromotionReport()
      },
      {
        meta: {
          commitId: 'collection-commit',
          domain: 'collection',
          version: 4,
          committedAt: 22
        },
        validationReport: createCollectionPromotionReport()
      }
    ]);

    expect(promoted).toEqual(expect.objectContaining({
      activeDataSource: 'repository',
      activeCommitId: 'collection-commit',
      domains: {
        chat: {
          domain: 'chat',
          version: 2,
          committedAt: 20,
          commitId: 'chat-commit'
        },
        collection: {
          domain: 'collection',
          version: 4,
          committedAt: 22,
          commitId: 'collection-commit'
        }
      }
    }));
    expect(backend.committed).toHaveLength(1);
    expect(backend.committed[0]).toEqual([
      {
        type: 'set',
        key: getLocalDataActiveDataSourceKey(),
        value: promoted
      }
    ]);
  });

  it('preserves earlier active domain pointers when domains are promoted in separate passes', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }],
      [getLocalDataCommitPointerKey('collection'), {
        domain: 'collection',
        version: 4,
        committedAt: 22,
        commitId: 'collection-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport());
    const promoted = await repository.promoteActiveDataSource({
      commitId: 'collection-commit',
      domain: 'collection',
      version: 4,
      committedAt: 22
    }, createCollectionPromotionReport());

    expect(promoted).toEqual(expect.objectContaining({
      activeDataSource: 'repository',
      activeCommitId: 'collection-commit',
      domains: {
        chat: {
          domain: 'chat',
          version: 2,
          committedAt: 20,
          commitId: 'chat-commit'
        },
        collection: {
          domain: 'collection',
          version: 4,
          committedAt: 22,
          commitId: 'collection-commit'
        }
      }
    }));
    await expect(backend.read(getLocalDataActiveDataSourceKey())).resolves.toEqual(promoted);
    expect(backend.committed).toHaveLength(2);
  });

  it('leaves the active source untouched when one domain in a batch promotion is not trusted', async () => {
    const existingActiveRow: LocalDataActiveDataSourceRow = {
      schemaVersion: 1,
      key: getLocalDataActiveDataSourceKey(),
      activeDataSource: 'repository',
      activeCommitId: 'chat-commit',
      stagingCommitId: null,
      updatedAt: 10,
      domains: {
        chat: {
          domain: 'chat',
          version: 2,
          committedAt: 20,
          commitId: 'chat-commit'
        }
      }
    };
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataActiveDataSourceKey(), existingActiveRow],
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }],
      [getLocalDataCommitPointerKey('collection'), {
        domain: 'collection',
        version: 3,
        committedAt: 21,
        commitId: 'collection-old'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSources([
      {
        meta: {
          commitId: 'chat-commit',
          domain: 'chat',
          version: 2,
          committedAt: 20
        },
        validationReport: createPromotionReport()
      },
      {
        meta: {
          commitId: 'collection-commit',
          domain: 'collection',
          version: 4,
          committedAt: 22
        },
        validationReport: createCollectionPromotionReport()
      }
    ])).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
    await expect(backend.read(getLocalDataActiveDataSourceKey())).resolves.toEqual(existingActiveRow);
  });

  it('refuses to promote when the matching domain commit pointer is missing', async () => {
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport())).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote when the domain commit pointer does not match the promoted meta', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 1,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport())).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote when migration validation evidence loses legacy objects or contains active incomplete rows', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });
    const meta = {
      commitId: 'chat-commit',
      domain: 'chat' as const,
      version: 2,
      committedAt: 20
    };

    await expect(repository.promoteActiveDataSource(meta, createPromotionReport({
      legacyBaselineCount: 3,
      legacyBaselineObjectIds: ['c-1', 'c-2', 'c-3'],
      activeObjectCount: 1,
      activeObjectIds: ['c-1'],
      quarantinedObjectCount: 1,
      quarantinedObjectIds: ['c-2']
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    await expect(repository.promoteActiveDataSource(meta, createPromotionReport({
      activeIncompleteRowCount: 1
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote when quarantine preserves objects but active projection shrinks', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      legacyBaselineCount: 1,
      legacyBaselineObjectIds: ['c-active'],
      activeBaselineObjectIds: ['c-active'],
      activeObjectCount: 0,
      activeObjectIds: [],
      quarantinedObjectCount: 1,
      quarantinedObjectIds: ['c-active'],
      recoveredMetadata: {
        activeConversationId: null
      },
      metadataDegradationReasons: {
        activeConversationId: 'legacy active conversation points at a quarantined object'
      }
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote when active ids are replaced even if the active count is unchanged', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      legacyBaselineObjectIds: ['c-a', 'c-b'],
      activeBaselineObjectIds: ['c-a', 'c-b'],
      activeObjectCount: 2,
      activeObjectIds: ['c-x', 'c-y']
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote when legacy ids are replaced even if migrated counts are unchanged', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      legacyBaselineObjectIds: ['c-a', 'c-b'],
      activeBaselineObjectIds: [],
      activeObjectCount: 1,
      activeObjectIds: ['c-x'],
      quarantinedObjectCount: 1,
      quarantinedObjectIds: ['c-y']
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('allows quarantined objects that are not part of the active projection', async () => {
    const existingActiveRow: LocalDataActiveDataSourceRow = {
      schemaVersion: 1,
      key: getLocalDataActiveDataSourceKey(),
      activeDataSource: 'repository',
      activeCommitId: 'previous-commit',
      stagingCommitId: null,
      updatedAt: 10,
      domains: {}
    };
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }],
      [getLocalDataActiveDataSourceKey(), existingActiveRow]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      legacyBaselineCount: 3,
      legacyBaselineObjectIds: ['c-1', 'c-2', 'c-bad'],
      activeObjectCount: 2,
      activeObjectIds: ['c-1', 'c-2'],
      quarantinedObjectCount: 1,
      quarantinedObjectIds: ['c-bad']
    }))).resolves.toEqual(expect.objectContaining({
      activeDataSource: 'repository',
      activeCommitId: 'chat-commit'
    }));
  });

  it('refuses to promote chat migrations without recovered active conversation metadata', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      recoveredMetadata: {}
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to promote non-empty chat migrations when active conversation metadata degrades without a reason', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      recoveredMetadata: {
        activeConversationId: null
      }
    }))).rejects.toMatchObject({
      name: 'UntrustedPersistenceError',
      reason: 'verify-failed'
    });
    expect(backend.committed).toEqual([]);
  });

  it('allows explicit active conversation metadata degradation reasons', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('chat'), {
        domain: 'chat',
        version: 2,
        committedAt: 20,
        commitId: 'chat-commit'
      }]
    ]));
    const repository = createLocalDataRepository({
      backend,
      now: () => 30
    });

    await expect(repository.promoteActiveDataSource({
      commitId: 'chat-commit',
      domain: 'chat',
      version: 2,
      committedAt: 20
    }, createPromotionReport({
      recoveredMetadata: {
        activeConversationId: null
      },
      metadataDegradationReasons: {
        activeConversationId: 'legacy active conversation points at a quarantined object'
      }
    }))).resolves.toEqual(expect.objectContaining({
      activeDataSource: 'repository'
    }));
  });

  it('activates a domain from its committed rows without a migration validation report', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('runtime'), {
        domain: 'runtime',
        version: 2,
        committedAt: 20,
        commitId: 'runtime-commit'
      }]
    ]));
    const repository = createLocalDataRepository({ backend, now: () => 30 });

    const activated = await repository.activateDomainsFromCommittedRows([{
      commitId: 'runtime-commit',
      domain: 'runtime',
      version: 2,
      committedAt: 20
    }]);

    expect(activated).toEqual(expect.objectContaining({
      activeDataSource: 'repository',
      activeCommitId: 'runtime-commit',
      domains: {
        runtime: { domain: 'runtime', version: 2, committedAt: 20, commitId: 'runtime-commit' }
      }
    }));
    await expect(backend.read(getLocalDataActiveDataSourceKey())).resolves.toEqual(activated);
    expect(backend.committed).toHaveLength(1);
  });

  it('preserves other domains’ active pointers when activating a freshly written domain', async () => {
    const existingActiveRow: LocalDataActiveDataSourceRow = {
      schemaVersion: 1,
      key: getLocalDataActiveDataSourceKey(),
      activeDataSource: 'repository',
      activeCommitId: 'chat-commit',
      stagingCommitId: null,
      updatedAt: 10,
      domains: {
        chat: { domain: 'chat', version: 2, committedAt: 20, commitId: 'chat-commit' }
      }
    };
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataActiveDataSourceKey(), existingActiveRow],
      [getLocalDataCommitPointerKey('runtime'), {
        domain: 'runtime',
        version: 4,
        committedAt: 22,
        commitId: 'runtime-commit'
      }]
    ]));
    const repository = createLocalDataRepository({ backend, now: () => 30 });

    const activated = await repository.activateDomainsFromCommittedRows([{
      commitId: 'runtime-commit',
      domain: 'runtime',
      version: 4,
      committedAt: 22
    }]);

    expect(activated.domains).toEqual({
      chat: { domain: 'chat', version: 2, committedAt: 20, commitId: 'chat-commit' },
      runtime: { domain: 'runtime', version: 4, committedAt: 22, commitId: 'runtime-commit' }
    });
  });

  it('refuses to activate when the matching domain commit pointer is missing', async () => {
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({ backend, now: () => 30 });

    await expect(repository.activateDomainsFromCommittedRows([{
      commitId: 'runtime-commit',
      domain: 'runtime',
      version: 2,
      committedAt: 20
    }])).rejects.toMatchObject({ name: 'UntrustedPersistenceError' });
    expect(backend.committed).toEqual([]);
  });

  it('refuses to activate when the domain commit pointer does not match the committed meta', async () => {
    const backend = createTransactionalBackend(new Map<string, unknown>([
      [getLocalDataCommitPointerKey('runtime'), {
        domain: 'runtime',
        version: 1,
        committedAt: 20,
        commitId: 'runtime-commit'
      }]
    ]));
    const repository = createLocalDataRepository({ backend, now: () => 30 });

    await expect(repository.activateDomainsFromCommittedRows([{
      commitId: 'runtime-commit',
      domain: 'runtime',
      version: 2,
      committedAt: 20
    }])).rejects.toMatchObject({ name: 'UntrustedPersistenceError' });
    expect(backend.committed).toEqual([]);
  });

  it('rejects an empty activation request', async () => {
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({ backend, now: () => 30 });

    await expect(repository.activateDomainsFromCommittedRows([]))
      .rejects.toMatchObject({ name: 'UntrustedPersistenceError' });
    expect(backend.committed).toEqual([]);
  });

  it('stages, verifies, publishes, and clears native-style commits', async () => {
    const row = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['ok'] },
      version: 3,
      updatedAt: 30
    });
    const calls: string[] = [];
    const backend: LocalDataStagedBackend = {
      mode: 'staged',
      async read() {
        return null;
      },
      async listKeysWithPrefix() {
        return [];
      },
      async stageCommit(stageId) {
        calls.push(`stage:${stageId}`);
      },
      async verifyCommit(stageId) {
        calls.push(`verify:${stageId}`);
        return true;
      },
      async publishCommit(stageId) {
        calls.push(`publish:${stageId}`);
      },
      async clearStage(stageId) {
        calls.push(`clear:${stageId}`);
      }
    };
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'native-commit'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'put', row }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'native-commit'
    }));

    expect(calls).toEqual([
      'stage:native-commit:stage',
      'verify:native-commit:stage',
      'publish:native-commit:stage',
      'clear:native-commit:stage'
    ]);
  });

  it('keeps staged commits successful when cleanup fails after publish', async () => {
    const row = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['published'] },
      version: 3,
      updatedAt: 30
    });
    const cleanupError = new Error('stage cleanup failed');
    const onStageCleanupError = vi.fn();
    const backend: LocalDataStagedBackend = {
      mode: 'staged',
      async read() {
        return null;
      },
      async listKeysWithPrefix() {
        return [];
      },
      async stageCommit() {
        return undefined;
      },
      async verifyCommit() {
        return true;
      },
      async publishCommit() {
        return undefined;
      },
      async clearStage() {
        throw cleanupError;
      }
    };
    const repository = createLocalDataRepository({
      backend,
      now: () => 30,
      createCommitId: () => 'native-cleanup',
      onStageCleanupError
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 3,
      mutations: [{ type: 'put', row }]
    })).resolves.toEqual(expect.objectContaining({
      commitId: 'native-cleanup'
    }));
    expect(onStageCleanupError).toHaveBeenCalledWith(cleanupError, expect.objectContaining({
      commitId: 'native-cleanup'
    }));
  });

  it('does not publish staged commits that fail verification', async () => {
    const row = createCompleteLocalDataRow({
      ref: conversationRef,
      value: { messages: ['bad'] },
      version: 4,
      updatedAt: 40
    });
    const publishCommit = vi.fn();
    const clearStage = vi.fn();
    const backend: LocalDataStagedBackend = {
      mode: 'staged',
      async read() {
        return null;
      },
      async listKeysWithPrefix() {
        return [];
      },
      async stageCommit() {
        return undefined;
      },
      async verifyCommit() {
        return false;
      },
      publishCommit,
      clearStage
    };
    const repository = createLocalDataRepository({
      backend,
      now: () => 40,
      createCommitId: () => 'native-bad'
    });

    await expect(repository.commit({
      domain: 'chat',
      version: 4,
      mutations: [{ type: 'put', row }]
    })).rejects.toBeInstanceOf(UntrustedPersistenceError);
    expect(publishCommit).not.toHaveBeenCalled();
    expect(clearStage).toHaveBeenCalledWith('native-bad:stage');
  });

  it('rejects rows whose domain does not match the unit of work domain before writing', async () => {
    const row = createCompleteLocalDataRow({
      ref: { domain: 'asset', kind: 'meta', id: 'asset-1' },
      value: { name: 'wrong lane' },
      version: 1,
      updatedAt: 1
    });
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({ backend });

    await expect(repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });

  it('rejects rows whose persisted key does not match their ref before writing', async () => {
    const row: LocalDataStoredRow = {
      ...createCompleteLocalDataRow({
        ref: conversationRef,
        value: { messages: [] },
        version: 1,
        updatedAt: 1
      }),
      key: 'local-data-v1:row:chat:conversationRecord:wrong'
    };
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({ backend });

    await expect(repository.commit({
      domain: 'chat',
      version: 1,
      mutations: [{ type: 'put', row }]
    })).rejects.toBeInstanceOf(LocalDataContractError);
    expect(backend.committed).toEqual([]);
  });
});

describe('buildLocalDataCommitMutations', () => {
  it('turns tombstones into deleted rows instead of physical deletes', () => {
    const mutations = buildLocalDataCommitMutations({
      domain: 'chat',
      version: 5,
      mutations: [{
        type: 'tombstone',
        ref: conversationRef,
        version: 5,
        deletedAt: 50
      }]
    }, {
      commitId: 'commit-delete',
      domain: 'chat',
      version: 5,
      committedAt: 51
    });

    expect(mutations[0]).toEqual({
      type: 'set',
      key: getLocalDataRowKey(conversationRef),
      value: expect.objectContaining({
        state: 'deleted',
        deletedAt: 50
      })
    });
  });
});
