import type { PersonaAdvancedSettings, ProviderProfile, ProviderProtocol } from '../../types/domain';
import type { ProviderCompatibilityMode, ProviderRouteLabelKey } from './internal/providerProfile';
import { isPolarisBuiltInProvider } from '../freeProvider';
import { resolveProviderEffectiveModel } from './internal/providerEffectiveProfile';
import {
  isClaudeModel,
  isDeepSeekHost,
  isGatewayBaseUrl,
  isGeminiModel,
  isKimiK2InstructModel,
  isKimiK2Model,
  isMoonshotHost,
  isN1nHost,
  isOpenRouterAnthropicClaudeModel,
  isOpenRouterHost,
  isSiliconFlowHost,
  parseProviderHost
} from './internal/providerMatching';
import { inferProviderProtocol } from '../providerProtocol';
import type { ProviderProtocolLabelKey } from '../providerProtocol';
import { resolveProviderProfile } from './internal/providerProfile';
import type { AssistantPromptPartName } from '../request/requestAudit';
import type {
  CanonicalProviderCacheMode,
  CanonicalProviderCapabilitySet,
  CanonicalProviderImageInputMode,
  CanonicalProviderOutputTokenField,
  CanonicalProviderReasoningMode,
  CanonicalProviderToolHistoryMode,
  CanonicalProviderToolMode,
  CanonicalProviderTransportMode
} from './providerRuntimeTypes';

export type ProviderCapabilityAdvanced = Partial<Pick<
  PersonaAdvancedSettings,
  'modelOverride' | 'streaming' | 'thinkingBudget'
>>;

export type { ProviderRouteLabelKey };

export type ProviderCapabilityRoute = {
  protocol: ProviderProtocol;
  labelKey: ProviderRouteLabelKey;
  protocolLabelKey: ProviderProtocolLabelKey;
  kind: 'gateway' | 'direct' | 'custom-direct';
  compatibilityMode: ProviderCompatibilityMode;
  isBuiltInTrial: boolean;
  isMirrorAggregator: boolean;
};

export type ProviderCapabilityReasoningTransport =
  | 'none'
  | 'native'
  | 'openai-reasoning-content';

export type ProviderCapabilityReasoningReplay =
  | 'omit'
  | 'omit-empty'
  | 'send-empty';

export type ProviderCapabilityThinkingEffortMapping =
  | 'none'
  | 'openai-compatible-budget'
  | 'responses-effort'
  | 'anthropic-budget'
  | 'gemini-budget';

export type ProviderCapabilityAuthScheme =
  | 'bearer'
  | 'x-api-key'
  | 'x-goog-api-key'
  | 'authorization-bearer-with-anthropic-version';

export type ProviderCapabilityPromptInjection = {
  name: AssistantPromptPartName;
  requiresExecutionTarget: boolean;
};

export type ProviderCapabilityGeminiThoughtSignatureTransport =
  | 'none'
  | 'native'
  | 'openai-extra-content';

export type ProviderCapabilityOpenAiToolHistoryReplay =
  | 'native'
  | 'transcript-when-continuity-unsupported';

export type ProviderCapabilityNativeToolSchema =
  | 'openai'
  | 'gemini-function-declarations';

