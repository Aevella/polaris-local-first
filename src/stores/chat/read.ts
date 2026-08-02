import type { ChatMessage, Conversation } from '../../types/domain';
import { normalizeChatMessage } from '../../engines/chatMessageNormalization';
import {
  getChatDomainMetaLocalDataRef,
  getConversationCatalogLocalDataRef,
  getConversationRecordLocalDataRef,
  getLocalDataRowKey,
  isLegacyLifecycleCatalogState,
  type ChatDomainMetaRow,
  type ConversationCatalogRow,
  type ConversationRecordRow
} from '../../engines/localData';
import { LOCAL_DATA_NAMESPACE } from '../../engines/localData/types';
import { rebuildConversationToolLedger } from '../../engines/toolLedger';
import { isRetiredGroupConversation } from '../../engines/conversationOwnership';
import { normalizeConversationTitle } from '../chatStoreTitles';
import {
  fingerprintDiagnosticId,
  reportPersistenceError
} from '../../infrastructure/persistenceDiagnostics';
import {
  createStoreLocalDataRepository,
  readActiveLocalDataSourceForDomain
} from '../localDataStorePersistence';
import {
  listStoreLocalDataKeysWithPrefix,
  readStoreLocalDataValue
} from '../storeLocalDataBackendHost';
import type { ChatConversationLifecycleEntry, ChatReadMode, PersistedChatState } from './index';
import type { LocalDataReadIntegrity } from '../localDataStorePersistence';

export type ChatLocalDataMessageReadResult =
  | { status: 'inactive' }
  | { status: 'complete'; messages: ChatMessage[] }
  | { status: 'missing' }
  | { status: 'deleted' }
  | { status: 'unloaded' | 'incomplete' | 'timedOut'; reason: string };

export const CHAT_CATALOG_ROW_KEY_PREFIX = `${LOCAL_DATA_NAMESPACE}:row:chat:conversationCatalog:`;

export async function isChatLocalDataRepositoryActive() {
  return (await readActiveChatLocalDataSource()) !== null;
}

export async function hasChatLocalDataRepositoryRows() {
  const domainMeta = await readStoreLocalDataValue(getLocalDataRowKey(getChatDomainMetaLocalDataRef()));
  if (domainMeta) return true;
  return (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).length > 0;
}

