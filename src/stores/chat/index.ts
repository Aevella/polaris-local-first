import type {
  ChatMessage,
  Conversation,
  GroupChatRoom,
  ToolLedgerEntry
} from '../../types/domain';
import type { ConversationCatalogLegacyLifecycleState } from '../../engines/localData';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import { isRetiredGroupConversation } from '../../engines/conversationOwnership';
import { runExclusiveChatPersistenceCommit } from '../chatPersistenceCommitQueue';
import {
  commitChatConversationRowChangesIfActive,
  readChatStateFromLocalDataLive,
  readConversationMessagesFromLocalDataLive,
  writeChatStateToLocalDataRepository,
  writeChatStateToLocalDataRepositoryIfActive,
  type ChatConversationRowChange
} from './localData';

const CHAT_CATALOG_KEY = 'chat-catalog-v1';
const CHAT_CONVERSATION_RECORD_PREFIX = 'chat-conversation-record-v1:';
const CHAT_CATALOG_SCHEMA_VERSION = 1;

export type ConversationRecord = Omit<Conversation, 'messages' | 'toolLedger'>;
export type ChatConversationLifecycleEntry = {
  state: ConversationCatalogLegacyLifecycleState;
  reason: string | null;
};
export type PersistedChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
  groupRooms?: GroupChatRoom[];
  activeGroupRoomId?: string | null;
  loadedConversationIds?: string[];
  recoveredConversationIds?: string[];
  prunedConversationIds?: string[];
  quarantinedConversationIds?: string[];
  failedConversationIds?: string[];
  deletedConversationIds?: string[];
  shouldCommitSnapshot?: boolean;
  // Per-conversation legacy lifecycle for sealed archive directory rows surfaced from the
  // new layer. Live product conversations are absent from this map; only archive /
  // recovering / quarantine / missing-body entries appear here.
  legacyLifecycleByConversationId?: Record<string, ChatConversationLifecycleEntry>;
};
export type ChatReadMode = 'complete' | 'active-only';
export type ChatPersistenceAttachmentClearResult = {
  changedConversationIds: string[];
  clearedAssetIds: string[];
  clearedAttachmentCount: number;
  clearedAt: number;
};
type ChatCatalogRecord = ConversationRecord & {
  recordKey: string;
  messageCount: number;
  latestMessageTimestamp: number;
};
type ChatCatalogPayload = {
  schemaVersion?: number;
  updatedAt: number;
  conversations: Array<ChatCatalogRecord & { toolLedger?: ToolLedgerEntry[] }>;
  activeConversationId: string | null;
  deletedConversationIds?: string[];
  quarantinedConversationIds?: string[];
};
type ChatConversationRecordPayload = {
  schemaVersion?: number;
  createdAt: number;
  updatedAt: number;
  conversation: ConversationRecord & { toolLedger?: ToolLedgerEntry[] };
  messages: ChatMessage[];
  messageCount: number;
  latestMessageTimestamp: number;
};

function toConversationRecord(conversation: Conversation): ConversationRecord {
  const { messages: _messages, toolLedger: _toolLedger, ...record } = conversation;
  return record;
}

function getSelfContainedConversationRecordKey(conversationId: string) {
  return `${CHAT_CONVERSATION_RECORD_PREFIX}${conversationId}`;
}

function getMessageLatestUpdatedAt(messages: ChatMessage[]) {
  return Math.max(0, ...messages.map((message) => message.timestamp));
}

function normalizeConversationIds(values: unknown): string[] {
  return Array.isArray(values)
    ? Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
    : [];
}

export function serializeChatStateEntries(params: PersistedChatState) {
  const createdAt = Date.now();
  const catalogRecords = params.conversations.map((conversation) =>
    toSelfContainedCatalogRecord(conversation)
  );
  return [
    ...params.conversations.map((conversation) => ({
      key: getSelfContainedConversationRecordKey(conversation.id),
      value: toSelfContainedConversationRecord(conversation, createdAt)
    })),
    {
      key: CHAT_CATALOG_KEY,
      value: {
        schemaVersion: CHAT_CATALOG_SCHEMA_VERSION,
        updatedAt: createdAt,
        conversations: catalogRecords,
        activeConversationId: params.activeConversationId,
        deletedConversationIds: [],
        quarantinedConversationIds: normalizeConversationIds(params.quarantinedConversationIds)
      } satisfies ChatCatalogPayload
    }
  ];
}

