import type {
  ChatNativeToolCall,
  ChatTokenUsage,
  PersonaAdvancedSettings,
  ProviderProfile,
  ProviderProtocol
} from '../../types/domain';
import type { ProviderCompatibilityMode } from './internal/providerProfile';
import type { ProviderRuntimeCompatibilityDegradation } from './providerRuntimeCompatibility';
import type {
  AssistantContextRole,
  AssistantContextToolCall,
  AssistantContextToolResult,
  AssistantMessageContent,
  AssistantRequestContext,
  AssistantRequestTool,
  AssistantRequestToolChoice
} from '../request/requestContext';

export type CanonicalProviderReasoningMode =
  | 'none'
  | 'hidden'
  | 'text'
  | 'summary'
  | 'signature-required';

export type CanonicalProviderImageInputMode =
  | 'none'
  | 'data-url'
  | 'remote-url'
  | 'model-dependent';

export type CanonicalProviderToolMode =
  | 'none'
  | 'native'
  | 'transcript';

export type CanonicalProviderToolHistoryMode =
  | 'none'
  | 'native'
  | 'transcript'
  | 'native-with-transcript-fallback';

export type CanonicalProviderToolChoiceControl =
  | 'none'
  | 'auto'
  | 'required';

export type CanonicalProviderToolPromptProtocol =
  | 'native-first'
  | 'hybrid';

export type CanonicalProviderOutputTokenField =
  | 'max_tokens'
  | 'max_output_tokens'
  | 'max_completion_tokens';

export type CanonicalProviderTransportMode =
  | 'direct'
  | 'browser-relay'
  | 'native-direct'
  | 'built-in-gateway';

export type CanonicalProviderCacheMode =
  | 'none'
  | 'automatic-or-unknown'
  | 'explicit-cache-control';

export type CanonicalProviderCapabilitySet = {
  input: {
    text: true;
    images: CanonicalProviderImageInputMode;
  };
  output: {
    text: true;
    nativeToolCalls: boolean;
    reasoning: CanonicalProviderReasoningMode;
  };
  streaming: {
    text: boolean;
    toolCalls: boolean;
    reasoning: boolean;
    usage: boolean;
  };
  tools: {
    mode: CanonicalProviderToolMode;
    historyMode: CanonicalProviderToolHistoryMode;
    promptProtocol: CanonicalProviderToolPromptProtocol;
    choiceControl: CanonicalProviderToolChoiceControl;
    requiredChoice: boolean;
  };
  budgets: {
    contextWindowTokens: number | null;
    recommendedPromptTokens: number | null;
    promptBudgetPolicy: 'enforced' | 'advisory';
    outputTokenField: CanonicalProviderOutputTokenField | null;
    reasoningBudget: boolean;
  };
  cache: {
    mode: CanonicalProviderCacheMode;
    promptCaching: boolean;
  };
  transport: {
    modes: CanonicalProviderTransportMode[];
  };
};

export type CanonicalProviderMessage = {
  role: AssistantContextRole;
  content: AssistantMessageContent;
  thinkingText?: string;
  toolCalls?: AssistantContextToolCall[];
  toolResult?: AssistantContextToolResult;
};

export type CanonicalProviderRequest = {
  model: string;
  messages: CanonicalProviderMessage[];
  tools: AssistantRequestTool[];
  toolChoice?: AssistantRequestToolChoice;
  options: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    reasoningBudgetTokens?: number;
    stream?: boolean;
  };
  context: AssistantRequestContext;
  advanced?: PersonaAdvancedSettings;
};

export type CanonicalProviderToolCall = {
  id: string;
  name: string;
  argumentsText: string;
  providerMetadata?: {
    geminiThoughtSignature?: string;
  };
};

export type CanonicalProviderResponse = {
  content: string;
  model: string;
  thinkingText?: string;
  toolCalls: CanonicalProviderToolCall[];
  usage?: ChatTokenUsage;
  finishReason?: string;
  transportIncomplete?: boolean;
};

