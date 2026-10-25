import type { Conversation } from '../types/domain';
import { normalizeChatMessage } from '../engines/chatMessageNormalization';
import {
  hydrateChatMigrationConversations,
  readTypedChatSqliteLocalDataHydration,
  type ConversationCatalogRow,
  type ConversationRecordRow,
  type TypedChatSqliteLocalDataHydrationArgs
} from '../engines/localData';
import { rebuildConversationToolLedger } from '../engines/toolLedger';
import { normalizeConversationTitle } from './chatStoreTitles';
import type { PersistedChatState } from './chatCurrentPersistence';

export type ChatTypedSqlitePersistenceReadArgs = TypedChatSqliteLocalDataHydrationArgs;

export async function readChatStateFromTypedChatSqliteStore(
  args: ChatTypedSqlitePersistenceReadArgs
): Promise<PersistedChatState | null> {
  const hydration = await readTypedChatSqliteLocalDataHydration(args);
  if (hydration.rows.length === 0) return null;

  const hydratedConversations = hydrateChatMigrationConversations(hydration.rows);
  const activeConversations = hydratedConversations
    .filter((conversation) => conversation.state === 'active')
    .map((conversation) => toConversation(conversation.catalog, conversation.record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const quarantinedConversationIds = hydratedConversations
    .filter((conversation) => conversation.state === 'quarantined')
    .map((conversation) => conversation.id)
    .sort();
  const domainMeta = hydration.domainMeta.status === 'complete' ? hydration.domainMeta.value : null;

  return {
    conversations: activeConversations,
    activeConversationId: domainMeta?.activeConversationId ?? null,
    activeGroupRoomId: domainMeta?.activeGroupRoomId ?? null,
    groupRooms: domainMeta?.groupRooms ?? [],
    loadedConversationIds: activeConversations.map((conversation) => conversation.id),
    quarantinedConversationIds,
    deletedConversationIds: []
  };
}

function toConversation(
  catalog: ConversationCatalogRow,
  record: ConversationRecordRow
): Conversation {
  const messages = record.messages.map(normalizeChatMessage);
  return {
    id: catalog.id,
    title: normalizeConversationTitle(catalog.title, messages),
    kind: catalog.kind ?? 'direct',
    collaboratorId: catalog.collaboratorId,
    group: catalog.group,
    groupRoomId: catalog.groupRoomId ?? null,
    activeProjectId: catalog.activeProjectId,
    reasoningStrength: catalog.reasoningStrength,
    requestContext: catalog.requestContext,
    windowPreferences: catalog.windowPreferences,
    messages,
    toolLedger: rebuildConversationToolLedger(messages),
    workspaceLedger: record.workspaceLedger,
    task: record.task,
    draft: record.draft,
    pinnedAt: catalog.pinnedAt,
    updatedAt: catalog.updatedAt
  };
}
