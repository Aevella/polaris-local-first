import type { Conversation } from '../../types/domain';
import { collectConversationAssetRefs } from './chatRows';
import {
  buildChatMigrationRehearsal,
  type ChatMigrationRehearsal,
  type ChatMigrationRehearsalReadback
} from './chatMigrationRehearsal';
import { commitChatMigrationRehearsalAndBuildValidationReport } from './chatMigrationReadback';
import type { ChatMigrationReadbackResult } from './chatMigrationReadback';
import type { ChatMigrationLegacySnapshot } from './chatMigrationPlanner';
import { assertValidMigrationPromotionReport } from './migrationValidation';
import { createLocalDataRepository } from './repository';
import type {
  ConversationCatalogRow,
  ConversationRecordRow,
  LocalDataBackendMutation,
  LocalDataCommitMeta,
  LocalDataCompleteRow,
  LocalDataMigrationValidationReport,
  LocalDataTransactionalBackend
} from './types';

const SOURCE_INTEGRITY_BULK_MARKER_LIMIT = 50;
const SOURCE_INTEGRITY_SUBSET_QUARANTINE_MIN_COUNT = 10;
const SOURCE_INTEGRITY_SUBSET_QUARANTINE_RATIO = 0.1;

export type ChatMigrationDryRunChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

export type ChatMigrationDryRunFieldMismatch = {
  conversationId: string;
  field: string;
};

export type ChatMigrationDryRunMessageCountMismatch = {
  conversationId: string;
  sourceCount: number;
  projectedCatalogCount: number | null;
  projectedRecordCount: number | null;
};

export type ChatMigrationDryRunLatestTimestampMismatch = {
  conversationId: string;
  sourceLatestTimestamp: number;
  projectedCatalogLatestTimestamp: number | null;
};

export type ChatMigrationDryRunAssetProjectionMismatch = {
  conversationId: string;
  sourceAssetRefCount: number;
  projectedAssetRefCount: number;
};

export type ChatMigrationDryRunReport = {
  ok: boolean;
  summary: {
    conversationCount: number;
    messageCount: number;
    activeConversationId: string | null;
    activeConversationRecovered: boolean;
    totalMismatchCount: number;
  };
  projection: {
    stagingHydrated: boolean;
    promotionReady: boolean;
    promotionError?: string;
    activeObjectCount: number;
    quarantinedObjectCount: number;
    duplicateObjectIdCount: number;
    missingActiveCollaboratorIdCount: number;
    activeIncompleteRowCount: number;
    activeTimedOutRowCount: number;
  };
  mismatches: {
    missingConversationCount: number;
    unexpectedConversationCount: number;
    messageCountMismatchCount: number;
    latestTimestampMismatchCount: number;
    durableFieldMismatchCount: number;
    assetProjectionMismatchCount: number;
    missingAssetRefCount: number;
  };
  assetRefs: {
    referencedAssetCount: number;
    projectedAssetRefCount: number;
    assetIndexCount: number;
    missingAssetRefCount: number;
    missingAssetRefIds: string[];
    assetProjectionMismatchCount: number;
  };
  sourceIntegrity: {
    sourceConversationCount: number;
    visibleConversationCount: number;
    quarantinedConversationCount: number;
    recoveredConversationCount: number;
    bulkMarkerCount: number;
    blockers: string[];
  };
  details: {
    missingConversationIds: string[];
    unexpectedConversationIds: string[];
    messageCountMismatches: ChatMigrationDryRunMessageCountMismatch[];
    latestTimestampMismatches: ChatMigrationDryRunLatestTimestampMismatch[];
    durableFieldMismatches: ChatMigrationDryRunFieldMismatch[];
    assetProjectionMismatches: ChatMigrationDryRunAssetProjectionMismatch[];
  };
  validationReport: LocalDataMigrationValidationReport;
};

export type ChatMigrationDryRunProjection = {
  rehearsal: ChatMigrationRehearsal;
  commitMeta: LocalDataCommitMeta;
  readback: ChatMigrationRehearsalReadback;
  validationReport: LocalDataMigrationValidationReport;
  rows: ChatMigrationDryRunConversationRows[];
};

