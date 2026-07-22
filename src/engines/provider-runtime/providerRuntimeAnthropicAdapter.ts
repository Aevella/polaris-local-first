import type { AssistantContextMessage, AssistantMessageContent, AssistantRequestTool } from '../request/requestContext';
import type { AssistantRequestCacheTtl } from '../request/requestCachePlan';
import { buildHistoricalToolCallNameMap, extractTextPayload } from './requestShared/messages';
import { ANTHROPIC_VERSION } from './requestShared/headers';
import { resolveRequestBuilderBase, shouldSendTemperature, shouldSendTopP } from './requestShared/sampling';
import { buildToolResultPayloadText, parseToolCallArguments } from './requestShared/toolResultPayload';
import { buildRequestResult, extractDataUrlParts } from './requestShared/transportSanitize';
import { buildApiEndpoint } from '../chat-api/chatApiEndpoint';
import { inferProviderProtocol } from '../providerProtocol';
import type { ProviderAdapterMatch } from './providerRuntimeTypes';
import type { ProviderRuntimeRequestAdapter } from './providerRuntimeRequestTypes';
import type { ProviderRuntimeRequestInput } from './providerRuntimeRequestTypes';
import { classifyProviderRuntimeError, resolveProviderRuntimeRetry } from './providerRuntimeRetryPolicy';
import { parseAnthropicMessagesStreamEvents } from './providerRuntimeStreamEvents';
import { extractAnthropicReply } from './providerRuntimeResponsePayload';
import { setConnectionTestOutputTokenField } from './providerRuntimeConnectionTest';
import { resolveOpenRouterSessionId } from './providerRuntimeOpenRouterSession';
import {
  canonicalProviderCapabilitiesFromContract,
  resolveProviderCapability
} from './providerCapability';

const ANTHROPIC_MESSAGES_ADAPTER_ID = 'anthropic-messages';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 65_536;

type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: AnthropicCacheControl }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

type AnthropicSystemMessage = AssistantContextMessage & { content: string };
type AnthropicCacheControl = { type: 'ephemeral'; ttl?: AssistantRequestCacheTtl };

function protocolMatch(
  protocol: ReturnType<typeof inferProviderProtocol>
): ProviderAdapterMatch {
  return {
    adapterId: ANTHROPIC_MESSAGES_ADAPTER_ID,
    confidence: 'exact',
    reason: `matched provider protocol: ${protocol}`
  };
}

function toAnthropicContent(content: AssistantMessageContent): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content;

  const blocks: AnthropicContentBlock[] = [];

  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
      continue;
    }

    const imageParts = extractDataUrlParts(part.image_url.url);
    if (!imageParts) continue;

    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageParts.mediaType,
        data: imageParts.data
      }
    });
  }

  return blocks;
}

function toAnthropicContentBlocks(content: AssistantMessageContent): AnthropicContentBlock[] {
  const base = toAnthropicContent(content);
  if (typeof base === 'string') {
    return base.trim() ? [{ type: 'text', text: base }] : [];
  }
  return base;
}

function normalizeAnthropicBlocks(content: string | AnthropicContentBlock[]) {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text' as const, text: content }] : [];
  }
  return content;
}

function toAnthropicMessageContent(blocks: AnthropicContentBlock[]) {
  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    return blocks[0].text;
  }
  return blocks;
}

function appendAnthropicMessage(
  messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }>,
  role: 'user' | 'assistant',
  blocks: AnthropicContentBlock[]
) {
  if (blocks.length === 0) {
    return;
  }

  const last = messages[messages.length - 1];
  if (last?.role === role) {
    const mergedBlocks = [
      ...normalizeAnthropicBlocks(last.content),
      ...blocks
    ];
    last.content = toAnthropicMessageContent(mergedBlocks);
    return;
  }

  messages.push({
    role,
    content: toAnthropicMessageContent(blocks)
  });
}

function buildAnthropicMessages(context: ProviderRuntimeRequestInput['context']) {
  const orderedMessages = context.segments
    .flatMap((segment) => segment.messages)
    .filter((message) => message.role !== 'system');
  const normalizedToolNames = buildHistoricalToolCallNameMap(orderedMessages);
  const messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }> = [];

  for (const message of orderedMessages) {
    if (message.role === 'assistant') {
      const blocks = [
        ...toAnthropicContentBlocks(message.content),
        ...(message.toolCalls ?? []).map((toolCall) => ({
          type: 'tool_use' as const,
          id: toolCall.id,
          name: toolCall.id ? (normalizedToolNames.get(toolCall.id) ?? toolCall.name) : toolCall.name,
          input: parseToolCallArguments(toolCall.argumentsText)
        }))
      ];
      appendAnthropicMessage(messages, 'assistant', blocks);
      continue;
    }

    if (message.role === 'tool' && message.toolResult) {
      const normalizedToolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      appendAnthropicMessage(messages, 'user', [{
        type: 'tool_result',
        tool_use_id: message.toolResult.toolCallId,
        content: buildToolResultPayloadText(message, {
          toolName: normalizedToolName,
          kind: normalizedToolName
        }),
        is_error: message.toolResult.isError || undefined
      }]);
      continue;
    }

    appendAnthropicMessage(
      messages,
      message.role === 'user' ? 'user' : 'assistant',
      toAnthropicContentBlocks(message.content)
    );
  }

  return messages;
}

