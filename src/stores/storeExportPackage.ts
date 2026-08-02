import packageJson from '../../package.json';
import JSZip from 'jszip';
import {
  exportAssetEntries,
  getActiveAssetStorageKey,
  getAssetBlob,
  getAssetPreviewBlob,
  listAssetMeta,
  type AssetExportEntry,
  type StoredAssetMeta
} from '../infrastructure/assetStore';
import { ASSET_BINARY_STORE, ASSET_PREVIEW_STORE, kvGet } from '../infrastructure/persistence';
import type { RuntimePayload } from './runtimeStorePersistence';
import { normalizeRuntimePayload } from './runtimeStorePersistence';
import { readRuntimePayloadFromLocalDataRepositoryIfActive } from './runtimeLocalDataPersistence';
import {
  buildPersonaMemoryDocContentPayload,
  readPersonaMemoryDocContentPayload,
  loadPersonaMemoryReferenceDocsContent,
  stripPersonaMemoryDocContent,
  type PersonaMemoryDocContentPayload
} from './personaMemoryReferenceDocPersistence';
import { assertDocumentLocalDataStrictlyReadableIfActive } from './documentLocalDataPersistence';
import { readPersonaStateFromLocalDataRepositoryIfActive } from './personaLocalDataPersistence';
import type { PersistedCollectionState } from './collectionStorePersistence';
import type { PersistedSpaceState } from './spaceStorePersistence';
import { migratePersistedSpaceState, readPersistedSpaceThemeState } from './spaceStorePersistence';
import { readCompleteLiveChatState } from './chatCurrentPersistence';
import { readCollectionStateFromLocalDataRepositoryIfActive } from './collectionLocalDataPersistence';
import {
  loadWorkspaceReferenceDocsContent
} from './workspaceReferenceDocContentPersistence';
import type { Conversation, Persona } from '../types/domain';
import type { StoreTransferProgressReporter } from './storeImportProgress';

export const SPACE_STORE_KEY = 'polaris-space-store-v1';
export const SPACE_STORE_VERSION = 19;
export const ASSET_INDEX_PATH = 'assets/index.json';
export const PERSONA_MEMORY_DOC_CONTENT_PATH = 'stores/persona-memory-doc-content.json';
export const EXPORT_REPORT_PATH = 'export-report.json';

export type ExportManifest = {
  format: 'polaris-export';
  version: 1;
  createdAt: number;
  appVersion: string;
  stores: {
    space: 'stores/space.json';
    chat: 'stores/chat.json';
    collection: 'stores/collection.json';
    persona: 'stores/persona.json';
    personaMemoryDocContent?: typeof PERSONA_MEMORY_DOC_CONTENT_PATH;
    runtime: 'stores/runtime.json';
  };
  assets: {
    count: number;
    imageCount: number;
    attachmentCount: number;
    index: typeof ASSET_INDEX_PATH;
  };
};

export type AssetIndexEntry = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  textContent?: string;
  filePath: string;
  previewPath?: string;
};

export type ExportReportIssue = {
  severity: 'warning' | 'error';
  kind:
    | 'asset-missing-binary'
    | 'asset-preview-fallback'
    | 'asset-missing-preview'
    | 'asset-bridge-fallback-too-large';
  assetId?: string;
  message: string;
};

export type ExportReport = {
  version: 1;
  createdAt: number;
  issues: ExportReportIssue[];
  assets: {
    indexed: number;
    exported: number;
    skipped: number;
    degraded: number;
  };
};

type ExportChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

type ExportPersonaState = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds?: string[];
};

type ExportPersonaInputs = {
  state: ExportPersonaState;
  existingMemoryDocContent: PersonaMemoryDocContentPayload | null;
};

export type StructuredExportSnapshot = {
  spaceState?: PersistedSpaceState;
  chatState?: ExportChatState;
  collectionState?: PersistedCollectionState;
  personaState?: ExportPersonaState;
  personaMemoryDocContent?: PersonaMemoryDocContentPayload | null;
  runtimeState?: RuntimePayload;
  assetEntries?: AssetExportEntry[];
};