export type ProviderCapability = {
  provider: ProviderProfile;
  route: ProviderCapabilityRoute;
  input: {
    text: true;
    images: CanonicalProviderImageInputMode;
  };
  output: {
    text: true;
    nativeToolCalls: boolean;
    reasoning: {
      mode: CanonicalProviderReasoningMode;
      transport: ProviderCapabilityReasoningTransport;
      replay: ProviderCapabilityReasoningReplay;
    };
  };
  streaming: {
    text: boolean;
    toolCalls: boolean;
    reasoning: boolean;
    usage: boolean;
    disableWhenToolsPresent: boolean;
  };
  sampling: {
    sendTemperature: boolean;
    sendTopP: boolean;
    omitTopPWhenOne: boolean;
    omitTemperatureWhenTopPSet: boolean;
  };
  tools: {
    mode: CanonicalProviderToolMode;
    history: CanonicalProviderToolHistoryMode;
    promptProtocol: 'native-first' | 'hybrid';
    choiceControl: 'none' | 'auto' | 'required';
    nativeSchema: ProviderCapabilityNativeToolSchema;
    geminiThoughtSignatureTransport: ProviderCapabilityGeminiThoughtSignatureTransport;
    openAiHistoryReplay: ProviderCapabilityOpenAiToolHistoryReplay;
  };
  thinking: {
    sendBudget: boolean;
    effortMapping: ProviderCapabilityThinkingEffortMapping;
  };
  budgets: {
    contextWindowTokens: number | null;
    recommendedPromptTokens: number;
    promptBudgetPolicy: 'enforced' | 'advisory';
    outputTokenField: CanonicalProviderOutputTokenField;
  };
  cache: {
    mode: CanonicalProviderCacheMode;
    promptCaching: boolean;
    openAiCompatibleCacheControl: boolean;
    sendsTopLevelCacheControl: boolean;
    automaticMessageHistoryCache: boolean;
  };
  transport: {
    modes: CanonicalProviderTransportMode[];
    relayAllowedWhenNetworkFails: boolean;
  };
  execution: {
    maxAttempts: 1 | 2;
    streamIdleTimeoutMs: number;
    connectionTestTimeoutMs: number;
    retryablePatterns: 'standard';
  };
  auth: {
    scheme: ProviderCapabilityAuthScheme;
  };
  context: {
    collapseSystemMessages: boolean;
    deferVolatileSystemMessages: boolean;
    omitVolatileSystemMessages: boolean;
  };
  promptInjections: ProviderCapabilityPromptInjection[];
};

const STREAM_IDLE_TIMEOUT_MS = 300_000;
const CLAUDE_STREAM_IDLE_TIMEOUT_MS = 300_000;
const THINKING_STREAM_IDLE_TIMEOUT_MS = 300_000;
const HIGH_THINKING_STREAM_IDLE_TIMEOUT_MS = 480_000;
const HIGH_THINKING_BUDGET_THRESHOLD = 4_096;
const SILICONFLOW_KIMI_INSTRUCT_IDLE_TIMEOUT_MS = 45_000;
const CONNECTION_TEST_TIMEOUT_MS = 90_000;

