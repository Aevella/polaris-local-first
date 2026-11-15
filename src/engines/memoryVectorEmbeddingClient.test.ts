import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../types/domain';
import {
  MemoryVectorEmbeddingRequestError,
  buildMemoryVectorEmbeddingEndpoint,
  classifyMemoryVectorEmbeddingError,
  requestMemoryVectorEmbeddings
} from './memoryVectorEmbeddingClient';

const nativePlatform = vi.hoisted(() => ({ value: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativePlatform.value
  }
}));

const provider: ProviderProfile = {
  id: 'provider-a',
  name: 'Provider A',
  protocol: 'openai-completions',
  baseUrl: 'https://api.example.test/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'chat-model',
  capabilities: {
    images: false,
    streaming: false,
    thinking: false
  }
};

describe('memoryVectorEmbeddingClient', () => {
  beforeEach(() => {
    nativePlatform.value = true;
    vi.unstubAllGlobals();
  });

  it('derives OpenAI-compatible embeddings endpoints from chat or responses paths', () => {
    expect(buildMemoryVectorEmbeddingEndpoint(provider)).toBe('https://api.example.test/v1/embeddings');
    expect(buildMemoryVectorEmbeddingEndpoint({
      ...provider,
      protocol: 'openai-responses',
      path: '/responses'
    })).toBe('https://api.example.test/v1/embeddings');
    expect(() => buildMemoryVectorEmbeddingEndpoint({
      ...provider,
      protocol: 'anthropic-messages',
      path: '/messages'
    })).toThrow('OpenAI 兼容');
  });

  it('requests embeddings directly on native and preserves input order by response index', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { index: 1, embedding: [0, 1, 0] },
        { index: 0, embedding: [1, 0, 0] }
      ]
    }), { status: 200 }));

    const vectors = await requestMemoryVectorEmbeddings({
      api: provider,
      model: 'text-embedding-3-small',
      dimensions: 3,
      inputs: ['第一段', '第二段'],
      fetchImpl: fetchImpl as never
    });

    expect(vectors).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-test'
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: ['第一段', '第二段'],
          dimensions: 3
        })
      })
    );
  });

  it('uses the dedicated embedding relay for cross-origin browser requests', async () => {
    nativePlatform.value = false;
    vi.stubGlobal('window', {
      location: { origin: 'https://polaris.example.test' }
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1, 0, 0] }]
    }), { status: 200 }));

    await requestMemoryVectorEmbeddings({
      api: provider,
      model: 'text-embedding-3-small',
      dimensions: null,
      inputs: ['语义文本'],
      fetchImpl: fetchImpl as never
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://polaris.example.test/api/provider-embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const relayCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(relayCall[1].body));
    expect(body).toMatchObject({
      endpoint: 'https://api.example.test/v1/embeddings',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test'
      },
      body: {
        model: 'text-embedding-3-small',
        input: ['语义文本']
      }
    });
  });

  it('rejects incomplete embedding responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1, 0, 0] }]
    }), { status: 200 }));

    await expect(requestMemoryVectorEmbeddings({
      api: provider,
      model: 'text-embedding-3-small',
      dimensions: null,
      inputs: ['one', 'two'],
      fetchImpl: fetchImpl as never
    })).rejects.toThrow('不完整');
  });

  it('turns a non-2xx answer into a typed error that keeps the status and the provider reason', async () => {
    const zhipuBody = JSON.stringify({
      error: { code: '1210', message: 'API 调用参数有误，请检查文档。' }
    });
    const fetchImpl = vi.fn(async () => new Response(zhipuBody, { status: 400 }));

    const error = await requestMemoryVectorEmbeddings({
      api: provider,
      model: 'embedding-3',
      dimensions: null,
      inputs: ['很长的一段'],
      fetchImpl: fetchImpl as never
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MemoryVectorEmbeddingRequestError);
    expect(error).toMatchObject({
      status: 400,
      reason: '1210 API 调用参数有误，请检查文档。',
      message: 'embedding API 400: 1210 API 调用参数有误，请检查文档。'
    });
  });

  it('classifies embedding failures by status instead of provider wording', () => {
    const typed = (status: number, body = '{}') => new MemoryVectorEmbeddingRequestError(status, body);
    const abort = new Error('aborted');
    abort.name = 'AbortError';

    expect(classifyMemoryVectorEmbeddingError(typed(400, '{"error":{"code":"1210","message":"API 调用参数有误，请检查文档。"}}'))).toBe('input-rejected');
    expect(classifyMemoryVectorEmbeddingError(typed(413))).toBe('input-rejected');
    expect(classifyMemoryVectorEmbeddingError(typed(422))).toBe('input-rejected');
    expect(classifyMemoryVectorEmbeddingError(typed(401))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(404))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(429))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(503))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(429, 'batch size rate limit'))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(503, 'input.contents unavailable'))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(new Error('embedding API 401: input too long'))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(new Error('embedding API 429: batch size limit'))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(typed(400, 'batch size is invalid, it should not be larger than 1.: input.contents'))).toBe('batch-rejected');
    expect(classifyMemoryVectorEmbeddingError(abort)).toBe('aborted');
    expect(classifyMemoryVectorEmbeddingError(new Error('embedding API 400: Range of input length should be less than 8192'))).toBe('input-rejected');
    expect(classifyMemoryVectorEmbeddingError(new Error('embedding API 401: invalid api key'))).toBe('route');
    expect(classifyMemoryVectorEmbeddingError(new TypeError('Failed to fetch'))).toBe('route');
  });

  it('refuses empty inputs instead of silently dropping them and misaligning vectors', async () => {
    const fetchImpl = vi.fn();

    await expect(requestMemoryVectorEmbeddings({
      api: provider,
      model: 'text-embedding-3-small',
      dimensions: null,
      inputs: ['first', '   '],
      fetchImpl: fetchImpl as never
    })).rejects.toThrow('空片段');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
