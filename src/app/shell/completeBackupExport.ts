import {
  appendExportFileChunkViaSystemFiles,
  addZipNativePersistenceBinaryEntryViaSystemFiles,
  addZipTextEntryViaSystemFiles,
  appendZipBinaryChunkViaSystemFiles,
  beginZipBinaryEntryViaSystemFiles,
  beginZipExportViaSystemFiles,
  beginExportFileViaSystemFiles,
  canStreamNativeZipBackupFiles,
  canStreamNativeSystemBackupFiles,
  canUseNativeSystemBackupFiles,
  cancelExportFileViaSystemFiles,
  cancelZipExportViaSystemFiles,
  exportFileViaSystemFiles,
  finishZipBinaryEntryViaSystemFiles,
  finishZipExportViaSystemFiles,
  finishExportFileViaSystemFiles,
  getSystemBackupAvailability
} from '../../native/systemBackupFiles';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { loadWorkspaceReferenceDocsContent } from '../../stores/workspaceReferenceDocContentPersistence';
import { usePersonaStore } from '../../stores/personaStore';
import { serializePersistedSpaceState } from '../../stores/spaceStorePersistence';
import { useRuntimeStore } from '../../stores/runtimeStore';
import type { RuntimePayload } from '../../stores/runtimeStorePersistence';
import { useSpaceStore } from '../../stores/spaceStore';
import {
  buildStructuredExportPackage,
  streamStructuredExportPackageEntries,
  streamStructuredExportPackage,
  type StructuredExportSnapshot
} from '../../stores/storeExportPackage';
import type { StoreTransferProgressReporter } from '../../stores/storeImportProgress';
import { shouldReadPersistedAssetBlobDuringAndroidNativeZip } from './androidNativeZipExportPolicy';

const NATIVE_EXPORT_CHUNK_BYTES = 512 * 1024;
const NATIVE_ZIP_ENTRY_CHUNK_BYTES = 256 * 1024;

export type CompleteBackupExportTarget = 'browser-download' | 'native-file' | 'native-stream';

export type CompleteBackupExportOptions = {
  onProgress?: StoreTransferProgressReporter;
  downloadFile: (blob: Blob, fileName: string) => void | Promise<void>;
};

export function formatCompleteBackupExportError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/SystemFile/i.test(message) || /not implemented on ios/i.test(message)) {
    return '当前 App 版暂时无法使用本地备份包，请先使用 WebDAV 导出备份包。';
  }
  return message || '导出备份包失败';
}

export function buildCurrentExportSnapshot(): StructuredExportSnapshot {
  const spaceState = useSpaceStore.getState();
  const collectionState = useCollectionStore.getState();
  const personaState = usePersonaStore.getState();
  const runtimeState = useRuntimeStore.getState();
  const runtimeSnapshot: RuntimePayload = {
    providers: runtimeState.providers,
    activeProviderId: runtimeState.activeProviderId,
    webdav: runtimeState.webdav,
    search: runtimeState.search,
    conversationSummaryModel: runtimeState.conversationSummaryModel,
    memoryVectorRetrieval: runtimeState.memoryVectorRetrieval,
    imageGeneration: runtimeState.imageGeneration,
    imageUnderstanding: runtimeState.imageUnderstanding,
    voiceGeneration: runtimeState.voiceGeneration,
    toolPromptPreferences: runtimeState.toolPromptPreferences,
    taskModeEnabled: runtimeState.taskModeEnabled,
    mcpServers: runtimeState.mcpServers,
    mcpToolTimeoutSeconds: runtimeState.mcpToolTimeoutSeconds,
    companionHost: runtimeState.companionHost,
    companionConnections: runtimeState.companionConnections,
    triggerRules: runtimeState.triggerRules
  };

  return {
    spaceState: serializePersistedSpaceState(spaceState),
    collectionState: {
      cards: collectionState.cards,
      projectFiles: collectionState.projectFiles,
      workspaceReferenceDocs: collectionState.workspaceReferenceDocs,
      roomProjects: collectionState.roomProjects,
      imageCards: collectionState.imageCards,
      deletedBundledCardIds: collectionState.deletedBundledCardIds
    },
    personaState: {
      personas: personaState.personas,
      activeCollaboratorId: personaState.activeCollaboratorId
    },
    runtimeState: runtimeSnapshot
  };
}

export async function prepareCompleteExportSnapshot() {
  await useChatStore.getState().persistToDb();
  const snapshot = buildCurrentExportSnapshot();
  const collectionState = snapshot.collectionState;
  if (!collectionState) return snapshot;

  return {
    ...snapshot,
    collectionState: {
      ...collectionState,
      workspaceReferenceDocs: await loadWorkspaceReferenceDocsContent(
        collectionState.workspaceReferenceDocs
      )
    }
  };
}

export async function buildCurrentExportPackage(options: {
  onProgress?: StoreTransferProgressReporter;
} = {}) {
  return await buildStructuredExportPackage(
    await prepareCompleteExportSnapshot(),
    { onProgress: options.onProgress }
  );
}

