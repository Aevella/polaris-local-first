import { Capacitor, registerPlugin } from '@capacitor/core';
import { base64ToBytes, bytesToBase64 } from './nativeBase64';

type NativeImportResult = {
  canceled: boolean;
  name?: string;
  mimeType?: string;
  fileUrl?: string;
  dataBase64?: string;
};

type NativeExportResult = {
  canceled: boolean;
};

type NativeBeginExportResult = {
  exportId: string;
};

type NativeZipPersistenceEntryResult = {
  written: boolean;
  size?: number;
};

type SystemFilePlugin = {
  importBackup: () => Promise<NativeImportResult>;
  exportBackup: (options: {
    fileName: string;
    mimeType: string;
    dataBase64: string;
  }) => Promise<NativeExportResult>;
  beginExportBackup?: (options: {
    fileName: string;
    mimeType: string;
  }) => Promise<NativeBeginExportResult>;
  appendExportBackupChunk?: (options: {
    exportId: string;
    dataBase64: string;
  }) => Promise<void>;
  finishExportBackup?: (options: {
    exportId: string;
  }) => Promise<NativeExportResult>;
  cancelExportBackup?: (options: {
    exportId: string;
  }) => Promise<void>;
  beginZipExport?: (options: {
    fileName: string;
    mimeType: string;
  }) => Promise<NativeBeginExportResult>;
  addZipTextEntry?: (options: {
    exportId: string;
    path: string;
    text: string;
  }) => Promise<void>;
  beginZipTextEntry?: (options: {
    exportId: string;
    path: string;
  }) => Promise<void>;
  appendZipTextChunk?: (options: {
    exportId: string;
    text: string;
  }) => Promise<void>;
  finishZipTextEntry?: (options: {
    exportId: string;
  }) => Promise<void>;
  beginZipBinaryEntry?: (options: {
    exportId: string;
    path: string;
  }) => Promise<void>;
  appendZipBinaryChunk?: (options: {
    exportId: string;
    dataBase64: string;
  }) => Promise<void>;
  addZipNativePersistenceBinaryEntry?: (options: {
    exportId: string;
    path: string;
    storeName: string;
    key: string;
  }) => Promise<NativeZipPersistenceEntryResult>;
  finishZipBinaryEntry?: (options: {
    exportId: string;
  }) => Promise<void>;
  finishZipExport?: (options: {
    exportId: string;
  }) => Promise<NativeExportResult>;
  cancelZipExport?: (options: {
    exportId: string;
  }) => Promise<void>;
};

const SystemFile = registerPlugin<SystemFilePlugin>('SystemFile');
const NATIVE_EXPORT_CHUNK_BYTES = 512 * 1024;
const NATIVE_ZIP_TEXT_CHUNK_CHARS = 128 * 1024;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type SystemBackupAvailability = 'native' | 'browser' | 'unavailable';

export function getSystemBackupAvailability(): SystemBackupAvailability {
  if (!Capacitor.isNativePlatform()) {
    return 'browser';
  }

  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? 'native' : 'unavailable';
}

export function canUseNativeSystemBackupFiles() {
  return getSystemBackupAvailability() === 'native';
}

