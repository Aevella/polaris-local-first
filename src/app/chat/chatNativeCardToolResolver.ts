import type { ToolAction } from '../../engines/toolExecutor';
import { parseToolPayload } from '../../engines/tool-protocol/assistantToolProtocolPayload';
import type { AssistantToolEnforcementScope, PolarisToolPromptPreferences } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import { POLARIS_TOOL_PROMPT_GROUP_LABELS, isPolarisToolPromptGroupEnabled } from '../../engines/tool-protocol/toolPromptPreferences';
import type { ChatNativeToolCall, CodeCard } from '../../types/domain';
import { buildToolCardFunctionName, isRunnableToolCodeCard } from '../../engines/toolCardRuntime';

function unavailableToolActionError(group: Parameters<typeof isPolarisToolPromptGroupEnabled>[1]) {
  return `当前没有“${POLARIS_TOOL_PROMPT_GROUP_LABELS[group]}”能力。`;
}
function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStructuredArgs(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseToolCardPayload(argumentsText: string): {
  input?: string;
  args?: Record<string, unknown>;
  targetLabel?: string;
} {
  const parsed = parseToolPayload(argumentsText.trim() || '{}');

  if (typeof parsed === 'string') {
    return { input: parsed.trim() || undefined };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const asRecord = parsed as Record<string, unknown>;
  const directArgs = normalizeStructuredArgs(asRecord.args);
  const extraArgs = Object.fromEntries(
    Object.entries(asRecord).filter(([key]) => key !== 'input' && key !== 'args' && key !== 'targetLabel')
  );

  return {
    input: normalizeOptionalString(asRecord.input),
    args: directArgs ?? (Object.keys(extraArgs).length > 0 ? extraArgs : undefined),
    targetLabel: normalizeOptionalString(asRecord.targetLabel)
  };
}

export function resolveNativeToolCardActions(args: {
  toolCalls: ChatNativeToolCall[];
  cards: CodeCard[];
  enabledToolGroups?: PolarisToolPromptPreferences;
  toolEnforcementScope?: AssistantToolEnforcementScope;
  availableToolNames?: ReadonlySet<string>;
}): {
  resolved: ToolAction[];
  errors: string[];
} {
  const toolCardsByFunctionName = new Map(
    args.cards
      .filter((card) => isRunnableToolCodeCard(card))
      .map((card) => [buildToolCardFunctionName(card), card] as const)
  );
  const roomToolsVisible = isPolarisToolPromptGroupEnabled(
    args.enabledToolGroups,
    'room',
    args.toolEnforcementScope
  );

  const resolved: ToolAction[] = [];
  const errors: string[] = [];

  for (const toolCall of args.toolCalls) {
    const toolName = toolCall.name.trim();
    if (args.availableToolNames && !args.availableToolNames.has(toolName)) continue;
    const card = toolCardsByFunctionName.get(toolName);
    if (!card) continue;
    if (!roomToolsVisible) {
      errors.push(unavailableToolActionError('room'));
      continue;
    }

    try {
      const payload = parseToolCardPayload(toolCall.argumentsText);
      resolved.push({
        kind: 'invokeCodeCardTool',
        cardId: card.id,
        toolName,
        input: payload.input,
        args: payload.args,
        targetLabel: payload.targetLabel || card.title
      });
    } catch (error) {
      errors.push(
        `房间工具《${card.title}》参数解析失败：${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  return {
    resolved,
    errors
  };
}
