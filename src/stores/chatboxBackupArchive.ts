import type { AssetExportEntry } from '../infrastructure/assetStore';
import type { BackupArchiveReader } from '../infrastructure/backupImportArchive';

type ChatboxRecord = Record<string, unknown>;

type ChatboxBackupChecksum = {
  algorithm: 'sha256';
  value: string;
};

type ChatboxBackupEntry = {
  path: string;
  size: number;
  checksum: ChatboxBackupChecksum;
};

type ChatboxBackupSessionEntry = ChatboxBackupEntry & {
  id: string;
  meta: ChatboxRecord;
  resourceIds: string[];
};

type ChatboxBackupResourceEntry = ChatboxBackupEntry & {
  id: string;
  originalStorageKeys: string[];
  sessionIds: string[];
  scope: 'session' | 'shared' | 'global';
  encoding: 'utf8' | 'data-url-base64';
  mimeType: string;
  kind: string;
  filename?: string;
};

export type ChatboxResolvedAsset = {
  assetId: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
};

export type ParsedChatboxBackupArchive = {
  sessions: ChatboxRecord[];
  assetEntries: AssetExportEntry[];
  assetByStorageKey: Map<string, ChatboxResolvedAsset>;
  skippedSessionCount: number;
  skippedAssetCount: number;
};

export type ChatboxBackupManifest = {
  format: 'chatbox-backup';
  formatVersion: 2;
  exportedAt: string;
  application: { name: 'Chatbox'; version: string; platform: string };
  sessions: ChatboxBackupSessionEntry[];
  resources: ChatboxBackupResourceEntry[];
  warnings: ChatboxRecord[];
};

const CHATBOX_BACKUP_FORMAT = 'chatbox-backup';
const CHATBOX_BACKUP_VERSION = 2;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const CHATBOX_RESOURCE_KINDS = new Set([
  'image',
  'parsed-attachment',
  'raw-attachment',
  'parsed-link',
  'tool-result',
  'avatar',
  'background',
  'copilot-image'
]);

function isRecord(value: unknown): value is ChatboxRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function parseChecksum(value: unknown, label: string): ChatboxBackupChecksum {
  if (
    !isRecord(value)
    || value.algorithm !== 'sha256'
    || typeof value.value !== 'string'
    || !CHECKSUM_PATTERN.test(value.value)
  ) {
    throw new Error(`${label} 的校验信息不完整`);
  }
  return { algorithm: 'sha256', value: value.value };
}

function parseEntry(value: unknown, label: string): ChatboxBackupEntry {
  if (!isRecord(value)) throw new Error(`${label} 不是有效条目`);
  const path = readString(value.path);
  if (!path || !Number.isInteger(value.size) || (value.size as number) < 0) {
    throw new Error(`${label} 缺少路径或大小`);
  }
  return {
    path,
    size: value.size as number,
    checksum: parseChecksum(value.checksum, label)
  };
}

function parseStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${label} 格式不正确`);
  }
  return value.map((item) => item.trim());
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} 存在重复项`);
}