type ChatMigrationDryRunConversationRows = {
  id: string;
  catalog?: LocalDataCompleteRow<ConversationCatalogRow>;
  record?: LocalDataCompleteRow<ConversationRecordRow>;
};

export async function buildChatMigrationDryRunReport(args: {
  chatState: ChatMigrationDryRunChatState;
  assetIndexIds?: readonly string[];
  baselineConversationIds?: readonly string[];
  knownCollaboratorIds?: readonly string[];
  sourceQuarantinedConversationIds?: readonly string[];
  sourceRecoveredConversationIds?: readonly string[];
  version?: number;
  committedAt?: number;
  validatedAt?: number;
}): Promise<ChatMigrationDryRunReport> {
  const projection = await buildChatMigrationDryRunProjection(args);
  return summarizeChatMigrationDryRun({
    chatState: args.chatState,
    assetIndexIds: args.assetIndexIds ?? [],
    baselineConversationIds: args.baselineConversationIds,
    knownCollaboratorIds: args.knownCollaboratorIds,
    sourceQuarantinedConversationIds: args.sourceQuarantinedConversationIds,
    sourceRecoveredConversationIds: args.sourceRecoveredConversationIds,
    projection
  });
}

export function summarizeChatMigrationDryRun(args: {
  chatState: ChatMigrationDryRunChatState;
  assetIndexIds: readonly string[];
  projection: ChatMigrationDryRunProjection;
  baselineConversationIds?: readonly string[];
  knownCollaboratorIds?: readonly string[];
  sourceQuarantinedConversationIds?: readonly string[];
  sourceRecoveredConversationIds?: readonly string[];
}): ChatMigrationDryRunReport {
  const sourceById = new Map(args.chatState.conversations.map((conversation) => [conversation.id, conversation]));
  const rowById = new Map(args.projection.rows.map((row) => [row.id, row]));
  const sourceIds = uniqueSortedIds(args.baselineConversationIds ?? sourceById.keys());
  const projectedIds = uniqueSortedIds(
    args.projection.rows
      .filter((row) => row.record)
      .map((row) => row.id)
  );
  const missingConversationIds = sourceIds.filter((id) => !rowById.get(id)?.record);
  const unexpectedConversationIds = projectedIds.filter((id) => !sourceById.has(id));
  const messageCountMismatches: ChatMigrationDryRunMessageCountMismatch[] = [];
  const latestTimestampMismatches: ChatMigrationDryRunLatestTimestampMismatch[] = [];
  const durableFieldMismatches: ChatMigrationDryRunFieldMismatch[] = [];
  const assetProjectionMismatches: ChatMigrationDryRunAssetProjectionMismatch[] = [];
  const sourceAssetIds = new Set<string>();
  const projectedAssetIds = new Set<string>();

  for (const conversation of args.chatState.conversations) {
    const rows = rowById.get(conversation.id);
    const sourceMessages = requireConversationMessages(conversation);
    for (const assetId of collectConversationAssetRefs(sourceMessages)) sourceAssetIds.add(assetId);
    for (const assetId of rows?.record?.value.assetRefs ?? []) projectedAssetIds.add(assetId);

    const sourceMessageCount = sourceMessages.length;
    const projectedCatalogCount = rows?.catalog?.value.messageCount ?? null;
    const projectedRecordCount = rows?.record?.value.messages.length ?? null;
    if (
      projectedCatalogCount !== sourceMessageCount
      || projectedRecordCount !== sourceMessageCount
    ) {
      messageCountMismatches.push({
        conversationId: conversation.id,
        sourceCount: sourceMessageCount,
        projectedCatalogCount,
        projectedRecordCount
      });
    }

    const sourceLatestTimestamp = latestMessageTimestamp(sourceMessages);
    const projectedCatalogLatestTimestamp = rows?.catalog?.value.latestMessageTimestamp ?? null;
    if (projectedCatalogLatestTimestamp !== sourceLatestTimestamp) {
      latestTimestampMismatches.push({
        conversationId: conversation.id,
        sourceLatestTimestamp,
        projectedCatalogLatestTimestamp
      });
    }

    durableFieldMismatches.push(...compareDurableFields(conversation, rows));

    const sourceAssetRefs = collectConversationAssetRefs(sourceMessages);
    const projectedAssetRefs = rows?.record?.value.assetRefs ?? [];
    if (!stringArraysEqual(sourceAssetRefs, projectedAssetRefs)) {
      assetProjectionMismatches.push({
        conversationId: conversation.id,
        sourceAssetRefCount: sourceAssetRefs.length,
        projectedAssetRefCount: projectedAssetRefs.length
      });
    }
  }

  const assetIndexIds = new Set(args.assetIndexIds);
  const missingAssetRefIds = uniqueSortedIds(
    [...sourceAssetIds].filter((assetId) => !assetIndexIds.has(assetId))
  );
  const promotion = resolvePromotionReadiness(args.projection.commitMeta, args.projection.validationReport);
  const sourceIntegrity = summarizeSourceIntegrity({
    visibleConversationCount: args.chatState.conversations.length,
    baselineConversationIds: sourceIds,
    quarantinedConversationIds: args.sourceQuarantinedConversationIds,
    recoveredConversationIds: args.sourceRecoveredConversationIds
  });
  const promotionReady = promotion.ready && sourceIntegrity.blockers.length === 0;
  const totalMismatchCount =
    missingConversationIds.length
    + unexpectedConversationIds.length
    + messageCountMismatches.length
    + latestTimestampMismatches.length
    + durableFieldMismatches.length
    + assetProjectionMismatches.length
    + missingAssetRefIds.length;
  const ok = totalMismatchCount === 0 && promotionReady;

  return {
    ok,
    summary: {
      conversationCount: args.chatState.conversations.length,
      messageCount: countMessages(args.chatState.conversations),
      activeConversationId: args.chatState.activeConversationId,
      activeConversationRecovered:
        args.chatState.activeConversationId === null
        || args.projection.validationReport.recoveredMetadata.activeConversationId === args.chatState.activeConversationId,
      totalMismatchCount
    },
    projection: {
      stagingHydrated: args.projection.validationReport.stagingHydrated,
      promotionReady,
      ...(promotion.error || sourceIntegrity.blockers.length
        ? { promotionError: promotion.error ?? sourceIntegrity.blockers[0] }
        : {}),
      activeObjectCount: args.projection.validationReport.activeObjectCount,
      quarantinedObjectCount: args.projection.validationReport.quarantinedObjectCount,
      duplicateObjectIdCount: args.projection.validationReport.duplicateObjectIdCount,
      missingActiveCollaboratorIdCount: args.projection.validationReport.missingActiveCollaboratorIdCount,
      activeIncompleteRowCount: args.projection.validationReport.activeIncompleteRowCount,
      activeTimedOutRowCount: args.projection.validationReport.activeTimedOutRowCount
    },
    mismatches: {
      missingConversationCount: missingConversationIds.length,
      unexpectedConversationCount: unexpectedConversationIds.length,
      messageCountMismatchCount: messageCountMismatches.length,
      latestTimestampMismatchCount: latestTimestampMismatches.length,
      durableFieldMismatchCount: durableFieldMismatches.length,
      assetProjectionMismatchCount: assetProjectionMismatches.length,
      missingAssetRefCount: missingAssetRefIds.length
    },
    assetRefs: {
      referencedAssetCount: sourceAssetIds.size,
      projectedAssetRefCount: projectedAssetIds.size,
      assetIndexCount: assetIndexIds.size,
      missingAssetRefCount: missingAssetRefIds.length,
      missingAssetRefIds,
      assetProjectionMismatchCount: assetProjectionMismatches.length
    },
    sourceIntegrity,
    details: {
      missingConversationIds,
      unexpectedConversationIds,
      messageCountMismatches,
      latestTimestampMismatches,
      durableFieldMismatches,
      assetProjectionMismatches
    },
    validationReport: args.projection.validationReport
  };
}