function parsePositiveInteger(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function resolveRuntimeProvider(
  provider: ProviderProfile,
  advanced?: ProviderCapabilityAdvanced
): ProviderProfile {
  const model = resolveProviderEffectiveModel(provider, advanced?.modelOverride);
  return {
    ...provider,
    model
  };
}

function resolveTransportModes(provider: ProviderProfile): CanonicalProviderTransportMode[] {
  const modes: CanonicalProviderTransportMode[] = [];
  if (usesBuiltInGatewayTransport(provider)) {
    modes.push('built-in-gateway');
  } else {
    modes.push('direct', 'browser-relay', 'native-direct');
  }
  return modes;
}

function usesBuiltInGatewayTransport(provider: ProviderProfile): boolean {
  return provider.baseUrl.trim().startsWith('/');
}

function usesMimoTokenField(provider: ProviderProfile) {
  const baseUrl = provider.baseUrl.trim().toLowerCase();
  const path = provider.path.trim().toLowerCase();
  const model = provider.model.trim().toLowerCase();
  return (
    (baseUrl === '/api' && path === '/chat/completions' && model === 'polaris')
    || model.includes('mimo')
  );
}

function resolveProtocolShape(args: {
  provider: ProviderProfile;
  protocol: ProviderProtocol;
  reasoningTransport: ProviderCapabilityReasoningTransport;
  sendThinkingBudget: boolean;
}): {
  imageInput: CanonicalProviderImageInputMode;
  reasoningMode: CanonicalProviderReasoningMode;
  reasoningTransport: ProviderCapabilityReasoningTransport;
  toolMode: CanonicalProviderToolMode;
  toolHistory: CanonicalProviderToolHistoryMode;
  outputTokenField: CanonicalProviderOutputTokenField;
  cacheMode: CanonicalProviderCacheMode;
  effortMapping: ProviderCapabilityThinkingEffortMapping;
} {
  if (args.protocol === 'anthropic-messages') {
    return {
      imageInput: 'data-url',
      reasoningMode: 'text',
      reasoningTransport: 'native',
      toolMode: 'native',
      toolHistory: 'native',
      outputTokenField: 'max_tokens',
      cacheMode: 'explicit-cache-control',
      effortMapping: 'anthropic-budget'
    };
  }

  if (args.protocol === 'openai-responses') {
    return {
      imageInput: 'data-url',
      reasoningMode: 'summary',
      reasoningTransport: 'native',
      toolMode: 'transcript',
      toolHistory: 'transcript',
      outputTokenField: 'max_output_tokens',
      cacheMode: 'automatic-or-unknown',
      effortMapping: 'responses-effort'
    };
  }

  if (args.protocol === 'gemini-generate-content') {
    return {
      imageInput: 'model-dependent',
      reasoningMode: 'signature-required',
      reasoningTransport: 'native',
      toolMode: 'native',
      toolHistory: 'native',
      outputTokenField: 'max_output_tokens',
      cacheMode: 'none',
      effortMapping: 'gemini-budget'
    };
  }

  const reasoningMode =
    args.reasoningTransport === 'openai-reasoning-content'
      ? 'text'
      : args.sendThinkingBudget ? 'hidden' : 'none';

  return {
    imageInput: isGeminiModel(args.provider.model) ? 'model-dependent' : 'data-url',
    reasoningMode,
    reasoningTransport: args.reasoningTransport,
    toolMode: 'native',
    toolHistory: 'native-with-transcript-fallback',
    outputTokenField: usesMimoTokenField(args.provider) ? 'max_completion_tokens' : 'max_tokens',
    cacheMode: 'automatic-or-unknown',
    effortMapping: args.sendThinkingBudget ? 'openai-compatible-budget' : 'none'
  };
}

function resolveToolChoiceControl(profile: ReturnType<typeof resolveProviderProfile>) {
  if (!profile.supportsToolChoice) return 'none';
  return profile.supportsRequiredToolChoice ? 'required' : 'auto';
}

function isClaudeStyleRequest(provider: ProviderProfile, protocol: ProviderProtocol) {
  return protocol === 'anthropic-messages' || isClaudeModel(provider.model);
}

function isKimiRetryRoute(provider: ProviderProfile) {
  const host = parseProviderHost(provider.baseUrl);
  return (isSiliconFlowHost(host) || isGatewayBaseUrl(provider.baseUrl)) && isKimiK2Model(provider.model);
}

function isOpenRouterAnthropicClaudeCacheRoute(
  provider: ProviderProfile,
  protocol: ProviderProtocol,
  host: string
) {
  return (
    protocol === 'openai-completions'
    && isOpenRouterHost(host)
    && isOpenRouterAnthropicClaudeModel(provider.model)
  );
}

function resolveStreamIdleTimeoutMs(
  provider: ProviderProfile,
  protocol: ProviderProtocol,
  advanced?: ProviderCapabilityAdvanced
) {
  const baseTimeout =
    isKimiRetryRoute(provider) && isKimiK2InstructModel(provider.model)
      ? SILICONFLOW_KIMI_INSTRUCT_IDLE_TIMEOUT_MS
      : isClaudeStyleRequest(provider, protocol)
        ? CLAUDE_STREAM_IDLE_TIMEOUT_MS
        : STREAM_IDLE_TIMEOUT_MS;

  if (!provider.capabilities.thinking) {
    return baseTimeout;
  }

  const thinkingBudget = parsePositiveInteger(advanced?.thinkingBudget);
  const thinkingTimeout =
    thinkingBudget !== null && thinkingBudget > HIGH_THINKING_BUDGET_THRESHOLD
      ? HIGH_THINKING_STREAM_IDLE_TIMEOUT_MS
      : THINKING_STREAM_IDLE_TIMEOUT_MS;

  return Math.max(baseTimeout, thinkingTimeout);
}

function isMimoDirectExecutionSensitiveModel(modelId: string) {
  return /mimo-v2\.5-pro/i.test(modelId);
}

function resolveAuthScheme(provider: ProviderProfile, protocol: ProviderProtocol): ProviderCapabilityAuthScheme {
  if (protocol === 'gemini-generate-content') {
    return 'x-goog-api-key';
  }
  if (protocol === 'anthropic-messages') {
    return parseProviderHost(provider.baseUrl) === 'www.packyapi.com'
      ? 'authorization-bearer-with-anthropic-version'
      : 'x-api-key';
  }
  return 'bearer';
}

function shouldOmitTopPAtOne(provider: ProviderProfile) {
  return parseProviderHost(provider.baseUrl) === 'opencode.ai';
}

function resolveGeminiThoughtSignatureTransport(
  profile: ReturnType<typeof resolveProviderProfile>
): ProviderCapabilityGeminiThoughtSignatureTransport {
  if (profile.geminiThoughtSignatureTransport === 'unsupported') {
    return 'none';
  }
  return profile.geminiThoughtSignatureTransport;
}

function resolveImageInputMode(args: {
  provider: ProviderProfile;
  protocolShape: { imageInput: CanonicalProviderImageInputMode };
}) {
  return args.provider.capabilities.images ? args.protocolShape.imageInput : 'none';
}

export function canonicalProviderCapabilitiesFromContract(capability: ProviderCapability): CanonicalProviderCapabilitySet {
  return {
    input: {
      text: true,
      images: capability.input.images
    },
    output: {
      text: true,
      nativeToolCalls: capability.output.nativeToolCalls,
      reasoning: capability.output.reasoning.mode
    },
    streaming: {
      text: capability.streaming.text,
      toolCalls: capability.streaming.toolCalls,
      reasoning: capability.streaming.reasoning,
      usage: capability.streaming.usage
    },
    tools: {
      mode: capability.tools.mode,
      historyMode: capability.tools.history,
      promptProtocol: capability.tools.promptProtocol,
      choiceControl: capability.tools.choiceControl,
      requiredChoice: capability.tools.choiceControl === 'required'
    },
    budgets: {
      contextWindowTokens: capability.budgets.contextWindowTokens,
      recommendedPromptTokens: capability.budgets.recommendedPromptTokens,
      promptBudgetPolicy: capability.budgets.promptBudgetPolicy,
      outputTokenField: capability.budgets.outputTokenField,
      reasoningBudget: capability.provider.capabilities.thinking && capability.thinking.sendBudget
    },
    cache: {
      mode: capability.cache.mode,
      promptCaching: capability.cache.promptCaching
    },
    transport: {
      modes: capability.transport.modes
    }
  };
}

export function resolveProviderCapability(
  provider: ProviderProfile,
  advanced?: ProviderCapabilityAdvanced
): ProviderCapability {
  const runtimeProvider = resolveRuntimeProvider(provider, advanced);
  const protocol = inferProviderProtocol(runtimeProvider);
  const profile = resolveProviderProfile(runtimeProvider);
  const host = parseProviderHost(runtimeProvider.baseUrl);
  const reasoningTransport =
    profile.reasoningContentTransport === 'openai-reasoning-content'
      ? 'openai-reasoning-content'
      : 'none';
  const protocolShape = resolveProtocolShape({
    provider: runtimeProvider,
    protocol,
    reasoningTransport,
    sendThinkingBudget: profile.sendThinkingBudget
  });
  const openAiCompatibleCacheControl = isOpenRouterAnthropicClaudeCacheRoute(runtimeProvider, protocol, host);
  const cacheMode: CanonicalProviderCacheMode = openAiCompatibleCacheControl
    ? 'explicit-cache-control'
    : protocolShape.cacheMode;
  // OpenRouter forwards per-block controls, but top-level automatic cache control
  // is only valid for direct Anthropic handling and can reject routed requests.
  const sendsTopLevelCacheControl = cacheMode === 'explicit-cache-control' && !openAiCompatibleCacheControl;
  const toolChoiceControl = resolveToolChoiceControl(profile);
  const streamingEnabled = runtimeProvider.capabilities.streaming && advanced?.streaming !== false;
  const inputImages = resolveImageInputMode({
    provider: runtimeProvider,
    protocolShape
  });
  const reasoningMode = runtimeProvider.capabilities.thinking ? protocolShape.reasoningMode : 'none';
  const isAnthropicStyle = isClaudeStyleRequest(runtimeProvider, protocol);

  return {
    provider: runtimeProvider,
    route: {
      protocol,
      labelKey: profile.routeLabelKey,
      protocolLabelKey: profile.protocolLabelKey,
      kind: profile.routeKind,
      compatibilityMode: profile.compatibilityMode,
      isBuiltInTrial: isPolarisBuiltInProvider(runtimeProvider),
      isMirrorAggregator: isOpenRouterHost(host) || isSiliconFlowHost(host)
    },
    input: {
      text: true,
      images: inputImages
    },
    output: {
      text: true,
      nativeToolCalls: protocolShape.toolMode === 'native',
      reasoning: {
        mode: reasoningMode,
        transport: protocolShape.reasoningTransport,
        replay: profile.reasoningContentReplayPolicy
      }
    },
    streaming: {
      text: streamingEnabled,
      toolCalls: streamingEnabled,
      reasoning: streamingEnabled && runtimeProvider.capabilities.thinking && reasoningMode !== 'none',
      usage: streamingEnabled,
      disableWhenToolsPresent: isSiliconFlowHost(host) || isN1nHost(host)
    },
    sampling: {
      sendTemperature: !(
        protocol === 'openai-completions'
        && isMoonshotHost(host)
        && isKimiK2Model(runtimeProvider.model)
      ),
      sendTopP: true,
      omitTopPWhenOne: shouldOmitTopPAtOne(runtimeProvider) || isAnthropicStyle,
      omitTemperatureWhenTopPSet: isAnthropicStyle
    },
    tools: {
      mode: protocolShape.toolMode,
      history: protocolShape.toolHistory,
      promptProtocol: 'native-first',
      choiceControl: toolChoiceControl,
      nativeSchema: isGeminiModel(runtimeProvider.model) ? 'gemini-function-declarations' : 'openai',
      geminiThoughtSignatureTransport: resolveGeminiThoughtSignatureTransport(profile),
      openAiHistoryReplay: profile.openAiToolHistoryReplayPolicy
    },
    thinking: {
      sendBudget: runtimeProvider.capabilities.thinking && profile.sendThinkingBudget,
      effortMapping: runtimeProvider.capabilities.thinking ? protocolShape.effortMapping : 'none'
    },
    budgets: {
      contextWindowTokens: profile.contextWindowTokens,
      recommendedPromptTokens: profile.recommendedPromptTokens,
      promptBudgetPolicy: profile.promptBudgetPolicy,
      outputTokenField: protocolShape.outputTokenField
    },
    cache: {
      mode: cacheMode,
      promptCaching: cacheMode !== 'none',
      openAiCompatibleCacheControl,
      sendsTopLevelCacheControl,
      automaticMessageHistoryCache: sendsTopLevelCacheControl
    },
    transport: {
      modes: resolveTransportModes(runtimeProvider),
      relayAllowedWhenNetworkFails: !usesBuiltInGatewayTransport(runtimeProvider)
    },
    execution: {
      maxAttempts: isKimiRetryRoute(runtimeProvider) ? 2 : 1,
      streamIdleTimeoutMs: resolveStreamIdleTimeoutMs(runtimeProvider, protocol, advanced),
      connectionTestTimeoutMs: CONNECTION_TEST_TIMEOUT_MS,
      retryablePatterns: 'standard'
    },
    auth: {
      scheme: resolveAuthScheme(runtimeProvider, protocol)
    },
    context: {
      collapseSystemMessages: profile.collapseSystemMessages,
      deferVolatileSystemMessages: protocolShape.cacheMode === 'automatic-or-unknown' || openAiCompatibleCacheControl,
      omitVolatileSystemMessages: isDeepSeekHost(host)
    },
    promptInjections: isMimoDirectExecutionSensitiveModel(runtimeProvider.model)
      ? [{
          name: 'model_runtime_context',
          requiresExecutionTarget: true
        }]
      : []
  };
}

export function resolveRuntimeProviderProfile(
  provider: ProviderProfile,
  advanced?: ProviderCapabilityAdvanced
): ProviderProfile {
  return resolveProviderCapability(provider, advanced).provider;
}

export function resolveProviderCapabilityCanonicalSet(
  provider: ProviderProfile,
  advanced?: ProviderCapabilityAdvanced
): CanonicalProviderCapabilitySet {
  return canonicalProviderCapabilitiesFromContract(resolveProviderCapability(provider, advanced));
}
