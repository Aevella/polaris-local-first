import {
  BlobReader,
  BlobWriter,
  Reader,
  TextWriter,
  ZipReader,
  type Entry,
  type FileEntry
} from '@zip.js/zip.js';
import {
  isNativeBackupImportSource,
  type BackupImportSource,
  type NativeBackupImportSource
} from './backupImportSource';

const NATIVE_IMPORT_READ_CHUNK_BYTES = 256 * 1024;

export type BackupArchiveFile = {
  async(type: 'string'): Promise<string>;
  async(type: 'blob'): Promise<Blob>;
  async(type: 'arraybuffer'): Promise<ArrayBuffer>;
};

export type BackupArchiveReader = {
  file: (path: string) => BackupArchiveFile | null;
  forEach: (callback: (relativePath: string, file: { dir: boolean; name: string }) => void) => void;
  entryCount: number;
  size: number;
  close: () => Promise<void>;
};

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

class NativeBackupChunkReader extends Reader<string> {
  private readonly source: NativeBackupImportSource;
  initialized = false;

  constructor(source: NativeBackupImportSource) {
    super(source.name);
    this.source = source;
  }

  async init() {
    this.size = this.source.size;
    this.initialized = true;
  }

  async readUint8Array(index: number, length: number) {
    if (length <= 0) return new Uint8Array();
    const end = Math.min(this.size, index + length) - 1;
    if (end < index) return new Uint8Array();
    const result = new Uint8Array(end - index + 1);
    let written = 0;
    while (written < result.length) {
      const chunk = await this.source.readRange(
        index + written,
        Math.min(NATIVE_IMPORT_READ_CHUNK_BYTES, result.length - written)
      );
      if (chunk.length === 0) {
        throw new Error('导入文件分块提前结束。');
      }
      result.set(chunk, written);
      written += chunk.length;
    }
    return result;
  }
}

export async function openBackupImportArchive(
  source: BackupImportSource
): Promise<BackupArchiveReader> {
  const sourceReader = isNativeBackupImportSource(source)
    ? new NativeBackupChunkReader(source)
    : new BlobReader(source);
  const reader = new ZipReader(sourceReader, { checkAmbiguity: true });
  try {
    const entries = await reader.getEntries({ checkAmbiguity: true });
    const files = new Map(entries.filter(isFileEntry).map((entry) => [entry.filename, entry]));
    return {
      entryCount: files.size,
      size: sourceReader.size,
      file(path) {
        const entry = files.get(path);
        if (!entry) return null;
        return {
          async async(type: 'string' | 'blob' | 'arraybuffer') {
            if (type === 'string') return await entry.getData(new TextWriter());
            if (type === 'blob') return await entry.getData(new BlobWriter());
            return await entry.arrayBuffer();
          }
        } as BackupArchiveFile;
      },
      forEach(callback) {
        for (const entry of entries) {
          callback(entry.filename, { dir: entry.directory, name: entry.filename });
        }
      },
      async close() {
        await reader.close();
      }
    };
  } catch (error) {
    try {
      await reader.close();
    } catch {
      // Preserve the archive error that stopped the import.
    }
    throw error;
  }
}