function summarizeSourceIntegrity(args: {
  visibleConversationCount: number;
  baselineConversationIds: readonly string[];
  quarantinedConversationIds: readonly string[] | undefined;
  recoveredConversationIds: readonly string[] | undefined;
}) {
  const quarantinedConversationIds = uniqueSortedIds(args.quarantinedConversationIds ?? []);
  const recoveredConversationIds = uniqueSortedIds(args.recoveredConversationIds ?? []);
  const sourceConversationCount = uniqueSortedIds([
    ...args.baselineConversationIds,
    ...quarantinedConversationIds
  ]).length;
  const bulkMarkerCount = quarantinedConversationIds.length + recoveredConversationIds.length;
  const quarantineRatio = sourceConversationCount > 0
    ? quarantinedConversationIds.length / sourceConversationCount
    : 0;
  const blockers: string[] = [];

  if (bulkMarkerCount >= SOURCE_INTEGRITY_BULK_MARKER_LIMIT) {
    blockers.push('source-integrity:bulk-quarantine-recovered-markers');
  }
  if (
    quarantinedConversationIds.length >= SOURCE_INTEGRITY_SUBSET_QUARANTINE_MIN_COUNT
    && quarantineRatio >= SOURCE_INTEGRITY_SUBSET_QUARANTINE_RATIO
  ) {
    blockers.push('source-integrity:visible-conversation-subset');
  }

  return {
    sourceConversationCount,
    visibleConversationCount: args.visibleConversationCount,
    quarantinedConversationCount: quarantinedConversationIds.length,
    recoveredConversationCount: recoveredConversationIds.length,
    bulkMarkerCount,
    blockers
  };
}

