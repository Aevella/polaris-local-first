import { Capacitor } from '@capacitor/core';
import { buildInternalApiEndpoint } from './chatApiEndpoint';
import { readStreamingReply } from './chatApiResponse';
import { createStreamingReplyCollector } from './chatApiStreamingCollector';
import { recordStreamDebug } from './chatApiStreamDebug';
import type { AssistantReplyProgress, BuiltRequest } from './chatApiTypes';
import {
  ANTHROPIC_BROWSER_ACCESS_HEADER,
  shouldUseAnthropicBrowserDirectAccess
} from './providerRelay';
import type { ProviderProfile } from '../../types/domain';
import { resolveProviderRuntimeRequestAdapter } from '../provider-runtime/providerRuntimeAdapters';
import {
  canUseNativeProviderHttp,
  executeNativeProviderHttpRequest
} from '../../native/providerHttp';

function bodyHasTools(body: Record<string, unknown>) {
  const nestedBody = body.body;
  return (
    Array.isArray(body.tools)
    || (
      nestedBody !== null
      && typeof nestedBody === 'object'
      && !Array.isArray(nestedBody)
      && Array.isArray((nestedBody as Record<string, unknown>).tools)
    )
  );
}

export function requestBodyStreams(body: Record<string, unknown>) {
  const nestedBody = body.body;
  return (
    body.stream === true
    || (
      nestedBody !== null
      && typeof nestedBody === 'object'
      && !Array.isArray(nestedBody)
      && (nestedBody as Record<string, unknown>).stream === true
    )
  );
}

function isAbsoluteProviderEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint.trim());
}

export function resolveRequestTransportPath(params: {
  api: ProviderProfile;
  request: BuiltRequest;
  forceRelay?: boolean;
}) {
  const { api, request, forceRelay = false } = params;
  const nativePlatform = Capacitor.isNativePlatform();
  const nativeProviderTransport = nativePlatform && !forceRelay && isAbsoluteProviderEndpoint(request.endpoint);
  const shouldUseRelay = forceRelay;
  const requestedStreaming = requestBodyStreams(request.body);
  const endpoint = shouldUseRelay ? buildInternalApiEndpoint('/api/provider-relay') : request.endpoint;

  return {
    endpoint,
    nativePlatform,
    requestedStreaming,
    platform: Capacitor.getPlatform(),
    shouldUseRelay,
    path:
      nativeProviderTransport
        ? requestedStreaming
          ? 'native-stream' as const
          : 'native-non-stream' as const
        : nativePlatform
          ? 'native-internal-fetch' as const
          : requestedStreaming
            ? 'fetch-stream' as const
            : 'non-stream' as const
  };
}

function canAcceptPlainTextNonStreamResponse(contentType: string, request: BuiltRequest) {
  return contentType.includes('text/plain') && !bodyHasTools(request.body);
}

function readNonStreamingPayload(params: {
  text: string;
  contentType: string;
  request: BuiltRequest;
  fallbackModel: string;
  parseJsonReply: (data: unknown) => AssistantReplyProgress;
}) {
  let data: unknown;
  try {
    data = JSON.parse(params.text);
  } catch {
    const trimmed = params.text.trim();
    if (trimmed && canAcceptPlainTextNonStreamResponse(params.contentType.toLowerCase(), params.request)) {
      return {
        content: trimmed,
        model: params.fallbackModel,
        nativeToolCalls: [],
        usedNativeToolCalls: false,
        nativeToolCallCount: 0
      };
    }
    const preview = trimmed ? trimmed.slice(0, 180) : '空响应';
    throw new Error(`API 返回了无法解析的非 JSON 响应：${preview}`);
  }
  return params.parseJsonReply(data);
}

