import {
  recoverPendingAssetImportStage,
  stageAssetImportEntries,
  type AssetExportEntry,
  type StoredAssetMeta
} from '../infrastructure/assetStore';
import { flushPageLifecycleHandlers } from '../infrastructure/pageLifecycleFlush';
import type { PersistedChatState } from './chatCurrentPersistence';
import type { PersistedCollectionState } from './collectionStorePersistence';
import {
  type PersonaMemoryDocContentPayload
} from './personaMemoryReferenceDocPersistence';
import type { RuntimePayload } from './runtimeStorePersistence';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import type { PersistedSpaceState } from './spaceStorePersistence';
import {
  migratePersistedSpaceState,
  serializePersistedSpaceLocalState
} from './spaceStorePersistence';
import { normalizeAppCustomization } from './runtimeStoreCustomization';
import { migrateLegacyProjectCards } from './collectionStoreProjectFiles';
import { normalizeWorkspaceReferenceDoc } from './collectionStoreWorkspaceReferences';
import { repairCollectionProjectTopology } from './collectionStoreProjectTopology';
import { applyImportedPersistedStores } from './storeImportApply';
import { clearLegacyLocalDataKvShadowIfStoreBackendInstalled } from './localDataLegacyKvShadowCleanup';
import { restoreStructuredImportToLocalDataRepository } from './storeImportLocalDataRestore';
import {
  ASSET_INDEX_PATH,
  PERSONA_MEMORY_DOC_CONTENT_PATH,
  SPACE_STORE_KEY,
  SPACE_STORE_VERSION,
  type AssetIndexEntry,
  type ExportManifest,
  type StructuredExportSnapshot
} from './storeExportPackage';
import type { StoreImportProgressReporter } from './storeImportProgress';
import type { Persona, ProjectFile, WorkspaceReferenceDoc } from '../types/domain';
import type { StoreImportDomainFailure, StoreImportResult } from './storeImportResult';
import { fingerprintDiagnosticId, reportPersistenceError } from '../infrastructure/persistenceDiagnostics';

const LOCAL_STORAGE_PREFIX = 'polaris';
const ASSET_READ_CONCURRENCY = 4;

type ImportStructuredExportPackageOptions = {
  onProgress?: StoreImportProgressReporter;
};

type PersistedPersonaState = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  editingCollaboratorId?: string | null;
  seededDefaultPersonaIds?: string[];
};

type ZipTextOrBlobFile = {
  async: (type: 'string' | 'blob') => Promise<string | Blob>;
};

type ZipReader = {
  file: (path: string) => ZipTextOrBlobFile | null;
};

export type ImportLocalStorageEntry = {
  key: string;
  value: string;
};

function restoreFailureReason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readPolarisLocalStorage(): ImportLocalStorageEntry[] {
  if (typeof window === 'undefined') return [];
  const entries: ImportLocalStorageEntry[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(LOCAL_STORAGE_PREFIX)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) entries.push({ key, value });
    }
  }
  return entries;
}

function replacePolarisLocalStorage(entries: ImportLocalStorageEntry[]) {
  if (typeof window === 'undefined') return;
  const previous = entries.map(({ key }) => ({ key, value: window.localStorage.getItem(key) }));
  try {
    for (const entry of entries) {
      window.localStorage.setItem(entry.key, entry.value);
    }
  } catch (error) {
    try {
      for (const entry of previous) {
        if (entry.value === null) window.localStorage.removeItem(entry.key);
        else window.localStorage.setItem(entry.key, entry.value);
      }
    } catch (rollbackError) {
      throw new Error(`localStorage 写入失败且旧值恢复失败：${String(rollbackError)}；原始错误：${String(error)}`);
    }
    throw error;
  }
}

function restorePolarisLocalStorageSnapshot(
  entries: ImportLocalStorageEntry[],
  touchedKeys: string[]
) {
  if (typeof window === 'undefined') return;
  for (const key of touchedKeys) window.localStorage.removeItem(key);
  for (const entry of entries) window.localStorage.setItem(entry.key, entry.value);
}

