import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeMcpSsePluginMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(async () => undefined),
  addListener: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
    isPluginAvailable: vi.fn(() => false)
  },
  CapacitorHttp: {
    request: vi.fn()
  },
  registerPlugin: vi.fn(() => nativeMcpSsePluginMock)
}));

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  clearMcpToolCatalogCacheForTests,
  invokeMcpTool,
  primeMcpSessions,
  resolveMcpToolCatalog,
  resolveSavedMcpToolCatalog
} from './mcpRuntime';
import type { McpServerConfig } from '../types/domain';
import {
  clearMcpOAuthSecretStoreForTests,
  writeMcpOAuthToken
} from './mcp-auth/secureStore';

function createServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-1',
    handle: 'weather',
    name: 'Weather MCP',
    description: '',
    transport: 'streamable-http',
    url: 'https://mcp.example.com',
    headers: [],
    isActive: true,
    ...overrides
  };
}

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });
}

function createNativeResponse(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    data,
    status: init?.status ?? 200,
    headers: init?.headers ?? {},
    url: 'https://mcp.example.com'
  };
}

describe('mcpRuntime', () => {
  afterEach(async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    vi.mocked(CapacitorHttp.request).mockReset();
    nativeMcpSsePluginMock.open.mockReset();
    nativeMcpSsePluginMock.close.mockReset();
    nativeMcpSsePluginMock.close.mockResolvedValue(undefined);
    nativeMcpSsePluginMock.addListener.mockReset();
    await clearMcpToolCatalogCacheForTests();
    clearMcpOAuthSecretStoreForTests();
    vi.unstubAllGlobals();
  });

  it('does not expose a saved tool directory before the server session is available', () => {
    const result = resolveSavedMcpToolCatalog({
      servers: [createServer({
        tools: [{
          name: 'get_weather',
          description: 'Get weather by city',
          inputSchema: { type: 'object' },
          enabled: true
        }]
      })]
    });

    expect(result.tools).toEqual([]);
    expect(result.errors[0]).toContain('正在后台确认连接');
  });

  it('builds the request tool catalog from saved rows after a background session prime', async () => {
    const server = createServer({
      tools: [{
        name: 'get_weather',
        description: 'Get weather by city',
        inputSchema: { type: 'object' },
        enabled: true
      }]
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        });
      }
      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      throw new Error(`Unexpected request-time MCP call: ${body?.method ?? init?.method ?? 'GET'}`);
    });

    await primeMcpSessions({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });
    fetchMock.mockClear();
    const result = resolveSavedMcpToolCatalog({ servers: [server] });

    expect(result.errors).toEqual([]);
    expect(result.tools).toEqual([
      expect.objectContaining({
        serverId: 'server-1',
        toolName: 'get_weather',
        schemaName: 'mcp__weather__get_weather'
      })
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unsynced saved catalog after the server session is available', async () => {
    const server = createServer({ tools: [] });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        });
      }
      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      throw new Error(`Unexpected request-time MCP call: ${body?.method ?? init?.method ?? 'GET'}`);
    });

    await primeMcpSessions({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });
    const result = resolveSavedMcpToolCatalog({
      servers: [server]
    });

    expect(result.tools).toEqual([]);
    expect(result.errors[0]).toContain('还没有已保存的工具目录');
  });

  it('keeps an offline MCP probe out of the synchronous request catalog', async () => {
    let rejectProbe!: (error: Error) => void;
    const pendingProbe = new Promise<Response>((_resolve, reject) => {
      rejectProbe = reject;
    });
    const fetchMock = vi.fn(() => pendingProbe);
    const server = createServer({
      tools: [{
        name: 'get_weather',
        description: 'Get weather by city',
        inputSchema: { type: 'object' },
        enabled: true
      }]
    });

    const priming = primeMcpSessions({
      servers: [server],
      timeoutSeconds: 30,
      fetchImpl: fetchMock as typeof fetch
    });
    const duringProbe = resolveSavedMcpToolCatalog({ servers: [server] });

    expect(duringProbe.tools).toEqual([]);
    expect(duringProbe.errors[0]).toContain('正在后台确认连接');

    rejectProbe(new Error('offline'));
    await priming;
    const afterFailure = resolveSavedMcpToolCatalog({ servers: [server] });
    expect(afterFailure.tools).toEqual([]);
    expect(afterFailure.errors[0]).toContain('当前连接不可用');
  });

  it('lists streamable-http MCP tools into Polaris tool definitions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-1'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'get_weather',
              description: 'Get weather by city',
              inputSchema: {
                type: 'object',
                properties: {
                  city: {
                    type: 'string'
                  }
                },
                required: ['city']
              }
            }]
          }
        });
      }

      if (init?.method === 'DELETE' && String(input) === 'https://mcp.example.com') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(input)} ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result.errors).toEqual([]);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-1',
      serverName: 'Weather MCP',
      toolName: 'get_weather'
    });
    expect(result.tools[0]?.schemaName).toContain('mcp__weather__get_weather');
  });

  it('returns an authorization request when an MCP server challenges with OAuth metadata', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/oauth-resource", scope="tools.read"'
      }
    }));

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });

    expect(result.errors).toEqual([]);
    expect(result.authorizationRequests).toEqual([{
      serverId: 'server-1',
      serverName: 'Weather MCP',
      serverUrl: 'https://mcp.example.com',
      challenge: {
        scheme: 'Bearer',
        resourceMetadataUrl: 'https://mcp.example.com/oauth-resource',
        scope: 'tools.read'
      }
    }]);
  });

  it('returns an authorization request for a browser 401 whose challenge header is hidden by CORS', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });

    expect(result.errors).toEqual([]);
    expect(result.authorizationRequests).toEqual([expect.objectContaining({
      serverId: 'server-1',
      challenge: { scheme: 'Bearer' }
    })]);
  });

  it('injects a device OAuth token at the MCP connection boundary', async () => {
    await writeMcpOAuthToken('server-1', {
      accessToken: 'device-token',
      tokenType: 'Bearer',
      resource: 'https://mcp.example.com',
      authorizationServer: 'https://auth.example.com',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'polaris'
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer device-token');
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        }, { headers: { 'content-type': 'application/json', 'Mcp-Session-Id': 'oauth-session' } });
      }
      if (body?.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'get_weather' }] }
        });
      }
      throw new Error('Unexpected request');
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });
    expect(result.tools).toHaveLength(1);
  });

  it('reuses one initialized session for catalog discovery and tool calls', async () => {
    let initializeCount = 0;
    let listCount = 0;
    let callCount = 0;
    let deleteCount = 0;
    let callArguments: unknown;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        initializeCount += 1;
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-reused'
          }
        });
      }
      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      if (body?.method === 'tools/list') {
        listCount += 1;
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{ name: 'get_weather', description: 'Get weather' }]
          }
        });
      }
      if (body?.method === 'tools/call') {
        callCount += 1;
        callArguments = body.params?.arguments;
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'sunny' }] }
        });
      }
      if (init?.method === 'DELETE') {
        deleteCount += 1;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const catalog = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });
    const tool = catalog.tools[0];
    expect(tool).toBeDefined();
    await invokeMcpTool({
      tool: tool!,
      argumentsObject: {
        command: 'help',
        args: {
          path: 'account'
        }
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(initializeCount).toBe(1);
    expect(listCount).toBe(1);
    expect(callCount).toBe(1);
    expect(callArguments).toEqual({
      command: 'help',
      args: {
        path: 'account'
      }
    });
    expect(deleteCount).toBe(0);
  });

  it('uses the actual transport even when the WebView reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return createJsonResponse({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        : { content: [{ type: 'text', text: 'connected' }] } });
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object' }
      },
      argumentsObject: {},
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toMatchObject({ ok: true, detailText: 'connected' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not wait for an offline remote session close after a tool call fails', async () => {
    let closeStarted!: () => void;
    const closeStartedPromise = new Promise<void>((resolve) => {
      closeStarted = resolve;
    });
    let releaseClose!: (response: Response) => void;
    const delayedClose = new Promise<Response>((resolve) => {
      releaseClose = resolve;
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'offline-after-connect'
          }
        });
      }
      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'get_weather' }] }
        });
      }
      if (body?.method === 'tools/call') {
        throw new Error('server went offline');
      }
      if (init?.method === 'DELETE') {
        closeStarted();
        return await delayedClose;
      }
      throw new Error(`Unexpected request: ${body?.method ?? init?.method ?? 'GET'}`);
    });
    const catalog = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });

    const invocationOutcome = invokeMcpTool({
      tool: catalog.tools[0]!,
      argumentsObject: { city: 'Shanghai' },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    }).then(
      () => 'resolved' as const,
      (error: unknown) => error instanceof Error && error.message.includes('server went offline')
        ? 'failed-with-offline' as const
        : 'failed-with-other-error' as const
    );
    const outcomeBeforeRemoteClose = await Promise.race([
      invocationOutcome,
      new Promise<'still-waiting'>((resolve) => {
        globalThis.setTimeout(() => resolve('still-waiting'), 100);
      })
    ]);
    await closeStartedPromise;
    releaseClose(new Response(null, { status: 204 }));
    expect(outcomeBeforeRemoteClose).toBe('failed-with-offline');

    const savedCatalog = resolveSavedMcpToolCatalog({
      servers: [createServer({
        tools: [{
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object' },
          enabled: true
        }]
      })]
    });
    expect(savedCatalog.tools).toEqual([]);
    expect(savedCatalog.errors[0]).toContain('当前连接不可用');
  });

  it('filters disabled MCP tools unless the caller is syncing the server catalog', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-filter'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'read_notes', description: 'Read notes' },
              { name: 'delete_notes', description: 'Delete notes' }
            ]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(_input)} ${init?.method ?? 'GET'}`);
    });

    const server = createServer({
      tools: [{
        name: 'delete_notes',
        description: 'Delete notes',
        inputSchema: { type: 'object' },
        enabled: false
      }]
    });

    const visible = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });
    const syncing = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [],
      includeDisabledTools: true
    });

    expect(visible.tools.map((tool) => tool.toolName)).toEqual(['read_notes']);
    expect(syncing.tools.map((tool) => [tool.toolName, tool.enabled])).toEqual([
      ['read_notes', true],
      ['delete_notes', false]
    ]);
  });

  it.each(['ios', 'android'] as const)('uses CapacitorHttp for streamable-http MCP on native %s', async (platform) => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    const nativeRequestMock = vi.mocked(CapacitorHttp.request).mockImplementation(async (options) => {
      const body = typeof options.data === 'string' ? JSON.parse(options.data) : null;

      if (body?.method === 'initialize') {
        return createNativeResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-native'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return createNativeResponse('', {
          status: 202
        });
      }

      if (body?.method === 'tools/list') {
        return createNativeResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'get_weather',
              description: 'Get weather by city',
              inputSchema: {
                type: 'object',
                properties: {
                  city: {
                    type: 'string'
                  }
                }
              }
            }]
          }
        }, {
          headers: {
            'content-type': 'application/json'
          }
        });
      }

      if (options.method === 'DELETE') {
        return createNativeResponse('', {
          status: 204
        });
      }

      throw new Error(`Unexpected native request: ${options.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(`fetch should not be used on native ${platform} streamable-http`);
    }));

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-1',
      toolName: 'get_weather'
    });
    expect(nativeRequestMock).toHaveBeenCalled();
  });

  it.each(['ios', 'android'] as const)('uses the native SSE stream and native HTTP posts on %s', async (platform) => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    vi.mocked(Capacitor.isPluginAvailable).mockImplementation((name) => name === 'NativeMcpSse');
    const removeListener = vi.fn(async () => undefined);
    nativeMcpSsePluginMock.addListener.mockResolvedValue({ remove: removeListener });
    nativeMcpSsePluginMock.open.mockResolvedValue({
      endpoint: 'https://legacy.example.com/messages'
    });
    const nativeRequestMock = vi.mocked(CapacitorHttp.request).mockImplementation(async (options) => {
      const body = typeof options.data === 'string' ? JSON.parse(options.data) : null;
      if (body?.method === 'initialize') {
        return createNativeResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
        }, { headers: { 'content-type': 'application/json' } });
      }
      if (body?.method === 'notifications/initialized') {
        return createNativeResponse('', { status: 202 });
      }
      if (body?.method === 'tools/list') {
        return createNativeResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'search_docs', description: 'Search docs' }] }
        }, { headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected native SSE post: ${body?.method ?? options.method}`);
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('WebView fetch must not be used for native SSE');
    }));

    const result = await resolveMcpToolCatalog({
      servers: [createServer({
        id: 'server-native-sse',
        handle: 'docs',
        name: 'Docs MCP',
        transport: 'sse',
        url: 'https://legacy.example.com/sse'
      })],
      timeoutSeconds: 5,
      retryDelaysMs: []
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]?.toolName).toBe('search_docs');
    expect(nativeMcpSsePluginMock.open).toHaveBeenCalledTimes(1);
    expect(nativeRequestMock).toHaveBeenCalled();
  });

  it('retries MCP catalog reads before hiding tools from the directory', async () => {
    let initializeAttempts = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        initializeAttempts += 1;
        if (initializeAttempts === 1) {
          throw new Error('temporary network drop');
        }
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-retry'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'search_memory',
              description: 'Search memory'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [0]
    });

    expect(initializeAttempts).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.tools[0]?.toolName).toBe('search_memory');
  });

  it('keeps the last successful MCP tool directory when a heartbeat refresh fails', async () => {
    const successFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-cache'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'read_notes',
              description: 'Read notes'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: successFetch as typeof fetch,
      retryDelaysMs: []
    });

    const failingFetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: failingFetch as typeof fetch,
      retryDelaysMs: []
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]?.toolName).toBe('read_notes');
  });

  it('supports legacy SSE transport when the POST endpoint returns JSON-RPC responses', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages\n\n'));
          init.signal?.addEventListener('abort', () => controller.error(new Error('closed')));
        } });
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream'
          }
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'search_docs',
              description: 'Search docs',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string'
                  }
                }
              }
            }]
          }
        });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer({
        id: 'server-2',
        handle: 'docs',
        name: 'Docs MCP',
        transport: 'sse',
        url: 'https://legacy.example.com/sse'
      })],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-2',
      toolName: 'search_docs',
      schemaName: 'mcp__docs__search_docs'
    });
  });

  it('calls a discovered MCP tool and formats the text result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-2'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: 'Current weather: sunny'
            }, {
              type: 'image',
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png'
            }, {
              type: 'audio',
              data: 'bXAz',
              mimeType: 'audio/mpeg'
            }, {
              type: 'resource',
              resource: {
                uri: 'docs://guide/readme.md',
                mimeType: 'text/markdown',
                text: '# Guide'
              }
            }],
            structuredContent: {
              replies: [{ id: 8891 }]
            }
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      },
      argumentsObject: {
        city: 'Shanghai'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Current weather: sunny\n\n[image image/png]\n\n[audio audio/mpeg]\n\n[resource docs://guide/readme.md]\n\n{"replies":[{"id":8891}]}',
      isError: false,
      attachmentContent: [
        {
          kind: 'image',
          sourceType: 'image',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          mimeType: 'image/png',
          name: 'image-2.png'
        },
        {
          kind: 'file',
          sourceType: 'audio',
          dataUrl: 'data:audio/mpeg;base64,bXAz',
          mimeType: 'audio/mpeg',
          name: 'audio-3.mp3'
        },
        {
          kind: 'file',
          sourceType: 'resource',
          dataUrl: 'data:text/markdown,%23%20Guide',
          mimeType: 'text/markdown',
          name: 'readme.md',
          textContent: '# Guide',
          uri: 'docs://guide/readme.md'
        }
      ],
      structuredContent: {
        replies: [{ id: 8891 }]
      }
    });
  });

  it('keeps MCP isError results as executed tool evidence', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-error'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: 'Permission denied'
            }],
            structuredContent: {
              code: 'permission_denied',
              retryable: false
            }
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__docs__delete_doc',
        serverId: 'server-1',
        serverName: 'Docs MCP',
        serverHandle: 'docs',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'delete_doc',
        description: 'Delete doc',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      argumentsObject: {
        id: 'doc-1'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Permission denied\n\n{"code":"permission_denied","retryable":false}',
      isError: true,
      structuredContent: {
        code: 'permission_denied',
        retryable: false
      }
    });
  });

  it('uses fetch for streamable-http MCP outside native iOS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    const nativeRequestMock = vi.mocked(CapacitorHttp.request).mockResolvedValue(
      createNativeResponse('', {
        status: 500
      })
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-2'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: 'Current weather: sunny'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      },
      argumentsObject: {
        city: 'Shanghai'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Current weather: sunny',
      isError: false
    });
    expect(nativeRequestMock).not.toHaveBeenCalled();
  });
});
