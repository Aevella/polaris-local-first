import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaAdvancedSettings, ProviderProfile } from '../types/domain';
import type { AssistantRequestContext } from './request/requestContext';
import {
  requestAssistantReply,
  resolveConnectionTestTimeoutMs,
  resolveStreamIdleTimeoutMs,
  testApiConnection
} from './chatApi';
import { clearProviderRuntimeCompatibilityCache } from './provider-runtime/providerRuntimeCompatibility';

const capacitorRuntime = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web'
}));
const nativeProviderRuntime = vi.hoisted(() => ({
  available: true,
  execute: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorRuntime.nativePlatform,
    getPlatform: () => capacitorRuntime.platform
  }
}));

vi.mock('../native/providerHttp', () => ({
  canUseNativeProviderHttp: () => nativeProviderRuntime.available,
  executeNativeProviderHttpRequest: (...args: unknown[]) => nativeProviderRuntime.execute(...args)
}));

beforeEach(() => {
  capacitorRuntime.nativePlatform = false;
  capacitorRuntime.platform = 'web';
  nativeProviderRuntime.available = true;
  nativeProviderRuntime.execute.mockReset();
  vi.unstubAllEnvs();
  clearProviderRuntimeCompatibilityCache();
});

function createProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    protocol: 'openai-completions',
    baseUrl: 'https://example.com/v1',
    path: '/chat/completions',
    apiKey: 'test-key',
    model: 'test-model',
    capabilities: {
      images: false,
      streaming: true,
      thinking: false
    },
    ...overrides
  };
}

function installWindowTestGlobals() {
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, String(value));
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    get length() {
      return storage.size;
    }
  };

  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', {
    origin: 'https://polaris.example.com'
  });
  vi.stubGlobal('localStorage', localStorageMock);

  return () => {
    if (originalWindow === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.window;
    } else {
      vi.stubGlobal('window', originalWindow);
    }

    if (originalLocation === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.location;
    } else {
      vi.stubGlobal('location', originalLocation);
    }

    if (originalLocalStorage === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.localStorage;
    } else {
      vi.stubGlobal('localStorage', originalLocalStorage);
    }
  };
}

function unwrapRequestBody(init?: RequestInit) {
  const payload = JSON.parse(String(init?.body));
  return payload.body ? payload.body : payload;
}

function createAdvanced(overrides: Partial<PersonaAdvancedSettings> = {}): PersonaAdvancedSettings {
  return {
    modelOverride: '',
    temperature: '',
    topP: '',
    maxTokens: '',
    thinkingBudget: '',
    contextMessageLimit: '',
    showThinking: true,
    streaming: true,
    customHeaders: '',
    customBody: '',
    regexRules: '',
    snippets: [],
    ...overrides
  };
}

