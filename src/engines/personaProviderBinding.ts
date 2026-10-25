import { resolveProviderCapability } from './provider-runtime';
import type { ConversationWindowPreferences, Persona, ProviderProfile } from '../types/domain';

export type PersonaProviderBinding = {
  api: ProviderProfile;
  fixedProvider: ProviderProfile | null;
  fixedProviderId: string | null;
  modelOverride: string;
  modelId: string;
};

export function resolvePersonaProviderBinding(args: {
  globalApi: ProviderProfile;
  providers: ProviderProfile[];
  persona?: Persona | null;
  windowBinding?: ConversationWindowPreferences['modelBinding'];
}): PersonaProviderBinding {
  const windowProvider = args.windowBinding ? args.providers.find(provider => provider.id === args.windowBinding?.providerId) : null;
  const fixedProviderId = windowProvider?.id || args.persona?.advanced?.providerId?.trim() || null;
  const fixedProvider = fixedProviderId
    ? args.providers.find((provider) => provider.id === fixedProviderId) ?? null
    : null;
  const baseApi = fixedProvider ?? args.globalApi;
  const modelOverride = fixedProviderId && !fixedProvider
    ? ''
    : windowProvider ? (resolveProviderCapability(windowProvider).route.isBuiltInTrial ? '' : args.windowBinding?.model.trim() || '') : args.persona?.advanced?.modelOverride.trim() || '';
  const modelId = modelOverride || baseApi.model;
  const api = modelId && modelId !== baseApi.model
    ? { ...baseApi, model: modelId }
    : baseApi;

  return {
    api,
    fixedProvider,
    fixedProviderId,
    modelOverride,
    modelId
  };
}
