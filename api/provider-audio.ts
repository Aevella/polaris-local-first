import { once } from 'node:events';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  isProviderAudioRelayRequestBody
} from '../src/engines/chat-api/providerAudioRelayShared.js';
import { hasProviderRelayAuthHeader, sanitizeProviderRelayHeaders } from '../src/engines/chat-api/providerRelay.js';
import { isAllowedPolarisApiOrigin } from '../src/engines/server/corsOrigin.js';
import {
  ProviderAudioRelayTargetError,
  validateProviderAudioRelayTarget
} from '../server/providerAudioRelayTarget.js';

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (isAllowedPolarisApiOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

type AudioRelayRequestBody = {
  endpoint?: unknown;
  headers?: unknown;
  body?: unknown;
};

function parseRelayBody(req: VercelRequest): AudioRelayRequestBody {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
}

function sendAudioFailure(res: VercelResponse, error: unknown) {
  if (res.headersSent || res.writableEnded) {
    res.end();
    return;
  }
  if (error instanceof ProviderAudioRelayTargetError) {
    res.status(400).json({ error: { message: error.message, type: 'invalid_upstream' } });
    return;
  }
  res.status(502).json({ error: { message: '语音 relay 请求失败。', type: 'relay_error' } });
}

async function pipeUpstreamBody(body: NodeReadableStream<Uint8Array>, res: VercelResponse) {
  const responseWithFlush = res as VercelResponse & { flushHeaders?: () => void };
  responseWithFlush.flushHeaders?.();

  const reader = body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    if (!res.write(Buffer.from(value))) {
      await once(res, 'drain');
    }
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

  try {
    const payload = parseRelayBody(req);
    const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : '';
    await validateProviderAudioRelayTarget(endpoint);

    if (!isProviderAudioRelayRequestBody(payload.body)) {
      res.status(400).json({
        error: {
          message: '语音 relay 请求体必须是受支持的语音生成或音色管理请求。',
          type: 'invalid_request'
        }
      });
      return;
    }

    const relayHeaders = sanitizeProviderRelayHeaders(
      payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
        ? Object.fromEntries(
            Object.entries(payload.headers as Record<string, unknown>).map(([key, value]) => [key, String(value)])
          )
        : {}
    );
    if (!hasProviderRelayAuthHeader(relayHeaders)) {
      res.status(400).json({
        error: {
          message: '语音 relay 请求缺少上游认证头。',
          type: 'missing_upstream_auth'
        }
      });
      return;
    }

    const upstreamResponse = await fetch(endpoint, {
      method: 'POST',
      headers: relayHeaders,
      body: JSON.stringify(payload.body)
    });

    res.status(upstreamResponse.status);
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    if (!upstreamResponse.body) {
      res.send(await upstreamResponse.arrayBuffer());
      return;
    }

    await pipeUpstreamBody(upstreamResponse.body as NodeReadableStream<Uint8Array>, res);
  } catch (error) {
    sendAudioFailure(res, error);
  }
}
