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

export async function readBackupImportSourceBytes(source: BackupImportSource) {
  if (!isNativeBackupImportSource(source)) {
    return new Uint8Array(await source.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const chunkBytes = 256 * 1024;
  while (totalBytes < source.size) {
    const chunk = await source.readRange(totalBytes, Math.min(chunkBytes, source.size - totalBytes));
    if (chunk.length === 0) break;
    chunks.push(chunk);
    totalBytes += chunk.length;
  }
  if (totalBytes !== source.size) {
    throw new Error('备份文件在读取完成前提前结束。');
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function readBackupImportSourceText(source: BackupImportSource) {
  if (!isNativeBackupImportSource(source)) return await source.text();
  return new TextDecoder().decode(await readBackupImportSourceBytes(source));
}

export function getKnownBackupImportSourceSize(source: BackupImportSource) {
  return source.size;
}

export async function releaseBackupImportSource(source: BackupImportSource) {
  if (isNativeBackupImportSource(source)) {
    await source.release();
  }
}
