import { Capacitor } from '@capacitor/core';
import { buildInternalApiEndpoint } from './chatApiEndpoint';
import {
  readStreamingReply,
  readStreamingReplyViaXhr,
  shouldUseNativeIosStreamingFallback
} from './chatApiResponse';
import type { AssistantReplyProgress, BuiltRequest } from './chatApiTypes';
import {
  ANTHROPIC_BROWSER_ACCESS_HEADER,
  shouldUseAnthropicBrowserDirectAccess
} from './providerRelay';
import type { ProviderProfile } from '../../types/domain';
import { resolveProviderRuntimeRequestAdapter } from '../provider-runtime/providerRuntimeAdapters';

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

export function resolveRequestTransportPath(params: {
  api: ProviderProfile;
  request: BuiltRequest;
  forceRelay?: boolean;
}) {
  const { api, request, forceRelay = false } = params;
  const shouldUseRelay = forceRelay;
  const shouldUseIosXhrFallback = shouldUseNativeIosStreamingFallback(request);
  const requestedStreaming = requestBodyStreams(request.body);
  const endpoint = shouldUseRelay ? buildInternalApiEndpoint('/api/provider-relay') : request.endpoint;

  return {
    endpoint,
    nativePlatform: Capacitor.isNativePlatform(),
    requestedStreaming,
    platform: Capacitor.getPlatform(),
    shouldUseIosXhrFallback,
    shouldUseRelay,
    path:
      requestedStreaming
        ? shouldUseIosXhrFallback
          ? 'ios-xhr-fallback' as const
          : 'fetch-stream' as const
        : 'non-stream' as const
  };
}

function canAcceptPlainTextNonStreamResponse(response: Response, request: BuiltRequest) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('text/plain') && !bodyHasTools(request.body);
}

async function readNonStreamingResponse(params: {
  response: Response;
  request: BuiltRequest;
  fallbackModel: string;
  parseJsonReply: (data: unknown) => AssistantReplyProgress;
}) {
  const text = await params.response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const trimmed = text.trim();
    if (trimmed && canAcceptPlainTextNonStreamResponse(params.response, params.request)) {
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
  const { api, request, forceRelay = false, signal, onProgress, onChunk, rawProviderError = false } = params;
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
  const shouldUseIosXhrFallback = shouldUseNativeIosStreamingFallback(request);
  const providerAdapter = resolveProviderRuntimeRequestAdapter(api);
  const streamEventParser = (payload: unknown) => providerAdapter.parseStreamEvents({ payload });

  if (shouldUseIosXhrFallback) {
    return await readStreamingReplyViaXhr({
      request: requestForTransport,
      fallbackModel: api.model,
      signal,
      onProgress,
      onChunk,
      rawProviderError,
      parseStreamEvents: streamEventParser
    });
  }

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

  const reply = await readNonStreamingResponse({
    response: res,
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
