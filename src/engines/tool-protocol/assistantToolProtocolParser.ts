import type { AssistantToolAction } from './assistantToolProtocolTypes';
import type { AssistantNativeToolCall } from '../chat-api/chatApiTypes';
import type { ModelTier, ThemeToolMode } from '../../types/domain';
import { parseAssistantToolAction } from './assistantToolProtocolActionParser';
import { parseNativeMcpToolAction } from './assistantToolProtocolActionMcp';
import { extractCanonicalAssistantToolItems } from './assistantToolProtocolCanonicalizer';
import { extractAssistantToolFenceBlocks } from './assistantToolProtocolFence';
import { parseToolPayload } from './assistantToolProtocolPayload';
import type { AssistantToolActionParseContext } from './assistantToolProtocolActionContext';

function summarizeRawToolBlock(rawJson: string) {
  const compact = rawJson
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^json\s*/i, '');
  if (!compact) return '空工具块';
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function describeToolParseFailure(rawJson: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : '未知解析错误';
  const snippet = summarizeRawToolBlock(rawJson);
  return [
    '工具块解析失败，这次改动还没有真正执行。',
    '失败阶段：工具 JSON 解析',
    `解析器提示：${errorMessage}`,
    `原始片段：${snippet}`,
    '通常是因为引号、换行、注释、花括号，或者多段 CSS/说明文字一起塞进了工具块。你可以直接让 AI 重发一版。'
  ].join('\n');
}

export function extractAssistantToolActions(
  content: string,
  modelTier: ModelTier = 'medium',
  themeToolMode: ThemeToolMode = 'stable',
  parseContext?: AssistantToolActionParseContext
): {
  displayContent: string;
  actions: AssistantToolAction[];
  issues: string[];
} {
  const actions: AssistantToolAction[] = [];
  const issues: string[] = [];
  const { displayContent, blocks } = extractAssistantToolFenceBlocks(content);
  const contentHint = displayContent || content;

  for (const block of blocks) {
    const rawJson = block.body;
    try {
      const parsed = parseToolPayload(rawJson);
      const payload = extractCanonicalAssistantToolItems(parsed);
      if (payload.length === 0) {
        issues.push('工具块里没有找到可执行动作。');
        continue;
      }
      for (const item of payload) {
        const result = parseAssistantToolAction(item, contentHint, themeToolMode, parseContext);
        if (result.action) {
          actions.push(result.action);
        } else if (result.issue) {
          issues.push(result.issue);
        }
      }
    } catch (error) {
      issues.push(describeToolParseFailure(rawJson, error));
    }
  }

  return {
    displayContent,
    actions,
    issues: Array.from(new Set(issues))
  };
}

function describeNativeToolParseFailure(name: string, rawJson: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : '未知解析错误';
  const snippet = summarizeRawToolBlock(rawJson);
  return [
    `原生工具 ${name} 解析失败，这次动作还没有真正执行。`,
    `解析器提示：${errorMessage}`,
    `原始参数：${snippet}`
  ].join('\n');
}

function asPayloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function splitLeadingJsonObjectWithTail(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{')) return null;

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quoteChar) {
        inString = false;
        quoteChar = '';
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      inString = true;
      quoteChar = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          objectText: trimmed.slice(0, index + 1),
          tailText: trimmed.slice(index + 1).replace(/^;+\s*/, '').trim()
        };
      }
    }
  }

  return null;
}

const LOOSE_NATIVE_TEXT_FIELD_BY_TOOL: Record<string, string> = {
  runCode: 'code',
  writeDesktopFile: 'content',
  replaceDesktopFileLines: 'code'
};

function recoverLooseNativeTextPayload(toolName: string, argumentsText: string): Record<string, unknown> | null {
  const textField = LOOSE_NATIVE_TEXT_FIELD_BY_TOOL[toolName];
  if (!textField) return null;

  const split = splitLeadingJsonObjectWithTail(argumentsText);
  if (!split?.tailText) return null;

  const parsedPrefix = parseToolPayload(split.objectText);
  const payload = asPayloadObject(parsedPrefix);
  const existingText = payload[textField];
  if (typeof existingText === 'string' && existingText.trim()) return payload;

  return {
    ...payload,
    [textField]: split.tailText
  };
}

function recoverLeadingJsonObjectPayload(argumentsText: string): Record<string, unknown> | null {
  const split = splitLeadingJsonObjectWithTail(argumentsText);
  if (!split) return null;

  const parsedPrefix = parseToolPayload(split.objectText);
  const payload = asPayloadObject(parsedPrefix);
  return Object.keys(payload).length ? payload : null;
}

export function parseNativeToolPayload(toolName: string, argumentsText: string): Record<string, unknown> {
  const normalizedName = toolName.trim();
  const trimmed = argumentsText.trim();

  try {
    const parsedPayload = parseToolPayload(trimmed || '{}');
    const payload = asPayloadObject(parsedPayload);
    const looseTextPayload = recoverLooseNativeTextPayload(normalizedName, trimmed);
    if (looseTextPayload) {
      return looseTextPayload;
    }
    return payload;
  } catch (error) {
    const recoveredTextPayload = recoverLooseNativeTextPayload(normalizedName, trimmed);
    if (recoveredTextPayload) return recoveredTextPayload;

    const recoveredPayload = recoverLeadingJsonObjectPayload(trimmed);
    if (recoveredPayload) return recoveredPayload;
    throw error;
  }
}

function mergeNativeToolPayload(
  toolName: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if ((toolName === 'createCodeCard' || toolName === 'patchCodeCard') && typeof payload.kind === 'string') {
    const contentField = toolName === 'createCodeCard' ? 'card' : 'patch';
    const existingContent = asPayloadObject(payload[contentField]);
    return {
      ...payload,
      [contentField]: {
        ...existingContent,
        kind: existingContent.kind ?? payload.kind
      },
      kind: toolName
    };
  }

  return {
    ...payload,
    kind: toolName
  };
}

export function extractAssistantNativeToolActions(
  toolCalls: AssistantNativeToolCall[],
  contentHint = '',
  themeToolMode: ThemeToolMode = 'stable',
  ignoredUnknownKinds: string[] = [],
  parseContext?: AssistantToolActionParseContext
): {
  actions: AssistantToolAction[];
  issues: string[];
} {
  const actions: AssistantToolAction[] = [];
  const issues: string[] = [];
  const ignoredUnknownKindSet = new Set(ignoredUnknownKinds);

  for (const toolCall of toolCalls) {
    const normalizedName = toolCall.name.trim();
    if (!normalizedName) continue;

    try {
      const parsedPayload = parseNativeToolPayload(normalizedName, toolCall.argumentsText);
      const result = parseNativeMcpToolAction(normalizedName, parsedPayload, parseContext)
        ?? parseAssistantToolAction(
          mergeNativeToolPayload(normalizedName, parsedPayload),
          contentHint,
          themeToolMode,
          parseContext
        );
      if (result.action) {
        actions.push(result.action);
      } else if (
        result.issue
        && !(
          ignoredUnknownKindSet.has(normalizedName)
          && result.issue === `未知工具动作：${normalizedName}`
        )
      ) {
        issues.push(result.issue);
      }
    } catch (error) {
      issues.push(describeNativeToolParseFailure(normalizedName, toolCall.argumentsText, error));
    }
  }

  return {
    actions,
    issues: Array.from(new Set(issues))
  };
}
