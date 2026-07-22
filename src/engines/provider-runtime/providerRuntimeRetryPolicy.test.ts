import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiCompatibleChatAdapter, openAiResponsesAdapter } from './providerRuntimeAdapters';
import { EMPTY_PROVIDER_RUNTIME_COMPATIBILITY_STATE } from './providerRuntimeCompatibility';
import type { ProviderRuntimeRequestAdapter, ProviderRuntimeRetryInput } from './providerRuntimeRequestTypes';
import type { ProviderHttpRequest } from './providerRuntimeTypes';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web')
  }
}));

function createRequest(overrides: Partial<ProviderHttpRequest> = {}): ProviderHttpRequest {
  return {
    endpoint: 'https://example.com/v1/chat/completions',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json'
    },
    body: {
      model: 'deepseek-v3',
      stream: true,
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'ping' }]
    },
    provider: 'openai-completions',
    compatibilityMode: 'standard',
    capability: {
      route: {
        isBuiltInTrial: false
      },
      transport: {
        relayAllowedWhenNetworkFails: true
      }
    },
    ...overrides
  };
}

function retryInput(
  adapter: ProviderRuntimeRequestAdapter,
  request: ProviderHttpRequest,
  error: Error,
  overrides: Partial<ProviderRuntimeRetryInput> = {}
): ProviderRuntimeRetryInput {
  const errorInfo = adapter.classifyError({ request, error });
  return {
    request,
    error,
    errorInfo,
    sawProgress: false,
    attempt: 0,
    maxAttempts: 1,
    signalAborted: false,
    forceRelayFallback: false,
    disableStreamingFallback: false,
    providerCompatibilityState: EMPTY_PROVIDER_RUNTIME_COMPATIBILITY_STATE,
    openAiToolHistoryMode: 'native',
    appliedOutputTokenBudgetFallback: false,
    ...overrides
  };
}

