import type { ChatMessage } from '../../types/domain';
import {
  type TypedChatSqliteConversationMetadata,
  type TypedChatSqliteConversationSummary,
  type TypedChatSqliteStore
} from './chatSqliteStore';
import {
  buildChatDomainMetaLocalDataRow,
  collectConversationAssetRefs,
  getChatDomainMetaLocalDataRef,
  getConversationCatalogLocalDataRef,
  getConversationRecordLocalDataRef
} from './chatRows';
import type { ChatMigrationHydrateRowPair } from './chatMigrationHydration';
import {
  createCompleteLocalDataRow,
  getLocalDataRowKey,
  type ChatDomainMetaRow,
  type ConversationCatalogRow,
  type ConversationRecordRow,
  type LocalDataReadResult,
  type LocalDataRef,
  type LocalDataStoredRow
} from './types';

export type TypedChatSqliteLocalDataHydrationArgs = {
  store: Pick<
    TypedChatSqliteStore,
    'readConversationSummaries' | 'readConversationMetadata' | 'readMessageWindow'
  >;
  activeConversationId: string | null;
  version: number;
  committedAt: number;
  readAt: number;
  messageWindowLimit: number;
};

export type TypedChatSqliteLocalDataHydration = {
  domainMeta: LocalDataReadResult<ChatDomainMetaRow>;
  rows: ChatMigrationHydrateRowPair[];
  activeConversationIds: string[];
  quarantinedConversationIds: string[];
};

type RecordProjection =
  | {
      status: 'complete';
      record: LocalDataReadResult<ConversationRecordRow>;
    }
  | {
      status: 'quarantined';
      record: LocalDataReadResult<ConversationRecordRow>;
    };

export async function readTypedChatSqliteLocalDataHydration(
  args: TypedChatSqliteLocalDataHydrationArgs
): Promise<TypedChatSqliteLocalDataHydration> {
  assertWindowLimit(args.messageWindowLimit);
  const summaries = await args.store.readConversationSummaries();
  const projectedRows: Array<{
    row: ChatMigrationHydrateRowPair;
    recordStatus: RecordProjection['status'];
  }> = [];

  for (const summary of summaries) {
    const metadata = await args.store.readConversationMetadata(summary.id);
    const catalog = completeRead(
      getConversationCatalogLocalDataRef(summary.id),
      toCatalogRow(summary, metadata, args.version),
      args.version,
      args.readAt
    );
    const record = metadata
      ? await readRecordProjection(args, summary, metadata)
      : {
          status: 'quarantined' as const,
          record: incompleteRead<ConversationRecordRow>(
            getConversationRecordLocalDataRef(summary.id),
            'Typed chat SQLite conversation metadata is missing.'
          )
        };

    projectedRows.push({
      row: {
        id: summary.id,
        catalog,
        record: record.record
      },
      recordStatus: record.status
    });
  }

  const activeConversationIds = projectedRows
    .filter((row) => row.recordStatus === 'complete')
    .map((row) => row.row.id)
    .sort();
  const quarantinedConversationIds = projectedRows
    .filter((row) => row.recordStatus === 'quarantined')
    .map((row) => row.row.id)
    .sort();

  return {
    domainMeta: completeRead(
      getChatDomainMetaLocalDataRef(),
      buildChatDomainMetaLocalDataRow({
        activeConversationId: resolveActiveConversationId(
          args.activeConversationId,
          activeConversationIds
        ),
        activeConversationCount: activeConversationIds.length,
        quarantinedConversationCount: quarantinedConversationIds.length,
        totalConversationCount: summaries.length,
        version: args.version,
        updatedAt: args.readAt
      }).value,
      args.version,
      args.readAt
    ),
    rows: projectedRows.map((row) => row.row),
    activeConversationIds,
    quarantinedConversationIds
  };
}

async function readRecordProjection(
  args: TypedChatSqliteLocalDataHydrationArgs,
  summary: TypedChatSqliteConversationSummary,
  metadata: TypedChatSqliteConversationMetadata
): Promise<RecordProjection> {
  const recordRef = getConversationRecordLocalDataRef(summary.id);
  const window = await args.store.readMessageWindow(summary.id, {
    limit: args.messageWindowLimit
  });

  if (window.status === 'missing') {
    return {
      status: 'quarantined',
      record: incompleteRead(recordRef, 'Typed chat SQLite conversation body is missing.')
    };
  }
  if (window.status !== 'loaded' || window.messages.length !== summary.messageCount) {
    return {
      status: 'quarantined',
      record: incompleteRead(recordRef, 'Typed chat SQLite conversation body is partial.')
    };
  }
  if (window.expectedCount !== summary.messageCount) {
    return {
      status: 'quarantined',
      record: incompleteRead(
        recordRef,
        'Typed chat SQLite message count does not match the conversation summary.'
      )
    };
  }

  return {
    status: 'complete',
    record: completeRead(
      recordRef,
      toRecordRow(summary, metadata, window.messages, args.version, args.committedAt),
      args.version,
      args.readAt
    )
  };
}

function toCatalogRow(
  summary: TypedChatSqliteConversationSummary,
  metadata: TypedChatSqliteConversationMetadata | null,
  version: number
): ConversationCatalogRow {
  return {
    id: summary.id,
    title: summary.title,
    kind: summary.kind,
    collaboratorId: summary.collaboratorId,
    group: metadata?.group,
    groupRoomId: summary.groupRoomId,
    activeProjectId: summary.activeProjectId,
    reasoningStrength: metadata?.reasoningStrength,
    requestContext: metadata?.requestContext,
    windowPreferences: metadata?.windowPreferences,
    pinnedAt: summary.pinnedAt,
    updatedAt: summary.updatedAt,
    messageCount: summary.messageCount,
    latestMessageTimestamp: summary.latestMessageTimestamp,
    state: 'active',
    recordVersion: version
  };
}

function toRecordRow(
  summary: TypedChatSqliteConversationSummary,
  metadata: TypedChatSqliteConversationMetadata,
  messages: ChatMessage[],
  version: number,
  committedAt: number
): ConversationRecordRow {
  return {
    id: summary.id,
    version,
    committedAt,
    messages,
    task: metadata.task ?? null,
    draft: metadata.draft ?? '',
    workspaceLedger: metadata.workspaceLedger ?? [],
    ownerProjectId: metadata.activeProjectId ?? null,
    assetRefs: collectConversationAssetRefs(messages)
  };
}

function completeRead<T>(
  ref: LocalDataRef,
  value: T,
  version: number,
  updatedAt: number
): LocalDataReadResult<T> {
  const row = createCompleteLocalDataRow({
    ref,
    value,
    version,
    updatedAt
  }) as LocalDataStoredRow<T> & { state: 'complete'; value: T };

  return {
    status: 'complete',
    ref,
    value,
    row
  };
}

function incompleteRead<T>(ref: LocalDataRef, reason: string): LocalDataReadResult<T> {
  return {
    status: 'incomplete',
    ref,
    reason,
    missingKeys: [getLocalDataRowKey(ref)]
  };
}

function resolveActiveConversationId(
  requestedActiveConversationId: string | null,
  activeConversationIds: string[]
) {
  if (requestedActiveConversationId && activeConversationIds.includes(requestedActiveConversationId)) {
    return requestedActiveConversationId;
  }
  return null;
}

function assertWindowLimit(limit: number) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Typed chat SQLite LocalData hydration window limit must be a positive integer');
  }
}
