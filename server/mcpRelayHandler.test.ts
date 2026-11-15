import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
vi.mock('./mcpRelay.js', async (original) => ({
  ...await original<typeof import('./mcpRelay.js')>(),
  relayMcpRequest: vi.fn(async () => new Response('{"tools":[]}', { status: 200 }))
}));
import { relayMcpRequest } from './mcpRelay.js';
import handler from '../api/mcp-relay.js';
function response() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn(), write: vi.fn(() => true) };
  res.status.mockReturnValue(res); return res;
}
describe('MCP relay deployment origin', () => {
  it('serves the same custom HTTPS domain', async () => {
    vi.mocked(relayMcpRequest).mockClear(); const res = response();
    await handler({ method: 'POST', headers: { host: 'selfhost.example.test', origin: 'https://selfhost.example.test' }, body: { endpoint: 'https://tools.example/mcp' } } as VercelRequest, res as unknown as VercelResponse);
    expect(relayMcpRequest).toHaveBeenCalledOnce(); expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://selfhost.example.test');
  });
  it('does not accept a different origin just because a custom host exists', async () => {
    vi.mocked(relayMcpRequest).mockClear(); const res = response();
    await handler({ method: 'POST', headers: { host: 'selfhost.example.test', origin: 'https://other.example.test' }, body: {} } as VercelRequest, res as unknown as VercelResponse);
    expect(relayMcpRequest).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(403);
  });
});