async function exportCurrentPackageViaStreamingSystemFile(options: {
  onProgress?: StoreTransferProgressReporter;
}) {
  let exportId: string | null = null;
  let queuedChunks: Uint8Array[] = [];
  let queuedBytes = 0;

  const flushQueuedChunks = async () => {
    if (!exportId || queuedBytes === 0) return;
    const mergedChunk = new Uint8Array(queuedBytes);
    let offset = 0;
    for (const chunk of queuedChunks) {
      mergedChunk.set(chunk, offset);
      offset += chunk.length;
    }
    queuedChunks = [];
    queuedBytes = 0;
    await appendExportFileChunkViaSystemFiles(exportId, mergedChunk);
  };

  try {
    await streamStructuredExportPackage(
      await prepareCompleteExportSnapshot(),
      {
        onStart: async ({ fileName, mimeType }) => {
          options.onProgress?.({ message: '创建系统文件' });
          exportId = await beginExportFileViaSystemFiles(fileName, mimeType);
        },
        onProgress: options.onProgress,
        onChunk: async (chunk) => {
          if (!exportId) {
            throw new Error('系统文件导出会话尚未创建。');
          }
          queuedChunks.push(chunk);
          queuedBytes += chunk.length;
          if (queuedBytes >= NATIVE_EXPORT_CHUNK_BYTES) {
            await flushQueuedChunks();
          }
        }
      }
    );

    if (!exportId) {
      throw new Error('系统文件导出会话尚未创建。');
    }
    await flushQueuedChunks();
    options.onProgress?.({ message: '打开系统保存位置' });
    await finishExportFileViaSystemFiles(exportId);
    exportId = null;
  } catch (error) {
    if (exportId) {
      await cancelExportFileViaSystemFiles(exportId);
    }
    throw error;
  }
}

async function appendBlobToNativeZip(exportId: string, path: string, blob: Blob) {
  await beginZipBinaryEntryViaSystemFiles(exportId, path);
  try {
    for (let offset = 0; offset < blob.size; offset += NATIVE_ZIP_ENTRY_CHUNK_BYTES) {
      const chunk = new Uint8Array(
        await blob.slice(offset, Math.min(offset + NATIVE_ZIP_ENTRY_CHUNK_BYTES, blob.size)).arrayBuffer()
      );
      await appendZipBinaryChunkViaSystemFiles(exportId, chunk);
    }
    await finishZipBinaryEntryViaSystemFiles(exportId);
  } catch (error) {
    throw error;
  }
}

async function exportCurrentPackageViaNativeZip(options: {
  onProgress?: StoreTransferProgressReporter;
}) {
  let exportId: string | null = null;
  try {
    await streamStructuredExportPackageEntries(await prepareCompleteExportSnapshot(), {
      onStart: async ({ fileName, mimeType }) => {
        options.onProgress?.({ message: '创建系统文件' });
        exportId = await beginZipExportViaSystemFiles(fileName, mimeType);
      },
      onProgress: options.onProgress,
      onTextEntry: async (path, text) => {
        if (!exportId) throw new Error('系统文件导出会话尚未创建。');
        await addZipTextEntryViaSystemFiles(exportId, path, text);
      },
      onBinaryEntry: async (path, blob) => {
        if (!exportId) throw new Error('系统文件导出会话尚未创建。');
        await appendBlobToNativeZip(exportId, path, blob);
      },
      onStoredBinaryEntry: async (storeName, key, path) => {
        if (!exportId) throw new Error('系统文件导出会话尚未创建。');
        return await addZipNativePersistenceBinaryEntryViaSystemFiles(exportId, storeName, key, path);
      },
      onShouldReadPersistedAssetBlob: shouldReadPersistedAssetBlobDuringAndroidNativeZip
    });

    if (!exportId) {
      throw new Error('系统文件导出会话尚未创建。');
    }
    options.onProgress?.({ message: '打开系统保存位置' });
    await finishZipExportViaSystemFiles(exportId);
    exportId = null;
  } catch (error) {
    if (exportId) {
      await cancelZipExportViaSystemFiles(exportId);
    }
    throw error;
  }
}

export async function exportCompleteBackup(options: CompleteBackupExportOptions): Promise<{
  target: CompleteBackupExportTarget;
}> {
  options.onProgress?.({ message: '读取对话和设置' });
  if (getSystemBackupAvailability() === 'unavailable') {
    throw new Error('当前 App 版请先使用 WebDAV 导出备份包。');
  }

  if (canStreamNativeZipBackupFiles()) {
    await exportCurrentPackageViaNativeZip(options);
    return { target: 'native-stream' };
  }

  if (canStreamNativeSystemBackupFiles()) {
    await exportCurrentPackageViaStreamingSystemFile(options);
    return { target: 'native-stream' };
  }

  const { blob, fileName } = await buildCurrentExportPackage(options);
  if (canUseNativeSystemBackupFiles()) {
    options.onProgress?.({ message: '打开系统保存位置' });
    await exportFileViaSystemFiles(blob, fileName);
    return { target: 'native-file' };
  }

  options.onProgress?.({ message: '准备下载' });
  await options.downloadFile(blob, fileName);
  return { target: 'browser-download' };
}
