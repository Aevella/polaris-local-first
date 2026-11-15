import type { McpServerConfig, McpServerHeader } from '../types/domain';
import {
  getMcpOAuthAuthorizationRequest,
  refreshMcpOAuthAuthorization,
  withMcpOAuthHeader
} from './mcp-auth';
import { buildMcpHandle } from './mcpHandle';
import {
  buildMcpSchemaToolName,
  dedupeMcpSchemaNames,
  normalizeDiscoveredMcpTools,
  type McpResolvedToolDefinition,
  type McpToolCatalogResolution,
  type McpToolsListResult
} from './mcpToolCatalog';
import {
  extractMcpToolAttachmentContent,
  formatMcpToolsCallResult,
  type McpToolAttachmentContent,
  type McpToolsCallResult
} from './mcpResultContent';
import {
  closeAllMcpSessions,
  getMcpSessionAvailability,
  getMcpSessionConnection,
  invalidateMcpSession,
  markMcpSessionConnecting,
  markMcpSessionUnavailable,
  reconcileMcpSessions,
  revalidateMcpSession,
  type McpTransportOptions
} from './mcpTransport';

export type { McpToolAttachmentContent } from './mcpResultContent';
export type { McpResolvedToolDefinition, McpToolCatalogResolution } from './mcpToolCatalog';
export { buildMcpSchemaToolName } from './mcpToolCatalog';
export { closeAllMcpSessions, reconcileMcpSessions };

const DEFAULT_MCP_CATALOG_RETRY_DELAYS_MS = [600, 1200, 2400] as const;

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

function createRpcId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
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

    const result = (response.result ?? {}) as McpToolsListResult;
    const normalized = normalizeDiscoveredMcpTools(options.server, result.tools, catalogOptions);
    discovered.push(...normalized.tools);
    errors.push(...normalized.errors);
    if (!result.nextCursor?.trim()) break;
    cursor = result.nextCursor.trim();
  }

  return { tools: dedupeMcpSchemaNames(discovered), errors };
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
    const result = (response.result ?? {}) as McpToolsListResult;
    const normalized = normalizeDiscoveredMcpTools(options.server, result.tools, catalogOptions);
    discovered.push(...normalized.tools);
    errors.push(...normalized.errors);
    if (!result.nextCursor?.trim()) break;
    cursor = result.nextCursor.trim();
  }

  return { tools: dedupeMcpSchemaNames(discovered), errors };
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

  const result = (response.result ?? {}) as McpToolsCallResult;
  const attachmentContent = extractMcpToolAttachmentContent(result);
  return {
    ok: true,
    detailText: formatMcpToolsCallResult(result),
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

  const result = (response.result ?? {}) as McpToolsCallResult;
  const attachmentContent = extractMcpToolAttachmentContent(result);
  return {
    ok: true,
    detailText: formatMcpToolsCallResult(result),
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
  let oauthRefreshAttempted = false;

  for (let attempt = 0; attempt <= args.retryDelaysMs.length; attempt += 1) {
    try {
      const authorizedServer = await withMcpOAuthHeader(args.server, args.fetchImpl);
      const catalog = await listServerTools(authorizedServer, {
        timeoutMs: args.timeoutMs,
        fetchImpl: args.fetchImpl
      }, {
        includeDisabledTools: args.includeDisabledTools
      });
      mcpToolCatalogCache.set(cacheKey, {
        tools: catalog.tools,
        updatedAt: Date.now()
      });
      return { ...catalog, error: null };
    } catch (error) {
      lastError = error;
      invalidateMcpSession(args.server.id);
      const authorizationRequest = getMcpOAuthAuthorizationRequest(error, args.server);
      if (authorizationRequest) {
        if (!oauthRefreshAttempted) {
          oauthRefreshAttempted = true;
          if (await refreshMcpOAuthAuthorization(args.server.id, args.fetchImpl)) {
            attempt -= 1;
            continue;
          }
        }
        return {
          tools: [] as McpResolvedToolDefinition[],
          errors: [] as string[],
          error: null,
          authorizationRequest
        };
      }
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
      errors: [] as string[],
      error: null
    };
  }

  return {
    tools: [] as McpResolvedToolDefinition[],
    errors: [] as string[],
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
      errors: [],
      authorizationRequests: []
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
    tools: dedupeMcpSchemaNames(results.flatMap((entry) => entry.tools)),
    errors: results.flatMap((entry) => [
      ...entry.errors,
      ...(entry.error ? [entry.error] : [])
    ]),
    authorizationRequests: results.flatMap((entry) => entry.authorizationRequest ? [entry.authorizationRequest] : [])
  };
}

export function resolveSavedMcpToolCatalog(args: {
  servers?: McpServerConfig[];
  includeDisabledTools?: boolean;
}): McpToolCatalogResolution {
  const activeServers = (args.servers ?? []).filter((server) => server.isActive && server.url.trim());
  const availableServers = activeServers.filter(
    (server) => getMcpSessionAvailability(server.id) === 'available'
  );
  const normalizedCatalogs = availableServers.map((server) => normalizeDiscoveredMcpTools(
    server,
    server.tools ?? [],
    { includeDisabledTools: args.includeDisabledTools }
  ));
  const tools = normalizedCatalogs.flatMap((catalog) => catalog.tools);
  const schemaErrors = normalizedCatalogs.flatMap((catalog) => catalog.errors);
  const unavailableErrors = activeServers.flatMap((server) => {
    const availability = getMcpSessionAvailability(server.id);
    if (availability === 'available') return [];
    if (availability === 'unavailable') {
      return [`${server.name}：当前连接不可用，已从本轮工具中跳过；Polaris 会在后台重试。`];
    }
    return [`${server.name}：正在后台确认连接，本轮先不加载它的工具。`];
  });
  const catalogErrors = availableServers
    .filter((server) => !(server.tools ?? []).length)
    .map((server) => `${server.name}：还没有已保存的工具目录，请在 MCP 设置里测试连接或刷新工具。`);

  return {
    tools: dedupeMcpSchemaNames(tools),
    errors: [...unavailableErrors, ...catalogErrors, ...schemaErrors]
  };
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
          const authorizedServer = await withMcpOAuthHeader(server, args.fetchImpl);
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
    ...(args.tool.oauthClientId ? { oauthClientId: args.tool.oauthClientId } : {}),
    tools: [],
    isActive: true
  };
  const timeoutMs = normalizeTimeoutMs(args.timeoutSeconds);

  const call = async () => {
    const authorizedServer = await withMcpOAuthHeader(server, args.fetchImpl);
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
    if (getMcpOAuthAuthorizationRequest(error, server)) {
      if (await refreshMcpOAuthAuthorization(server.id, args.fetchImpl)) {
        return await call();
      }
      return {
        ok: false,
        error: `MCP 服务 ${server.name} 需要重新授权，请到 MCP 设置里连接账号。`
      };
    }
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