async function refreshImportedStoresBestEffort() {
  try {
    await applyImportedPersistedStores();
    return null;
  } catch (error) {
    // Persisted data is already replaced; the next hydration pass can read it again.
    return error instanceof Error ? error.message : String(error);
  }
}

function parseJsonFile<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${label} 格式不正确`);
  }
}

function ensureObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 缺少或格式不正确`);
  }
}

function validateManifest(value: unknown): ExportManifest {
  ensureObject(value, 'manifest');
  const manifest = value as Partial<ExportManifest>;
  if (manifest.format !== 'polaris-export' || manifest.version !== 1) {
    throw new Error('这不是 Polaris 的正式导出包');
  }
  if (
    manifest.stores?.space !== 'stores/space.json'
    || manifest.stores?.chat !== 'stores/chat.json'
    || manifest.stores?.collection !== 'stores/collection.json'
    || manifest.stores?.persona !== 'stores/persona.json'
    || (
      manifest.stores?.personaMemoryDocContent !== undefined
      && manifest.stores.personaMemoryDocContent !== PERSONA_MEMORY_DOC_CONTENT_PATH
    )
    || manifest.stores?.runtime !== 'stores/runtime.json'
  ) {
    throw new Error('导出包缺少必要 stores 索引');
  }
  if (manifest.assets?.index !== ASSET_INDEX_PATH) {
    throw new Error('导出包缺少资产索引');
  }
  return manifest as ExportManifest;
}

function validateSpaceState(value: unknown): PersistedSpaceState {
  ensureObject(value, 'space store');
  return value as PersistedSpaceState;
}

function validateChatState(value: unknown): PersistedChatState {
  ensureObject(value, 'chat store');
  const payload = value as Partial<PersistedChatState>;
  if (!Array.isArray(payload.conversations)) {
    throw new Error('chat store 缺少 conversations');
  }
  for (const conversation of payload.conversations) {
    ensureObject(conversation, 'chat conversation');
    if (typeof conversation.id !== 'string' || !conversation.id.trim() || !Array.isArray(conversation.messages)) {
      throw new Error('chat conversation 缺少 id 或 messages');
    }
    for (const message of conversation.messages) {
      ensureObject(message, 'chat message');
      if (typeof message.id !== 'string' || typeof message.role !== 'string' || typeof message.content !== 'string') {
        throw new Error('chat message 缺少必要字段');
      }
    }
  }
  return {
    conversations: payload.conversations,
    activeConversationId:
      typeof payload.activeConversationId === 'string' || payload.activeConversationId === null
        ? payload.activeConversationId
        : null,
    loadedConversationIds: Array.isArray(payload.loadedConversationIds)
      ? payload.loadedConversationIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    recoveredConversationIds: Array.isArray(payload.recoveredConversationIds)
      ? payload.recoveredConversationIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    quarantinedConversationIds: Array.isArray(payload.quarantinedConversationIds)
      ? payload.quarantinedConversationIds.filter((id): id is string => typeof id === 'string')
      : undefined
  };
}

function validateCollectionState(value: unknown): PersistedCollectionState {
  ensureObject(value, 'collection store');
  const payload = value as Partial<PersistedCollectionState> & { activeCardId?: string | null };
  if (!Array.isArray(payload.cards) || !Array.isArray(payload.imageCards)) {
    throw new Error('collection store 缺少必要字段');
  }
  for (const [label, entries] of Object.entries({
    cards: payload.cards,
    imageCards: payload.imageCards,
    projectFiles: payload.projectFiles ?? [],
    workspaceReferenceDocs: payload.workspaceReferenceDocs ?? [],
    roomProjects: payload.roomProjects ?? []
  })) {
    if (!Array.isArray(entries)) throw new Error(`collection store ${label} 格式不正确`);
    for (const entry of entries) {
      ensureObject(entry, `collection ${label} entry`);
      if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error(`collection ${label} 缺少 id`);
    }
  }
  const migrated = migrateLegacyProjectCards({
    cards: payload.cards,
    projectFiles: Array.isArray(payload.projectFiles) ? payload.projectFiles as ProjectFile[] : []
  });
  return repairCollectionProjectTopology({
    cards: migrated.cards,
    projectFiles: migrated.projectFiles,
    workspaceReferenceDocs: Array.isArray(payload.workspaceReferenceDocs)
      ? (payload.workspaceReferenceDocs as WorkspaceReferenceDoc[])
          .map((doc) => normalizeWorkspaceReferenceDoc(doc))
          .filter((doc) => doc.projectId)
      : [],
    roomProjects: Array.isArray(payload.roomProjects) ? payload.roomProjects : [],
    imageCards: payload.imageCards,
    deletedBundledCardIds: Array.isArray(payload.deletedBundledCardIds)
      ? payload.deletedBundledCardIds.filter((id): id is string => typeof id === 'string')
      : []
  });
}