export async function buildChatMigrationDryRunProjection(args: {
  chatState: ChatMigrationDryRunChatState;
  version?: number;
  committedAt?: number;
  validatedAt?: number;
  knownCollaboratorIds?: readonly string[];
}): Promise<ChatMigrationDryRunProjection> {
  const version = args.version ?? 1;
  const committedAt = args.committedAt ?? 1;
  const validatedAt = args.validatedAt ?? committedAt;
  const rehearsal = buildChatMigrationRehearsalFromChatState({
    chatState: args.chatState,
    version,
    committedAt,
    unitId: 'chat-migration-dry-run',
    knownCollaboratorIds: args.knownCollaboratorIds
  });
  const repository = createLocalDataRepository({
    backend: createDryRunTransactionalBackend(),
    now: () => committedAt
  });
  const readbackResult = await commitChatMigrationRehearsalAndBuildValidationReport({
    repository,
    rehearsal,
    validatedAt
  });

  return buildChatMigrationDryRunProjectionFromReadback({
    rehearsal,
    readbackResult
  });
}

export function buildChatMigrationRehearsalFromChatState(args: {
  chatState: ChatMigrationDryRunChatState;
  version: number;
  committedAt: number;
  unitId?: string;
  knownCollaboratorIds?: readonly string[];
}): ChatMigrationRehearsal {
  return buildChatMigrationRehearsal({
    snapshot: toChatMigrationLegacySnapshot(args.chatState),
    version: args.version,
    committedAt: args.committedAt,
    unitId: args.unitId,
    knownCollaboratorIds: args.knownCollaboratorIds
  });
}

export function buildChatMigrationDryRunProjectionFromReadback(args: {
  rehearsal: ChatMigrationRehearsal;
  readbackResult: ChatMigrationReadbackResult;
}): ChatMigrationDryRunProjection {
  return {
    rehearsal: args.rehearsal,
    commitMeta: args.readbackResult.commitMeta,
    readback: args.readbackResult.readback,
    validationReport: args.readbackResult.validationReport,
    rows: completeRowsFromReadback(args.readbackResult.readback)
  };
}

export function toChatMigrationLegacySnapshot(chatState: ChatMigrationDryRunChatState): ChatMigrationLegacySnapshot {
  return {
    activeConversationId: chatState.activeConversationId,
    conversations: chatState.conversations.map((conversation) => {
      const messages = requireConversationMessages(conversation);
      return {
        id: conversation.id,
        title: conversation.title,
        collaboratorId: conversation.collaboratorId ?? null,
        activeProjectId: conversation.activeProjectId ?? null,
        reasoningStrength: conversation.reasoningStrength,
        requestContext: conversation.requestContext,
        windowPreferences: conversation.windowPreferences,
        task: conversation.task ?? null,
        draft: conversation.draft ?? '',
        workspaceLedger: conversation.workspaceLedger ?? [],
        pinnedAt: conversation.pinnedAt,
        updatedAt: conversation.updatedAt,
        messages,
        expectedMessageCount: messages.length,
        expectedLatestMessageTimestamp: latestMessageTimestamp(messages)
      };
    })
  };
}

