import { describe, expect, it } from 'vitest';
import {
  resolveCanonicalProviderCapabilities,
  resolveRuntimeProviderProfile
} from './providerRuntimeCapabilities';
import { resolveProviderRuntimeRequestAdapter } from './providerRuntimeAdapters';
import {
  createProviderRuntimeAdvanced,
  createProviderRuntimeCharacterizationFixtures,
  createProviderRuntimeTestProvider
} from './providerRuntimeFixtures';
import { resolveProviderCapability } from './providerCapability';

describe('resolveProviderCapability', () => {
  it('keeps the legacy canonical capability entrypoint behavior-compatible with adapters', () => {
    for (const fixture of createProviderRuntimeCharacterizationFixtures()) {
      const runtimeProvider = resolveRuntimeProviderProfile(fixture.provider, fixture.advanced);
      const adapterCapabilities = resolveProviderRuntimeRequestAdapter(runtimeProvider).resolveCapabilities({
        provider: runtimeProvider,
        advanced: fixture.advanced
      });

      expect(resolveCanonicalProviderCapabilities(fixture.provider, fixture.advanced), fixture.id)
        .toEqual(adapterCapabilities);
    }
  });

  it('resolves built-in Polaris as a gateway route with the Mimo-style output token field', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: '/api',
      path: '/chat/completions',
      apiKey: 'polaris-public-free',
      model: 'Polaris',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    }));

    expect(capability.route).toEqual(expect.objectContaining({
      protocol: 'openai-completions',
      kind: 'gateway',
      isBuiltInTrial: true
    }));
    expect(capability.transport.modes).toContain('built-in-gateway');
    expect(capability.budgets.outputTokenField).toBe('max_completion_tokens');
    expect(capability.auth.scheme).toBe('bearer');
  });

  it('exposes provider route labels as i18n keys instead of display copy', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.openai.com/v1',
      path: '/responses',
      protocol: 'openai-responses',
      model: 'gpt-5-mini'
    }));

    expect(capability.route).toEqual(expect.objectContaining({
      labelKey: 'provider.route.openAI',
      protocolLabelKey: 'provider.protocol.openaiResponses'
    }));
  });

  it('keeps DeepSeek thinking and tool-choice quirks in the provider capability contract', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
      capabilities: {
        images: false,
        streaming: true,
        thinking: true
      }
    }));

    expect(capability.tools.choiceControl).toBe('none');
    expect(capability.thinking).toEqual({
      sendBudget: false,
      effortMapping: 'none'
    });
    expect(capability.output.reasoning).toEqual({
      mode: 'text',
      transport: 'openai-reasoning-content',
      replay: 'omit-empty'
    });
    expect(capability.context.deferVolatileSystemMessages).toBe(true);
    expect(capability.context.omitVolatileSystemMessages).toBe(true);
  });

  it('defers volatile system messages for automatic cache providers without omitting them', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions',
      model: 'gpt-5-mini',
      capabilities: {
        images: true,
        streaming: true,
        thinking: false
      }
    }));

    expect(capability.cache.mode).toBe('automatic-or-unknown');
    expect(capability.context.deferVolatileSystemMessages).toBe(true);
    expect(capability.context.omitVolatileSystemMessages).toBe(false);
  });

  it('uses portable explicit cache controls without top-level auto caching for OpenRouter Claude', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      path: '/chat/completions',
      model: 'anthropic/claude-4.6-sonnet-20260217',
      capabilities: {
        images: true,
        streaming: true,
        thinking: false
      }
    }));

    expect(capability.cache).toEqual({
      mode: 'explicit-cache-control',
      promptCaching: true,
      openAiCompatibleCacheControl: true,
      sendsTopLevelCacheControl: false,
      automaticMessageHistoryCache: false
    });
    expect(capability.context.deferVolatileSystemMessages).toBe(true);
  });

  it('respects explicit image capability for official DeepSeek routes', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      capabilities: {
        images: true,
        streaming: true,
        thinking: true
      }
    }));

    expect(capability.input.images).toBe('data-url');
  });

  it('keeps model-specific request policy separate from user-owned image capability', () => {
    const provider = createProviderRuntimeTestProvider({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2-pro',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    });

    expect(resolveProviderCapability(provider, createProviderRuntimeAdvanced({
      modelOverride: 'mimo-v2-omni'
    })).input.images).toBe('none');

    const proCapability = resolveProviderCapability(provider, createProviderRuntimeAdvanced({
      modelOverride: 'mimo-v2.5-pro'
    }));
    expect(proCapability.input.images).toBe('none');
    expect(proCapability.budgets.outputTokenField).toBe('max_completion_tokens');
    expect(proCapability.promptInjections).toEqual([{
      name: 'model_runtime_context',
      requiresExecutionTarget: true
    }]);
  });

  it('allows any configured route to declare image capability without a model allowlist', () => {
    expect(resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2-pro',
      capabilities: {
        images: true,
        streaming: true,
        thinking: false
      }
    })).input.images).toBe('data-url');
  });

  it('does not turn image capability on from a recognized model name', () => {
    expect(resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2-omni',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    })).input.images).toBe('none');
  });

  it('centralizes SiliconFlow Kimi execution and streaming policy', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'moonshotai/Kimi-K2-Instruct',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    }));

    expect(capability.route.isMirrorAggregator).toBe(true);
    expect(capability.streaming.disableWhenToolsPresent).toBe(true);
    expect(capability.execution).toEqual(expect.objectContaining({
      maxAttempts: 2,
      streamIdleTimeoutMs: 45_000,
      connectionTestTimeoutMs: 90_000
    }));
  });

  it('keeps sampling and thinking-budget policy for Moonshot Kimi routes', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6',
      capabilities: {
        images: true,
        streaming: true,
        thinking: true
      }
    }));

    expect(capability.sampling.sendTemperature).toBe(false);
    expect(capability.thinking.sendBudget).toBe(false);
  });

  it('folds route policy into concrete capability fields without exposing requestPolicy', () => {
    const opencode = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'gpt-fixture'
    }));
    const packyClaude = resolveProviderCapability(createProviderRuntimeTestProvider({
      protocol: 'anthropic-messages',
      baseUrl: 'https://www.packyapi.com/v1',
      path: '/messages',
      model: 'claude-opus-4-6',
      capabilities: {
        images: true,
        streaming: true,
        thinking: true
      }
    }));

    expect(opencode.sampling.omitTopPWhenOne).toBe(true);
    expect(opencode.auth).not.toHaveProperty('requestPolicy');
    expect(packyClaude.auth).toEqual({ scheme: 'authorization-bearer-with-anthropic-version' });
    expect(packyClaude.cache.mode).toBe('explicit-cache-control');
    expect(packyClaude.output.reasoning.mode).toBe('text');
  });

  it('declares Gemini native capability shape without leaking provider checks upward', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      protocol: 'gemini-generate-content',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      path: '/models/{model}:generateContent',
      model: 'gemini-2.5-flash',
      capabilities: {
        images: true,
        streaming: false,
        thinking: true
      }
    }));

    expect(capability.input.images).toBe('model-dependent');
    expect(capability.output.reasoning).toEqual({
      mode: 'signature-required',
      transport: 'native',
      replay: 'omit'
    });
    expect(capability.auth.scheme).toBe('x-goog-api-key');
  });

  it('describes external Gemini routes without transport retry policy', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      protocol: 'gemini-generate-content',
      baseUrl: 'https://provider.example.com/v1',
      path: '/models/{model}:generateContent',
      model: 'gemini-3.1-pro-preview',
      capabilities: {
        images: true,
        streaming: false,
        thinking: true
      }
    }));

    expect(capability.transport.modes).toEqual(['direct', 'browser-relay', 'native-direct']);
  });

  it('keeps built-in gateway routes off native relay fallback', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: '/api',
      path: '/chat/completions',
      apiKey: 'polaris-public-free',
      model: 'Polaris'
    }));

    expect(capability.transport.modes).toContain('built-in-gateway');
  });

  it('marks mirror aggregators as route capability instead of model-tier call-site knowledge', () => {
    const openRouter = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-oss-120b:free'
    }));

    expect(openRouter.route.isMirrorAggregator).toBe(true);
  });

  it('collapses system messages for SenseNova-compatible chat routes', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://token.sensenova.cn/v1',
      path: '/chat/completions',
      model: 'sensenova-6.7-flash-lite',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    }));

    expect(capability.context.collapseSystemMessages).toBe(true);
  });

  it('collapses system messages for MiniMax OpenAI-compatible chat routes', () => {
    const officialCapability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.minimax.io/v1',
      path: '/chat/completions',
      model: 'MiniMax-M2.5-highspeed',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    }));
    const routedModelCapability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://api.example.com/v1',
      path: '/chat/completions',
      model: 'minimax/minimax-m2.5-highspeed',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    }));

    expect(officialCapability.context.collapseSystemMessages).toBe(true);
    expect(routedModelCapability.context.collapseSystemMessages).toBe(true);
  });
});