type StructuredExportPackage = {
  blob: Blob;
  fileName: string;
};

type StructuredExportPackageOptions = {
  onProgress?: StoreTransferProgressReporter;
};

type ZipChunk = Uint8Array;

type StructuredExportStreamHandlers = {
  onStart?: (metadata: { fileName: string; mimeType: string }) => void | Promise<void>;
  onChunk: (chunk: ZipChunk) => void | Promise<void>;
  onProgress?: StoreTransferProgressReporter;
};

type StructuredExportEntryStreamHandlers = {
  onStart?: (metadata: { fileName: string; mimeType: string }) => void | Promise<void>;
  onTextEntry: (path: string, text: string) => void | Promise<void>;
  onBinaryEntry: (path: string, blob: Blob) => void | Promise<void>;
  onStoredBinaryEntry?: (storeName: string, key: string, path: string) => boolean | Promise<boolean>;
  onShouldReadPersistedAssetBlob?: (asset: StoredAssetMeta, role: 'primary' | 'preview') => boolean;
  onProgress?: StoreTransferProgressReporter;
};

const EXPORT_MIME_TYPE = 'application/zip';

function padNumber(value: number) {
  return `${value}`.padStart(2, '0');
}

function buildExportTimestamp(now = new Date()) {
  return `${now.getFullYear()}${padNumber(now.getMonth() + 1)}${padNumber(now.getDate())}-${padNumber(now.getHours())}${padNumber(now.getMinutes())}`;
}

function inferExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'application/pdf':
      return 'pdf';
    case 'application/zip':
      return 'zip';
    case 'text/plain':
      return 'txt';
    case 'text/csv':
      return 'csv';
    case 'application/json':
      return 'json';
    default:
      return '';
  }
}

function resolveAssetExtension(name: string, mimeType: string) {
  const match = name.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? (inferExtensionFromMimeType(mimeType) || 'bin');
}

