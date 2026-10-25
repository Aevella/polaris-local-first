import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationTaskState } from '../types/domain';
import {
  collectRemovedPendingProposalIds,
  reconcileConversationTaskAfterMessageRemoval,
  removeUserMessageTurn
} from './chatMessageTurnRemoval';

function message(id: string, role: ChatMessage['role']): ChatMessage {
  return { id, role, content: id, timestamp: 1 };
}

function task(): ConversationTaskState {
  return {
    id: 'task-1',
    sourceMessageId: 'user-2',
    goal: '继续处理',
    title: '继续处理',
    status: 'running',
    stage: 'working',
    steps: [],
    executions: [
      {
        id: 'execution-1',
        assistantMessageId: 'assistant-1',
        toolCallIds: ['call-1'],
        resultMessageIds: ['tool-1'],
        pendingProposalIds: ['proposal-1'],
        updatedAt: 1
      },
      {
        id: 'execution-2',
        assistantMessageId: 'assistant-2',
        toolCallIds: [],
        resultMessageIds: [],
        pendingProposalIds: [],
        updatedAt: 2
      }
    ],
    createdAt: 1,
    updatedAt: 2,
    lastAssistantMessageId: 'assistant-2'
  };
}

describe('removeUserMessageTurn', () => {
  it('removes the selected user turn while preserving later turns', () => {
    const result = removeUserMessageTurn([
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      { ...message('tool-1', 'system'), toolInvocation: { id: 'tool', kind: 'webSearch', status: 'executed', title: 'Search', summary: 'Done' } },
      message('user-2', 'user'),
      message('assistant-2', 'assistant')
    ], 'user-1');

    expect(result?.messages.map((entry) => entry.id)).toEqual(['user-2', 'assistant-2']);
    expect(result?.removedMessageIds).toEqual(['user-1', 'assistant-1', 'tool-1']);
  });

  it('does nothing when the target is not a user turn start', () => {
    expect(removeUserMessageTurn([
      message('user-1', 'user'),
      message('assistant-1', 'assistant')
    ], 'assistant-1')).toBeNull();
  });
});

describe('reconcileConversationTaskAfterMessageRemoval', () => {
  it('clears a task whose source user message was removed', () => {
    expect(reconcileConversationTaskAfterMessageRemoval(task(), ['user-2'])).toBeNull();
  });

  it('prunes executions and pending proposals tied to a removed turn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9);
    const currentTask = task();

    expect(collectRemovedPendingProposalIds(currentTask, ['assistant-1'])).toEqual(['proposal-1']);
    expect(reconcileConversationTaskAfterMessageRemoval(currentTask, ['assistant-1'])).toEqual({
      ...currentTask,
      executions: [currentTask.executions[1]],
      updatedAt: 9
    });
  });
});
