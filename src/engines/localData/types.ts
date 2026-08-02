import type {
  AppCustomization,
  AppDisplayPreferences,
  ChatMessage,
  CodeCard,
  CollectionShelf,
  ConversationTaskState,
  ConversationSummaryModelSettings,
  GroupConversationState,
  GroupChatRoom,
  ImageAssetCard,
  ImageGenerationSettings,
  ImageUnderstandingSettings,
  McpServerConfig,
  MemoryVectorRetrievalSettings,
  Persona,
  PolarisCompanionConnection,
  PolarisCompanionHostState,
  PolarisTriggerRule,
  ProjectFile,
  ProviderProfile,
  RoomProject,
  SavedSkin,
  ThemeState,
  VoiceGenerationSettings,
  WebDavConfig,
  WebSearchConfig,
  World,
  WorkspaceLedgerEvent,
  WorkspaceReferenceDoc
} from '../../types/domain';
import type { AppLanguage } from '../../i18n/appLanguage';
import type { PolarisToolPromptGroup } from '../tool-protocol/assistantToolProtocolTypes';

export const LOCAL_DATA_SCHEMA_VERSION = 1;
export const LOCAL_DATA_NAMESPACE = 'local-data-v1';

export type LocalDataDomain =
  | 'asset'
  | 'chat'
  | 'collection'
  | 'document'
  | 'persona'
  | 'runtime'
  | 'space';

export type LocalDataReadStatus = 'complete' | 'unloaded' | 'incomplete' | 'timedOut' | 'deleted';

export type LocalDataRef = {
  domain: LocalDataDomain;
  kind: string;
  id: string;
};

export type LocalDataOwnerRef = {
  kind: 'card' | 'message' | 'persona' | 'projectFile' | 'theme';
  id: string;
};

export type LocalDataRowBase = {
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  key: string;
  ref: LocalDataRef;
  version: number;
  updatedAt: number;
};

export type LocalDataCompleteRow<T = unknown> = LocalDataRowBase & {
  state: 'complete';
  value: T;
};

export type LocalDataUnloadedRow = LocalDataRowBase & {
  state: 'unloaded';
  meta?: Record<string, unknown>;
};

export type LocalDataIncompleteRow = LocalDataRowBase & {
  state: 'incomplete';
  reason: string;
  missingKeys?: string[];
  meta?: Record<string, unknown>;
};

export type LocalDataTimedOutRow = LocalDataRowBase & {
  state: 'timedOut';
  reason: string;
};

export type LocalDataDeletedRow = LocalDataRowBase & {
  state: 'deleted';
  deletedAt: number;
};

export type LocalDataStoredRow<T = unknown> =
  | LocalDataCompleteRow<T>
  | LocalDataUnloadedRow
  | LocalDataIncompleteRow
  | LocalDataTimedOutRow
  | LocalDataDeletedRow;

export type LocalDataReadResult<T = unknown> =
  | { status: 'complete'; ref: LocalDataRef; value: T; row: LocalDataCompleteRow<T> }
  | { status: 'unloaded'; ref: LocalDataRef; row: LocalDataUnloadedRow }
  | { status: 'incomplete'; ref: LocalDataRef; reason: string; missingKeys: string[]; row?: LocalDataIncompleteRow }
  | { status: 'timedOut'; ref: LocalDataRef; reason: string; row?: LocalDataTimedOutRow }
  | { status: 'deleted'; ref: LocalDataRef; deletedAt: number; row: LocalDataDeletedRow };

/**
 * Live product catalog states: this row is a real, writable conversation owned by
 * the new LocalData layer. `active` = body row present/loadable, `unloaded` /
 * `incomplete` = body not yet loaded or partially missing for a live conversation.
 */
export type ConversationCatalogLiveState = 'active' | 'unloaded' | 'incomplete';

/**
 * Legacy-origin lifecycle states: this row came from the old chat layer and is NOT a live product
 * conversation. It carries a `legacyRef` to its old source. These are historical markers only:
 * live hydration treats them as excluded from the product list. `archive` = old directory head,
 * no live body; `recovering` / `quarantine` / `missing-body` = residual historical states,
 * retained so such rows stay identifiable and excludable without reading the old layer on every
 * ordinary list/hydrate.
 */
export type ConversationCatalogLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type ConversationCatalogState =
  | ConversationCatalogLiveState
  | ConversationCatalogLegacyLifecycleState
  | 'deleted';

