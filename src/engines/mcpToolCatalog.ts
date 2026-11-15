import type { McpServerConfig } from '../types/domain';
import { buildMcpHandle } from './mcpHandle';
import { resolveMcpInputSchema } from './mcpInputSchema';
import type { McpOAuthAuthorizationRequest } from './mcp-auth';

export type McpToolsListResult = {
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
  oauthClientId?: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled?: boolean;
};

export type McpToolCatalogResolution = {
  tools: McpResolvedToolDefinition[];
  errors: string[];
  authorizationRequests?: McpOAuthAuthorizationRequest[];
};

function normalizeToolNameFragment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function dedupeMcpSchemaNames(tools: McpResolvedToolDefinition[]) {
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

export function buildMcpSchemaToolName(
  server: Pick<McpServerConfig, 'id' | 'handle' | 'name' | 'url'>,
  toolName: string
) {
  const serverFragment = buildMcpHandle(server).slice(0, 18) || 'server';
  const toolFragment = normalizeToolNameFragment(toolName).slice(0, 38) || 'tool';
  return `mcp__${serverFragment}__${toolFragment}`.slice(0, 64);
}

export function normalizeDiscoveredMcpTools(
  server: McpServerConfig,
  tools: McpToolsListResult['tools'],
  options?: { includeDisabledTools?: boolean }
) {
  const errors: string[] = [];
  const resolved = (tools ?? [])
    .filter((tool): tool is NonNullable<McpToolsListResult['tools']>[number] => Boolean(tool?.name?.trim()))
    .flatMap((tool) => {
      const toolName = tool.name!.trim();
      const savedTool = (server.tools ?? []).find((entry) => entry.name === toolName);
      const inputSchema = resolveMcpInputSchema(tool.inputSchema ?? savedTool?.inputSchema);
      if (!inputSchema.ok) {
        errors.push(`${server.name} / ${toolName}：${inputSchema.error}，已跳过该工具。`);
        return [];
      }
      return [{
        schemaName: buildMcpSchemaToolName(server, toolName),
        serverId: server.id,
        serverName: server.name,
        serverHandle: buildMcpHandle(server),
        transport: server.transport,
        url: server.url,
        ...(server.oauthClientId ? { oauthClientId: server.oauthClientId } : {}),
        toolName,
        description: tool.description?.trim() || savedTool?.description || `调用 MCP 工具 ${toolName}`,
        inputSchema: inputSchema.schema,
        enabled: savedTool?.enabled ?? true
      }];
    })
    .filter((tool) => options?.includeDisabledTools || tool.enabled !== false);

  return {
    tools: dedupeMcpSchemaNames(resolved),
    errors
  };
}
