import { describe, expect, it } from 'vitest';
import type { ChatMessage, Conversation } from '../../types/domain';
import {
  buildConversationMessageSearchIndex,
  buildConversationMessageSearchMatches,
  buildConversationSearchText
} from './conversationMessageSearch';

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    role: 'user',
    timestamp: 1,
    ...input
  };
}

function conversation(input: Partial<Conversation> & Pick<Conversation, 'id' | 'messages'>): Conversation {
  return {
    title: input.id,
    kind: 'direct',
    collaboratorId: 'persona-1',
    groupRoomId: null,
    activeProjectId: null,
    toolLedger: undefined,
    workspaceLedger: undefined,
    task: null,
    draft: '',
    pinnedAt: null,
    updatedAt: 1,
    ...input
  };
}

describe('buildConversationMessageSearchMatches', () => {
  it('returns newest matching messages while keeping the full match count', () => {
    const target = conversation({
      id: 'chat-1',
      messages: [
        message({ id: 'old', content: 'alpha first note', timestamp: 10 }),
        message({ id: 'middle', content: 'quiet filler', timestamp: 20 }),
        message({ id: 'newer', content: 'alpha second note', timestamp: 30 }),
        message({ id: 'newest', content: 'alpha final note', timestamp: 40 })
      ]
    });

    const result = buildConversationMessageSearchMatches(target, 'alpha', 2);

    expect(result.total).toBe(3);
    expect(result.matches.map((match) => match.messageId)).toEqual(['newest', 'newer']);
  });

  it('searches attachment names as part of their source message', () => {
    const target = conversation({
      id: 'chat-1',
      messages: [
        message({
          id: 'with-attachment',
          content: '',
          attachments: [{
            id: 'file-1',
            assetId: 'asset-1',
            kind: 'file',
            name: 'visa-plan.pdf',
            mimeType: 'application/pdf',
            size: 12
          }]
        })
      ]
    });

    const result = buildConversationMessageSearchMatches(target, 'visa');

    expect(result.total).toBe(1);
    expect(result.matches[0]?.messageId).toBe('with-attachment');
    expect(result.matches[0]?.excerpt).toContain('visa-plan.pdf');
  });
});

describe('buildConversationSearchText', () => {
  it('keeps title, collaborator, full message content, and attachment names in one searchable body', () => {
    const target = conversation({
      id: 'chat-1',
      title: 'Travel archive',
      messages: [
        message({
          id: 'm1',
          content: 'Shanghai checklist',
          attachments: [{
            id: 'file-1',
            assetId: 'asset-1',
            kind: 'file',
            name: 'boarding-pass.png',
            mimeType: 'image/png',
            size: 7
          }]
        })
      ]
    });

    const body = buildConversationSearchText(target, 'Pharos');

    expect(body).toContain('Travel archive');
    expect(body).toContain('Pharos');
    expect(body).toContain('Shanghai checklist');
    expect(body).toContain('boarding-pass.png');
  });
});

describe('buildConversationMessageSearchIndex', () => {
  it('indexes only conversations with message-level hits', () => {
    const index = buildConversationMessageSearchIndex([
      conversation({ id: 'hit', messages: [message({ id: 'm1', content: 'needle here' })] }),
      conversation({ id: 'miss', messages: [message({ id: 'm2', content: 'plain text' })] })
    ], 'needle');

    expect(index.hit?.total).toBe(1);
    expect(index.miss).toBeUndefined();
  });
});
