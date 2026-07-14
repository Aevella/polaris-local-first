import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildProviderModelListEndpoint,
  discoverProviderModels,
  normalizeProviderModelList
} from './providerModelDiscovery';
import type { ProviderProfile } from '../types/domain';

function createProvider(patch: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-test',
    name: 'Test',
    protocol: 'openai-completions',
    baseUrl: 'https://api.example.com/v1',
    path: '/chat/completions',
    apiKey: 'sk-test',
    model: 'test-model',
    capabilities: {
      images: false,
      streaming: true,
      thinking: false
    },
    ...patch
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildProviderModelListEndpoint', () => {
  it('uses the provider base URL as the owner of model-list routing', () => {
    expect(buildProviderModelListEndpoint(createProvider())).toBe('https://api.example.com/v1/models');
    expect(buildProviderModelListEndpoint(createProvider({
      baseUrl: 'https://opencode.ai/zen/v1'
    }))).toBe('https://opencode.ai/zen/v1/models');
  });

  it('does not discover models for internal Polaris gateway routes', async () => {
    const result = await discoverProviderModels({
      api: createProvider({
        baseUrl: '/api/mimo',
        apiKey: 'polaris-mimo-invite'
      })
    });

    expect(result).toEqual({
      ok: false,
      error: '当前线路不是公开供应商 Base URL。'
    });
  });
});

describe('normalizeProviderModelList', () => {
  it('normalizes OpenAI-compatible model lists without guessing capabilities', () => {
    expect(normalizeProviderModelList(createProvider(), {
      data: [
        { id: 'gpt-5.2', owned_by: 'openai' },
        { id: 'gpt-5.2', owned_by: 'openai' },
        { id: 'custom-model' }
      ]
    })).toEqual([
      { id: 'gpt-5.2', ownedBy: 'openai' },
      { id: 'custom-model', ownedBy: undefined }
    ]);
  });

  it('normalizes Anthropic model lists from their own response shape', () => {
    expect(normalizeProviderModelList(createProvider({
      protocol: 'anthropic-messages',
      path: '/messages'
    }), {
      data: [
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }
      ]
    })).toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }
    ]);
  });

  it('normalizes Gemini model names and keeps only generateContent-capable models', () => {
    expect(normalizeProviderModelList(createProvider({
      protocol: 'gemini-generate-content',
      path: '/models/{model}:generateContent'
    }), {
      models: [
        {
          name: 'models/gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          supportedGenerationMethods: ['generateContent']
        },
        {
          name: 'models/text-embedding-004',
          supportedGenerationMethods: ['embedContent']
        }
      ]
    })).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
    ]);
  });
});

describe('discoverProviderModels', () => {
  it('uses direct GET outside the browser relay path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'gpt-5-mini' }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverProviderModels({ api: createProvider() });

    expect(result).toEqual({
      ok: true,
      models: [{ id: 'gpt-5-mini', ownedBy: undefined }],
      source: 'live'
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/models', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer sk-test'
      })
    }));
  });

  it('falls back to the configured model-list relay only after direct browser transport fails', async () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://selfhost.example.test'
      }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://api.example.com/v1/models') {
        throw new TypeError('Failed to fetch');
      }
      return new Response(JSON.stringify({
        data: [{ id: 'relay-model' }]
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverProviderModels({ api: createProvider() });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://selfhost.example.test/api/provider-models');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: 'https://api.example.com/v1/models',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer sk-test'
      }
    });
  });

  it('adds Anthropic browser direct access opt-in to official model-list headers', async () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://selfhost.example.test'
      }
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discoverProviderModels({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4-6'
      })
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-test'
    });
  });
});
