import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDbPersistenceBackend } from './indexedDbPersistenceBackend';

const config = { dbName: 'test', dbVersion: 1, kvStore: 'kv', assetBinaryStore: 'binary', assetMetaStore: 'meta', assetPreviewStore: 'preview', openTimeoutMs: 100, transactionTimeoutMs: 100 };
afterEach(() => vi.unstubAllGlobals());

describe('IndexedDB transaction failures', () => {
  it.each(['mutations', 'replace'] as const)('aborts queued writes when %s input throws synchronously', async (operation) => {
    const error = new DOMException('not cloneable', 'DataCloneError');
    const abort = vi.fn();
    const put = vi.fn().mockImplementationOnce(() => ({})).mockImplementationOnce(() => { throw error; });
    const tx = { objectStore: () => ({ put, clear: vi.fn() }), abort };
    const db = { transaction: () => tx, close: vi.fn() };
    vi.stubGlobal('indexedDB', { open: () => {
      const request = { result: db, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });
    const backend = createIndexedDbPersistenceBackend(config);
    const entries = [{ key: 'first', value: 1 }, { key: 'bad', value: () => 1 }];
    const promise = operation === 'replace' ? backend.kvReplaceAll(entries) : backend.kvApplyMutations(entries.map(entry => ({ type: 'set', ...entry })));
    await expect(promise).rejects.toBe(error);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('does not turn unavailable storage into an empty read or successful write', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const backend = createIndexedDbPersistenceBackend(config);
    await expect(backend.dbStoreGet('kv', 'existing')).rejects.toThrow();
    await expect(backend.dbStoreSet('kv', 'existing', 'new')).rejects.toThrow();
    await expect(backend.kvReplaceAll([])).rejects.toThrow();
  });
});
