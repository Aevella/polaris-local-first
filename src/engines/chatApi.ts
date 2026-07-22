import { buildApiRequest } from './chat-api/chatApiRequestBuilder';
import { recordStreamDebug } from './chat-api/chatApiStreamDebug';
import type { RequestAssistantReplyParams } from './chat-api/chatApiTypes';
import type { AssistantRequestContext } from './request/requestContext';
import { resolveProviderRuntimeRequestAdapter } from './provider-runtime/providerRuntimeAdapters';
import {
  shouldUseTranscriptToolHistoryForRequest,
  type OpenAiToolHistoryMode
} from './provider-runtime/providerRuntimeOpenAiToolHistory';
import {
  applyProviderRuntimeOutputTokenBudget,
  waitForProviderRuntimeRetry
} from './provider-runtime/providerRuntimeRetryPolicy';
import {
  recordProviderRuntimeCompatibilityDegradation,
  resolveProviderRuntimeCompatibilityState,
  resolveProviderRuntimeCompatibilityToolHistoryMode,
  type ProviderRuntimeCompatibilityState
} from './provider-runtime/providerRuntimeCompatibility';
import {
  executeBuiltRequest,
  resolveRequestTransportPath
} from './chat-api/chatApiTransport';
import { resolveProviderCapability } from './provider-runtime/providerCapability';
import { isPolarisBuiltInProvider } from './freeProvider';
export { testApiConnection } from './providerConnectionTest';
export type {
  AssistantNativeToolCall,
  AssistantReply,
  AssistantReplyProgress
} from './chat-api/chatApiTypes';

export function resolveStreamIdleTimeoutMs(
  api: RequestAssistantReplyParams['api'],
  advanced?: RequestAssistantReplyParams['advanced']
) {
  return resolveProviderCapability(api, advanced).execution.streamIdleTimeoutMs;
}

export function resolveConnectionTestTimeoutMs(api: RequestAssistantReplyParams['api']) {
  return resolveProviderCapability(api).execution.connectionTestTimeoutMs;
}

function buildCompatibilityContext(
  context: AssistantRequestContext,
  compatibilityState: ProviderRuntimeCompatibilityState
) {
  if (!compatibilityState.disableNativeTools) return context;

  return {
    ...context,
    tools: [],
    toolChoice: undefined
  };
}