function jsonEntry(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function readPersistedSpaceState(): Promise<PersistedSpaceState> {
  const persistedThemeState = (await readPersistedSpaceThemeState({ integrity: 'strict' }))?.themeState ?? null;
  if (typeof window === 'undefined') {
    return persistedThemeState ? migratePersistedSpaceState(persistedThemeState) : {};
  }

  const rawValue = window.localStorage.getItem(SPACE_STORE_KEY);
  if (!rawValue) {
    return persistedThemeState ? migratePersistedSpaceState(persistedThemeState) : {};
  }

  try {
    const parsed = JSON.parse(rawValue) as { state?: PersistedSpaceState };
    return migratePersistedSpaceState({
      ...(parsed?.state ?? {}),
      ...(persistedThemeState ?? {})
    });
  } catch {
    return persistedThemeState ? migratePersistedSpaceState(persistedThemeState) : {};
  }
}

async function readPersistedChatState(): Promise<ExportChatState> {
  // Export reads the live local-data layer completely so lazily-unloaded conversation bodies
  // are still captured in the backup. It fails loudly rather than packaging an empty chat when
  // the layer cannot be read.
  const state = await readCompleteLiveChatState({ throwOnReadFailure: true });
  return state ?? {
    conversations: [],
    activeConversationId: null
  };
}

async function readPersistedCollectionState(): Promise<PersistedCollectionState> {
  const repositoryState = await readCollectionStateFromLocalDataRepositoryIfActive({ integrity: 'strict' });
  const collectionState = repositoryState ?? {
    cards: [],
    projectFiles: [],
    workspaceReferenceDocs: [],
    roomProjects: [],
    imageCards: [],
    deletedBundledCardIds: []
  };
  return {
    ...collectionState,
    workspaceReferenceDocs: await loadWorkspaceReferenceDocsContent(collectionState.workspaceReferenceDocs)
  };
}

async function readPersistedPersonaInputs(): Promise<ExportPersonaInputs> {
  const repositoryPayload = await readPersonaStateFromLocalDataRepositoryIfActive({ integrity: 'strict' });
  if (repositoryPayload) {
    const state = {
      ...repositoryPayload,
      personas: await loadPersonaMemoryReferenceDocsContent(repositoryPayload.personas)
    };
    return {
      state,
      existingMemoryDocContent: null
    };
  }

  const payload = await kvGet<ExportPersonaState>('persona-state-v2');
  return {
    state: payload ?? {
      personas: [],
      activeCollaboratorId: null,
      seededDefaultPersonaIds: []
    },
    existingMemoryDocContent: await readPersonaMemoryDocContentPayload()
  };
}

async function readPersistedRuntimeState(): Promise<RuntimePayload> {
  const repositoryRead = await readRuntimePayloadFromLocalDataRepositoryIfActive({ integrity: 'strict' });
  if (repositoryRead) return normalizeRuntimePayload(repositoryRead.payload);

  const payload = await kvGet<Partial<RuntimePayload>>('runtime-providers-v2');
  return normalizeRuntimePayload(payload);
}

async function readStructuredExportStores(
  snapshot: StructuredExportSnapshot = {},
  options: StructuredExportPackageOptions = {}
) {
  await assertDocumentLocalDataStrictlyReadableIfActive();
  const now = new Date();
  const timestampLabel = buildExportTimestamp(now);
  options.onProgress?.({ message: '读取对话和设置' });
  const [spaceState, chatState, collectionState, personaInputs, runtimeState] = await Promise.all([
    snapshot.spaceState ? Promise.resolve(snapshot.spaceState) : readPersistedSpaceState(),
    snapshot.chatState ? Promise.resolve(snapshot.chatState) : readPersistedChatState(),
    snapshot.collectionState ? Promise.resolve(snapshot.collectionState) : readPersistedCollectionState(),
    snapshot.personaState
      ? Promise.resolve({
          state: snapshot.personaState,
          existingMemoryDocContent: snapshot.personaMemoryDocContent !== undefined
            ? snapshot.personaMemoryDocContent
            : null
        } satisfies ExportPersonaInputs)
      : readPersistedPersonaInputs(),
    snapshot.runtimeState ? Promise.resolve(snapshot.runtimeState) : readPersistedRuntimeState()
  ]);
  const personaMemoryDocContent = snapshot.personaMemoryDocContent !== undefined
    ? snapshot.personaMemoryDocContent
    : personaInputs.existingMemoryDocContent;

  const exportPersonaMemoryDocContent = buildPersonaMemoryDocContentPayload(
    personaInputs.state.personas,
    personaMemoryDocContent ?? { version: 1, docs: {} }
  );
  const exportPersonaState = {
    ...personaInputs.state,
    personas: stripPersonaMemoryDocContent(personaInputs.state.personas)
  };

  return {
    now,
    timestampLabel,
    spaceState,
    chatState,
    collectionState,
    personaState: exportPersonaState,
    personaMemoryDocContent: exportPersonaMemoryDocContent,
    runtimeState
  };
}

function buildAssetPaths(asset: StoredAssetMeta) {
  const extension = resolveAssetExtension(asset.name, asset.mimeType);
  const assetDir = asset.kind === 'image' ? 'assets/images' : 'assets/attachments';
  return {
    filePath: `${assetDir}/${asset.id}.${extension}`,
    previewPath: asset.kind === 'image' ? `previews/images/${asset.id}.jpg` : undefined
  };
}

function assetIndexEntry(asset: StoredAssetMeta, paths: { filePath: string; previewPath?: string }): AssetIndexEntry {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    createdAt: asset.createdAt,
    textContent: asset.textContent,
    filePath: paths.filePath,
    previewPath: paths.previewPath
  };
}

