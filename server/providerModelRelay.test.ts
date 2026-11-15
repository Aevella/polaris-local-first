import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '203.0.113.7' }]) }));
import handler from '../api/provider-models.js';
function response() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
afterEach(() => vi.unstubAllGlobals());
describe('provider model list relay', () => {
  it('fetches the public model catalog with authentication and no request body', async () => {
    const fetch = vi.fn(async () => new Response('{"data":[{"id":"synthetic"}]}', { status: 200 }));
    vi.stubGlobal('fetch', fetch); const res = response();
    await handler({ method: 'POST', headers: {}, body: { endpoint: 'https://provider.example/v1/models', headers: { Authorization: 'Bearer synthetic-token', Host: 'ignored' } } } as VercelRequest, res as unknown as VercelResponse);
    expect(fetch).toHaveBeenCalledWith('https://provider.example/v1/models', { method: 'GET', headers: { Authorization: 'Bearer synthetic-token' }, redirect: 'error' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('{"data":[{"id":"synthetic"}]}');
  });
  it.each(['https://127.0.0.1/v1/models', 'https://provider.example/v1/chat/completions'])('rejects invalid model targets: %s', async (endpoint) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const res = response();
    await handler({ method: 'POST', headers: {}, body: { endpoint, headers: { Authorization: 'Bearer synthetic' } } } as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a public hostname resolving to a private address', async () => {
    const { lookup } = await import('node:dns/promises');
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const res = response();
    await handler({ method: 'POST', headers: {}, body: { endpoint: 'https://provider.example/v1/models', headers: { Authorization: 'Bearer synthetic' } } } as VercelRequest, res as unknown as VercelResponse);
    expect(res.status).toHaveBeenCalledWith(400); expect(fetch).not.toHaveBeenCalled();
  });
});
