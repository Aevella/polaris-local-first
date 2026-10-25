import { normalizeConversationSettings } from '../../engines/conversationContextSettings';
import { listAssetMeta } from '../../infrastructure/assetStore';
import { kvGet, kvKeysWithPrefix } from '../../infrastructure/persistence';
import { KNOWN_BUNDLED_PERSONA_IDS } from '../../config/persona/personaBuilder';
import {
  buildChatMigrationDryRunProjectionFromReadback,
  buildChatMigrationDryRunReport,
  summarizeChatMigrationDryRun,
  type ChatMigrationDryRunReport
} from '../../engines/localData/chatMigrationDryRun';
import { buildChatMigrationRehearsal } from '../../engines/localData/chatMigrationRehearsal';
import type { ChatMigrationLegacyConversationSnapshot } from '../../engines/localData/chatMigrationPlanner';
import { commitChatMigrationRehearsalAndBuildValidationReport } from '../../engines/localData/chatMigrationReadback';
import { createStagedLocalDataKvBackendForMigration } from '../../engines/localData/localDataKvBackend';
import { createLocalDataRepository } from '../../engines/localData/repository';
import {
  LOCAL_DATA_SCHEMA_VERSION,
  type LocalDataCommitMeta,
  type LocalDataMigrationValidationReport
} from '../../engines/localData/types';
import type { ChatMessage, Conversation } from '../../types/domain';
import { readChatStateFromLocalDataOverlay } from './localData';

const CHAT_CATALOG_KEY = 'chat-catalog-v1';
const CHAT_CONVERSATION_RECORD_PREFIX = 'chat-conversation-record-v1:';
const CHAT_COMMIT_MESSAGE_PREFIX = 'chat-message-v1:';
const CHAT_CONVERSATION_ENVELOPE_PREFIX = 'chat-conversation-v1:';
const CHAT_INDEX_KEY = 'chat-index-v2';
const CHAT_MANIFEST_PREFIX = 'chat-manifest-v1:';
const CHAT_MESSAGE_PREFIX = 'chat-messages-v2:';

type ChatBaselinePayload = {
  conversations?: Array<Record<string, unknown>>;
  activeConversationId?: unknown;
  deletedConversationIds?: unknown[];
  quarantinedConversationIds?: unknown[];
  recoveredConversationIds?: unknown[];
};

type ChatMigrationManifestPayload = {
  schemaVersion?: number;
  commitId: string;
  createdAt: number;
  conversations: Array<Record<string, unknown> & {
    id: string;
    messageKey?: string;
    latestMessageTimestamp?: number;
    updatedAt?: number;
  }>;
};

type ChatMigrationEnvelopePayload = Record<string, unknown> & {
  schemaVersion?: number;
  id: string;
  messageKey: string;
};

type ChatMigrationSourceKind = 'catalog' | 'legacy-index';

type ChatBaselineSource = {
  conversations: ChatMigrationLegacyConversationSnapshot[];
  activeConversationId: string | null;
  quarantinedConversationIds: string[];
  recoveredConversationIds: string[];
};

export type CurrentChatMigrationDryRunSource = {
  chatState: Pick<{
    conversations: Conversation[];
    activeConversationId: string | null;
  }, 'conversations' | 'activeConversationId'>;
  legacySnapshot: {
    conversations: ChatMigrationLegacyConversationSnapshot[];
    activeConversationId: string | null;
    quarantinedConversationIds: string[];
  };
  assetIndexIds: string[];
  baselineConversationIds: string[];
  knownCollaboratorIds: string[];
  sourceQuarantinedConversationIds: string[];
  sourceRecoveredConversationIds: string[];
};

export type CurrentChatMigrationPromotionEvidence = {
  commitMeta: LocalDataCommitMeta;
  validationReport: LocalDataMigrationValidationReport;
};

export type CurrentChatMigrationStagingResult = {
  report: ChatMigrationDryRunReport;
  promotionEvidence: CurrentChatMigrationPromotionEvidence | null;
};

