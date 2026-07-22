import { afterEach, describe, expect, it, vi } from 'vitest';

type NativeEvent = {
  requestId: string;
  type: 'chunk' | 'complete' | 'error';
  data?: string;
  message?: string;
};

const nativePlugin = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(async () => undefined),
  addListener: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    getPlatform: () => 'ios'
  },
  registerPlugin: () => nativePlugin
}));

import { executeNativeProviderHttpRequest } from './providerHttp';

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

describe('executeNativeProviderHttpRequest', () => {
  let eventListener: ((event: NativeEvent) => void) | null = null;
  const remove = vi.fn(async () => undefined);

  afterEach(() => {
    eventListener = null;
    remove.mockClear();
    nativePlugin.start.mockReset();
    nativePlugin.cancel.mockClear();
    nativePlugin.addListener.mockReset();
  });

  it('reassembles split UTF-8 chunks even when native events arrive before the start promise resolves', async () => {
    nativePlugin.addListener.mockImplementation(async (_eventName, listener) => {
      eventListener = listener;
      return { remove };
    });
    nativePlugin.start.mockImplementation(async ({ requestId }) => {
      const bytes = new TextEncoder().encode('你好');
      eventListener?.({ requestId, type: 'chunk', data: encodeBase64(bytes.slice(0, 2)) });
      eventListener?.({ requestId, type: 'chunk', data: encodeBase64(bytes.slice(2)) });
      eventListener?.({ requestId, type: 'complete' });
      return { status: 200, contentType: 'text/event-stream' };
    });
    const responses: Array<{ status: number; contentType: string }> = [];
    const chunks: string[] = [];

    await executeNativeProviderHttpRequest({
      url: 'https://example.com/v1/chat/completions',
      headers: { Authorization: 'Bearer test' },
      body: '{}',
      onResponse: (response) => responses.push(response),
      onTextChunk: (chunk) => chunks.push(chunk)
    });

    expect(responses).toEqual([{ status: 200, contentType: 'text/event-stream' }]);
    expect(chunks.join('')).toBe('你好');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('cancels the native request when the shared abort signal fires', async () => {
    nativePlugin.addListener.mockImplementation(async (_eventName, listener) => {
      eventListener = listener;
      return { remove };
    });
    nativePlugin.start.mockImplementation(async () => await new Promise(() => undefined));
    const controller = new AbortController();

    const request = executeNativeProviderHttpRequest({
      url: 'https://example.com/v1/chat/completions',
      headers: {},
      body: '{}',
      signal: controller.signal,
      onResponse: () => undefined,
      onTextChunk: () => undefined
    });
    await vi.waitFor(() => expect(nativePlugin.start).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(nativePlugin.cancel).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
