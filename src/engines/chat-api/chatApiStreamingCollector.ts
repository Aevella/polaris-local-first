import type { AssistantReply, AssistantReplyProgress } from './chatApiTypes';
import type { ChatProviderReasoningState, ChatTokenUsage } from '../../types/domain';
import {
  parseProviderRuntimeStreamEvents,
  type CanonicalProviderStreamEvent
} from '../provider-runtime';
import {
  extractProviderErrorMessage,
  formatEmptyProviderResponseMessage
} from '../provider-runtime/providerRuntimeErrorPayload';
import { applyProviderRuntimeStreamEvents } from './chatApiCanonicalStreamAccumulator';
import {
  appendChunk,
  appendResponsesPayload,
  resolveAnthropicUsage,
  resolveAnthropicTokenUsage
} from '../provider-runtime/providerRuntimeResponsePayload';
import {
  toAssistantReply,
  type OpenAiToolCallAccumulator
} from '../provider-runtime/providerRuntimeReplyAccumulator';
import { extractTextPayload, extractThinkingPayload } from '../provider-runtime/providerRuntimeResponseText';
import { createStreamLineParser } from './chatApiStreamParser';

function tryParseStreamPayload(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function extractStreamPayloadCandidates(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (tryParseStreamPayload(trimmed)) return [trimmed];

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function looksLikeEventStreamText(input: string) {
  return /(^|\n)\s*(data|event|id|retry):/i.test(input);
}

function flushStreamingPayload(params: {
  payloadText: string;
  parseStreamEvents: (payload: unknown) => CanonicalProviderStreamEvent[];
  collected: {
    content: string;
    thinkingText: string;
    providerReasoning?: ChatProviderReasoningState;
    model?: string;
    tokenCount?: number;
    tokenUsage?: ChatTokenUsage;
    toolCalls?: OpenAiToolCallAccumulator[];
  };
  fallbackModel: string;
  onProgress?: (reply: AssistantReplyProgress) => void;
}): boolean {
  const { payloadText, parseStreamEvents, collected, fallbackModel, onProgress } = params;
  let updated = false;

  for (const candidate of extractStreamPayloadCandidates(payloadText)) {
    if (candidate === '[DONE]') return true;
    const parsed = tryParseStreamPayload(candidate);
    if (!parsed) continue;
    const events = parseStreamEvents(parsed);
    const errorEvent = events.find((event) => event.type === 'error');
    const providerErrorMessage = errorEvent?.type === 'error'
      ? errorEvent.error.rawMessage
      : extractProviderErrorMessage(parsed);
    if (providerErrorMessage) {
      throw new Error(providerErrorMessage);
    }
    updated = applyProviderRuntimeStreamEvents(collected, events);
    if (!updated) {
      appendChunk(collected, parsed);
      updated = true;
    }
  }

  if (updated) {
    onProgress?.(toAssistantReply(collected, fallbackModel, {
      allowThinkingFallbackInContent: false
    }));
  }

  return false;
}

export function createStreamingReplyCollector(
  fallbackModel: string,
  onProgress?: (reply: AssistantReplyProgress) => void,
  parseStreamEvents: (payload: unknown) => CanonicalProviderStreamEvent[] = parseProviderRuntimeStreamEvents
) {
  const collected = {
    content: '',
    thinkingText: '',
    providerReasoning: undefined as ChatProviderReasoningState | undefined,
    model: fallbackModel as string | undefined,
    tokenCount: undefined as number | undefined,
    tokenUsage: undefined as ChatTokenUsage | undefined,
    toolCalls: [] as OpenAiToolCallAccumulator[],
    finishReason: undefined as string | undefined,
    transportIncomplete: undefined as boolean | undefined
  };
  let buffer = '';
  let rawResponseText = '';
  let streamEnded = false;
  let usedLineParser = false;
  const lineParser = createStreamLineParser((payloadText) => {
    streamEnded = flushStreamingPayload({ payloadText, parseStreamEvents, collected, fallbackModel, onProgress });
    return streamEnded;
  });

  const pushTextChunk = (chunk: string, isEventStream: boolean) => {
    if (!chunk || streamEnded) return;

    rawResponseText += chunk;
    if (isEventStream || usedLineParser || looksLikeEventStreamText(buffer + chunk)) {
      usedLineParser = true;
      if (buffer) {
        lineParser.pushChunk(buffer);
        buffer = '';
      }
      lineParser.pushChunk(chunk);
      return;
    }

    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, '');
      if (line.trim()) {
        streamEnded = flushStreamingPayload({ payloadText: line, parseStreamEvents, collected, fallbackModel, onProgress });
        if (streamEnded) break;
      }
      newlineIndex = buffer.indexOf('\n');
    }
  };

  const finish = (): AssistantReply => {
    const trailing = buffer.trim();
    if (usedLineParser) {
      lineParser.finish();
      if (!streamEnded && !collected.finishReason) {
        collected.finishReason = 'length';
        collected.transportIncomplete = true;
      }
    } else if (trailing) {
      flushStreamingPayload({ payloadText: trailing, parseStreamEvents, collected, fallbackModel, onProgress });
    }

    if (!collected.content.trim() && rawResponseText.trim()) {
      const parsed = tryParseStreamPayload(rawResponseText.trim());
      if (parsed && typeof parsed === 'object') {
        const fallbackPayload = parsed as {
          choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; thinking?: unknown } }>;
          content?: unknown;
          model?: unknown;
          usage?: unknown;
        };

        if (fallbackPayload.choices?.[0]?.message) {
          appendChunk(collected, parsed);
        } else if (fallbackPayload.content) {
          collected.content = extractTextPayload(fallbackPayload.content);
          collected.thinkingText = extractThinkingPayload(fallbackPayload.content);
          collected.model = typeof fallbackPayload.model === 'string' ? fallbackPayload.model : fallbackModel;
          collected.tokenCount = resolveAnthropicUsage(fallbackPayload.usage);
          collected.tokenUsage = resolveAnthropicTokenUsage(fallbackPayload.usage);
        } else {
          appendResponsesPayload(collected, parsed);
        }
      }
    }

    if (!collected.content.trim() && !collected.thinkingText.trim() && !(collected.toolCalls?.length ?? 0)) {
      throw new Error(formatEmptyProviderResponseMessage(rawResponseText));
    }

    return toAssistantReply(collected, fallbackModel, {
      allowThinkingFallbackInContent: false
    });
  };

  return { pushTextChunk, finish };
}
