import type { ChatMessage, Conversation } from '../types/domain';

export type ChatConversationBodyStatus =
  | { state: 'notLoaded'; updatedAt: number }
  | { state: 'loading'; updatedAt: number }
  | { state: 'loaded'; updatedAt: number }
  | { state: 'missing'; updatedAt: number; reason: string }
  | { state: 'failed'; updatedAt: number; reason: string };

export type WritableConversationBody = {
  conversationId: string;
  conversation: Conversation;
  messages: ChatMessage[];
};

type ConversationBodyStatusSnapshot = {
  conversationBodyStatuses: Record<string, ChatConversationBodyStatus>;
  loadedMessageConversationIds: string[];
  loadingMessageConversationIds: string[];
};

type ConversationWritableSnapshot = ConversationBodyStatusSnapshot & {
  conversations: Conversation[];
};

function appendConversationId(conversationIds: string[], conversationId: string) {
  return conversationIds.includes(conversationId) ? conversationIds : [...conversationIds, conversationId];
}

export function createBodyStatus(state: ChatConversationBodyStatus['state'], options: {
  reason?: string;
  updatedAt?: number;
} = {}): ChatConversationBodyStatus {
  const updatedAt = options.updatedAt ?? Date.now();
  if (state === 'missing' || state === 'failed') {
    return {
      state,
      updatedAt,
      reason: options.reason ?? 'Conversation body is not available.'
    };
  }
  return { state, updatedAt };
}

export function getConversationBodyState(
  state: ConversationBodyStatusSnapshot,
  conversationId: string
): ChatConversationBodyStatus['state'] {
  const status = state.conversationBodyStatuses[conversationId]?.state;
  if (status) return status;
  if (state.loadedMessageConversationIds.includes(conversationId)) return 'loaded';
  if (state.loadingMessageConversationIds.includes(conversationId)) return 'loading';
  return 'notLoaded';
}

export function canWriteConversationBody(
  state: ConversationBodyStatusSnapshot,
  conversationId: string
) {
  return getConversationBodyState(state, conversationId) === 'loaded';
}

export function getConversationWritableFromState(
  state: ConversationWritableSnapshot,
  conversationId: string
): WritableConversationBody | null {
  if (!canWriteConversationBody(state, conversationId)) return null;
  const conversation = state.conversations.find((entry) => entry.id === conversationId) ?? null;
  if (!conversation) return null;
  return {
    conversationId,
    conversation,
    messages: conversation.messages
  };
}

export function assertWritableConversationBody(
  state: ConversationBodyStatusSnapshot,
  conversationId: string,
  action: string
) {
  const bodyState = getConversationBodyState(state, conversationId);
  if (bodyState !== 'loaded') {
    throw new Error(`Cannot ${action} before conversation body is loaded: ${conversationId} (${bodyState})`);
  }
}

export function withConversationBodyStatus(
  state: ConversationBodyStatusSnapshot,
  conversationId: string,
  status: ChatConversationBodyStatus
) {
  const conversationBodyStatuses = {
    ...state.conversationBodyStatuses,
    [conversationId]: status
  };
  return {
    conversationBodyStatuses,
    loadedMessageConversationIds: status.state === 'loaded'
      ? appendConversationId(state.loadedMessageConversationIds, conversationId)
      : state.loadedMessageConversationIds.filter((id) => id !== conversationId),
    loadingMessageConversationIds: status.state === 'loading'
      ? appendConversationId(state.loadingMessageConversationIds, conversationId)
      : state.loadingMessageConversationIds.filter((id) => id !== conversationId)
  };
}

export function withoutConversationBodyStatus(
  state: ConversationBodyStatusSnapshot,
  conversationId: string
) {
  const { [conversationId]: _removed, ...conversationBodyStatuses } = state.conversationBodyStatuses;
  return {
    conversationBodyStatuses,
    loadedMessageConversationIds: state.loadedMessageConversationIds.filter((id) => id !== conversationId),
    loadingMessageConversationIds: state.loadingMessageConversationIds.filter((id) => id !== conversationId)
  };
}

export function hydrateConversationBodyStatuses(
  conversations: Conversation[],
  loadedConversationIds: string[],
  failedConversationIds: string[] = []
): Record<string, ChatConversationBodyStatus> {
  const loadedConversationIdSet = new Set(loadedConversationIds);
  const failedConversationIdSet = new Set(failedConversationIds);
  const updatedAt = Date.now();
  return Object.fromEntries(conversations.map((conversation) => [
    conversation.id,
    createBodyStatus(
      failedConversationIdSet.has(conversation.id)
        ? 'failed'
        : loadedConversationIdSet.has(conversation.id) ? 'loaded' : 'notLoaded',
      {
        updatedAt,
        reason: failedConversationIdSet.has(conversation.id)
          ? 'Conversation body was isolated because its stored row is incomplete.'
          : undefined
      }
    )
  ]));
}

export function loadedConversationIdsFromBodyStatuses(
  state: ConversationBodyStatusSnapshot & { conversations: Conversation[] }
) {
  return state.conversations
    .filter((conversation) => getConversationBodyState(state, conversation.id) === 'loaded')
    .map((conversation) => conversation.id);
}
