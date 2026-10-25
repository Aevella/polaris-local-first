import {
  buildHistoricalToolCallNameMap,
  buildSeparatedSystemMessages,
  extractTextPayload
} from './requestShared/messages';
import { resolveRequestBuilderBase } from './requestShared/sampling';
import { buildToolResultPayloadText, parseToolCallArguments } from './requestShared/toolResultPayload';
import { buildRequestResult, extractDataUrlParts } from './requestShared/transportSanitize';
import { buildApiEndpoint } from '../chat-api/chatApiEndpoint';
import { sanitizeSchemaForGeminiFunctionDeclaration } from './providerRuntimeGeminiSchema';
import { inferProviderProtocol } from '../providerProtocol';
import type { ProviderAdapterMatch } from './providerRuntimeTypes';
import type { ProviderRuntimeRequestAdapter } from './providerRuntimeRequestTypes';
import type { ProviderRuntimeRequestInput } from './providerRuntimeRequestTypes';
import { classifyProviderRuntimeError, resolveProviderRuntimeRetry } from './providerRuntimeRetryPolicy';
import { extractGeminiNativeReply } from './providerRuntimeGeminiResponse';
import { setGeminiConnectionTestOutputTokens } from './providerRuntimeConnectionTest';
import {
  canonicalProviderCapabilitiesFromContract,
  resolveProviderCapability
} from './providerCapability';

const GEMINI_GENERATE_CONTENT_ADAPTER_ID = 'gemini-generate-content';

type GeminiPart = Record<string, unknown>;

function protocolMatch(
  protocol: ReturnType<typeof inferProviderProtocol>
): ProviderAdapterMatch {
  return {
    adapterId: GEMINI_GENERATE_CONTENT_ADAPTER_ID,
    confidence: 'exact',
    reason: `matched provider protocol: ${protocol}`
  };
}

function buildGeminiEndpoint(baseUrl: string, path: string, model: string) {
  const modelPath = path.includes('{model}')
    ? path.split('{model}').join(encodeURIComponent(model))
    : path;
  return buildApiEndpoint(baseUrl, modelPath);
}

function buildGeminiContentParts(content: ProviderRuntimeRequestInput['context']['segments'][number]['messages'][number]['content']) {
  if (typeof content === 'string') {
    return content.trim() ? [{ text: content }] : [];
  }

  return content.flatMap((part): GeminiPart[] => {
    if (part.type === 'text') {
      return part.text.trim() ? [{ text: part.text }] : [];
    }

    const dataUrlParts = extractDataUrlParts(part.image_url.url);
    if (dataUrlParts) {
      return [{
        inlineData: {
          mimeType: dataUrlParts.mediaType,
          data: dataUrlParts.data
        }
      }];
    }

    return [{
      fileData: {
        fileUri: part.image_url.url
      }
    }];
  });
}

function buildGeminiTools(context: ProviderRuntimeRequestInput['context']) {
  if (!context.tools?.length) return undefined;

  const functionDeclarations = context.tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: sanitizeSchemaForGeminiFunctionDeclaration(tool.function.parameters)
  }));

  return [{ functionDeclarations }];
}

function buildGeminiToolConfig(context: ProviderRuntimeRequestInput['context']) {
  if (!context.tools?.length || !context.toolChoice || context.toolChoice === 'none') return undefined;
  return {
    functionCallingConfig: {
      mode: context.toolChoice === 'required' ? 'ANY' : 'AUTO'
    }
  };
}

function buildGeminiContents(
  context: ProviderRuntimeRequestInput['context']
) {
  const orderedMessages = buildSeparatedSystemMessages(context);
  const normalizedToolNames = buildHistoricalToolCallNameMap(orderedMessages);
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];

  for (const message of orderedMessages) {
    if (message.role === 'system') continue;

    if (message.role === 'assistant') {
      const parts = buildGeminiContentParts(message.content);
      message.toolCalls?.forEach((toolCall) => {
        const name = toolCall.id ? (normalizedToolNames.get(toolCall.id) ?? toolCall.name) : toolCall.name;
        const functionCall: Record<string, unknown> = {
          name,
          args: parseToolCallArguments(toolCall.argumentsText)
        };
        if (toolCall.id) {
          functionCall.id = toolCall.id;
        }
        const thoughtSignature = toolCall.providerMetadata?.geminiThoughtSignature;
        parts.push({
          functionCall,
          ...(thoughtSignature ? { thoughtSignature } : {})
        });
      });
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
      continue;
    }

    if (message.role === 'tool' && message.toolResult) {
      const normalizedToolName = normalizedToolNames.get(message.toolResult.toolCallId) ?? message.toolResult.toolName;
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            id: message.toolResult.toolCallId,
            name: normalizedToolName,
            response: parseToolCallArguments(buildToolResultPayloadText(message, {
              toolName: normalizedToolName,
              kind: normalizedToolName
            }))
          }
        }]
      });
      continue;
    }

    const parts = buildGeminiContentParts(message.content);
    if (parts.length > 0) {
      contents.push({ role: 'user', parts });
    }
  }

  return contents;
}

function buildGeminiSystemInstruction(
  context: ProviderRuntimeRequestInput['context']
) {
  const systemText = buildSeparatedSystemMessages(context)
    .filter((message) => message.role === 'system')
    .map((message) => extractTextPayload(message.content).trim())
    .filter(Boolean)
    .join('\n\n');

  return systemText ? { parts: [{ text: systemText }] } : undefined;
}

export function buildGeminiNativeRequest(input: ProviderRuntimeRequestInput) {
  const { api, context, advanced, bodyOverrides } = input;
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
  const generationConfig: Record<string, unknown> = {};

  if (temperature !== undefined) {
    generationConfig.temperature = temperature;
  }
  if (topP !== undefined) {
    generationConfig.topP = topP;
  }
  if (maxTokens !== undefined) {
    generationConfig.maxOutputTokens = maxTokens;
  }
  if (thinkingBudget !== undefined && providerCapability.thinking.sendBudget) {
    generationConfig.thinkingConfig = { thinkingBudget };
  }

  const body: Record<string, unknown> = {
    contents: buildGeminiContents(context)
  };
  const systemInstruction = buildGeminiSystemInstruction(context);
  const tools = buildGeminiTools(context);
  const toolConfig = buildGeminiToolConfig(context);
  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }
  if (tools) {
    body.tools = tools;
  }
  if (toolConfig) {
    body.toolConfig = toolConfig;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  return buildRequestResult({
    endpoint: buildGeminiEndpoint(api.baseUrl, api.path, model),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      ...extraHeaders
    },
    body,
    customBody,
    bodyOverrides,
    reasoningStrength: input.reasoningStrength,
    provider: 'gemini-generate-content',
    compatibilityMode: providerCapability.route.compatibilityMode,
    capability: providerCapability,
    usesBuiltInTrial
  });
}

export const geminiGenerateContentAdapter: ProviderRuntimeRequestAdapter = {
  id: GEMINI_GENERATE_CONTENT_ADAPTER_ID,
  label: 'Gemini Generate Content',
  match(profile) {
    const protocol = inferProviderProtocol(profile);
    return protocol === 'gemini-generate-content'
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
  parseStreamEvents(_input) {
    return [];
  },
  parseResponse(input) {
    return extractGeminiNativeReply(input.data, input.fallbackModel);
  },
  prepareConnectionTestRequest(input) {
    setGeminiConnectionTestOutputTokens(input.request, input.maxOutputTokens);
  },
  buildRequest(input) {
    return buildGeminiNativeRequest(input);
  }
};
