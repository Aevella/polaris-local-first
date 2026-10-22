import type { ConversationReasoningStrength } from '../types/domain';

export const CONVERSATION_REASONING_STRENGTHS = [
  'off',
  'automatic',
  'light',
  'medium',
  'high',
  'extreme'
] as const satisfies readonly ConversationReasoningStrength[];

export function normalizeConversationReasoningStrength(
  value: unknown
): ConversationReasoningStrength {
  return typeof value === 'string'
    && CONVERSATION_REASONING_STRENGTHS.includes(value as ConversationReasoningStrength)
    ? value as ConversationReasoningStrength
    : 'automatic';
}

export function conversationReasoningBudget(
  strength: Exclude<ConversationReasoningStrength, 'automatic'>
): number {
  switch (strength) {
    case 'off':
      return 0;
    case 'light':
      return 512;
    case 'medium':
      return 2_048;
    case 'high':
      return 8_192;
    case 'extreme':
      return 16_384;
  }
}
