import { canFallbackThroughProviderRelay } from '../chat-api/providerRelay';
import {
  type ProviderHttpRequest,
  type CanonicalProviderError,
  type CanonicalProviderErrorCode,
  type CanonicalProviderRetryDecision
} from './providerRuntimeTypes';
import type { ProviderRuntimeRetryInput } from './providerRuntimeRequestTypes';
import { shouldRetryWithTranscriptToolHistory } from './providerRuntimeOpenAiToolHistory';
import { classifyProviderRuntimeCompatibilityDegradation } from './providerRuntimeCompatibility';

const SILENT_KIMI_RETRY_DELAY_MS = 420;
const OUTPUT_TOKEN_FIELDS = ['max_completion_tokens', 'max_output_tokens', 'max_tokens'] as const;

type OutputTokenField = (typeof OUTPUT_TOKEN_FIELDS)[number];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isProviderNetworkFailureMessage(message: string) {
  return /网络请求失败|Failed to fetch|Fetch is aborted|Load failed|NetworkError/i.test(message);
}

function resolveStatus(message: string) {
  const match = message.match(/^API (\d{3}):/i);
  if (!match) return undefined;
  return Number(match[1]);
}

function resolveErrorCode(message: string, status?: number): CanonicalProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (/context|上下文|maximum context|tokens? exceed|too large/i.test(message)) return 'context_too_large';
  if (/model.*(not found|unavailable|不存在|不可用)|模型.*(不存在|不可用)/i.test(message)) {
    return 'model_unavailable';
  }
  if (/schema|tool_choice|function|工具|format|格式|malformed/i.test(message)) return 'schema_unsupported';
  if (/stream|SSE|流式|bad_response_status_code|openai_error/i.test(message)) return 'stream_failed';
  if (isProviderNetworkFailureMessage(message)) return 'network';
  return 'provider';
}

function isRetryableProviderError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (/^API 4\d\d:/i.test(error.message) && !/^API 408:/i.test(error.message) && !/^API 429:/i.test(error.message)) {
    return false;
  }

  return (
    error.message.includes('流式响应超时') ||
    /^API (408|425|429|500|502|503|504):/i.test(error.message) ||
    isProviderNetworkFailureMessage(error.message)
  );
}

function shouldRetryWithoutStreaming(request: ProviderHttpRequest, error: unknown, sawProgress: boolean) {
  if (request.provider !== 'openai-completions' && request.provider !== 'openai-responses') return false;
  if (request.body.stream !== true) return false;
  if (sawProgress) return false;
  if (!(error instanceof Error)) return false;

  if (
    isProviderNetworkFailureMessage(error.message)
  ) {
    return true;
  }

  return (
    /^API (400|408|409|415|422|425|429|500|502|503|504):/i.test(error.message)
    && (
      error.message.includes('bad_response_status_code')
      || error.message.includes('openai_error')
      || error.message.includes('stream')
      || error.message.includes('SSE')
    )
  );
}

function shouldRetryThroughProviderRelay(
  request: ProviderHttpRequest,
  capability: NonNullable<ProviderHttpRequest['capability']> | undefined,
  error: unknown,
  sawProgress: boolean,
  forceRelayFallback: boolean,
  signalAborted: boolean
) {
  if (forceRelayFallback || sawProgress || signalAborted) return false;
  if (capability?.route.isBuiltInTrial) return false;
  if (!capability?.transport.relayAllowedWhenNetworkFails) return false;
  if (!canFallbackThroughProviderRelay(request.endpoint)) return false;
  return error instanceof Error && isProviderNetworkFailureMessage(error.message);
}

function resolveOutputTokenField(request: ProviderHttpRequest): OutputTokenField | null {
  for (const field of OUTPUT_TOKEN_FIELDS) {
    if (typeof request.body[field] === 'number') {
      return field;
    }
  }

  return null;
}

export function applyProviderRuntimeOutputTokenBudget(request: ProviderHttpRequest, maxTokens: number) {
  const field = resolveOutputTokenField(request) ?? 'max_tokens';
  for (const candidate of OUTPUT_TOKEN_FIELDS) {
    delete request.body[candidate];
  }
  request.body[field] = maxTokens;
}

