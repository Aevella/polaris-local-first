import { describe, expect, it } from 'vitest';
import {
  extractProviderReasoningText,
  mergeProviderReasoningState,
  normalizeProviderReasoningItems,
  reasoningItemsForReplay
} from './providerRuntimeReasoningState';

describe('provider reasoning state', () => {
  it('normalizes documented OpenRouter reasoning details and extracts visible text', () => {
    const items = normalizeProviderReasoningItems([
      { type: 'reasoning.text', text: '先检查', signature: 'sig', index: 0 },
      { type: 'reasoning.encrypted', data: 'cipher', index: 1 },
      { nope: true }
    ]);

    expect(extractProviderReasoningText(items)).toBe('先检查');
    expect(reasoningItemsForReplay({ protocol: 'openai-completions', items })).toEqual([
      { type: 'reasoning.text', text: '先检查', signature: 'sig' },
      { type: 'reasoning.encrypted', data: 'cipher' }
    ]);
  });

  it('merges streamed reasoning fragments by provider index', () => {
    const first = mergeProviderReasoningState(undefined, {
      protocol: 'anthropic-messages',
      items: [{ type: 'thinking', index: 0, thinking: '先' }]
    });
    const second = mergeProviderReasoningState(first, {
      protocol: 'anthropic-messages',
      items: [{ type: 'thinking', index: 0, thinking: '想', signature: 'sig' }]
    });

    expect(second.items).toEqual([{ type: 'thinking', index: 0, thinking: '先想', signature: 'sig' }]);
  });
});
