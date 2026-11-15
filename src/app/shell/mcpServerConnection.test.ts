import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../../types/domain';
import { inspectMcpServerConnection, mergeMcpDiscoveredTools } from './mcpServerConnection';

const server: McpServerConfig = {
  id: 'mcp-supabase',
  handle: 'supabase',
  name: 'Supabase',
  description: '',
  transport: 'streamable-http',
  url: 'https://mcp.supabase.com/mcp',
  headers: [],
  tools: [],
  isActive: true
};

describe('mergeMcpDiscoveredTools', () => {
  it('preserves the user switch for an already known tool', () => {
    expect(mergeMcpDiscoveredTools(
      [{ name: 'list_projects', description: 'Old', inputSchema: {}, enabled: false }],
      [{
        schemaName: 'mcp__supabase__list_projects',
        serverId: server.id,
        serverName: server.name,
        serverHandle: server.handle,
        transport: server.transport,
        url: server.url,
        toolName: 'list_projects',
        description: 'New',
        inputSchema: { type: 'object' },
        enabled: true
      }]
    )).toEqual([{
      name: 'list_projects',
      description: 'New',
      inputSchema: { type: 'object' },
      enabled: false
    }]);
  });
});

describe('inspectMcpServerConnection', () => {
  it('returns the authorization request before treating an empty catalog as success', async () => {
    const request = {
      serverId: server.id,
      serverName: server.name,
      serverUrl: server.url,
      challenge: { scheme: 'Bearer' as const }
    };
    const result = await inspectMcpServerConnection({
      server,
      timeoutSeconds: 20,
      resolveCatalog: async () => ({ tools: [], errors: [], authorizationRequests: [request] })
    });
    expect(result).toEqual({ status: 'authorization-required', request });
  });

  it('returns discovered tools and preserves their saved switches', async () => {
    const result = await inspectMcpServerConnection({
      server: {
        ...server,
        tools: [{ name: 'query', description: '', inputSchema: {}, enabled: false }]
      },
      timeoutSeconds: 20,
      resolveCatalog: async () => ({
        tools: [{
          schemaName: 'mcp__supabase__query',
          serverId: server.id,
          serverName: server.name,
          serverHandle: server.handle,
          transport: server.transport,
          url: server.url,
          toolName: 'query',
          description: 'Query the database',
          inputSchema: { type: 'object' },
          enabled: true
        }],
        errors: [],
        authorizationRequests: []
      })
    });
    expect(result).toEqual({
      status: 'connected',
      tools: [{
        name: 'query',
        description: 'Query the database',
        inputSchema: { type: 'object' },
        enabled: false
      }]
    });
  });

  it('returns catalog errors without replacing them with a generic empty result', async () => {
    const result = await inspectMcpServerConnection({
      server,
      timeoutSeconds: 20,
      resolveCatalog: async () => ({
        tools: [],
        errors: ['Supabase: HTTP 500'],
        authorizationRequests: []
      })
    });
    expect(result).toEqual({ status: 'error', message: 'Supabase: HTTP 500' });
  });
});