export async function buildChatMigrationDryRunReportFromCurrentPersistence(args: {
  version?: number;
  committedAt?: number;
  validatedAt?: number;
} = {}): Promise<ChatMigrationDryRunReport> {
  const source = await readCurrentChatMigrationDryRunSource();

  return await buildChatMigrationDryRunReport({
    ...source,
    version: args.version,
    committedAt: args.committedAt,
    validatedAt: args.validatedAt
  });
}

export async function readRecoverableChatStateForMigrationFromCurrentPersistence() {
  return (await readCurrentChatMigrationDryRunSource()).chatState;
}

export async function commitChatMigrationStagingFromCurrentPersistence(args: {
  version?: number;
  committedAt?: number;
  validatedAt?: number;
  unitId?: string;
} = {}): Promise<CurrentChatMigrationStagingResult> {
  const source = await readCurrentChatMigrationDryRunSource();
  const committedAt = args.committedAt ?? Date.now();
  const version = args.version ?? LOCAL_DATA_SCHEMA_VERSION;
  const rehearsal = buildChatMigrationRehearsal({
    snapshot: source.legacySnapshot,
    version,
    committedAt,
    unitId: args.unitId ?? `chat-migration-staging-${committedAt}`,
    knownCollaboratorIds: source.knownCollaboratorIds
  });
  const repository = createLocalDataRepository({
    backend: createStagedLocalDataKvBackendForMigration(),
    now: () => committedAt
  });
  const readbackResult = await commitChatMigrationRehearsalAndBuildValidationReport({
    repository,
    rehearsal,
    validatedAt: args.validatedAt ?? committedAt
  });
  const report = summarizeChatMigrationDryRun({
    chatState: source.chatState,
    assetIndexIds: source.assetIndexIds,
    baselineConversationIds: source.baselineConversationIds,
    knownCollaboratorIds: source.knownCollaboratorIds,
    sourceQuarantinedConversationIds: source.sourceQuarantinedConversationIds,
    sourceRecoveredConversationIds: source.sourceRecoveredConversationIds,
    projection: buildChatMigrationDryRunProjectionFromReadback({
      rehearsal,
      readbackResult
    })
  });

  return {
    report,
    promotionEvidence: shouldAttachPromotionEvidence(report)
      ? {
        commitMeta: readbackResult.commitMeta,
        validationReport: readbackResult.validationReport
      }
      : null
  };
}

function shouldAttachPromotionEvidence(report: ChatMigrationDryRunReport) {
  if (report.ok) return true;
  if (!report.projection.promotionReady) return false;
  if (
    report.mismatches.unexpectedConversationCount !== 0
    || report.mismatches.messageCountMismatchCount !== 0
    || report.mismatches.latestTimestampMismatchCount !== 0
    || report.mismatches.durableFieldMismatchCount !== 0
    || report.mismatches.assetProjectionMismatchCount !== 0
    || report.mismatches.missingAssetRefCount !== 0
  ) {
    return false;
  }
  if (report.details.missingConversationIds.length === 0) return false;
  const quarantinedIds = new Set(report.validationReport.quarantinedObjectIds);
  return report.details.missingConversationIds.every((id) => quarantinedIds.has(id));
}

