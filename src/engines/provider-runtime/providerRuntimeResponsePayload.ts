import type { AssistantReply } from './providerRuntimeTypes';
import type { ChatTokenUsage } from '../../types/domain';
import { toAssistantReply, type ReplyAccumulator } from './providerRuntimeReplyAccumulator';
import {
  extractProviderErrorMessage,
  formatProviderPayloadSnippet
} from './providerRuntimeErrorPayload';
import { appendAnthropicToolCall, appendOpenAiToolCalls } from './providerRuntimeResponseToolCalls';
import { extractStructuredText, extractTextPayload, extractThinkingPayload } from './providerRuntimeResponseText';
import { mergeToolCallArgumentsText } from './providerRuntimeToolArguments';
import { parseOpenAiCompatibleUsage } from './providerRuntimeUsage';

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function compactTokenUsage(usage: ChatTokenUsage): ChatTokenUsage | undefined {
  const compacted = Object.fromEntries(
    Object.entries(usage).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  ) as ChatTokenUsage;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function totalFromUsage(usage: ChatTokenUsage) {
  return usage.totalTokens
    ?? (
      typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number'
        ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        : undefined
    );
}

function applyTokenUsage(target: ReplyAccumulator, usage: ChatTokenUsage | undefined) {
  if (!usage) return;
  target.tokenUsage = usage;
  const totalTokens = totalFromUsage(usage);
  if (typeof totalTokens === 'number') {
    target.tokenCount = totalTokens;
  }
}

function parseAnthropicUsage(rawUsage: unknown): ChatTokenUsage | undefined {
  const usage = readObject(rawUsage);
  if (!usage) return undefined;
  const inputTokens = readNumber(usage.input_tokens);
  const outputTokens = readNumber(usage.output_tokens);
  const cachedInputTokens = readNumber(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = readNumber(usage.cache_creation_input_tokens);
  const totalTokens = [
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens
  ].filter((value): value is number => typeof value === 'number')
    .reduce((total, value) => total + value, 0);

  return compactTokenUsage({
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens
  });
}

function serializeResponsesFunctionArguments(argumentsValue: unknown) {
  if (typeof argumentsValue === 'string') return argumentsValue;
  if (argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
    return Object.keys(argumentsValue).length > 0 ? JSON.stringify(argumentsValue) : '';
  }
  return '';
}

function upsertResponsesFunctionCall(
  target: ReplyAccumulator,
  item: {
    name?: unknown;
    arguments?: unknown;
    call_id?: unknown;
    id?: unknown;
  }
) {
  if (typeof item.name !== 'string' || !item.name.trim()) return;

  const toolCallId = typeof item.call_id === 'string'
    ? item.call_id
    : typeof item.id === 'string'
      ? item.id
      : '';
  const nextToolCalls = target.toolCalls ?? [];
  const existing = toolCallId
    ? nextToolCalls.find((entry) => entry.id === toolCallId)
    : undefined;

  if (existing) {
    existing.name = item.name;
    existing.argumentsText = serializeResponsesFunctionArguments(item.arguments);
    target.toolCalls = nextToolCalls;
    return;
  }

  nextToolCalls.push({
    id: toolCallId,
    name: item.name,
    argumentsText: serializeResponsesFunctionArguments(item.arguments)
  });
  target.toolCalls = nextToolCalls;
}

function appendAnthropicContentBlock(target: ReplyAccumulator, block: unknown) {
  if (!block || typeof block !== 'object') return;
  const parsed = block as {
    type?: unknown;
    text?: unknown;
    thinking?: unknown;
    id?: unknown;
    name?: unknown;
    input?: unknown;
  };

  if (parsed.type === 'text' && typeof parsed.text === 'string') {
    target.content += parsed.text;
    return;
  }
  if (parsed.type === 'thinking') {
    const thinking =
      typeof parsed.thinking === 'string'
        ? parsed.thinking
        : typeof parsed.text === 'string'
          ? parsed.text
          : '';
    if (thinking) target.thinkingText += thinking;
    return;
  }
  if (parsed.type === 'tool_use') {
    appendAnthropicToolCall(target, parsed);
  }
}

function appendResponsesOutputItem(target: ReplyAccumulator, item: unknown) {
  if (!item || typeof item !== 'object') return;

  const parsed = item as {
    type?: unknown;
    content?: unknown;
    summary?: unknown;
    name?: unknown;
    arguments?: unknown;
    call_id?: unknown;
    id?: unknown;
  };

  if (parsed.type === 'message') {
    const content = extractStructuredText(parsed.content);
    if (content) target.content += content;
    return;
  }

  if (parsed.type === 'reasoning') {
    const thinking = extractStructuredText(parsed.content) || extractStructuredText(parsed.summary);
    if (thinking) target.thinkingText += thinking;
    return;
  }

  if (parsed.type === 'function_call') {
    upsertResponsesFunctionCall(target, parsed);
  }
}

export function appendResponsesPayload(target: ReplyAccumulator, payload: unknown) {
  if (!payload || typeof payload !== 'object') return;

  const parsed = payload as {
    model?: unknown;
    output_text?: unknown;
    output?: unknown;
    status?: unknown;
    usage?: {
      total_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
    };
  };

  if (parsed.status === 'incomplete') {
    target.finishReason = 'length';
  }

  if (typeof parsed.model === 'string') {
    target.model = parsed.model;
  }

  applyTokenUsage(target, parseOpenAiCompatibleUsage(parsed.usage));

  const outputText = extractStructuredText(parsed.output_text);
  if (outputText) {
    target.content += outputText;
  }

  if (Array.isArray(parsed.output)) {
    parsed.output.forEach((item) => appendResponsesOutputItem(target, item));
  }
}

function appendSemanticResponseEvent(target: ReplyAccumulator, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;

  const parsed = payload as {
    type?: unknown;
    delta?: unknown;
    text?: unknown;
    item_id?: unknown;
    item?: unknown;
    response?: unknown;
    arguments?: unknown;
  };

  if (typeof parsed.type !== 'string' || !parsed.type.startsWith('response.')) {
    return false;
  }

  if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
    target.content += parsed.delta;
    return true;
  }

  if (parsed.type === 'response.output_text.done' && typeof parsed.text === 'string') {
    if (!target.content.trim()) {
      target.content += parsed.text;
    }
    return true;
  }

  if (
    (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done')
    && parsed.item
    && typeof parsed.item === 'object'
  ) {
    appendResponsesOutputItem(target, parsed.item);
    return true;
  }

  if (parsed.type === 'response.function_call_arguments.delta' && typeof parsed.delta === 'string') {
    const nextToolCalls = target.toolCalls ?? [];
    const existing =
      nextToolCalls.find((entry) => entry.id && entry.id === parsed.item_id) ??
      nextToolCalls[nextToolCalls.length - 1];
    if (existing) {
      existing.argumentsText = mergeToolCallArgumentsText(existing.argumentsText, parsed.delta);
      target.toolCalls = nextToolCalls;
    }
    return true;
  }

  if (parsed.type === 'response.function_call_arguments.done' && typeof parsed.arguments === 'string') {
    const nextToolCalls = target.toolCalls ?? [];
    const existing =
      nextToolCalls.find((entry) => entry.id && entry.id === parsed.item_id) ??
      nextToolCalls[nextToolCalls.length - 1];
    if (existing) {
      existing.argumentsText = parsed.arguments;
      target.toolCalls = nextToolCalls;
    }
    return true;
  }

  if (parsed.type === 'response.completed' && parsed.response) {
    appendResponsesPayload(target, parsed.response);
    target.finishReason ??= 'stop';
    return true;
  }

  return false;
}

export function resolveAnthropicUsage(usage: unknown): number | undefined {
  return totalFromUsage(parseAnthropicUsage(usage) ?? {});
}

export function resolveAnthropicTokenUsage(usage: unknown): ChatTokenUsage | undefined {
  return parseAnthropicUsage(usage);
}

export function appendChunk(target: ReplyAccumulator, payload: unknown) {
  if (!payload || typeof payload !== 'object') return;

  if (appendSemanticResponseEvent(target, payload)) {
    return;
  }

  const anthropicPayload = payload as {
    type?: unknown;
    content_block?: unknown;
    message?: { model?: unknown; usage?: unknown; stop_reason?: unknown };
    usage?: unknown;
    delta?: { type?: unknown; text?: unknown; thinking?: unknown; partial_json?: unknown; stop_reason?: unknown };
    error?: { message?: unknown };
  };

  if (typeof anthropicPayload.type === 'string') {
    if (anthropicPayload.type === 'error') {
      throw new Error(
        typeof anthropicPayload.error?.message === 'string'
          ? anthropicPayload.error.message
          : 'Anthropic 流式请求失败'
      );
    }

    if (typeof anthropicPayload.message?.model === 'string') {
      target.model = anthropicPayload.message.model;
    }

    applyTokenUsage(
      target,
      resolveAnthropicTokenUsage(anthropicPayload.usage) ??
        resolveAnthropicTokenUsage(anthropicPayload.message?.usage)
    );

    const anthropicStopReason =
      (typeof anthropicPayload.delta?.stop_reason === 'string' && anthropicPayload.delta.stop_reason) ||
      (typeof anthropicPayload.message?.stop_reason === 'string' && anthropicPayload.message.stop_reason);
    if (anthropicStopReason) {
      target.finishReason = anthropicStopReason === 'max_tokens' ? 'length' : anthropicStopReason;
    }
    if (anthropicPayload.type === 'message_stop' && !target.finishReason) {
      target.finishReason = 'stop';
    }

    if (anthropicPayload.type === 'content_block_start') {
      appendAnthropicContentBlock(target, anthropicPayload.content_block);
    }

    if (anthropicPayload.type === 'content_block_delta') {
      if (anthropicPayload.delta?.type === 'text_delta' && typeof anthropicPayload.delta.text === 'string') {
        target.content += anthropicPayload.delta.text;
      }
      if (anthropicPayload.delta?.type === 'thinking_delta' && typeof anthropicPayload.delta.thinking === 'string') {
        target.thinkingText += anthropicPayload.delta.thinking;
      }
      if (
        anthropicPayload.delta?.type === 'input_json_delta'
        && typeof anthropicPayload.delta.partial_json === 'string'
      ) {
        const lastToolCall = target.toolCalls?.[target.toolCalls.length - 1];
        if (lastToolCall) {
          lastToolCall.argumentsText = mergeToolCallArgumentsText(
            lastToolCall.argumentsText,
            anthropicPayload.delta.partial_json
          );
        }
      }
    }
    return;
  }

  const parsed = payload as {
    model?: unknown;
    usage?: { total_tokens?: unknown };
    choices?: Array<{
      finish_reason?: unknown;
      usage?: unknown;
      delta?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
        thinking?: unknown;
        tool_calls?: unknown;
      };
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
        thinking?: unknown;
        tool_calls?: unknown;
      };
    }>;
  };

  if (typeof parsed.model === 'string') {
    target.model = parsed.model;
  }
  applyTokenUsage(target, parseOpenAiCompatibleUsage(parsed.usage ?? parsed.choices?.[0]?.usage));

  const finishReason = parsed.choices?.[0]?.finish_reason;
  if (typeof finishReason === 'string' && finishReason) {
    target.finishReason = finishReason;
  }

  const message = parsed.choices?.[0]?.delta ?? parsed.choices?.[0]?.message;
  if (!message) return;
  appendOpenAiToolCalls(target, message.tool_calls);

  const content = extractTextPayload(message.content);
  const thinking =
    extractThinkingPayload(message.reasoning_content) ||
    extractThinkingPayload(message.reasoning) ||
    extractThinkingPayload(message.thinking);

  if (content) target.content += content;
  if (thinking) target.thinkingText += thinking;
}

