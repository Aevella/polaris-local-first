import type { ProviderProfile } from '../../../types/domain';
import {
  getProviderProtocolLabelKey,
  inferProviderProtocol,
  type ProviderProtocolLabelKey
} from '../../providerProtocol';
import {
  isAnthropicHost,
  isClaudeAdaptiveThinkingModel,
  isClaude46Model,
  isClaudeModel,
  isDeepSeekHost,
  isDeepSeekThinkingModel,
  isGeminiModel,
  isGoogleApisHost,
  isKimiK2Model,
  isMimoHost,
  isMimoModel,
  isMiniMaxHost,
  isMiniMaxModel,
  isMoonshotHost,
  isOpenAiHost,
  isOpenRouterHost,
  isSenseNovaHost,
  isSiliconFlowHost,
  isXAiHost,
  parseProviderHost
} from './providerMatching';

export type ProviderCompatibilityMode = 'standard' | 'proxy';
export type ProviderRouteKind = 'gateway' | 'direct' | 'custom-direct';
export type ProviderRouteLabelKey =
  | 'provider.route.gateway'
  | 'provider.route.siliconFlow'
  | 'provider.route.openRouter'
  | 'provider.route.openAI'
  | 'provider.route.anthropic'
  | 'provider.route.gemini'
  | 'provider.route.miniMax'
  | 'provider.route.customDirect';
export type GeminiThoughtSignatureTransport = 'native' | 'openai-extra-content' | 'unsupported';
export type ReasoningContentTransport = 'openai-reasoning-content' | 'openai-reasoning-details' | 'unsupported';
export type ReasoningContentReplayPolicy = 'omit' | 'omit-empty' | 'send-empty';
export type OpenAiToolHistoryReplayPolicy = 'native' | 'transcript-when-continuity-unsupported';
export type ProviderThinkingRequestTransport =
  | 'none'
  | 'anthropic-manual'
  | 'anthropic-adaptive'
  | 'openai-compatible-budget'
  | 'openai-anthropic-manual'
  | 'openai-anthropic-adaptive'
  | 'openrouter-reasoning'
  | 'responses-effort'
  | 'deepseek-thinking'
  | 'gemini-budget';

export type ResolvedProviderProfile = {
  host: string;
  routeKind: ProviderRouteKind;
  routeLabelKey: ProviderRouteLabelKey;
  protocolLabelKey: ProviderProtocolLabelKey;
  compatibilityMode: ProviderCompatibilityMode;
  collapseSystemMessages: boolean;
  sendThinkingBudget: boolean;
  thinkingRequestTransport: ProviderThinkingRequestTransport;
  geminiThoughtSignatureTransport: GeminiThoughtSignatureTransport;
  reasoningContentTransport: ReasoningContentTransport;
  reasoningContentReplayPolicy: ReasoningContentReplayPolicy;
  openAiToolHistoryReplayPolicy: OpenAiToolHistoryReplayPolicy;
  supportsToolChoice: boolean;
  supportsRequiredToolChoice: boolean;
  contextWindowTokens: number | null;
  reservedOutputTokens: number | null;
  recommendedPromptTokens: number;
  promptBudgetPolicy: 'enforced' | 'advisory';
};

const DEFAULT_ADVISORY_PROMPT_TOKENS = 48_000;
const OPENAI_CLASS_CONTEXT_WINDOW_TOKENS = 128_000;
const LARGE_FIRST_PARTY_CONTEXT_WINDOW_TOKENS = 200_000;
const MIN_SAFE_PROMPT_TOKENS = 24_000;
const SAFE_PROMPT_WINDOW_RATIO = 0.75;

type PromptBudgetResolution = Pick<
  ResolvedProviderProfile,
  'contextWindowTokens' | 'reservedOutputTokens' | 'recommendedPromptTokens' | 'promptBudgetPolicy'
>;

