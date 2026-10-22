import { describe, expect, it } from 'vitest';
import type { ChatMessage, Conversation } from '../types/domain';
import {
  appendConversationMessage,
  appendConversationMessageInRecords,
  applyLoadedConversationMessages,
  insertConversationMessageAfter,
  insertConversationMessageAfterInRecords,
  insertConversationMessageBefore,
  insertConversationMessageBeforeInRecords,
  replaceConversationMessages,
  replaceConversationMessagesInRecords,
  updateConversationMessage,
  updateConversationMessageInRecords
} from './chatConversationMessages';

function message(id: string, content: string, role: ChatMessage['role'] = 'user'): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: Number(id.replace(/\D/g, '')) || 1
  };
}

function conversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c-1',
    title: '新对话',
    kind: 'direct',
    collaboratorId: 'pharos',
    groupRoomId: null,
    activeProjectId: null,
    messages: [],
    pinnedAt: null,
    updatedAt: 1,
    ...patch
  };
}

describe('chat conversation messages', () => {
  it('uses the first direct user message as the conversation title', () => {
    const next = appendConversationMessage(conversation(), message('m-1', '先做页面结构'));

    expect(next.title).toBe('先做页面结构');
    expect(next.messages).toEqual([expect.objectContaining({ id: 'm-1' })]);
  });

  it('does not retitle group conversations when appending a user message', () => {
    const next = appendConversationMessage(conversation({
      kind: 'group',
      title: '群聊'
    }), message('m-1', '先做页面结构'));

    expect(next.title).toBe('群聊');
  });

  it('inserts messages before or after existing ids and appends when the anchor is missing', () => {
    const base = conversation({
      messages: [message('m-1', 'one'), message('m-3', 'three')]
    });

    expect(insertConversationMessageBefore(base, 'm-3', message('m-2', 'two')).messages.map((entry) => entry.id))
      .toEqual(['m-1', 'm-2', 'm-3']);
    expect(insertConversationMessageAfter(base, 'm-1', message('m-2', 'two')).messages.map((entry) => entry.id))
      .toEqual(['m-1', 'm-2', 'm-3']);
    expect(insertConversationMessageAfter(base, 'm-missing', message('m-4', 'four')).messages.map((entry) => entry.id))
      .toEqual(['m-1', 'm-3', 'm-4']);
  });

  it('updates and replaces message bodies through immutable conversation copies', () => {
    const base = conversation({
      messages: [message('m-1', 'one'), message('m-2', 'two')]
    });
    const updated = updateConversationMessage(base, 'm-2', { content: 'second' });
    const replaced = replaceConversationMessages(base, [message('m-3', 'replacement')]);

    expect(updated.messages[1]?.content).toBe('second');
    expect(base.messages[1]?.content).toBe('two');
    expect(replaced.messages.map((entry) => entry.id)).toEqual(['m-3']);
  });

  it('normalizes loaded conversation titles from loaded messages', () => {
    const next = applyLoadedConversationMessages(conversation({ title: '' }), [
      message('m-1', 'loaded title')
    ]);

    expect(next.title).toBe('loaded title');
  });

  it('applies message transforms to the matching conversation record', () => {
    const first = conversation({
      id: 'c-1',
      messages: [message('m-1', 'one'), message('m-3', 'three')]
    });
    const second = conversation({
      id: 'c-2',
      title: 'Second',
      messages: [message('m-9', 'nine')]
    });

    expect(appendConversationMessageInRecords([first, second], 'c-2', message('m-10', 'ten'))).toEqual([
      first,
      expect.objectContaining({
        id: 'c-2',
        messages: [expect.objectContaining({ id: 'm-9' }), expect.objectContaining({ id: 'm-10' })]
      })
    ]);
    expect(insertConversationMessageBeforeInRecords([first, second], 'c-1', 'm-3', message('m-2', 'two'))[0]
      ?.messages.map((entry) => entry.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(insertConversationMessageAfterInRecords([first, second], 'c-1', 'm-1', message('m-2', 'two'))[0]
      ?.messages.map((entry) => entry.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(updateConversationMessageInRecords([first, second], 'c-1', 'm-3', { content: 'updated' })[0]
      ?.messages[1]?.content).toBe('updated');
    expect(replaceConversationMessagesInRecords([first, second], 'c-1', [message('m-4', 'four')])[0]
      ?.messages.map((entry) => entry.id)).toEqual(['m-4']);
    expect(first.messages.map((entry) => entry.id)).toEqual(['m-1', 'm-3']);
  });
});

describe('message edits preserve context and evidence', () => {
  it('keeps ledger identity during text streaming and returns the original for no-op patches', () => {
    const base = conversation({ messages: [message('m-1', 'one')], toolLedger: [] });
    const updated = updateConversationMessage(base, 'm-1', { content: 'two' });
    expect(updated.toolLedger).toBe(base.toolLedger);
    expect(updateConversationMessage(updated, 'm-1', { content: 'two' })).toBe(updated);
    expect(updateConversationMessage(base, 'missing', { content: 'two' })).toBe(base);
  });

  it('clears a context anchor when its message is removed or ceases to be a dialogue turn', () => {
    const base = conversation({ messages: [message('m-1', 'one'), message('m-2', 'two')], requestContext: { mode: 'fromMessage', anchorMessageId: 'm-1' } });
    expect(replaceConversationMessages(base, [base.messages[1]]).requestContext).toEqual({ mode: 'fromMessage', anchorMessageId: null });
    expect(updateConversationMessage(base, 'm-1', { role: 'system' }).requestContext).toEqual({ mode: 'fromMessage', anchorMessageId: null });
    expect(updateConversationMessage(base, 'm-1', { content: 'edited' }).requestContext).toEqual(base.requestContext);
  });
});
