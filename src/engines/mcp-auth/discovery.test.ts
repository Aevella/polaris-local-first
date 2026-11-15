import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() }
}));

import {
  authorizationServerMetadataUrls,
  discoverAuthorizationServer,
  discoverProtectedResource,
  protectedResourceMetadataUrls
} from './discovery';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('MCP OAuth discovery', () => {
  it('builds RFC 8414 and OIDC metadata URLs for issuers with a path', () => {
    expect(authorizationServerMetadataUrls('https://auth.example.com/tenant')).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
      'https://auth.example.com/.well-known/openid-configuration/tenant'
    ]);
  });

  it('binds protected resource metadata to the configured MCP URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://auth.example.com'],
      scopes_supported: ['memory.read']
    })) as unknown as typeof fetch;

    await expect(discoverProtectedResource({
      server: { id: 'mcp-1', name: 'Memory', url: 'https://mcp.example.com/mcp/' },
      challenge: {
        scheme: 'Bearer',
        resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource'
      },
      fetchImpl
    })).resolves.toEqual({
      resource: 'https://mcp.example.com/mcp',
      authorizationServers: ['https://auth.example.com'],
      scopesSupported: ['memory.read']
    });
  });

  it('falls back to path-aware then root protected-resource metadata URLs', async () => {
    expect(protectedResourceMetadataUrls('https://mcp.example.com/public/mcp')).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp',
      'https://mcp.example.com/.well-known/oauth-protected-resource'
    ]);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/oauth-protected-resource/public/mcp')) {
        return jsonResponse({ error: 'not found' }, 404);
      }
      return jsonResponse({
        resource: 'https://mcp.example.com/public/mcp',
        authorization_servers: ['https://auth.example.com']
      });
    }) as unknown as typeof fetch;

    await expect(discoverProtectedResource({
      server: { id: 'mcp-1', name: 'Memory', url: 'https://mcp.example.com/public/mcp' },
      challenge: { scheme: 'Bearer' },
      fetchImpl
    })).resolves.toMatchObject({
      resource: 'https://mcp.example.com/public/mcp',
      authorizationServers: ['https://auth.example.com']
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      'https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp',
      expect.anything()
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      'https://mcp.example.com/.well-known/oauth-protected-resource',
      expect.anything()
    );
  });

  it('rejects authorization metadata that does not support PKCE S256', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      code_challenge_methods_supported: ['plain']
    })) as unknown as typeof fetch;

    await expect(discoverAuthorizationServer('https://auth.example.com', fetchImpl))
      .rejects.toThrow('PKCE S256');
  });
});
