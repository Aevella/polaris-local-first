import { reasoningItemsForReplay } from './providerRuntimeReasoningState';
import { inferProviderProtocol } from '../providerProtocol';
import type { AssistantMessageContent } from '../request/requestContext';
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
import { parseOpenAiResponsesStreamEvents } from './providerRuntimeStreamEvents';
import { extractOpenAiCompatibleReply } from './providerRuntimeResponsePayload';
import { setConnectionTestOutputTokenField } from './providerRuntimeConnectionTest';
import { resolveOpenRouterSessionId } from './providerRuntimeOpenRouterSession';
import {
  canonicalProviderCapabilitiesFromContract,
  resolveProviderCapability,
  type ProviderCapability
} from './providerCapability';
import { buildProviderThinkingRequest } from './providerRuntimeThinking';

const OPENAI_RESPONSES_ADAPTER_ID = 'openai-responses';

function protocolMatch(
  protocol: ReturnType<typeof inferProviderProtocol>
): ProviderAdapterMatch {
  return {
    adapterId: OPENAI_RESPONSES_ADAPTER_ID,
    confidence: 'exact',
    reason: `matched provider protocol: ${protocol}`
  };
}

function toResponsesContent(content: AssistantMessageContent) {
  if (typeof content === 'string') return content;

  const parts: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string }
  > = [];

  content.forEach((part) => {
    if (part.type === 'text') {
      if (part.text) {
        parts.push({ type: 'input_text', text: part.text });
      }
      return;
    }
    if (part.image_url.url) {
      parts.push({ type: 'input_image', image_url: part.image_url.url });
    }
  });

  if (parts.length === 1 && parts[0]?.type === 'input_text') {
    return parts[0].text;
  }
  return parts;
}

function buildResponsesInput(
  context: ProviderRuntimeRequestInput['context'],
  capability: ProviderCapability
) {
  const orderedMessages = buildOrderedMessages(context, capability.context);
  const normalizedToolNames = buildHistoricalToolCallNameMap(orderedMessages);

  const items: Record<string, unknown>[] = [];
  const callIds = new Set(orderedMessages.flatMap(message => message.toolCalls?.map(call => call.id) ?? []));
  for (const message of orderedMessages) {
    if (message.role === 'assistant' && message.providerReasoning?.protocol === 'openai-responses') {
      items.push(...reasoningItemsForReplay(message.providerReasoning)
        .filter(item => item.type === 'reasoning' && item.encrypted_content)
        .map(item => ({ ...item, summary: [] })));
    }
    if (message.role === 'tool' && message.toolResult) {
      const toolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      const textOutput = buildToolResultPayloadText(message, { toolName, kind: toolName });
      const images = Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'image_url') : [];
      const output = images.length
        ? [{ type: 'input_text', text: textOutput }, ...images.map(part => ({ type: 'input_image', image_url: part.image_url.url }))]
        : textOutput;
      // A cropped history may contain a result without its call. Keep it as
      // explicitly attributed data rather than send an invalid native pair.
      items.push(callIds.has(message.toolResult.toolCallId)
        ? { type: 'function_call_output', call_id: message.toolResult.toolCallId, output }
        : { role: 'user', content: `[tool_result:${toolName}]\n${textOutput}` });
      continue;
    }
    const text = extractTextPayload(message.content);
    if (text || Array.isArray(message.content)) {
      items.push({ role: message.role, content: toResponsesContent(message.content) });
    }
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        items.push({ type: 'function_call', call_id: call.id,
          name: normalizedToolNames.get(call.id) ?? call.name, arguments: call.argumentsText });
      }
    }
  }
  return items;
}

export function buildResponsesRequest(input: ProviderRuntimeRequestInput) {
  const { api, context, sessionId, advanced, bodyOverrides } = input;
  const route = buildApiEndpoint(api.baseUrl, api.path);
  const endpoint = route.replace(/\/chat\/completions(?=[?#]|$)/, '/responses');
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

  const body: Record<string, unknown> = {
    model,
    store: false,
    include: ['reasoning.encrypted_content'],
    input: buildResponsesInput(context, providerCapability)
  };
  const openRouterSessionId = resolveOpenRouterSessionId(api.baseUrl, sessionId);
  if (openRouterSessionId) {
    body.session_id = openRouterSessionId;
  }
  if (shouldSendTemperature(providerCapability, topP, temperature)) {
    body.temperature = temperature;
  }
  if (shouldSendTopP(providerCapability, topP)) {
    body.top_p = topP;
  }

  if (maxTokens !== undefined) {
    body.max_output_tokens = maxTokens;
  }
  Object.assign(body, buildProviderThinkingRequest(providerCapability, thinkingBudget));
  if (providerCapability.streaming.text) {
    body.stream = true;
  }
  if (context.tools?.length) {
    body.tools = context.tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: false
    }));
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
    provider: 'openai-responses',
    compatibilityMode: providerCapability.route.compatibilityMode,
    capability: providerCapability,
    usesBuiltInTrial
  });
}

export const openAiResponsesAdapter: ProviderRuntimeRequestAdapter = {
  id: OPENAI_RESPONSES_ADAPTER_ID,
  label: 'OpenAI Responses',
  match(profile) {
    const protocol = inferProviderProtocol(profile);
    return protocol === 'openai-responses'
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
    return parseOpenAiResponsesStreamEvents(input.payload);
  },
  parseResponse(input) {
    return extractOpenAiCompatibleReply(input.data, input.fallbackModel);
  },
  prepareConnectionTestRequest(input) {
    setConnectionTestOutputTokenField(input.request, 'max_output_tokens', input.maxOutputTokens);
  },
  buildRequest(input) {
    return buildResponsesRequest(input);
  }
};
