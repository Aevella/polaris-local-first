import { describe, expect, it } from 'vitest';
import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolContext } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ToolInvocation } from '../../types/domain';
import type { AssistantToolPreparationOutcome, ToolActionRunOutcome } from './chatToolOutcome';
import {
  buildLengthFollowupSystemMessage,
  buildToolExchangeFingerprint,
  buildToolPreparationRetrySystemMessage,
  buildTruncatedToolFollowupSystemMessage,
  relaxToolEnforcementForFollowup,
  resolveToolFollowupPlan,
  shouldRequestLengthFollowup
} from './chatToolFollowup';

function executedOutcome(args: {
  action: ToolAction;
  invocation?: Partial<ToolInvocation>;
}): ToolActionRunOutcome {
  return {
    path: 'direct',
    status: 'executed',
    action: args.action,
    toolInvocation: {
      id: 'tool-1',
      kind: args.action.kind,
      status: 'executed',
      title: '工具已执行',
      summary: '工具结果',
      ...args.invocation
    } as ToolInvocation
  };
}

describe('resolveToolFollowupPlan', () => {
  it('continues from a new settled exchange without manufacturing a followup message', () => {
    const plan = resolveToolFollowupPlan({
      assistantToolOnlyTurn: true,
      outcomes: [executedOutcome({
        action: { kind: 'webSearch', query: 'Polaris' },
        invocation: { detailText: 'Result body' }
      })]
    });

    expect(plan).toEqual({
      exchangeFingerprint: expect.stringContaining('Result body')
    });
    expect(plan).not.toHaveProperty('message');
  });

  it('continues successful, failed, previewed, and memory terminal outcomes', () => {
    const outcomes: ToolActionRunOutcome[] = [
      executedOutcome({ action: { kind: 'createQrCode', text: 'https://example.com' } }),
      {
        path: 'direct',
        status: 'failed',
        action: { kind: 'readWebPage', url: 'https://example.com' },
        error: 'network failed',
        toolInvocation: {
          id: 'tool-failed',
          kind: 'readWebPage',
          status: 'failed',
          title: '读取网页失败',
          summary: 'network failed'
        }
      },
      {
        path: 'preview',
        status: 'previewed',
        action: { kind: 'applyPreset', presetId: 'preset-1' }
      },
      {
        path: 'memory',
        status: 'handled',
        action: { kind: 'writeMemory', memory: ['AA likes concise prompts.'] }
      }
    ];

    for (const outcome of outcomes) {
      expect(resolveToolFollowupPlan({ outcomes: [outcome] })).not.toBeNull();
    }
  });

  it('does not continue pending workspace proposals', () => {
    expect(resolveToolFollowupPlan({
      outcomes: [{
        path: 'workspace',
        status: 'pending',
        action: { kind: 'patchRawCss', css: ':root { --x: 1; }' },
        proposalId: 'proposal-1'
      }]
    })).toBeNull();
  });

  it('stops when the same semantic exchange repeats', () => {
    const firstOutcome = executedOutcome({
      action: { kind: 'readWebPage', url: 'https://example.com' },
      invocation: { detailText: 'same result' }
    });
    const firstPlan = resolveToolFollowupPlan({ outcomes: [firstOutcome] });
    expect(firstPlan).not.toBeNull();

    const repeatedOutcome = executedOutcome({
      action: { kind: 'readWebPage', url: 'https://example.com' },
      invocation: {
        id: 'tool-2',
        toolCallId: 'provider-call-2',
        originMessageId: 'assistant-2',
        detailText: 'same result'
      }
    });
    expect(resolveToolFollowupPlan({
      outcomes: [repeatedOutcome],
      seenExchangeFingerprints: firstPlan ? [firstPlan.exchangeFingerprint] : []
    })).toBeNull();
  });

  it('continues when the result or action makes semantic progress', () => {
    const first = executedOutcome({
      action: { kind: 'readWebPage', url: 'https://example.com/a' },
      invocation: { detailText: 'result A' }
    });
    const firstFingerprint = buildToolExchangeFingerprint([first]);

    expect(resolveToolFollowupPlan({
      seenExchangeFingerprints: firstFingerprint ? [firstFingerprint] : [],
      outcomes: [executedOutcome({
        action: { kind: 'readWebPage', url: 'https://example.com/b' },
        invocation: { detailText: 'result B' }
      })]
    })).not.toBeNull();
  });

  it('stops an A-B-A cycle when any earlier exchange repeats', () => {
    const outcomeA = executedOutcome({
      action: { kind: 'readWebPage', url: 'https://example.com/a' },
      invocation: { detailText: 'result A' }
    });
    const outcomeB = executedOutcome({
      action: { kind: 'readWebPage', url: 'https://example.com/b' },
      invocation: { detailText: 'result B' }
    });
    const fingerprintA = buildToolExchangeFingerprint([outcomeA]);
    const fingerprintB = buildToolExchangeFingerprint([outcomeB]);

    expect(resolveToolFollowupPlan({
      outcomes: [outcomeA],
      seenExchangeFingerprints: [fingerprintA, fingerprintB].filter((value): value is string => Boolean(value))
    })).toBeNull();
  });

  it('stops completed tasks after visible text but allows a tool-only turn to close naturally', () => {
    const outcome = executedOutcome({
      action: { kind: 'completeTask', stage: 'Done', summary: 'Finished.' }
    });

    expect(resolveToolFollowupPlan({
      outcomes: [outcome],
      assistantToolOnlyTurn: false
    })).toBeNull();
    expect(resolveToolFollowupPlan({
      outcomes: [outcome],
      assistantToolOnlyTurn: true
    })).not.toBeNull();
  });
});

describe('tool followup recovery controls', () => {
  it('describes one preparation repair attempt without replaying raw malformed payloads', () => {
    const outcome = {
      status: 'parse_failed',
      reply: { content: 'broken' },
      parsed: {
        actions: [],
        issues: ['Unexpected end of JSON input', '原始参数：secret payload']
      },
      resolvedActions: [],
      message: 'Unexpected end of JSON input'
    } as unknown as Exclude<AssistantToolPreparationOutcome, { status: 'ready' }>;

    const message = buildToolPreparationRetrySystemMessage(outcome);
    expect(message.role).toBe('system');
    expect(message.content).toContain('根据错误自修一次');
    expect(message.content).not.toContain('secret payload');
  });

  it('requests bounded continuation only for truncated output', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 0
    })).toBe(true);
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'stop', transportIncomplete: true },
      depth: 1
    })).toBe(true);
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 2
    })).toBe(false);
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'stop' },
      depth: 0
    })).toBe(false);
  });

  it('keeps explicit recovery messages limited to transport and malformed-call recovery', () => {
    expect(buildLengthFollowupSystemMessage().content).toContain('直接从刚才断开的那一句继续');
    expect(buildTruncatedToolFollowupSystemMessage().content).toContain('工具调用或代码参数在中途截断');
  });

  it('relaxes forced tool enforcement after the first continuation', () => {
    const context = {
      toolEnforcementMode: 'force',
      themeToolMode: 'off'
    } as AssistantToolContext;

    expect(relaxToolEnforcementForFollowup(context, 0)).toBe(context);
    expect(relaxToolEnforcementForFollowup(context, 1).toolEnforcementMode).toBe('normal');
  });
});