async function createStructuredExportZip(
  snapshot: StructuredExportSnapshot = {},
  options: StructuredExportPackageOptions = {}
) {
  const zip = new JSZip();
  const stores = await readStructuredExportStores(snapshot, options);
  const assets = snapshot.assetEntries ? await Promise.resolve(snapshot.assetEntries) : await exportAssetEntries();

  zip.file('stores/space.json', jsonEntry(stores.spaceState));
  zip.file('stores/chat.json', jsonEntry(stores.chatState));
  zip.file('stores/collection.json', jsonEntry(stores.collectionState));
  zip.file('stores/persona.json', jsonEntry(stores.personaState));
  zip.file(PERSONA_MEMORY_DOC_CONTENT_PATH, jsonEntry(stores.personaMemoryDocContent));
  zip.file('stores/runtime.json', jsonEntry(stores.runtimeState));

  const assetIndex: AssetIndexEntry[] = [];
  options.onProgress?.({
    message: assets.length > 0 ? '整理附件' : '准备压缩备份',
    current: assets.length > 0 ? 0 : undefined,
    total: assets.length > 0 ? assets.length : undefined
  });
  for (const asset of assets) {
    const { filePath, previewPath } = buildAssetPaths(asset.meta);
    assetIndex.push(assetIndexEntry(asset.meta, { filePath, previewPath }));
    zip.file(filePath, await asset.blob.arrayBuffer());

    if (asset.meta.kind === 'image') {
      zip.file(previewPath!, await (asset.previewBlob ?? asset.blob).arrayBuffer());
    }
    options.onProgress?.({ message: '整理附件', current: assetIndex.length, total: assets.length });
  }

  const manifest: ExportManifest = {
    format: 'polaris-export',
    version: 1,
    createdAt: stores.now.getTime(),
    appVersion: packageJson.version,
    stores: {
      space: 'stores/space.json',
      chat: 'stores/chat.json',
      collection: 'stores/collection.json',
      persona: 'stores/persona.json',
      personaMemoryDocContent: PERSONA_MEMORY_DOC_CONTENT_PATH,
      runtime: 'stores/runtime.json'
    },
    assets: {
      count: assets.length,
      imageCount: assets.filter((asset) => asset.meta.kind === 'image').length,
      attachmentCount: assets.filter((asset) => asset.meta.kind === 'file').length,
      index: ASSET_INDEX_PATH
    }
  };

  zip.file('manifest.json', jsonEntry(manifest));
  zip.file(ASSET_INDEX_PATH, jsonEntry(assetIndex));
  options.onProgress?.({ message: '准备压缩备份' });

  return {
    zip,
    fileName: `polaris-export-${stores.timestampLabel}.zip`
  };
}

export async function buildStructuredExportPackage(
  snapshot: StructuredExportSnapshot = {},
  options: StructuredExportPackageOptions = {}
): Promise<StructuredExportPackage> {
  const { zip, fileName } = await createStructuredExportZip(snapshot, options);
  options.onProgress?.({ message: '压缩备份', current: 0, total: 100 });
  return {
    blob: await zip.generateAsync(
      { type: 'blob', streamFiles: true, mimeType: EXPORT_MIME_TYPE },
      (metadata) => options.onProgress?.({
        message: '压缩备份',
        current: Math.round(metadata.percent),
        total: 100
      })
    ),
    fileName
  };
}

export async function streamStructuredExportPackage(
  snapshot: StructuredExportSnapshot = {},
  handlers: StructuredExportStreamHandlers
): Promise<{ fileName: string }> {
  const { zip, fileName } = await createStructuredExportZip(snapshot, { onProgress: handlers.onProgress });
  await handlers.onStart?.({ fileName, mimeType: EXPORT_MIME_TYPE });
  handlers.onProgress?.({ message: '压缩备份', current: 0, total: 100 });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      streamFiles: true,
      mimeType: EXPORT_MIME_TYPE
    });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    stream
      .on('data', (chunk, metadata) => {
        handlers.onProgress?.({
          message: '压缩备份',
          current: Math.round(metadata.percent),
          total: 100
        });
        stream.pause();
        Promise.resolve(handlers.onChunk(chunk))
          .then(() => {
            if (!settled) {
              stream.resume();
            }
          })
          .catch(fail);
      })
      .on('error', fail)
      .on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      })
      .resume();
  });

  return { fileName };
}

async function writeBlobEntry(
  handlers: StructuredExportEntryStreamHandlers,
  path: string,
  blob: Blob
) {
  await handlers.onBinaryEntry(path, blob);
}

async function writeStoredBinaryEntry(
  handlers: StructuredExportEntryStreamHandlers,
  storeName: string,
  key: string,
  path: string
) {
  return handlers.onStoredBinaryEntry
    ? await handlers.onStoredBinaryEntry(storeName, key, path)
    : false;
}

