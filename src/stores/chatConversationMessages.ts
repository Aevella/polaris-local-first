import { rebuildConversationToolLedger } from '../engines/toolLedger';
import type { ChatMessage, Conversation } from '../types/domain';
import { deriveMessageTitle, normalizeConversationTitle, resolveConversationTitle } from './chatStoreTitles';

export function syncConversationToolLedger(conversation: Conversation): Conversation {
  return {
    ...conversation,
    toolLedger: rebuildConversationToolLedger(conversation.messages)
  };
}

export function appendConversationMessage(conversation: Conversation, message: ChatMessage): Conversation {
  return syncConversationToolLedger({
    ...conversation,
    updatedAt: Date.now(),
    title:
      conversation.kind !== 'group' && conversation.messages.length === 0 && message.role === 'user'
        ? deriveMessageTitle(message)
        : conversation.title,
    messages: [...conversation.messages, message]
  });
}

export function appendConversationMessageInRecords(
  conversations: Conversation[],
  conversationId: string,
  message: ChatMessage
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? appendConversationMessage(conversation, message)
      : conversation
  );
}

export function insertConversationMessageBefore(
  conversation: Conversation,
  beforeMessageId: string,
  message: ChatMessage
): Conversation {
  const insertIndex = conversation.messages.findIndex((entry) => entry.id === beforeMessageId);
  const nextMessages =
    insertIndex < 0
      ? [...conversation.messages, message]
      : [
          ...conversation.messages.slice(0, insertIndex),
          message,
          ...conversation.messages.slice(insertIndex)
        ];

  return syncConversationToolLedger({
    ...conversation,
    updatedAt: Date.now(),
    messages: nextMessages
  });
}

export function insertConversationMessageBeforeInRecords(
  conversations: Conversation[],
  conversationId: string,
  beforeMessageId: string,
  message: ChatMessage
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? insertConversationMessageBefore(conversation, beforeMessageId, message)
      : conversation
  );
}

export function insertConversationMessageAfter(
  conversation: Conversation,
  afterMessageId: string,
  message: ChatMessage
): Conversation {
  const insertIndex = conversation.messages.findIndex((entry) => entry.id === afterMessageId);
  const nextMessages =
    insertIndex < 0
      ? [...conversation.messages, message]
      : [
          ...conversation.messages.slice(0, insertIndex + 1),
          message,
          ...conversation.messages.slice(insertIndex + 1)
        ];

  return syncConversationToolLedger({
    ...conversation,
    updatedAt: Date.now(),
    messages: nextMessages
  });
}

export function insertConversationMessageAfterInRecords(
  conversations: Conversation[],
  conversationId: string,
  afterMessageId: string,
  message: ChatMessage
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? insertConversationMessageAfter(conversation, afterMessageId, message)
      : conversation
  );
}

export function updateConversationMessage(
  conversation: Conversation,
  messageId: string,
  patch: Partial<ChatMessage>
): Conversation {
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) return conversation;
  const previous = conversation.messages[index];
  if (!(Object.keys(patch) as Array<keyof ChatMessage>).some(key => !Object.is(previous[key], patch[key]))) return conversation;
  const next = { ...previous, ...patch };
  const messages = conversation.messages.slice();
  messages[index] = next;
  const updated = { ...conversation, messages,
    requestContext: conversation.requestContext?.mode === 'fromMessage' && conversation.requestContext.anchorMessageId === messageId
      && (next.id !== messageId || (next.role !== 'user' && next.role !== 'assistant') || next.toolInvocation)
      ? { mode: 'fromMessage' as const, anchorMessageId: null } : conversation.requestContext };
  return previous.id !== next.id || previous.role !== next.role || previous.nativeToolCalls !== next.nativeToolCalls || previous.toolInvocation !== next.toolInvocation
    ? syncConversationToolLedger(updated) : updated;
}

export function updateConversationMessageInRecords(
  conversations: Conversation[],
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? updateConversationMessage(conversation, messageId, patch)
      : conversation
  );
}

export function replaceConversationMessages(conversation: Conversation, messages: ChatMessage[]): Conversation {
  return syncConversationToolLedger({
    ...conversation,
    updatedAt: Date.now(),
    title: resolveConversationTitle(conversation.title, conversation.messages, messages),
    requestContext: conversation.requestContext?.mode === 'fromMessage' && !messages.some(message => conversation.requestContext?.mode === 'fromMessage' && message.id === conversation.requestContext.anchorMessageId && (message.role === 'user' || message.role === 'assistant') && !message.toolInvocation)
      ? { mode: 'fromMessage', anchorMessageId: null } : conversation.requestContext,
    messages
  });
}

export function replaceConversationMessagesInRecords(
  conversations: Conversation[],
  conversationId: string,
  messages: ChatMessage[]
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? replaceConversationMessages(conversation, messages)
      : conversation
  );
}

export function applyLoadedConversationMessages(conversation: Conversation, messages: ChatMessage[]): Conversation {
  return syncConversationToolLedger({
    ...conversation,
    title: normalizeConversationTitle(conversation.title, messages),
    messages
  });
}
