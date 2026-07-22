import { inferProviderProtocol } from '../providerProtocol';
import { sanitizeToolsForGeminiFunctionDeclarations } from './providerRuntimeGeminiSchema';
import {
  buildHistoricalToolCallNameMap,
  buildOrderedMessages,
  extractTextPayload
} from './requestShared/messages';
import { buildOpenAiCompatibleHeaders } from './requestShared/headers';
import {
  resolveOpenAiToolChoice,
  resolveRequestBuilderBase,
  shouldSendTemperature,
  shouldSendTopP
} from './requestShared/sampling';
import { buildToolResultPayloadText } from './requestShared/toolResultPayload';
import { buildRequestResult } from './requestShared/transportSanitize';
import { buildApiEndpoint } from '../chat-api/chatApiEndpoint';
import type { ProviderAdapterMatch } from './providerRuntimeTypes';
import type { ProviderRuntimeRequestAdapter } from './providerRuntimeRequestTypes';
import type { ProviderRuntimeRequestInput } from './providerRuntimeRequestTypes';
import { classifyProviderRuntimeError, resolveProviderRuntimeRetry } from './providerRuntimeRetryPolicy';
import type { OpenAiToolHistoryMode } from './providerRuntimeOpenAiToolHistory';
import { parseOpenAiCompatibleStreamEvents } from './providerRuntimeStreamEvents';
import { extractOpenAiCompatibleReply } from './providerRuntimeResponsePayload';
import { setConnectionTestOutputTokenField } from './providerRuntimeConnectionTest';
import {
  canonicalProviderCapabilitiesFromContract,
  resolveProviderCapability,
  type ProviderCapability
} from './providerCapability';
import type { OrderedContextMessage } from './requestShared/types';
import {
  isMoonshotHost,
  parseProviderHost
} from './internal/providerMatching';
import { resolveOpenRouterSessionId } from './providerRuntimeOpenRouterSession';

const OPENAI_COMPATIBLE_CHAT_ADAPTER_ID = 'openai-compatible-chat';
type OpenAiCompatibleCacheControl = { type: 'ephemeral'; ttl?: '1h' };

function protocolMatch(
  protocol: ReturnType<typeof inferProviderProtocol>
): ProviderAdapterMatch {
  return {
    adapterId: OPENAI_COMPATIBLE_CHAT_ADAPTER_ID,
    confidence: 'exact',
    reason: `matched provider protocol: ${protocol}`
  };
}

function canRoundtripOpenAiGeminiThoughtSignatures(capability: ProviderCapability) {
  return capability.tools.geminiThoughtSignatureTransport === 'openai-extra-content';
}

function shouldRequestStreamUsage(capability: ProviderCapability) {
  const host = parseProviderHost(capability.provider.baseUrl);
  return capability.streaming.usage && isMoonshotHost(host);
}

function buildOpenAiReasoningContent(
  message: ProviderRuntimeRequestInput['context']['segments'][number]['messages'][number],
  capability: ProviderCapability
) {
  if (capability.output.reasoning.replay === 'omit') {
    return {};
  }
  if (message.role !== 'assistant') {
    return {};
  }
  const reasoningContent = message.thinkingText?.trim() ? message.thinkingText : '';
  if (capability.output.reasoning.replay === 'omit-empty' && !reasoningContent) {
    return {};
  }
  return { reasoning_content: reasoningContent };
}

function buildOpenAiCompatibleCacheControl(ttl: '5m' | '1h' = '1h'): OpenAiCompatibleCacheControl {
  return ttl === '1h'
    ? { type: 'ephemeral', ttl: '1h' }
    : { type: 'ephemeral' };
}