function shouldReadPersistedAssetBlob(
  handlers: StructuredExportEntryStreamHandlers,
  asset: StoredAssetMeta,
  role: 'primary' | 'preview'
) {
  return handlers.onShouldReadPersistedAssetBlob?.(asset, role) ?? true;
}

async function streamSnapshotAssetEntries(
  assetEntries: AssetExportEntry[],
  handlers: StructuredExportEntryStreamHandlers,
  assetIndex: AssetIndexEntry[],
  report: ExportReport
) {
  handlers.onProgress?.({
    message: assetEntries.length > 0 ? '整理附件' : '准备压缩备份',
    current: assetEntries.length > 0 ? 0 : undefined,
    total: assetEntries.length > 0 ? assetEntries.length : undefined
  });
  for (let index = 0; index < assetEntries.length; index += 1) {
    const asset = assetEntries[index]!;
    const paths = buildAssetPaths(asset.meta);
    assetIndex.push(assetIndexEntry(asset.meta, paths));
    await writeBlobEntry(handlers, paths.filePath, asset.blob);
    if (paths.previewPath) {
      await writeBlobEntry(handlers, paths.previewPath, asset.previewBlob ?? asset.blob);
    }
    report.assets.exported += 1;
    handlers.onProgress?.({ message: '整理附件', current: index + 1, total: assetEntries.length });
  }
}

async function streamPersistedAssets(
  handlers: StructuredExportEntryStreamHandlers,
  assetIndex: AssetIndexEntry[],
  report: ExportReport
) {
  const assets = await listAssetMeta({ integrity: 'strict' });
  report.assets.indexed = assets.length;
  handlers.onProgress?.({
    message: assets.length > 0 ? '整理附件' : '准备压缩备份',
    current: assets.length > 0 ? 0 : undefined,
    total: assets.length > 0 ? assets.length : undefined
  });

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]!;
    const paths = buildAssetPaths(asset);
    const storageKey = await getActiveAssetStorageKey(asset.id);
    const wroteBinary = await writeStoredBinaryEntry(handlers, ASSET_BINARY_STORE, storageKey, paths.filePath);
    const canReadPrimaryBlob = shouldReadPersistedAssetBlob(handlers, asset, 'primary');
    let blob: Blob | null = wroteBinary || !canReadPrimaryBlob ? null : await getAssetBlob(asset.id);
    let previewBlob: Blob | null = null;
    let wrotePreviewAsBinary = false;

    if (!wroteBinary && !blob && asset.kind === 'image') {
      wrotePreviewAsBinary = await writeStoredBinaryEntry(handlers, ASSET_PREVIEW_STORE, storageKey, paths.filePath);
      if (!wrotePreviewAsBinary) {
        previewBlob = shouldReadPersistedAssetBlob(handlers, asset, 'preview')
          ? await getAssetPreviewBlob(asset.id)
          : null;
      }
    }

    const exportBlob = blob ?? previewBlob;
    if (!wroteBinary && !wrotePreviewAsBinary && !exportBlob) {
      report.assets.skipped += 1;
      const skippedLargeBridgeFallback = !canReadPrimaryBlob;
      report.issues.push({
        severity: 'error',
        kind: skippedLargeBridgeFallback ? 'asset-bridge-fallback-too-large' : 'asset-missing-binary',
        assetId: asset.id,
        message: skippedLargeBridgeFallback
          ? `资产 ${asset.id} 只剩需要跨桥读取的大文件内容，Android 导出为避免内存崩溃已跳过。`
          : `资产 ${asset.id} 缺少原图/文件内容，已跳过。`
      });
      handlers.onProgress?.({ message: '整理附件', current: index + 1, total: assets.length });
      continue;
    }
    if (!wroteBinary && !blob && (wrotePreviewAsBinary || previewBlob)) {
      report.assets.degraded += 1;
      report.issues.push({
        severity: 'warning',
        kind: 'asset-preview-fallback',
        assetId: asset.id,
        message: `资产 ${asset.id} 缺少原图，已用预览图导出。`
      });
    }

    assetIndex.push(assetIndexEntry(asset, paths));
    if (!wroteBinary && !wrotePreviewAsBinary && exportBlob) {
      await writeBlobEntry(handlers, paths.filePath, exportBlob);
    }
    if (paths.previewPath) {
      const wrotePreview = await writeStoredBinaryEntry(handlers, ASSET_PREVIEW_STORE, storageKey, paths.previewPath);
      if (wrotePreview) {
        // NativePersistence streamed the preview directly into the ZIP.
      } else if (previewBlob) {
        await writeBlobEntry(handlers, paths.previewPath, previewBlob);
      } else {
        const wroteBinaryAsPreview = await writeStoredBinaryEntry(handlers, ASSET_BINARY_STORE, storageKey, paths.previewPath);
        report.issues.push({
          severity: 'warning',
          kind: 'asset-missing-preview',
          assetId: asset.id,
          message: `图片资产 ${asset.id} 缺少预览，已用原图作为预览导出。`
        });
        if (!wroteBinaryAsPreview && exportBlob) {
          await writeBlobEntry(handlers, paths.previewPath, exportBlob);
        }
      }
    }
    report.assets.exported += 1;
    handlers.onProgress?.({ message: '整理附件', current: index + 1, total: assets.length });
  }
}

