import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import { assertValidMigrationPromotionReport } from './migrationValidation';
import { buildChatMigrationRehearsal } from './chatMigrationRehearsal';
import { commitChatMigrationRehearsalAndBuildValidationReport } from './chatMigrationReadback';
import {
  createLocalDataRepository,
  getConversationRecordLocalDataRef,
  getLocalDataActiveDataSourceKey,
  getLocalDataRowKey,
  type LocalDataBackendMutation,
  type LocalDataRef,
  type LocalDataRepository,
  type LocalDataStoredRow,
  type LocalDataTransactionalBackend
} from './index';

function message(id: string, timestamp: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    timestamp
  };
}

function createTransactionalBackend(
  rows = new Map<string, unknown>()
): LocalDataTransactionalBackend & {
  rows: Map<string, unknown>;
  committed: LocalDataBackendMutation[][];
} {
  const committed: LocalDataBackendMutation[][] = [];
  return {
    mode: 'transactional',
    rows,
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

function observedRepository(repository: LocalDataRepository) {
  const readRefs: LocalDataRef[] = [];
  return {
    readRefs,
    repository: {
      async read<T>(ref: LocalDataRef) {
        readRefs.push(ref);
        return repository.read<T>(ref);
      },
      commit: repository.commit,
      commitAndPromoteActiveDataSource: repository.commitAndPromoteActiveDataSource,
      async promoteActiveDataSource() {
        throw new Error('chat migration readback must not promote activeDataSource');
      },
      async promoteActiveDataSources() {
        throw new Error('chat migration readback must not promote activeDataSource');
      },
      async activateDomainsFromCommittedRows() {
        throw new Error('chat migration readback must not activate domains');
      }
    } satisfies LocalDataRepository
  };
}

function refLabel(ref: LocalDataRef) {
  return `${ref.domain}/${ref.kind}/${ref.id}`;
}

describe('commitChatMigrationRehearsalAndBuildValidationReport', () => {
  it('commits the rehearsal unit, reads staging rows back, and builds promotion evidence without promoting', async () => {
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({
      backend,
      now: () => 80
    });
    const observed = observedRepository(repository);
    const rehearsal = buildChatMigrationRehearsal({
      snapshot: {
        activeConversationId: 'c-active',
        conversations: [
          {
            id: 'c-active',
            title: 'Active',
            collaboratorId: 'pharos',
            activeProjectId: 'project-1',
            pinnedAt: null,
            updatedAt: 30,
            messages: [message('m-1', 10)]
          },
          {
            id: 'c-missing',
            title: 'Missing',
            collaboratorId: 'pharos',
            activeProjectId: null,
            pinnedAt: null,
            updatedAt: 31,
            expectedMessageCount: 2,
            expectedLatestMessageTimestamp: 20,
            missingRecordKeys: ['legacy-chat-record:c-missing']
          }
        ]
      },
      version: 3,
      committedAt: 40,
      unitId: 'chat-migration'
    });

    const result = await commitChatMigrationRehearsalAndBuildValidationReport({
      repository: observed.repository,
      rehearsal,
      validatedAt: 90
    });

    expect(result.commitMeta).toEqual({
      domain: 'chat',
      version: 3,
      committedAt: 80,
      commitId: 'chat-migration'
    });
    expect(result.validationReport).toEqual(expect.objectContaining({
      id: 'chat:chat-migration:validation',
      commitId: 'chat-migration',
      version: 3,
      validatedAt: 90,
      stagingHydrated: true,
      legacyBaselineObjectIds: ['c-active', 'c-missing'],
      activeBaselineObjectIds: ['c-active'],
      activeObjectIds: ['c-active'],
      quarantinedObjectIds: ['c-missing'],
      recoveredMetadata: {
        activeConversationId: 'c-active'
      }
    }));
    expect(() => {
      assertValidMigrationPromotionReport(result.commitMeta, result.validationReport);
    }).not.toThrow();
    expect(backend.rows.has(getLocalDataActiveDataSourceKey())).toBe(false);
  });

  it('reads complete records but does not invent record reads for non-complete plans', async () => {
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(),
      now: () => 80
    });
    const observed = observedRepository(repository);
    const rehearsal = buildChatMigrationRehearsal({
      snapshot: {
        activeConversationId: null,
        quarantinedConversationIds: ['c-quarantine'],
        conversations: [
          {
            id: 'c-complete',
            title: 'Complete',
            collaboratorId: 'pharos',
            activeProjectId: null,
            pinnedAt: null,
            updatedAt: 30,
            messages: [message('m-1', 10)]
          },
          {
            id: 'c-quarantine',
            title: 'Quarantine',
            collaboratorId: 'pharos',
            activeProjectId: null,
            pinnedAt: null,
            updatedAt: 31,
            expectedMessageCount: 1,
            expectedLatestMessageTimestamp: 10
          }
        ]
      },
      version: 3,
      committedAt: 40
    });

    await commitChatMigrationRehearsalAndBuildValidationReport({
      repository: observed.repository,
      rehearsal,
      validatedAt: 90
    });

    expect(observed.readRefs.map(refLabel).sort()).toEqual([
      'chat/conversationCatalog/c-complete',
      'chat/conversationCatalog/c-quarantine',
      'chat/conversationRecord/c-complete',
      'chat/domainMeta/chat',
    ].sort());
    expect(observed.readRefs).not.toEqual(expect.arrayContaining([
      getConversationRecordLocalDataRef('c-quarantine')
    ]));
  });

  it('uses repository read results, so missing committed rows become validation evidence instead of hand-authored success', async () => {
    const recordRef = getConversationRecordLocalDataRef('c-complete');
    const backend = createTransactionalBackend();
    const repository = createLocalDataRepository({
      backend,
      now: () => 80
    });
    const rehearsal = buildChatMigrationRehearsal({
      snapshot: {
        activeConversationId: 'c-complete',
        conversations: [{
          id: 'c-complete',
          title: 'Complete',
          collaboratorId: 'pharos',
          activeProjectId: null,
          pinnedAt: null,
          updatedAt: 30,
          messages: [message('m-1', 10)]
        }]
      },
      version: 3,
      committedAt: 40
    });
    const observed = observedRepository({
      ...repository,
      async read<T>(ref: LocalDataRef) {
        if (ref.domain === recordRef.domain && ref.kind === recordRef.kind && ref.id === recordRef.id) {
          return {
            status: 'incomplete',
            ref,
            reason: 'simulated record readback miss',
            missingKeys: [getLocalDataRowKey(ref)]
          };
        }
        return repository.read<T>(ref);
      }
    });

    const result = await commitChatMigrationRehearsalAndBuildValidationReport({
      repository: observed.repository,
      rehearsal,
      validatedAt: 90
    });

    expect(result.readback.rows[0]?.record).toEqual(expect.objectContaining({
      status: 'incomplete',
      reason: 'simulated record readback miss'
    }));
    expect(result.validationReport).toEqual(expect.objectContaining({
      stagingHydrated: false,
      activeObjectIds: [],
      quarantinedObjectIds: ['c-complete']
    }));
    expect(() => {
      assertValidMigrationPromotionReport(result.commitMeta, result.validationReport);
    }).toThrow('Local data migration validation did not hydrate staging.');
    expect(backend.rows.has(getLocalDataActiveDataSourceKey())).toBe(false);
  });

  it('can produce promotable evidence when the legacy active-visible ids all hydrate into active projection', async () => {
    const repository = createLocalDataRepository({
      backend: createTransactionalBackend(),
      now: () => 80
    });
    const rehearsal = buildChatMigrationRehearsal({
      snapshot: {
        activeConversationId: 'c-active',
        quarantinedConversationIds: ['c-quarantine'],
        conversations: [
          {
            id: 'c-active',
            title: 'Active',
            collaboratorId: 'pharos',
            activeProjectId: null,
            pinnedAt: null,
            updatedAt: 30,
            messages: [message('m-1', 10)]
          },
          {
            id: 'c-quarantine',
            title: 'Quarantine',
            collaboratorId: 'pharos',
            activeProjectId: null,
            pinnedAt: null,
            updatedAt: 31,
            expectedMessageCount: 1,
            expectedLatestMessageTimestamp: 10
          }
        ]
      },
      version: 3,
      committedAt: 40,
      unitId: 'chat-migration'
    });

    const result = await commitChatMigrationRehearsalAndBuildValidationReport({
      repository,
      rehearsal,
      validatedAt: 90
    });

    expect(() => {
      assertValidMigrationPromotionReport(result.commitMeta, result.validationReport);
    }).not.toThrow();
    expect(result.validationReport).toEqual(expect.objectContaining({
      activeBaselineObjectIds: ['c-active'],
      activeObjectIds: ['c-active'],
      quarantinedObjectIds: ['c-quarantine']
    }));
  });
});