export async function requestAssistantReply(params: RequestAssistantReplyParams) {
  const {
    api,
    context,
    sessionId,
    advanced,
    preferredOpenAiToolHistoryMode = 'native',
    signal,
    onProgress,
    onBuiltRequest
  } = params;
  if (!api.apiKey.trim() && !isPolarisBuiltInProvider(api)) throw new Error('请先在设置里填写 API Key');

  const providerCapability = resolveProviderCapability(api, advanced);
  const maxAttempts = providerCapability.execution.maxAttempts;
  const streamIdleTimeoutMs = providerCapability.execution.streamIdleTimeoutMs;
  let disableStreamingFallback = false;
  let forceRelayFallback = false;
  let providerCompatibilityState = resolveProviderRuntimeCompatibilityState(api);
  let openAiToolHistoryMode: OpenAiToolHistoryMode = resolveProviderRuntimeCompatibilityToolHistoryMode(
    preferredOpenAiToolHistoryMode,
    providerCompatibilityState
  );
  let outputTokenBudgetFallback: number | null = null;
  let appliedOutputTokenBudgetFallback = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryContext = buildCompatibilityContext(context, providerCompatibilityState);
    let request = buildApiRequest({
      api,
      advanced,
      context: retryContext,
      sessionId,
      bodyOverrides: disableStreamingFallback ? { stream: false } : undefined,
      openAiToolHistoryMode
    });
    if (shouldUseTranscriptToolHistoryForRequest(request, openAiToolHistoryMode)) {
      openAiToolHistoryMode = 'transcript';
      request = buildApiRequest({
        api,
        advanced,
        context: retryContext,
        sessionId,
        bodyOverrides: disableStreamingFallback ? { stream: false } : undefined,
        openAiToolHistoryMode
      });
    }
    if (outputTokenBudgetFallback !== null) {
      applyProviderRuntimeOutputTokenBudget(request, outputTokenBudgetFallback);
    }
    onBuiltRequest?.(request);
    const requestController = new AbortController();
    let idleTimer: number | null = null;
    let idleTimedOut = false;
    let sawProgress = false;

    const forwardAbort = () => {
      requestController.abort();
    };
    if (signal?.aborted) {
      requestController.abort();
    } else {
      signal?.addEventListener('abort', forwardAbort, { once: true });
    }

    const resetIdleTimer = () => {
      if (typeof window === 'undefined') return;
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idleTimedOut = true;
        requestController.abort();
      }, streamIdleTimeoutMs);
    };

    const clearIdleTimer = () => {
      if (typeof window === 'undefined' || idleTimer === null) return;
      window.clearTimeout(idleTimer);
      idleTimer = null;
    };

    try {
      resetIdleTimer();
      const transportPath = resolveRequestTransportPath({
        api,
        request,
        forceRelay: forceRelayFallback
      });
      recordStreamDebug('request-path', {
        provider: request.provider,
        path: transportPath.path,
        endpoint: transportPath.endpoint.slice(0, 120),
        upstreamEndpoint: transportPath.shouldUseRelay ? request.endpoint.slice(0, 120) : null,
        relay: transportPath.shouldUseRelay,
        relayFallback: forceRelayFallback,
        requestStream: transportPath.requestedStreaming,
        idleTimeoutMs: transportPath.requestedStreaming ? streamIdleTimeoutMs : null,
        providerStreamingEnabled: providerCapability.streaming.text,
        personaStreamingEnabled: advanced?.streaming ?? null,
        nativePlatform: transportPath.nativePlatform,
        platform: transportPath.platform,
        attempt: attempt + 1
      });

      const handleProgress = (reply: Parameters<NonNullable<typeof onProgress>>[0]) => {
        sawProgress = true;
        onProgress?.(reply);
      };
      return await executeBuiltRequest({
        api,
        request,
        forceRelay: forceRelayFallback,
        signal: requestController.signal,
        onProgress: handleProgress,
        onChunk: resetIdleTimer
      });
    } catch (error) {
      if (idleTimedOut) {
        error = new Error('流式响应超时，请重试。');
      }
      const retryAdapter = resolveProviderRuntimeRequestAdapter(api);
      const errorInfo = retryAdapter.classifyError({ request, error });
      const retryDecision = retryAdapter.resolveRetry({
        request,
        error,
        errorInfo,
        sawProgress,
        attempt,
        maxAttempts,
        signalAborted: Boolean(signal?.aborted),
        forceRelayFallback,
        disableStreamingFallback,
        providerCompatibilityState,
        openAiToolHistoryMode,
        appliedOutputTokenBudgetFallback
      });

      if (retryDecision.kind === 'provider-relay') {
        forceRelayFallback = true;
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? 'provider-relay-fallback'
        });
        attempt -= 1;
        continue;
      }

      if (retryDecision.kind === 'same-request') {
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? errorInfo.rawMessage.slice(0, 180)
        });
        await waitForProviderRuntimeRetry(signal, retryDecision.delayMs);
        continue;
      }

      if (retryDecision.kind === 'output-token-fallback' && retryDecision.outputTokenBudget !== undefined) {
        outputTokenBudgetFallback = retryDecision.outputTokenBudget;
        appliedOutputTokenBudgetFallback = true;
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? `output-budget-fallback:${retryDecision.outputTokenBudget}`
        });
        attempt -= 1;
        continue;
      }

      if (retryDecision.kind === 'without-streaming') {
        disableStreamingFallback = true;
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? 'stream-fallback'
        });
        attempt -= 1;
        continue;
      }

      if (retryDecision.kind === 'compatibility-degradation' && retryDecision.compatibilityDegradation) {
        providerCompatibilityState = recordProviderRuntimeCompatibilityDegradation(
          api,
          retryDecision.compatibilityDegradation
        );
        openAiToolHistoryMode = resolveProviderRuntimeCompatibilityToolHistoryMode(
          openAiToolHistoryMode,
          providerCompatibilityState
        );
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? `compatibility:${retryDecision.compatibilityDegradation.reason}`
        });
        attempt -= 1;
        continue;
      }

      if (retryDecision.kind === 'transcript-tool-history') {
        openAiToolHistoryMode = 'transcript';
        recordStreamDebug('silent-retry', {
          provider: request.provider,
          model: api.model,
          attempt: attempt + 1,
          reason: retryDecision.reason ?? 'tool-history-transcript-fallback'
        });
        attempt -= 1;
        continue;
      }

      throw error;
    } finally {
      clearIdleTimer();
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  throw new Error('请求失败');
}
