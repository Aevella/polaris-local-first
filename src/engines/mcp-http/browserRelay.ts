import { Capacitor } from '@capacitor/core';
import { buildInternalApiEndpoint } from '../chat-api/chatApiEndpoint';
import { isPrivateHostname } from '../chat-api/providerRelayShared';

function isPublicCrossOriginHttpsUrl(value: string) {
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:' || isPrivateHostname(target.hostname)) return false;
    const currentOrigin = globalThis.location?.origin;
    return typeof currentOrigin === 'string' && Boolean(currentOrigin) && target.origin !== currentOrigin;
  } catch {
    return false;
  }
}

export function shouldUseBrowserMcpRelay(url: string, fetchImpl?: typeof fetch) {
  return !fetchImpl && !Capacitor.isNativePlatform() && isPublicCrossOriginHttpsUrl(url);
}

export async function requestBrowserMcpRelay(url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  const response = await globalThis.fetch(buildInternalApiEndpoint('/api/mcp-relay'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: typeof init.body === 'string' ? init.body : null
    }),
    signal: init.signal
  });
  return response;
}