export type CanonicalProviderStreamEvent =
  | { type: 'metadata'; model?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'text.snapshot'; text: string }
  | { type: 'reasoning.delta'; text: string; mode: Exclude<CanonicalProviderReasoningMode, 'none' | 'hidden'> }
  | { type: 'reasoning.snapshot'; text: string; mode: Exclude<CanonicalProviderReasoningMode, 'none' | 'hidden'> }
  | { type: 'tool_call.start'; id: string; name: string; index?: number }
  | { type: 'tool_call.delta'; id: string; argumentsDelta: string; index?: number }
  | { type: 'tool_call.done'; id: string; name: string; argumentsText: string; index?: number }
  | { type: 'usage'; usage: ChatTokenUsage }
  | { type: 'done'; finishReason?: string; transportIncomplete?: boolean }
  | { type: 'error'; error: CanonicalProviderError };

export type CanonicalProviderErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'context_too_large'
  | 'model_unavailable'
  | 'schema_unsupported'
  | 'stream_failed'
  | 'network'
  | 'provider';

export type CanonicalProviderError = {
  code: CanonicalProviderErrorCode;
  rawMessage: string;
  provider: string;
  retryable: boolean;
  status?: number;
  hintMessage?: string;
};

export type CanonicalProviderRetryKind =
  | 'none'
  | 'same-request'
  | 'without-streaming'
  | 'compatibility-degradation'
  | 'provider-relay'
  | 'transcript-tool-history'
  | 'output-token-fallback';

export type CanonicalProviderRetryDecision = {
  kind: CanonicalProviderRetryKind;
  delayMs?: number;
  bodyPatch?: Record<string, unknown>;
  compatibilityDegradation?: ProviderRuntimeCompatibilityDegradation;
  outputTokenBudget?: number;
  reason?: string;
};

export type ProviderAdapterMatch = {
  adapterId: string;
  confidence: 'exact' | 'compatible' | 'fallback';
  reason: string;
};

export type ProviderHttpRequest = {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  provider: ProviderProtocol;
  compatibilityMode: ProviderCompatibilityMode;
  capability?: {
    route: {
      isBuiltInTrial: boolean;
    };
    transport: {
      relayAllowedWhenNetworkFails: boolean;
    };
  };
  usesBuiltInTrial?: boolean;
};

export type AssistantNativeToolCall = ChatNativeToolCall;

export type AssistantReply = {
  content: string;
  model?: string;
  tokenCount?: number;
  tokenUsage?: ChatTokenUsage;
  thinkingText?: string;
  nativeToolCalls?: AssistantNativeToolCall[];
  usedNativeToolCalls?: boolean;
  nativeToolCallCount?: number;
  finishReason?: string;
  transportIncomplete?: boolean;
};

export type AssistantReplyProgress = AssistantReply;

export type ProviderRuntimeRouteInput = {
  profile: ProviderProfile;
  model: string;
};

export type CanonicalProviderAdapter = {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  match(profile: ProviderProfile): ProviderAdapterMatch | null;
  resolveCapabilities(input: ProviderRuntimeRouteInput): CanonicalProviderCapabilitySet;
  buildRequest(input: CanonicalProviderRequest): ProviderHttpRequest;
  parseResponse(raw: unknown, fallbackModel: string): CanonicalProviderResponse;
  parseStreamEvent(raw: unknown): CanonicalProviderStreamEvent[];
  classifyError(error: unknown): CanonicalProviderError;
  resolveRetry(error: CanonicalProviderError, attempt: number): CanonicalProviderRetryDecision;
};

export type ProviderRuntimeCharacterizationFixture = {
  id: string;
  provider: ProviderProfile;
  context: AssistantRequestContext;
  advanced?: PersonaAdvancedSettings;
  expected: {
    protocol: ProviderProtocol;
    stream: boolean;
    outputTokenField: CanonicalProviderOutputTokenField | null;
    toolMode: CanonicalProviderToolMode;
    reasoningMode: CanonicalProviderReasoningMode;
  };
};
