import { describe, expect, it } from 'vitest';
import {
  conversationReasoningBudget,
  normalizeConversationReasoningStrength
} from './conversationReasoning';

describe('normalizeConversationReasoningStrength', () => {
  it('keeps supported strengths and falls back to automatic for legacy or invalid values', () => {
    expect(normalizeConversationReasoningStrength('extreme')).toBe('extreme');
    expect(normalizeConversationReasoningStrength('custom')).toBe('automatic');
    expect(normalizeConversationReasoningStrength(undefined)).toBe('automatic');
  });
});

describe('conversationReasoningBudget', () => {
  it('uses the same stable strength budgets as the conversation picker', () => {
    expect(conversationReasoningBudget('off')).toBe(0);
    expect(conversationReasoningBudget('light')).toBe(512);
    expect(conversationReasoningBudget('medium')).toBe(2_048);
    expect(conversationReasoningBudget('high')).toBe(8_192);
    expect(conversationReasoningBudget('extreme')).toBe(16_384);
  });
});
