import type { PersonaAdvancedSettings, ProviderProfile } from '../../types/domain';
import type { AssistantRequestContext } from '../request/requestContext';
import type { OpenAiToolHistoryMode } from '../provider-runtime/providerRuntimeOpenAiToolHistory';
import type {
  AssistantNativeToolCall,
  AssistantReply,
  AssistantReplyProgress,
  ProviderHttpRequest
} from '../provider-runtime/providerRuntimeTypes';

export type {
  AssistantNativeToolCall,
  AssistantReply,
  AssistantReplyProgress
};

export type BuiltRequest = ProviderHttpRequest;

export type RequestAssistantReplyParams = {
  api: ProviderProfile;
  context: AssistantRequestContext;
  sessionId?: string;
  advanced?: PersonaAdvancedSettings;
  preferredOpenAiToolHistoryMode?: OpenAiToolHistoryMode;
  signal?: AbortSignal;
  onProgress?: (reply: AssistantReplyProgress) => void;
  onBuiltRequest?: (request: BuiltRequest) => void;
};
