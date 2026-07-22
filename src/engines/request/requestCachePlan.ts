import type { AssistantPromptPart, AssistantPromptPartName } from './requestAudit';
import type { ProviderProtocol } from '../../types/domain';
import type { CanonicalProviderCacheMode } from '../provider-runtime/providerRuntimeTypes';
import { estimateTextTokens } from './requestTokenEstimation';

export type AssistantRequestCacheBreakpointName = 'identity_prefix' | 'capability_prefix';
export type AssistantRequestCacheTtl = '5m' | '1h';

export type AssistantRequestCacheBreakpoint = {
  name: AssistantRequestCacheBreakpointName;
  label: string;
  partNames: AssistantPromptPartName[];
  estimatedTokens: number;
  minimumTokens: number;
  ttl: AssistantRequestCacheTtl;
  enabled: boolean;
  eligible: boolean;
  reason: 'no_parts' | 'below_min_tokens' | null;
};

export type AssistantRequestCachePlan = {
  minimumBreakpointTokens: number;
  requestApplication: {
    status: 'explicit_anthropic_cache_control' | 'provider_automatic_or_unknown' | 'not_applied';
    label: string;
    sendsExplicitCacheControl: boolean;
    sendsTopLevelCacheControl?: boolean;
    automaticMessageHistoryCache?: boolean;
  };
  breakpoints: AssistantRequestCacheBreakpoint[];
};

const DEFAULT_MINIMUM_BREAKPOINT_TOKENS = 1024;
const EXTENDED_CACHE_TTL: AssistantRequestCacheTtl = '1h';

export function resolveAnthropicMinimumCacheTokens(modelId?: string | null): number {
  const normalized = modelId?.trim().toLowerCase().replace(/\./g, '-') ?? '';
  if (!normalized) return DEFAULT_MINIMUM_BREAKPOINT_TOKENS;

  if (normalized.includes('mythos')) return 4096;
  if (/claude-haiku-4-5\b/.test(normalized)) return 4096;
  if (/claude-haiku-3-5\b/.test(normalized)) return 2048;
  if (/claude-opus-4-(5|6|7)\b/.test(normalized)) return 4096;

  return DEFAULT_MINIMUM_BREAKPOINT_TOKENS;
}

export function resolveRequestCachePlan(args: {
  promptParts: AssistantPromptPart[];
  providerCacheMode?: CanonicalProviderCacheMode;
  providerSendsTopLevelCacheControl?: boolean;
  providerAutomaticMessageHistoryCache?: boolean;
  providerProtocol?: ProviderProtocol;
  modelId?: string | null;
  minimumBreakpointTokens?: number;
}): AssistantRequestCachePlan {
  const { promptParts, providerProtocol } = args;
  const providerCacheMode =
    args.providerCacheMode
    ?? (
      providerProtocol === 'anthropic-messages'
        ? 'explicit-cache-control'
        : providerProtocol === 'openai-completions' || providerProtocol === 'openai-responses'
          ? 'automatic-or-unknown'
          : 'none'
    );
  const minimumBreakpointTokens =
    args.minimumBreakpointTokens
    ?? (
      providerCacheMode === 'explicit-cache-control'
        ? resolveAnthropicMinimumCacheTokens(args.modelId)
        : DEFAULT_MINIMUM_BREAKPOINT_TOKENS
    );
  const enabledParts = promptParts.filter((part) => part.enabled);
  const identityParts = enabledParts.filter((part) => part.layer === 'identity');
  const capabilityParts = enabledParts.filter((part) => part.layer === 'capability');
  const identityTokens = identityParts.reduce((total, part) => total + estimateTextTokens(part.content), 0);
  const capabilityTokens = capabilityParts.reduce((total, part) => total + estimateTextTokens(part.content), 0);
  const sendsTopLevelCacheControl =
    providerCacheMode === 'explicit-cache-control'
    && args.providerSendsTopLevelCacheControl !== false;
  const automaticMessageHistoryCache =
    sendsTopLevelCacheControl
    && args.providerAutomaticMessageHistoryCache !== false;

  const identityBreakpoint: AssistantRequestCacheBreakpoint = {
    name: 'identity_prefix',
    label: '身份层前缀',
    partNames: identityParts.map((part) => part.name),
    estimatedTokens: identityTokens,
    minimumTokens: minimumBreakpointTokens,
    ttl: EXTENDED_CACHE_TTL,
    enabled: identityParts.length > 0,
    eligible: identityParts.length > 0 && identityTokens >= minimumBreakpointTokens,
    reason:
      identityParts.length === 0
        ? 'no_parts'
        : identityTokens < minimumBreakpointTokens
          ? 'below_min_tokens'
          : null
  };

  const capabilityBreakpoint: AssistantRequestCacheBreakpoint = {
    name: 'capability_prefix',
    label: '能力层前缀',
    partNames: [...identityParts, ...capabilityParts].map((part) => part.name),
    estimatedTokens: identityTokens + capabilityTokens,
    minimumTokens: minimumBreakpointTokens,
    ttl: EXTENDED_CACHE_TTL,
    enabled: capabilityParts.length > 0,
    eligible: capabilityParts.length > 0 && identityTokens + capabilityTokens >= minimumBreakpointTokens,
    reason:
      capabilityParts.length === 0
        ? 'no_parts'
        : identityTokens + capabilityTokens < minimumBreakpointTokens
          ? 'below_min_tokens'
          : null
  };

  return {
    minimumBreakpointTokens,
    requestApplication:
      providerCacheMode === 'explicit-cache-control'
        ? {
            status: 'explicit_anthropic_cache_control',
            label: sendsTopLevelCacheControl
              ? 'Anthropic explicit prefix cache_control plus automatic message-history cache sent'
              : 'Explicit prefix and conversation cache_control sent without top-level automatic cache control',
            sendsExplicitCacheControl: true,
            sendsTopLevelCacheControl,
            automaticMessageHistoryCache
          }
        : providerCacheMode === 'automatic-or-unknown'
          ? {
              status: 'provider_automatic_or_unknown',
              label: 'Provider may apply automatic prefix cache; Polaris sends no explicit marker',
              sendsExplicitCacheControl: false,
              sendsTopLevelCacheControl: false,
              automaticMessageHistoryCache: false
            }
          : {
              status: 'not_applied',
              label: 'No request cache integration for this protocol',
              sendsExplicitCacheControl: false,
              sendsTopLevelCacheControl: false,
              automaticMessageHistoryCache: false
            },
    breakpoints: [identityBreakpoint, capabilityBreakpoint]
  };
}