function validatePersonaState(value: unknown): PersistedPersonaState {
  ensureObject(value, 'persona store');
  const payload = value as Partial<PersistedPersonaState>;
  if (!Array.isArray(payload.personas)) {
    throw new Error('persona store 缺少 personas');
  }
  for (const persona of payload.personas) {
    ensureObject(persona, 'persona');
    if (typeof persona.id !== 'string' || !persona.id.trim() || typeof persona.name !== 'string') {
      throw new Error('persona store 包含无效协作者');
    }
  }
  return {
    personas: payload.personas,
    activeCollaboratorId:
      typeof payload.activeCollaboratorId === 'string' || payload.activeCollaboratorId === null
        ? payload.activeCollaboratorId
        : null,
    editingCollaboratorId:
      typeof payload.editingCollaboratorId === 'string' || payload.editingCollaboratorId === null
        ? payload.editingCollaboratorId
        : undefined,
    seededDefaultPersonaIds: Array.isArray(payload.seededDefaultPersonaIds)
      ? payload.seededDefaultPersonaIds.filter((id): id is string => typeof id === 'string')
      : undefined
  };
}

function validatePersonaMemoryDocContent(value: unknown): PersonaMemoryDocContentPayload {
  ensureObject(value, 'persona memory doc content');
  const payload = value as Partial<PersonaMemoryDocContentPayload>;
  return {
    version: 1,
    docs: payload.docs && typeof payload.docs === 'object' && !Array.isArray(payload.docs)
      ? Object.fromEntries(
          Object.entries(payload.docs)
            .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
        )
      : {}
  };
}

function validateRuntimeState(value: unknown): RuntimePayload {
  ensureObject(value, 'runtime store');
  const payload = value as Partial<RuntimePayload>;
  if (!Array.isArray(payload.providers)) {
    throw new Error('runtime store 缺少 providers');
  }
  for (const provider of payload.providers) {
    ensureObject(provider, 'runtime provider');
    if (typeof provider.id !== 'string' || !provider.id.trim()) throw new Error('runtime provider 缺少 id');
  }
  return normalizeRuntimePayload(payload);
}

function validateAssetIndex(value: unknown): AssetIndexEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('资产索引格式不正确');
  }

  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  return value.map((entry) => {
    ensureObject(entry, '资产索引项');
    const asset = entry as Partial<AssetIndexEntry>;
    if (
      typeof asset.id !== 'string'
      || (asset.kind !== 'image' && asset.kind !== 'file')
      || typeof asset.name !== 'string'
      || typeof asset.mimeType !== 'string'
      || typeof asset.filePath !== 'string'
      || asset.id.trim().length === 0
      || asset.filePath.trim().length === 0
      || typeof asset.size !== 'number'
      || !Number.isFinite(asset.size)
      || asset.size < 0
    ) {
      throw new Error('资产索引缺少必要字段');
    }
    const previewPath = typeof asset.previewPath === 'string' ? asset.previewPath : undefined;
    if (
      assetIds.has(asset.id)
      || assetPaths.has(asset.filePath)
      || (previewPath !== undefined && assetPaths.has(previewPath))
    ) {
      throw new Error('资产索引包含重复 id 或文件路径');
    }
    assetIds.add(asset.id);
    assetPaths.add(asset.filePath);
    if (previewPath) assetPaths.add(previewPath);
    return {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
      createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
      textContent: typeof asset.textContent === 'string' ? asset.textContent : undefined,
      filePath: asset.filePath,
      previewPath
    };
  });
}

