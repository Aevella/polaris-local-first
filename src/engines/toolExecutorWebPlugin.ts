import type { ToolAction, ToolContext, ToolExecutionResult } from './toolExecutorTypes';
import type { ToolExecutorPlugin } from './toolExecutorPlugins';
import { isToolActionKindHandledByPlugin } from './tool-protocol/toolManifest';

export type WebToolAction = Extract<ToolAction, { kind: 'webSearch' | 'readWebPage' }>;

export function isWebToolAction(action: ToolAction): action is WebToolAction {
  return isToolActionKindHandledByPlugin(action.kind, 'web');
}

function firstSearchWarningClause(warning?: string) {
  return warning?.split('；')[0]?.trim() || '';
}

function formatWebSearchSummary(result: Awaited<ReturnType<ToolContext['webSearch']>> & { ok: true }) {
  if (!result.degraded) {
    return `已找到 ${result.results.length} 条网页结果 · ${result.provider}`;
  }

  const reason = firstSearchWarningClause(result.warning);
  return reason
    ? `已降级到 Bing 搜索 · ${result.results.length} 条 · ${reason}`
    : `已找到 ${result.results.length} 条降级网页结果 · ${result.provider}`;
}

async function executeWebToolAction(action: WebToolAction, ctx: ToolContext): Promise<ToolExecutionResult> {
  switch (action.kind) {
    case 'webSearch': {
      const result = await ctx.webSearch(action.query, action.maxResults);
      if (!result.ok) return result;
      return {
        ok: true,
        summary: formatWebSearchSummary(result),
        detailText: result.detailText,
        ...(result.webSearch ? { webSearch: result.webSearch } : {})
      };
    }
    case 'readWebPage': {
      const result = await ctx.readWebPage(action.url, action.maxChars);
      if (!result.ok) return result;
      return {
        ok: true,
        summary: `已读取网页 · ${result.title ?? result.url}`,
        detailText: result.detailText,
        ...(result.webPageRead ? { webPageRead: result.webPageRead } : {})
      };
    }
  }
}

export const webToolExecutorPlugin: ToolExecutorPlugin = {
  name: 'web',
  canHandle: isWebToolAction,
  execute: async (action, ctx) => {
    if (!isWebToolAction(action)) {
      return { ok: false, error: `网页工具无法执行：${action.kind}` };
    }
    return executeWebToolAction(action, ctx);
  }
};