export async function readChatStateFromLocalDataRepository(options: {
  readMode?: ChatReadMode;
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedChatState | null> {
  const activeSource = await readActiveChatLocalDataSource();
  if (!activeSource) return null;

  return await readChatStateFromLocalDataRows(options, 'active');
}

export async function readChatStateFromLocalDataLive(options: {
  readMode?: ChatReadMode;
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedChatState | null> {
  if (!(await hasChatLocalDataRepositoryRows())) return null;
  return await readChatStateFromLocalDataRows(options, 'active');
}

export async function readChatStateFromLocalDataOverlay(options: {
  readMode?: ChatReadMode;
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedChatState | null> {
  if (await isChatLocalDataRepositoryActive()) return null;
  if (!(await hasChatLocalDataRepositoryRows())) return null;
  return await readChatStateFromLocalDataRows(options, 'overlay');
}

async function readChatStateFromLocalDataRows(
  options: { readMode?: ChatReadMode; integrity?: LocalDataReadIntegrity },
  mode: 'active' | 'overlay'
): Promise<PersistedChatState | null> {
  const recover = options.integrity !== 'strict';
  const repository = createStoreLocalDataRepository();
  const domainMeta = await repository.read<ChatDomainMetaRow>(getChatDomainMetaLocalDataRef());
  if (domainMeta.status === 'deleted') return null;
  if (domainMeta.status !== 'complete') {
    if (mode === 'overlay' && !(await hasChatLocalDataCatalogRows())) return null;
    throw new Error(`Active chat LocalData domain meta is ${domainMeta.status}.`);
  }

  const catalogKeys = (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).sort();
  const activeCatalogs: ConversationCatalogRow[] = [];
  const lifecycleCatalogs: ConversationCatalogRow[] = [];
  const deletedConversationIds: string[] = [];
  const retiredGroupConversationIds: string[] = [];
  const quarantinedConversationIds: string[] = [];

  for (const catalogKey of catalogKeys) {
    const conversationId = catalogKey.slice(CHAT_CATALOG_ROW_KEY_PREFIX.length);
    const catalog = await repository.read<ConversationCatalogRow>(
      getConversationCatalogLocalDataRef(conversationId)
    );
    if (catalog.status === 'deleted') {
      deletedConversationIds.push(conversationId);
      continue;
    }
    if (catalog.status !== 'complete') {
      if (recover) {
        quarantinedConversationIds.push(conversationId);
        reportIsolatedChatRow('conversationCatalog', conversationId, catalog.status);
        continue;
      }
      throw new Error(`Active chat LocalData catalog ${conversationId} is ${catalog.status}.`);
    }
    if (isRetiredGroupConversation(catalog.value)) {
      deletedConversationIds.push(conversationId);
      retiredGroupConversationIds.push(conversationId);
      continue;
    }
    if (catalog.value.state === 'active') {
      activeCatalogs.push(catalog.value);
    } else if (isLegacyLifecycleCatalogState(catalog.value.state)) {
      lifecycleCatalogs.push(catalog.value);
    }
  }

  const sortedActive = sortCatalogs(activeCatalogs);
  if (sortedActive.length === 0 && lifecycleCatalogs.length === 0) {
    if (deletedConversationIds.length === 0 && quarantinedConversationIds.length === 0) return null;
    return {
      conversations: [],
      activeConversationId: null,
      activeGroupRoomId: null,
      groupRooms: [],
      loadedConversationIds: [],
      deletedConversationIds,
      quarantinedConversationIds: uniqueConversationIds(quarantinedConversationIds),
      legacyLifecycleByConversationId: {}
    };
  }

  if (
    domainMeta.value.activeConversationId
    && lifecycleCatalogs.some((catalog) => catalog.id === domainMeta.value.activeConversationId)
  ) {
    throw new Error(`Active chat LocalData metadata points at a missing conversation: ${domainMeta.value.activeConversationId}`);
  }

  const activeConversationId = resolveActiveConversationId(
    domainMeta.value.activeConversationId,
    sortedActive,
    new Set(retiredGroupConversationIds),
    recover
  );
  const activeIdSet = new Set(sortedActive.map((catalog) => catalog.id));
  const directoryCatalogs = sortCatalogs([...activeCatalogs, ...lifecycleCatalogs]);
  const loadedConversationIds: string[] = [];
  const conversations: Conversation[] = [];
  const failedConversationIds: string[] = [];
  const legacyLifecycleByConversationId: Record<string, ChatConversationLifecycleEntry> = {};

  for (const catalog of directoryCatalogs) {
    if (!activeIdSet.has(catalog.id)) {
      conversations.push(toUnloadedConversation(catalog));
      legacyLifecycleByConversationId[catalog.id] = {
        state: catalog.state as ChatConversationLifecycleEntry['state'],
        reason: catalog.lifecycleReason ?? null
      };
      continue;
    }

    const shouldLoadRecord = options.readMode !== 'active-only' || catalog.id === activeConversationId;
    if (!shouldLoadRecord) {
      conversations.push(toUnloadedConversation(catalog));
      continue;
    }

    const record = await repository.read<ConversationRecordRow>(
      getConversationRecordLocalDataRef(catalog.id)
    );
    if (record.status !== 'complete') {
      if (recover) {
        conversations.push(toUnloadedConversation(catalog));
        failedConversationIds.push(catalog.id);
        quarantinedConversationIds.push(catalog.id);
        reportIsolatedChatRow('conversationRecord', catalog.id, record.status);
        continue;
      }
      throw new Error(`Active chat LocalData record ${catalog.id} is ${record.status}.`);
    }

    conversations.push(toConversation(catalog, record.value));
    loadedConversationIds.push(catalog.id);
  }

  return {
    conversations,
    activeConversationId,
    activeGroupRoomId: null,
    groupRooms: [],
    loadedConversationIds,
    failedConversationIds,
    deletedConversationIds,
    quarantinedConversationIds: uniqueConversationIds(quarantinedConversationIds),
    legacyLifecycleByConversationId
  };
}

async function hasChatLocalDataCatalogRows() {
  return (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).length > 0;
}

export async function readConversationMessagesFromLocalDataRepositoryIfActive(
  conversationId: string
): Promise<ChatMessage[] | null> {
  if (!(await isChatLocalDataRepositoryActive())) return null;
  return await readConversationMessagesFromLocalDataRepository(conversationId);
}

export async function readConversationMessagesFromLocalDataLive(
  conversationId: string
): Promise<ChatLocalDataMessageReadResult> {
  const active = await isChatLocalDataRepositoryActive();
  if (!active && !(await hasChatLocalDataRepositoryRows())) return { status: 'inactive' };
  const repository = createStoreLocalDataRepository();
  const record = await repository.read<ConversationRecordRow>(
    getConversationRecordLocalDataRef(conversationId)
  );
  if (record.status === 'complete') {
    return {
      status: 'complete',
      messages: record.value.messages.map(normalizeChatMessage)
    };
  }
  if (record.status === 'deleted') return { status: 'deleted' };
  if (record.status === 'incomplete' && record.reason === 'Local data row is missing.') {
    return active ? { status: 'missing' } : { status: 'inactive' };
  }
  if (!active) return { status: 'inactive' };
  if (record.status === 'incomplete') {
    return {
      status: 'incomplete',
      reason: record.reason
    };
  }
  if (record.status === 'timedOut') {
    return {
      status: 'timedOut',
      reason: record.reason
    };
  }
  return {
    status: 'unloaded',
    reason: `Active chat LocalData record ${conversationId} is unloaded.`
  };
}

export async function readConversationMessagesFromLocalDataRepository(
  conversationId: string
): Promise<ChatMessage[] | null> {
  const repository = createStoreLocalDataRepository();
  const record = await repository.read<ConversationRecordRow>(
    getConversationRecordLocalDataRef(conversationId)
  );
  if (record.status === 'deleted') return null;
  if (record.status === 'incomplete' && record.reason === 'Local data row is missing.') return null;
  if (record.status !== 'complete') {
    throw new Error(`Active chat LocalData record ${conversationId} is ${record.status}.`);
  }
  return record.value.messages.map(normalizeChatMessage);
}

async function readActiveChatLocalDataSource() {
  return await readActiveLocalDataSourceForDomain('chat');
}

function toConversation(catalog: ConversationCatalogRow, record: ConversationRecordRow): Conversation {
  const messages = record.messages.map(normalizeChatMessage);
  return {
    id: catalog.id,
    title: normalizeConversationTitle(catalog.title, messages),
    kind: catalog.kind ?? 'direct',
    collaboratorId: catalog.collaboratorId,
    group: catalog.group,
    groupRoomId: catalog.groupRoomId ?? null,
    activeProjectId: catalog.activeProjectId,
    messages,
    toolLedger: rebuildConversationToolLedger(messages),
    workspaceLedger: record.workspaceLedger,
    task: record.task,
    draft: record.draft,
    pinnedAt: catalog.pinnedAt,
    updatedAt: catalog.updatedAt
  };
}

function toUnloadedConversation(catalog: ConversationCatalogRow): Conversation {
  return {
    id: catalog.id,
    title: normalizeConversationTitle(catalog.title, []),
    kind: catalog.kind ?? 'direct',
    collaboratorId: catalog.collaboratorId,
    group: catalog.group,
    groupRoomId: catalog.groupRoomId ?? null,
    activeProjectId: catalog.activeProjectId,
    messages: [],
    toolLedger: undefined,
    workspaceLedger: [],
    task: null,
    draft: '',
    pinnedAt: catalog.pinnedAt,
    updatedAt: catalog.updatedAt
  };
}

function resolveActiveConversationId(
  activeConversationId: string | null,
  catalogs: ConversationCatalogRow[],
  retiredGroupConversationIds: ReadonlySet<string>,
  allowMissingActiveConversation: boolean
) {
  if (activeConversationId === null) return null;
  if (catalogs.some((catalog) => catalog.id === activeConversationId)) return activeConversationId;
  if (retiredGroupConversationIds.has(activeConversationId) || allowMissingActiveConversation) {
    return catalogs[0]?.id ?? null;
  }
  throw new Error(`Active chat LocalData metadata points at a missing conversation: ${activeConversationId}`);
}

function uniqueConversationIds(conversationIds: string[]) {
  return Array.from(new Set(conversationIds.filter((id) => id.trim().length > 0)));
}

function reportIsolatedChatRow(kind: string, conversationId: string, status: string) {
  reportPersistenceError({
    label: '[store:persist:isolation]',
    store: 'chat',
    operation: 'read-isolated-row',
    domain: 'chat',
    stage: 'hydrate-row',
    integrity: 'degraded',
    rowCount: 1,
    fingerprint: fingerprintDiagnosticId(`${kind}:${conversationId}`)
  }, new Error(`Optional chat LocalData row was isolated after a ${status} read.`));
}

function sortCatalogs(catalogs: ConversationCatalogRow[]) {
  return [...catalogs].sort((left, right) => right.updatedAt - left.updatedAt);
}