/**
 * A reference from a sealed archive directory row back to its legacy source. The row id
 * is the conversation id; this ref records which legacy layer it came from and the canonical
 * self-contained record key, so a sealed row carries an explicit, named legacy locator
 * instead of a hidden id guess.
 */
export type ChatLegacyCatalogRef = {
  layer: 'chat-catalog-v1';
  recordKey: string;
};

export type ConversationCatalogRow = {
  id: string;
  title: string;
  kind?: 'direct' | 'group';
  collaboratorId: string | null;
  group?: GroupConversationState;
  groupRoomId?: string | null;
  activeProjectId: string | null;
  pinnedAt: number | null;
  updatedAt: number;
  messageCount: number;
  latestMessageTimestamp: number;
  state: ConversationCatalogState;
  // Present for legacy-origin lifecycle states so old markers keep their source locator while
  // remaining excluded from live hydration.
  legacyRef?: ChatLegacyCatalogRef;
  // Short human-facing reason for a quarantine / missing-body lifecycle state.
  lifecycleReason?: string;
  missingRecordKeys?: string[];
  recordVersion: number;
};

export type ChatDomainMetaRow = {
  id: 'chat';
  activeConversationId: string | null;
  activeGroupRoomId?: string | null;
  groupRooms?: GroupChatRoom[];
  activeConversationCount: number;
  quarantinedConversationCount: number;
  totalConversationCount: number;
  updatedAt: number;
};

export type ConversationRecordRow = {
  id: string;
  version: number;
  committedAt: number;
  messages: ChatMessage[];
  task: ConversationTaskState | null;
  draft: string;
  workspaceLedger: WorkspaceLedgerEvent[];
  ownerProjectId: string | null;
  assetRefs: string[];
};

export type CollectionLocalDataObjectKind =
  | 'card'
  | 'image-card'
  | 'project'
  | 'project-file'
  | 'workspace-doc';

export type CollectionDomainMetaRow = {
  id: 'collection';
  activeProjectId: string | null;
  activeObjectCount: number;
  totalObjectCount: number;
  objectCounts: Record<CollectionLocalDataObjectKind, number>;
  deletedBundledCardIds?: string[];
  updatedAt: number;
};

export type CollectionObjectValueMap = {
  card: CodeCard;
  'image-card': ImageAssetCard;
  project: RoomProject;
  'project-file': ProjectFile;
  'workspace-doc': WorkspaceReferenceDoc;
};

/**
 * Live product collection object state: a real, writable card / project / file / workspace
 * doc directory row. Live rows carry no `state` field (undefined === `active`), so an
 * ordinary collection save's value-diff stays byte-identical to before this lifecycle existed.
 */
export type CollectionObjectLiveState = 'active';

/**
 * Legacy-origin lifecycle states: this object row came from the old `collection-state-v2` layer
 * and is NOT a live product object. It carries a `legacyRef` to its old source. These are
 * historical markers only: live hydration treats them as excluded from the product list. For a
 * `workspace-doc`, this lifecycle covers only the collection-owned DIRECTORY row; the doc body is
 * a separate document-domain fact and is never deleted through the collection lifecycle.
 */
export type CollectionObjectLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type CollectionObjectState =
  | CollectionObjectLiveState
  | CollectionObjectLegacyLifecycleState;

/**
 * A reference from a sealed archive collection object row back to its legacy source. The row is
 * keyed by (kind, id); `recordKey` records the legacy object id so a sealed row carries an
 * explicit, named locator instead of a hidden id guess.
 */
export type CollectionLegacyCatalogRef = {
  layer: 'collection-state-v2';
  recordKey: string;
};

export type CollectionObjectRow<K extends CollectionLocalDataObjectKind = CollectionLocalDataObjectKind> = {
  id: string;
  objectId: string;
  kind: K;
  value: CollectionObjectValueMap[K];
  ownerCollaboratorId: string | null;
  projectId: string | null;
  assetRefs: string[];
  // Absent for live product rows (undefined === `active`); present exactly for legacy-origin
  // lifecycle rows, alongside `legacyRef`. Keeping live rows free of this field preserves the
  // ordinary-save value-diff.
  state?: CollectionObjectState;
  legacyRef?: CollectionLegacyCatalogRef;
  lifecycleReason?: string;
  updatedAt: number;
};

