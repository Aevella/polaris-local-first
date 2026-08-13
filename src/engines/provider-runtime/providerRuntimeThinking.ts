import type { ProviderCapability } from './providerCapability';

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
    case 'none':
      return {};
  }
}
