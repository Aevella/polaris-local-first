import type { PersonaAdvancedSettings, ProviderProfile } from '../../types/domain';
import type { AssistantRequestContext } from '../request/requestContext';
import { buildProviderRuntimeRequest } from '../provider-runtime/providerRuntimeRequest';
import type { BuiltRequest } from './chatApiTypes';
import type { OpenAiToolHistoryMode } from '../provider-runtime/providerRuntimeOpenAiToolHistory';

export function buildApiRequest(params: {
  api: ProviderProfile;
  context: AssistantRequestContext;
  sessionId?: string;
  advanced?: PersonaAdvancedSettings;
  bodyOverrides?: Record<string, unknown>;
  openAiToolHistoryMode?: OpenAiToolHistoryMode;
}): BuiltRequest {
  return buildProviderRuntimeRequest(params);
}
