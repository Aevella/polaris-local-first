import { afterEach, describe, expect, it, vi } from 'vitest';

const pluginMock = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(async () => undefined),
  addListener: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    getPlatform: vi.fn(() => 'ios'),
    isPluginAvailable: vi.fn((name: string) => name === 'NativeMcpSse')
  },
  registerPlugin: vi.fn(() => pluginMock)
}));

import { canUseNativeMcpSse, openNativeMcpSse } from './mcpSse';

describe('native MCP SSE bridge', () => {
  afterEach(() => {
    pluginMock.open.mockReset();
    pluginMock.close.mockReset();
    pluginMock.close.mockResolvedValue(undefined);
    pluginMock.addListener.mockReset();
  });

  it('routes only the matching native connection events and removes listeners on close', async () => {
    const listeners = new Map<string, (event: Record<string, string>) => void>();
    const removeEvent = vi.fn(async () => undefined);
    const removeError = vi.fn(async () => undefined);
    pluginMock.addListener.mockImplementation(async (name, listener) => {
      listeners.set(name, listener);
      return { remove: name === 'event' ? removeEvent : removeError };
    });
    pluginMock.open.mockImplementation(async ({ connectionId }) => ({
      endpoint: `https://mcp.example.com/messages?session=${connectionId}`
    }));
    const onEvent = vi.fn();
    const onError = vi.fn();

    expect(canUseNativeMcpSse()).toBe(true);
    const connection = await openNativeMcpSse({
      url: 'https://mcp.example.com/sse',
      headers: { Authorization: 'Bearer redacted' },
      timeoutMs: 5000,
      onEvent,
      onError
    });
    const connectionId = pluginMock.open.mock.calls[0]?.[0]?.connectionId;
    listeners.get('event')?.({ connectionId: 'another', event: 'message', data: '{}' });
    listeners.get('event')?.({ connectionId, event: 'message', data: '{"ok":true}' });
    listeners.get('error')?.({ connectionId, message: 'stream ended' });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith('message', '{"ok":true}');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'stream ended' }));

    await connection.close();
    expect(pluginMock.close).toHaveBeenCalledWith({ connectionId });
    expect(removeEvent).toHaveBeenCalledOnce();
    expect(removeError).toHaveBeenCalledOnce();
  });
});