function resolveSafePromptBudget(contextWindowTokens: number) {
  return Math.max(MIN_SAFE_PROMPT_TOKENS, Math.floor(contextWindowTokens * SAFE_PROMPT_WINDOW_RATIO));
}

function budgetForContextWindow(
  contextWindowTokens: number,
  promptBudgetPolicy: ResolvedProviderProfile['promptBudgetPolicy']
): PromptBudgetResolution {
  const recommendedPromptTokens = resolveSafePromptBudget(contextWindowTokens);
  return {
    contextWindowTokens,
    reservedOutputTokens: contextWindowTokens - recommendedPromptTokens,
    recommendedPromptTokens,
    promptBudgetPolicy
  };
}

function advisoryPromptBudget(tokens = DEFAULT_ADVISORY_PROMPT_TOKENS): PromptBudgetResolution {
  return {
    contextWindowTokens: null,
    reservedOutputTokens: null,
    recommendedPromptTokens: tokens,
    promptBudgetPolicy: 'advisory'
  };
}

function inferProviderCompatibilityMode(): ProviderCompatibilityMode {
  return 'standard';
}

function shouldCollapseSystemMessages(args: {
  host: string;
  modelId: string | undefined;
  protocol: ReturnType<typeof inferProviderProtocol>;
}) {
  if (isSenseNovaHost(args.host)) return true;
  if (args.protocol !== 'openai-completions') return false;
  return isMiniMaxHost(args.host) || isMiniMaxModel(args.modelId);
}

function supportsRequiredToolChoice(args: {
  baseUrl: string;
  host: string;
  protocol: ReturnType<typeof inferProviderProtocol>;
}) {
  const trimmedBaseUrl = args.baseUrl.trim().toLowerCase();
  if (trimmedBaseUrl.startsWith('/')) {
    return false;
  }

  if (args.protocol === 'openai-completions' || args.protocol === 'openai-responses') {
    return isOpenAiHost(args.host);
  }

  if (args.protocol === 'anthropic-messages') {
    return isAnthropicHost(args.host);
  }

  if (args.protocol === 'gemini-generate-content') {
    return isGoogleApisHost(args.host);
  }

  return false;
}

function supportsToolChoice(args: {
  host: string;
  modelId: string | undefined;
  protocol: ReturnType<typeof inferProviderProtocol>;
}) {
  if (args.protocol === 'openai-completions' && isDeepSeekHost(args.host)) {
    return false;
  }

  return true;
}

function resolveGeminiThoughtSignatureTransport(args: {
  host: string;
  modelId: string | undefined;
  protocol: ReturnType<typeof inferProviderProtocol>;
}): GeminiThoughtSignatureTransport {
  if (!isGeminiModel(args.modelId)) {
    return 'unsupported';
  }

  if (args.protocol === 'gemini-generate-content') {
    return 'native';
  }

  if (args.protocol === 'openai-completions' && isGoogleApisHost(args.host)) {
    return 'openai-extra-content';
  }

  return 'unsupported';
}

function resolveReasoningContentTransport(args: {
  baseUrl: string;
  host: string;
  modelId: string | undefined;
  path: string;
  protocol: ReturnType<typeof inferProviderProtocol>;
}): ReasoningContentTransport {
  const baseUrl = args.baseUrl.trim().toLowerCase();
  const path = args.path.trim().toLowerCase();
  const modelId = args.modelId?.trim().toLowerCase();
  if (
    args.protocol === 'openai-completions'
    && (
      (baseUrl === '/api' && path === '/chat/completions' && modelId === 'polaris')
      || isMimoHost(args.host)
      || isMimoModel(args.modelId)
      || (isDeepSeekHost(args.host) && isDeepSeekThinkingModel(args.modelId))
    )
  ) {
    return 'openai-reasoning-content';
  }
  if (args.protocol === 'openai-completions' && isOpenRouterHost(args.host)) {
    return 'openai-reasoning-details';
  }
  if (args.protocol === 'openai-completions' && isClaudeModel(args.modelId)) {
    return 'openai-reasoning-content';
  }

  return 'unsupported';
}