function toSelfContainedCatalogRecord(
  conversation: Conversation,
  fallback?: Pick<ChatCatalogRecord, 'messageCount' | 'latestMessageTimestamp'>
): ChatCatalogRecord {
  return {
    ...toConversationRecord(conversation),
    recordKey: getSelfContainedConversationRecordKey(conversation.id),
    messageCount: fallback?.messageCount ?? conversation.messages.length,
    latestMessageTimestamp: fallback?.latestMessageTimestamp ?? getMessageLatestUpdatedAt(conversation.messages)
  };
}

function toSelfContainedConversationRecord(
  conversation: Conversation,
  createdAt: number
): ChatConversationRecordPayload {
  return {
    schemaVersion: CHAT_CATALOG_SCHEMA_VERSION,
    createdAt,
    updatedAt: conversation.updatedAt,
    conversation: toConversationRecord(conversation),
    messages: conversation.messages,
    messageCount: conversation.messages.length,
    latestMessageTimestamp: getMessageLatestUpdatedAt(conversation.messages)
  };
}

export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((left, right) => {
    const pinDelta = Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));
    if (pinDelta !== 0) return pinDelta;
    return right.updatedAt - left.updatedAt;
  });
}

export async function readLiveChatStateWithOptions(options: {
  readMode?: ChatReadMode;
  throwOnReadFailure?: boolean;
  integrity?: 'strict' | 'recover';
} = {}): Promise<PersistedChatState | null> {
  try {
    return await readChatStateFromLocalDataLive({
      readMode: options.readMode ?? 'complete',
      integrity: options.integrity ?? (options.throwOnReadFailure ? 'strict' : 'recover')
    });
  } catch (error) {
    reportPersistenceError({ label: '[store:persist]', store: 'chat', operation: 'read-live-local-data' }, error);
    if (options.throwOnReadFailure) throw error;
    return null;
  }
}

export async function readCompleteLiveChatState(
  options: { throwOnReadFailure?: boolean; integrity?: 'strict' | 'recover' } = {}
): Promise<PersistedChatState | null> {
  return await readLiveChatStateWithOptions({ readMode: 'complete', ...options });
}

export async function readConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  try {
    const localDataRead = await readConversationMessagesFromLocalDataLive(conversationId);
    if (localDataRead.status === 'complete') return localDataRead.messages;
    if (
      localDataRead.status === 'deleted'
      || localDataRead.status === 'missing'
      // `inactive` means the new layer holds no chat rows for this id. The old layer is
      // historical material only — an ordinary body read never falls back to it, and sealed
      // lifecycle rows are excluded from live chat instead of being restored here.
      || localDataRead.status === 'inactive'
    ) {
      throw new Error(`Conversation message chunk is missing: ${conversationId}`);
    }
    throw new Error(`Active chat LocalData record ${conversationId} is ${localDataRead.status}: ${localDataRead.reason}`);
  } catch (error) {
    reportPersistenceError({ label: '[store:persist]', store: 'chat', operation: 'read-local-data-messages' }, error);
    throw error;
  }
}