export type PersonaDomainMetaRow = {
  id: 'persona';
  activeCollaboratorId: string | null;
  activeObjectCount: number;
  totalObjectCount: number;
  seededDefaultPersonaIds: string[];
  updatedAt: number;
};

/**
 * Live product collaborator state: a real, writable persona owned by the new LocalData
 * layer. Live persona rows carry no `state` field at all (undefined === `active`), so the
 * value-diff of an ordinary persona save stays byte-identical to before this schema gained
 * a lifecycle.
 */
export type PersonaCollaboratorLiveState = 'active';

/**
 * Legacy-origin lifecycle states: this collaborator row came from the old `persona-state-v2`
 * layer and is NOT a live product persona. It carries a `legacyRef` to its old source. These are
 * historical markers only: live hydration treats them as excluded from the product list.
 * `archive` = old directory head, no live body; `recovering` / `quarantine` / `missing-body` =
 * residual historical states, retained so such rows stay identifiable and excludable.
 */
export type PersonaCollaboratorLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type PersonaCollaboratorState =
  | PersonaCollaboratorLiveState
  | PersonaCollaboratorLegacyLifecycleState;

/**
 * A reference from a sealed archive collaborator row back to its legacy source. The row id
 * is the persona id; `recordKey` records the canonical legacy persona id so a sealed row carries
 * an explicit, named locator instead of a hidden id guess. The persona's memory doc BODIES are a
 * separate document-domain fact keyed by id (`docContentKey(personaId, docId)`), never carried
 * inline on this directory row.
 */
export type PersonaLegacyCatalogRef = {
  layer: 'persona-state-v2';
  recordKey: string;
};

export type PersonaObjectRow = {
  id: string;
  objectId: string;
  kind: 'collaborator';
  value: Persona;
  active: boolean;
  assetRefs: string[];
  referenceDocIds: string[];
  referenceDocCount: number;
  // Absent for live product rows (undefined === `active`); present exactly for legacy-origin
  // lifecycle rows, alongside `legacyRef`. Keeping live rows free of this field preserves the
  // ordinary-save value-diff.
  state?: PersonaCollaboratorState;
  // Present for legacy-origin lifecycle states so old markers keep their source locator while
  // remaining excluded from live hydration.
  legacyRef?: PersonaLegacyCatalogRef;
  // Short human-facing reason for a quarantine / missing-body lifecycle state.
  lifecycleReason?: string;
  updatedAt: number;
};

export type RuntimeLocalDataObjectKind =
  | 'settings'
  | 'provider'
  | 'mcp-server'
  | 'companion-connection'
  | 'trigger-rule';

export type RuntimeSettingsRowValue = {
  id: 'runtime-settings';
  webdav: WebDavConfig;
  search: WebSearchConfig;
  conversationSummaryModel: ConversationSummaryModelSettings;
  memoryVectorRetrieval: MemoryVectorRetrievalSettings;
  imageGeneration: ImageGenerationSettings;
  imageUnderstanding: ImageUnderstandingSettings;
  voiceGeneration: VoiceGenerationSettings;
  toolPromptPreferences: Record<PolarisToolPromptGroup, boolean>;
  taskModeEnabled: boolean;
  mcpToolTimeoutSeconds: number;
  companionHost: PolarisCompanionHostState;
  updatedAt: number;
};

export type RuntimeDomainMetaRow = {
  id: 'runtime';
  activeProviderId: string | null;
  activeObjectCount: number;
  totalObjectCount: number;
  objectCounts: Record<RuntimeLocalDataObjectKind, number>;
  updatedAt: number;
};

export type RuntimeObjectValueMap = {
  settings: RuntimeSettingsRowValue;
  provider: ProviderProfile;
  'mcp-server': McpServerConfig;
  'companion-connection': PolarisCompanionConnection;
  'trigger-rule': PolarisTriggerRule;
};

/**
 * Legacy-origin lifecycle states for a sealed runtime variable row (provider / mcp-server /
 * companion-connection / trigger-rule). The settings singleton is never sealed. Live rows carry
 * no `state` (undefined === `active`), so the ordinary value-diff stays byte-identical.
 */
export type RuntimeObjectLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type RuntimeObjectState = 'active' | RuntimeObjectLegacyLifecycleState;

export type RuntimeLegacyCatalogRef = {
  layer: 'runtime-providers-v2';
  recordKey: string;
};