async function executeNativeBuiltRequest(params: {
  api: ProviderProfile;
  request: BuiltRequest;
  signal?: AbortSignal;
  onProgress?: (reply: AssistantReplyProgress) => void;
  onChunk?: () => void;
}) {
  if (!canUseNativeProviderHttp()) {
    throw new Error('当前 App 缺少原生模型网络桥，请更新 Polaris 后再试。');
  }

  const { api, request, signal, onProgress, onChunk } = params;
  const providerAdapter = resolveProviderRuntimeRequestAdapter(api);
  const requestedStreaming = requestBodyStreams(request.body);
  const collector = requestedStreaming
    ? createStreamingReplyCollector(
        api.model,
        onProgress,
        (payload) => providerAdapter.parseStreamEvents({ payload })
      )
    : null;
  const startedAt = Date.now();
  let status = 0;
  let contentType = '';
  let responseText = '';
  let responseLength = 0;
  let sawFirstChunk = false;

  recordStreamDebug('native-stream-start', {
    endpoint: request.endpoint.slice(0, 120),
    provider: request.provider,
    streaming: requestedStreaming
  });

  try {
    await executeNativeProviderHttpRequest({
      url: request.endpoint,
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal,
      onResponse: (response) => {
        status = response.status;
        contentType = response.contentType;
        recordStreamDebug('native-stream-headers', {
          status,
          contentType: contentType || 'unknown',
          eventStream: contentType.toLowerCase().includes('text/event-stream')
        });
      },
      onTextChunk: (chunk) => {
        responseLength += chunk.length;
        if (!requestedStreaming || status < 200 || status >= 300) {
          responseText += chunk;
        }
        if (!sawFirstChunk && chunk.trim()) {
          sawFirstChunk = true;
          recordStreamDebug('native-stream-first-chunk', {
            elapsedMs: Date.now() - startedAt,
            chunkLength: chunk.length
          });
        }
        if (status >= 200 && status < 300) {
          collector?.pushTextChunk(chunk, contentType.toLowerCase().includes('text/event-stream'));
        }
        onChunk?.();
      }
    });
  } catch (error) {
    recordStreamDebug('native-stream-error', {
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)
    });
    throw error;
  }

  recordStreamDebug('native-stream-finish', {
    elapsedMs: Date.now() - startedAt,
    status,
    firstChunkSeen: sawFirstChunk,
    totalLength: responseLength
  });

  if (status < 200 || status >= 300) {
    throw new Error(`API ${status}: ${responseText.slice(0, 180)}`);
  }

  if (collector) return collector.finish();

  const reply = readNonStreamingPayload({
    text: responseText,
    contentType,
    request,
    fallbackModel: api.model,
    parseJsonReply: (data) => providerAdapter.parseResponse({
      data,
      fallbackModel: api.model
    })
  });
  onProgress?.(reply);
  return reply;
}

function resolveDirectRequestHeaders(request: BuiltRequest) {
  if (!shouldUseAnthropicBrowserDirectAccess(request)) {
    return request.headers;
  }

  return {
    ...request.headers,
    [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true'
  };
}

export async function executeBuiltRequest(params: {
  api: ProviderProfile;
  request: BuiltRequest;
  forceRelay?: boolean;
  signal?: AbortSignal;
  onProgress?: (reply: AssistantReplyProgress) => void;
  onChunk?: () => void;
  rawProviderError?: boolean;
}) {
  const { api, request, forceRelay = false, signal, onProgress, onChunk } = params;
  if (!forceRelay && Capacitor.isNativePlatform() && isAbsoluteProviderEndpoint(request.endpoint)) {
    return await executeNativeBuiltRequest({ api, request, signal, onProgress, onChunk });
  }

  const shouldUseRelay = forceRelay;
  const endpoint = shouldUseRelay ? buildInternalApiEndpoint('/api/provider-relay') : request.endpoint;
  const headers = shouldUseRelay ? { 'Content-Type': 'application/json' } : resolveDirectRequestHeaders(request);
  const body = shouldUseRelay
    ? {
        endpoint: request.endpoint,
        headers: request.headers,
        body: request.body
      }
    : request.body;
  const requestForTransport = {
    ...request,
    endpoint,
    headers,
    body
  };
  const providerAdapter = resolveProviderRuntimeRequestAdapter(api);
  const streamEventParser = (payload: unknown) => providerAdapter.parseStreamEvents({ payload });

  const res = await fetch(requestForTransport.endpoint, {
    method: 'POST',
    headers: requestForTransport.headers,
    body: JSON.stringify(requestForTransport.body),
    signal
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 180)}`);
  }

  if (requestBodyStreams(request.body) && res.body) {
    return await readStreamingReply(res, api.model, onProgress, onChunk, streamEventParser);
  }

  const reply = readNonStreamingPayload({
    text: await res.text(),
    contentType: res.headers.get('content-type') ?? '',
    request: requestForTransport,
    fallbackModel: api.model,
    parseJsonReply: (data) => providerAdapter.parseResponse({
      data,
      fallbackModel: api.model
    })
  });
  onProgress?.(reply);
  return reply;
}