export function parseChatboxBackupManifest(value: unknown): ChatboxBackupManifest | null {
  if (!isRecord(value) || value.format !== CHATBOX_BACKUP_FORMAT) return null;
  if (value.formatVersion !== CHATBOX_BACKUP_VERSION) {
    throw new Error(`暂不支持 Chatbox 备份格式版本 ${String(value.formatVersion)}`);
  }
  if (!isRecord(value.application) || value.application.name !== 'Chatbox') {
    throw new Error('Chatbox 备份缺少应用来源信息');
  }
  if (!Array.isArray(value.sessions) || !Array.isArray(value.resources) || !Array.isArray(value.warnings)) {
    throw new Error('Chatbox 备份 manifest 缺少会话或资源目录');
  }

  const sessions = value.sessions.map((candidate, index): ChatboxBackupSessionEntry => {
    const base = parseEntry(candidate, `Chatbox 会话目录第 ${index + 1} 项`);
    if (!isRecord(candidate)) throw new Error('Chatbox 会话目录格式不正确');
    const id = readString(candidate.id);
    if (!id || !isRecord(candidate.meta) || readString(candidate.meta.id) !== id) {
      throw new Error(`Chatbox 会话目录第 ${index + 1} 项缺少一致的 ID`);
    }
    if (!/^sessions\/[^/]+\/session\.json$/.test(base.path)) {
      throw new Error(`Chatbox 会话路径不正确：${base.path}`);
    }
    return {
      ...base,
      id,
      meta: candidate.meta,
      resourceIds: parseStringArray(candidate.resourceIds, `Chatbox 会话 ${id} 的资源目录`)
    };
  });

  const resources = value.resources.map((candidate, index): ChatboxBackupResourceEntry => {
    const base = parseEntry(candidate, `Chatbox 资源目录第 ${index + 1} 项`);
    if (!isRecord(candidate)) throw new Error('Chatbox 资源目录格式不正确');
    const id = readString(candidate.id);
    const encoding = candidate.encoding;
    const scope = candidate.scope;
    const mimeType = readString(candidate.mimeType);
    const kind = readString(candidate.kind);
    if (
      !id
      || (scope !== 'session' && scope !== 'shared' && scope !== 'global')
      || (encoding !== 'utf8' && encoding !== 'data-url-base64')
      || !mimeType
      || !CHATBOX_RESOURCE_KINDS.has(kind)
    ) {
      throw new Error(`Chatbox 资源目录第 ${index + 1} 项缺少必要字段`);
    }
    if (!base.path.startsWith('resources/') && !/^sessions\/[^/]+\/resources\/.+/.test(base.path)) {
      throw new Error(`Chatbox 资源路径不正确：${base.path}`);
    }
    return {
      ...base,
      id,
      originalStorageKeys: parseStringArray(candidate.originalStorageKeys, `Chatbox 资源 ${id} 的存储键`),
      sessionIds: parseStringArray(candidate.sessionIds, `Chatbox 资源 ${id} 的会话目录`),
      scope,
      encoding,
      mimeType,
      kind,
      filename: readString(candidate.filename) || undefined
    };
  });

  assertUnique(sessions.map((entry) => entry.id), 'Chatbox 会话 ID');
  assertUnique(sessions.map((entry) => entry.path), 'Chatbox 会话路径');
  assertUnique(resources.map((entry) => entry.id), 'Chatbox 资源 ID');
  assertUnique(resources.map((entry) => entry.path), 'Chatbox 资源路径');
  assertUnique(resources.flatMap((entry) => entry.originalStorageKeys), 'Chatbox 资源存储键');

  const sessionIds = new Set(sessions.map((entry) => entry.id));
  const resourceIds = new Set(resources.map((entry) => entry.id));
  for (const session of sessions) {
    assertUnique(session.resourceIds, `Chatbox 会话 ${session.id} 的资源目录`);
    if (session.resourceIds.some((id) => !resourceIds.has(id))) {
      throw new Error(`Chatbox 会话 ${session.id} 引用了目录中不存在的资源`);
    }
  }
  const sessionsById = new Map(sessions.map((entry) => [entry.id, entry]));
  const resourcesById = new Map(resources.map((entry) => [entry.id, entry]));
  for (const resource of resources) {
    assertUnique(resource.originalStorageKeys, `Chatbox 资源 ${resource.id} 的存储键`);
    assertUnique(resource.sessionIds, `Chatbox 资源 ${resource.id} 的会话目录`);
    if (resource.sessionIds.some((id) => !sessionIds.has(id))) {
      throw new Error(`Chatbox 资源 ${resource.id} 引用了目录中不存在的会话`);
    }
    if (resource.scope === 'session' && resource.sessionIds.length !== 1) {
      throw new Error(`Chatbox 会话资源 ${resource.id} 缺少唯一所属会话`);
    }
    if (resource.scope === 'global' && resource.sessionIds.length !== 0) {
      throw new Error(`Chatbox 全局资源 ${resource.id} 不应绑定会话`);
    }
    if (resource.sessionIds.some((id) => !sessionsById.get(id)?.resourceIds.includes(resource.id))) {
      throw new Error(`Chatbox 资源 ${resource.id} 与会话目录不一致`);
    }
  }
  for (const session of sessions) {
    if (session.resourceIds.some((id) => !resourcesById.get(id)?.sessionIds.includes(session.id))) {
      throw new Error(`Chatbox 会话 ${session.id} 与资源目录不一致`);
    }
  }

  return {
    format: CHATBOX_BACKUP_FORMAT,
    formatVersion: CHATBOX_BACKUP_VERSION,
    exportedAt: readString(value.exportedAt),
    application: {
      name: 'Chatbox',
      version: readString(value.application.version),
      platform: readString(value.application.platform)
    },
    sessions,
    resources,
    warnings: value.warnings.filter(isRecord)
  };
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readVerifiedEntry(zip: BackupArchiveReader, entry: ChatboxBackupEntry) {
  const file = zip.file(entry.path);
  if (!file) throw new Error(`Chatbox 备份缺少 ${entry.path}`);
  const bytes = await file.async('arraybuffer');
  if (bytes.byteLength !== entry.size) throw new Error(`Chatbox 备份条目大小不一致：${entry.path}`);
  if (await sha256Hex(bytes) !== entry.checksum.value) {
    throw new Error(`Chatbox 备份条目校验失败：${entry.path}`);
  }
  return bytes;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeAssetName(resource: ChatboxBackupResourceEntry) {
  if (resource.filename) return resource.filename;
  const basename = resource.path.split('/').pop()?.trim();
  if (basename) return basename;
  return resource.mimeType.startsWith('image/') ? 'Chatbox 图片' : 'Chatbox 附件';
}

function assetKind(resource: ChatboxBackupResourceEntry): 'image' | 'file' {
  return resource.kind === 'image' || resource.mimeType.startsWith('image/') ? 'image' : 'file';
}

function shouldMaterializeResource(resource: ChatboxBackupResourceEntry) {
  return resource.kind === 'image'
    || resource.kind === 'raw-attachment'
    || resource.kind === 'parsed-attachment'
    || resource.kind === 'tool-result';
}

export async function parseChatboxBackupArchive(
  zip: BackupArchiveReader,
  manifest: ChatboxBackupManifest
): Promise<ParsedChatboxBackupArchive> {
  const sessions: ChatboxRecord[] = [];
  const acceptedSessionIds = new Set<string>();
  const referencedResourceIds = new Set<string>();
  let skippedSessionCount = manifest.warnings.filter((warning) => warning.code === 'session-read-failed').length;

  for (const descriptor of manifest.sessions) {
    try {
      const bytes = await readVerifiedEntry(zip, descriptor);
      const parsed = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), descriptor.path);
      if (!isRecord(parsed) || readString(parsed.id) !== descriptor.id || !Array.isArray(parsed.messages)) {
        throw new Error(`Chatbox 会话内容不完整：${descriptor.id}`);
      }
      sessions.push({ ...descriptor.meta, ...parsed });
      acceptedSessionIds.add(descriptor.id);
      descriptor.resourceIds.forEach((id) => referencedResourceIds.add(id));
    } catch {
      skippedSessionCount += 1;
    }
  }

  const assetEntries: AssetExportEntry[] = [];
  const assetByStorageKey = new Map<string, ChatboxResolvedAsset>();
  let skippedAssetCount = manifest.warnings.filter((warning) => (
    warning.code === 'resource-read-failed' || warning.code === 'external-resource-skipped'
  )).length;
  const exportedAt = Date.parse(manifest.exportedAt);
  const createdAt = Number.isFinite(exportedAt) ? exportedAt : Date.now();

  for (const resource of manifest.resources) {
    if (!referencedResourceIds.has(resource.id) || !shouldMaterializeResource(resource)) continue;
    if (resource.sessionIds.length > 0 && !resource.sessionIds.some((id) => acceptedSessionIds.has(id))) continue;
    try {
      const bytes = await readVerifiedEntry(zip, resource);
      const kind = assetKind(resource);
      const name = safeAssetName(resource);
      const blob = new Blob([bytes], { type: resource.mimeType });
      const textContent = kind === 'file' && resource.encoding === 'utf8'
        ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        : undefined;
      const assetId = `chatbox-asset-${resource.id.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48)}-${stableHash(resource.path)}`;
      const resolved: ChatboxResolvedAsset = {
        assetId,
        kind,
        name,
        mimeType: resource.mimeType,
        size: blob.size,
        ...(textContent?.trim() ? { textContent } : {})
      };
      assetEntries.push({
        meta: {
          id: assetId,
          kind,
          name,
          mimeType: resource.mimeType,
          size: blob.size,
          createdAt,
          ...(textContent?.trim() ? { textContent } : {})
        },
        blob,
        previewBlob: null
      });
      resource.originalStorageKeys.forEach((key) => assetByStorageKey.set(key, resolved));
    } catch {
      skippedAssetCount += 1;
    }
  }

  return {
    sessions,
    assetEntries,
    assetByStorageKey,
    skippedSessionCount,
    skippedAssetCount
  };
}