export type RuntimeObjectRow<K extends RuntimeLocalDataObjectKind = RuntimeLocalDataObjectKind> = {
  id: string;
  objectId: string;
  kind: K;
  value: RuntimeObjectValueMap[K];
  ownerCollaboratorId: string | null;
  // Absent for live product rows (undefined === `active`); present exactly for legacy-origin
  // lifecycle rows, alongside `legacyRef`.
  state?: RuntimeObjectState;
  legacyRef?: RuntimeLegacyCatalogRef;
  lifecycleReason?: string;
  updatedAt: number;
};

export type SpaceLocalDataObjectKind =
  | 'frontstage'
  | 'theme'
  | 'customization'
  | 'collaborator-theme'
  | 'skin';

export type SpaceFrontstageRowValue = {
  id: 'space-frontstage';
  activeWorld: World;
  collectionShelf: CollectionShelf;
  frontstageCollaboratorId: string | null;
  collectionProjectId: string | null;
  editingCollaboratorId: string | null;
  screenshotDebugOverlayEnabled: boolean;
  appLanguage: AppLanguage;
  displayPreferences: AppDisplayPreferences;
  activeCardId: string | null;
  updatedAt: number;
};

export type SpaceThemeRowValue = {
  id: 'space-theme';
  // The stored ThemeState carries an empty `savedSkins`: the saved-skin library lives in
  // its own `skin:{id}` rows. `savedSkinOrder` is the ordered list of those skin ids, so
  // hydration can reassemble the library in the exact display order.
  value: ThemeState;
  savedSkinOrder: string[];
  savedSkinCount: number;
  skinHistoryCount: number;
  patchLedgerCount: number;
  assetRefs: string[];
  updatedAt: number;
};

export type SpaceSkinRowValue = {
  id: string;
  value: SavedSkin;
  assetRefs: string[];
  updatedAt: number;
};

export type SpaceCustomizationRowValue = {
  id: 'space-customization';
  value: AppCustomization;
  assetRefs: string[];
  updatedAt: number;
};

export type SpaceCollaboratorThemeRowValue = {
  id: string;
  collaboratorId: string;
  theme: ThemeState;
  customization: AppCustomization;
  assetRefs: string[];
  updatedAt: number;
};

export type SpaceDomainMetaRow = {
  id: 'space';
  frontstageCollaboratorId: string | null;
  collectionProjectId: string | null;
  activeObjectCount: number;
  totalObjectCount: number;
  objectCounts: Record<SpaceLocalDataObjectKind, number>;
  updatedAt: number;
};

export type SpaceObjectValueMap = {
  frontstage: SpaceFrontstageRowValue;
  theme: SpaceThemeRowValue;
  customization: SpaceCustomizationRowValue;
  'collaborator-theme': SpaceCollaboratorThemeRowValue;
  skin: SpaceSkinRowValue;
};

/**
 * Legacy-origin lifecycle states for a sealed space variable row (collaborator-theme / skin).
 * The frontstage / theme / customization singletons are never sealed. Live rows carry no `state`
 * (undefined === `active`), so the ordinary value-diff stays byte-identical.
 */
export type SpaceObjectLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type SpaceObjectState = 'active' | SpaceObjectLegacyLifecycleState;

export type SpaceLegacyCatalogRef = {
  layer: 'space-theme-state-v1';
  recordKey: string;
};

export type SpaceObjectRow<K extends SpaceLocalDataObjectKind = SpaceLocalDataObjectKind> = {
  id: string;
  objectId: string;
  kind: K;
  value: SpaceObjectValueMap[K];
  ownerCollaboratorId: string | null;
  assetRefs: string[];
  // Absent for live product rows (undefined === `active`); present exactly for legacy-origin
  // lifecycle rows, alongside `legacyRef`.
  state?: SpaceObjectState;
  legacyRef?: SpaceLegacyCatalogRef;
  lifecycleReason?: string;
  updatedAt: number;
};

export type AssetLocalDataOwnerRef = {
  kind:
    | 'conversation'
    | 'conversation-voice-cache'
    | 'code-card'
    | 'image-card'
    | 'project-file'
    | 'workspace-reference-doc'
    | 'room-project'
    | 'pending-attachments'
    | 'persona'
    | 'runtime-customization'
    | 'theme';
  id: string;
  label: string;
};

export type AssetLocalDataObjectKind = 'image' | 'file' | 'unknown';