function resolveAnthropicSystemCacheControlIndexes(
  context: ProviderRuntimeRequestInput['context'],
  systemMessages: AnthropicSystemMessage[]
) {
  const fallbackFinalIndex = systemMessages.length - 1;
  if (!context.cachePlan) {
    for (let index = systemMessages.length - 1; index >= 0; index -= 1) {
      if (systemMessages[index]?.cachePrefixEligible === true) {
        return new Set([index]);
      }
    }
    return fallbackFinalIndex >= 0 ? new Set([fallbackFinalIndex]) : new Set<number>();
  }

  const cacheIndexes = new Set<number>();
  for (const breakpoint of context.cachePlan.breakpoints) {
    if (!breakpoint.eligible) continue;

    const breakpointPartNames = new Set(breakpoint.partNames);
    let breakpointIndex = -1;
    for (let index = systemMessages.length - 1; index >= 0; index -= 1) {
      const promptPartName = systemMessages[index]?.promptPartName;
      if (promptPartName && breakpointPartNames.has(promptPartName)) {
        breakpointIndex = index;
        break;
      }
    }
    if (breakpointIndex >= 0) {
      cacheIndexes.add(breakpointIndex);
    }
  }

  return cacheIndexes;
}

function buildAnthropicSystemContent(context: ProviderRuntimeRequestInput['context']) {
  const systemMessages = context.segments
    .flatMap((segment) => segment.messages)
    .filter((message) => message.role === 'system')
    .map((message) => ({
      ...message,
      content: extractTextPayload(message.content)
    }))
    .filter((message) => message.content.trim());

  if (systemMessages.length === 0) return undefined;

  const cacheIndexes = resolveAnthropicSystemCacheControlIndexes(context, systemMessages);

  return systemMessages.map((message, index) => ({
    type: 'text' as const,
    text: message.content,
    ...(cacheIndexes.has(index)
      ? {
          cache_control: {
            type: 'ephemeral' as const,
            ttl: context.cachePlan?.breakpoints.find((breakpoint) => {
              const promptPartName = message.promptPartName;
              return promptPartName && breakpoint.partNames.includes(promptPartName);
            })?.ttl ?? '1h'
          }
        }
      : {})
  }));
}

function buildAnthropicTools(tools: AssistantRequestTool[] | undefined) {
  if (!tools?.length) return undefined;
  const finalToolIndex = tools.length - 1;
  return tools.map((tool, index) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
    ...(index === finalToolIndex
      ? {
          cache_control: {
            type: 'ephemeral' as const,
            ttl: '1h' as const
          }
        }
      : {})
  }));
}

export function buildAnthropicRequest(input: ProviderRuntimeRequestInput) {
  const { api, context, sessionId, advanced, bodyOverrides } = input;
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
    providerCapability
  } = resolveRequestBuilderBase(api, advanced);

  const system = buildAnthropicSystemContent(context);
  const anthropicMessages = buildAnthropicMessages(context);

  if (anthropicMessages.length === 0) {
    throw new Error('field messages is required（当前请求没有可发送的对话消息，Anthropic /messages 至少需要一条 user 或 assistant 消息。）');
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages: anthropicMessages
  };
  if (providerCapability.cache.sendsTopLevelCacheControl) {
    body.cache_control = { type: 'ephemeral' };
  }
  const openRouterSessionId = resolveOpenRouterSessionId(api.baseUrl, sessionId);
  if (openRouterSessionId) {
    body.session_id = openRouterSessionId;
  }
  if (shouldSendTemperature(providerCapability, topP, temperature)) {
    body.temperature = temperature;
  }
  if (system) {
    body.system = system;
  }
  if (shouldSendTopP(providerCapability, topP)) {
    body.top_p = topP;
  }
  if (thinkingBudget !== undefined && providerCapability.thinking.sendBudget) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: thinkingBudget
    };
  }
  if (providerCapability.streaming.text) {
    body.stream = true;
  }
  if (context.tools?.length) {
    body.tools = buildAnthropicTools(context.tools);
    if (context.toolChoice === 'required') {
      body.tool_choice = { type: 'any' };
    } else if (context.toolChoice !== 'none') {
      body.tool_choice = { type: 'auto' };
    }
  }

  return buildRequestResult({
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      ...(providerCapability.auth.scheme === 'authorization-bearer-with-anthropic-version'
        ? { Authorization: `Bearer ${apiKey}` }
        : { 'x-api-key': apiKey }),
      'anthropic-version': ANTHROPIC_VERSION,
      ...extraHeaders
    },
    body,
    customBody,
    bodyOverrides,
    provider: 'anthropic-messages',
    compatibilityMode: providerCapability.route.compatibilityMode,
    capability: providerCapability
  });
}

export const anthropicMessagesAdapter: ProviderRuntimeRequestAdapter = {
  id: ANTHROPIC_MESSAGES_ADAPTER_ID,
  label: 'Anthropic Messages',
  match(profile) {
    const protocol = inferProviderProtocol(profile);
    return protocol === 'anthropic-messages'
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
    return resolveProviderRuntimeRetry(input);
  },
  parseStreamEvents(input) {
    return parseAnthropicMessagesStreamEvents(input.payload);
  },
  parseResponse(input) {
    return extractAnthropicReply(input.data, input.fallbackModel);
  },
  prepareConnectionTestRequest(input) {
    setConnectionTestOutputTokenField(input.request, 'max_tokens', input.maxOutputTokens);
  },
  buildRequest(input) {
    return buildAnthropicRequest(input);
  }
};
