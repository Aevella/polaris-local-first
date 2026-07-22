import type { ChatTokenUsage } from '../../types/domain';

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function compactTokenUsage(usage: ChatTokenUsage): ChatTokenUsage | undefined {
  const compacted = Object.fromEntries(
    Object.entries(usage).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  ) as ChatTokenUsage;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export function parseOpenAiCompatibleUsage(rawUsage: unknown): ChatTokenUsage | undefined {
  const usage = readObject(rawUsage);
  if (!usage) return undefined;

  const promptDetails = readObject(usage.prompt_tokens_details);
  const completionDetails = readObject(usage.completion_tokens_details);
  const inputDetails = readObject(usage.input_tokens_details);
  const outputDetails = readObject(usage.output_tokens_details);
  const inputTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.input_tokens);
  const cachedInputTokens =
    readNumber(usage.prompt_cache_hit_tokens)
    ?? readNumber(usage.cache_read_input_tokens)
    ?? readNumber(promptDetails?.cached_tokens)
    ?? readNumber(inputDetails?.cached_tokens);
  const explicitCacheMissInputTokens =
    readNumber(usage.prompt_cache_miss_tokens)
    ?? readNumber(usage.cache_miss_input_tokens);
  const cacheCreationInputTokens =
    readNumber(usage.prompt_cache_creation_tokens)
    ?? readNumber(usage.cache_creation_input_tokens)
    ?? readNumber(promptDetails?.cache_write_tokens)
    ?? readNumber(inputDetails?.cache_write_tokens);
  const cacheMissInputTokens =
    explicitCacheMissInputTokens
    ?? (
      typeof inputTokens === 'number' && typeof cachedInputTokens === 'number'
        ? Math.max(inputTokens - cachedInputTokens, 0)
        : undefined
    );

  return compactTokenUsage({
    totalTokens: readNumber(usage.total_tokens),
    inputTokens,
    outputTokens: readNumber(usage.completion_tokens) ?? readNumber(usage.output_tokens),
    cachedInputTokens,
    cacheMissInputTokens,
    cacheCreationInputTokens,
    reasoningTokens: readNumber(completionDetails?.reasoning_tokens) ?? readNumber(outputDetails?.reasoning_tokens)
  });
}