export async function clearPersistedConversationAttachmentsByAssetIds(
  assetIds: string[],
  clearedAt = Date.now()
): Promise<ChatPersistenceAttachmentClearResult> {
  const targetAssetIds = new Set(assetIds.map((assetId) => assetId.trim()).filter(Boolean));
  const result: ChatPersistenceAttachmentClearResult = {
    changedConversationIds: [],
    clearedAssetIds: [],
    clearedAttachmentCount: 0,
    clearedAt
  };
  if (targetAssetIds.size === 0) return result;

  // Attachment cleanup is an ordinary product write: it reads the new layer only. Sealed
  // archive entries surface as unloaded shells (empty messages) and are naturally skipped;
  // their attachments are cleared after they are recovered into active rows, never from the
  // old layer.
  const payload = await readCompleteLiveChatState();
  if (!payload) return result;

  const clearedAssetIds = new Set<string>();
  const changedConversationIds: string[] = [];
  const conversations = payload.conversations.map((conversation) => {
    let didChangeConversation = false;
    const messages = conversation.messages.map((message) => {
      if (!message.attachments?.length) return message;

      let didChangeMessage = false;
      const attachments = message.attachments.map((attachment) => {
        if (!targetAssetIds.has(attachment.assetId) || attachment.clearedAt) return attachment;

        didChangeConversation = true;
        didChangeMessage = true;
        result.clearedAttachmentCount += 1;
        clearedAssetIds.add(attachment.assetId);
        const { textContent: _textContent, ...rest } = attachment;
        return {
          ...rest,
          clearedAt
        };
      });

      return didChangeMessage
        ? {
            ...message,
            attachments
          }
        : message;
    });

    if (!didChangeConversation) return conversation;
    changedConversationIds.push(conversation.id);
    return {
      ...conversation,
      messages
    };
  });

  if (result.clearedAttachmentCount === 0) return result;

  // Every changed conversation had matching attachments, so its body is loaded;
  // route the batch through the object-row writer like any other ordinary edit.
  await persistChatStateChange({
    conversations,
    activeConversationId: payload.activeConversationId,
    dirtyConversationIds: changedConversationIds,
    loadedConversationIds: changedConversationIds,
    deletedConversationIds: []
  });

  result.changedConversationIds = changedConversationIds;
  result.clearedAssetIds = [...clearedAssetIds];
  return result;
}

export async function writeChatState(params: {
  conversations: Conversation[];
  activeConversationId: string | null;
  groupRooms?: GroupChatRoom[];
  activeGroupRoomId?: string | null;
  dirtyConversationIds?: string[];
  loadedConversationIds?: string[];
  deletedConversationIds?: string[];
  quarantinedConversationIds?: string[];
}) {
  await runExclusiveChatPersistenceCommit(async () => {
    if (await writeChatStateToLocalDataRepositoryIfActive(params)) return;
    await writeChatStateToLocalDataRepository(params);
  });
}

export type ChatStateChange = {
  conversations: Conversation[];
  activeConversationId: string | null;
  dirtyConversationIds: string[];
  loadedConversationIds: string[];
  deletedConversationIds: string[];
};

/**
 * Persist one batch of chat changes. When the LocalData chat repository is active,
 * the changed conversation facts (message/metadata upserts and tombstones) and the
 * active-conversation pointer are written as object-row changes in one unit of
 * work, instead of rebuilding a whole-chat snapshot. A dirty retired group shell is
 * turned into a delete change here so the row writer only sees live conversations.
 * The inactive/overlay repository, and a change set that references a conversation
 * not present here, fall back to `writeChatState`, which keeps the whole-store write
 * path for now. A malformed change set (the same conversation twice, or a metadata
 * edit with no live catalog) is a programming error and throws from the row writer.
 */
export async function persistChatStateChange(change: ChatStateChange): Promise<void> {
  if (await tryPersistChatStateChangeThroughRowWriters(change)) return;
  await writeChatState({
    conversations: change.conversations,
    activeConversationId: change.activeConversationId,
    groupRooms: [],
    activeGroupRoomId: null,
    dirtyConversationIds: change.dirtyConversationIds,
    loadedConversationIds: change.loadedConversationIds,
    deletedConversationIds: change.deletedConversationIds
  });
}

async function tryPersistChatStateChangeThroughRowWriters(change: ChatStateChange): Promise<boolean> {
  const changes: ChatConversationRowChange[] = [];

  for (const deletedConversationId of change.deletedConversationIds) {
    changes.push({ type: 'delete', conversationId: deletedConversationId });
  }
  for (const dirtyConversationId of change.dirtyConversationIds) {
    const conversation = change.conversations.find(
      (candidate) => candidate.id === dirtyConversationId
    );
    if (!conversation) return false;
    if (isRetiredGroupConversation(conversation)) {
      // A retired group shell is a tombstone, not a writable conversation; turn it
      // into a delete here so the row writer only ever sees live conversations.
      changes.push({ type: 'delete', conversationId: conversation.id });
      continue;
    }
    changes.push(
      change.loadedConversationIds.includes(dirtyConversationId)
        ? { type: 'upsertRecord', conversation }
        : { type: 'upsertMetadata', conversation }
    );
  }

  // The active conversation is recorded verbatim; the store keeps it pointed at a
  // live conversation (it moves the pointer off a deleted one before persisting).
  return await commitChatConversationRowChangesIfActive({
    changes,
    activeConversationId: change.activeConversationId
  });
}
