import type { CanonicalProviderStreamEvent } from '../provider-runtime';
import type { ReplyAccumulator } from '../provider-runtime/providerRuntimeReplyAccumulator';
import { mergeToolCallArgumentsText } from '../provider-runtime/providerRuntimeToolArguments';
import { mergeProviderReasoningState } from '../provider-runtime/providerRuntimeReasoningState';

type UsageStreamEvent = Extract<CanonicalProviderStreamEvent, { type: 'usage' }>;

function totalFromUsage(usage: UsageStreamEvent['usage']) {
  return usage.totalTokens
    ?? (
      typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number'
        ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        : undefined
    );
}

type ToolCallStreamEvent = Extract<
  CanonicalProviderStreamEvent,
  { type: 'tool_call.start' | 'tool_call.delta' | 'tool_call.done' }
>;

function providerToolCallIndex(event: ToolCallStreamEvent) {
  return typeof event.index === 'number' && event.index >= 0
    ? event.index
    : undefined;
}

function resolveToolCallSlot(target: ReplyAccumulator, event: ToolCallStreamEvent) {
  const toolCalls = target.toolCalls ?? [];
  if (event.id) {
    const existingIndex = toolCalls.findIndex((call) => call.id === event.id);
    if (existingIndex !== -1) return existingIndex;
  }

  const providerIndex = providerToolCallIndex(event);
  if (providerIndex !== undefined) {
    const existingIndex = toolCalls.findIndex((call) => call.sourceSpan?.index === providerIndex);
    if (existingIndex !== -1) return existingIndex;
  }

  if (event.type === 'tool_call.start' || event.id || providerIndex !== undefined) {
    return toolCalls.length;
  }

  return Math.max(toolCalls.length - 1, 0);
}

export function applyProviderRuntimeStreamEvents(
  target: ReplyAccumulator,
  events: CanonicalProviderStreamEvent[]
) {
  if (events.length === 0) return false;
  let changed = false;

  events.forEach((event) => {
    if (event.type === 'metadata') {
      if (event.model) {
        target.model = event.model;
        changed = true;
      }
      return;
    }
    if (event.type === 'text.delta') {
      target.content += event.text;
      changed = true;
      return;
    }
    if (event.type === 'text.snapshot') {
      target.content = event.text;
      changed = true;
      return;
    }
    if (event.type === 'reasoning.delta') {
      target.thinkingText += event.text;
      changed = true;
      return;
    }
    if (event.type === 'reasoning.snapshot') {
      target.thinkingText = event.text;
      changed = true;
      return;
    }
    if (event.type === 'reasoning.state') {
      target.providerReasoning = mergeProviderReasoningState(target.providerReasoning, event.state);
      changed = true;
      return;
    }
    if (event.type === 'usage') {
      target.tokenUsage = event.usage;
      const tokenCount = totalFromUsage(event.usage);
      if (typeof tokenCount === 'number') {
        target.tokenCount = tokenCount;
      }
      changed = true;
      return;
    }
    if (event.type === 'done') {
      target.finishReason = event.finishReason;
      target.transportIncomplete = event.transportIncomplete;
      changed = true;
      return;
    }
    if (event.type === 'error') {
      return;
    }

    const nextToolCalls = target.toolCalls ?? [];
    const targetSlot = resolveToolCallSlot(target, event);
    const existing = nextToolCalls[targetSlot] ?? {
      argumentsText: ''
    };

    if (event.type === 'tool_call.start') {
      if (event.id) {
        existing.id = event.id;
      }
      existing.name = event.name;
    }
    if (event.type === 'tool_call.delta') {
      if (event.id) {
        existing.id = event.id;
      }
      existing.argumentsText = mergeToolCallArgumentsText(existing.argumentsText, event.argumentsDelta);
    }
    if (event.type === 'tool_call.done') {
      if (event.id) {
        existing.id = event.id;
      }
      if (event.name) {
        existing.name = event.name;
      }
      existing.argumentsText = event.argumentsText;
    }

    existing.sourceSpan ??= {
      transport: 'native',
      index: providerToolCallIndex(event) ?? targetSlot
    };
    nextToolCalls[targetSlot] = existing;
    target.toolCalls = nextToolCalls;
    changed = true;
  });

  return changed;
}
