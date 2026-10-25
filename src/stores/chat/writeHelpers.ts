import type { Conversation } from '../../types/domain';
import {
  buildChatDomainMetaLocalDataRow,
  createCompleteLocalDataRow,
  getChatDomainMetaLocalDataRef,
  getConversationCatalogLocalDataRef,
  LOCAL_DATA_SCHEMA_VERSION,
  type ChatDomainMetaRow,
  type ConversationCatalogRow,
  type ConversationCatalogState
} from '../../engines/localData';
import { normalizeConversationTitle } from '../chatStoreTitles';
import { createStoreLocalDataRepository } from '../localDataStorePersistence';
import { listStoreLocalDataKeysWithPrefix } from '../storeLocalDataBackendHost';
import { CHAT_CATALOG_ROW_KEY_PREFIX } from './read';

export type ChatActivePointerWriteMode = 'strict' | 'recovery';

export type ChatCatalogStateIds = {
  activeIds: Set<string>;
  quarantinedIds: Set<string>;
};

export async function buildUnloadedConversationCatalogUpdate(
  conversation: Conversation,
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  updatedAt: number,
  mode: 'active' | 'overlay'
) {
  const previousCatalog = await repository.read<ConversationCatalogRow>(
    getConversationCatalogLocalDataRef(conversation.id)
  );
  if (previousCatalog.status === 'deleted') return null;
  if (previousCatalog.status !== 'complete') {
    if (mode === 'overlay') return null;
    throw new Error(`Active chat LocalData catalog ${conversation.id} is ${previousCatalog.status}.`);
  }
  const value: ConversationCatalogRow = {
    ...previousCatalog.value,
    title: normalizeConversationTitle(conversation.title, []),
    collaboratorId: conversation.collaboratorId,
    activeProjectId: conversation.activeProjectId ?? null,
    reasoningStrength: conversation.reasoningStrength,
    requestContext: conversation.requestContext,
    windowPreferences: conversation.windowPreferences,
    pinnedAt: conversation.pinnedAt,
    updatedAt: conversation.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getConversationCatalogLocalDataRef(conversation.id),
    value,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt
  });
}

export function resolveStrictWritableActiveConversationId(
  activeConversationId: string | null,
  activeConversationIds: Set<string>
) {
  if (activeConversationId === null) return null;
  if (activeConversationId && activeConversationIds.has(activeConversationId)) {
    return activeConversationId;
  }
  throw new Error(`Active chat LocalData write points at a missing conversation: ${activeConversationId}`);
}

export function resolveRecoveryWritableActiveConversationId(
  activeConversationId: string | null,
  activeConversationIds: Set<string>,
  allowNullActiveConversationId: boolean
) {
  if (activeConversationId && activeConversationIds.has(activeConversationId)) {
    return activeConversationId;
  }
  if (allowNullActiveConversationId) return null;
  return [...activeConversationIds][0] ?? null;
}

export function resolveWritableActiveConversationId({
  activeConversationId,
  activeConversationIds,
  allowNullActiveConversationId,
  mode
}: {
  activeConversationId: string | null;
  activeConversationIds: Set<string>;
  allowNullActiveConversationId: boolean;
  mode: ChatActivePointerWriteMode;
}) {
  if (mode === 'recovery') {
    return resolveRecoveryWritableActiveConversationId(
      activeConversationId,
      activeConversationIds,
      allowNullActiveConversationId
    );
  }
  return resolveStrictWritableActiveConversationId(activeConversationId, activeConversationIds);
}

export async function collectActiveLocalDataCatalogIds(
  repository: ReturnType<typeof createStoreLocalDataRepository>
) {
  const catalogIds = new Set<string>();
  const catalogKeys = (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).sort();

  for (const catalogKey of catalogKeys) {
    const conversationId = catalogKey.slice(CHAT_CATALOG_ROW_KEY_PREFIX.length);
    const catalog = await repository.read<ConversationCatalogRow>(
      getConversationCatalogLocalDataRef(conversationId)
    );
    if (catalog.status !== 'complete') continue;
    if (catalog.value.state !== 'active') continue;
    catalogIds.add(conversationId);
  }

  return catalogIds;
}

