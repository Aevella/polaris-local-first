import type { ChatTokenUsage } from '../../types/domain';
import type {
  CanonicalProviderStreamEvent,
  CanonicalProviderToolCall
} from './providerRuntimeTypes';
import { extractStructuredText } from './providerRuntimeResponseText';
import { mergeToolCallArgumentsText } from './providerRuntimeToolArguments';
import { parseOpenAiCompatibleUsage } from './providerRuntimeUsage';

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compactUsage(usage: ChatTokenUsage): ChatTokenUsage | undefined {
  const entries = Object.entries(usage)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
  return entries.length ? Object.fromEntries(entries) as ChatTokenUsage : undefined;
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

  return compactUsage({
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens
  });
}

function serializeArguments(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return '';
}

function pushUsage(events: CanonicalProviderStreamEvent[], usage: ChatTokenUsage | undefined) {
  if (usage) {
    events.push({ type: 'usage', usage });
  }
}

function pushResponsesOutputItemEvents(events: CanonicalProviderStreamEvent[], item: unknown) {
  const parsed = readObject(item);
  if (!parsed) return;

  if (parsed.type === 'message') {
    const text = extractStructuredText(parsed.content);
    if (text) {
      events.push({ type: 'text.snapshot', text });
    }
    return;
  }

  if (parsed.type === 'reasoning') {
    const text = extractStructuredText(parsed.content) || extractStructuredText(parsed.summary);
    if (text) {
      events.push({ type: 'reasoning.snapshot', text, mode: 'text' });
    }
    return;
  }

  if (parsed.type === 'function_call' && typeof parsed.name === 'string') {
    events.push({
      type: 'tool_call.done',
      id: typeof parsed.call_id === 'string' ? parsed.call_id : typeof parsed.id === 'string' ? parsed.id : '',
      name: parsed.name,
      argumentsText: serializeArguments(parsed.arguments)
    });
  }
}

function parseOpenAiToolCallDelta(rawToolCall: unknown): CanonicalProviderStreamEvent[] {
  const toolCall = readObject(rawToolCall);
  const delta = readObject(toolCall?.function);
  if (!toolCall || !delta) return [];

  const id = typeof toolCall.id === 'string' ? toolCall.id : '';
  const index = typeof toolCall.index === 'number' && toolCall.index >= 0 ? toolCall.index : undefined;
  const name = typeof delta.name === 'string' ? delta.name : '';
  const argumentsDelta = typeof delta.arguments === 'string' ? delta.arguments : '';
  const events: CanonicalProviderStreamEvent[] = [];

  if (name) {
    events.push({ type: 'tool_call.start', id, name, index });
  }
  if (argumentsDelta) {
    events.push({ type: 'tool_call.delta', id, argumentsDelta, index });
  }
  return events;
}

function parseResponsesStreamEvent(payload: Record<string, unknown>): CanonicalProviderStreamEvent[] | null {
  const type = typeof payload.type === 'string' ? payload.type : '';
  if (!type.startsWith('response.')) return null;

  if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    return [{ type: 'text.delta', text: payload.delta }];
  }
  if (type === 'response.function_call_arguments.delta' && typeof payload.delta === 'string') {
    return [{
      type: 'tool_call.delta',
      id: typeof payload.item_id === 'string' ? payload.item_id : '',
      argumentsDelta: payload.delta
    }];
  }
  if (type === 'response.function_call_arguments.done' && typeof payload.arguments === 'string') {
    return [{
      type: 'tool_call.done',
      id: typeof payload.item_id === 'string' ? payload.item_id : '',
      name: '',
      argumentsText: payload.arguments
    }];
  }
  if (type === 'response.output_item.added') {
    const item = readObject(payload.item);
    if (item?.type === 'function_call' && typeof item.name === 'string') {
      return [{
        type: 'tool_call.start',
        id: typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : '',
        name: item.name
      }];
    }
    return [];
  }
  if (type === 'response.output_item.done') {
    const item = readObject(payload.item);
    if (item?.type === 'function_call' && typeof item.name === 'string') {
      return [{
        type: 'tool_call.done',
        id: typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : '',
        name: item.name,
        argumentsText: serializeArguments(item.arguments)
      }];
    }
    return [];
  }
  if (type === 'response.completed') {
    const response = readObject(payload.response);
    const events: CanonicalProviderStreamEvent[] = [
      {
        type: 'metadata',
        model: typeof response?.model === 'string' ? response.model : undefined
      }
    ];
    const outputText = extractStructuredText(response?.output_text);
    if (outputText) {
      events.push({ type: 'text.snapshot', text: outputText });
    }
    if (Array.isArray(response?.output)) {
      response.output.forEach((item) => pushResponsesOutputItemEvents(events, item));
    }
    pushUsage(events, parseOpenAiCompatibleUsage(response?.usage));
    events.push({ type: 'done', finishReason: 'stop' });
    return events;
  }

  return [];
}