async function readCurrentChatMigrationDryRunSource(): Promise<CurrentChatMigrationDryRunSource> {
  const [migrationSource, assetMetas, knownCollaboratorIds] = await Promise.all([
    readCurrentChatBaselineSource(),
    listAssetMeta(),
    readCurrentPersonaIds()
  ]);
  const completeConversations = migrationSource.conversations
    .filter((conversation): conversation is ChatMigrationLegacyConversationSnapshot & { messages: ChatMessage[] } =>
      Array.isArray(conversation.messages)
    )
    .map(toConversationFromMigrationSource)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const activeConversationId = migrationSource.activeConversationId
    && completeConversations.some((conversation) => conversation.id === migrationSource.activeConversationId)
      ? migrationSource.activeConversationId
      : completeConversations[0]?.id ?? null;
  const chatState = {
    conversations: completeConversations,
    activeConversationId
  };

  return {
    chatState,
    legacySnapshot: {
      conversations: migrationSource.conversations,
      activeConversationId: migrationSource.activeConversationId,
      quarantinedConversationIds: migrationSource.quarantinedConversationIds
    },
    assetIndexIds: assetMetas.map((meta) => meta.id),
    baselineConversationIds: migrationSource.conversations.map((conversation) => conversation.id),
    knownCollaboratorIds,
    sourceQuarantinedConversationIds: migrationSource.quarantinedConversationIds,
    sourceRecoveredConversationIds: migrationSource.recoveredConversationIds
  };
}

async function readCurrentPersonaIds() {
  const [personaPayload, runtimePayload] = await Promise.all([
    kvGet<{ personas?: Array<{ id?: unknown }> }>('persona-state-v2'),
    kvGet<{ companionConnections?: Array<{ collaboratorId?: unknown }> }>('runtime-providers-v2')
  ]);
  const collaboratorIds = [
    ...KNOWN_BUNDLED_PERSONA_IDS,
    ...(personaPayload?.personas ?? []).map((persona) => persona.id),
    ...(runtimePayload?.companionConnections ?? []).map((connection) => connection.collaboratorId)
  ];
  return Array.from(new Set(
    collaboratorIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  )).sort();
}

async function readCurrentChatBaselineSource(): Promise<ChatBaselineSource> {
  const localDataOverlay = await readLocalDataOverlayMigrationSource();
  const catalog = await kvGet<ChatBaselinePayload>(CHAT_CATALOG_KEY);
  if (catalog) {
    return mergeMigrationSources(
      await readVisibleMigrationSource(catalog, 'catalog'),
      localDataOverlay
    );
  }

  const legacyIndex = await kvGet<ChatBaselinePayload>(CHAT_INDEX_KEY);
  if (legacyIndex) {
    return mergeMigrationSources(
      await readVisibleMigrationSource(legacyIndex, 'legacy-index'),
      localDataOverlay
    );
  }

  return localDataOverlay ?? {
    conversations: [],
    activeConversationId: null,
    quarantinedConversationIds: [],
    recoveredConversationIds: []
  };
}

