export type NativeBackupImportSource = {
  kind: 'native-file';
  name: string;
  mimeType: string;
  size: number;
  readRange: (start: number, length: number) => Promise<Uint8Array>;
  release: () => Promise<void>;
};

export type BackupImportSource = Blob | NativeBackupImportSource;

export function isNativeBackupImportSource(
  source: BackupImportSource
): source is NativeBackupImportSource {
  return !(source instanceof Blob) && source.kind === 'native-file';
}

async function readNativeRange(source: NativeBackupImportSource, start: number, length: number) {
  if (length <= 0) return new Uint8Array();
  return await source.readRange(start, length);
}

export async function readBackupImportSourcePrefix(
  source: BackupImportSource,
  length: number
) {
  if (!isNativeBackupImportSource(source)) {
    return new Uint8Array(await source.slice(0, length).arrayBuffer());
  }
  return await readNativeRange(source, 0, length);
}

async function* readNativeChunks(source: NativeBackupImportSource) {
  let totalBytes = 0;
  const chunkBytes = 256 * 1024;
  while (totalBytes < source.size) {
    const requested = Math.min(chunkBytes, source.size - totalBytes);
    const chunk = await source.readRange(totalBytes, requested);
    if (chunk.length === 0) break;
    if (chunk.length > requested) throw new Error('备份文件分块超出了请求的读取范围。');
    totalBytes += chunk.length;
    yield chunk;
  }
  if (totalBytes !== source.size) {
    throw new Error('备份文件在读取完成前提前结束。');
  }
}

export async function readBackupImportSourceBytes(source: BackupImportSource) {
  if (!isNativeBackupImportSource(source)) {
    return new Uint8Array(await source.arrayBuffer());
  }
  const bytes = new Uint8Array(source.size);
  let offset = 0;
  for await (const chunk of readNativeChunks(source)) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function readBackupImportSourceText(source: BackupImportSource) {
  if (!isNativeBackupImportSource(source)) return await source.text();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  for await (const chunk of readNativeChunks(source)) {
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

export function getKnownBackupImportSourceSize(source: BackupImportSource) {
  return source.size;
}

export async function releaseBackupImportSource(source: BackupImportSource) {
  if (isNativeBackupImportSource(source)) {
    await source.release();
  }
}
