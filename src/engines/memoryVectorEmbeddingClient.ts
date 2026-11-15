import { Capacitor } from '@capacitor/core';
import { buildApiEndpoint, buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import { isProviderEmbeddingRelayTarget } from './chat-api/providerEmbeddingRelayShared';
import type { ProviderProfile } from '../types/domain';

export type MemoryVectorEmbeddingRequest = {
  api: ProviderProfile;
  model: string;
  dimensions: number | null;
  inputs: string[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type RawEmbeddingItem = {
  embedding?: unknown;
  index?: unknown;
};

export type MemoryVectorEmbeddingErrorKind = 'aborted' | 'route' | 'batch-rejected' | 'input-rejected';

/**
 * A non-2xx answer from the embeddings endpoint. `status` lets callers decide
 * whether the whole run should stop (auth, quota, outage) or whether only the
 * inputs in this request were rejected, without parsing provider prose.
 */
export class MemoryVectorEmbeddingRequestError extends Error {
  readonly status: number;
  readonly body: string;
  readonly reason: string;

  constructor(status: number, body: string) {
    const reason = extractEmbeddingErrorReason(body);
    super(`embedding API ${status}: ${reason}`);
    this.name = 'MemoryVectorEmbeddingRequestError';
    this.status = status;
    this.body = body;
    this.reason = reason;
  }
}

function extractEmbeddingErrorReason(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return '响应为空';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { error?: unknown; message?: unknown };
      const nested = record.error && typeof record.error === 'object'
        ? record.error as { message?: unknown; code?: unknown }
        : null;
      const message = typeof nested?.message === 'string'
        ? nested.message
        : typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string'
            ? record.message
            : null;
      if (message) {
        const code = nested && (typeof nested.code === 'string' || typeof nested.code === 'number')
          ? `${nested.code} `
          : '';
        return `${code}${message}`.trim().slice(0, 180);
      }
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return trimmed.slice(0, 180);
}

const ROUTE_ERROR_STATUSES = new Set([401, 402, 403, 404, 407, 408, 429]);

const BATCH_REJECTED_PATTERNS = [
  'batch size',
  'input.contents',
  'too many inputs',
  'too many input'
];

const INPUT_REJECTED_PATTERNS = [
  'input length',
  'context length',
  'maximum context',
  'too many tokens',
  'too long',
  'token limit',
  '过长',
  '参数有误'
];

function isAbortLikeError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('已取消'));
}

/**
 * Sorts an embeddings failure into what the indexing runner should do next.
 * Route problems stop the run; batch or input rejections let the runner retry
 * smaller requests and skip only what the provider keeps refusing.
 */
export function classifyMemoryVectorEmbeddingError(error: unknown): MemoryVectorEmbeddingErrorKind {
  if (isAbortLikeError(error)) return 'aborted';

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const status = error instanceof MemoryVectorEmbeddingRequestError
    ? error.status
    : Number(/embedding api (\d{3})/.exec(message)?.[1]);
  // Transport/authentication failures take precedence over incidental words in
  // the provider's response (for example a rate-limit message about batch size).
  if (ROUTE_ERROR_STATUSES.has(status) || status >= 500) return 'route';
  if (BATCH_REJECTED_PATTERNS.some((pattern) => message.includes(pattern))) return 'batch-rejected';

  if (error instanceof MemoryVectorEmbeddingRequestError) {
    if (error.status >= 400) return 'input-rejected';
    return 'route';
  }

  if (INPUT_REJECTED_PATTERNS.some((pattern) => message.includes(pattern))) return 'input-rejected';

  const legacyStatus = /embedding api (\d{3})/.exec(message)?.[1];
  if (legacyStatus) {
    const status = Number(legacyStatus);
    if (status >= 400) return 'input-rejected';
  }
  return 'route';
}

function normalizeEmbeddingPath(path: string) {
  const trimmed = path.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/embeddings`;
  }
  if (lower.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/embeddings`;
  }
  if (lower.endsWith('/embeddings')) {
    return normalized;
  }
  return '/embeddings';
}

export function buildMemoryVectorEmbeddingEndpoint(api: ProviderProfile) {
  if (api.protocol !== 'openai-completions' && api.protocol !== 'openai-responses') {
    throw new Error('向量索引目前只支持 OpenAI 兼容的 embeddings 接口。');
  }
  return buildApiEndpoint(api.baseUrl, normalizeEmbeddingPath(api.path));
}

function shouldUseEmbeddingRelay(endpoint: string) {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
  if (!isProviderEmbeddingRelayTarget(endpoint)) return false;

  const currentOrigin = window.location?.origin;
  if (typeof currentOrigin !== 'string' || !currentOrigin) return false;

  try {
    return new URL(endpoint).origin !== currentOrigin;
  } catch {
    return false;
  }
}

function buildEmbeddingHeaders(api: ProviderProfile) {
  const apiKey = api.apiKey.trim();
  if (!apiKey) {
    throw new Error('请先在向量索引选择的线路里填写 API Key。');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

function normalizeInputs(inputs: string[]) {
  const normalized = inputs.map((input) => input.trim());
  if (normalized.some((input) => !input)) {
    throw new Error('embedding 输入里有空片段；调用方必须先剔除空片段，否则返回的向量会错位。');
  }
  return normalized;
}

function parseEmbeddingVector(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const vector = value.map((item) => Number(item));
  return vector.every((item) => Number.isFinite(item)) ? vector : null;
}

function parseEmbeddingResponse(data: unknown, expectedCount: number) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('embedding 响应不是 JSON 对象。');
  }

  const rawData = (data as { data?: unknown }).data;
  if (!Array.isArray(rawData)) {
    throw new Error('embedding 响应缺少 data 数组。');
  }

  const vectors: Array<number[] | undefined> = new Array(expectedCount);
  rawData.forEach((item, fallbackIndex) => {
    const rawItem = item as RawEmbeddingItem;
    const targetIndex = typeof rawItem.index === 'number' && Number.isInteger(rawItem.index)
      ? rawItem.index
      : fallbackIndex;
    const vector = parseEmbeddingVector(rawItem.embedding);
    if (!vector || targetIndex < 0 || targetIndex >= expectedCount) return;
    vectors[targetIndex] = vector;
  });

  for (let index = 0; index < expectedCount; index += 1) {
    if (!vectors[index]) {
      throw new Error('embedding 响应数量或向量内容不完整。');
    }
  }

  return vectors as number[][];
}

export async function requestMemoryVectorEmbeddings(params: MemoryVectorEmbeddingRequest) {
  const inputs = normalizeInputs(params.inputs);
  if (!inputs.length) return [];

  const endpoint = buildMemoryVectorEmbeddingEndpoint(params.api);
  const headers = buildEmbeddingHeaders(params.api);
  const body: Record<string, unknown> = {
    model: params.model,
    input: inputs
  };
  if (params.dimensions !== null) {
    body.dimensions = params.dimensions;
  }

  const useRelay = shouldUseEmbeddingRelay(endpoint);
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(
    useRelay ? buildInternalApiEndpoint('/api/provider-embeddings') : endpoint,
    {
      method: 'POST',
      headers: useRelay ? { 'Content-Type': 'application/json' } : headers,
      body: JSON.stringify(useRelay ? { endpoint, headers, body } : body),
      signal: params.signal
    }
  );

  if (!response.ok) {
    throw new MemoryVectorEmbeddingRequestError(response.status, await response.text());
  }

  return parseEmbeddingResponse(await response.json(), inputs.length);
}