async function readLocalDataOverlayMigrationSource(): Promise<ChatBaselineSource | null> {
  const overlay = await readChatStateFromLocalDataOverlay({ readMode: 'complete' });
  if (!overlay) return null;
  const deletedConversationIds = new Set(overlay.deletedConversationIds ?? []);
  return {
    conversations: overlay.conversations
      .filter((conversation) => !deletedConversationIds.has(conversation.id))
      .map((conversation): ChatMigrationLegacyConversationSnapshot => ({
        ...conversation,
        expectedMessageCount: conversation.messages.length,
        expectedLatestMessageTimestamp: latestMessageTimestamp(conversation.messages)
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    activeConversationId: overlay.activeConversationId,
    quarantinedConversationIds: [],
    recoveredConversationIds: overlay.recoveredConversationIds ?? []
  };
}

function mergeMigrationSources(
  legacy: ChatBaselineSource,
  localDataOverlay: ChatBaselineSource | null
): ChatBaselineSource {
  if (!localDataOverlay) return legacy;

  const localDataConversationIds = new Set(localDataOverlay.conversations.map((conversation) => conversation.id));
  const mergedConversations = [
    ...localDataOverlay.conversations,
    ...legacy.conversations.filter((conversation) => !localDataConversationIds.has(conversation.id))
  ].sort((left, right) => left.id.localeCompare(right.id));
  const mergedIds = new Set(mergedConversations.map((conversation) => conversation.id));
  const activeConversationId =
    localDataOverlay.activeConversationId && mergedIds.has(localDataOverlay.activeConversationId)
      ? localDataOverlay.activeConversationId
      : legacy.activeConversationId && mergedIds.has(legacy.activeConversationId)
        ? legacy.activeConversationId
        : mergedConversations[0]?.id ?? null;

  return {
    conversations: mergedConversations,
    activeConversationId,
    quarantinedConversationIds: uniqueSortedIds([
      ...legacy.quarantinedConversationIds,
      ...localDataOverlay.quarantinedConversationIds
    ]),
    recoveredConversationIds: uniqueSortedIds([
      ...legacy.recoveredConversationIds,
      ...localDataOverlay.recoveredConversationIds
    ])
  };
}

async function readVisibleMigrationSource(
  payload: ChatBaselinePayload,
  sourceKind: ChatMigrationSourceKind
): Promise<ChatBaselineSource> {
  const deletedConversationIds = new Set(normalizeIdList(payload.deletedConversationIds));
  const quarantinedConversationIds = new Set(normalizeIdList(payload.quarantinedConversationIds));
  const recoveredConversationIds = normalizeIdList(payload.recoveredConversationIds);
  const conversations = new Map<string, ChatMigrationLegacyConversationSnapshot>();
  for (const conversation of payload.conversations ?? []) {
    const id = readString(conversation.id);
    if (!id || deletedConversationIds.has(id) || quarantinedConversationIds.has(id)) continue;
    const baseline = baselineConversationFromRecord(conversation, id, sourceKind);
    const body = await readMigrationBody(conversation, id, sourceKind, baseline.expectedMessageCount ?? 0);
    const messages = body?.messages;
    conversations.set(id, messages
      ? {
        ...baseline,
        ...(body?.conversation ? baselineConversationFromRecord(body.conversation, id, sourceKind) : {}),
        messages,
        expectedMessageCount: messages.length,
        expectedLatestMessageTimestamp: latestMessageTimestamp(messages)
      }
      : baseline
    );
  }
  for (const id of quarantinedConversationIds) {
    if (deletedConversationIds.has(id) || conversations.has(id)) continue;
    conversations.set(id, quarantinedPlaceholderConversation(id, sourceKind));
  }
  const activeConversationId = readString(payload.activeConversationId);
  return {
    conversations: Array.from(conversations.values()).sort((left, right) => left.id.localeCompare(right.id)),
    activeConversationId: activeConversationId
      && !deletedConversationIds.has(activeConversationId)
      && !quarantinedConversationIds.has(activeConversationId)
      ? activeConversationId
      : null,
    quarantinedConversationIds: Array.from(quarantinedConversationIds).sort(),
    recoveredConversationIds
  };
}

function quarantinedPlaceholderConversation(
  id: string,
  sourceKind: ChatMigrationSourceKind
): ChatMigrationLegacyConversationSnapshot {
  const recordKey = sourceKind === 'catalog'
    ? getSelfContainedConversationRecordKey(id)
    : getLegacyConversationMessageKey(id);
  return {
    id,
    title: 'Quarantined conversation',
    collaboratorId: null,
    activeProjectId: null,
    pinnedAt: null,
    updatedAt: 0,
    expectedMessageCount: 0,
    expectedLatestMessageTimestamp: 0,
    missingRecordKeys: [recordKey]
  };
}

function normalizeIdList(values: unknown[] | undefined) {
  return (values ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function uniqueSortedIds(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

async function readMigrationBody(
  conversation: Record<string, unknown>,
  id: string,
  sourceKind: ChatMigrationSourceKind,
  expectedMessageCount: number
) {
  if (sourceKind === 'catalog') {
    const recordKey = readString(conversation.recordKey) ?? getSelfContainedConversationRecordKey(id);
    const selfContainedRecord = await kvGet<unknown>(recordKey);
    if (isSelfContainedConversationRecordPayload(selfContainedRecord, id)) {
      const messages = acceptMigrationMessages(selfContainedRecord.messages, expectedMessageCount);
      if (messages) return { messages, conversation: selfContainedRecord.conversation };
    }
  }
  for (const messageKey of await resolveMigrationMessageKeys(conversation, id)) {
    const rawMessages = await kvGet<unknown>(messageKey);
    if (!Array.isArray(rawMessages)) continue;
    const messages = acceptMigrationMessages(rawMessages as ChatMessage[], expectedMessageCount);
    if (messages) return { messages };
  }
  return null;
}

function acceptMigrationMessages(messages: ChatMessage[], expectedMessageCount: number) {
  return expectedMessageCount > messages.length ? null : messages;
}

async function resolveMigrationMessageKeys(
  conversation: Record<string, unknown>,
  conversationId: string
) {
  const keys: string[] = [];
  const appendKey = (key: string | null | undefined) => {
    if (key && !keys.includes(key)) keys.push(key);
  };
  appendKey(readString(conversation.messageKey));
  appendKey(getLegacyConversationMessageKey(conversationId));

  const envelope = await readMigrationConversationEnvelope(conversationId);
  appendKey(envelope?.messageKey);

  for (const messageKey of await readAvailableMigrationMessageKeys(conversationId, new Set(keys))) {
    appendKey(messageKey);
  }
  return keys;
}

async function readMigrationConversationEnvelope(conversationId: string) {
  const envelope = await kvGet<unknown>(getChatConversationEnvelopeKey(conversationId));
  return isMigrationEnvelopePayload(envelope, conversationId) ? envelope : null;
}

async function readAvailableMigrationMessageKeys(conversationId: string, excludedMessageKeys = new Set<string>()) {
  const [manifestKeys, committedMessageKeys] = await Promise.all([
    kvKeysWithPrefix(CHAT_MANIFEST_PREFIX),
    kvKeysWithPrefix(CHAT_COMMIT_MESSAGE_PREFIX)
  ]);
  const keys = [...manifestKeys, ...committedMessageKeys];
  const candidates: Array<{ key: string; createdAt: number; updatedAt: number }> = [];

  for (const key of keys) {
    const commitId = getCommitIdFromManifestKey(key);
    if (commitId) {
      const manifest = await kvGet<unknown>(key);
      if (!isMigrationManifestPayload(manifest, commitId)) continue;
      const record = manifest.conversations.find((conversation) => conversation.id === conversationId);
      const messageKey = readString(record?.messageKey);
      if (!record || !messageKey || excludedMessageKeys.has(messageKey)) continue;
      candidates.push({
        key: messageKey,
        createdAt: manifest.createdAt,
        updatedAt: readNonNegativeNumber(record.latestMessageTimestamp) ?? readNonNegativeNumber(record.updatedAt) ?? 0
      });
      continue;
    }

    if (getCommittedConversationIdFromMessageKey(key) === conversationId && !excludedMessageKeys.has(key)) {
      candidates.push({
        key,
        createdAt: 0,
        updatedAt: 0
      });
    }
  }

  return candidates
    .sort((left, right) => {
      const createdAtDelta = right.createdAt - left.createdAt;
      if (createdAtDelta !== 0) return createdAtDelta;
      return right.updatedAt - left.updatedAt;
    })
    .reduce<string[]>((result, candidate) => {
      if (!result.includes(candidate.key)) result.push(candidate.key);
      return result;
    }, []);
}

function isMigrationManifestPayload(
  payload: unknown,
  commitId: string
): payload is ChatMigrationManifestPayload {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (payload as { schemaVersion?: unknown }).schemaVersion === 1
    && (payload as { commitId?: unknown }).commitId === commitId
    && typeof (payload as { createdAt?: unknown }).createdAt === 'number'
    && Array.isArray((payload as { conversations?: unknown }).conversations)
  );
}

function isMigrationEnvelopePayload(
  payload: unknown,
  conversationId: string
): payload is ChatMigrationEnvelopePayload {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (payload as { schemaVersion?: unknown }).schemaVersion === 1
    && (payload as { id?: unknown }).id === conversationId
    && typeof (payload as { messageKey?: unknown }).messageKey === 'string'
  );
}

function isSelfContainedConversationRecordPayload(
  payload: unknown,
  conversationId: string
): payload is { messages: ChatMessage[]; conversation: Record<string, unknown> } {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (payload as { schemaVersion?: unknown }).schemaVersion === 1
    && (payload as { conversation?: { id?: unknown } }).conversation?.id === conversationId
    && Array.isArray((payload as { messages?: unknown }).messages)
  );
}

function toConversationFromMigrationSource(
  source: ChatMigrationLegacyConversationSnapshot & { messages: ChatMessage[] }
): Conversation {
  return {
    id: source.id,
    title: source.title,
    collaboratorId: source.collaboratorId,
    activeProjectId: source.activeProjectId ?? null,
    reasoningStrength: source.reasoningStrength,
    requestContext: source.requestContext,
    windowPreferences: source.windowPreferences,
    messages: source.messages,
    workspaceLedger: source.workspaceLedger ?? [],
    task: source.task ?? null,
    draft: source.draft ?? '',
    pinnedAt: source.pinnedAt,
    updatedAt: source.updatedAt
  };
}

function baselineConversationFromRecord(
  conversation: Record<string, unknown>,
  id: string,
  sourceKind: ChatMigrationSourceKind
): ChatMigrationLegacyConversationSnapshot {
  const settings = normalizeConversationSettings(conversation);
  const title = readString(conversation.title) ?? 'Untitled conversation';
  const updatedAt = readNonNegativeNumber(conversation.updatedAt) ?? 0;
  const messageCount = readNonNegativeNumber(conversation.messageCount) ?? (
    sourceKind === 'legacy-index' ? 1 : 0
  );
  const latestMessageTimestamp = readNonNegativeNumber(conversation.latestMessageTimestamp) ?? updatedAt;
  const recordKey = readString(conversation.recordKey) ?? (
    sourceKind === 'catalog'
      ? getSelfContainedConversationRecordKey(id)
      : getLegacyConversationMessageKey(id)
  );
  return {
    id,
    title,
    collaboratorId: readNullableString(conversation.collaboratorId),
    activeProjectId: readNullableString(conversation.activeProjectId),
    reasoningStrength: settings.reasoningStrength,
    requestContext: settings.requestContext,
    windowPreferences: settings.windowPreferences,
    pinnedAt: readNullableNumber(conversation.pinnedAt),
    updatedAt: updatedAt || latestMessageTimestamp,
    expectedMessageCount: messageCount,
    expectedLatestMessageTimestamp: latestMessageTimestamp,
    ...(recordKey ? { missingRecordKeys: [recordKey] } : {})
  };
}

function getSelfContainedConversationRecordKey(conversationId: string) {
  return `${CHAT_CONVERSATION_RECORD_PREFIX}${conversationId}`;
}

function getLegacyConversationMessageKey(conversationId: string) {
  return `${CHAT_MESSAGE_PREFIX}${conversationId}`;
}

function getChatConversationEnvelopeKey(conversationId: string) {
  return `${CHAT_CONVERSATION_ENVELOPE_PREFIX}${conversationId}`;
}

function getCommitIdFromManifestKey(key: string) {
  return key.startsWith(CHAT_MANIFEST_PREFIX) ? key.slice(CHAT_MANIFEST_PREFIX.length) : null;
}

function getCommittedConversationIdFromMessageKey(key: string) {
  if (!key.startsWith(CHAT_COMMIT_MESSAGE_PREFIX)) return null;
  const remainder = key.slice(CHAT_COMMIT_MESSAGE_PREFIX.length);
  const separatorIndex = remainder.lastIndexOf(':');
  return separatorIndex >= 0 ? remainder.slice(separatorIndex + 1) : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function latestMessageTimestamp(messages: { timestamp: number }[]) {
  return Math.max(0, ...messages.map((message) => message.timestamp).filter((timestamp) => Number.isFinite(timestamp)));
}
