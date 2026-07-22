import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web',
  pluginAvailable: false,
  plugin: {
    get: vi.fn(),
    readJsonChunk: vi.fn(),
    set: vi.fn(),
    beginJsonWrite: vi.fn(),
    appendJsonWriteChunk: vi.fn(),
    finishJsonWrite: vi.fn(),
    delete: vi.fn(),
    entries: vi.fn(),
    keys: vi.fn(),
    keysWithPrefix: vi.fn(),
    sizes: vi.fn(),
    clear: vi.fn(),
    applyKvMutations: vi.fn(),
    replaceKv: vi.fn()
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.nativePlatform,
    getPlatform: () => capacitorState.platform,
    isPluginAvailable: () => capacitorState.pluginAvailable
  },
  registerPlugin: vi.fn(() => capacitorState.plugin)
}));

function fnv1a32Hex(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe('native persistence backend', () => {
  beforeEach(() => {
    capacitorState.nativePlatform = false;
    capacitorState.platform = 'web';
    capacitorState.pluginAvailable = false;
    capacitorState.plugin.sizes ??= vi.fn();
    Object.values(capacitorState.plugin).forEach((fn) => fn.mockReset());
    vi.resetModules();
  });

  it('is available for registered iOS and Android native plugins', async () => {
    const { canUseNativePersistenceBackend, getNativePersistencePlatform } = await import('./nativePersistenceBackend');
    expect(canUseNativePersistenceBackend()).toBe(false);
    expect(getNativePersistencePlatform()).toBe(null);

    capacitorState.nativePlatform = true;
    capacitorState.platform = 'ios';
    capacitorState.pluginAvailable = true;
    expect(canUseNativePersistenceBackend()).toBe(true);
    expect(getNativePersistencePlatform()).toBe('ios');

    capacitorState.platform = 'android';
    expect(canUseNativePersistenceBackend()).toBe(true);
    expect(getNativePersistencePlatform()).toBe('android');
  });

  it('stores native-safe JSON values through the native plugin', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');

    await backend.dbStoreSet('kv', 'chat-index-v2', {
      conversations: [{
        id: 'c-1',
        draft: undefined,
        messages: ['hello', undefined]
      }]
    });

    expect(capacitorState.plugin.set).toHaveBeenCalledWith({
      storeName: 'kv',
      key: 'chat-index-v2',
      kind: 'json',
      jsonText: '{"conversations":[{"id":"c-1","messages":["hello",null]}]}'
    });
  });

  it('round-trips binary entries as blobs', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.get.mockResolvedValue({
      exists: true,
      key: 'asset-1',
      kind: 'binary',
      dataBase64: 'aGVsbG8=',
      mimeType: 'text/plain'
    });

    const blob = await backend.dbStoreGet<Blob>('asset-binary', 'asset-1');

    expect(blob).toBeInstanceOf(Blob);
    await expect(blob?.text()).resolves.toBe('hello');
    expect(blob?.type).toBe('text/plain');
  });

  it('parses native JSON text in JavaScript after reading from the plugin', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.get.mockResolvedValue({
      exists: true,
      key: 'chat-index-v2',
      kind: 'json',
      jsonText: '{"conversations":[{"id":"c-1","title":"迁移备份"}]}'
    });
    capacitorState.plugin.entries.mockResolvedValue({
      entries: [{
        key: 'runtime-providers-v2',
        kind: 'json',
        jsonText: '{"providers":[{"name":"Custom"}]}'
      }]
    });

    await expect(backend.dbStoreGet('kv', 'chat-index-v2')).resolves.toEqual({
      conversations: [{ id: 'c-1', title: '迁移备份' }]
    });
    await expect(backend.dbStoreEntries('kv')).resolves.toEqual([{
      key: 'runtime-providers-v2',
      value: { providers: [{ name: 'Custom' }] }
    }]);
  });

  it('reads large native JSON through verified bridge chunks', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    const payload = { body: '星'.repeat(120 * 1024), tail: '完整结尾' };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    capacitorState.plugin.get.mockResolvedValue({
      exists: true,
      key: 'large-conversation',
      kind: 'json',
      readMode: 'chunked',
      byteLength: bytes.length,
      checksum: fnv1a32Hex(bytes)
    });
    capacitorState.plugin.readJsonChunk.mockImplementation(async ({ offset, length }) => {
      const chunk = bytes.subarray(offset, offset + length);
      return {
        chunkBase64: Buffer.from(chunk).toString('base64'),
        byteLength: chunk.length
      };
    });

    await expect(backend.dbStoreGet('kv', 'large-conversation')).resolves.toEqual(payload);

    expect(capacitorState.plugin.get).toHaveBeenCalledOnce();
    expect(capacitorState.plugin.readJsonChunk.mock.calls.length).toBeGreaterThan(1);
    expect(capacitorState.plugin.readJsonChunk.mock.calls.every(([options]) => options.length <= 48 * 1024)).toBe(true);
  });

  it('rejects a large native JSON read when chunk integrity does not match', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    const bytes = new TextEncoder().encode(JSON.stringify({ body: 'x'.repeat(300 * 1024) }));
    capacitorState.plugin.get.mockResolvedValue({
      exists: true,
      key: 'corrupt-conversation',
      kind: 'json',
      readMode: 'chunked',
      byteLength: bytes.length,
      checksum: '00000000'
    });
    capacitorState.plugin.readJsonChunk.mockImplementation(async ({ offset, length }) => {
      const chunk = bytes.subarray(offset, offset + length);
      return {
        chunkBase64: Buffer.from(chunk).toString('base64'),
        byteLength: chunk.length
      };
    });

    await expect(backend.dbStoreGet('kv', 'corrupt-conversation')).rejects.toThrow(
      '原生存储 JSON 分片读取校验失败'
    );
    expect(capacitorState.plugin.get).toHaveBeenCalledOnce();
  });

  it('lists native keys without reading entry payloads', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.keys.mockResolvedValue({
      keys: ['chat-index-v2', 'chat-messages-v2:c1']
    });

    await expect(backend.dbStoreKeys?.('kv')).resolves.toEqual(['chat-index-v2', 'chat-messages-v2:c1']);
    expect(capacitorState.plugin.keys).toHaveBeenCalledWith({ storeName: 'kv' });
    expect(capacitorState.plugin.entries).not.toHaveBeenCalled();
  });

  it('lists native entry sizes without reading entry payloads', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.sizes.mockResolvedValue({
      entries: [
        { key: 'asset-1', size: 12 },
        { key: 'asset-2', size: -1 }
      ]
    });

    await expect(backend.dbStoreEntrySizes?.('asset-binary')).resolves.toEqual([
      { key: 'asset-1', size: 12 },
      { key: 'asset-2', size: 0 }
    ]);
    expect(capacitorState.plugin.sizes).toHaveBeenCalledWith({ storeName: 'asset-binary' });
    expect(capacitorState.plugin.entries).not.toHaveBeenCalled();
  });

  it('falls back to native keys for entry sizes on older shells', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.sizes = undefined as never;
    capacitorState.plugin.keys.mockResolvedValue({
      keys: ['asset-old']
    });

    await expect(backend.dbStoreEntrySizes?.('asset-binary')).resolves.toEqual([
      { key: 'asset-old', size: 0 }
    ]);
    expect(capacitorState.plugin.keys).toHaveBeenCalledWith({ storeName: 'asset-binary' });
    expect(capacitorState.plugin.entries).not.toHaveBeenCalled();
  });

  it('lists native keys by prefix without reading unrelated keys', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.keysWithPrefix.mockResolvedValue({
      keys: ['chat-message-v1:commit:c1']
    });

    await expect(backend.dbStoreKeysWithPrefix?.('kv', 'chat-message-v1:')).resolves.toEqual([
      'chat-message-v1:commit:c1'
    ]);
    expect(capacitorState.plugin.keysWithPrefix).toHaveBeenCalledWith({
      storeName: 'kv',
      keyPrefix: 'chat-message-v1:'
    });
    expect(capacitorState.plugin.keys).not.toHaveBeenCalled();
    expect(capacitorState.plugin.entries).not.toHaveBeenCalled();
  });

  it('falls back to full native keys when an older shell rejects prefix key listing', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    capacitorState.plugin.keysWithPrefix.mockRejectedValue(new Error('not implemented'));
    capacitorState.plugin.keys.mockResolvedValue({
      keys: ['chat-message-v1:commit:c1', 'persona-state-v2']
    });

    await expect(backend.dbStoreKeysWithPrefix?.('kv', 'chat-message-v1:')).resolves.toEqual([
      'chat-message-v1:commit:c1'
    ]);
    expect(capacitorState.plugin.keysWithPrefix).toHaveBeenCalledWith({
      storeName: 'kv',
      keyPrefix: 'chat-message-v1:'
    });
    expect(capacitorState.plugin.keys).toHaveBeenCalledWith({ storeName: 'kv' });
  });

  it('sends large JSON values through chunked native writes', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    const payload = { body: '春'.repeat(120 * 1024) };

    await backend.dbStoreSet('kv', 'chat-index-v2', payload);

    expect(capacitorState.plugin.set).not.toHaveBeenCalled();
    expect(capacitorState.plugin.beginJsonWrite).toHaveBeenCalledWith({
      storeName: 'kv',
      key: 'chat-index-v2',
      writeId: expect.any(String)
    });
    const writeId = capacitorState.plugin.beginJsonWrite.mock.calls[0][0].writeId;
    expect(capacitorState.plugin.appendJsonWriteChunk).toHaveBeenCalled();
    expect(capacitorState.plugin.appendJsonWriteChunk.mock.calls.every(([options]) =>
      options.storeName === 'kv'
      && options.key === 'chat-index-v2'
      && options.writeId === writeId
      && typeof options.chunkBase64 === 'string'
      && options.chunkBase64.length <= 64 * 1024
      && !('chunk' in options)
    )).toBe(true);
    const reconstructed = Buffer.concat(
      capacitorState.plugin.appendJsonWriteChunk.mock.calls.map(([options]) => Buffer.from(options.chunkBase64, 'base64'))
    );
    expect(reconstructed.toString('utf8')).toBe(JSON.stringify(payload));
    expect(capacitorState.plugin.finishJsonWrite).toHaveBeenCalledWith({
      storeName: 'kv',
      key: 'chat-index-v2',
      writeId,
      expectedByteLength: reconstructed.length,
      expectedChecksum: fnv1a32Hex(new Uint8Array(reconstructed)),
      chunkCount: capacitorState.plugin.appendJsonWriteChunk.mock.calls.length
    });
  });

  it('applies small KV mutations through one native batch', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');

    await backend.kvApplyMutations([
      { type: 'set', key: 'runtime-providers-v2', value: { providers: [{ name: 'Custom', apiKey: undefined }] } },
      { type: 'delete', key: 'chat-index-v2-pending' }
    ]);

    expect(capacitorState.plugin.applyKvMutations).toHaveBeenCalledWith({
      storeName: 'kv',
      mutations: [
        {
          type: 'set',
          key: 'runtime-providers-v2',
          jsonText: '{"providers":[{"name":"Custom"}]}'
        },
        { type: 'delete', key: 'chat-index-v2-pending' }
      ]
    });
    expect(capacitorState.plugin.set).not.toHaveBeenCalled();
    expect(capacitorState.plugin.delete).not.toHaveBeenCalled();
  });

  it('splits accumulated small KV mutations before the native bridge payload gets large', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    const payload = { body: 'x'.repeat(70 * 1024) };

    await backend.kvApplyMutations([
      { type: 'set', key: 'doc-1', value: payload },
      { type: 'set', key: 'doc-2', value: payload },
      { type: 'set', key: 'doc-3', value: payload },
      { type: 'set', key: 'doc-4', value: payload }
    ]);

    expect(capacitorState.plugin.applyKvMutations.mock.calls.length).toBeGreaterThan(1);
    const flattenedMutations = capacitorState.plugin.applyKvMutations.mock.calls
      .flatMap(([options]) => options.mutations);
    expect(flattenedMutations.map((mutation) => mutation.key)).toEqual(['doc-1', 'doc-2', 'doc-3', 'doc-4']);
    expect(flattenedMutations.every((mutation) =>
      mutation.type === 'set' && mutation.jsonText === JSON.stringify(payload)
    )).toBe(true);
    expect(capacitorState.plugin.beginJsonWrite).not.toHaveBeenCalled();
  });

  it('keeps large KV mutation values on the chunked checksum path', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');
    const largePayload = { body: '春'.repeat(120 * 1024) };

    await backend.kvApplyMutations([
      { type: 'set', key: 'before-large', value: { ok: true } },
      { type: 'set', key: 'large-chat-manifest', value: largePayload },
      { type: 'delete', key: 'after-large-delete' }
    ]);

    expect(capacitorState.plugin.applyKvMutations).toHaveBeenNthCalledWith(1, {
      storeName: 'kv',
      mutations: [{
        type: 'set',
        key: 'before-large',
        jsonText: '{"ok":true}'
      }]
    });
    expect(capacitorState.plugin.beginJsonWrite).toHaveBeenCalledWith({
      storeName: 'kv',
      key: 'large-chat-manifest',
      writeId: expect.any(String)
    });
    expect(capacitorState.plugin.finishJsonWrite).toHaveBeenCalled();
    expect(capacitorState.plugin.applyKvMutations).toHaveBeenNthCalledWith(2, {
      storeName: 'kv',
      mutations: [{ type: 'delete', key: 'after-large-delete' }]
    });
    expect(capacitorState.plugin.set).not.toHaveBeenCalled();
    expect(capacitorState.plugin.delete).not.toHaveBeenCalled();
  });

  it('replaces KV payloads through native staged replacement', async () => {
    const { createNativePersistenceBackend } = await import('./nativePersistenceBackend');
    const backend = createNativePersistenceBackend('kv');

    await backend.kvReplaceAll([
      { key: 'chat-index-v2', value: { conversations: [{ id: 'c-1', toolLedger: undefined }] } }
    ]);

    expect(capacitorState.plugin.replaceKv).toHaveBeenCalledWith({
      storeName: 'kv',
      entries: [{
        key: 'chat-index-v2',
        jsonText: '{"conversations":[{"id":"c-1"}]}'
      }]
    });
    expect(capacitorState.plugin.clear).not.toHaveBeenCalled();
    expect(capacitorState.plugin.set).not.toHaveBeenCalled();
  });
});
