import type { ToolAction } from '../../engines/toolExecutor';
import type { McpResolvedToolDefinition } from '../../engines/mcpRuntime';
import { parseToolPayload } from '../../engines/tool-protocol/assistantToolProtocolPayload';
import type { ChatNativeToolCall } from '../../types/domain';

function parseNativeArgumentsObject(argumentsText: string): Record<string, unknown> {
  const trimmed = argumentsText.trim();
  if (!trimmed) return {};

  const parsed = parseToolPayload(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('参数必须是对象。');
  }

  return parsed as Record<string, unknown>;
}
export function resolveNativeMcpToolActions(args: {
  toolCalls: ChatNativeToolCall[];
  mcpTools?: McpResolvedToolDefinition[];
  availableToolNames?: ReadonlySet<string>;
}): {
  resolved: ToolAction[];
  errors: string[];
} {
  const mcpToolsBySchemaName = new Map(
    (args.mcpTools ?? []).map((tool) => [tool.schemaName, tool] as const)
  );
  const resolved: ToolAction[] = [];
  const errors: string[] = [];

  for (const toolCall of args.toolCalls) {
    const toolName = toolCall.name.trim();
    if (args.availableToolNames && !args.availableToolNames.has(toolName)) continue;
    const tool = mcpToolsBySchemaName.get(toolName);
    if (!tool) continue;

    try {
      resolved.push({
        kind: 'invokeMcpTool',
        serverId: tool.serverId,
        serverName: tool.serverName,
        schemaName: tool.schemaName,
        toolName: tool.toolName,
        argumentsObject: parseNativeArgumentsObject(toolCall.argumentsText),
        targetLabel: `${tool.serverName} / ${tool.toolName}`
      });
    } catch (error) {
      errors.push(
        `MCP 工具「${tool.serverName} / ${tool.toolName}」参数解析失败：${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  return {
    resolved,
    errors
  };
}
