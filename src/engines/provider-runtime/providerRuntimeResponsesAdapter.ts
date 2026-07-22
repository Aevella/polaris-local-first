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

  return orderedMessages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCallTranscript = JSON.stringify(
        message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.id ? (normalizedToolNames.get(toolCall.id) ?? toolCall.name) : toolCall.name,
          arguments: toolCall.argumentsText
        })),
        null,
        2
      );
      const text = [extractTextPayload(message.content).trim(), '[assistant_tool_calls]', toolCallTranscript]
        .filter(Boolean)
        .join('\n\n');

      return {
        role: 'assistant',
        content: toResponsesContent(text)
      };
    }

    if (message.role === 'tool' && message.toolResult) {
      const normalizedToolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      return {
        role: 'user',
        content: toResponsesContent([
          `[tool_result:${normalizedToolName}]`,
          buildToolResultPayloadText(message, {
            toolName: normalizedToolName,
            kind: normalizedToolName
          })
        ].join('\n\n'))
      };
    }

    return {
      role: message.role,
      content: toResponsesContent(message.content)
    };
  });
}

function resolveResponsesReasoningEffort(thinkingBudget: number) {
  if (thinkingBudget <= 1024) return 'low';
  if (thinkingBudget <= 4096) return 'medium';
  return 'high';
}

export function buildResponsesRequest(input: ProviderRuntimeRequestInput) {
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
    providerCapability,
    usesBuiltInTrial
  } = resolveRequestBuilderBase(api, advanced);

  const body: Record<string, unknown> = {
    model,
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
  if (thinkingBudget !== undefined && providerCapability.thinking.sendBudget) {
    body.reasoning = {
      effort: resolveResponsesReasoningEffort(thinkingBudget)
    };
  }
  if (providerCapability.streaming.text) {
    body.stream = true;
  }
  if (context.tools?.length) {
    body.tools = context.tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
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
