// MCP tool catalog, cache, and invocation.
//
// Discovers each active server's tools (with retry + a module-level cache),
// normalizes them into stable schema-named definitions, and invokes a single
// tool by picking the right transport and projecting its result. This is the
// orchestration layer over the two transports in `mcp-transport/`; it owns no wire protocol itself. The public surface is
// re-exported from `mcpRuntime.ts`.

import type { McpServerConfig, McpServerHeader } from '../types/domain';
import { buildMcpHandle } from './mcpHandle';
import {
  extractToolAttachmentContent,
  formatToolsCallResult
} from './mcpRuntimeAttachments';
import type { McpToolAttachmentContent, ToolsCallResult } from './mcpRuntimeAttachments';
import { createRpcId, ensureSuccessMessage } from './mcpRuntimeJsonRpc';
import { wait } from './mcpRuntimeTiming';
import type { McpTransportOptions } from './mcp-transport/types';
import { getMcpSessionConnection, invalidateMcpSession, markMcpSessionUnavailable,
  getMcpSessionAvailability, markMcpSessionConnecting, revalidateMcpSession,
  closeAllMcpSessions, reconcileMcpSessions } from './mcp-transport/sessionRegistry';
export { closeAllMcpSessions, reconcileMcpSessions };

const DEFAULT_MCP_CATALOG_RETRY_DELAYS_MS = [600, 1200, 2400] as const;

type ToolsListResult = {
  tools?: Array<{
    name?: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  nextCursor?: string;
};

export type McpResolvedToolDefinition = {
  schemaName: string;
  serverId: string;
  serverName: string;
  serverHandle: string;
  transport: McpServerConfig['transport'];
  url: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled?: boolean;
};

export type McpToolCatalogResolution = {
  tools: McpResolvedToolDefinition[];
  errors: string[];
};

type McpToolCatalogCacheEntry = {
  tools: McpResolvedToolDefinition[];
  updatedAt: number;
};

export type McpToolCallResult =
  | {
      ok: true;
      detailText: string;
      isError: boolean;
      structuredContent?: unknown;
      attachmentContent?: McpToolAttachmentContent[];
    }
  | {
      ok: false;
      error: string;
    };

const mcpToolCatalogCache = new Map<string, McpToolCatalogCacheEntry>();

function normalizeToolNameFragment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function createDefaultInputSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {}
  } satisfies Record<string, unknown>;
}

function normalizeInputSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultInputSchema();
  }
  return value as Record<string, unknown>;
}