/**
 * Legacy-origin lifecycle states for a historical asset object row. These live on a SEPARATE axis from
 * the presence-driven envelope incompleteness (`missing-meta` / `missing-binary` / `preview-only`):
 * those reasons describe an INCOMPLETE LocalData row whose blob/meta is absent, whereas a lifecycle
 * row is always a COMPLETE LocalData row that records old lifecycle evidence. In particular the
 * lifecycle `missing-body` must never be conflated with the presence reason `missing-binary`. Live
 * product asset rows carry no `state` (undefined === `active`), so their value diff stays
 * byte-identical.
 */
export type AssetObjectLegacyLifecycleState =
  | 'archive'
  | 'recovering'
  | 'quarantine'
  | 'missing-body';

export type AssetObjectState = 'active' | AssetObjectLegacyLifecycleState;

export type AssetLegacyCatalogRef = {
  layer: 'asset-meta';
  recordKey: string;
};

export type AssetObjectRow = {
  id: string;
  objectId: string;
  /** Physical blob-store key. Older rows omit it and therefore use `id`. */
  storageKey?: string;
  kind: AssetLocalDataObjectKind;
  name: string;
  mimeType: string;
  size: number | null;
  createdAt: number | null;
  textContent?: string;
  hasMeta: boolean;
  hasBinary: boolean;
  hasPreview: boolean;
  binaryBytes: number;
  previewBytes: number;
  ownerRefs: AssetLocalDataOwnerRef[];
  ownerCount: number;
  orphan: boolean;
  // Absent for live product rows (undefined === `active`); present exactly for legacy-origin
  // lifecycle rows, alongside `legacyRef`. Kept distinct from the presence-driven envelope
  // incompleteness so a sealed archive is never read as a live (or live-but-incomplete) asset.
  state?: AssetObjectState;
  legacyRef?: AssetLegacyCatalogRef;
  lifecycleReason?: string;
  updatedAt: number;
};

export type AssetDomainMetaRow = {
  id: 'asset';
  activeObjectCount: number;
  totalObjectCount: number;
  objectCounts: Record<AssetLocalDataObjectKind, number>;
  orphanObjectCount: number;
  missingMetaCount: number;
  missingBinaryCount: number;
  previewOnlyCount: number;
  totalBinaryBytes: number;
  totalPreviewBytes: number;
  updatedAt: number;
};

export type DocumentLocalDataObjectKind =
  | 'persona-memory-doc'
  | 'workspace-reference-doc'
  | 'orphan-body';

export type DocumentStorageSource =
  | 'inline'
  | 'split'
  | 'chunked'
  | 'legacy'
  | 'empty'
  | 'missing';

export type DocumentOwnerRef = {
  kind: 'persona' | 'workspace-doc' | 'orphan-body';
  id: string;
  label: string;
};

export type DocumentBodyRow = {
  id: string;
  objectId: string;
  kind: DocumentLocalDataObjectKind;
  title: string;
  summary: string;
  content: string;
  declaredCharCount: number;
  actualCharCount: number;
  contentLoaded: boolean;
  storageSource: DocumentStorageSource;
  storageKeys: string[];
  chunkCount: number;
  chunkIndexes: number[];
  ownerRefs: DocumentOwnerRef[];
  ownerCount: number;
  assetRefs: string[];
  orphan: boolean;
  updatedAt: number;
};

export type DocumentDomainMetaRow = {
  id: 'document';
  activeObjectCount: number;
  totalObjectCount: number;
  objectCounts: Record<DocumentLocalDataObjectKind, number>;
  missingBodyCount: number;
  incompleteChunkCount: number;
  orphanBodyCount: number;
  totalCharCount: number;
  updatedAt: number;
};

export type TombstoneRow = {
  id: string;
  kind: string;
  deletedAt: number;
};

export type CommitPointerRow = {
  domain: LocalDataDomain;
  version: number;
  committedAt: number;
  commitId: string;
};

export type LocalDataActiveDataSource = 'repository';

export type LocalDataActiveDataSourceRow = {
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  key: string;
  activeDataSource: LocalDataActiveDataSource;
  activeCommitId: string | null;
  stagingCommitId: string | null;
  updatedAt: number;
  domains: Partial<Record<LocalDataDomain, CommitPointerRow>>;
};

export type LocalDataUnitMutation =
  | { type: 'put'; row: LocalDataStoredRow }
  | { type: 'restore'; row: LocalDataCompleteRow }
  | { type: 'tombstone'; ref: LocalDataRef; version: number; deletedAt?: number };

