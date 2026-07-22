import { invokeMcpTool, resolveMcpToolCatalog, type McpToolAttachmentContent } from '../../engines/mcpRuntime';
import type { ToolContext } from '../../engines/toolExecutorTypes';
import { createStoredAttachment, createStoredAttachmentFromDataUrl } from '../../infrastructure/assetStore';
import type { ChatToolStoreBindings } from './chatToolActionTypes';

async function createMcpAttachment(content: McpToolAttachmentContent, toolName: string, index: number) {
  const fallbackName = `${toolName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'mcp-result'}-${index + 1}`;
  return createStoredAttachmentFromDataUrl({
    kind: content.kind,
    name: content.name || fallbackName,
    mimeType: content.mimeType,
    dataUrl: content.dataUrl,
    textContent: content.textContent
  });
}
export function buildMcpToolExecutionContext(args: {
  runtime: ChatToolStoreBindings['runtime'];
}): Pick<ToolContext, 'invokeMcpTool'> {
  const { runtime } = args;
  return {
    invokeMcpTool: async (serverId, toolName, argumentsObject) => {
      const latestRuntime = runtime.readLatestState?.() ?? runtime;
      const catalog = await resolveMcpToolCatalog({
        servers: latestRuntime.mcpServers,
        timeoutSeconds: latestRuntime.mcpToolTimeoutSeconds
      });
      const tool = catalog.tools.find((entry) => (
        entry.serverId === serverId
        && entry.toolName === toolName
      )) ?? null;
      if (!tool) {
        return { ok: false, error: '没有找到要调用的 MCP 工具。' } as const;
      }

      const server = latestRuntime.mcpServers.find((entry: { id: string }) => entry.id === serverId) ?? null;
      const result = await invokeMcpTool({
        tool,
        argumentsObject,
        timeoutSeconds: latestRuntime.mcpToolTimeoutSeconds,
        headers: server?.headers ?? []
      });
      const attachments = result.ok && result.attachmentContent?.length
        ? await Promise.all(result.attachmentContent.map((content, index) => createMcpAttachment(content, toolName, index)))
        : [];

      return result.ok
        ? {
            ok: true,
            detailText: result.detailText,
            ...(attachments.length ? { attachments } : {}),
            isError: result.isError,
            ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {})
          }
        : result;
    },
  };
}
