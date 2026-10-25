import { describe, expect, it } from 'vitest';
import { buildRequestContextPlan } from './requestContextPlan';

describe('requestContextPlan', () => {
  it('drops recent orphaned informational tool messages outside request conversation', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '帮我搜一下',
          timestamp: 1
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '已找到 3 条网页结果',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'webSearch',
            status: 'executed',
            title: '联网搜索',
            summary: '已找到 3 条网页结果',
            detailText: '1. 第一条\n2. 第二条'
          }
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-1')?.status).toBe('dropped_orphaned_tool_result');
    expect(contextPlan.units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'orphaned_tool_result',
        messageIds: ['tool-1'],
        status: 'dropped_orphaned_tool_result'
      })
    ]));
    expect(contextPlan.summaries).toEqual([]);
  });

  it('drops orphaned non-informational tool messages outside request conversation', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '做个二维码',
          timestamp: 1
        },
        {
          id: 'tool-2',
          role: 'system',
          content: '已生成二维码',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-2',
            kind: 'createQrCode',
            status: 'executed',
            title: '生成二维码',
            summary: '已生成二维码'
          }
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-2')?.status).toBe('dropped_orphaned_tool_result');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('drops recent orphaned theme tool messages outside request conversation', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '再把气泡收得雾一点',
          timestamp: 1
        },
        {
          id: 'tool-3',
          role: 'system',
          content: '这版试穿已应用。',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-3',
            kind: 'applySurfaceTokens',
            status: 'applied',
            title: '单区域精修试穿',
            summary: '回复气泡晚雾 · 06 · hue 266',
            previewId: 'preview-2',
            themeScope: 'chat',
            themeSurfaceLabels: ['回复气泡'],
            themeIntentLabel: '晚雾'
          }
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-3')?.status).toBe('dropped_orphaned_tool_result');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('drops oversized older tool transcripts when the history budget is exhausted', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 80,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '看一下附件',
          timestamp: 1
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先读一下。',
          timestamp: 2,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'readAttachmentText',
            argumentsText: '{"target":"设定.txt"}'
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '已读取附件',
          timestamp: 3,
          toolInvocation: {
            id: 'tool-1',
            kind: 'readAttachmentText',
            status: 'executed',
            title: '读取附件',
            summary: '已读取：设定.txt',
            detailText: 'x'.repeat(400),
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-2',
          role: 'user',
          content: '继续',
          timestamp: 4
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1', 'user-2']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-2')?.status).toBe('kept');
    expect(contextPlan.units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_pair',
        messageIds: ['assistant-1', 'tool-1'],
        status: 'dropped_history_budget'
      }),
      expect.objectContaining({
        kind: 'user_turn',
        messageIds: ['user-2'],
        status: 'kept',
        protectedBy: 'current_user_message'
      })
    ]));
    expect(contextPlan.summaries).toEqual([]);
  });

  it('keeps conversational originals before bulky tool utility units under tight budget', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 90,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '你刚刚说不要兼容桥，我很在意这句话。',
          timestamp: 1
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我记得，我们决定先把边界理清楚，不用补丁糊过去。',
          timestamp: 2
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '我读一下文件。',
          timestamp: 3,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'readProjectFile',
            argumentsText: '{"path":"src/large.ts"}'
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '已读取 large.ts',
          timestamp: 4,
          toolInvocation: {
            id: 'tool-1',
            kind: 'readProjectFile',
            status: 'executed',
            title: '读取工作区文件',
            summary: '已读取 large.ts',
            detailText: 'x'.repeat(600),
            originMessageId: 'assistant-2',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-2',
          role: 'user',
          content: '那我们继续这个方向。',
          timestamp: 5
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-2']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-2')?.status).toBe('dropped_history_budget');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('keeps workspace workflow evidence before older conversation text in workspace mode', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 300,
      messageLimit: 16,
      historyMode: 'workspace',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '这段闲聊很长很长，主要是在绕着感受说话，不是当前工作区继续执行需要的证据。'.repeat(30),
          timestamp: 1
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我当时也认真回应了这段情绪，但它在工作区预算紧张时应该比执行证据更晚进入请求。'.repeat(30),
          timestamp: 2
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '我先读一下工作区文件。',
          timestamp: 3,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'readProjectFile',
            argumentsText: '{"path":"src/requestContextPlan.ts"}'
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '已读取 requestContextPlan.ts',
          timestamp: 4,
          toolInvocation: {
            id: 'tool-1',
            kind: 'readProjectFile',
            status: 'executed',
            title: '读取工作区文件',
            summary: '已读取 requestContextPlan.ts',
            detailText: '关键内容：selectRequestContextUnitsWithinBudget 负责历史预算选择。',
            originMessageId: 'assistant-2',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-2',
          role: 'user',
          content: '继续按这个文件改。',
          timestamp: 5
        }
      ]
    });

    expect(contextPlan.historyMode).toBe('workspace');
    expect(conversation.map((message) => message.id)).toEqual(['assistant-2', 'tool-1', 'user-2']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('drops long older text without replacing it with a summary', () => {
    const longUserMessage = [
      '开头背景：我们前面一直在讨论上下文裁剪和工具结果压缩。',
      '中间铺垫：'.repeat(200),
      '最终决定：普通聊天和亲密聊天里不能只剩摘要，工作区才优先压执行证据。'
    ].join('');
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 180,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: longUserMessage,
          timestamp: 1
        },
        {
          id: 'user-2',
          role: 'user',
          content: '继续。',
          timestamp: 2
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-2']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('dropped_history_budget');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('drops older messages without adding summary tokens to the history budget', () => {
    const oldMessages = Array.from({ length: 6 }, (_, index) => ({
      id: `user-old-${index + 1}`,
      role: 'user' as const,
      content: [
        `旧消息 ${index + 1}：这是一段已经离当前轮次比较远的上下文。`,
        '中间内容很多很多。'.repeat(120),
        `旧消息 ${index + 1} 的末尾决定。`
      ].join(''),
      timestamp: index + 1
    }));
    const { contextPlan, historyDecision } = buildRequestContextPlan({
      historyMaxTokens: 260,
      messageLimit: 16,
      messages: [
        ...oldMessages,
        {
          id: 'user-current',
          role: 'user',
          content: '继续当前问题。',
          timestamp: 10
        }
      ]
    });

    expect(historyDecision.estimatedTokens).toBeLessThanOrEqual(historyDecision.maxTokens);
    expect(contextPlan.summaries).toEqual([]);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-old-6')?.status).toBe('dropped_history_budget');
  });

  it('keeps the latest user turn even when it alone exceeds the history budget', () => {
    const oversizedUserContent = 'x'.repeat(600);
    const { conversation, historyDecision } = buildRequestContextPlan({
      historyMaxTokens: 40,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: oversizedUserContent,
          timestamp: 1
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1']);
    expect(historyDecision.status).toBe('trimmed_budget');
  });

  it('does not let a trailing system followup squeeze out the latest user turn', () => {
    const { conversation, historyDecision } = buildRequestContextPlan({
      historyMaxTokens: 0,
      messageLimit: 16,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '把刚刚读到的 Mini Phone 代码继续改下去',
          timestamp: 1
        },
        {
          id: 'tool-followup',
          role: 'system',
          content: '上一轮工具已经执行完了，继续基于结果完成任务。',
          timestamp: 2
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1']);
    expect(historyDecision.status).toBe('trimmed_budget');
  });

  it('uses the stepped boundary in the actual request plan without a second rolling cutoff', () => {
    const messages = Array.from({ length: 126 }, (_, index) => ({ id: String(index), role: 'user' as const, content: 'hello', timestamp: index }));
    for (const [count, start] of [[100, 0], [101, 25], [125, 25], [126, 50]]) {
      const plan = buildRequestContextPlan({ messages: messages.slice(0, count), messageLimit: 100, historyMaxTokens: 100000 });
      expect(plan.conversation[0].id).toBe(String(start));
      expect(plan.conversation[plan.conversation.length - 1]?.id).toBe(String(count - 1));
    }
  });

  it('keeps the latest user turn including system follow-ups beyond the count target', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 1,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '继续刚才的任务',
          timestamp: 1
        },
        {
          id: 'tool-followup-1',
          role: 'system',
          content: '上一轮读文件完成。',
          timestamp: 2
        },
        {
          id: 'tool-followup-2',
          role: 'system',
          content: '上一轮写文件完成。',
          timestamp: 3
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['user-1', 'tool-followup-1', 'tool-followup-2']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-followup-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-followup-2')?.status).toBe('kept');
    expect(contextPlan.summaries).toEqual([]);
  });

  it('aligns a count boundary to retain tool results with their origin assistant', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 2,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先读一下。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'readProjectFile',
            argumentsText: '{"target":"active"}'
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '已读取 index.html',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'readProjectFile',
            status: 'executed',
            title: '读取工作区文件',
            summary: '已读取 index.html',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-1',
          role: 'user',
          content: '继续',
          timestamp: 3
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['assistant-1', 'tool-1', 'user-1']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'tool-1')?.status).toBe('kept');
    expect(contextPlan.entries.find((entry) => entry.messageId === 'user-1')?.status).toBe('kept');
    expect(contextPlan.units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_turn',
        messageIds: ['user-1'],
        status: 'kept'
      })
    ]));
    expect(contextPlan.summaries).toEqual([]);
  });

  it('keeps dangling assistant messages in request history instead of silently deleting them', () => {
    const { conversation, contextPlan } = buildRequestContextPlan({
      historyMaxTokens: 8_000,
      messageLimit: 16,
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先试一下。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: red; }"}'
          }]
        },
        {
          id: 'user-1',
          role: 'user',
          content: '继续',
          timestamp: 2
        }
      ]
    });

    expect(conversation.map((message) => message.id)).toEqual(['assistant-1', 'user-1']);
    expect(contextPlan.entries.find((entry) => entry.messageId === 'assistant-1')?.status).toBe('kept');
    expect(contextPlan.units).toEqual([
      expect.objectContaining({
        kind: 'assistant_tool_call',
        messageIds: ['assistant-1'],
        status: 'kept'
      }),
      expect.objectContaining({
        kind: 'user_turn',
        messageIds: ['user-1'],
        status: 'kept'
      })
    ]);
  });
});
