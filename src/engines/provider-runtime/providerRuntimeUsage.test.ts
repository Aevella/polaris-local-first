import { describe, expect, it } from 'vitest';
import { parseOpenAiCompatibleUsage } from './providerRuntimeUsage';

describe('parseOpenAiCompatibleUsage', () => {
  it('reads OpenRouter cache writes and reported zero reads from chat-completions usage', () => {
    expect(parseOpenAiCompatibleUsage({
      prompt_tokens: 4096,
      completion_tokens: 64,
      total_tokens: 4160,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 4096
      }
    })).toEqual({
      totalTokens: 4160,
      inputTokens: 4096,
      outputTokens: 64,
      cachedInputTokens: 0,
      cacheMissInputTokens: 4096,
      cacheCreationInputTokens: 4096
    });
  });

  it('reads cache usage from Responses input token details', () => {
    expect(parseOpenAiCompatibleUsage({
      input_tokens: 5000,
      output_tokens: 80,
      input_tokens_details: {
        cached_tokens: 4200,
        cache_write_tokens: 0
      }
    })).toEqual({
      inputTokens: 5000,
      outputTokens: 80,
      cachedInputTokens: 4200,
      cacheMissInputTokens: 800,
      cacheCreationInputTokens: 0
    });
  });
});
