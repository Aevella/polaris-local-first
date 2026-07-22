import { Capacitor, registerPlugin } from '@capacitor/core';
import { base64ToBytes, bytesToBase64 } from '../native/nativeBase64';
import type { PersistedDbEntry, PersistedKvMutation, PersistenceBackend } from './persistence';

type NativePersistenceEntry =
  | {
      key: string;
      kind: 'json';
      value?: unknown;
      jsonText?: string;
      readMode?: 'chunked';
      byteLength?: number;
      checksum?: string;
    }
  | { key: string; kind: 'binary'; dataBase64: string; mimeType?: string };

type NativePersistenceGetResult =
  | { exists: false }
  | ({ exists: true } & NativePersistenceEntry);

type NativePersistencePlugin = {
  get(options: { storeName: string; key: string }): Promise<NativePersistenceGetResult>;
  readJsonChunk?(options: {
    storeName: string;
    key: string;
    offset: number;
    length: number;
  }): Promise<{ chunkBase64: string; byteLength: number }>;
  set(options: {
    storeName: string;
    key: string;
    kind: 'json' | 'binary';
    jsonText?: string;
    dataBase64?: string;
    mimeType?: string;
  }): Promise<void>;
  beginJsonWrite(options: { storeName: string; key: string; writeId: string }): Promise<void>;
  appendJsonWriteChunk(options: { storeName: string; key: string; writeId: string; chunkBase64: string }): Promise<void>;
  finishJsonWrite(options: {
    storeName: string;
    key: string;
    writeId: string;
    expectedByteLength: number;
    expectedChecksum: string;
    chunkCount: number;
  }): Promise<{ byteLength?: number; checksum?: string }>;
  delete(options: { storeName: string; key: string }): Promise<void>;
  entries(options: { storeName: string }): Promise<{ entries: NativePersistenceEntry[] }>;
  sizes?(options: { storeName: string }): Promise<{ entries: Array<{ key: string; size: number }> }>;
  keys(options: { storeName: string }): Promise<{ keys: string[] }>;
  keysWithPrefix?(options: { storeName: string; keyPrefix: string }): Promise<{ keys: string[] }>;
  clear(options: { storeName: string }): Promise<void>;
  applyKvMutations(options: {
    storeName: string;
    mutations: Array<{ type: 'set'; key: string; jsonText: string } | { type: 'delete'; key: string }>;
  }): Promise<void>;
  replaceKv(options: {
    storeName: string;
    entries: Array<{ key: string; jsonText: string }>;
  }): Promise<void>;
};

const NativePersistence = registerPlugin<NativePersistencePlugin>('NativePersistence');
const NATIVE_JSON_CHUNK_THRESHOLD = 256 * 1024;
const NATIVE_JSON_CHUNK_BYTES = 48 * 1024;
const NATIVE_JSON_READ_CHUNK_BYTES = 48 * 1024;
const NATIVE_KV_MUTATION_BATCH_MAX_BYTES = 192 * 1024;

export type NativePersistencePlatform = 'ios' | 'android';

export function getNativePersistencePlatform(): NativePersistencePlatform | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NativePersistence')) {
    return null;
  }
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

export function canUseNativePersistenceBackend() {
  return getNativePersistencePlatform() !== null;
}

async function blobToBase64(blob: Blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function entryValue<T>(entry: NativePersistenceEntry): T {
  if (entry.kind === 'binary') {
    return new Blob([base64ToBytes(entry.dataBase64)], { type: entry.mimeType || '' }) as T;
  }
  if (typeof entry.jsonText === 'string') {
    return JSON.parse(entry.jsonText) as T;
  }
  return entry.value as T;
}

function toNativeJsonText(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('原生存储 JSON 值不能为 undefined。');
  }
  return serialized;
}

function jsonTextToBytes(jsonText: string) {
  return new TextEncoder().encode(jsonText);
}

function estimateNativeKvMutationBytes(
  mutation: { type: 'set'; key: string; jsonText: string } | { type: 'delete'; key: string }
) {
  return jsonTextToBytes(JSON.stringify(mutation)).length;
}

