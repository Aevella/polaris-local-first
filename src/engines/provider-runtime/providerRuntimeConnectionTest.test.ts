import { describe, expect, it } from 'vitest';
import type { ProviderHttpRequest } from './providerRuntimeTypes';
import { setConnectionTestOutputTokenField } from './providerRuntimeConnectionTest';

describe('setConnectionTestOutputTokenField', () => {
  it('removes every reasoning control from the low-cost connectivity probe', () => {
    const request = {
      endpoint: 'https://api.anthropic.com/v1/messages',
      headers: {},
      body: {
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' }
      },
      provider: 'anthropic-messages',
      compatibilityMode: 'standard'
    } satisfies ProviderHttpRequest;

    setConnectionTestOutputTokenField(request, 'max_tokens', 32);

    expect(request.body).toEqual({ max_tokens: 32 });
  });
});
