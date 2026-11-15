import type { McpOAuthAuthorizationRequest } from '../../engines/mcp-auth';
import {
  resolveMcpToolCatalog,
  type McpResolvedToolDefinition,
  type McpToolCatalogResolution
} from '../../engines/mcpRuntime';
import type { McpServerConfig, McpServerToolConfig } from '../../types/domain';

export const MCP_OAUTH_CATALOG_REFRESHED_EVENT = 'polaris:mcp-oauth-catalog-refreshed';
export const MCP_OAUTH_CATALOG_REFRESH_FAILED_EVENT = 'polaris:mcp-oauth-catalog-refresh-failed';
export const MCP_OAUTH_CONNECTION_NOTICE_EVENT = 'polaris:mcp-oauth-connection-notice';
export const MCP_OAUTH_OPEN_SETTINGS_EVENT = 'polaris:mcp-oauth-open-settings';

export type McpOAuthConnectionNotice = {
  serverId: string | null;
  phase: 'refreshing' | 'connected' | 'empty' | 'failed';
  toolCount?: number;
  message?: string;
};

let pendingMcpOAuthConnectionNotice: McpOAuthConnectionNotice | null = null;

export function publishMcpOAuthConnectionNotice(notice: McpOAuthConnectionNotice) {
  pendingMcpOAuthConnectionNotice = notice;
  globalThis.dispatchEvent(new CustomEvent<McpOAuthConnectionNotice>(
    MCP_OAUTH_CONNECTION_NOTICE_EVENT,
    { detail: notice }
  ));
}

export function consumeMcpOAuthConnectionNotice() {
  const notice = pendingMcpOAuthConnectionNotice;
  pendingMcpOAuthConnectionNotice = null;
  return notice;
}

export type McpOAuthCatalogRefreshedDetail = {
  serverId: string;
  toolCount: number;
};

export type McpOAuthCatalogRefreshFailedDetail = {
  serverId: string;
  reason: 'authorization-required' | 'empty' | 'error' | 'missing-server';
  message?: string;
};

export type McpServerConnectionResult =
  | { status: 'connected'; tools: McpServerToolConfig[] }
  | { status: 'authorization-required'; request: McpOAuthAuthorizationRequest }
  | { status: 'empty' }
  | { status: 'error'; message: string };

type ResolveMcpCatalog = (args: {
  servers: McpServerConfig[];
  timeoutSeconds: number;
  retryDelaysMs: readonly number[];
  includeDisabledTools: boolean;
}) => Promise<McpToolCatalogResolution>;

export function mergeMcpDiscoveredTools(
  currentTools: McpServerToolConfig[],
  discoveredTools: McpResolvedToolDefinition[]
): McpServerToolConfig[] {
  const currentByName = new Map(currentTools.map((tool) => [tool.name, tool] as const));
  return discoveredTools.map((tool) => {
    const current = currentByName.get(tool.toolName);
    return {
      name: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      enabled: current?.enabled ?? tool.enabled ?? true
    };
  });
}

export async function inspectMcpServerConnection(args: {
  server: McpServerConfig;
  timeoutSeconds: number;
  resolveCatalog?: ResolveMcpCatalog;
}): Promise<McpServerConnectionResult> {
  const resolveCatalog = args.resolveCatalog ?? resolveMcpToolCatalog;
  const result = await resolveCatalog({
    servers: [{ ...args.server, isActive: true }],
    timeoutSeconds: args.timeoutSeconds,
    retryDelaysMs: [],
    includeDisabledTools: true
  });
  const authorizationRequest = result.authorizationRequests?.[0];
  if (authorizationRequest) {
    return { status: 'authorization-required', request: authorizationRequest };
  }
  if (result.errors.length > 0) {
    return { status: 'error', message: result.errors.join('\n') };
  }
  if (result.tools.length === 0) {
    return { status: 'empty' };
  }
  return {
    status: 'connected',
    tools: mergeMcpDiscoveredTools(args.server.tools ?? [], result.tools)
  };
}
