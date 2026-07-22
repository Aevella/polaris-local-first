import { Capacitor } from '@capacitor/core';
import type { PersonaAdvancedSettings, ProviderProfile } from '../types/domain';
import { buildApiRequest } from './chat-api/chatApiRequestBuilder';
import { executeBuiltRequest } from './chat-api/chatApiTransport';
import { isPolarisBuiltInProvider } from './freeProvider';
import { explainConnectivityFailure } from './providerErrorHandling';
import { resolveProviderCapability } from './provider-runtime/providerCapability';
import { resolveProviderRuntimeRequestAdapter } from './provider-runtime/providerRuntimeAdapters';
import { EMPTY_PROVIDER_RUNTIME_COMPATIBILITY_STATE } from './provider-runtime/providerRuntimeCompatibility';

function getCurrentWindowOrigin() {
  return typeof window !== 'undefined' && typeof window.location?.origin === 'string'
    ? window.location.origin
    : null;
}

function hasExplicitMaxTokens(advanced?: PersonaAdvancedSettings) {
  return Boolean(advanced?.maxTokens?.trim());
}

function connectionTransportLabel(endpoint: string) {
  return Capacitor.isNativePlatform() && /^https?:\/\//i.test(endpoint.trim())
    ? '，经 App 原生网络'
    : '';
}

export async function testApiConnection(params: {
  api: ProviderProfile;
  advanced?: PersonaAdvancedSettings;
}): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  let request: ReturnType<typeof buildApiRequest> | null = null;

  try {
    const { api, advanced } = params;
    if (!api.apiKey.trim() && !isPolarisBuiltInProvider(api)) return { ok: false, error: '未填写 API Key' };

    request = buildApiRequest({
      api,
      advanced,
      context: {
        memorySlots: {
          session: [],
          profile: [],
          pin: []
        },
        attachmentSlots: {
          enabled: false,
          pending: []
        },
        segments: [
          {
            kind: 'conversation',
            messages: [{ role: 'user', content: 'ping' }]
          }
        ]
      }
    });
    const providerAdapter = resolveProviderRuntimeRequestAdapter(api);
    if (!hasExplicitMaxTokens(advanced)) {
      providerAdapter.prepareConnectionTestRequest({
        request,
        provider: api,
        maxOutputTokens: 32
      });
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, resolveProviderCapability(api).execution.connectionTestTimeoutMs);

    try {
      try {
        await executeBuiltRequest({
          api,
          request,
          signal: controller.signal,
          rawProviderError: true
        });
      } catch (error) {
        const errorInfo = providerAdapter.classifyError({ request, error });
        const retryDecision = providerAdapter.resolveRetry({
          request,
          error,
          errorInfo,
          sawProgress: false,
          attempt: 0,
          maxAttempts: 1,
          signalAborted: controller.signal.aborted,
          forceRelayFallback: false,
          disableStreamingFallback: false,
          providerCompatibilityState: EMPTY_PROVIDER_RUNTIME_COMPATIBILITY_STATE,
          openAiToolHistoryMode: 'native',
          appliedOutputTokenBudgetFallback: true
        });

        if (retryDecision.kind === 'provider-relay') {
          await executeBuiltRequest({
            api,
            request,
            forceRelay: true,
            signal: controller.signal,
            rawProviderError: true
          });
          const testedModel = typeof request.body.model === 'string' ? request.body.model.trim() : api.model.trim();
          return {
            ok: true,
            message:
              request.body.stream === true
                ? `已完成真实回复测试（含流式，模型 ${testedModel}，经配置 relay）`
                : `已完成真实回复测试（模型 ${testedModel}，经配置 relay）`
          };
        }

        if (retryDecision.kind !== 'without-streaming') {
          throw error;
        }

        const retryRequest = {
          ...request,
          body: {
            ...request.body
          }
        };
        delete retryRequest.body.stream;

        await executeBuiltRequest({
          api,
          request: retryRequest,
          signal: controller.signal,
          rawProviderError: true
        });
      }
      const testedModel = typeof request.body.model === 'string' ? request.body.model.trim() : api.model.trim();
      const transportLabel = connectionTransportLabel(request.endpoint);
      return {
        ok: true,
        message:
          request.body.stream === true
            ? `已完成真实回复测试（含流式，模型 ${testedModel}${transportLabel}）`
            : `已完成真实回复测试（模型 ${testedModel}${transportLabel}）`
      };
    } finally {
      window.clearTimeout(timeoutId);
    }
  } catch (e) {
    if (e instanceof Error) {
      const connectivityHint = request
        ? explainConnectivityFailure({
            message: e.message,
            endpoint: request.endpoint,
            currentOrigin: getCurrentWindowOrigin(),
            isNativeApp: Capacitor.isNativePlatform()
          })
        : null;
      return { ok: false, error: connectivityHint ?? e.message };
    }
    return { ok: false, error: '连接失败' };
  }
}
