import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../../types/domain';
import {
  clearProviderRuntimeModelLimitCache,
  resolveProviderRuntimeMaxOutputTokens
} from './providerRuntimeModelLimits';

function createProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'openrouter-anthropic-test',
    name: 'OpenRouter Anthropic',
    protocol: 'anthropic-messages',
    baseUrl: 'https://openrouter.ai/api/v1',
    path: '/messages',
    apiKey: 'sk-or-test',
    model: 'anthropic/claude-sonnet-4',
    capabilities: {
      images: true,
      streaming: false,
      thinking: false
    },
    ...overrides
  };
}

afterEach(() => {
  clearProviderRuntimeModelLimitCache();
  vi.unstubAllGlobals();
});

describe('resolveProviderRuntimeMaxOutputTokens', () => {
  it('reads and caches the selected OpenRouter model output ceiling', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 'anthropic/claude-sonnet-4',
        top_provider: {
          max_completion_tokens: 64_000
        }
      }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveProviderRuntimeMaxOutputTokens(createProvider())).resolves.toBe(64_000);
    await expect(resolveProviderRuntimeMaxOutputTokens(createProvider())).resolves.toBe(64_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not invent output ceilings for other Anthropic routes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveProviderRuntimeMaxOutputTokens(createProvider({
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-4-6'
    }))).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails before chat when OpenRouter omits the selected model ceiling', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'anthropic/claude-sonnet-4' }]
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveProviderRuntimeMaxOutputTokens(createProvider()))
      .rejects.toThrow('OpenRouter 没有返回 anthropic/claude-sonnet-4 的最大输出 token');
  });
});