function resolveOutputTokenBudgetFallback(
  request: ProviderHttpRequest,
  error: unknown
) {
  if (!(error instanceof Error)) return null;
  if (!/^API (400|422):/i.test(error.message)) return null;

  const field = resolveOutputTokenField(request);
  if (!field) return null;

  const currentValue = request.body[field];
  if (typeof currentValue !== 'number' || !Number.isFinite(currentValue)) return null;

  const rangeMatch = error.message.match(
    /\b(max_tokens|max_completion_tokens|max_output_tokens)\b[\s\S]*?\[(\d+)\s*,\s*(\d+)\]/i
  );
  if (!rangeMatch) return null;

  const [, reportedField, _minText, maxText] = rangeMatch;
  if (reportedField !== field) return null;

  const fallbackBudget = Number(maxText);
  if (!Number.isInteger(fallbackBudget) || fallbackBudget <= 0 || fallbackBudget >= currentValue) {
    return null;
  }

  return fallbackBudget;
}

function decision(
  kind: CanonicalProviderRetryDecision['kind'],
  reason: string,
  extra: Omit<CanonicalProviderRetryDecision, 'kind' | 'reason'> = {}
): CanonicalProviderRetryDecision {
  return { kind, reason, ...extra };
}

export function classifyProviderRuntimeError(input: {
  request: ProviderHttpRequest;
  error: unknown;
}): CanonicalProviderError {
  const rawMessage = getErrorMessage(input.error);
  const status = resolveStatus(rawMessage);
  return {
    code: resolveErrorCode(rawMessage, status),
    rawMessage,
    provider: input.request.provider,
    retryable: isRetryableProviderError(input.error),
    status
  };
}

export function resolveProviderRuntimeRetry(
  input: ProviderRuntimeRetryInput,
  options: {
    capability?: NonNullable<ProviderHttpRequest['capability']>;
    transcriptToolHistory?: boolean;
  } = {}
): CanonicalProviderRetryDecision {
  const capability = options.capability ?? input.request.capability;

  if (
    shouldRetryThroughProviderRelay(
      input.request,
      capability,
      input.error,
      input.sawProgress,
      input.forceRelayFallback,
      input.signalAborted
    )
  ) {
    return decision('provider-relay', 'provider-relay-fallback');
  }

  if (
    input.attempt + 1 < input.maxAttempts
    && !input.sawProgress
    && !input.signalAborted
    && input.errorInfo.retryable
  ) {
    return decision('same-request', input.errorInfo.rawMessage.slice(0, 180), {
      delayMs: SILENT_KIMI_RETRY_DELAY_MS
    });
  }

  const outputTokenBudget =
    !input.appliedOutputTokenBudgetFallback
      ? resolveOutputTokenBudgetFallback(input.request, input.error)
      : null;

  if (outputTokenBudget !== null) {
    return decision('output-token-fallback', `output-budget-fallback:${outputTokenBudget}`, {
      outputTokenBudget
    });
  }

  if (!input.disableStreamingFallback && shouldRetryWithoutStreaming(input.request, input.error, input.sawProgress)) {
    return decision('without-streaming', 'stream-fallback');
  }

  const compatibilityDegradation = classifyProviderRuntimeCompatibilityDegradation({
    request: input.request,
    errorInfo: input.errorInfo,
    sawProgress: input.sawProgress,
    openAiToolHistoryMode: input.openAiToolHistoryMode,
    state: input.providerCompatibilityState
  });
  if (compatibilityDegradation) {
    return decision('compatibility-degradation', `compatibility:${compatibilityDegradation.reason}`, {
      compatibilityDegradation
    });
  }

  if (
    options.transcriptToolHistory
    && shouldRetryWithTranscriptToolHistory(
      input.request,
      input.error,
      input.sawProgress,
      input.openAiToolHistoryMode
    )
  ) {
    return decision('transcript-tool-history', 'tool-history-transcript-fallback');
  }

  return decision('none', input.errorInfo.rawMessage.slice(0, 180));
}

export async function waitForProviderRuntimeRetry(signal?: AbortSignal, delayMs = SILENT_KIMI_RETRY_DELAY_MS) {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', handleAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}