export type LocalDataUnitOfWork = {
  id?: string;
  domain: LocalDataDomain;
  version: number;
  mutations: LocalDataUnitMutation[];
};

export type LocalDataBackendMutation =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'delete'; key: string };

export type LocalDataCommitMeta = {
  commitId: string;
  domain: LocalDataDomain;
  version: number;
  committedAt: number;
};

export type LocalDataDomainMetadataKey =
  | 'activeConversationId'
  | 'activeProjectId'
  | 'activeCollaboratorId'
  | 'activePersonaId'
  | 'selectedCardId'
  | 'selectedProjectId';

export type LocalDataMigrationValidationReport = {
  id: string;
  domain: LocalDataDomain;
  commitId: string;
  version: number;
  validatedAt: number;
  stagingHydrated: boolean;
  legacyBaselineCount: number;
  legacyBaselineObjectIds: string[];
  activeBaselineObjectIds: string[];
  activeObjectCount: number;
  activeObjectIds: string[];
  quarantinedObjectCount: number;
  quarantinedObjectIds: string[];
  duplicateObjectIdCount: number;
  missingActiveCollaboratorIdCount: number;
  missingActiveCollaboratorIds: string[];
  activeIncompleteRowCount: number;
  activeTimedOutRowCount: number;
  recoveredMetadata: Partial<Record<LocalDataDomainMetadataKey, string | null>>;
  metadataDegradationReasons?: Partial<Record<LocalDataDomainMetadataKey, string>>;
};

export type LocalDataTransactionalBackend = {
  mode: 'transactional';
  read<T>(key: string): Promise<T | null>;
  listKeysWithPrefix(prefix: string): Promise<string[]>;
  commitAtomic(mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta): Promise<void>;
};

export type LocalDataStagedBackend = {
  mode: 'staged';
  read<T>(key: string): Promise<T | null>;
  listKeysWithPrefix(prefix: string): Promise<string[]>;
  stageCommit(stageId: string, mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta): Promise<void>;
  verifyCommit(stageId: string, mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta): Promise<boolean>;
  publishCommit(stageId: string, mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta): Promise<void>;
  clearStage?(stageId: string): Promise<void>;
};

export type LocalDataBackend = LocalDataTransactionalBackend | LocalDataStagedBackend;

export function getLocalDataRowKey(ref: LocalDataRef) {
  return `${LOCAL_DATA_NAMESPACE}:row:${ref.domain}:${ref.kind}:${ref.id}`;
}

export function getLocalDataCommitPointerKey(domain: LocalDataDomain) {
  return `${LOCAL_DATA_NAMESPACE}:pointer:${domain}`;
}

export function getLocalDataActiveDataSourceKey() {
  return `${LOCAL_DATA_NAMESPACE}:active-data-source`;
}

export function createCompleteLocalDataRow<T>(args: {
  ref: LocalDataRef;
  value: T;
  version: number;
  updatedAt: number;
}): LocalDataCompleteRow<T> {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataRowKey(args.ref),
    ref: args.ref,
    version: args.version,
    updatedAt: args.updatedAt,
    state: 'complete',
    value: args.value
  };
}

export function createUnloadedLocalDataRow(args: {
  ref: LocalDataRef;
  version: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}): LocalDataUnloadedRow {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataRowKey(args.ref),
    ref: args.ref,
    version: args.version,
    updatedAt: args.updatedAt,
    state: 'unloaded',
    meta: args.meta
  };
}

export function createIncompleteLocalDataRow(args: {
  ref: LocalDataRef;
  version: number;
  updatedAt: number;
  reason: string;
  missingKeys?: string[];
  meta?: Record<string, unknown>;
}): LocalDataIncompleteRow {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataRowKey(args.ref),
    ref: args.ref,
    version: args.version,
    updatedAt: args.updatedAt,
    state: 'incomplete',
    reason: args.reason,
    missingKeys: args.missingKeys,
    meta: args.meta
  };
}

export function createTimedOutLocalDataRow(args: {
  ref: LocalDataRef;
  version: number;
  updatedAt: number;
  reason: string;
}): LocalDataTimedOutRow {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataRowKey(args.ref),
    ref: args.ref,
    version: args.version,
    updatedAt: args.updatedAt,
    state: 'timedOut',
    reason: args.reason
  };
}
