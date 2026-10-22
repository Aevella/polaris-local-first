import type { ProviderCapability } from '../providerCapability';
import type { ProviderHttpRequest } from '../providerRuntimeTypes';
import type { ConversationReasoningStrength } from '../../../types/domain';
import { applyConversationReasoningStrength } from '../providerRuntimeThinking';

export function extractDataUrlParts(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mediaType: match[1],
    data: match[2]
  };
}

function sanitizeJsonTransportString(value: string) {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      } else {
        sanitized += '\uFFFD';
      }
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      sanitized += '\uFFFD';
      continue;
    }

    sanitized += value[index];
  }

  return sanitized;
}

export function sanitizeJsonTransportValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeJsonTransportString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonTransportValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeJsonTransportValue(nestedValue)])
    );
  }

  return value;
}

export function buildRequestResult(params: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  customBody: Record<string, unknown>;
  bodyOverrides?: Record<string, unknown>;
  provider: ProviderHttpRequest['provider'];
  compatibilityMode: ProviderHttpRequest['compatibilityMode'];
  capability: ProviderCapability;
  reasoningStrength?: ConversationReasoningStrength;
  usesBuiltInTrial?: boolean;
}): ProviderHttpRequest {
  const {
    endpoint,
    headers,
    body,
    customBody,
    bodyOverrides,
    provider,
    compatibilityMode,
    capability,
    reasoningStrength,
    usesBuiltInTrial
  } = params;

  const mergedBody = {
    ...body,
    ...customBody,
    ...bodyOverrides
  };
  applyConversationReasoningStrength(mergedBody, capability, reasoningStrength);

  return {
    endpoint,
    headers,
    body: sanitizeJsonTransportValue(mergedBody) as Record<string, unknown>,
    provider,
    compatibilityMode,
    capability: {
      route: {
        isBuiltInTrial: capability.route.isBuiltInTrial
      },
      transport: {
        relayAllowedWhenNetworkFails: capability.transport.relayAllowedWhenNetworkFails
      }
    },
    usesBuiltInTrial
  };
}
