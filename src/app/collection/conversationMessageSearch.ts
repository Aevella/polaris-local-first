import type { ChatMessage, Conversation } from '../../types/domain';

export const CONVERSATION_MESSAGE_SEARCH_PREVIEW_LIMIT = 3;

const SEARCH_EXCERPT_BEFORE = 26;
const SEARCH_EXCERPT_AFTER = 54;
const SEARCH_FALLBACK_EXCERPT_LENGTH = 92;

export type ConversationMessageSearchMatch = {
  messageId: string;
  role: ChatMessage['role'];
  timestamp: number;
  excerpt: string;
};

export type ConversationMessageSearchResult = {
  matches: ConversationMessageSearchMatch[];
  total: number;
};

export type ConversationMessageSearchIndex = Record<string, ConversationMessageSearchResult | undefined>;

export function normalizeConversationSearchQuery(value: string) {
  return value.trim().toLowerCase();
}

function compactSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function buildMessageSearchText(message: ChatMessage) {
  return compactSearchText([
    message.content,
    ...(message.attachments ?? []).map((attachment) => attachment.name)
  ].filter(Boolean).join('\n'));
}

export function buildConversationSearchText(conversation: Conversation, collaboratorName: string | null) {
  return [
    conversation.title,
    collaboratorName ?? '',
    ...conversation.messages.map(buildMessageSearchText)
  ].join('\n');
}

function buildMessageSearchExcerpt(messageText: string, normalizedQuery: string) {
  const matchIndex = messageText.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex < 0) {
    return truncateText(messageText, SEARCH_FALLBACK_EXCERPT_LENGTH);
  }

  const start = Math.max(0, matchIndex - SEARCH_EXCERPT_BEFORE);
  const end = Math.min(messageText.length, matchIndex + normalizedQuery.length + SEARCH_EXCERPT_AFTER);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < messageText.length ? '...' : '';
  return `${prefix}${messageText.slice(start, end).trim()}${suffix}`;
}

export function buildConversationMessageSearchMatches(
  conversation: Conversation,
  rawQuery: string,
  previewLimit = CONVERSATION_MESSAGE_SEARCH_PREVIEW_LIMIT
): ConversationMessageSearchResult {
  const query = normalizeConversationSearchQuery(rawQuery);
  if (!query) return { matches: [], total: 0 };

  const matches: ConversationMessageSearchMatch[] = [];
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    const messageText = buildMessageSearchText(message);
    if (!messageText.toLowerCase().includes(query)) continue;

    matches.push({
      messageId: message.id,
      role: message.role,
      timestamp: message.timestamp,
      excerpt: buildMessageSearchExcerpt(messageText, query)
    });
  }

  return {
    matches: matches.slice(0, previewLimit),
    total: matches.length
  };
}

export function buildConversationMessageSearchIndex(
  conversations: Conversation[],
  rawQuery: string
): ConversationMessageSearchIndex {
  const query = normalizeConversationSearchQuery(rawQuery);
  if (!query) return {};

  return Object.fromEntries(
    conversations
      .map((conversation) => {
        const result = buildConversationMessageSearchMatches(conversation, query);
        return result.total > 0 ? [conversation.id, result] as const : null;
      })
      .filter((entry): entry is readonly [string, ConversationMessageSearchResult] => Boolean(entry))
  );
}
