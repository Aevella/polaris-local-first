import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({})
}));
import { writeMcpOAuthToken } from './secureStore';
function installDatabase() {
  const request = { result: 'key', onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
  const put = vi.fn(() => request);
  const transaction = { objectStore: () => ({ put }), error: null as Error | null,
    oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null };
  const close = vi.fn();
  const database = { transaction: () => transaction, close };
  vi.stubGlobal('indexedDB', { open: () => {
    const opened = { result: database, onsuccess: null as (() => void) | null };
    queueMicrotask(() => opened.onsuccess?.()); return opened;
  } });
  return { request, transaction, close, put };
}
const token = { accessToken: 'synthetic', tokenType: 'Bearer', resource: 'https://service.example/mcp', authorizationServer: 'https://auth.example', tokenEndpoint: 'https://auth.example/token', clientId: 'synthetic' };
afterEach(() => vi.unstubAllGlobals());
describe('web OAuth credential transaction acknowledgement', () => {
  it('does not acknowledge a successful request whose transaction later aborts', async () => {
    const db = installDatabase(); let acknowledged = false;
    const pending = writeMcpOAuthToken('synthetic', token);
    pending.then(() => { acknowledged = true; }, () => {});
    await vi.waitFor(() => expect(db.put).toHaveBeenCalledOnce());
    db.request.onsuccess?.(); await Promise.resolve();
    expect(acknowledged).toBe(false); expect(db.close).not.toHaveBeenCalled();
    const rejected = expect(pending).rejects.toThrow('commit aborted');
    db.transaction.error = new Error('commit aborted'); db.transaction.onabort?.();
    await rejected; expect(db.close).toHaveBeenCalledOnce();
  });
  it('acknowledges only after the transaction completes', async () => {
    const db = installDatabase(); let acknowledged = false;
    const pending = writeMcpOAuthToken('synthetic', token).then(() => { acknowledged = true; });
    await vi.waitFor(() => expect(db.put).toHaveBeenCalledOnce());
    db.request.onsuccess?.(); await Promise.resolve(); expect(acknowledged).toBe(false);
    db.transaction.oncomplete?.(); await pending;
    expect(acknowledged).toBe(true); expect(db.close).toHaveBeenCalledOnce();
  });
});
