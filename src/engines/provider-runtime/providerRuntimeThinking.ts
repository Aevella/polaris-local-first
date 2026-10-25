import type { ProviderCapability } from './providerCapability';
import { conversationReasoningBudget } from '../conversationReasoning';
import type { ConversationReasoningStrength } from '../../types/domain';

export type ProviderReasoningEffort = 'low' | 'medium' | 'high';

export function resolveProviderReasoningEffort(thinkingBudget: number): ProviderReasoningEffort {
  if (thinkingBudget <= 1024) return 'low';
  if (thinkingBudget <= 4096) return 'medium';
  return 'high';
}

export function buildProviderThinkingRequest(
  capability: ProviderCapability,
  thinkingBudget: number | undefined
): Record<string, unknown> {
  if (thinkingBudget === undefined || !capability.thinking.sendBudget) {
    return {};
  }

  const effort = resolveProviderReasoningEffort(thinkingBudget);
  switch (capability.thinking.requestTransport) {
    case 'anthropic-manual':
    case 'openai-anthropic-manual':
      return {
        thinking: {
          type: 'enabled',
          budget_tokens: thinkingBudget
        }
      };
    case 'anthropic-adaptive':
    case 'openai-anthropic-adaptive':
      return {
        thinking: { type: 'adaptive' },
        output_config: { effort }
      };
    case 'openrouter-reasoning':
      return {
        reasoning: {
          max_tokens: thinkingBudget,
          exclude: false
        }
      };
    case 'responses-effort':
      return { reasoning: { effort } };
    case 'openai-compatible-budget':
      return { thinking: { budget_tokens: thinkingBudget } };
    case 'gemini-budget':
    case 'deepseek-thinking':
    case 'none':
      return {};
  }
}

export function applyConversationReasoningStrength(
  body: Record<string, unknown>,
  capability: ProviderCapability,
  strength: ConversationReasoningStrength | undefined
) {
  if (!strength || strength === 'automatic') return body;

  const budget = conversationReasoningBudget(strength);
  switch (capability.thinking.requestTransport) {
    case 'deepseek-thinking':
      body.thinking = { type: strength === 'off' ? 'disabled' : 'enabled' };
      if (strength === 'off') {
        delete body.reasoning_effort;
      } else {
        body.reasoning_effort = strength === 'extreme' ? 'max' : 'high';
      }
      break;
    case 'anthropic-manual':
    case 'openai-anthropic-manual':
      if (strength === 'off') {
        delete body.thinking;
      } else {
        body.thinking = { type: 'enabled', budget_tokens: budget };
      }
      delete body.output_config;
      break;
    case 'anthropic-adaptive':
    case 'openai-anthropic-adaptive':
      if (strength === 'off') {
        delete body.thinking;
        delete body.output_config;
      } else {
        body.thinking = { type: 'adaptive' };
        body.output_config = { effort: resolveProviderReasoningEffort(budget) };
      }
      break;
    case 'openrouter-reasoning':
      body.reasoning = strength === 'off'
        ? { enabled: false }
        : { max_tokens: budget, exclude: false };
      break;
    case 'responses-effort':
      if (strength === 'off') {
        delete body.reasoning;
      } else {
        body.reasoning = { effort: resolveProviderReasoningEffort(budget) };
      }
      break;
    case 'openai-compatible-budget':
      body.thinking = { budget_tokens: budget };
      break;
    case 'gemini-budget': {
      const generationConfig = body.generationConfig && typeof body.generationConfig === 'object'
        && !Array.isArray(body.generationConfig)
        ? body.generationConfig as Record<string, unknown>
        : {};
      body.generationConfig = {
        ...generationConfig,
        thinkingConfig: { thinkingBudget: budget }
      };
      break;
    }
    case 'none':
      break;
  }

  return body;
}
