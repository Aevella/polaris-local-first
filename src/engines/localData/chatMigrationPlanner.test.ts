import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import { LocalDataProjectionContractError } from './chatConversationContracts';
import { buildConversationLocalDataUnitOfWork } from './chatRows';
import { planChatMigrationFromLegacySnapshot, type ChatMigrationLegacyConversationSnapshot } from './chatMigrationPlanner';

function message(id: string, timestamp: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    timestamp
  };
}

function sourceConversation(
  id: string,
  overrides: Partial<ChatMigrationLegacyConversationSnapshot> = {}
): ChatMigrationLegacyConversationSnapshot {
  return {
    id,
    title: `Conversation ${id}`,
    collaboratorId: 'pharos',
    activeProjectId: 'project-1',
    pinnedAt: null,
    updatedAt: 30,
    ...overrides
  };
}

describe('planChatMigrationFromLegacySnapshot', () => {
  it('plans complete legacy conversations for active projection with id baselines', () => {
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: 'c-1',
        conversations: [
          sourceConversation('c-2', { messages: [message('m-2', 20)] }),
          sourceConversation('c-1', { messages: [message('m-1', 10)] })
        ]
      },
      version: 3,
      committedAt: 40
    });

    expect(plan).toEqual(expect.objectContaining({
      activeConversationId: 'c-1',
      legacyBaselineConversationIds: ['c-1', 'c-2'],
      legacyActiveConversationIds: ['c-1', 'c-2'],
      metadataDegradationReasons: undefined
    }));
    expect(plan.conversations).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'c-2' }),
        bodyState: 'complete'
      }),
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'c-1' }),
        bodyState: 'complete'
      })
    ]);
  });

  it('preserves durable chat context when planning complete source bodies', () => {
    const source = sourceConversation('c-context', {
      messages: [message('m-1', 10)], draft: '未发送草稿', reasoningStrength: 'high',
      workspaceLedger: [{
        id: 'scope-1', kind: 'workspace_scope_changed', change: 'entered',
        previousProjectId: null, nextProjectId: 'project-1', summary: '进入工作区', createdAt: 1
      }]
    });
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: { activeConversationId: source.id, conversations: [source] },
      version: 3, committedAt: 40
    });
    expect(plan.conversations[0].conversation).toMatchObject({
      draft: source.draft, reasoningStrength: source.reasoningStrength,
      workspaceLedger: source.workspaceLedger, activeProjectId: source.activeProjectId
    });
  });

  it('plans missing bodies as incomplete without inventing empty complete records', () => {
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: 'c-missing',
        conversations: [
          sourceConversation('c-missing', {
            expectedMessageCount: 4,
            expectedLatestMessageTimestamp: 99,
            missingRecordKeys: ['chat-conversation-record-v1:c-missing']
          })
        ]
      },
      version: 3,
      committedAt: 40
    });

    expect(plan).toEqual(expect.objectContaining({
      activeConversationId: null,
      legacyBaselineConversationIds: ['c-missing'],
      legacyActiveConversationIds: [],
      metadataDegradationReasons: {
        activeConversationId: 'legacy active conversation did not hydrate into the active projection'
      }
    }));
    expect(plan.conversations).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'c-missing', messages: [] }),
        bodyState: 'incomplete',
        expectedMessageCount: 4,
        expectedLatestMessageTimestamp: 99,
        missingKeys: ['chat-conversation-record-v1:c-missing']
      })
    ]);

    const unit = buildConversationLocalDataUnitOfWork({
      id: 'chat-unit',
      activeConversationId: plan.activeConversationId,
      conversations: plan.conversations,
      version: 3,
      updatedAt: 40
    });
    expect(unit.mutations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        row: expect.objectContaining({
          ref: expect.objectContaining({
            kind: 'conversationRecord',
            id: 'c-missing'
          })
        })
      })
    ]));
  });

  it('keeps known quarantined ids in the baseline but out of the legacy active-visible ids', () => {
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: 'c-active',
        quarantinedConversationIds: ['c-quarantined'],
        conversations: [
          sourceConversation('c-active', { messages: [message('m-1', 10)] }),
          sourceConversation('c-quarantined', {
            expectedMessageCount: 2,
            expectedLatestMessageTimestamp: 20
          })
        ]
      },
      version: 3,
      committedAt: 40
    });

    expect(plan.legacyBaselineConversationIds).toEqual(['c-active', 'c-quarantined']);
    expect(plan.legacyActiveConversationIds).toEqual(['c-active']);
    expect(plan.conversations).toEqual([
      expect.objectContaining({ bodyState: 'complete' }),
      expect.objectContaining({
        bodyState: 'incomplete',
        missingKeys: ['legacy-chat-record:c-quarantined']
      })
    ]);
  });

  it('keeps known quarantined ids out of active projection even when a source body is present', () => {
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: null,
        quarantinedConversationIds: ['c-quarantined'],
        conversations: [
          sourceConversation('c-quarantined', {
            messages: [message('m-1', 10), message('m-2', 20)]
          })
        ]
      },
      version: 3,
      committedAt: 40
    });

    expect(plan.legacyBaselineConversationIds).toEqual(['c-quarantined']);
    expect(plan.legacyActiveConversationIds).toEqual([]);
    expect(plan.conversations).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'c-quarantined', messages: [] }),
        bodyState: 'incomplete',
        expectedMessageCount: 2,
        expectedLatestMessageTimestamp: 20
      })
    ]);
  });

  it('excludes deleted ids from baseline and migration rows', () => {
    const plan = planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: 'c-kept',
        deletedConversationIds: ['c-deleted'],
        conversations: [
          sourceConversation('c-kept', { messages: [message('m-1', 10)] }),
          sourceConversation('c-deleted', { messages: [message('m-deleted', 5)] })
        ]
      },
      version: 3,
      committedAt: 40
    });

    expect(plan.legacyBaselineConversationIds).toEqual(['c-kept']);
    expect(plan.conversations.map((entry) => entry.conversation.id)).toEqual(['c-kept']);
  });

  it('rejects duplicate source ids before they can become duplicate row writes', () => {
    expect(() => planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: null,
        conversations: [
          sourceConversation('c-1', { messages: [message('m-1', 10)] }),
          sourceConversation('c-1', { messages: [message('m-2', 20)] })
        ]
      },
      version: 3,
      committedAt: 40
    })).toThrow(LocalDataProjectionContractError);
  });

  it('rejects non-complete sources without expected metadata', () => {
    expect(() => planChatMigrationFromLegacySnapshot({
      snapshot: {
        activeConversationId: null,
        conversations: [sourceConversation('c-missing')]
      },
      version: 3,
      committedAt: 40
    })).toThrow('Chat migration non-complete source requires expectedMessageCount.');
  });
});
