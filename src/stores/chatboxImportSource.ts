import {
  openBackupImportArchive,
  type BackupArchiveReader
} from '../infrastructure/backupImportArchive';
import {
  readBackupImportSourcePrefix,
  readBackupImportSourceText,
  type BackupImportSource
} from '../infrastructure/backupImportSource';
import {
  parseChatboxBackupArchive,
  parseChatboxBackupManifest
} from './chatboxBackupArchive';
import {
  convertChatboxExportToStructuredExportSnapshot,
  isLikelyChatboxPayload,
  normalizeChatboxPayload,
  type ChatboxStructuredExportConversion
} from './chatboxImportAdapter';

type ChatboxRecord = Record<string, unknown>;

type ChatboxImportMaterial = {
  payload: ChatboxRecord;
  assetEntries: NonNullable<ChatboxStructuredExportConversion['snapshot']['assetEntries']>;
  assetByStorageKey: Awaited<ReturnType<typeof parseChatboxBackupArchive>>['assetByStorageKey'];
  skippedSessionCount: number;
  skippedAssetCount: number;
  archiveEntryCount: number;
};

function isRecord(value: unknown): value is ChatboxRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseJson<T>(content: string, label: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function isZipPrefix(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function listJsonArchivePaths(zip: BackupArchiveReader) {
  const paths: string[] = [];
  zip.forEach((relativePath, file) => {
    if (!file.dir && relativePath.toLowerCase().endsWith('.json')) paths.push(relativePath);
  });
  return paths.sort((left, right) => {
    const leftPreferred = /chatbox-exported-data/i.test(left) ? 0 : 1;
    const rightPreferred = /chatbox-exported-data/i.test(right) ? 0 : 1;
    return leftPreferred - rightPreferred || left.localeCompare(right);
  });
}

async function readChatboxMaterialFromArchive(zip: BackupArchiveReader, failOnInvalid: boolean): Promise<ChatboxImportMaterial | null> {
  let firstInvalidCandidateError: Error | null = null;
  let metadataOnlyCandidate: ChatboxImportMaterial | null = null;
  const manifestFile = zip.file('manifest.json');
  if (manifestFile) {
    let manifestValue: unknown;
    try {
      manifestValue = parseJson<unknown>(await manifestFile.async('string'), 'manifest.json');
    } catch (error) {
      firstInvalidCandidateError = error instanceof Error ? error : new Error(String(error));
    }
    const manifest = parseChatboxBackupManifest(manifestValue);
    if (manifest) {
      const parsed = await parseChatboxBackupArchive(zip, manifest);
      return {
        payload: { 'chat-sessions': parsed.sessions },
        assetEntries: parsed.assetEntries,
        assetByStorageKey: parsed.assetByStorageKey,
        skippedSessionCount: parsed.skippedSessionCount,
        skippedAssetCount: parsed.skippedAssetCount,
        archiveEntryCount: zip.entryCount
      };
    }
    if (isRecord(manifestValue) && typeof manifestValue.format === 'string') return null;
  }

  for (const path of listJsonArchivePaths(zip)) {
    if (path === 'manifest.json') continue;
    const file = zip.file(path);
    if (!file) continue;
    const contents = await file.async('string');
    let normalized: ChatboxRecord;
    try {
      normalized = normalizeChatboxPayload(parseJson<unknown>(contents, path));
    } catch (error) {
      firstInvalidCandidateError ??= error instanceof Error ? error : new Error(String(error));
      continue;
    }
    if (!isLikelyChatboxPayload(normalized)) continue;
    const material: ChatboxImportMaterial = {
      payload: normalized,
      assetEntries: [],
      assetByStorageKey: new Map(),
      skippedSessionCount: 0,
      skippedAssetCount: 0,
      archiveEntryCount: zip.entryCount
    };
    const hasSessions = Array.isArray(normalized['chat-sessions'])
      || Array.isArray(normalized['chat-sessions-list'])
      || Object.keys(normalized).some((key) => key.startsWith('session:'));
    if (hasSessions) return material;
    metadataOnlyCandidate ??= material;
  }
  if (metadataOnlyCandidate) return metadataOnlyCandidate;
  if (failOnInvalid && firstInvalidCandidateError) throw firstInvalidCandidateError;
  if (failOnInvalid) throw new Error('压缩包里没有找到 Chatbox 导出的会话 JSON');
  return null;
}

async function readChatboxImportMaterial(source: BackupImportSource, failOnInvalid = false): Promise<ChatboxImportMaterial | null> {
  const prefix = await readBackupImportSourcePrefix(source, 4);
  if (!isZipPrefix(prefix)) {
    let parsed: unknown;
    try {
      parsed = parseJson<unknown>(await readBackupImportSourceText(source), 'Chatbox 导出文件');
    } catch (error) {
      if (failOnInvalid) throw error;
      return null;
    }
    const payload = normalizeChatboxPayload(parsed);
    return isLikelyChatboxPayload(payload)
      ? {
          payload,
          assetEntries: [],
          assetByStorageKey: new Map(),
          skippedSessionCount: 0,
          skippedAssetCount: 0,
          archiveEntryCount: 0
        }
      : null;
  }

  const zip = await openBackupImportArchive(source);
  try {
    return await readChatboxMaterialFromArchive(zip, failOnInvalid);
  } finally {
    await zip.close();
  }
}

export async function isChatboxImportSource(source: BackupImportSource) {
  try {
    const prefix = await readBackupImportSourcePrefix(source, 4);
    if (!isZipPrefix(prefix)) {
      const parsed = parseJson<unknown>(await readBackupImportSourceText(source), '导入文件');
      return isLikelyChatboxPayload(normalizeChatboxPayload(parsed));
    }

    const zip = await openBackupImportArchive(source);
    try {
      const manifestFile = zip.file('manifest.json');
      if (manifestFile) {
        try {
          const manifest = parseJson<unknown>(await manifestFile.async('string'), 'manifest.json');
          if (isRecord(manifest) && manifest.format === 'chatbox-backup') return true;
          if (isRecord(manifest) && typeof manifest.format === 'string') return false;
        } catch {
          return false;
        }
      }
      for (const path of listJsonArchivePaths(zip)) {
        if (path === 'manifest.json') continue;
        const file = zip.file(path);
        if (!file) continue;
        try {
          const parsed = parseJson<unknown>(await file.async('string'), path);
          if (isLikelyChatboxPayload(normalizeChatboxPayload(parsed))) return true;
        } catch {
          // Keep looking for the recognizable Chatbox payload.
        }
      }
      return false;
    } finally {
      await zip.close();
    }
  } catch {
    return false;
  }
}

export async function tryConvertChatboxImportSource(
  source: BackupImportSource
): Promise<ChatboxStructuredExportConversion | null> {
  const material = await readChatboxImportMaterial(source);
  if (!material) return null;
  return convertChatboxExportToStructuredExportSnapshot(material.payload, material);
}

export async function parseChatboxExportPayloadFromBlob(file: BackupImportSource): Promise<ChatboxRecord> {
  const material = await readChatboxImportMaterial(file, true);
  if (!material) throw new Error('没有识别到 Chatbox 会话数据');
  return material.payload;
}

export async function convertChatboxExportBlobToStructuredExportSnapshot(
  file: BackupImportSource
): Promise<ChatboxStructuredExportConversion> {
  const material = await readChatboxImportMaterial(file, true);
  if (!material) throw new Error('没有识别到 Chatbox 会话数据');
  return convertChatboxExportToStructuredExportSnapshot(material.payload, material);
}
