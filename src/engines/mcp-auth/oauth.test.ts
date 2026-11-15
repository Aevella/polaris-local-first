import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    isPluginAvailable: () => false
  },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: vi.fn(() => ({}))
}));

import type { McpServerConfig } from '../../types/domain';
import {
  beginMcpOAuthAuthorization,
  completeMcpOAuthAuthorization,
  getMcpOAuthAuthorizationHeader,
  getMcpOAuthNativeRelayUrl,
  getMcpOAuthRedirectUri
} from './oauth';
import {
  clearMcpOAuthSecretStoreForTests,
  readMcpOAuthToken,
  writeMcpOAuthToken
} from './secureStore';

function server(): McpServerConfig {
  return {
    id: 'mcp-memory',
    handle: 'memory',
    name: 'Memory',
    description: '',
    transport: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    oauthClientId: 'polaris-public-client',
    headers: [],
    tools: [],
    isActive: true
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('MCP OAuth authorization', () => {
  beforeEach(() => {
    clearMcpOAuthSecretStoreForTests();
  });

  it('creates a resource-bound PKCE authorization request and exchanges the callback', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth-resource')) {
        return jsonResponse({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://auth.example.com'],
          scopes_supported: ['memory.read']
        });
      }
      if (url.includes('.well-known/oauth-authorization-server')) {
        return jsonResponse({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          code_challenge_methods_supported: ['S256']
        });
      }
      if (url.endsWith('/token')) {
        expect(String(init?.body)).toContain('resource=https%3A%2F%2Fmcp.example.com%2Fmcp');
        expect(String(init?.body)).toContain('code_verifier=');
        return jsonResponse({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'memory.read'
        });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    }) as unknown as typeof fetch;

    const started = await beginMcpOAuthAuthorization({
      server: server(),
      challenge: {
        scheme: 'Bearer',
        resourceMetadataUrl: 'https://mcp.example.com/oauth-resource'
      },
      redirectUri: 'https://polaris.example.com/oauth/callback',
      fetchImpl
    });
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.searchParams.get('client_id')).toBe('polaris-public-client');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(authorizationUrl.searchParams.get('state')).toBe(started.state);

    const completed = await completeMcpOAuthAuthorization(
      `https://polaris.example.com/oauth/callback?mcp_oauth_callback=1&code=code-1&state=${started.state}`,
      fetchImpl
    );
    expect(completed).toEqual({ serverId: 'mcp-memory' });
    expect(await readMcpOAuthToken('mcp-memory')).toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      resource: 'https://mcp.example.com/mcp'
    });
  });

  it('refreshes an expired token before returning the Authorization header', async () => {
    await writeMcpOAuthToken('mcp-memory', {
      accessToken: 'expired',
      refreshToken: 'refresh-secret',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1,
      resource: 'https://mcp.example.com/mcp',
      authorizationServer: 'https://auth.example.com',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'polaris-public-client'
    });
    const fetchImpl = vi.fn(async () => jsonResponse({
      access_token: 'fresh',
      token_type: 'Bearer',
      expires_in: 3600
    })) as unknown as typeof fetch;

    await expect(getMcpOAuthAuthorizationHeader(server(), fetchImpl)).resolves.toBe('Bearer fresh');
  });

  it('drops a token when its resource no longer matches the configured server', async () => {
    await writeMcpOAuthToken('mcp-memory', {
      accessToken: 'secret',
      tokenType: 'Bearer',
      resource: 'https://other.example.com/mcp',
      authorizationServer: 'https://auth.example.com',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'polaris-public-client'
    });

    await expect(getMcpOAuthAuthorizationHeader(server())).resolves.toBeNull();
    await expect(readMcpOAuthToken('mcp-memory')).resolves.toBeNull();
  });

  it('relays an HTTPS native callback into the registered Polaris deep link', () => {
    expect(getMcpOAuthNativeRelayUrl(
      'https://selfhost.example.test/?mcp_oauth_callback=1&mcp_oauth_native=1&code=code-1&state=state-1'
    )).toBe('polaris://mcp/oauth/callback?code=code-1&state=state-1');
  });
});

it('uses the deployer callback origin for native OAuth', () => {
  const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
  vi.stubEnv('VITE_POLARIS_MCP_OAUTH_REDIRECT_URI', 'https://selfhost.example.test/app?old=1');
  try {
    expect(getMcpOAuthRedirectUri()).toBe('https://selfhost.example.test/app?mcp_oauth_callback=1&mcp_oauth_native=1');
  } finally { native.mockRestore(); vi.unstubAllEnvs(); }
});
