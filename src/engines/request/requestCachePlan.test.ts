import { describe, expect, it } from 'vitest';
import type { AssistantPromptPart } from './requestAudit';
import { resolveAnthropicMinimumCacheTokens, resolveRequestCachePlan } from './requestCachePlan';

function createPart(
  part: Pick<AssistantPromptPart, 'name' | 'layer' | 'content'> & Partial<AssistantPromptPart>
): AssistantPromptPart {
  return {
    label: part.name,
    role: 'system',
    truncationPriority: 0,
    enabled: true,
    charCount: part.content.length,
    ...part
  };
}

describe('resolveRequestCachePlan', () => {
  it('keeps dynamic context parts out of the capability cache prefix', () => {
    const identity = createPart({
      name: 'system_identity',
      layer: 'identity',
      content: '稳定身份。'.repeat(300)
    });
    const modelRuntime = createPart({
      name: 'model_runtime_context',
      layer: 'context',
      content: '当前模型执行提示。'
    });
    const taskRuntime = createPart({
      name: 'work_runtime_context',
      layer: 'context',
      content: '当前任务账本。'
    });
    const capability = createPart({
      name: 'tool_capability',
      layer: 'capability',
      content: '稳定工具协议。'.repeat(300)
    });

    const plan = resolveRequestCachePlan({
      promptParts: [identity, modelRuntime, taskRuntime, capability],
      providerCacheMode: 'explicit-cache-control',
      minimumBreakpointTokens: 1
    });

    expect(plan.requestApplication.status).toBe('explicit_anthropic_cache_control');
    expect(plan.requestApplication.sendsExplicitCacheControl).toBe(true);
    expect(plan.breakpoints.find((breakpoint) => breakpoint.name === 'capability_prefix')?.partNames)
      .toEqual(['system_identity', 'tool_capability']);
    expect(plan.breakpoints.find((breakpoint) => breakpoint.name === 'capability_prefix')?.ttl)
      .toBe('1h');
  });

  it('uses current Anthropic cache minimums for newer Claude families', () => {
    expect(resolveAnthropicMinimumCacheTokens('claude-opus-4-6')).toBe(4096);
    expect(resolveAnthropicMinimumCacheTokens('claude-haiku-4-5')).toBe(4096);
    expect(resolveAnthropicMinimumCacheTokens('claude-haiku-3.5')).toBe(2048);
    expect(resolveAnthropicMinimumCacheTokens('claude-sonnet-4-6')).toBe(1024);
  });

  it('reports explicit-only caching when the provider cannot accept top-level cache control', () => {
    const identity = createPart({
      name: 'system_identity',
      layer: 'identity',
      content: '稳定身份。'.repeat(300)
    });
    const plan = resolveRequestCachePlan({
      promptParts: [identity],
      providerCacheMode: 'explicit-cache-control',
      providerSendsTopLevelCacheControl: false,
      providerAutomaticMessageHistoryCache: false,
      minimumBreakpointTokens: 1
    });

    expect(plan.requestApplication.sendsExplicitCacheControl).toBe(true);
    expect(plan.requestApplication.sendsTopLevelCacheControl).toBe(false);
    expect(plan.requestApplication.automaticMessageHistoryCache).toBe(false);
  });

  it('does not mark sub-threshold Opus prefixes as cache eligible', () => {
    const identity = createPart({
      name: 'system_identity',
      layer: 'identity',
      content: '稳定身份。'.repeat(300)
    });
    const plan = resolveRequestCachePlan({
      promptParts: [identity],
      providerCacheMode: 'explicit-cache-control',
      modelId: 'claude-opus-4-6'
    });

    expect(plan.minimumBreakpointTokens).toBe(4096);
    expect(plan.breakpoints.find((breakpoint) => breakpoint.name === 'identity_prefix')?.eligible)
      .toBe(false);
  });
});
