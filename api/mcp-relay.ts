import { once } from 'node:events';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAllowedPolarisApiOrigin } from '../src/engines/server/corsOrigin.js';
import { McpRelayTargetError, relayMcpRequest, type McpRelayRequest } from '../server/mcpRelay.js';

type McpRelayRequestBody = {
  endpoint?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
};

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (isAllowedPolarisApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function parseBody(req: VercelRequest): McpRelayRequestBody {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
}

async function pipeBody(body: NodeReadableStream<Uint8Array>, res: VercelResponse) {
  const responseWithFlush = res as VercelResponse & { flushHeaders?: () => void };
  responseWithFlush.flushHeaders?.();
  const reader = body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (!res.write(Buffer.from(value))) await once(res, 'drain');
  }
  res.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed', type: 'invalid_request' } });
    return;
  }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin || !isAllowedPolarisApiOrigin(origin)) {
    res.status(403).json({ error: { message: 'MCP Web relay 拒绝了非 Polaris 页面请求。', type: 'forbidden_origin' } });
    return;
  }

  try {
    const payload = parseBody(req);
    const headers = payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
      ? Object.fromEntries(Object.entries(payload.headers as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    const relayRequest: McpRelayRequest = {
      endpoint: typeof payload.endpoint === 'string' ? payload.endpoint.trim() : '',
      method: typeof payload.method === 'string' ? payload.method : 'GET',
      headers,
      body: typeof payload.body === 'string' ? payload.body : null
    };
    const upstream = await relayMcpRequest(relayRequest);
    res.status(upstream.status);
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    for (const name of ['Content-Type', 'WWW-Authenticate', 'Mcp-Session-Id', 'Retry-After']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.body) {
      res.send(await upstream.text());
      return;
    }
    await pipeBody(upstream.body as NodeReadableStream<Uint8Array>, res);
  } catch (error) {
    if (res.headersSent || res.writableEnded) {
      res.end();
      return;
    }
    if (error instanceof McpRelayTargetError) {
      res.status(400).json({ error: { message: error.message, type: 'invalid_upstream' } });
      return;
    }
    res.status(502).json({ error: { message: 'MCP Web relay 请求失败。', type: 'relay_error' } });
  }
}