function completeRowsFromReadback(readback: ChatMigrationRehearsalReadback) {
  return readback.rows.map((row) => ({
    id: row.id,
    ...(row.catalog.status === 'complete'
      ? { catalog: row.catalog.row as LocalDataCompleteRow<ConversationCatalogRow> }
      : {}),
    ...(row.record?.status === 'complete'
      ? { record: row.record.row as LocalDataCompleteRow<ConversationRecordRow> }
      : {})
  }));
}

function createDryRunTransactionalBackend(): LocalDataTransactionalBackend {
  const rows = new Map<string, unknown>();
  return {
    mode: 'transactional',
    async read<T>(key: string) {
      return (rows.get(key) as T | undefined) ?? null;
    },
    async listKeysWithPrefix(prefix: string) {
      return Array.from(rows.keys()).filter((key) => key.startsWith(prefix));
    },
    async commitAtomic(mutations: LocalDataBackendMutation[]) {
      for (const mutation of mutations) {
        if (mutation.type === 'set') {
          rows.set(mutation.key, mutation.value);
        } else {
          rows.delete(mutation.key);
        }
      }
    }
  };
}

function compareDurableFields(conversation: Conversation, rows: ChatMigrationDryRunConversationRows | undefined) {
  const mismatches: ChatMigrationDryRunFieldMismatch[] = [];
  const catalog = rows?.catalog?.value;
  const record = rows?.record?.value;
  const sourceMessages = requireConversationMessages(conversation);
  const expectedFields: Record<string, unknown> = {
    id: conversation.id,
    title: conversation.title,
    collaboratorId: conversation.collaboratorId ?? null,
    activeProjectId: conversation.activeProjectId ?? null,
    reasoningStrength: conversation.reasoningStrength,
    requestContext: conversation.requestContext,
    windowPreferences: conversation.windowPreferences,
    messages: sourceMessages,
    workspaceLedger: conversation.workspaceLedger ?? [],
    task: conversation.task ?? null,
    draft: conversation.draft ?? '',
    pinnedAt: conversation.pinnedAt,
    updatedAt: conversation.updatedAt
  };
  const projectedFields: Record<string, unknown> = {
    id: record?.id ?? catalog?.id,
    title: catalog?.title,
    collaboratorId: catalog?.collaboratorId,
    activeProjectId: catalog?.activeProjectId ?? record?.ownerProjectId,
    messages: record?.messages,
    workspaceLedger: record?.workspaceLedger,
    task: record?.task,
    draft: record?.draft,
    pinnedAt: catalog?.pinnedAt,
    updatedAt: catalog?.updatedAt
  };

  for (const field of Object.keys(expectedFields)) {
    if (!valuesEqual(expectedFields[field], projectedFields[field])) {
      mismatches.push({
        conversationId: conversation.id,
        field
      });
    }
  }

  return mismatches;
}

function resolvePromotionReadiness(
  meta: LocalDataCommitMeta,
  report: LocalDataMigrationValidationReport
) {
  try {
    assertValidMigrationPromotionReport(meta, report);
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function requireConversationMessages(conversation: Conversation) {
  if (!Array.isArray(conversation.messages)) {
    throw new Error(`Export chat conversation is missing complete messages: ${conversation.id}`);
  }
  return conversation.messages;
}

function countMessages(conversations: Conversation[]) {
  return conversations.reduce((total, conversation) => {
    return total + requireConversationMessages(conversation).length;
  }, 0);
}

function latestMessageTimestamp(messages: Conversation['messages']) {
  return Math.max(0, ...messages.map((message) => message.timestamp));
}

function stringArraysEqual(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueSortedIds(ids: Iterable<string>) {
  return Array.from(new Set(ids)).sort();
}
