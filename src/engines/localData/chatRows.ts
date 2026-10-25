import type { ChatMessage } from '../../types/domain';
import {
  LocalDataProjectionContractError,
  type ChatConversationLocalDataArgs,
  collectChatMessageAssetRefs,
  assertCompleteConversationBody,
  assertNonCompleteConversationMetadata,
  toConversationDurableSnapshot
} from './chatConversationContracts';
import {
  type ChatDomainMetaRow,
  type ConversationCatalogRow,
  type ConversationCatalogState,
  type ConversationRecordRow,
  type LocalDataRef,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type LocalDataUnitOfWork,
  createCompleteLocalDataRow
} from './types';

export type { ChatConversationLocalDataArgs } from './chatConversationContracts';
export type ChatConversationBodyState = ChatConversationLocalDataArgs['bodyState'];

export type ChatConversationLocalDataProjection = {
  catalogRow: LocalDataStoredRow<ConversationCatalogRow>;
  recordRow?: LocalDataStoredRow<ConversationRecordRow>;
};

export type ChatDomainLocalDataProjection = {
  domainMetaRow: LocalDataStoredRow<ChatDomainMetaRow>;
};

export function getChatDomainMetaLocalDataRef(): LocalDataRef {
  return {
    domain: 'chat',
    kind: 'domainMeta',
    id: 'chat'
  };
}

export function getConversationCatalogLocalDataRef(conversationId: string): LocalDataRef {
  return {
    domain: 'chat',
    kind: 'conversationCatalog',
    id: conversationId
  };
}

export function getConversationRecordLocalDataRef(conversationId: string): LocalDataRef {
  return {
    domain: 'chat',
    kind: 'conversationRecord',
    id: conversationId
  };
}

export const CHAT_CATALOG_LEGACY_LIFECYCLE_STATES = [
  'archive',
  'recovering',
  'quarantine',
  'missing-body'
] as const satisfies readonly ConversationCatalogState[];

const CHAT_CATALOG_LEGACY_LIFECYCLE_STATE_SET = new Set<ConversationCatalogState>(
  CHAT_CATALOG_LEGACY_LIFECYCLE_STATES
);

/** True when the catalog row is a sealed legacy entry, not a live product conversation. */
export function isLegacyLifecycleCatalogState(state: ConversationCatalogState): boolean {
  return CHAT_CATALOG_LEGACY_LIFECYCLE_STATE_SET.has(state);
}

/** True when the catalog row is a live, writable product conversation. */
export function isLiveProductCatalogState(state: ConversationCatalogState): boolean {
  return state === 'active' || state === 'unloaded' || state === 'incomplete';
}

export function collectConversationAssetRefs(messages: ChatMessage[]) {
  const assetIds = new Set<string>();

  for (const message of messages) {
    for (const assetId of collectChatMessageAssetRefs(message)) assetIds.add(assetId);
  }

  return Array.from(assetIds).sort();
}

function latestMessageTimestamp(messages: ChatMessage[]) {
  return Math.max(0, ...messages.map((message) => message.timestamp));
}

function resolveExpectedMessageCount(args: ChatConversationLocalDataArgs) {
  if (args.bodyState !== 'complete') {
    assertNonCompleteConversationMetadata(args);
    return args.expectedMessageCount;
  }
  return typeof args.expectedMessageCount === 'number'
    ? args.expectedMessageCount
    : args.conversation.messages.length;
}

function resolveExpectedLatestMessageTimestamp(args: ChatConversationLocalDataArgs) {
  if (args.bodyState !== 'complete') {
    assertNonCompleteConversationMetadata(args);
    return args.expectedLatestMessageTimestamp;
  }
  return typeof args.expectedLatestMessageTimestamp === 'number'
    ? args.expectedLatestMessageTimestamp
    : latestMessageTimestamp(args.conversation.messages);
}

function resolveCatalogState(args: ChatConversationLocalDataArgs): ConversationCatalogRow['state'] {
  if (args.bodyState === 'unloaded') return 'unloaded';
  if (args.bodyState === 'incomplete') return 'incomplete';
  return 'active';
}

function assertCompleteConversationProjection(args: ChatConversationLocalDataArgs) {
  if (args.bodyState !== 'complete') return;
  const snapshot = toConversationDurableSnapshot(args.conversation);
  assertCompleteConversationBody(snapshot);
  const actualMessageCount = snapshot.messages.length;
  const actualLatestMessageTimestamp = latestMessageTimestamp(snapshot.messages);
  if (
    typeof args.expectedMessageCount === 'number'
    && args.expectedMessageCount !== actualMessageCount
  ) {
    throw new LocalDataProjectionContractError(
      'Complete conversation projection cannot shrink or expand expectedMessageCount.'
    );
  }
  if (
    typeof args.expectedLatestMessageTimestamp === 'number'
    && args.expectedLatestMessageTimestamp !== actualLatestMessageTimestamp
  ) {
    throw new LocalDataProjectionContractError(
      'Complete conversation projection cannot replace expectedLatestMessageTimestamp.'
    );
  }
}

