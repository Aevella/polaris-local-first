import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_SUMMARY_SOURCE_CHARS, resolveConversationSummarySourceBatches } from './conversationSummaryMemory';
import type { ChatMessage, Conversation } from '../types/domain';

function message(id: string, role: ChatMessage['role'], content: string, timestamp: number): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp
  };
}

function conversation(seed: {
  id: string;
  collaboratorId?: string | null;
  messages: ChatMessage[];
}): Conversation {
  return {
    id: seed.id,
    title: seed.id,
    collaboratorId: seed.collaboratorId ?? 'pharos',
    messages: seed.messages,
    pinnedAt: null,
    updatedAt: 1
  };
}

describe('resolveConversationSummarySourceBatches', () => {
  it('builds collaborator-scoped natural conversation batches by source characters', () => {
    const batches = resolveConversationSummarySourceBatches({
      currentCollaboratorId: 'pharos',
      currentCollaboratorName: 'Pharos',
      userLabel: '用户',
      targetSourceChars: 300,
      conversations: [
        conversation({
          id: 'ignored-collaborator',
          collaboratorId: 'other',
          messages: [message('other-user', 'user', '别的协作者不进来。', 1)]
        }),
        conversation({
          id: 'main',
          messages: [
            message('assistant-1', 'assistant', '先回应。', 2),
            message('tool-1', 'system', '工具结果不进来。', 3),
            {
              ...message('runtime-continue', 'user', '上一条回答在中途停住了，可能是输出长度到顶，也可能是流式连接提前结束。 不要重头开始，不要道歉，不要复述前文。 直接从刚才断开的那一句继续，但只接下一小段。', 3.5),
              origin: 'system-note' as const
            },
            message('user-1', 'user', '```ts\nconst x = 1;\n```\n代码块应该被略过。', 1),
            message('user-2', 'user', '继续聊最近事项。', 4)
          ]
        })
      ]
    });

    expect(batches).toHaveLength(1);
    expect(batches.map((batch) => batch.sequence)).toEqual([1]);
    expect(batches.flatMap((batch) => batch.sourceConversationIds)).toEqual(['main']);
    expect(batches.flatMap((batch) => batch.sourceMessageIds)).toEqual(['user-1', 'assistant-1', 'user-2']);
    expect(batches[0]?.text).toContain('[代码块已略过]');
    expect(batches[0]?.text).toContain('继续聊最近事项');
    expect(batches[0]?.text).toContain('main · 用户 ·');
    expect(batches[0]?.text).toContain('main · Pharos ·');
    expect(batches[0]?.text).not.toContain('上一条回答在中途停住');
    expect(batches[0]?.text).not.toContain('assistant / 当前协作者');
    expect(batches[0]?.text).not.toContain('user / 用户');
    expect(batches[0]?.text).not.toContain('const x');
    expect(batches.some((batch) => batch.text.includes('工具结果'))).toBe(false);
  });

  it('uses the product default source target when no valid target is configured', () => {
    const batches = resolveConversationSummarySourceBatches({
      targetSourceChars: 0,
      conversations: [
        conversation({
          id: 'main',
          messages: [message('user-1', 'user', 'a'.repeat(DEFAULT_CONVERSATION_SUMMARY_SOURCE_CHARS + 1), 1)]
        })
      ]
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.sourceCharCount).toBeGreaterThan(DEFAULT_CONVERSATION_SUMMARY_SOURCE_CHARS);
  });
});


describe('conversation summary window sources', () => {
  it('includes all windows from the same collaborator regardless of the removed legacy toggle', () => {
    const excluded = { ...conversation({ id: 'private', messages: [message('private-message', 'user', 'private source', 1)] }), windowPreferences: { historicalImagePolicy: 'smart' as const, participatesInAutomaticSummary: false, composerReturnKeyBehavior: 'automatic' as const, mcpScope: { mode: 'inherit' as const } } };
    const included = conversation({ id: 'included', messages: [message('included-message', 'user', 'included source', 2)] });
    const batches = resolveConversationSummarySourceBatches({ conversations: [excluded, included], currentCollaboratorId: 'pharos' });
    expect(batches.flatMap(batch => batch.sourceConversationIds)).toEqual(['private', 'included']);
    expect(batches.flatMap(batch => batch.sourceMessageIds)).toEqual(['private-message', 'included-message']);
  });
});