export function extractAnthropicReply(data: unknown, fallbackModel: string): AssistantReply {
  const providerErrorMessage = extractProviderErrorMessage(data);
  if (providerErrorMessage) {
    throw new Error(providerErrorMessage);
  }

  const parsed = data as { content?: unknown; model?: unknown; usage?: unknown; stop_reason?: unknown };
  const collected: ReplyAccumulator = {
    content: '',
    thinkingText: '',
    model: typeof parsed?.model === 'string' ? parsed.model : fallbackModel,
    tokenCount: resolveAnthropicUsage(parsed?.usage),
    tokenUsage: resolveAnthropicTokenUsage(parsed?.usage),
    toolCalls: [],
    finishReason: parsed?.stop_reason === 'max_tokens' ? 'length' : undefined
  };

  if (Array.isArray(parsed?.content)) {
    parsed.content.forEach((block) => appendAnthropicContentBlock(collected, block));
  } else {
    const content = extractTextPayload(parsed?.content);
    const thinkingText = extractThinkingPayload(parsed?.content);
    collected.content = content;
    collected.thinkingText = thinkingText;
  }

  if (
    !collected.content.trim()
    && !collected.thinkingText.trim()
    && !(collected.toolCalls?.length ?? 0)
  ) {
    const rawSnippet = formatProviderPayloadSnippet(data);
    throw new Error(rawSnippet ? `API 返回为空：${rawSnippet}` : 'API 返回为空');
  }

  return toAssistantReply(collected, fallbackModel, {
    allowThinkingFallbackInContent: (collected.toolCalls?.length ?? 0) === 0
  });
}

export function extractOpenAiCompatibleReply(data: unknown, fallbackModel: string): AssistantReply {
  const providerErrorMessage = extractProviderErrorMessage(data);
  if (providerErrorMessage) {
    throw new Error(providerErrorMessage);
  }

  const collected: ReplyAccumulator = {
    content: '',
    thinkingText: '',
    model: fallbackModel,
    tokenCount: undefined,
    toolCalls: []
  };
  appendChunk(collected, data);
  if (!collected.content.trim() && !collected.thinkingText.trim() && !(collected.toolCalls?.length ?? 0)) {
    appendResponsesPayload(collected, data);
  }

  if (!collected.content.trim() && !collected.thinkingText.trim() && !(collected.toolCalls?.length ?? 0)) {
    const rawSnippet = formatProviderPayloadSnippet(data);
    throw new Error(rawSnippet ? `API 返回为空：${rawSnippet}` : 'API 返回为空');
  }

  return toAssistantReply(collected, fallbackModel, {
    allowThinkingFallbackInContent: (collected.toolCalls?.length ?? 0) === 0
  });
}
