import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuiltRequest } from './chatApiTypes';
import { executeBuiltRequest } from './chatApiTransport';
import { createProviderRuntimeTestProvider } from '../provider-runtime/providerRuntimeFixtures';

const originalFetch = globalThis.fetch;
const nativeRuntime = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web',
  available: true,
  execute: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativeRuntime.nativePlatform,
    getPlatform: () => nativeRuntime.platform
  }
}));

vi.mock('../../native/providerHttp', () => ({
  canUseNativeProviderHttp: () => nativeRuntime.available,
  executeNativeProviderHttpRequest: (...args: unknown[]) => nativeRuntime.execute(...args)
}));

function createNonStreamRequest(body: Record<string, unknown> = {}): BuiltRequest {
  return {
    endpoint: 'https://example.com/v1/chat/completions',
    headers: {},
    body: {
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: '整理旧对话' }],
      ...body
    },
    provider: 'openai-completions',
    compatibilityMode: 'standard'
  };
}

describe('executeBuiltRequest non-stream responses', () => {
  beforeEach(() => {
    nativeRuntime.nativePlatform = false;
    nativeRuntime.platform = 'web';
    nativeRuntime.available = true;
    nativeRuntime.execute.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accepts plain text non-stream replies when no native tools were requested', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('想起了一条可以保留的关系线索。', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest()
    });

    expect(reply.content).toBe('想起了一条可以保留的关系线索。');
    expect(reply.model).toBe('gpt-5-mini');
  });

  it('still rejects plain text when native tools were requested', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('想起了一条可以保留的关系线索。', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    await expect(executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest({
        tools: [{
          type: 'function',
          function: {
            name: 'writeMemory',
            description: 'writes memory',
            parameters: { type: 'object' }
          }
        }]
      })
    })).rejects.toThrow('API 返回了无法解析的非 JSON 响应');
  });

  it('does not treat JSON-shaped text/plain payloads as assistant text', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('{"unexpected":true}', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    await expect(executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest()
    })).rejects.toThrow();
  });

  it('uses the dedicated native bridge only for absolute provider endpoints', async () => {
    nativeRuntime.nativePlatform = true;
    nativeRuntime.platform = 'ios';
    globalThis.fetch = vi.fn<typeof fetch>();
    nativeRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'application/json' });
      args.onTextChunk(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '原生网络已连通' } }]
      }));
      return { status: 200, contentType: 'application/json' };
    });

    const onChunk = vi.fn();
    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest(),
      onChunk
    });

    expect(reply.content).toBe('原生网络已连通');
    expect(nativeRuntime.execute).toHaveBeenCalledTimes(1);
    expect(nativeRuntime.execute.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://example.com/v1/chat/completions'
    });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps app-internal endpoints on fetch instead of the provider bridge', async () => {
    nativeRuntime.nativePlatform = true;
    nativeRuntime.platform = 'android';
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '内部接口仍由应用网络负责' } }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: {
        ...createNonStreamRequest(),
        endpoint: '/api/client-diagnostics'
      }
    });

    expect(reply.content).toBe('内部接口仍由应用网络负责');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/client-diagnostics', expect.any(Object));
    expect(nativeRuntime.execute).not.toHaveBeenCalled();
  });
});
