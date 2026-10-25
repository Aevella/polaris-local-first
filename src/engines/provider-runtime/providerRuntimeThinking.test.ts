import { describe, expect, it } from 'vitest';
import { createProviderRuntimeTestProvider } from './providerRuntimeFixtures';
import { resolveProviderCapability } from './providerCapability';
import { buildProviderThinkingRequest, resolveProviderReasoningEffort } from './providerRuntimeThinking';

describe('resolveProviderReasoningEffort', () => {
  it('maps numeric budgets to provider effort bands', () => {
    expect(resolveProviderReasoningEffort(1024)).toBe('low');
    expect(resolveProviderReasoningEffort(4096)).toBe('medium');
    expect(resolveProviderReasoningEffort(4097)).toBe('high');
  });
});

describe('buildProviderThinkingRequest', () => {
  it('uses adaptive thinking for current native Claude models', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      path: '/messages',
      model: 'claude-sonnet-4-6',
      capabilities: { images: true, streaming: true, thinking: true }
    }));

    expect(buildProviderThinkingRequest(capability, 4096)).toEqual({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' }
    });
  });

  it('uses OpenRouter unified reasoning instead of a vendor-specific thinking field', () => {
    const capability = resolveProviderCapability(createProviderRuntimeTestProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      path: '/chat/completions',
      model: 'anthropic/claude-sonnet-4.6',
      capabilities: { images: true, streaming: true, thinking: true }
    }));

    expect(buildProviderThinkingRequest(capability, 8192)).toEqual({
      reasoning: { max_tokens: 8192, exclude: false }
    });
  });
});
