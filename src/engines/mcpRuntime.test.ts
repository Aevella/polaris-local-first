import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web')
  },
  CapacitorHttp: {
    request: vi.fn()
  }
}));

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { clearMcpToolCatalogCacheForTests, invokeMcpTool, resolveMcpToolCatalog } from './mcpRuntime';
import type { McpServerConfig } from '../types/domain';

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
  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(CapacitorHttp.request).mockReset();
    clearMcpToolCatalogCacheForTests();
    vi.unstubAllGlobals();
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
        return new Response('event: endpoint\ndata: /messages\n\n', {
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