export function buildConversationCatalogLocalDataRow(args: ChatConversationLocalDataArgs) {
  assertCompleteConversationProjection(args);
  const expectedMessageCount = resolveExpectedMessageCount(args);
  const expectedLatestMessageTimestamp = resolveExpectedLatestMessageTimestamp(args);
  const snapshot = toConversationDurableSnapshot(args.conversation);
  const value: ConversationCatalogRow = {
    id: snapshot.id,
    title: snapshot.title,
    kind: snapshot.kind ?? 'direct',
    collaboratorId: snapshot.collaboratorId ?? null,
    group: snapshot.group,
    groupRoomId: snapshot.groupRoomId ?? null,
    activeProjectId: snapshot.activeProjectId ?? null,
    reasoningStrength: snapshot.reasoningStrength,
    requestContext: snapshot.requestContext,
    windowPreferences: snapshot.windowPreferences,
    pinnedAt: snapshot.pinnedAt,
    updatedAt: snapshot.updatedAt,
    messageCount: expectedMessageCount,
    latestMessageTimestamp: Math.max(expectedLatestMessageTimestamp, 0),
    state: resolveCatalogState(args),
    missingRecordKeys: args.bodyState === 'incomplete' ? args.missingKeys : undefined,
    recordVersion: args.version
  };

  return createCompleteLocalDataRow({
    ref: getConversationCatalogLocalDataRef(args.conversation.id),
    value,
    version: args.version,
    updatedAt: args.conversation.updatedAt
  });
}

export function buildConversationRecordMetadata(
  args: Pick<ChatConversationLocalDataArgs, 'conversation' | 'version' | 'committedAt'>,
  assetRefs: string[]
): Omit<ConversationRecordRow, 'messages'> {
  const snapshot = toConversationDurableSnapshot(args.conversation);
  return {
    id: snapshot.id,
    version: args.version,
    committedAt: args.committedAt,
    task: snapshot.task ?? null,
    draft: snapshot.draft ?? '',
    workspaceLedger: snapshot.workspaceLedger ?? [],
    ownerProjectId: snapshot.activeProjectId ?? null,
    assetRefs
  };
}

export function buildConversationRecordLocalDataRow(args: ChatConversationLocalDataArgs) {
  assertCompleteConversationProjection(args);
  const ref = getConversationRecordLocalDataRef(args.conversation.id);

  if (args.bodyState !== 'complete') return undefined;

  const snapshot = toConversationDurableSnapshot(args.conversation);
  const value: ConversationRecordRow = {
    ...buildConversationRecordMetadata(args, collectConversationAssetRefs(snapshot.messages)),
    messages: snapshot.messages
  };

  return createCompleteLocalDataRow({
    ref,
    value,
    version: args.version,
    updatedAt: args.conversation.updatedAt
  });
}

export function buildConversationLocalDataProjection(
  args: ChatConversationLocalDataArgs
): ChatConversationLocalDataProjection {
  const recordRow = buildConversationRecordLocalDataRow(args);
  return {
    catalogRow: buildConversationCatalogLocalDataRow(args),
    ...(recordRow ? { recordRow } : {})
  };
}

export function buildChatDomainMetaLocalDataRow(args: {
  activeConversationId: string | null;
  activeGroupRoomId?: string | null;
  groupRooms?: ChatDomainMetaRow['groupRooms'];
  activeConversationCount: number;
  quarantinedConversationCount: number;
  totalConversationCount: number;
  version: number;
  updatedAt: number;
}) {
  const value: ChatDomainMetaRow = {
    id: 'chat',
    activeConversationId: args.activeConversationId,
    activeGroupRoomId: args.activeGroupRoomId ?? null,
    groupRooms: args.groupRooms ?? [],
    activeConversationCount: args.activeConversationCount,
    quarantinedConversationCount: args.quarantinedConversationCount,
    totalConversationCount: args.totalConversationCount,
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getChatDomainMetaLocalDataRef(),
    value,
    version: args.version,
    updatedAt: args.updatedAt
  });
}

export function buildConversationLocalDataUnitOfWork(args: {
  id?: string;
  activeConversationId: string | null;
  activeGroupRoomId?: string | null;
  groupRooms?: ChatDomainMetaRow['groupRooms'];
  conversations: ChatConversationLocalDataArgs[];
  version: number;
  updatedAt: number;
}): LocalDataUnitOfWork {
  const activeConversationIds = new Set(
    args.conversations
      .filter((conversation) => conversation.bodyState === 'complete')
      .map((conversation) => conversation.conversation.id)
  );
  const quarantinedConversationIds = new Set(
    args.conversations
      .filter((conversation) => conversation.bodyState !== 'complete')
      .map((conversation) => conversation.conversation.id)
  );
  const allConversationIds = new Set([
    ...activeConversationIds,
    ...quarantinedConversationIds
  ]);
  const domainMetaRow = buildChatDomainMetaLocalDataRow({
    activeConversationId: args.activeConversationId,
    activeGroupRoomId: args.activeGroupRoomId,
    groupRooms: args.groupRooms,
    activeConversationCount: activeConversationIds.size,
    quarantinedConversationCount: quarantinedConversationIds.size,
    totalConversationCount: allConversationIds.size,
    version: args.version,
    updatedAt: args.updatedAt
  });
  const conversationMutations: LocalDataUnitMutation[] = args.conversations.flatMap((conversationArgs) => {
    const projection = buildConversationLocalDataProjection(conversationArgs);
    return [
      { type: 'put', row: projection.catalogRow },
      ...(projection.recordRow ? [{ type: 'put' as const, row: projection.recordRow }] : [])
    ];
  });

  return {
    id: args.id,
    domain: 'chat',
    version: args.version,
    mutations: [
      { type: 'put', row: domainMetaRow },
      ...conversationMutations
    ]
  };
}
