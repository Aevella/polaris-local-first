import type { McpResolvedToolDefinition } from '../mcpRuntime';
import { asObject } from './assistantToolProtocolShared';
import type { ParseActionResult } from './assistantToolProtocolActionShared';
import { normalizeOptionalString } from './assistantToolProtocolActionShared';

export type AssistantToolActionMcpParseContext = {
  mcpTools?: McpResolvedToolDefinition[];
};

const MCP_META_KEYS = new Set(['kind', 'targetLabel']);

function resolveMcpTool(
  schemaName: string,
  context?: AssistantToolActionMcpParseContext
) {
  if (!schemaName.startsWith('mcp__')) return null;

  const tool = (context?.mcpTools ?? []).find((entry) => entry.schemaName === schemaName);
  if (!tool) {
    return { tool: null, issue: `MCP 工具「${schemaName}」当前不可用。` } as const;
  }

  return { tool, issue: null } as const;
}

function buildMcpToolAction(
  tool: McpResolvedToolDefinition,
  argumentsObject: Record<string, unknown>,
  targetLabel?: string
): ParseActionResult {
  return {
    action: {
      kind: 'invokeMcpTool',
      serverId: tool.serverId,
      serverName: tool.serverName,
      schemaName: tool.schemaName,
      toolName: tool.toolName,
      argumentsObject,
      targetLabel: targetLabel || `${tool.serverName} / ${tool.toolName}`
    }
  };
}

function normalizeMcpArguments(action: Record<string, unknown>) {
  const explicitArguments = asObject(action.arguments);
  if (explicitArguments) return explicitArguments;

  const explicitArgs = asObject(action.args);
  if (explicitArgs) return explicitArgs;

  return Object.fromEntries(
    Object.entries(action).filter(([key]) => !MCP_META_KEYS.has(key))
  );
}

export function parseMcpToolAction(
  action: Record<string, unknown>,
  context?: AssistantToolActionMcpParseContext
): ParseActionResult | null {
  const schemaName = typeof action.kind === 'string' ? action.kind.trim() : '';
  const resolved = resolveMcpTool(schemaName, context);
  if (!resolved) return null;
  if (!resolved.tool) return { action: null, issue: resolved.issue };

  return buildMcpToolAction(
    resolved.tool,
    normalizeMcpArguments(action),
    normalizeOptionalString(action.targetLabel)
  );
}

export function parseNativeMcpToolAction(
  schemaName: string,
  argumentsObject: Record<string, unknown>,
  context?: AssistantToolActionMcpParseContext
): ParseActionResult | null {
  const resolved = resolveMcpTool(schemaName.trim(), context);
  if (!resolved) return null;
  if (!resolved.tool) return { action: null, issue: resolved.issue };

  return buildMcpToolAction(resolved.tool, argumentsObject);
}