function resolveReasoningContentReplayPolicy(args: {
  host: string;
  transport: ReasoningContentTransport;
}): ReasoningContentReplayPolicy {
  if (args.transport === 'unsupported') {
    return 'omit';
  }
  if (isDeepSeekHost(args.host)) {
    return 'omit-empty';
  }
  return 'send-empty';
}

function resolveOpenAiToolHistoryReplayPolicy(args: {
  geminiThoughtSignatureTransport: GeminiThoughtSignatureTransport;
  modelId: string | undefined;
  protocol: ReturnType<typeof inferProviderProtocol>;
}): OpenAiToolHistoryReplayPolicy {
  if (
    args.protocol === 'openai-completions'
    && isGeminiModel(args.modelId)
    && args.geminiThoughtSignatureTransport === 'unsupported'
  ) {
    return 'transcript-when-continuity-unsupported';
  }

  return 'native';
}

function resolveThinkingRequestTransport(args: {
  host: string;
  modelId: string | undefined;
  protocol: ReturnType<typeof inferProviderProtocol>;
}): ProviderThinkingRequestTransport {
  if (args.protocol === 'anthropic-messages') {
    return isClaudeAdaptiveThinkingModel(args.modelId)
      ? 'anthropic-adaptive'
      : 'anthropic-manual';
  }
  if (args.protocol === 'openai-responses') {
    return 'responses-effort';
  }
  if (args.protocol === 'gemini-generate-content') {
    return 'gemini-budget';
  }
  if (args.protocol === 'openai-completions' && isDeepSeekHost(args.host)) {
    return 'deepseek-thinking';
  }

  if (
    args.protocol === 'openai-completions'
    && isMoonshotHost(args.host)
    && isKimiK2Model(args.modelId)
  ) {
    return 'none';
  }
  if (args.protocol === 'openai-completions' && isOpenRouterHost(args.host)) {
    return 'openrouter-reasoning';
  }
  if (args.protocol === 'openai-completions' && isClaudeModel(args.modelId)) {
    return isClaudeAdaptiveThinkingModel(args.modelId)
      ? 'openai-anthropic-adaptive'
      : 'openai-anthropic-manual';
  }
  return 'openai-compatible-budget';
}

function describeProviderRoute(baseUrl: string, host: string): {
  routeKind: ProviderRouteKind;
  routeLabelKey: ProviderRouteLabelKey;
} {
  const trimmed = baseUrl.trim();
  if (trimmed.startsWith('/')) {
    return { routeKind: 'gateway', routeLabelKey: 'provider.route.gateway' };
  }
  if (isSiliconFlowHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.siliconFlow' };
  }
  if (isOpenRouterHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.openRouter' };
  }
  if (isOpenAiHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.openAI' };
  }
  if (isAnthropicHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.anthropic' };
  }
  if (isGoogleApisHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.gemini' };
  }
  if (isMiniMaxHost(host)) {
    return { routeKind: 'direct', routeLabelKey: 'provider.route.miniMax' };
  }
  return { routeKind: 'custom-direct', routeLabelKey: 'provider.route.customDirect' };
}

