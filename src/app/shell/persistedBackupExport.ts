import {
  appendExportFileChunkViaSystemFiles,
  addZipNativePersistenceBinaryEntryViaSystemFiles,
  addZipTextEntryViaSystemFiles,
  appendZipBinaryChunkViaSystemFiles,
  beginZipBinaryEntryViaSystemFiles,
  beginExportFileViaSystemFiles,
  beginZipExportViaSystemFiles,
  canStreamNativeZipBackupFiles,
  canStreamNativeSystemBackupFiles,
  canUseNativeSystemBackupFiles,
  cancelExportFileViaSystemFiles,
  cancelZipExportViaSystemFiles,
  exportFileViaSystemFiles,
  finishZipBinaryEntryViaSystemFiles,
  finishExportFileViaSystemFiles,
  finishZipExportViaSystemFiles,
  getSystemBackupAvailability
} from '../../native/systemBackupFiles';
import {
  buildStructuredExportPackage,
  streamStructuredExportPackageEntries,
  streamStructuredExportPackage
} from '../../stores/storeExportPackage';
import type { StoreTransferProgressReporter } from '../../stores/storeImportProgress';
import { shouldReadPersistedAssetBlobDuringAndroidNativeZip } from './androidNativeZipExportPolicy';

const NATIVE_EXPORT_CHUNK_BYTES = 512 * 1024;
const NATIVE_ZIP_ENTRY_CHUNK_BYTES = 256 * 1024;

export type PersistedBackupExportOptions = {
  onProgress?: StoreTransferProgressReporter;
  downloadFile: (blob: Blob, fileName: string) => void | Promise<void>;
};

export type PersistedBackupExportTarget = 'browser-download' | 'native-file' | 'native-stream';

export function formatPersistedBackupExportError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/SystemFile/i.test(message) || /not implemented on ios/i.test(message)) {
    return '当前 App 版暂时无法使用本地备份包，请先使用 WebDAV 导出备份包。';
  }
  return message || '导出备份包失败';
}

async function exportPersistedPackageViaStreamingSystemFile(options: {
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
    await streamStructuredExportPackage({}, {
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
    });

    if (!exportId) {
      throw new Error('系统文件导出会话尚未创建。');
    }
    await flushQueuedChunks();
    options.onProgress?.({ message: '打开系统保存位置' });
    const saved = await finishExportFileViaSystemFiles(exportId);
    exportId = null;
    return saved;
  } catch (error) {
    if (exportId) {
      await cancelExportFileViaSystemFiles(exportId);
    }
    throw error;
  }
}

async function appendBlobToNativeZip(exportId: string, path: string, blob: Blob) {
  await beginZipBinaryEntryViaSystemFiles(exportId, path);
  for (let offset = 0; offset < blob.size; offset += NATIVE_ZIP_ENTRY_CHUNK_BYTES) {
    const chunk = new Uint8Array(
      await blob.slice(offset, Math.min(offset + NATIVE_ZIP_ENTRY_CHUNK_BYTES, blob.size)).arrayBuffer()
    );
    await appendZipBinaryChunkViaSystemFiles(exportId, chunk);
  }
  await finishZipBinaryEntryViaSystemFiles(exportId);
}

async function exportPersistedPackageViaNativeZip(options: {
  onProgress?: StoreTransferProgressReporter;
}) {
  let exportId: string | null = null;
  try {
    await streamStructuredExportPackageEntries({}, {
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
    const saved = await finishZipExportViaSystemFiles(exportId);
    exportId = null;
    return saved;
  } catch (error) {
    if (exportId) {
      await cancelZipExportViaSystemFiles(exportId);
    }
    throw error;
  }
}

export async function exportPersistedCompleteBackup(options: PersistedBackupExportOptions): Promise<{
  target: PersistedBackupExportTarget;
  saved: boolean;
  kind: 'restorable';
}> {
  options.onProgress?.({ message: '读取已保存数据' });
  if (getSystemBackupAvailability() === 'unavailable') {
    throw new Error('当前 App 版请先使用 WebDAV 导出备份包。');
  }

  if (canStreamNativeZipBackupFiles()) {
    const saved = await exportPersistedPackageViaNativeZip({ onProgress: options.onProgress });
    return { target: 'native-stream', saved, kind: 'restorable' };
  }

  if (canStreamNativeSystemBackupFiles()) {
    const saved = await exportPersistedPackageViaStreamingSystemFile({ onProgress: options.onProgress });
    return { target: 'native-stream', saved, kind: 'restorable' };
  }

  const { blob, fileName } = await buildStructuredExportPackage({}, {
    onProgress: options.onProgress
  });
  if (canUseNativeSystemBackupFiles()) {
    options.onProgress?.({ message: '打开系统保存位置' });
    const saved = await exportFileViaSystemFiles(blob, fileName);
    return { target: 'native-file', saved, kind: 'restorable' };
  }

  options.onProgress?.({ message: '准备下载' });
  await options.downloadFile(blob, fileName);
  return { target: 'browser-download', saved: true, kind: 'restorable' };
}