async function readZipTextFile(zip: ZipReader, path: string, label: string) {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`导出包缺少 ${label}`);
  }
  return await file.async('string') as string;
}

async function readZipBlobFile(zip: ZipReader, path: string, label: string) {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`导出包缺少 ${label}`);
  }
  return await file.async('blob') as Blob;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function readAssetEntriesFromExportZip(
  zip: ZipReader,
  assetIndex: AssetIndexEntry[],
  onProgress?: StoreImportProgressReporter
) {
  let completedAssetReads = 0;
  onProgress?.({
    message: assetIndex.length > 0 ? '读取附件' : '准备写入数据',
    current: assetIndex.length > 0 ? 0 : undefined,
    total: assetIndex.length > 0 ? assetIndex.length : undefined
  });
  return await mapWithConcurrency(
    assetIndex,
    ASSET_READ_CONCURRENCY,
    async (asset): Promise<AssetExportEntry> => {
      const entry = {
        meta: {
          id: asset.id,
          kind: asset.kind,
          name: asset.name,
          mimeType: asset.mimeType,
          size: asset.size,
          createdAt: asset.createdAt,
          textContent: asset.textContent
        } satisfies StoredAssetMeta,
        blob: await readZipBlobFile(zip, asset.filePath, asset.filePath),
        previewBlob: asset.previewPath ? await readZipBlobFile(zip, asset.previewPath, asset.previewPath) : null
      };
      if (entry.blob.size !== asset.size) {
        throw new Error(`附件 ${asset.id} 的大小与资产索引不一致`);
      }
      completedAssetReads += 1;
      onProgress?.({ message: '读取附件', current: completedAssetReads, total: assetIndex.length });
      return entry;
    }
  );
}

export async function importStructuredExportPackage(
  file: Blob,
  options: ImportStructuredExportPackageOptions = {}
): Promise<StoreImportResult> {
  const { default: JSZip } = await import('jszip');
  options.onProgress?.({ message: '读取备份包' });
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  options.onProgress?.({ message: '解析备份结构' });
  const manifest = validateManifest(
    parseJsonFile(await readZipTextFile(zip, 'manifest.json', 'manifest.json'), 'manifest.json')
  );
  const spaceState = validateSpaceState(
    parseJsonFile(await readZipTextFile(zip, manifest.stores.space, manifest.stores.space), manifest.stores.space)
  );
  const collectionStateContent = await readZipTextFile(zip, manifest.stores.collection, manifest.stores.collection);
  const parsedCollectionState = parseJsonFile<Partial<PersistedCollectionState> & { activeCardId?: string | null }>(
    collectionStateContent,
    manifest.stores.collection
  );
  const chatState = validateChatState(
    parseJsonFile(await readZipTextFile(zip, manifest.stores.chat, manifest.stores.chat), manifest.stores.chat)
  );
  const collectionState = validateCollectionState(
    parsedCollectionState
  );
  const personaState = validatePersonaState(
    parseJsonFile(await readZipTextFile(zip, manifest.stores.persona, manifest.stores.persona), manifest.stores.persona)
  );
  const personaMemoryDocContent = manifest.stores.personaMemoryDocContent
    ? validatePersonaMemoryDocContent(
        parseJsonFile(
          await readZipTextFile(zip, manifest.stores.personaMemoryDocContent, manifest.stores.personaMemoryDocContent),
          manifest.stores.personaMemoryDocContent
        )
      )
    : null;
  const runtimeState = validateRuntimeState(
    parseJsonFile(await readZipTextFile(zip, manifest.stores.runtime, manifest.stores.runtime), manifest.stores.runtime)
  );
  const parsedRuntimeState = parseJsonFile<Partial<RuntimePayload> & {
    screenshotDebugOverlayEnabled?: boolean;
    customization?: Partial<PersistedSpaceState['customization']>;
  }>(
    await readZipTextFile(zip, manifest.stores.runtime, manifest.stores.runtime),
    manifest.stores.runtime
  );
  const assetIndex = validateAssetIndex(
    parseJsonFile(await readZipTextFile(zip, manifest.assets.index, manifest.assets.index), manifest.assets.index)
  );

  if (assetIndex.length !== manifest.assets.count) {
    throw new Error('导出包资产数量不一致');
  }

  const assetEntries = await readAssetEntriesFromExportZip(zip, assetIndex, options.onProgress);

  const importedActiveCardId = typeof parsedCollectionState.activeCardId === 'string'
    ? parsedCollectionState.activeCardId
    : null;
  const importedSpaceState = {
    ...spaceState,
    editingCollaboratorId:
      typeof spaceState.editingCollaboratorId === 'string' || spaceState.editingCollaboratorId === null
        ? spaceState.editingCollaboratorId
        : typeof personaState.editingCollaboratorId === 'string' || personaState.editingCollaboratorId === null
          ? personaState.editingCollaboratorId
          : null,
    screenshotDebugOverlayEnabled:
      typeof spaceState.screenshotDebugOverlayEnabled === 'boolean'
        ? spaceState.screenshotDebugOverlayEnabled
        : parsedRuntimeState.screenshotDebugOverlayEnabled === true,
    customization:
      spaceState.customization
        ? normalizeAppCustomization(spaceState.customization)
        : normalizeAppCustomization(parsedRuntimeState.customization),
    activeCardId: typeof spaceState.activeCardId === 'string' ? spaceState.activeCardId : importedActiveCardId
  } satisfies PersistedSpaceState;
  const migratedSpaceState = migratePersistedSpaceState(importedSpaceState);
  return await importStructuredExportSnapshot({
    chatState,
    collectionState,
    personaState,
    personaMemoryDocContent,
    runtimeState,
    spaceState: migratedSpaceState,
    assetEntries
  }, options);
}