function resolveRecommendedPromptTokens(
  baseUrl: string,
  host: string,
  modelId: string | undefined
): PromptBudgetResolution {
  const trimmedBaseUrl = baseUrl.trim().toLowerCase();
  const model = modelId?.trim().toLowerCase() ?? '';
  const trustsModelNamedContextWindow =
    !trimmedBaseUrl.startsWith('/')
    && (
      isAnthropicHost(host)
      || isGoogleApisHost(host)
      || isOpenAiHost(host)
    );

  if (trustsModelNamedContextWindow && (isClaude46Model(model) || isClaudeModel(model))) {
    return budgetForContextWindow(LARGE_FIRST_PARTY_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (trustsModelNamedContextWindow && model.includes('gemini')) {
    return budgetForContextWindow(LARGE_FIRST_PARTY_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (
    trustsModelNamedContextWindow
    && (
      model.includes('gpt-4.1')
      || model.includes('gpt-4o')
      || model.includes('gpt-5')
      || model.includes('o1')
      || model.includes('o3')
      || model.includes('o4')
    )
  ) {
    return budgetForContextWindow(OPENAI_CLASS_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (
    model.includes('deepseek')
    || model.includes('kimi')
    || model.includes('qwen')
    || model.includes('grok')
    || model.includes('llama')
    || model.includes('gpt-oss')
    || model === 'polaris'
  ) {
    return advisoryPromptBudget();
  }

  if (isAnthropicHost(host)) {
    return budgetForContextWindow(LARGE_FIRST_PARTY_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (isGoogleApisHost(host)) {
    return budgetForContextWindow(LARGE_FIRST_PARTY_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (isOpenAiHost(host)) {
    return budgetForContextWindow(OPENAI_CLASS_CONTEXT_WINDOW_TOKENS, 'enforced');
  }

  if (
    isOpenRouterHost(host)
    || isDeepSeekHost(host)
    || isMoonshotHost(host)
    || isSiliconFlowHost(host)
    || isXAiHost(host)
  ) {
    return advisoryPromptBudget();
  }

  return advisoryPromptBudget();
}

export function resolveProviderProfile(
  api: Pick<ProviderProfile, 'baseUrl' | 'path' | 'protocol'> & { model?: string }
): ResolvedProviderProfile {
  const host = parseProviderHost(api.baseUrl);
  const protocol = inferProviderProtocol(api);
  const protocolLabelKey = getProviderProtocolLabelKey(protocol);
  const compatibilityMode = inferProviderCompatibilityMode();
  const route = describeProviderRoute(api.baseUrl, host);
  const promptBudget = resolveRecommendedPromptTokens(api.baseUrl, host, api.model);
  const toolChoiceSupported = supportsToolChoice({
    host,
    modelId: api.model,
    protocol
  });
  const geminiThoughtSignatureTransport = resolveGeminiThoughtSignatureTransport({
    host,
    modelId: api.model,
    protocol
  });
  const reasoningContentTransport = resolveReasoningContentTransport({
    baseUrl: api.baseUrl,
    host,
    modelId: api.model,
    path: api.path,
    protocol
  });
  const thinkingRequestTransport = resolveThinkingRequestTransport({
    host,
    modelId: api.model,
    protocol
  });

  return {
    host,
    routeKind: route.routeKind,
    routeLabelKey: route.routeLabelKey,
    protocolLabelKey,
    compatibilityMode,
    collapseSystemMessages: shouldCollapseSystemMessages({
      host,
      modelId: api.model,
      protocol
    }),
    sendThinkingBudget:
      thinkingRequestTransport !== 'none'
      && thinkingRequestTransport !== 'deepseek-thinking',
    thinkingRequestTransport,
    geminiThoughtSignatureTransport,
    reasoningContentTransport,
    reasoningContentReplayPolicy: resolveReasoningContentReplayPolicy({
      host,
      transport: reasoningContentTransport
    }),
    openAiToolHistoryReplayPolicy: resolveOpenAiToolHistoryReplayPolicy({
      geminiThoughtSignatureTransport,
      modelId: api.model,
      protocol
    }),
    supportsToolChoice: toolChoiceSupported,
    supportsRequiredToolChoice: toolChoiceSupported && supportsRequiredToolChoice({
      baseUrl: api.baseUrl,
      host,
      protocol
    }),
    contextWindowTokens: promptBudget.contextWindowTokens,
    reservedOutputTokens: promptBudget.reservedOutputTokens,
    recommendedPromptTokens: promptBudget.recommendedPromptTokens,
    promptBudgetPolicy: promptBudget.promptBudgetPolicy
  };
}