describe('provider runtime retry policy', () => {
  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.unstubAllGlobals();
  });

  it('classifies retryable rate limits as canonical provider errors', () => {
    const request = createRequest();
    const errorInfo = openAiCompatibleChatAdapter.classifyError({
      request,
      error: new Error('API 429: rate limited')
    });

    expect(errorInfo).toMatchObject({
      code: 'rate_limit',
      provider: 'openai-completions',
      retryable: true,
      status: 429
    });
  });

  it('resolves stream fallback through the matched adapter', () => {
    const request = createRequest();
    const error = new Error('API 500: bad_response_status_code stream closed');

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(openAiCompatibleChatAdapter, request, error))
    ).toMatchObject({
      kind: 'without-streaming',
      reason: 'stream-fallback'
    });
  });

  it('turns native tool schema rejections into a compatibility degradation', () => {
    const request = createRequest({
      endpoint: 'https://relay.example.test/api/v1/chat/completions',
      body: {
        model: 'provider/model',
        stream: true,
        messages: [{ role: 'user', content: '你好' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'appendNote',
              description: '追加记录',
              parameters: { type: 'object', properties: {} }
            }
          }
        ],
        tool_choice: 'auto'
      }
    });
    const error = new Error('API 422: {"error":{"message":"tools unsupported for this route"}}');

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(openAiCompatibleChatAdapter, request, error))
    ).toMatchObject({
      kind: 'compatibility-degradation',
      reason: 'compatibility:native_tools_rejected',
      compatibilityDegradation: {
        reason: 'native_tools_rejected',
        disableNativeTools: true
      }
    });
  });

  it('turns strict role alternation failures into a compatibility degradation', () => {
    const request = createRequest({
      body: {
        model: 'provider/model',
        messages: [
          { role: 'system', content: 'context' },
          { role: 'user', content: '你好' },
          { role: 'system', content: 'provider_error' },
          { role: 'user', content: '还在吗' }
        ]
      }
    });
    const error = new Error(
      'API 400: {"error":{"message":"Conversation roles must alternate user/assistant/user/assistant/..."}}'
    );

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(openAiCompatibleChatAdapter, request, error))
    ).toMatchObject({
      kind: 'compatibility-degradation',
      reason: 'compatibility:message_roles_rejected',
      compatibilityDegradation: {
        reason: 'message_roles_rejected',
        forceTranscriptMessages: true
      }
    });
  });

  it('keeps OpenAI-compatible transcript tool-history retry adapter-scoped', () => {
    const request = createRequest({
      body: {
        model: 'deepseek-v3',
        messages: [
          {
            role: 'assistant',
            content: '我先试试看。',
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'patchRawCss', arguments: '{}' } }]
          },
          {
            role: 'tool',
            tool_call_id: 'call-1',
            name: 'patchRawCss',
            content: '{"status":"applied"}'
          }
        ]
      }
    });
    const error = new Error(
      `API 400: {"message":"Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"}`
    );

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(openAiCompatibleChatAdapter, request, error))
    ).toMatchObject({
      kind: 'transcript-tool-history',
      reason: 'tool-history-transcript-fallback'
    });

    expect(
      openAiResponsesAdapter.resolveRetry(retryInput(openAiResponsesAdapter, request, error))
    ).toMatchObject({
      kind: 'none'
    });
  });

  it('resolves output-token fallback before stream fallback', () => {
    const request = createRequest();
    const error = new Error('API 400: max_tokens must be in [1, 2048]');

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(openAiCompatibleChatAdapter, request, error))
    ).toMatchObject({
      kind: 'output-token-fallback',
      outputTokenBudget: 2048,
      reason: 'output-budget-fallback:2048'
    });
  });

  it('drives browser relay fallback from request capability instead of provider protocol', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.test' } });
    const error = new Error('Failed to fetch');
    const relayCapability = {
      route: {
        isBuiltInTrial: false
      },
      transport: {
        relayAllowedWhenNetworkFails: true
      }
    };
    const noRelayCapability = {
      ...relayCapability,
      transport: {
        relayAllowedWhenNetworkFails: false
      }
    };
    const retryOverrides = {
      disableStreamingFallback: true
    };

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(
        openAiCompatibleChatAdapter,
        createRequest({
          provider: 'anthropic-messages',
          capability: relayCapability
        }),
        error,
        retryOverrides
      ))
    ).toMatchObject({
      kind: 'provider-relay',
      reason: 'provider-relay-fallback'
    });

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(
        openAiCompatibleChatAdapter,
        createRequest({
          provider: 'openai-completions',
          capability: noRelayCapability
        }),
        error,
        retryOverrides
      ))
    ).toMatchObject({
      kind: 'none'
    });
  });

  it('does not send Android provider network failures through a server relay', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    const error = new Error('NetworkError when attempting to fetch resource.');

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(
        openAiCompatibleChatAdapter,
        createRequest(),
        error,
        { disableStreamingFallback: true }
      ))
    ).toMatchObject({ kind: 'none' });
  });

  it('classifies native iOS fetch aborts without inventing a relay retry', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    const error = new Error('Fetch is aborted');

    const errorInfo = openAiCompatibleChatAdapter.classifyError({
      request: createRequest(),
      error
    });
    expect(errorInfo).toMatchObject({
      code: 'network',
      retryable: true
    });
    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(
        openAiCompatibleChatAdapter,
        createRequest(),
        error,
        { disableStreamingFallback: true }
      ))
    ).toMatchObject({ kind: 'none' });
  });

  it('does not relay a fetch abort caused by Polaris aborting the request', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(
      openAiCompatibleChatAdapter.resolveRetry(retryInput(
        openAiCompatibleChatAdapter,
        createRequest(),
        new Error('Fetch is aborted'),
        {
          disableStreamingFallback: true,
          signalAborted: true
        }
      ))
    ).toMatchObject({
      kind: 'none'
    });
  });
});
