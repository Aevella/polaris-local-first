import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) }
}));

vi.mock('../chat-api/chatApiEndpoint', () => ({
  buildInternalApiEndpoint: () => 'https://selfhost.example.test/api/mcp-relay'
}));

import { requestBrowserMcpRelay, shouldUseBrowserMcpRelay } from './browserRelay';

describe('MCP browser relay', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { origin: 'https://selfhost.example.test' });
  });

  it('uses the relay only for public cross-origin HTTPS MCP requests', () => {
    expect(shouldUseBrowserMcpRelay('https://mcp.example.com/mcp')).toBe(true);
    expect(shouldUseBrowserMcpRelay('https://selfhost.example.test/mcp')).toBe(false);
    expect(shouldUseBrowserMcpRelay('http://127.0.0.1:8787/mcp')).toBe(false);
    expect(shouldUseBrowserMcpRelay('https://mcp.example.com/mcp', vi.fn() as unknown as typeof fetch)).toBe(false);
  });

  it('reconstructs upstream OAuth headers and status without exposing relay cookies', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(
      '{"message":"Unauthorized"}',
      {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/oauth-resource"'
        }
      }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await requestBrowserMcpRelay('https://mcp.example.com/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer device-token' },
      body: '{}'
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      endpoint: 'https://mcp.example.com/mcp',
      method: 'POST',
      headers: { authorization: 'Bearer device-token' },
      body: '{}'
    });
  });
});
