import type { ChatMessage, Conversation, ConversationTaskState, WorkspaceLedgerEvent } from '../../types/domain';
import {
  LocalDataProjectionContractError,
  type ChatConversationLocalDataArgs
} from './chatConversationContracts';
import type { LocalDataMigrationValidationReport } from './types';

export type ChatMigrationLegacyConversationSnapshot = {
  id: string;
  title: string;
  collaboratorId: string | null;
  activeProjectId?: string | null;
  task?: ConversationTaskState | null;
  reasoningStrength?: Conversation['reasoningStrength'];
  requestContext?: Conversation['requestContext'];
  windowPreferences?: Conversation['windowPreferences'];
  toolLedger?: Conversation['toolLedger'];
  draft?: string;
  workspaceLedger?: WorkspaceLedgerEvent[];
  pinnedAt: number | null;
  updatedAt: number;
  messages?: ChatMessage[];
  expectedMessageCount?: number;
  expectedLatestMessageTimestamp?: number;
  missingRecordKeys?: string[];
};

export type ChatMigrationLegacySnapshot = {
  conversations: ChatMigrationLegacyConversationSnapshot[];
  activeConversationId: string | null;
  deletedConversationIds?: readonly string[];
  quarantinedConversationIds?: readonly string[];
};

export type ChatMigrationPlan = {
  activeConversationId: string | null;
  legacyBaselineConversationIds: string[];
  legacyActiveConversationIds: string[];
  conversations: ChatConversationLocalDataArgs[];
  metadataDegradationReasons?: LocalDataMigrationValidationReport['metadataDegradationReasons'];
};

export function planChatMigrationFromLegacySnapshot(args: {
  snapshot: ChatMigrationLegacySnapshot;
  version: number;
  committedAt: number;
}): ChatMigrationPlan {
  const deletedConversationIds = new Set(normalizeIdList(args.snapshot.deletedConversationIds));
  const quarantinedConversationIds = new Set(normalizeIdList(args.snapshot.quarantinedConversationIds));
  const seenConversationIds = new Set<string>();
  const legacyBaselineConversationIds: string[] = [];
  const legacyActiveConversationIds: string[] = [];
  const conversations: ChatConversationLocalDataArgs[] = [];
  const activeProjectionIds = new Set<string>();

  for (const source of args.snapshot.conversations) {
    assertValidSourceConversationId(source.id);
    if (seenConversationIds.has(source.id)) {
      throw new LocalDataProjectionContractError(`Chat migration source contains duplicate conversation id: ${source.id}`);
    }
    seenConversationIds.add(source.id);
    if (deletedConversationIds.has(source.id)) continue;

    legacyBaselineConversationIds.push(source.id);
    const isKnownQuarantined = quarantinedConversationIds.has(source.id);

    if (Array.isArray(source.messages) && !isKnownQuarantined) {
      legacyActiveConversationIds.push(source.id);
      activeProjectionIds.add(source.id);
      conversations.push({
        conversation: toConversation(source, source.messages),
        bodyState: 'complete',
        version: args.version,
        committedAt: args.committedAt,
        expectedMessageCount: source.expectedMessageCount,
        expectedLatestMessageTimestamp: source.expectedLatestMessageTimestamp
      });
      continue;
    }

    const expectedMetadata = resolveExpectedNonCompleteMetadata(source);
    conversations.push({
      conversation: toConversation(source, []),
      bodyState: 'incomplete',
      expectedMessageCount: expectedMetadata.expectedMessageCount,
      expectedLatestMessageTimestamp: expectedMetadata.expectedLatestMessageTimestamp,
      missingKeys: source.missingRecordKeys?.length ? source.missingRecordKeys : [`legacy-chat-record:${source.id}`],
      version: args.version,
      committedAt: args.committedAt
    });
  }

  const activeConversationId = resolveActiveConversationId(
    args.snapshot.activeConversationId,
    activeProjectionIds
  );
  const metadataDegradationReasons =
    args.snapshot.activeConversationId !== null && activeConversationId === null
      ? {
          activeConversationId: 'legacy active conversation did not hydrate into the active projection'
        }
      : undefined;

  return {
    activeConversationId,
    legacyBaselineConversationIds: uniqueSortedIds(legacyBaselineConversationIds),
    legacyActiveConversationIds: uniqueSortedIds(legacyActiveConversationIds),
    conversations,
    metadataDegradationReasons
  };
}

function toConversation(source: ChatMigrationLegacyConversationSnapshot, messages: ChatMessage[]): Conversation {
  return {
    id: source.id,
    title: source.title,
    collaboratorId: source.collaboratorId,
    activeProjectId: source.activeProjectId ?? null,
    messages,
    reasoningStrength: source.reasoningStrength,
    requestContext: source.requestContext,
    windowPreferences: source.windowPreferences,
    toolLedger: source.toolLedger,
    workspaceLedger: source.workspaceLedger ?? [],
    task: source.task ?? null,
    draft: source.draft ?? '',
    pinnedAt: source.pinnedAt,
    updatedAt: source.updatedAt
  };
}

function resolveActiveConversationId(activeConversationId: string | null, activeProjectionIds: Set<string>) {
  if (activeConversationId === null) return null;
  return activeProjectionIds.has(activeConversationId) ? activeConversationId : null;
}

function assertValidSourceConversationId(id: string) {
  if (!id.trim()) {
    throw new LocalDataProjectionContractError('Chat migration source conversation requires an id.');
  }
}

function resolveExpectedNonCompleteMetadata(source: ChatMigrationLegacyConversationSnapshot): {
  expectedMessageCount: number;
  expectedLatestMessageTimestamp: number;
} {
  if (
    Array.isArray(source.messages)
    && source.expectedMessageCount === undefined
    && source.expectedLatestMessageTimestamp === undefined
  ) {
    return {
      expectedMessageCount: source.messages.length,
      expectedLatestMessageTimestamp: latestMessageTimestamp(source.messages)
    };
  }
  if (
    !Number.isFinite(source.expectedMessageCount)
    || typeof source.expectedMessageCount !== 'number'
    || source.expectedMessageCount < 0
  ) {
    throw new LocalDataProjectionContractError(
      'Chat migration non-complete source requires expectedMessageCount.'
    );
  }
  if (
    !Number.isFinite(source.expectedLatestMessageTimestamp)
    || typeof source.expectedLatestMessageTimestamp !== 'number'
    || source.expectedLatestMessageTimestamp < 0
  ) {
    throw new LocalDataProjectionContractError(
      'Chat migration non-complete source requires expectedLatestMessageTimestamp.'
    );
  }
  return {
    expectedMessageCount: source.expectedMessageCount,
    expectedLatestMessageTimestamp: source.expectedLatestMessageTimestamp
  };
}

function normalizeIdList(values: readonly string[] | undefined) {
  return values?.filter((value) => value.trim()) ?? [];
}

function uniqueSortedIds(ids: Iterable<string>) {
  return Array.from(new Set(ids)).sort();
}

function latestMessageTimestamp(messages: ChatMessage[]) {
  return Math.max(0, ...messages.map((message) => message.timestamp));
}
