import type { PersonaAdvancedSettings, ProviderProfile } from '../../types/domain';
import type { AssistantRequestContext } from '../request/requestContext';
import type {
  AssistantReply,
  CanonicalProviderCapabilitySet,
  CanonicalProviderError,
  CanonicalProviderRetryDecision,
  CanonicalProviderStreamEvent,
  ProviderAdapterMatch,
  ProviderHttpRequest
} from './providerRuntimeTypes';
import type { OpenAiToolHistoryMode } from './providerRuntimeOpenAiToolHistory';
import type { ProviderRuntimeCompatibilityState } from './providerRuntimeCompatibility';

export type ProviderRuntimeRequestInput = {
  api: ProviderProfile;
  context: AssistantRequestContext;
  sessionId?: string;
  advanced?: PersonaAdvancedSettings;
  bodyOverrides?: Record<string, unknown>;
  openAiToolHistoryMode?: OpenAiToolHistoryMode;
};

export type ProviderRuntimeCapabilityInput = {
  provider: ProviderProfile;
  advanced?: Pick<PersonaAdvancedSettings, 'streaming'>;
};

export type ProviderRuntimeErrorInput = {
  request: ProviderHttpRequest;
  error: unknown;
};

export type ProviderRuntimeStreamEventInput = {
  payload: unknown;
};

export type ProviderRuntimeResponseInput = {
  data: unknown;
  fallbackModel: string;
};

export type ProviderRuntimeConnectionTestInput = {
  request: ProviderHttpRequest;
  provider: ProviderProfile;
  maxOutputTokens: number;
};

export type ProviderRuntimeRetryInput = ProviderRuntimeErrorInput & {
  errorInfo: CanonicalProviderError;
  sawProgress: boolean;
  attempt: number;
  maxAttempts: number;
  signalAborted: boolean;
  forceRelayFallback: boolean;
  disableStreamingFallback: boolean;
  providerCompatibilityState: ProviderRuntimeCompatibilityState;
  openAiToolHistoryMode: OpenAiToolHistoryMode;
  appliedOutputTokenBudgetFallback: boolean;
};

export type ProviderRuntimeRequestAdapter = {
  id: string;
  label: string;
  match(profile: ProviderProfile): ProviderAdapterMatch | null;
  resolveCapabilities(input: ProviderRuntimeCapabilityInput): CanonicalProviderCapabilitySet;
  classifyError(input: ProviderRuntimeErrorInput): CanonicalProviderError;
  resolveRetry(input: ProviderRuntimeRetryInput): CanonicalProviderRetryDecision;
  parseStreamEvents(input: ProviderRuntimeStreamEventInput): CanonicalProviderStreamEvent[];
  parseResponse(input: ProviderRuntimeResponseInput): AssistantReply;
  prepareConnectionTestRequest(input: ProviderRuntimeConnectionTestInput): void;
  buildRequest(input: ProviderRuntimeRequestInput): ProviderHttpRequest;
};
