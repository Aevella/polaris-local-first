import { afterEach, describe, it, expect, vi } from 'vitest';
import { openLegacySseSession } from './legacySse';
import type { McpTransportOptions } from './types';

function fixture(sendEndpoint = true) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const event = (name: string, data: unknown) => stream.enqueue(new TextEncoder().encode(
    `event: ${name}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
  ));
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'GET') {
      const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
      if (sendEndpoint) event('endpoint', '/messages');
      init.signal?.addEventListener('abort', () => { try { stream.error(new Error('aborted')); } catch {} });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const payload = JSON.parse(String(init?.body));
    if (payload.method === 'initialize') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id,
        result: { protocolVersion: '2025-03-26' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(null, { status: 202 });
  });
  const options: McpTransportOptions = {
    server: { id: 'sse', handle: 'sse', name: 'SSE', description: '', transport: 'sse',
      url: 'https://example.com/sse', headers: [], isActive: true },
    timeoutMs: 120000, fetchImpl
  };
  return { options, event, end: () => stream.close() };
}

afterEach(() => vi.useRealTimers());

describe('openLegacySseSession', () => {
  it('allows an idle channel followed by a 90-second call with a 120-second timeout', async () => {
    vi.useFakeTimers();
    const f = fixture(); const session = await openLegacySseSession(f.options);
    await vi.advanceTimersByTimeAsync(180000);
    const response = session.request({ jsonrpc: '2.0', id: 'wait', method: 'tools/call' }, 'Wait');
    await vi.advanceTimersByTimeAsync(90000);
    f.event('message', { jsonrpc: '2.0', id: 'wait', result: { content: [{ type: 'text', text: 'done' }] } });
    await expect(response).resolves.toMatchObject({ result: { content: [{ text: 'done', type: 'text' }] } });
    await session.close();
  });

  it('still times out a tool that does not respond within the configured 120 seconds', async () => {
    vi.useFakeTimers();
    const f = fixture(); const session = await openLegacySseSession(f.options);
    const response = session.request({ jsonrpc: '2.0', id: 'wait', method: 'tools/call' }, 'Wait');
    const check = expect(response).rejects.toThrow('超时（120 秒）');
    await vi.advanceTimersByTimeAsync(120000); await check;
    await session.close();
  });

  it('reports graceful EOF to a pending call instead of waiting for its timeout', async () => {
    const f = fixture(); const session = await openLegacySseSession(f.options);
    const response = session.request({ jsonrpc: '2.0', id: 'wait', method: 'tools/call' }, 'Wait');
    const check = expect(response).rejects.toThrow('连接已结束');
    f.end(); await check; await session.close();
  });

  it('rejects a stream that ends before admission and aborts its transport', async () => {
    const f = fixture(false);
    const opening = openLegacySseSession(f.options);
    const check = expect(opening).rejects.toThrow('连接已结束');
    f.end(); await check;
    expect(f.options.fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.options.fetchImpl!).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
