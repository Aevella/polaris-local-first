import type { ChatMessage, Conversation } from '../../types/domain';
import type { LocalDataSqliteQueryRow } from './localDataSqliteBackend';
import type { TypedChatSqliteConversationMetadata } from './chatSqliteTypes';

export function requireString(row: LocalDataSqliteQueryRow, key: string, label: string) {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Typed chat SQLite row is missing ${key} for ${label}`);
  }
  return value;
}

export function nullableString(row: LocalDataSqliteQueryRow, key: string) {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function nullableNumber(row: LocalDataSqliteQueryRow, key: string) {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function requireNumber(row: LocalDataSqliteQueryRow, key: string, label: string) {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Typed chat SQLite row is missing ${key} for ${label}`);
  }
  return value;
}

export function timestamp(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function conversationCreatedAt(conversation: Conversation) {
  const messageTimestamps = conversation.messages
    .map((message) => timestamp(message.timestamp))
    .filter((value) => value > 0);
  if (messageTimestamps.length === 0) return timestamp(conversation.updatedAt);
  return Math.min(...messageTimestamps);
}

export function latestMessageTimestamp(messages: ChatMessage[]) {
  return Math.max(0, ...messages.map((message) => timestamp(message.timestamp)));
}

export function serializeConversationMetadata(conversation: Conversation) {
  try {
    const metadataJson = JSON.stringify(toConversationMetadata(conversation));
    if (typeof metadataJson !== 'string') {
      throw new Error('conversation metadata is not JSON-persistable');
    }
    return metadataJson;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Typed chat SQLite conversation metadata is not JSON-persistable for ${conversation.id}: ${messageText}`
    );
  }
}

export function serializeMessagePayload(message: ChatMessage, conversationId: string) {
  try {
    const payloadJson = JSON.stringify(message);
    if (typeof payloadJson !== 'string') {
      throw new Error('message is not JSON-persistable');
    }
    return payloadJson;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Typed chat SQLite message is not JSON-persistable for ${conversationId}: ${messageText}`
    );
  }
}

export function deserializeConversationMetadata(
  row: LocalDataSqliteQueryRow,
  conversationId: string
) {
  const metadataJson = requireString(row, 'metadata_json', conversationId);
  try {
    const metadata = JSON.parse(metadataJson) as TypedChatSqliteConversationMetadata;
    if (!isObjectRecord(metadata) || metadata.id !== conversationId) {
      throw new Error('metadata id does not match conversation id');
    }
    return metadata;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Typed chat SQLite conversation metadata is invalid for ${conversationId}: ${messageText}`
    );
  }
}

export function deserializeMessagePayload(row: LocalDataSqliteQueryRow, conversationId: string) {
  const payloadJson = requireString(row, 'payload_json', conversationId);
  try {
    return JSON.parse(payloadJson) as ChatMessage;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Typed chat SQLite message payload is invalid for ${conversationId}: ${messageText}`
    );
  }
}

export function assertWindowLimit(limit: number) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Typed chat SQLite message window limit must be a positive integer');
  }
}

export function readCount(row: LocalDataSqliteQueryRow | undefined) {
  if (!row) return 0;
  const value = row.message_count ?? row.messageCount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toConversationMetadata(conversation: Conversation): TypedChatSqliteConversationMetadata {
  return {
    id: conversation.id,
    title: conversation.title,
    kind: conversation.kind,
    collaboratorId: conversation.collaboratorId,
    group: conversation.group,
    groupRoomId: conversation.groupRoomId,
    activeProjectId: conversation.activeProjectId,
    reasoningStrength: conversation.reasoningStrength,
    requestContext: conversation.requestContext,
    windowPreferences: conversation.windowPreferences,
    workspaceLedger: conversation.workspaceLedger,
    task: conversation.task,
    draft: conversation.draft,
    pinnedAt: conversation.pinnedAt,
    updatedAt: conversation.updatedAt
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