export function canStreamNativeSystemBackupFiles() {
  return Capacitor.isNativePlatform()
    && (Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android')
    && typeof SystemFile.beginExportBackup === 'function'
    && typeof SystemFile.appendExportBackupChunk === 'function'
    && typeof SystemFile.finishExportBackup === 'function';
}

export function canStreamNativeZipBackupFiles() {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === 'android'
    && typeof SystemFile.beginZipExport === 'function'
    && typeof SystemFile.addZipTextEntry === 'function'
    && typeof SystemFile.beginZipBinaryEntry === 'function'
    && typeof SystemFile.appendZipBinaryChunk === 'function'
    && typeof SystemFile.finishZipBinaryEntry === 'function'
    && typeof SystemFile.finishZipExport === 'function';
}

export function canWriteNativePersistenceZipEntries() {
  return canStreamNativeZipBackupFiles()
    && typeof SystemFile.addZipNativePersistenceBinaryEntry === 'function';
}

export async function exportFileViaSystemFiles(blob: Blob, fileName: string) {
  if (canStreamNativeSystemBackupFiles()) {
    const exportId = await beginExportFileViaSystemFiles(fileName, blob.type || 'application/zip');
    try {
      for (let offset = 0; offset < blob.size; offset += NATIVE_EXPORT_CHUNK_BYTES) {
        const chunk = new Uint8Array(
          await blob.slice(offset, Math.min(offset + NATIVE_EXPORT_CHUNK_BYTES, blob.size)).arrayBuffer()
        );
        await appendExportFileChunkViaSystemFiles(exportId, chunk);
      }
      return await finishExportFileViaSystemFiles(exportId);
    } catch (error) {
      await cancelExportFileViaSystemFiles(exportId);
      throw error;
    }
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = await SystemFile.exportBackup({
    fileName,
    mimeType: blob.type || 'application/zip',
    dataBase64: bytesToBase64(bytes)
  });
  return !result.canceled;
}

export async function beginExportFileViaSystemFiles(fileName: string, mimeType = 'application/zip') {
  if (!SystemFile.beginExportBackup) {
    throw new Error('当前 App 版暂不支持分块导出。');
  }
  const result = await SystemFile.beginExportBackup({ fileName, mimeType });
  if (!result.exportId) {
    throw new Error('系统文件导出会话创建失败。');
  }
  return result.exportId;
}

export async function appendExportFileChunkViaSystemFiles(exportId: string, chunk: Uint8Array) {
  if (!SystemFile.appendExportBackupChunk) {
    throw new Error('当前 App 版暂不支持分块导出。');
  }
  await SystemFile.appendExportBackupChunk({
    exportId,
    dataBase64: bytesToBase64(chunk)
  });
}

export async function finishExportFileViaSystemFiles(exportId: string) {
  if (!SystemFile.finishExportBackup) {
    throw new Error('当前 App 版暂不支持分块导出。');
  }
  const result = await SystemFile.finishExportBackup({ exportId });
  return !result.canceled;
}

export async function cancelExportFileViaSystemFiles(exportId: string) {
  await SystemFile.cancelExportBackup?.({ exportId });
}

export async function beginZipExportViaSystemFiles(fileName: string, mimeType = 'application/zip') {
  if (!SystemFile.beginZipExport) {
    throw new Error('当前 App 版暂不支持流式 ZIP 导出。');
  }
  const result = await SystemFile.beginZipExport({ fileName, mimeType });
  if (!result.exportId) {
    throw new Error('系统文件 ZIP 导出会话创建失败。');
  }
  return result.exportId;
}

export async function addZipTextEntryViaSystemFiles(exportId: string, path: string, text: string) {
  if (
    SystemFile.beginZipTextEntry
    && SystemFile.appendZipTextChunk
    && SystemFile.finishZipTextEntry
  ) {
    await SystemFile.beginZipTextEntry({ exportId, path });
    try {
      for (let offset = 0; offset < text.length; offset += NATIVE_ZIP_TEXT_CHUNK_CHARS) {
        await SystemFile.appendZipTextChunk({
          exportId,
          text: text.slice(offset, offset + NATIVE_ZIP_TEXT_CHUNK_CHARS)
        });
      }
      await SystemFile.finishZipTextEntry({ exportId });
      return;
    } catch (error) {
      throw error;
    }
  }

  if (!SystemFile.addZipTextEntry) {
    throw new Error('当前 App 版暂不支持流式 ZIP 文本条目。');
  }
  await SystemFile.addZipTextEntry({ exportId, path, text });
}

export async function beginZipBinaryEntryViaSystemFiles(exportId: string, path: string) {
  if (!SystemFile.beginZipBinaryEntry) {
    throw new Error('当前 App 版暂不支持流式 ZIP 二进制条目。');
  }
  await SystemFile.beginZipBinaryEntry({ exportId, path });
}

export async function appendZipBinaryChunkViaSystemFiles(exportId: string, chunk: Uint8Array) {
  if (!SystemFile.appendZipBinaryChunk) {
    throw new Error('当前 App 版暂不支持流式 ZIP 二进制分块。');
  }
  await SystemFile.appendZipBinaryChunk({
    exportId,
    dataBase64: bytesToBase64(chunk)
  });
}

export async function addZipNativePersistenceBinaryEntryViaSystemFiles(
  exportId: string,
  storeName: string,
  key: string,
  path: string
) {
  if (!SystemFile.addZipNativePersistenceBinaryEntry) {
    return false;
  }
  const result = await SystemFile.addZipNativePersistenceBinaryEntry({
    exportId,
    path,
    storeName,
    key
  });
  return result.written === true;
}

export async function finishZipBinaryEntryViaSystemFiles(exportId: string) {
  if (!SystemFile.finishZipBinaryEntry) {
    throw new Error('当前 App 版暂不支持完成流式 ZIP 二进制条目。');
  }
  await SystemFile.finishZipBinaryEntry({ exportId });
}

export async function finishZipExportViaSystemFiles(exportId: string) {
  if (!SystemFile.finishZipExport) {
    throw new Error('当前 App 版暂不支持完成流式 ZIP 导出。');
  }
  const result = await SystemFile.finishZipExport({ exportId });
  return !result.canceled;
}

export async function cancelZipExportViaSystemFiles(exportId: string) {
  await (SystemFile.cancelZipExport ?? SystemFile.cancelExportBackup)?.({ exportId });
}

export async function importBackupViaSystemFiles(): Promise<File | null> {
  const result = await SystemFile.importBackup();
  if (result.canceled) {
    return null;
  }
  if (!result.name || (!result.fileUrl && !result.dataBase64)) {
    throw new Error('系统文件返回的内容不完整');
  }

  if (result.fileUrl) {
    const convertedFileUrl = Capacitor.convertFileSrc(result.fileUrl);
    let response: Response;
    try {
      response = await fetch(convertedFileUrl);
    } catch (error) {
      throw new Error(`读取系统导入文件失败：${errorMessage(error)}`);
    }
    if (!response.ok) {
      throw new Error(`读取系统导入文件失败：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return new File([blob], result.name, {
      type: result.mimeType || blob.type || 'application/zip'
    });
  }

  const dataBase64 = result.dataBase64;
  if (!dataBase64) {
    throw new Error('系统文件返回的内容不完整');
  }
  const bytes = base64ToBytes(dataBase64);
  return new File([bytes], result.name, {
    type: result.mimeType || 'application/zip'
  });
}