function resolveOpenAiCompatibleCacheControlIndexes(
  context: ProviderRuntimeRequestInput['context'],
  orderedMessages: OrderedContextMessage[]
) {
  let latestConversationIndex = -1;
  for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
    const message = orderedMessages[index];
    if (
      message?.contextSegmentKind === 'conversation'
      && (message.role === 'user' || message.role === 'assistant')
      && extractTextPayload(message.content).trim().length > 0
    ) {
      latestConversationIndex = index;
      break;
    }
  }
  if (!context.cachePlan) {
    for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
      const message = orderedMessages[index];
      if (message?.role === 'system' && message.cachePrefixEligible === true) {
        return new Map([
          [index, buildOpenAiCompatibleCacheControl()],
          ...(latestConversationIndex >= 0
            ? [[latestConversationIndex, buildOpenAiCompatibleCacheControl('5m')] as const]
            : [])
        ]);
      }
    }
    return latestConversationIndex >= 0
      ? new Map([[latestConversationIndex, buildOpenAiCompatibleCacheControl('5m')]])
      : new Map<number, OpenAiCompatibleCacheControl>();
  }

  const cacheIndexes = new Map<number, OpenAiCompatibleCacheControl>();
  for (const breakpoint of context.cachePlan.breakpoints) {
    if (!breakpoint.eligible) continue;
    const breakpointPartNames = new Set(breakpoint.partNames);
    for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
      const message = orderedMessages[index];
      if (message?.role !== 'system') continue;
      const promptPartName = message.promptPartName;
      if (promptPartName && breakpointPartNames.has(promptPartName)) {
        cacheIndexes.set(index, buildOpenAiCompatibleCacheControl(breakpoint.ttl));
        break;
      }
    }
  }
  if (latestConversationIndex >= 0) {
    cacheIndexes.set(latestConversationIndex, buildOpenAiCompatibleCacheControl('5m'));
  }
  return cacheIndexes;
}

function attachCacheControlToContent(content: unknown, cacheControl: OpenAiCompatibleCacheControl) {
  if (Array.isArray(content)) {
    const nextContent = content.map((part) => part);
    for (let index = nextContent.length - 1; index >= 0; index -= 1) {
      const part = nextContent[index];
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
      if ((part as { type?: unknown }).type !== 'text') continue;
      if (typeof (part as { text?: unknown }).text !== 'string') continue;
      nextContent[index] = { ...part, cache_control: cacheControl };
      return nextContent;
    }
    return content;
  }

  const text = typeof content === 'string' ? content : extractTextPayload(content);
  return text.trim()
    ? [{ type: 'text' as const, text, cache_control: cacheControl }]
    : content;
}

function contextHasToolHistory(context: ProviderRuntimeRequestInput['context']) {
  return context.segments.some((segment) =>
    segment.messages.some((message) => Boolean(message.toolCalls?.length) || Boolean(message.toolResult))
  );
}

function resolveOpenAiCompatibleToolHistoryMode(params: {
  context: ProviderRuntimeRequestInput['context'];
  currentMode: OpenAiToolHistoryMode;
  capability: ProviderCapability;
}): OpenAiToolHistoryMode {
  if (params.currentMode === 'transcript') {
    return 'transcript';
  }
  if (
    params.capability.tools.openAiHistoryReplay === 'transcript-when-continuity-unsupported'
    && contextHasToolHistory(params.context)
  ) {
    return 'transcript';
  }
  return 'native';
}

function collectCompleteNativeToolHistoryIndexes(messages: OrderedContextMessage[]) {
  const assistantIndexes = new Set<number>();
  const toolResultIndexes = new Set<number>();

  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      return;
    }

    const requiredToolCallIds = message.toolCalls
      .map((toolCall) => toolCall.id?.trim())
      .filter((id): id is string => Boolean(id));
    if (requiredToolCallIds.length !== message.toolCalls.length) {
      return;
    }

    const matchedIndexes = new Map<string, number>();
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor];
      if (candidate?.role !== 'tool' || !candidate.toolResult) {
        break;
      }
      const toolCallId = candidate.toolResult.toolCallId.trim();
      if (requiredToolCallIds.includes(toolCallId) && !matchedIndexes.has(toolCallId)) {
        matchedIndexes.set(toolCallId, cursor);
      }
      if (matchedIndexes.size === requiredToolCallIds.length) {
        break;
      }
    }

    if (requiredToolCallIds.every((toolCallId) => matchedIndexes.has(toolCallId))) {
      assistantIndexes.add(index);
      matchedIndexes.forEach((matchedIndex) => toolResultIndexes.add(matchedIndex));
    }
  });

  return {
    assistantIndexes,
    toolResultIndexes
  };
}

