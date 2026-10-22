import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { McpServerConfig } from '../../types/domain';
import type { McpTransportOptions } from './types';

export function getMcpFetchImpl(fetchImpl?: typeof fetch) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error('当前环境没有 fetch，无法连接 MCP。');
  }
  return resolved;
}

function shouldUseNativeMcpHttp(url: string, options: McpTransportOptions) {
  if (options.fetchImpl || !Capacitor.isNativePlatform()) {
    return false;
  }
  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') {
    return false;
  }

  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function serializeNativeHttpBody(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function createResponseFromNativeHttp(
  result: Awaited<ReturnType<typeof CapacitorHttp.request>>
) {
  return new Response(serializeNativeHttpBody(result.data), {
    status: result.status,
    headers: result.headers
  });
}

export async function requestMcpHttp(
  url: string,
  init: RequestInit,
  options: McpTransportOptions
) {
  if (!shouldUseNativeMcpHttp(url, options)) {
    const fetchImpl = getMcpFetchImpl(options.fetchImpl);
    return await fetchImpl(url, init);
  }

  const headers = new Headers(init.headers ?? undefined);
  const body = init.body;
  const nativeResponse = await CapacitorHttp.request({
    url,
    method: init.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    data: typeof body === 'string' ? body : body ? String(body) : undefined,
    responseType: 'text',
    connectTimeout: options.timeoutMs,
    readTimeout: options.timeoutMs
  });

  return createResponseFromNativeHttp(nativeResponse);
}

export function buildMcpServerHeaders(
  server: McpServerConfig,
  extraHeaders?: Record<string, string>
) {
  const headers = new Headers();
  headers.set('Accept', 'application/json, text/event-stream');

  for (const header of server.headers) {
    const key = header.key.trim();
    if (!key) continue;
    headers.set(key, header.value);
  }

  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(key, value);
  }

  return headers;
}