function parseAnthropicStreamEvent(payload: Record<string, unknown>): CanonicalProviderStreamEvent[] | null {
  const type = typeof payload.type === 'string' ? payload.type : '';
  if (!type) return null;
  const events: CanonicalProviderStreamEvent[] = [];
  const blockIndex = readNumber(payload.index);
  const usage = parseAnthropicUsage(payload.usage ?? readObject(payload.message)?.usage);
  const message = readObject(payload.message);
  const delta = readObject(payload.delta);
  if (typeof message?.model === 'string') {
    events.push({ type: 'metadata', model: message.model });
  }

  if (type === 'content_block_start') {
    const block = readObject(payload.content_block);
    if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      events.push({ type: 'tool_call.start', id: block.id, name: block.name, index: blockIndex });
    }
    if (block?.type === 'text' && typeof block.text === 'string') {
      events.push({ type: 'text.delta', text: block.text });
    }
    if (block?.type === 'thinking') {
      const text = typeof block.thinking === 'string'
        ? block.thinking
        : typeof block.text === 'string'
          ? block.text
          : '';
      if (text) {
        events.push({ type: 'reasoning.delta', text, mode: 'text' });
      }
    }
  }
  if (type === 'content_block_delta') {
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      events.push({ type: 'text.delta', text: delta.text });
    }
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      events.push({ type: 'reasoning.delta', text: delta.thinking, mode: 'text' });
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      events.push({ type: 'tool_call.delta', id: '', argumentsDelta: delta.partial_json, index: blockIndex });
    }
  }
  if (type === 'message_delta') {
    const stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined;
    if (stopReason) {
      events.push({ type: 'done', finishReason: stopReason === 'max_tokens' ? 'length' : stopReason });
    }
  }
  if (type === 'message_stop') {
    events.push({ type: 'done', finishReason: 'stop' });
  }
  pushUsage(events, usage);
  return events;
}

function parseOpenAiCompatibleStreamEvent(payload: Record<string, unknown>): CanonicalProviderStreamEvent[] {
  const events: CanonicalProviderStreamEvent[] = [];
  const choice = Array.isArray(payload.choices) ? readObject(payload.choices[0]) : undefined;
  const message = readObject(choice?.delta) ?? readObject(choice?.message);
  const usage = parseOpenAiCompatibleUsage(payload.usage ?? choice?.usage);
  if (typeof payload.model === 'string') {
    events.push({ type: 'metadata', model: payload.model });
  }

  if (message) {
    const content = message.content;
    if (typeof content === 'string' && content) {
      events.push({ type: 'text.delta', text: content });
    }
    const reasoning = message.reasoning_content ?? message.reasoning ?? message.thinking;
    if (typeof reasoning === 'string' && reasoning) {
      events.push({ type: 'reasoning.delta', text: reasoning, mode: 'text' });
    }
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach((toolCall) => {
        events.push(...parseOpenAiToolCallDelta(toolCall));
      });
    }
  }

  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
  if (finishReason) {
    events.push({ type: 'done', finishReason });
  }
  pushUsage(events, usage);
  return events;
}

export function parseOpenAiResponsesStreamEvents(payload: unknown): CanonicalProviderStreamEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return parseResponsesStreamEvent(payload as Record<string, unknown>) ?? [];
}

export function parseAnthropicMessagesStreamEvents(payload: unknown): CanonicalProviderStreamEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return parseAnthropicStreamEvent(payload as Record<string, unknown>) ?? [];
}

export function parseOpenAiCompatibleStreamEvents(payload: unknown): CanonicalProviderStreamEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return parseOpenAiCompatibleStreamEvent(payload as Record<string, unknown>);
}

export function parseProviderRuntimeStreamEvents(payload: unknown): CanonicalProviderStreamEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const objectPayload = payload as Record<string, unknown>;
  return parseResponsesStreamEvent(objectPayload)
    ?? parseAnthropicStreamEvent(objectPayload)
    ?? parseOpenAiCompatibleStreamEvent(objectPayload);
}

export function canonicalToolCallFromStreamEvents(
  events: CanonicalProviderStreamEvent[]
): CanonicalProviderToolCall[] {
  const calls = new Map<string, CanonicalProviderToolCall>();
  events.forEach((event) => {
    if (event.type === 'tool_call.start') {
      calls.set(event.id, {
        id: event.id,
        name: event.name,
        argumentsText: ''
      });
    }
    if (event.type === 'tool_call.delta') {
      const existing = calls.get(event.id) ?? {
        id: event.id,
        name: '',
        argumentsText: ''
      };
      existing.argumentsText = mergeToolCallArgumentsText(existing.argumentsText, event.argumentsDelta);
      calls.set(event.id, existing);
    }
    if (event.type === 'tool_call.done') {
      calls.set(event.id, {
        id: event.id,
        name: event.name,
        argumentsText: serializeArguments(event.argumentsText)
      });
    }
  });
  return Array.from(calls.values());
}