describe('resolveStreamIdleTimeoutMs', () => {
  it('keeps the standard timeout for non-thinking providers', () => {
    expect(resolveStreamIdleTimeoutMs(createProvider())).toBe(300_000);
  });

  it('widens the idle timeout for thinking-capable providers', () => {
    expect(resolveStreamIdleTimeoutMs(createProvider({
      capabilities: {
        images: false,
        streaming: true,
        thinking: true
      }
    }))).toBe(300_000);
  });

  it('widens the idle timeout further for high thinking budgets', () => {
    expect(resolveStreamIdleTimeoutMs(
      createProvider({
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      {
        modelOverride: '',
        temperature: '',
        topP: '',
        maxTokens: '',
        thinkingBudget: '8192',
        contextMessageLimit: '',
        showThinking: true,
        streaming: true,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        snippets: []
      }
    )).toBe(480_000);
  });

  it('does not shorten Claude-style routes when thinking is enabled', () => {
    expect(resolveStreamIdleTimeoutMs(createProvider({
      protocol: 'anthropic-messages',
      model: 'claude-sonnet-4-5',
      capabilities: {
        images: true,
        streaming: true,
        thinking: true
      }
    }))).toBe(300_000);
  });
});

describe('resolveConnectionTestTimeoutMs', () => {
  it('uses the same 90 second timeout for ordinary providers', () => {
    expect(resolveConnectionTestTimeoutMs(createProvider())).toBe(90_000);
  });

  it('uses the same 90 second timeout for thinking-capable providers', () => {
    expect(resolveConnectionTestTimeoutMs(createProvider({
      capabilities: {
        images: false,
        streaming: true,
        thinking: true
      }
    }))).toBe(90_000);
  });

  it('uses the same 90 second timeout for Claude-style routes', () => {
    expect(resolveConnectionTestTimeoutMs(createProvider({
      protocol: 'anthropic-messages',
      model: 'claude-opus-4-6',
      capabilities: {
        images: true,
        streaming: true,
        thinking: false
      }
    }))).toBe(90_000);
  });
});

describe('testApiConnection', () => {
  it('keeps Mimo smoke tests on max_completion_tokens only', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        id: 'chatcmpl-mimo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          baseUrl: 'https://api.xiaomimimo.com/v1',
          path: '/chat/completions',
          model: 'mimo-v2-pro',
          apiKey: 'sk-mimo',
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        })
      });

      expect(result.ok).toBe(true);
      const body = unwrapRequestBody(calls[0]);
      expect(body.max_completion_tokens).toBe(32);
      expect(body.max_tokens).toBeUndefined();
      expect(body.max_output_tokens).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('does not force temperature into anthropic smoke tests when top_p is set', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        id: 'msg-test',
        content: [{ type: 'text', text: 'pong' }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          protocol: 'anthropic-messages',
          baseUrl: 'https://api.anthropic.com/v1',
          path: '/messages',
          model: 'claude-sonnet-4',
          capabilities: {
            images: true,
            streaming: false,
            thinking: true
          }
        }),
        advanced: createAdvanced({
          topP: '0.8',
          thinkingBudget: '1024'
        })
      });

      expect(result.ok).toBe(true);
      const body = unwrapRequestBody(calls[0]);
      expect(body.top_p).toBe(0.8);
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBe(32);
      expect(body.thinking).toBeUndefined();
      expect(calls[0]?.headers).toMatchObject({
        'anthropic-dangerous-direct-browser-access': 'true'
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('keeps Anthropic native smoke tests off browser headers and fetch', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    capacitorRuntime.nativePlatform = true;
    capacitorRuntime.platform = 'ios';
    nativeProviderRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'application/json' });
      args.onTextChunk(JSON.stringify({
        id: 'msg-test',
        content: [{ type: 'text', text: 'pong' }]
      }));
      return { status: 200, contentType: 'application/json' };
    });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        id: 'msg-test',
        content: [{ type: 'text', text: 'pong' }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          protocol: 'anthropic-messages',
          baseUrl: 'https://api.anthropic.com/v1',
          path: '/messages',
          model: 'claude-sonnet-4-6',
          capabilities: {
            images: true,
            streaming: false,
            thinking: true
          }
        })
      });

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(0);
      expect(nativeProviderRuntime.execute).toHaveBeenCalledTimes(1);
      const nativeRequest = nativeProviderRuntime.execute.mock.calls[0]?.[0];
      expect(nativeRequest.url).toBe('https://api.anthropic.com/v1/messages');
      expect(nativeRequest.headers).not.toHaveProperty('anthropic-dangerous-direct-browser-access');
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('retries a stream request without streaming after a pre-response network failure', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    let attempt = 0;
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      attempt += 1;
      if (attempt === 1) {
        throw new Error('Failed to fetch');
      }

      return new Response(JSON.stringify({
        id: 'chatcmpl-free',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          baseUrl: 'https://polaris.example.com/api'
        })
      });

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(2);
      const firstBody = unwrapRequestBody(calls[0]);
      const secondBody = unwrapRequestBody(calls[1]);
      expect(firstBody.stream).toBe(true);
      expect(secondBody.stream).toBeUndefined();
      expect(secondBody.max_tokens).toBe(32);
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('runs native iOS Gemini connection tests through the native provider bridge', async () => {
    capacitorRuntime.nativePlatform = true;
    capacitorRuntime.platform = 'ios';
    nativeProviderRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'application/json' });
      args.onTextChunk(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'pong' }],
            role: 'model'
          },
          finishReason: 'STOP'
        }],
        modelVersion: 'gemini-3.1-pro-preview'
      }));
      return { status: 200, contentType: 'application/json' };
    });
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        throw new Error('Load failed');
      }

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'pong' }],
            role: 'model'
          },
          finishReason: 'STOP'
        }],
        modelVersion: 'gemini-3.1-pro-preview'
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          protocol: 'gemini-generate-content',
          baseUrl: 'https://provider.example.com/v1',
          path: '/models/{model}:generateContent',
          model: 'gemini-3.1-pro-preview',
          capabilities: {
            images: true,
            streaming: false,
            thinking: true
          }
        })
      });

      expect(result).toEqual({
        ok: true,
        message: '已完成真实回复测试（模型 gemini-3.1-pro-preview，经 App 原生网络）'
      });
      expect(calls).toHaveLength(0);
      expect(nativeProviderRuntime.execute).toHaveBeenCalledTimes(1);
      const nativeRequest = nativeProviderRuntime.execute.mock.calls[0]?.[0];
      expect(nativeRequest.url).toBe('https://provider.example.com/v1/models/gemini-3.1-pro-preview:generateContent');
      expect(JSON.parse(nativeRequest.body).generationConfig).toEqual({
        maxOutputTokens: 32
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('does not route native Gemini smoke tests through a server relay', async () => {
    capacitorRuntime.nativePlatform = true;
    capacitorRuntime.platform = 'ios';
    nativeProviderRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'application/json' });
      args.onTextChunk(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'pong' }],
            role: 'model'
          },
          finishReason: 'STOP'
        }],
        modelVersion: 'gemini-2.5-pro'
      }));
      return { status: 200, contentType: 'application/json' };
    });
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        throw new Error('Fetch is aborted');
      }

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'pong' }],
            role: 'model'
          },
          finishReason: 'STOP'
        }],
        modelVersion: 'gemini-2.5-pro'
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          protocol: 'gemini-generate-content',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          path: '/models/{model}:generateContent',
          model: 'gemini-2.5-pro',
          capabilities: {
            images: true,
            streaming: false,
            thinking: true
          }
        })
      });

      expect(result).toEqual({
        ok: true,
        message: '已完成真实回复测试（模型 gemini-2.5-pro，经 App 原生网络）'
      });
      expect(calls).toHaveLength(0);
      expect(nativeProviderRuntime.execute).toHaveBeenCalledTimes(1);
      expect(nativeProviderRuntime.execute.mock.calls[0]?.[0].url)
        .toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('streams directly in browsers when the upstream accepts the request', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const progress: string[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response([
        'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ].join('\n'), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          baseUrl: 'https://api.openai.com/v1',
          path: '/chat/completions'
        }),
        advanced: createAdvanced(),
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
              messages: [{ role: 'user', content: '打个招呼' }]
            }
          ]
        },
        onProgress: (partialReply) => {
          progress.push(partialReply.content);
        }
      });

      expect(reply.content).toBe('你好');
      expect(progress).toEqual(['你', '你好', '你好']);
      expect(calls).toHaveLength(1);
      expect(String(calls[0].input)).toBe('https://api.openai.com/v1/chat/completions');
      const directPayload = JSON.parse(String(calls[0].init?.body));
      expect(directPayload.stream).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('falls back through the configured relay only when direct browser transport has no response', async () => {
    vi.stubEnv('VITE_POLARIS_API_ORIGIN', 'https://selfhost.example.test');
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        throw new TypeError('Failed to fetch');
      }

      return new Response(JSON.stringify({
        id: 'chatcmpl-relay',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          baseUrl: 'https://example.tailnet.ts.net/v1',
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        })
      });

      expect(result).toEqual({
        ok: true,
        message: '已完成真实回复测试（模型 test-model，经配置 relay）'
      });
      expect(calls).toHaveLength(2);
      expect(String(calls[0].input)).toBe('https://example.tailnet.ts.net/v1/chat/completions');
      expect(String(calls[1].input)).toBe('https://polaris.example.com/api/provider-relay');
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('keeps Tailscale MagicDNS providers direct when the browser receives a response', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        id: 'chatcmpl-tailnet',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          baseUrl: 'https://example.tailnet.ts.net/v1',
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        })
      });

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(String(calls[0].input)).toBe('https://example.tailnet.ts.net/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('streams native iOS provider responses without using fetch or server relay', async () => {
    capacitorRuntime.nativePlatform = true;
    capacitorRuntime.platform = 'ios';
    nativeProviderRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'text/event-stream' });
      args.onTextChunk([
        'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ].join('\n'));
      return { status: 200, contentType: 'text/event-stream' };
    });
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const progress: string[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        throw new Error('Load failed');
      }

      return new Response([
        'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        ''
      ].join('\n'), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          baseUrl: 'https://opencode.ai/zen/v1',
          path: '/chat/completions',
          model: 'claude-opus-4-6'
        }),
        advanced: createAdvanced(),
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
              messages: [{ role: 'user', content: '继续' }]
            }
          ]
        },
        onProgress: (partialReply) => {
          progress.push(partialReply.content);
        }
      });

      expect(reply.content).toBe('你好');
      expect(progress).toEqual(['你', '你好', '你好']);
      expect(calls).toHaveLength(0);
      expect(nativeProviderRuntime.execute).toHaveBeenCalledTimes(1);
      const nativeRequest = nativeProviderRuntime.execute.mock.calls[0]?.[0];
      expect(nativeRequest.url).toBe('https://opencode.ai/zen/v1/chat/completions');
      expect(JSON.parse(nativeRequest.body).stream).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('keeps an explicit max token override during connection tests instead of masking it to 32', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        error: {
          message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]',
          type: 'invalid_request_error'
        }
      }), {
        status: 400,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const result = await testApiConnection({
        api: createProvider({
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        }),
        advanced: createAdvanced({
          maxTokens: '65536',
          streaming: false
        })
      });

      expect(result.ok).toBe(false);
      const body = unwrapRequestBody(calls[0]);
      expect(body.max_tokens).toBe(65536);
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('degrades malformed native tool history into transcript mode before sending the request', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        id: 'chatcmpl-safe-history',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '继续。'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        }),
        advanced: createAdvanced({
          streaming: false
        }),
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
              messages: [
                {
                  role: 'assistant',
                  content: '我先继续。',
                  toolCalls: [{
                    id: 'call-1',
                    name: 'appendCodeCard',
                    argumentsText: '{"projectId":"white-cat-box","filePath":"script.js","code":"const part = "'
                  }]
                },
                {
                  role: 'user',
                  content: '继续写'
                }
              ]
            }
          ]
        }
      });

      expect(reply.content).toBe('继续。');
      expect(calls).toHaveLength(1);
      const body = unwrapRequestBody(calls[0]);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]).toMatchObject({
        role: 'assistant'
      });
      expect(body.messages[0].content).toContain('[assistant_tool_calls]');
      expect(body.messages[0].content).toContain('"name": "appendCodeCard"');
      expect(body.messages[0].content).toContain('\\"projectId\\":\\"white-cat-box\\"');
      expect(body.messages[0].content).toContain('\\"filePath\\":\\"script.js\\"');
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: '继续写'
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('remembers route compatibility after native tools are rejected', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    let attempt = 0;
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      attempt += 1;

      if (attempt === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'tools unsupported for this route'
          }
        }), {
          status: 422,
          headers: {
            'content-type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({
        id: 'chatcmpl-compatible',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    const api = createProvider({
      capabilities: {
        images: false,
        streaming: false,
        thinking: false
      }
    });
    const context: AssistantRequestContext = {
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
      ],
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
      toolChoice: 'auto'
    };

    try {
      const firstReply = await requestAssistantReply({
        api,
        advanced: createAdvanced({
          streaming: false
        }),
        context
      });
      const secondReply = await requestAssistantReply({
        api,
        advanced: createAdvanced({
          streaming: false
        }),
        context
      });

      expect(firstReply.content).toBe('pong');
      expect(secondReply.content).toBe('pong');
      expect(calls).toHaveLength(3);
      const firstBody = unwrapRequestBody(calls[0]);
      const retryBody = unwrapRequestBody(calls[1]);
      const rememberedBody = unwrapRequestBody(calls[2]);
      expect(firstBody.tools).toHaveLength(1);
      expect(retryBody.tools).toBeUndefined();
      expect(retryBody.tool_choice).toBeUndefined();
      expect(rememberedBody.tools).toBeUndefined();
      expect(rememberedBody.tool_choice).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('honors a preferred transcript tool history mode for followup turns', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({
        id: 'chatcmpl-preferred-transcript',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '继续。'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        }),
        advanced: createAdvanced({
          streaming: false
        }),
        preferredOpenAiToolHistoryMode: 'transcript',
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
              messages: [
                {
                  role: 'assistant',
                  content: '我先继续。',
                  toolCalls: [{
                    id: 'call-1',
                    name: 'readProjectFile',
                    argumentsText: '{"projectId":"white-cat-box","filePath":"index.html"}'
                  }]
                },
                {
                  role: 'system',
                  content: '继续这个任务：该真正动手就动手，该用工具就用工具，让下一小段工作真的落下去。'
                }
              ]
            }
          ]
        }
      });

      expect(reply.content).toBe('继续。');
      expect(calls).toHaveLength(1);
      const body = unwrapRequestBody(calls[0]);
      const assistantTranscriptMessage = body.messages.find((message: { role?: string }) => message.role === 'assistant');
      const followupTranscriptMessage = body.messages.find(
        (message: { role?: string; content?: string }) =>
          message.role === 'user' && message.content?.includes('继续这个任务：该真正动手就动手，该用工具就用工具，让下一小段工作真的落下去。')
      );
      expect(assistantTranscriptMessage).toMatchObject({
        role: 'assistant'
      });
      expect(assistantTranscriptMessage.content).toContain('[assistant_tool_calls]');
      expect(assistantTranscriptMessage.content).toContain('"name": "readProjectFile"');
      expect(followupTranscriptMessage).toMatchObject({
        role: 'user',
        content: '[system_context]\n继续这个任务：该真正动手就动手，该用工具就用工具，让下一小段工作真的落下去。'
      });
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('retries with the provider-advertised max_tokens ceiling after a range error', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    let attempt = 0;
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      attempt += 1;

      if (attempt === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]',
            type: 'invalid_request_error'
          }
        }), {
          status: 400,
          headers: {
            'content-type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({
        id: 'chatcmpl-retried',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          capabilities: {
            images: false,
            streaming: false,
            thinking: false
          }
        }),
        advanced: createAdvanced({
          maxTokens: '65536',
          streaming: false
        }),
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

      expect(reply.content).toBe('pong');
      expect(calls).toHaveLength(2);
      const firstBody = unwrapRequestBody(calls[0]);
      const secondBody = unwrapRequestBody(calls[1]);
      expect(firstBody.max_tokens).toBe(65536);
      expect(secondBody.max_tokens).toBe(8192);
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });

  it('retries direct Mimo with the provider-advertised max_completion_tokens ceiling', async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];
    let attempt = 0;
    const restoreGlobals = installWindowTestGlobals();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      attempt += 1;

      if (attempt === 1) {
        return new Response(JSON.stringify({
          error: {
            message: 'Invalid max_completion_tokens value, the valid range of max_completion_tokens is [1, 8192]',
            type: 'invalid_request_error'
          }
        }), {
          status: 400,
          headers: {
            'content-type': 'application/json'
          }
        });
      }

      return new Response(JSON.stringify({
        id: 'chatcmpl-mimo-retried',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    }) as typeof fetch;

    try {
      const reply = await requestAssistantReply({
        api: createProvider({
          name: 'Mimo',
          baseUrl: 'https://api.xiaomimimo.com/v1',
          path: '/chat/completions',
          model: 'mimo-v2.5-pro',
          apiKey: 'sk-mimo'
        }),
        advanced: createAdvanced({
          maxTokens: '65536',
          streaming: false
        }),
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

      expect(reply.content).toBe('pong');
      expect(calls).toHaveLength(2);
      const firstBody = unwrapRequestBody(calls[0]);
      const secondBody = unwrapRequestBody(calls[1]);
      expect(firstBody.max_completion_tokens).toBe(65536);
      expect(firstBody.max_tokens).toBeUndefined();
      expect(secondBody.max_completion_tokens).toBe(8192);
      expect(secondBody.max_tokens).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      restoreGlobals();
    }
  });
});