function validateStructuredAssetEntries(value: unknown): AssetExportEntry[] {
  if (!Array.isArray(value)) throw new Error('备份缺少附件清单');
  const ids = new Set<string>();
  return value.map((entry) => {
    ensureObject(entry, '附件');
    const asset = entry as Partial<AssetExportEntry>;
    ensureObject(asset.meta, '附件元数据');
    if (
      typeof asset.meta.id !== 'string'
      || asset.meta.id.trim().length === 0
      || (asset.meta.kind !== 'image' && asset.meta.kind !== 'file')
      || typeof asset.meta.name !== 'string'
      || typeof asset.meta.mimeType !== 'string'
      || typeof asset.meta.size !== 'number'
      || !Number.isFinite(asset.meta.size)
      || asset.meta.size < 0
      || !(asset.blob instanceof Blob)
      || (asset.previewBlob !== null && !(asset.previewBlob instanceof Blob))
    ) {
      throw new Error('附件数据不完整');
    }
    if (ids.has(asset.meta.id)) throw new Error('附件清单包含重复 id');
    if (asset.blob.size !== asset.meta.size) throw new Error(`附件 ${asset.meta.id} 的大小不一致`);
    ids.add(asset.meta.id);
    return asset as AssetExportEntry;
  });
}

export async function importStructuredExportSnapshot(
  snapshot: StructuredExportSnapshot,
  options: ImportStructuredExportPackageOptions = {}
): Promise<StoreImportResult> {
  ensureObject(snapshot, '备份快照');
  const spaceState = migratePersistedSpaceState(validateSpaceState(snapshot.spaceState));
  const chatState = validateChatState(snapshot.chatState);
  const collectionState = validateCollectionState(snapshot.collectionState);
  const personaState = validatePersonaState(snapshot.personaState);
  const personaMemoryDocContent = snapshot.personaMemoryDocContent === null
    ? null
    : validatePersonaMemoryDocContent(snapshot.personaMemoryDocContent);
  const runtimeState = validateRuntimeState(snapshot.runtimeState);
  const assetEntries = validateStructuredAssetEntries(snapshot.assetEntries);

  options.onProgress?.({ message: '收束未保存数据' });
  await flushPageLifecycleHandlers();

  const failures: StoreImportDomainFailure[] = [];
  const skipDomains: Array<'space' | 'asset'> = [];
  const importCommittedAt = Date.now();
  const assetCommitId = `import-asset-${importCommittedAt}`;
  const previousLocalStorage = readPolarisLocalStorage();
  const importedLocalStorageEntries: ImportLocalStorageEntry[] = [{
    key: SPACE_STORE_KEY,
    value: JSON.stringify({
      state: serializePersistedSpaceLocalState(spaceState),
      version: SPACE_STORE_VERSION
    })
  }];
  let localStorageApplied = false;
  try {
    replacePolarisLocalStorage(importedLocalStorageEntries);
    localStorageApplied = true;
  } catch (error) {
    skipDomains.push('space');
    failures.push({
      domain: 'space',
      stage: 'local-storage',
      reason: restoreFailureReason(error)
    });
  }

  let assetStage: Awaited<ReturnType<typeof stageAssetImportEntries>> | null = null;
  options.onProgress?.({
    message: assetEntries.length > 0 ? '写入附件' : '刷新导入结果',
    current: assetEntries.length > 0 ? 0 : undefined,
    total: assetEntries.length > 0 ? assetEntries.length : undefined
  });
  try {
    assetStage = await stageAssetImportEntries(assetEntries, {
      assetCommitId,
      onProgress: (current, total) => options.onProgress?.({ message: '写入附件', current, total })
    });
  } catch (error) {
    skipDomains.push('asset');
    failures.push({
      domain: 'asset',
      stage: 'asset-staging',
      reason: restoreFailureReason(error)
    });
    try {
      await recoverPendingAssetImportStage();
    } catch {
      // The durable manifest remains for startup recovery.
    }
  }

  options.onProgress?.({ message: '重建当前数据库' });
  const restoreResult = await restoreStructuredImportToLocalDataRepository({
    chatState,
    collectionState,
    personaState,
    personaMemoryDocContent,
    runtimeState,
    spaceState,
    assetEntries: assetStage?.entries ?? []
  }, { skipDomains, committedAt: importCommittedAt });

  for (const skipped of restoreResult.skippedDomains) {
    if (skipDomains.includes(skipped.domain as 'space' | 'asset')) continue;
    failures.push({ domain: skipped.domain, stage: 'domain-commit', reason: skipped.reason });
  }
  for (const skipped of restoreResult.promotionSkippedDomains) {
    failures.push({
      domain: skipped.domain,
      stage: 'promotion',
      reason: `${skipped.status}: ${skipped.reasons.join(', ')}`
    });
  }
  if (restoreResult.promotionFailure) {
    for (const domain of restoreResult.restoredDomains) {
      failures.push({ domain, stage: 'promotion', reason: restoreResult.promotionFailure });
    }
  }

  if (localStorageApplied && !restoreResult.restoredDomains.includes('space')) {
    restorePolarisLocalStorageSnapshot(
      previousLocalStorage,
      importedLocalStorageEntries.map((entry) => entry.key)
    );
  }
  if (assetStage) {
    try {
      await recoverPendingAssetImportStage();
    } catch (error) {
      failures.push({
        domain: 'asset',
        stage: 'cleanup',
        reason: restoreFailureReason(error)
      });
    }
  }

  if (restoreResult.restoredDomains.length === 7 && failures.length === 0) {
    await clearLegacyLocalDataKvShadowIfStoreBackendInstalled();
  }
  options.onProgress?.({ message: '刷新导入结果' });
  const refreshFailure = await refreshImportedStoresBestEffort();
  if (refreshFailure) {
    failures.push({ domain: 'runtime', stage: 'refresh', reason: refreshFailure });
  }
  const importedDomains = restoreResult.restoredDomains;
  for (const failure of failures) {
    reportPersistenceError({
      label: '[store:import]',
      store: 'import',
      operation: 'import-domain-failed',
      domain: failure.domain === 'localStorage' ? undefined : failure.domain,
      stage: failure.stage,
      integrity: 'failed',
      rowCount: 0,
      fingerprint: fingerprintDiagnosticId(`${failure.domain}:${failure.stage}:${failure.reason}`)
    }, new Error(`Import ${failure.domain} failed during ${failure.stage}.`));
  }
  return {
    status: failures.length === 0 ? 'complete' : 'partial',
    importedDomains,
    retainedDomains: failures
  };
}
