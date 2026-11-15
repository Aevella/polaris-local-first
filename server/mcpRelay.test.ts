import { describe, expect, it, vi } from 'vitest';
import { McpRelayTargetError, relayMcpRequest, validateMcpRelayTarget } from './mcpRelay.js';

const publicLookup = async () => [{ address: '203.0.113.10' }];

describe('MCP Web relay', () => {
  it('rejects private destinations resolved from a public-looking hostname', async () => {
    await expect(validateMcpRelayTarget(
      'https://mcp.example.com/mcp',
      async () => [{ address: '127.0.0.1' }]
    )).rejects.toBeInstanceOf(McpRelayTargetError);
  });

  it('preserves MCP and OAuth response evidence while stripping cookies', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer device-token');
      expect(new Headers(init?.headers).get('host')).toBeNull();
      expect(init?.redirect).toBe('manual');
      return new Response('{"message":"Unauthorized"}', {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/oauth-resource"',
          'set-cookie': 'secret=hidden'
        }
      });
    });

    const response = await relayMcpRequest({
      endpoint: 'https://mcp.example.com/mcp',
      method: 'POST',
      headers: { Authorization: 'Bearer device-token', Host: 'internal.example.com' },
      body: '{}'
    }, { fetchImpl: fetchImpl as typeof fetch, lookupAddress: publicLookup });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('{"message":"Unauthorized"}');
  });

  it('revalidates redirected destinations before following them', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/private' }
    }));

    await expect(relayMcpRequest({
      endpoint: 'https://mcp.example.com/mcp',
      method: 'GET',
      headers: {},
      body: null
    }, { fetchImpl: fetchImpl as typeof fetch, lookupAddress: publicLookup }))
      .rejects.toBeInstanceOf(McpRelayTargetError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('drops credentials when a safe redirect crosses origins', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response(null, {
          status: 307,
          headers: { location: 'https://auth.example.com/token' }
        });
      }
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(new Headers(init?.headers).get('x-custom-secret')).toBeNull();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const response = await relayMcpRequest({
      endpoint: 'https://mcp.example.com/mcp',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
        'X-Custom-Secret': 'secret'
      },
      body: '{}'
    }, { fetchImpl: fetchImpl as typeof fetch, lookupAddress: publicLookup });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