function buildToolResultTranscript(
  message: OrderedContextMessage,
  normalizedToolName: string
) {
  return [
    `[tool_result:${normalizedToolName}]`,
    buildToolResultPayloadText(message, {
      toolName: normalizedToolName,
      kind: normalizedToolName
    })
  ].join('\n\n');
}

function buildAssistantToolCallTranscript(
  message: OrderedContextMessage,
  normalizedToolNames: Map<string, string>
) {
  const toolCallTranscript = JSON.stringify(
    (message.toolCalls ?? []).map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.id ? (normalizedToolNames.get(toolCall.id) ?? toolCall.name) : toolCall.name,
      arguments: toolCall.argumentsText
    })),
    null,
    2
  );
  return [extractTextPayload(message.content).trim(), '[assistant_tool_calls]', toolCallTranscript]
    .filter(Boolean)
    .join('\n\n');
}

function buildOpenAiCompatibleMessages(
  context: ProviderRuntimeRequestInput['context'],
  capability: ProviderCapability,
  options: {
    includeGeminiThoughtSignatures: boolean;
  }
) {
  const orderedMessages = buildOrderedMessages(context, capability.context);
  const normalizedToolNames = buildHistoricalToolCallNameMap(orderedMessages);
  const completeNativeToolHistory = collectCompleteNativeToolHistoryIndexes(orderedMessages);
  const cacheControlIndexes = capability.cache.openAiCompatibleCacheControl
    ? resolveOpenAiCompatibleCacheControlIndexes(context, orderedMessages)
    : new Map<number, OpenAiCompatibleCacheControl>();

  return orderedMessages.map((message, index) => {
    const messageContent = cacheControlIndexes.has(index)
      ? attachCacheControlToContent(message.content, cacheControlIndexes.get(index)!)
      : message.content;
    if (message.role === 'assistant') {
      const hasCompleteNativeToolHistory = completeNativeToolHistory.assistantIndexes.has(index);
      const toolCalls = hasCompleteNativeToolHistory
        ? message.toolCalls?.map((toolCall) => {
          const thoughtSignature = toolCall.providerMetadata?.geminiThoughtSignature;
          return {
            id: toolCall.id,
            type: 'function' as const,
            function: {
              name: toolCall.id ? (normalizedToolNames.get(toolCall.id) ?? toolCall.name) : toolCall.name,
              arguments: toolCall.argumentsText
            },
            ...(
              options.includeGeminiThoughtSignatures && thoughtSignature
                ? {
                    extra_content: {
                      google: {
                        thought_signature: thoughtSignature
                      }
                    }
                  }
                : {}
            )
          };
        })
        : undefined;
      const content = message.toolCalls?.length && !hasCompleteNativeToolHistory
        ? buildAssistantToolCallTranscript(message, normalizedToolNames)
        : messageContent;
      return {
        role: 'assistant' as const,
        content,
        ...buildOpenAiReasoningContent(message, capability),
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {})
      };
    }

    if (message.role === 'tool' && message.toolResult) {
      const normalizedToolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      if (!completeNativeToolHistory.toolResultIndexes.has(index)) {
        return {
          role: 'user' as const,
          content: buildToolResultTranscript(message, normalizedToolName)
        };
      }
      return {
        role: 'tool' as const,
        tool_call_id: message.toolResult.toolCallId,
        name: normalizedToolName,
        content: buildToolResultPayloadText(message, {
          toolName: normalizedToolName,
          kind: normalizedToolName
        })
      };
    }

    return {
      role: message.role,
      content: messageContent
    };
  });
}