function dedupeSchemaNames(tools: McpResolvedToolDefinition[]) {
  const seen = new Map<string, number>();

  return tools.map((tool) => {
    const current = seen.get(tool.schemaName) ?? 0;
    seen.set(tool.schemaName, current + 1);
    if (current === 0) return tool;
    const suffix = `_${current + 1}`;
    const nextName = `${tool.schemaName.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    return {
      ...tool,
      schemaName: nextName
    };
  });
}

export function buildMcpSchemaToolName(server: Pick<McpServerConfig, 'id' | 'handle' | 'name' | 'url'>, toolName: string) {
  const serverFragment = buildMcpHandle(server).slice(0, 18) || 'server';
  const toolFragment = normalizeToolNameFragment(toolName).slice(0, 38) || 'tool';
  return `mcp__${serverFragment}__${toolFragment}`.slice(0, 64);
}

function normalizeDiscoveredTools(
  server: McpServerConfig,
  tools: ToolsListResult['tools'],
  options?: { includeDisabledTools?: boolean }
) {
  const resolved = (tools ?? [])
    .filter((tool): tool is NonNullable<ToolsListResult['tools']>[number] => Boolean(tool?.name?.trim()))
    .map((tool) => {
      const toolName = tool.name!.trim();
      const savedTool = (server.tools ?? []).find((entry) => entry.name === toolName);
      return {
        schemaName: buildMcpSchemaToolName(server, toolName),
        serverId: server.id,
        serverName: server.name,
        serverHandle: buildMcpHandle(server),
        transport: server.transport,
        url: server.url,
        toolName,
        description: tool.description?.trim() || savedTool?.description || `调用 MCP 工具 ${toolName}`,
        inputSchema: normalizeInputSchema(tool.inputSchema ?? savedTool?.inputSchema),
        enabled: savedTool?.enabled ?? true
      };
    })
    .filter((tool) => options?.includeDisabledTools || tool.enabled !== false);

  return dedupeSchemaNames(resolved);
}

async function listToolsViaStreamableHttp(
  options: McpTransportOptions,
  catalogOptions?: { includeDisabledTools?: boolean }
) {
  const connection = await getMcpSessionConnection(options);
  const discovered: McpResolvedToolDefinition[] = [];
  const errors: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await connection.request({
      jsonrpc: '2.0',
      id: createRpcId(),
      method: 'tools/list',
      params: cursor ? { cursor } : {}
    }, `读取 MCP 工具目录 · ${options.server.name}`);

    const result = (response.result ?? {}) as ToolsListResult;
    discovered.push(...normalizeDiscoveredTools(options.server, result.tools, catalogOptions));
    if (!result.nextCursor?.trim()) break;
    cursor = result.nextCursor.trim();
  }

  return dedupeSchemaNames(discovered);
}

async function listToolsViaLegacySse(
  options: McpTransportOptions,
  catalogOptions?: { includeDisabledTools?: boolean }
) {
  const connection = await getMcpSessionConnection(options);
  const discovered: McpResolvedToolDefinition[] = [];
  const errors: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await connection.request({
      jsonrpc: '2.0',
      id: createRpcId(),
      method: 'tools/list',
      params: cursor ? { cursor } : {}
    }, `读取 MCP 工具目录 · ${options.server.name}`);
    const result = (response.result ?? {}) as ToolsListResult;
    discovered.push(...normalizeDiscoveredTools(options.server, result.tools, catalogOptions));
    if (!result.nextCursor?.trim()) break;
    cursor = result.nextCursor.trim();
  }

  return dedupeSchemaNames(discovered);
}

async function callToolViaStreamableHttp(
  tool: McpResolvedToolDefinition,
  argumentsObject: Record<string, unknown>,
  options: McpTransportOptions
): Promise<McpToolCallResult> {
  const connection = await getMcpSessionConnection(options);
  const response = await connection.request({
    jsonrpc: '2.0',
    id: createRpcId(),
    method: 'tools/call',
    params: {
      name: tool.toolName,
      arguments: argumentsObject
    }
  }, `调用 MCP 工具 · ${tool.serverName} / ${tool.toolName}`);

  const result = (response.result ?? {}) as ToolsCallResult;
  const attachmentContent = extractToolAttachmentContent(result);
  return {
    ok: true,
    detailText: formatToolsCallResult(result),
    isError: result.isError === true,
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    ...(attachmentContent.length ? { attachmentContent } : {})
  };
}

async function callToolViaLegacySse(
  tool: McpResolvedToolDefinition,
  argumentsObject: Record<string, unknown>,
  options: McpTransportOptions
): Promise<McpToolCallResult> {
  const connection = await getMcpSessionConnection(options);
  const response = await connection.request({
    jsonrpc: '2.0',
    id: createRpcId(),
    method: 'tools/call',
    params: {
      name: tool.toolName,
      arguments: argumentsObject
    }
  }, `调用 MCP 工具 · ${tool.serverName} / ${tool.toolName}`);

  const result = (response.result ?? {}) as ToolsCallResult;
  const attachmentContent = extractToolAttachmentContent(result);
  return {
    ok: true,
    detailText: formatToolsCallResult(result),
    isError: result.isError === true,
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    ...(attachmentContent.length ? { attachmentContent } : {})
  };
}

function normalizeTimeoutMs(timeoutSeconds: number | undefined) {
  const seconds = typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? timeoutSeconds
    : 30;
  return Math.floor(seconds * 1000);
}

function buildMcpCatalogCacheKey(server: McpServerConfig) {
  return JSON.stringify({
    id: server.id,
    handle: server.handle,
    transport: server.transport,
    url: server.url,
    headers: server.headers.map((header) => [header.key, header.value])
  });
}

async function listServerTools(
  server: McpServerConfig,
  options: Omit<McpTransportOptions, 'server'>,
  catalogOptions?: { includeDisabledTools?: boolean }
) {
  return server.transport === 'sse'
    ? await listToolsViaLegacySse({ ...options, server }, catalogOptions)
    : await listToolsViaStreamableHttp({ ...options, server }, catalogOptions);
}

async function resolveServerToolsWithRetry(args: {
  server: McpServerConfig;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  retryDelaysMs: readonly number[];
  useCachedOnFailure: boolean;
  includeDisabledTools: boolean;
}) {
  const cacheKey = buildMcpCatalogCacheKey(args.server);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= args.retryDelaysMs.length; attempt += 1) {
    try {
      const tools = await listServerTools(args.server, {
        timeoutMs: args.timeoutMs,
        fetchImpl: args.fetchImpl
      }, {
        includeDisabledTools: args.includeDisabledTools
      });
      mcpToolCatalogCache.set(cacheKey, {
        tools,
        updatedAt: Date.now()
      });
      return { tools, error: null };
    } catch (error) {
      lastError = error;
      invalidateMcpSession(args.server.id);
      const nextDelayMs = args.retryDelaysMs[attempt];
      if (nextDelayMs !== undefined) {
        await wait(nextDelayMs);
      }
    }
  }

  const cached = args.useCachedOnFailure ? mcpToolCatalogCache.get(cacheKey) : undefined;
  if (cached?.tools.length) {
    return {
      tools: args.includeDisabledTools
        ? cached.tools
        : cached.tools.filter((tool) => tool.enabled !== false),
      error: null
    };
  }

  return {
    tools: [] as McpResolvedToolDefinition[],
    error: `${args.server.name}：${lastError instanceof Error ? lastError.message : '读取工具目录失败。'}`
  };
}

export async function resolveMcpToolCatalog(args: {
  servers?: McpServerConfig[];
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
  useCachedOnFailure?: boolean;
  includeDisabledTools?: boolean;
}): Promise<McpToolCatalogResolution> {
  const activeServers = (args.servers ?? []).filter((server) => server.isActive && server.url.trim());
  if (!activeServers.length) {
    return {
      tools: [],
      errors: []
    };
  }

  const timeoutMs = normalizeTimeoutMs(args.timeoutSeconds);
  const retryDelaysMs = args.retryDelaysMs ?? DEFAULT_MCP_CATALOG_RETRY_DELAYS_MS;
  const results = await Promise.all(
    activeServers.map((server) =>
      resolveServerToolsWithRetry({
        server,
        timeoutMs,
        fetchImpl: args.fetchImpl,
        retryDelaysMs,
        useCachedOnFailure: args.useCachedOnFailure !== false,
        includeDisabledTools: args.includeDisabledTools === true
      })
    )
  );

  return {
    tools: dedupeSchemaNames(results.flatMap((entry) => entry.tools)),
    errors: results.flatMap((entry) => entry.error ? [entry.error] : [])
  };
}

export async function clearMcpToolCatalogCacheForTests() {
  mcpToolCatalogCache.clear();
  await closeAllMcpSessions();
}

export async function invokeMcpTool(args: {
  tool: McpResolvedToolDefinition;
  argumentsObject: Record<string, unknown>;
  timeoutSeconds?: number;
  headers?: McpServerHeader[];
  fetchImpl?: typeof fetch;
}): Promise<McpToolCallResult> {
  const server: McpServerConfig = {
    id: args.tool.serverId,
    handle: args.tool.serverHandle,
    name: args.tool.serverName,
    description: '',
    transport: args.tool.transport,
    url: args.tool.url,
    headers: args.headers ?? [],
    tools: [],
    isActive: true
  };
  const timeoutMs = normalizeTimeoutMs(args.timeoutSeconds);

  const call = async () => {
    const authorizedServer = server;
    const options = {
      server: authorizedServer,
      timeoutMs,
      fetchImpl: args.fetchImpl
    };
    return server.transport === 'sse'
      ? await callToolViaLegacySse(args.tool, args.argumentsObject, options)
      : await callToolViaStreamableHttp(args.tool, args.argumentsObject, options);
  };

  try {
    return await call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    invalidateMcpSession(server.id);
    if (!/HTTP\s+(404|410)\b|session[^\n]*(invalid|expired|not found)/i.test(message)) {
      markMcpSessionUnavailable(server.id);
      throw error;
    }
    try {
      return await call();
    } catch (retryError) {
      markMcpSessionUnavailable(server.id);
      throw retryError;
    }
  }
}


export async function primeMcpSessions(args: {
  servers?: McpServerConfig[];
  timeoutSeconds?: number;
  fetchImpl?: typeof fetch;
  revalidate?: boolean;
}) {
  const activeServers = (args.servers ?? []).filter((server) => server.isActive && server.url.trim());
  const timeoutMs = normalizeTimeoutMs(args.timeoutSeconds);
  const pending = activeServers.flatMap((server) => {
    const availability = getMcpSessionAvailability(server.id);
    if (availability === 'connecting' || (availability === 'available' && !args.revalidate)) return [];

    if (availability !== 'available') markMcpSessionConnecting(server.id);
    return [
      (async () => {
        try {
          const authorizedServer = server;
          const options = {
            server: authorizedServer,
            timeoutMs,
            fetchImpl: args.fetchImpl
          };
          if (args.revalidate && availability === 'available') {
            await revalidateMcpSession(options);
          } else {
            await getMcpSessionConnection(options);
          }
        } catch {
          markMcpSessionUnavailable(server.id);
        }
      })()
    ];
  });

  await Promise.all(pending);
}