function fnv1a32Hex(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function createWriteId() {
  return `json-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

async function readNativeEntryValue<T>(storeName: string, key: string): Promise<T | null> {
  const result = await NativePersistence.get({ storeName, key });
  if (!result.exists) return null;
  if (result.kind === 'json' && result.readMode === 'chunked') {
    if (
      !NativePersistence.readJsonChunk
      || typeof result.byteLength !== 'number'
      || result.byteLength < 0
      || typeof result.checksum !== 'string'
    ) {
      throw new Error('原生存储 JSON 分片读取信息不完整。');
    }
    const bytes = new Uint8Array(result.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const expectedLength = Math.min(NATIVE_JSON_READ_CHUNK_BYTES, bytes.length - offset);
      const chunkResult = await NativePersistence.readJsonChunk({
        storeName,
        key,
        offset,
        length: expectedLength
      });
      const chunk = base64ToBytes(chunkResult.chunkBase64);
      if (chunkResult.byteLength !== chunk.length || chunk.length !== expectedLength) {
        throw new Error('原生存储 JSON 分片读取长度不一致。');
      }
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (fnv1a32Hex(bytes) !== result.checksum) {
      throw new Error('原生存储 JSON 分片读取校验失败。');
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  return entryValue<T>(result);
}

async function writeNativeJsonText(storeName: string, key: string, jsonText: string) {
  const bytes = jsonTextToBytes(jsonText);
  if (bytes.length <= NATIVE_JSON_CHUNK_THRESHOLD) {
    await NativePersistence.set({
      storeName,
      key,
      kind: 'json',
      jsonText
    });
    return;
  }

  const writeId = createWriteId();
  const chunkCount = Math.ceil(bytes.length / NATIVE_JSON_CHUNK_BYTES);
  const expectedChecksum = fnv1a32Hex(bytes);
  await NativePersistence.beginJsonWrite({ storeName, key, writeId });
  for (let offset = 0; offset < bytes.length; offset += NATIVE_JSON_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + NATIVE_JSON_CHUNK_BYTES);
    await NativePersistence.appendJsonWriteChunk({
      storeName,
      key,
      writeId,
      chunkBase64: bytesToBase64(chunk)
    });
  }
  await NativePersistence.finishJsonWrite({
    storeName,
    key,
    writeId,
    expectedByteLength: bytes.length,
    expectedChecksum,
    chunkCount
  });
}

export function createNativePersistenceBackend(kvStore: string): PersistenceBackend {
  return {
    localDataCommitMode: 'staged',

    async dbStoreGet<T>(storeName: string, key: string): Promise<T | null> {
      return await readNativeEntryValue<T>(storeName, key);
    },

    async dbStoreSet<T>(storeName: string, key: string, value: T): Promise<void> {
      if (value instanceof Blob) {
        await NativePersistence.set({
          storeName,
          key,
          kind: 'binary',
          dataBase64: await blobToBase64(value),
          mimeType: value.type
        });
        return;
      }

      await writeNativeJsonText(storeName, key, toNativeJsonText(value));
    },

    async dbStoreDelete(storeName: string, key: string): Promise<void> {
      await NativePersistence.delete({ storeName, key });
    },

    async dbStoreEntries<T>(storeName: string): Promise<PersistedDbEntry<T>[]> {
      const result = await NativePersistence.entries({ storeName });
      return result.entries.map((entry) => ({
        key: entry.key,
        value: entryValue<T>(entry)
      }));
    },

    async dbStoreEntrySizes(storeName: string) {
      if (NativePersistence.sizes) {
        const result = await NativePersistence.sizes({ storeName });
        return result.entries.map((entry) => ({
          key: entry.key,
          size: Math.max(0, entry.size)
        }));
      }

      const result = await NativePersistence.keys({ storeName });
      return result.keys.map((key) => ({ key, size: 0 }));
    },

    async dbStoreKeys(storeName: string): Promise<string[]> {
      const result = await NativePersistence.keys({ storeName });
      return result.keys;
    },

    async dbStoreKeysWithPrefix(storeName: string, prefix: string): Promise<string[]> {
      if (NativePersistence.keysWithPrefix) {
        try {
          const result = await NativePersistence.keysWithPrefix({ storeName, keyPrefix: prefix });
          return result.keys;
        } catch {
          // Older native shells may not expose the prefix method yet; keep selfhost bundles readable.
        }
      }
      const result = await NativePersistence.keys({ storeName });
      return result.keys.filter((key) => key.startsWith(prefix));
    },

    async dbStoreClear(storeName: string): Promise<void> {
      await NativePersistence.clear({ storeName });
    },

    async kvApplyMutations(mutations: PersistedKvMutation[]): Promise<void> {
      if (mutations.length === 0) return;
      let batch: Array<{ type: 'set'; key: string; jsonText: string } | { type: 'delete'; key: string }> = [];
      let batchBytes = 0;

      const flushBatch = async () => {
        if (batch.length === 0) return;
        await NativePersistence.applyKvMutations({
          storeName: kvStore,
          mutations: batch
        });
        batch = [];
        batchBytes = 0;
      };

      const pushBatchMutation = async (
        mutation: { type: 'set'; key: string; jsonText: string } | { type: 'delete'; key: string }
      ) => {
        const mutationBytes = estimateNativeKvMutationBytes(mutation);
        if (batch.length > 0 && batchBytes + mutationBytes > NATIVE_KV_MUTATION_BATCH_MAX_BYTES) {
          await flushBatch();
        }
        batch.push(mutation);
        batchBytes += mutationBytes;
      };

      for (const mutation of mutations) {
        if (mutation.type === 'delete') {
          await pushBatchMutation({ type: 'delete', key: mutation.key });
          continue;
        }

        const jsonText = toNativeJsonText(mutation.value);
        if (jsonTextToBytes(jsonText).length <= NATIVE_JSON_CHUNK_THRESHOLD) {
          await pushBatchMutation({ type: 'set', key: mutation.key, jsonText });
          continue;
        }

        await flushBatch();
        await writeNativeJsonText(kvStore, mutation.key, jsonText);
      }
      await flushBatch();
    },

    async kvReplaceAll(entries: PersistedDbEntry[]): Promise<void> {
      await NativePersistence.replaceKv({
        storeName: kvStore,
        entries: entries.map((entry) => ({
          key: entry.key,
          jsonText: toNativeJsonText(entry.value)
        }))
      });
    },

    async getStorageDiagnostic() {
      return {
        mode: 'native',
        label: '原生存储',
        detail: '当前数据读写走设备原生存储。'
      };
    }
  };
}