function buildOpenAiCompatibleTranscriptMessages(
  context: ProviderRuntimeRequestInput['context'],
  capability: ProviderCapability
) {
  const orderedMessages = buildOrderedMessages(context, capability.context);
  const normalizedToolNames = buildHistoricalToolCallNameMap(orderedMessages);

  const transcriptMessages = orderedMessages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: buildAssistantToolCallTranscript(message, normalizedToolNames),
        ...buildOpenAiReasoningContent(message, capability)
      };
    }

    if (message.role === 'tool' && message.toolResult) {
      const normalizedToolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      return {
        role: 'user' as const,
        content: [
          `[tool_result:${normalizedToolName}]`,
          buildToolResultPayloadText(message, {
            toolName: normalizedToolName,
            kind: normalizedToolName
          })
        ].join('\n\n')
      };
    }

    const baseMessage = {
      role: message.role,
      content: message.content
    };
    return message.role === 'assistant'
      ? {
          ...baseMessage,
          ...buildOpenAiReasoningContent(message, capability)
        }
      : baseMessage;
  });

  return coerceTranscriptMessagesToAlternatingRoles(transcriptMessages);
}

type OpenAiCompatibleTranscriptMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  [key: string]: unknown;
};

function stringifyTranscriptContent(content: unknown) {
  const text = extractTextPayload(content).trim();
  if (text) return text;
  if (typeof content === 'string') return content.trim();
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function normalizeTranscriptUserContent(content: unknown) {
  return Array.isArray(content) ? content : stringifyTranscriptContent(content);
}

function transcriptContentToParts(content: unknown) {
  if (Array.isArray(content)) return content;
  const text = stringifyTranscriptContent(content);
  return text ? [{ type: 'text' as const, text }] : [];
}

function mergeTranscriptContent(previous: unknown, next: unknown) {
  if (Array.isArray(previous) || Array.isArray(next)) {
    return [
      ...transcriptContentToParts(previous),
      ...transcriptContentToParts(next)
    ];
  }

  return [
    stringifyTranscriptContent(previous),
    stringifyTranscriptContent(next)
  ].filter(Boolean).join('\n\n');
}

function normalizeTranscriptRole(message: OpenAiCompatibleTranscriptMessage): OpenAiCompatibleTranscriptMessage {
  if (message.role === 'assistant') {
    return {
      ...message,
      content: stringifyTranscriptContent(message.content)
    };
  }

  const content = message.role === 'user'
    ? normalizeTranscriptUserContent(message.content)
    : stringifyTranscriptContent(message.content);
  return {
    role: 'user',
    content: message.role === 'system'
      ? ['[system_context]', content].filter(Boolean).join('\n')
      : content
  };
}

function coerceTranscriptMessagesToAlternatingRoles(messages: OpenAiCompatibleTranscriptMessage[]) {
  return messages.reduce<OpenAiCompatibleTranscriptMessage[]>((result, message) => {
    const normalized = normalizeTranscriptRole(message);
    if (!String(normalized.content ?? '').trim()) return result;

    const previous = result[result.length - 1];
    if (previous?.role === normalized.role) {
      previous.content = mergeTranscriptContent(previous.content, normalized.content);
      return result;
    }

    result.push(normalized);
    return result;
  }, []);
}

export function buildOpenAiCompatibleRequest(input: ProviderRuntimeRequestInput) {
  const { api, context, sessionId, advanced, bodyOverrides, openAiToolHistoryMode = 'native' } = input;
  const endpoint = buildApiEndpoint(api.baseUrl, api.path);
  const {
    apiKey,
    model,
    temperature,
    topP,
    maxTokens,
    thinkingBudget,
    extraHeaders,
    customBody,
    providerCapability,
    usesBuiltInTrial
  } = resolveRequestBuilderBase(api, advanced);
  const resolvedOpenAiToolHistoryMode = resolveOpenAiCompatibleToolHistoryMode({
    context,
    currentMode: openAiToolHistoryMode,
    capability: providerCapability
  });
  const includeGeminiThoughtSignatures = canRoundtripOpenAiGeminiThoughtSignatures(providerCapability);

  const orderedMessages = resolvedOpenAiToolHistoryMode === 'transcript'
    ? buildOpenAiCompatibleTranscriptMessages(context, providerCapability)
    : buildOpenAiCompatibleMessages(context, providerCapability, { includeGeminiThoughtSignatures });

  const body: Record<string, unknown> = {
    model,
    messages: orderedMessages
  };
  const openRouterSessionId = resolveOpenRouterSessionId(api.baseUrl, sessionId);
  if (openRouterSessionId) {
    body.session_id = openRouterSessionId;
  }
  if (providerCapability.cache.sendsTopLevelCacheControl) {
    body.cache_control = { type: 'ephemeral' };
  }
  if (shouldSendTemperature(providerCapability, topP, temperature)) {
    body.temperature = temperature;
  }
  if (shouldSendTopP(providerCapability, topP)) {
    body.top_p = topP;
  }

  if (maxTokens !== undefined) {
    if (providerCapability.budgets.outputTokenField === 'max_completion_tokens') {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }
  }

  if (thinkingBudget !== undefined && providerCapability.thinking.sendBudget) {
    body.thinking = { budget_tokens: thinkingBudget };
  }
  if (
    providerCapability.streaming.text &&
    !(providerCapability.streaming.disableWhenToolsPresent && (context.tools?.length ?? 0) > 0)
  ) {
    body.stream = true;
    if (shouldRequestStreamUsage(providerCapability)) {
      body.stream_options = { include_usage: true };
    }
  }
  if (context.tools?.length) {
    body.tools = providerCapability.tools.nativeSchema === 'gemini-function-declarations'
      ? sanitizeToolsForGeminiFunctionDeclarations(context.tools)
      : context.tools;
    const toolChoice = resolveOpenAiToolChoice(context.toolChoice, providerCapability);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  return buildRequestResult({
    endpoint,
    headers: buildOpenAiCompatibleHeaders({
      apiKey,
      extraHeaders,
      usesBuiltInTrial
    }),
    body,
    customBody,
    bodyOverrides,
    provider: 'openai-completions',
    compatibilityMode: providerCapability.route.compatibilityMode,
    capability: providerCapability,
    usesBuiltInTrial
  });
}

export const openAiCompatibleChatAdapter: ProviderRuntimeRequestAdapter = {
  id: OPENAI_COMPATIBLE_CHAT_ADAPTER_ID,
  label: 'OpenAI-compatible Chat Completions',
  match(profile) {
    const protocol = inferProviderProtocol(profile);
    return protocol === 'openai-completions'
      ? protocolMatch(protocol)
      : null;
  },
  resolveCapabilities(input) {
    const capability = resolveProviderCapability(input.provider, input.advanced);
    return canonicalProviderCapabilitiesFromContract(capability);
  },
  classifyError(input) {
    return classifyProviderRuntimeError(input);
  },
  resolveRetry(input) {
    return resolveProviderRuntimeRetry(input, {
      transcriptToolHistory: true
    });
  },
  parseStreamEvents(input) {
    return parseOpenAiCompatibleStreamEvents(input.payload);
  },
  parseResponse(input) {
    return extractOpenAiCompatibleReply(input.data, input.fallbackModel);
  },
  prepareConnectionTestRequest(input) {
    setConnectionTestOutputTokenField(
      input.request,
      resolveProviderCapability(input.provider).budgets.outputTokenField,
      input.maxOutputTokens
    );
  },
  buildRequest(input) {
    return buildOpenAiCompatibleRequest(input);
  }
};