export async function streamStructuredExportPackageEntries(
  snapshot: StructuredExportSnapshot = {},
  handlers: StructuredExportEntryStreamHandlers
): Promise<{ fileName: string; report: ExportReport }> {
  const stores = await readStructuredExportStores(snapshot, { onProgress: handlers.onProgress });
  const fileName = `polaris-export-${stores.timestampLabel}.zip`;
  await handlers.onStart?.({ fileName, mimeType: EXPORT_MIME_TYPE });

  await handlers.onTextEntry('stores/space.json', jsonEntry(stores.spaceState));
  await handlers.onTextEntry('stores/chat.json', jsonEntry(stores.chatState));
  await handlers.onTextEntry('stores/collection.json', jsonEntry(stores.collectionState));
  await handlers.onTextEntry('stores/persona.json', jsonEntry(stores.personaState));
  await handlers.onTextEntry(PERSONA_MEMORY_DOC_CONTENT_PATH, jsonEntry(stores.personaMemoryDocContent));
  await handlers.onTextEntry('stores/runtime.json', jsonEntry(stores.runtimeState));

  const assetIndex: AssetIndexEntry[] = [];
  const report: ExportReport = {
    version: 1,
    createdAt: stores.now.getTime(),
    issues: [],
    assets: {
      indexed: snapshot.assetEntries?.length ?? 0,
      exported: 0,
      skipped: 0,
      degraded: 0
    }
  };

  if (snapshot.assetEntries) {
    await streamSnapshotAssetEntries(snapshot.assetEntries, handlers, assetIndex, report);
  } else {
    await streamPersistedAssets(handlers, assetIndex, report);
  }

  const manifest: ExportManifest = {
    format: 'polaris-export',
    version: 1,
    createdAt: stores.now.getTime(),
    appVersion: packageJson.version,
    stores: {
      space: 'stores/space.json',
      chat: 'stores/chat.json',
      collection: 'stores/collection.json',
      persona: 'stores/persona.json',
      personaMemoryDocContent: PERSONA_MEMORY_DOC_CONTENT_PATH,
      runtime: 'stores/runtime.json'
    },
    assets: {
      count: assetIndex.length,
      imageCount: assetIndex.filter((asset) => asset.kind === 'image').length,
      attachmentCount: assetIndex.filter((asset) => asset.kind === 'file').length,
      index: ASSET_INDEX_PATH
    }
  };

  await handlers.onTextEntry('manifest.json', jsonEntry(manifest));
  await handlers.onTextEntry(ASSET_INDEX_PATH, jsonEntry(assetIndex));
  await handlers.onTextEntry(EXPORT_REPORT_PATH, jsonEntry(report));
  handlers.onProgress?.({ message: '备份写入完成' });

  return { fileName, report };
}