export async function readChatDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<ChatDomainMetaRow | null> {
  const result = await repository.read<ChatDomainMetaRow>(getChatDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}

/**
 * Classify the existing chat catalog rows by their durable state so a
 * single-conversation write can refresh the domain-meta counts truthfully:
 * `active` catalogs are live conversations, `unloaded`/`incomplete` catalogs are
 * quarantined ones that migration validation still expects to be counted, and
 * deleted/tombstoned catalogs are excluded from the total.
 */
export async function collectChatCatalogStateIds(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<ChatCatalogStateIds> {
  const activeIds = new Set<string>();
  const quarantinedIds = new Set<string>();
  const catalogKeys = (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).sort();

  for (const catalogKey of catalogKeys) {
    const conversationId = catalogKey.slice(CHAT_CATALOG_ROW_KEY_PREFIX.length);
    const catalog = await repository.read<ConversationCatalogRow>(
      getConversationCatalogLocalDataRef(conversationId)
    );
    if (catalog.status !== 'complete') continue;
    if (catalog.value.state === 'active') activeIds.add(conversationId);
    else if (catalog.value.state === 'unloaded' || catalog.value.state === 'incomplete') {
      quarantinedIds.add(conversationId);
    }
  }

  return { activeIds, quarantinedIds };
}

export function overlayChatCatalogState(
  ids: ChatCatalogStateIds,
  conversationId: string,
  state: ConversationCatalogRow['state']
) {
  ids.activeIds.delete(conversationId);
  ids.quarantinedIds.delete(conversationId);
  if (state === 'active') ids.activeIds.add(conversationId);
  else if (state === 'unloaded' || state === 'incomplete') ids.quarantinedIds.add(conversationId);
}

export function buildRefreshedChatDomainMetaRow(args: {
  previous: ChatDomainMetaRow | null;
  catalogStateIds: ChatCatalogStateIds;
  activeConversationId: string | null;
  updatedAt: number;
}) {
  const { activeIds, quarantinedIds } = args.catalogStateIds;
  return buildChatDomainMetaLocalDataRow({
    // The active conversation is the store's truth; record it verbatim. A dangling
    // pointer is surfaced loudly by the read path's resolveActiveConversationId,
    // not silently guessed to "the first conversation" here.
    activeConversationId: args.activeConversationId,
    activeGroupRoomId: args.previous?.activeGroupRoomId ?? null,
    groupRooms: args.previous?.groupRooms ?? [],
    activeConversationCount: activeIds.size,
    quarantinedConversationCount: quarantinedIds.size,
    totalConversationCount: activeIds.size + quarantinedIds.size,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: args.updatedAt
  });
}

/**
 * Like collectChatCatalogLifecycleCounts, but for a batch write: overlays the
 * post-commit state of every catalog row this write touches and removes tombstoned ids,
 * then counts active vs everything-else-not-deleted. Lets the snapshot writer's domain meta
 * count sealed lifecycle rows truthfully instead of zeroing the quarantine/total counts.
 */
export async function collectChatCatalogLifecycleCountsWithOverlay(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  overlayStates: Map<string, ConversationCatalogState>,
  deletedIds: Set<string>
): Promise<{ activeCount: number; otherCount: number }> {
  const stateById = new Map<string, ConversationCatalogState>();
  const catalogKeys = (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).sort();
  for (const catalogKey of catalogKeys) {
    const conversationId = catalogKey.slice(CHAT_CATALOG_ROW_KEY_PREFIX.length);
    const read = await repository.read<ConversationCatalogRow>(
      getConversationCatalogLocalDataRef(conversationId)
    );
    if (read.status === 'complete') stateById.set(conversationId, read.value.state);
  }
  for (const [conversationId, state] of overlayStates) stateById.set(conversationId, state);
  for (const conversationId of deletedIds) stateById.delete(conversationId);

  let activeCount = 0;
  let otherCount = 0;
  for (const state of stateById.values()) {
    if (state === 'active') activeCount += 1;
    else if (state !== 'deleted') otherCount += 1;
  }
  return { activeCount, otherCount };
}

/**
 * Count chat catalog rows by the coarse product bucket: `active` (live, loaded-capable)
 * vs everything else that is not a tombstone (unloaded / incomplete / archive / recovering
 * / quarantine / missing-body). The precise per-row lifecycle lives on each catalog row;
 * the domain meta only carries this coarse aggregate for health/validation. The optional
 * overlay lets a writer count the post-commit state of the row it is about to change.
 */
export async function collectChatCatalogLifecycleCounts(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  overlay?: { conversationId: string; overlayState: ConversationCatalogState }
): Promise<{ activeCount: number; otherCount: number }> {
  let activeCount = 0;
  let otherCount = 0;
  const catalogKeys = (await listStoreLocalDataKeysWithPrefix(CHAT_CATALOG_ROW_KEY_PREFIX)).sort();
  for (const catalogKey of catalogKeys) {
    const conversationId = catalogKey.slice(CHAT_CATALOG_ROW_KEY_PREFIX.length);
    const read = await repository.read<ConversationCatalogRow>(
      getConversationCatalogLocalDataRef(conversationId)
    );
    if (read.status !== 'complete') continue;
    const state = overlay && overlay.conversationId === conversationId
      ? overlay.overlayState
      : read.value.state;
    if (state === 'active') activeCount += 1;
    else if (state !== 'deleted') otherCount += 1;
  }
  return { activeCount, otherCount };
}

export function uniqueConversationIds(conversationIds: string[]) {
  return Array.from(new Set(
    conversationIds.filter((conversationId) => conversationId.trim().length > 0)
  ));
}
