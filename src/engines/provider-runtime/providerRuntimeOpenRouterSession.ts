import { isOpenRouterHost, parseProviderHost } from './internal/providerMatching';

export function resolveOpenRouterSessionId(baseUrl: string, sessionId?: string) {
  if (!isOpenRouterHost(parseProviderHost(baseUrl))) return undefined;

  const normalizedSessionId = sessionId?.trim();
  return normalizedSessionId || undefined;
}
