import { describe, expect, it } from 'vitest';
import { resolveOpenRouterSessionId } from './providerRuntimeOpenRouterSession';

describe('resolveOpenRouterSessionId', () => {
  it('uses a trimmed conversation id only for OpenRouter', () => {
    expect(resolveOpenRouterSessionId('https://openrouter.ai/api/v1', ' conversation-1 '))
      .toBe('conversation-1');
    expect(resolveOpenRouterSessionId('https://relay.example.com/v1', 'conversation-1'))
      .toBeUndefined();
  });

  it('does not send an empty session id', () => {
    expect(resolveOpenRouterSessionId('https://openrouter.ai/api/v1', ''))
      .toBeUndefined();
  });
});
