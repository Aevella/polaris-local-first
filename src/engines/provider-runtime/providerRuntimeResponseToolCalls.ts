import type { OpenAiToolCallAccumulator, ReplyAccumulator } from './providerRuntimeReplyAccumulator';
import { mergeToolCallArgumentsText } from './providerRuntimeToolArguments';
import {
  normalizeOpenAiToolCalls,
  serializeProviderToolArguments,
  type ProviderToolCallWireShape
} from './providerRuntimeToolCallResponse';

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readGeminiThoughtSignature(entry: Record<string, unknown>) {
  const extraContent = readObject(entry.extra_content) ?? readObject(entry.extraContent);
  const google = readObject(extraContent?.google);
  const signature =
    google?.thought_signature
    ?? google?.thoughtSignature
    ?? extraContent?.thought_signature
    ?? extraContent?.thoughtSignature;

  return typeof signature === 'string' && signature.trim() ? signature : undefined;
}

export function appendOpenAiToolCalls(
  target: ReplyAccumulator,
  toolCalls: unknown,
  shape: ProviderToolCallWireShape
) {
  const nextToolCalls = target.toolCalls ?? [];

  normalizeOpenAiToolCalls(toolCalls, shape).forEach((toolCall) => {
    const sourceIndex = toolCall.index ?? toolCall.fallbackIndex;
    const idMatchIndex = toolCall.id
      ? nextToolCalls.findIndex((entry) => entry.id === toolCall.id)
      : -1;
    const targetIndex = idMatchIndex >= 0
      ? idMatchIndex
      : nextToolCalls.findIndex((entry) => entry.sourceSpan?.index === sourceIndex);
    const existing = targetIndex >= 0
      ? nextToolCalls[targetIndex]!
      : { argumentsText: '' };
    existing.sourceSpan ??= {
      transport: 'native',
      index: sourceIndex
    };

    if (toolCall.id) {
      existing.id = toolCall.id;
    }

    if (toolCall.name) {
      existing.name = toolCall.name;
    }

    if (toolCall.argumentsKind === 'delta') {
      existing.argumentsText = mergeToolCallArgumentsText(existing.argumentsText, toolCall.argumentsText);
    } else if (toolCall.argumentsKind === 'snapshot') {
      existing.argumentsText = toolCall.argumentsText;
    }

    const geminiThoughtSignature = readGeminiThoughtSignature(toolCall.raw);
    if (geminiThoughtSignature) {
      existing.providerMetadata = {
        ...existing.providerMetadata,
        geminiThoughtSignature
      };
    }

    if (targetIndex >= 0) {
      nextToolCalls[targetIndex] = existing;
    } else {
      nextToolCalls.push(existing);
    }
  });

  target.toolCalls = nextToolCalls;
}

export function appendAnthropicToolCall(
  target: ReplyAccumulator,
  toolUse: {
    id?: unknown;
    name?: unknown;
    input?: unknown;
  }
) {
  if (typeof toolUse.name !== 'string' || !toolUse.name.trim()) return;
  const nextToolCalls = target.toolCalls ?? [];

  nextToolCalls.push({
    id: typeof toolUse.id === 'string' ? toolUse.id : '',
    name: toolUse.name,
    argumentsText: serializeProviderToolArguments(toolUse.input),
    sourceSpan: {
      transport: 'native',
      index: nextToolCalls.length
    }
  });

  target.toolCalls = nextToolCalls;
}
