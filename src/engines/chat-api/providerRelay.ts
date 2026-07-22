import { Capacitor } from '@capacitor/core';
import type { BuiltRequest } from './chatApiTypes';
export {
  hasProviderRelayAuthHeader,
  isAllowedProviderRelayTarget,
  isProviderModelListRelayTarget,
  sanitizeProviderRelayHeaders
} from './providerRelayShared';
import { isAllowedProviderRelayTarget } from './providerRelayShared';

export const ANTHROPIC_BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

export function isOfficialAnthropicApiEndpoint(endpointText: string) {
  try {
    const endpoint = new URL(endpointText);
    return endpoint.hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function isOfficialAnthropicMessagesEndpoint(request: BuiltRequest) {
  if (request.provider !== 'anthropic-messages') return false;
  if (!isOfficialAnthropicApiEndpoint(request.endpoint)) return false;

  try {
    return new URL(request.endpoint).pathname.replace(/\/+$/, '') === '/v1/messages';
  } catch {
    return false;
  }
}

export function shouldUseAnthropicBrowserDirectAccess(request: BuiltRequest) {
  if (typeof window === 'undefined') return false;
  return isOfficialAnthropicMessagesEndpoint(request);
}

export function canFallbackThroughProviderRelay(endpointText: string) {
  if (!isAllowedProviderRelayTarget(endpointText)) return false;
  if (Capacitor.isNativePlatform()) return false;
  if (typeof window === 'undefined') return false;

  const currentOrigin = window.location?.origin;
  if (typeof currentOrigin !== 'string' || !currentOrigin) return false;

  try {
    return new URL(endpointText).origin !== currentOrigin;
  } catch {
    return false;
  }
}
