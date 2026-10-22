import { afterEach, describe, it, expect, vi } from 'vitest';
import type { McpSessionConnection, McpTransportOptions } from './types';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./streamableHttp', () => ({ openStreamableHttpSession: mocks.open }));
vi.mock('./legacySse', () => ({ openLegacySseSession: mocks.open }));
import {
  closeAllMcpSessions, getMcpSessionConnection, getMcpSessionAvailability,
  invalidateMcpSession, revalidateMcpSession
} from './sessionRegistry';

const options: McpTransportOptions = {
  server: { id: 'server', handle: 'test', name: 'Test', description: '',
    transport: 'streamable-http', url: 'https://example.com/mcp', headers: [], isActive: true },
  timeoutMs: 120000
};
function connection(): McpSessionConnection {
  return { request: vi.fn(async (payload) => ({ jsonrpc: '2.0', id: payload.id, result: {} })),
    close: vi.fn(async () => undefined) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(async () => { await closeAllMcpSessions(); mocks.open.mockReset(); });

describe('revalidateMcpSession', () => {
  it('keeps a healthy session without initialize or tool replay', async () => {
    const live = connection(); mocks.open.mockResolvedValue(live);
    const original = await getMcpSessionConnection(options);
    await revalidateMcpSession(options);
    expect(await getMcpSessionConnection(options)).toBe(original);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(live.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'ping' }), expect.any(String));
  });

  it('replaces a dead connection without waiting for remote close or replaying tools', async () => {
    const old = connection(); const fresh = connection();
    vi.mocked(old.request).mockRejectedValue(new Error('stream closed'));
    vi.mocked(old.close).mockReturnValue(new Promise(() => undefined));
    mocks.open.mockResolvedValueOnce(old).mockResolvedValueOnce(fresh);
    await getMcpSessionConnection(options);
    await revalidateMcpSession(options);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(getMcpSessionAvailability('server')).toBe('available');
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(fresh.request).not.toHaveBeenCalled();
  });

  it('coalesces simultaneous resume and online probes', async () => {
    const live = connection(); const ping = deferred<Awaited<ReturnType<McpSessionConnection['request']>>>();
    vi.mocked(live.request).mockReturnValue(ping.promise);
    mocks.open.mockResolvedValue(live);
    await getMcpSessionConnection(options);
    const first = revalidateMcpSession(options); const second = revalidateMcpSession(options);
    await vi.waitFor(() => expect(live.request).toHaveBeenCalledTimes(1));
    ping.resolve({ result: {} }); await Promise.all([first, second]);
  });

  it('leaves an active tool call alone', async () => {
    const live = connection(); const result = deferred<Awaited<ReturnType<McpSessionConnection['request']>>>();
    vi.mocked(live.request).mockReturnValue(result.promise); mocks.open.mockResolvedValue(live);
    const session = await getMcpSessionConnection(options);
    const tool = session.request({ jsonrpc: '2.0', id: 'tool', method: 'tools/call' }, 'Tool');
    await revalidateMcpSession(options);
    expect(live.request).toHaveBeenCalledTimes(1); expect(live.close).not.toHaveBeenCalled();
    result.resolve({ result: { content: [] } }); await tool;
  });

  it('does not let a late failed probe discard a replacement session', async () => {
    const old = connection(); const fresh = connection();
    const ping = deferred<Awaited<ReturnType<McpSessionConnection['request']>>>();
    vi.mocked(old.request).mockReturnValue(ping.promise);
    mocks.open.mockResolvedValueOnce(old).mockResolvedValueOnce(fresh);
    await getMcpSessionConnection(options);
    const recovery = revalidateMcpSession(options);
    await vi.waitFor(() => expect(old.request).toHaveBeenCalledTimes(1));
    invalidateMcpSession('server', 'unknown');
    const replacement = await getMcpSessionConnection(options);
    ping.reject(new Error('old stream closed')); await recovery;
    expect(await getMcpSessionConnection(options)).toBe(replacement);
    expect(fresh.close).not.toHaveBeenCalled();
  });

  it('keeps a failed reconnect retryable', async () => {
    const old = connection(); vi.mocked(old.request).mockRejectedValue(new Error('closed'));
    mocks.open.mockResolvedValueOnce(old).mockRejectedValueOnce(new Error('network unavailable'));
    await getMcpSessionConnection(options);
    await expect(revalidateMcpSession(options)).rejects.toThrow('network unavailable');
    expect(getMcpSessionAvailability('server')).toBe('unavailable');
    mocks.open.mockResolvedValueOnce(connection());
    await getMcpSessionConnection(options);
    expect(getMcpSessionAvailability('server')).toBe('available');
  });
});
