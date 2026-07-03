import { describe, expect, it } from 'vitest';
import { assembleAssistantContext } from './requestContext';
import { prepareConversationMessages } from './requestConversationPreparation';
import type { RequestMessage } from './requestMessage';
import type { ToolLedgerEntry } from '../../types/domain';

function createUserMessage(overrides: Partial<RequestMessage> = {}): RequestMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: '看一下这个',
    timestamp: 1,
    ...overrides
  };
}

describe('assembleAssistantContext', () => {
  it('preserves prompt part metadata and cache plan on system context messages', () => {
    const cachePlan = {
      minimumBreakpointTokens: 1024,
      requestApplication: {
        status: 'explicit_anthropic_cache_control' as const,
        label: 'Anthropic automatic conversation cache plus explicit prefix breakpoints sent',
        sendsExplicitCacheControl: true
      },
      breakpoints: []
    };
    const context = assembleAssistantContext({
      systemPromptParts: [{
        name: 'system_identity',
        layer: 'identity',
        content: 'stable identity'
      }],
      messages: [createUserMessage()],
      cachePlan
    });

    expect(context.cachePlan).toBe(cachePlan);
    expect(context.segments[0]?.messages[0]).toEqual({
      role: 'system',
      content: 'stable identity',
      promptPartName: 'system_identity',
      promptPartLayer: 'identity'
    });
  });

  it('keeps stable prompt parts before memory and leaves dynamic context out of the latest user turn', () => {
    const context = assembleAssistantContext({
      systemPromptParts: [
        {
          name: 'system_identity',
          layer: 'identity',
          content: 'stable identity'
        },
        {
          name: 'model_runtime_context',
          layer: 'context',
          content: 'current model hint'
        },
        {
          name: 'tool_catalog_capability',
          layer: 'capability',
          content: 'stable tool catalog'
        },
        {
          name: 'work_runtime_context',
          layer: 'context',
          content: 'current workbench facts'
        }
      ],
      messages: [createUserMessage()],
      memoryLines: ['喜欢冷色调'],
      workspaceReferenceDocs: [{
        id: 'workspace-ref-1',
        projectId: 'project-1',
        title: '设定资料',
        summary: '世界观资料',
        content: '完整正文不应内联。',
        source: 'manual',
        createdAt: Date.UTC(2026, 4, 2),
        updatedAt: Date.UTC(2026, 4, 2)
      }],
      historySummaries: ['原因：history budget\n- user_turn user-old: 用户：旧需求']
    });

    expect(context.segments.map((segment) => segment.kind)).toEqual([
      'system',
      'system',
      'memory',
      'system',
      'history_summary',
      'system',
      'system',
      'conversation'
    ]);
    expect(context.segments.map((segment) => segment.messages[0]?.promptPartName ?? segment.kind)).toEqual([
      'system_identity',
      'tool_catalog_capability',
      'memory',
      'system',
      'history_summary',
      'model_runtime_context',
      'work_runtime_context',
      'conversation'
    ]);

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'user',
        content: '看一下这个'
      }
    ]);
  });

  it('keeps dynamic runtime context as a system segment without rewriting older history', () => {
    const olderUser = createUserMessage({
      id: 'user-old',
      content: '昨天那个先放着',
      timestamp: 1
    });
    const assistant = {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '好，我先记住这个现场。',
      timestamp: 2
    };
    const latestUser = createUserMessage({
      id: 'user-new',
      content: '今晚继续吗',
      timestamp: 3
    });

    const context = assembleAssistantContext({
      systemPromptParts: [{
        name: 'model_runtime_context',
        layer: 'context',
        content: 'current model hint'
      }],
      messages: [olderUser, assistant, latestUser]
    });

    expect(context.segments[0]?.messages[0]).toEqual({
      role: 'system',
      content: 'current model hint',
      promptPartName: 'model_runtime_context',
      promptPartLayer: 'context'
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'user',
        content: '昨天那个先放着'
      },
      {
        role: 'assistant',
        content: '好，我先记住这个现场。',
        thinkingText: undefined,
        toolCalls: undefined
      },
      {
        role: 'user',
        content: '今晚继续吗'
      }
    ]);
  });

  it('places runtime clock context immediately before the latest user message', () => {
    const context = assembleAssistantContext({
      systemPromptParts: [{
        name: 'runtime_clock_context',
        layer: 'context',
        content: '当前本地完整时间：2026-07-22 21:15:30\n当前时区：Asia/Shanghai'
      }],
      messages: [
        createUserMessage({ id: 'user-old', content: '昨天那个先放着', timestamp: 1 }),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '好。',
          timestamp: 2
        },
        createUserMessage({ id: 'user-new', content: '今晚继续吗', timestamp: 3 })
      ]
    });

    expect(context.segments[0]?.kind).toBe('conversation');
    expect(context.segments[0]?.messages).toEqual([
      {
        role: 'user',
        content: '昨天那个先放着'
      },
      {
        role: 'assistant',
        content: '好。',
        thinkingText: undefined,
        toolCalls: undefined
      },
      {
        role: 'user',
        content: expect.stringContaining('[本轮请求上下文，不是用户原话]'),
        promptPartName: 'runtime_clock_context',
        promptPartLayer: 'context'
      },
      {
        role: 'user',
        content: '今晚继续吗'
      }
    ]);
    expect(context.segments[0]?.messages[2]?.content).toContain('2026-07-22 21:15:30');
    expect(context.segments[0]?.messages[2]?.content).toContain('Asia/Shanghai');
  });

  it('builds a memory segment from normalized memory lines', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      memoryLines: ['  喜欢冷色调  ', '', '喜欢冷色调', '叫我 星野']
    });

    expect(context.memorySlots.profile).toEqual(['喜欢冷色调', '喜欢冷色调', '叫我 星野']);
    expect(context.segments[0]?.kind).toBe('memory');
    expect(context.segments[0]?.messages[0]?.content).toContain('1. 叫我 星野');
  });

  it('keeps semantic recall candidates separate from confirmed memory and conversation history', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      memoryLines: ['用户喜欢清楚边界'],
      semanticRecallCandidates: [{
        id: 'recall:old:user-old',
        kind: 'matched_context',
        label: '旧对话',
        sourceConversationId: 'old',
        sourceMessageIds: ['user-old'],
        score: 0.42,
        sourceTimestamp: new Date('2026-05-20T12:00:00.000Z').getTime(),
        text: '之前说过召回只能当候选，不能写成确认记忆。'
      }]
    });

    expect(context.segments.map((segment) => segment.kind)).toEqual([
      'memory',
      'semantic_recall',
      'conversation'
    ]);

    const semanticRecall = context.segments.find((segment) => segment.kind === 'semantic_recall');
    const conversation = context.segments.find((segment) => segment.kind === 'conversation');

    expect(semanticRecall?.messages).toEqual([
      {
        role: 'system',
        promptPartLayer: 'context',
        content: expect.stringContaining('[跨对话前文片段]')
      }
    ]);
    expect(semanticRecall?.messages[0]?.content).toContain('不要机械复述');
    expect(semanticRecall?.messages[0]?.content).not.toContain('在之前的旧对话里，用户曾经和你聊过：');
    expect(semanticRecall?.messages[0]?.content).not.toContain('2026-05-20');
    expect(semanticRecall?.messages[0]?.content).not.toContain('约3个月前');
    expect(semanticRecall?.messages[0]?.content).not.toContain('candidateId');
    expect(semanticRecall?.messages[0]?.content).not.toContain('messageIds');
    expect(semanticRecall?.messages[0]?.content).toContain('之前说过召回只能当候选');
    expect(conversation?.messages).toEqual([
      {
        role: 'user',
        content: '看一下这个'
      }
    ]);
  });

  it('keeps conversation summaries between confirmed memory and recalled raw candidates', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      memoryLines: ['用户喜欢清楚边界'],
      conversationSummaries: [{
        id: 'summary-profile',
        kind: 'relational_profile',
        title: '互动画像',
        content: '用户会用很短的话点出结构问题，需要助手补全责任链。',
        sequence: 1,
        sourceConversationIds: ['conversation-old'],
        sourceMessageIds: ['user-old'],
        sourceCharCount: 50_000,
        subjectCollaboratorName: 'Nova',
        userLabel: '用户',
        estimatedTokens: 20,
        charCount: 24,
        contentFingerprint: 'profile-fingerprint',
        generatedAt: 1,
        updatedAt: 2,
        expiresAt: null,
        status: 'kept'
      }],
      semanticRecallCandidates: [{
        id: 'recall:old:user-old',
        kind: 'matched_context',
        label: '旧对话',
        sourceConversationId: 'old',
        sourceMessageIds: ['user-old'],
        score: 0.42,
        text: '原话候选仍然单独放。'
      }]
    });

    expect(context.segments.map((segment) => segment.kind)).toEqual([
      'memory',
      'conversation_summary',
      'semantic_recall',
      'conversation'
    ]);

    const summary = context.segments.find((segment) => segment.kind === 'conversation_summary');
    expect(summary?.messages[0]?.content).toContain('[跨对话总结]');
    expect(summary?.messages[0]?.content).toContain('不是逐字原文也不是硬规则');
    expect(summary?.messages[0]?.content).toContain('对象: 用户 ↔ Nova');
    expect(summary?.messages[0]?.content).toContain('对象标签');
    expect(summary?.messages[0]?.content).not.toContain('summaryId');
    expect(summary?.messages[0]?.content).not.toContain('sourceChars');
    expect(summary?.messages[0]?.content).toContain('用户会用很短的话点出结构问题');
  });

  it('lists long-term memory docs by docId without inlining their full content', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      memoryLines: ['喜欢清楚边界'],
      memoryReferenceDocs: [{
        id: 'memory-doc-1',
        title: '关系边界',
        summary: '长期关系背景和称呼偏好',
        content: '这里是很长很长的正文，只有 readMemoryDoc 才应该返回。',
        source: 'user',
        updatedAt: Date.UTC(2026, 4, 2)
      }]
    });

    const memoryContent = String(context.segments.find((segment) => segment.kind === 'memory')?.messages[0]?.content);
    expect(memoryContent).toContain('docId: memory-doc-1');
    expect(memoryContent).toContain('需要具体背景时，先调用 readMemoryDoc 读取全文');
    expect(memoryContent).not.toContain('这里是很长很长的正文');
  });

  it('lists workspace reference docs without inlining their full content', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      workspaceReferenceDocs: [{
        id: 'workspace-ref-1',
        projectId: 'project-1',
        title: '小说正文',
        summary: '角色和场景背景',
        content: '这一整段小说正文只能由 readWorkspaceReference 返回。',
        source: 'manual',
        createdAt: Date.UTC(2026, 4, 2),
        updatedAt: Date.UTC(2026, 4, 2)
      }]
    });

    const referenceContent = String(context.segments.find((segment) =>
      segment.messages.some((message) => String(message.content).includes('[工作区参考资料目录]'))
    )?.messages[0]?.content);

    expect(referenceContent).toContain('docId: workspace-ref-1');
    expect(referenceContent).toContain('readWorkspaceReference');
    expect(referenceContent).not.toContain('这一整段小说正文');
  });

  it('keeps history summaries in a separate non-conversation segment', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      historySummaries: ['原因：message limit\n- user_turn user-old: 用户：旧需求']
    });

    const historySummary = context.segments.find((segment) => segment.kind === 'history_summary');
    const conversation = context.segments.find((segment) => segment.kind === 'conversation');

    expect(historySummary?.messages).toEqual([
      {
        role: 'system',
        cachePrefixEligible: true,
        content: expect.stringContaining('[历史摘要，不是原文]')
      }
    ]);
    expect(historySummary?.messages[0]?.content).toContain('原因：message limit');
    expect(conversation?.messages).toEqual([
      {
        role: 'user',
        content: '看一下这个'
      }
    ]);
  });

  it('does not inject runtime feedback as a separate segment during context assembly', () => {
    const context = assembleAssistantContext({
      messages: [{
        id: 'tool-1',
        role: 'system',
        content: '[工具结果：代码执行]\n\n代码执行超时（60 秒）。',
        origin: 'tool-runtime',
        timestamp: 2
      }, createUserMessage()],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        runtimeFeedback: {
          events: [{
            id: 'rtf-1',
            kind: 'assistant_tool_preparation_failed',
            createdAt: 2,
            status: 'parse_failed',
            summary: '上一轮工具准备失败，工具块没有通过解析。',
            reasons: ['工具块里没有找到可执行动作。']
          }]
        }
      }
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');

    expect(context.segments.map((segment) => segment.kind)).not.toContain('runtime_feedback');
    expect(conversation?.messages).toEqual([
      {
        role: 'system',
        content: '[工具结果：代码执行]\n\n代码执行超时（60 秒）。'
      },
      {
        role: 'user',
        content: '看一下这个'
      }
    ]);
  });

  it('keeps structured tool results in conversation even when runtime feedback segment exists', () => {
    const context = assembleAssistantContext({
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
          origin: 'tool-runtime',
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
        createUserMessage({
          id: 'user-2',
          content: '继续'
        })
      ],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        runtimeFeedback: {
          events: [{
            id: 'rtf-1',
            kind: 'assistant_tool_preparation_failed',
            createdAt: 3,
            status: 'parse_failed',
            summary: '上一轮工具准备失败，工具块没有通过解析。',
            reasons: ['工具块里没有找到可执行动作。']
          }]
        }
      }
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先读一下。',
        thinkingText: undefined,
        toolCalls: [{
          id: 'call-1',
          name: 'readProjectFile',
          argumentsText: '{"target":"active"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }]
      },
      {
        role: 'tool',
        content: '已读取 index.html',
        toolResult: {
          schemaVersion: 1,
          toolCallId: 'call-1',
          toolName: 'readProjectFile',
          sourceMessageId: 'assistant-1',
          status: 'executed',
          isError: false,
          structuredPayload: expect.objectContaining({
            kind: 'readProjectFile',
            status: 'executed',
            summary: '已读取 index.html'
          })
        }
      },
      {
        role: 'user',
        content: '继续',
        thinkingText: undefined,
        toolCalls: undefined
      }
    ]);
  });

  it('leaves workspace scope lifecycle feedback out of raw context assembly', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage()],
      toolContext: {
        activeCard: null,
        visibleCards: [],
        activeProject: {
          id: 'workspace-new',
          title: 'Mini Phone',
          slug: 'mini-phone',
          tags: [],
          source: 'manual',
          fileCount: 2,
          files: []
        },
        visibleProjects: [
          {
            id: 'workspace-old',
            title: 'Old Lab',
            slug: 'old-lab',
            tags: [],
            source: 'manual',
            fileCount: 1,
            files: []
          },
          {
            id: 'workspace-new',
            title: 'Mini Phone',
            slug: 'mini-phone',
            tags: [],
            source: 'manual',
            fileCount: 2,
            files: []
          }
        ],
        runtimeFeedback: {
          events: [{
            id: 'rtf-1',
            kind: 'workspace_scope_changed',
            createdAt: 2,
            conversationId: 'conversation-1',
            change: 'switched',
            previousProjectId: 'workspace-old',
            nextProjectId: 'workspace-new',
            summary: '当前对话已从工作区 workspace-old 切到 workspace-new。'
          }]
        }
      }
    });

    expect(context.segments.map((segment) => segment.kind)).not.toContain('runtime_feedback');
  });

  it('falls back to text markers when image input is not supported', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'img-1',
          assetId: 'asset-1',
          kind: 'image',
          name: 'mock.png',
          mimeType: 'image/png',
          size: 42
        }]
      })],
      allowImages: false,
      latestUserSupplementalContent: [{
        type: 'image_url',
        image_url: { url: 'https://example.com/diagram.png' }
      }]
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toBe(
      [
        '看一下这个',
        '[图片附件：mock.png]',
        '[系统附加结构图：当前通道不支持直接看图，请结合上面的编号规则选择 targets。]'
      ].join('\n\n')
    );
  });

  it('keeps user images inline when the provider supports them', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'img-1',
          assetId: 'asset-1',
          kind: 'image',
          name: 'mock.png',
          mimeType: 'image/png',
          size: 42,
          dataUrl: 'data:image/png;base64,abc'
        }]
      })],
      allowImages: true,
      latestUserSupplementalContent: [{
        type: 'text',
        text: '请看结构图'
      }, {
        type: 'image_url',
        image_url: { url: 'https://example.com/diagram.png' }
      }]
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toEqual([
      {
        type: 'text',
        text: ['看一下这个', '请看结构图'].join('\n\n')
      },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abc' }
      },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/diagram.png' }
      }
    ]);
  });

  it('keeps image markers in text when inline image hydration is unavailable', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'img-1',
          assetId: 'asset-1',
          kind: 'image',
          name: 'missing-inline.png',
          mimeType: 'image/png',
          size: 42
        }]
      })],
      allowImages: true
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toBe(['看一下这个', '[图片附件：missing-inline.png]'].join('\n\n'));
  });

  it('renders file attachments into text blocks', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'file-1',
          assetId: 'asset-file-1',
          kind: 'file',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 12,
          textContent: 'line one'
        }]
      })],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toBe(['看一下这个', '[文件附件：notes.txt]\nline one'].join('\n\n'));
  });

  it('auto-inlines extracted structured document text into the message body', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'file-1',
          assetId: 'asset-file-1',
          kind: 'file',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: 12_000,
          textContent: '第一页内容\n第二页内容'
        }]
      })],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toBe([
      '看一下这个',
      '[文件附件：report.pdf]\n第一页内容\n第二页内容'
    ].join('\n\n'));
  });

  it('keeps unreadable document attachments as file markers', () => {
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'file-1',
          assetId: 'asset-file-1',
          kind: 'file',
          name: 'scanned.pdf',
          mimeType: 'application/pdf',
          size: 12_000
        }]
      })],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages[0]?.content).toBe([
      '看一下这个',
      '[文件附件：scanned.pdf]'
    ].join('\n\n'));
  });

  it('truncates auto-inlined text attachments before they can dominate the prompt', () => {
    const longText = 'a'.repeat(6_500);
    const context = assembleAssistantContext({
      messages: [createUserMessage({
        attachments: [{
          id: 'file-1',
          assetId: 'asset-file-1',
          kind: 'file',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 8_000,
          textContent: longText
        }]
      })],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    const content = conversation?.messages[0]?.content;
    expect(typeof content).toBe('string');
    expect(content).toContain('[文件附件：notes.txt]');
    expect(content).toContain('[正文已截断；需要时再读取附件正文。]');
    expect(content).not.toContain('a'.repeat(6_100));
  });

  it('injects card references as hidden system context before the user message', () => {
    const { messages } = prepareConversationMessages([createUserMessage({
      cardReference: {
        id: 'card-1',
        title: '随便的卡片',
        cardNote: '像别在页边的轻声提醒。',
        language: 'text',
        code: '给你留的位置。',
        cardFaceCss: '& { --code-card-face-panel-top: #eef6ff; }',
        mode: 'continue'
      }
    })], null);

    const context = assembleAssistantContext({
      messages,
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]?.role).toBe('system');
    expect(conversation?.messages[0]?.content).toContain('```polaris-card-reference');
    expect(conversation?.messages[0]?.content).toContain('"id": "card-1"');
    expect(conversation?.messages[0]?.content).toContain('这张卡是本轮明确要继续修改的目标');
    expect(conversation?.messages[0]?.content).toContain('卡片正文：');
    expect(conversation?.messages[0]?.content).toContain('卡面小字：');
    expect(conversation?.messages[0]?.content).toContain('像别在页边的轻声提醒。');
    expect(conversation?.messages[0]?.content).toContain('卡面 CSS：');
    expect(conversation?.messages[1]).toEqual({
      role: 'user',
      content: '看一下这个'
    });
  });

  it('binds assistant tool calls and tool results into a structured conversation transcript', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先给你换一版。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: red; }"}'
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '[工具结果：直接改 CSS]\n\n状态：applied',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'patchRawCss',
            status: 'applied',
            title: '直接改 CSS',
            summary: 'body { color: red; }',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        }
      ],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先给你换一版。',
        thinkingText: undefined,
        toolCalls: [{
          id: 'call-1',
          name: 'patchRawCss',
          argumentsText: '{"css":"body { color: red; }"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }]
      },
      {
        role: 'tool',
        content: '[工具结果：直接改 CSS]\n\n状态：applied',
        toolResult: {
          schemaVersion: 1,
          toolCallId: 'call-1',
          toolName: 'patchRawCss',
          sourceMessageId: 'assistant-1',
          status: 'applied',
          isError: false,
          structuredPayload: expect.objectContaining({
            kind: 'patchRawCss',
            status: 'applied',
            summary: 'body { color: red; }'
          })
        }
      }
    ]);
  });

  it('prefers canonical tool ledger over request-time tool pairing', () => {
    const messages: RequestMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '我先看一下。',
        timestamp: 1
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
          originMessageId: 'assistant-1'
        }
      },
      {
        id: 'user-1',
        role: 'user',
        content: '继续',
        timestamp: 3
      }
    ];
    const toolLedger: ToolLedgerEntry[] = [{
      id: 'assistant-1:tool-ledger:1',
      toolCallId: 'call-1',
      assistantMessageId: 'assistant-1',
      order: 0,
      toolName: 'readProjectFile',
      argumentsText: '{"target":"active"}',
      sourceSpan: {
        transport: 'native',
        index: 0
      },
      resultMessageId: 'tool-1',
      resultToolName: 'readProjectFile',
      resultStatus: 'executed',
      resultIsError: false,
      resultSourceMessageId: 'assistant-1',
      resultStructuredPayload: {
        kind: 'readProjectFile',
        status: 'executed',
        summary: '已读取 index.html'
      }
    }];

    const context = assembleAssistantContext({
      messages,
      toolLedger,
    });

    expect(context.segments[0]?.kind).toBe('conversation');
    expect(context.segments[0]?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先看一下。',
        toolCalls: [{
          id: 'call-1',
          name: 'readProjectFile',
          argumentsText: '{"target":"active"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }]
      },
      {
        role: 'tool',
        content: '已读取 index.html',
        toolResult: {
          schemaVersion: 1,
          toolCallId: 'call-1',
          toolName: 'readProjectFile',
          sourceMessageId: 'assistant-1',
          status: 'executed',
          isError: false,
          structuredPayload: {
            kind: 'readProjectFile',
            status: 'executed',
            summary: '已读取 index.html'
          }
        }
      },
      {
        role: 'user',
        content: '继续',
        toolCalls: undefined
      }
    ]);
  });

  it('does not trust a stale running ledger result as a settled provider exchange', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先读一下。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'readProjectFile',
            argumentsText: '{"filePath":"index.html"}'
          }]
        },
        {
          id: 'user-1',
          role: 'user',
          content: '继续',
          timestamp: 2
        }
      ],
      toolLedger: [{
        id: 'assistant-1:tool-ledger:1',
        toolCallId: 'call-1',
        assistantMessageId: 'assistant-1',
        order: 0,
        toolName: 'readProjectFile',
        argumentsText: '{"filePath":"index.html"}',
        sourceSpan: {
          transport: 'native',
          index: 0
        },
        resultMessageId: 'tool-running',
        resultToolName: 'readProjectFile',
        resultStatus: 'running',
        resultIsError: false,
        resultSourceMessageId: 'assistant-1',
        resultStructuredPayload: {
          kind: 'readProjectFile',
          status: 'running',
          summary: '正在读取 index.html'
        }
      }]
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先读一下。',
        toolCalls: undefined
      },
      {
        role: 'user',
        content: '继续',
        toolCalls: undefined
      }
    ]);
  });

  it('replays synthetic Polaris tool results as transcript context instead of native provider tool history', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '粉色棉花糖！我先给你试一版。',
          thinkingText: '需要先读当前主题，再给出 CSS 试穿。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: pink; }"}',
            sourceSpan: {
              transport: 'fence',
              index: 0,
              blockIndex: 0
            }
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '粉色棉花糖气泡 · 03 · hue 26',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'patchRawCss',
            status: 'preview',
            title: '单区域精修试穿',
            summary: '粉色棉花糖气泡 · 03 · hue 26',
            detailText: 'body { color: pink; }',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-1',
          role: 'user',
          content: '再黄一点',
          timestamp: 3
        }
      ],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');

    expect(conversation?.messages[0]).toEqual({
      role: 'assistant',
      content: '粉色棉花糖！我先给你试一版。',
      thinkingText: '需要先读当前主题，再给出 CSS 试穿。',
      toolCalls: undefined
    });
    expect(conversation?.messages[1]?.role).toBe('user');
    expect(conversation?.messages[1]?.content).toContain('[tool_result:patchRawCss]');
    expect(conversation?.messages[1]?.content).toContain('"summary":"粉色棉花糖气泡 · 03 · hue 26"');
    expect(conversation?.messages[1]).not.toHaveProperty('toolResult');
    expect(conversation?.messages[2]).toEqual({
      role: 'user',
      content: '再黄一点',
      toolCalls: undefined
    });
  });

  it('does not replay assistant tool calls without matching tool results', () => {
    const context = assembleAssistantContext({
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
      ],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先试一下。',
        toolCalls: undefined
      },
      {
        role: 'user',
        content: '继续',
        toolCalls: undefined
      }
    ]);
  });

  it('does not replay native tool calls when the current request window omits their tool result messages', () => {
    const toolLedger: ToolLedgerEntry[] = [{
      id: 'assistant-1:tool-ledger:1',
      toolCallId: 'call-1',
      assistantMessageId: 'assistant-1',
      order: 0,
      toolName: 'writeDesktopFile',
      argumentsText: '{"filePath":"server.py","content":"print(1)"}',
      sourceSpan: {
        transport: 'native',
        index: 0
      },
      resultMessageId: 'tool-1',
      resultToolName: 'writeDesktopFile',
      resultStatus: 'executed',
      resultIsError: false,
      resultSourceMessageId: 'assistant-1',
      resultStructuredPayload: {
        kind: 'writeDesktopFile',
        status: 'executed',
        summary: '已写入 server.py'
      }
    }];
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先写文件。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'writeDesktopFile',
            argumentsText: '{"filePath":"server.py","content":"print(1)"}',
            sourceSpan: {
              transport: 'native',
              index: 0
            }
          }]
        },
        {
          id: 'user-1',
          role: 'user',
          content: '继续',
          timestamp: 3
        }
      ],
      toolLedger
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages).toEqual([
      {
        role: 'assistant',
        content: '我先写文件。',
        toolCalls: undefined
      },
      {
        role: 'user',
        content: '继续',
        toolCalls: undefined
      }
    ]);
  });

  it('reorders tool results after their origin assistant when persisted history is out of order', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'tool-1',
          role: 'system',
          content: '[工具结果：直接改 CSS]\n\n状态：applied',
          timestamp: 1,
          toolInvocation: {
            id: 'tool-1',
            kind: 'patchRawCss',
            status: 'applied',
            title: '直接改 CSS',
            summary: 'body { color: red; }',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先给你换一版。',
          timestamp: 2,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: red; }"}'
          }]
        }
      ],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    expect(conversation?.messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
  });

  it('keeps full runCode tool call history and tool failure payloads in request context', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '我先试一下。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'runCode',
            argumentsText: JSON.stringify({
              code: `return 1;\n${'x'.repeat(1200)}`
            })
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '代码执行超时（60 秒）。',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'runCode',
            status: 'failed',
            title: '代码执行',
            summary: '代码执行超时（60 秒）。',
            detailText: `代码执行超时（60 秒）。\n${'log '.repeat(200)}`,
            error: `代码执行超时（60 秒）。\n${'stack '.repeat(200)}`,
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        }
      ],
    });

    const conversation = context.segments.find((segment) => segment.kind === 'conversation');
    const assistantMessage = conversation?.messages[0];
    const toolMessage = conversation?.messages[1];
    const originalCode = JSON.stringify({
      code: `return 1;\n${'x'.repeat(1200)}`
    });
    const originalDetailText = `代码执行超时（60 秒）。\n${'log '.repeat(200)}`;
    const originalError = `代码执行超时（60 秒）。\n${'stack '.repeat(200)}`;

    expect(assistantMessage?.role).toBe('assistant');
    expect(assistantMessage?.toolCalls?.[0]?.name).toBe('runCode');
    expect(assistantMessage?.toolCalls?.[0]?.argumentsText).toBe(originalCode);

    expect(toolMessage?.role).toBe('tool');
    expect(toolMessage?.toolResult?.structuredPayload).toEqual({
      kind: 'runCode',
      status: 'failed',
      title: '代码执行',
      summary: '代码执行超时（60 秒）。',
      detailText: originalDetailText,
      scope: undefined,
      surfaces: undefined,
      intent: undefined,
      previewId: undefined,
      presetId: undefined,
      world: undefined,
      cardId: undefined,
      projectFileId: undefined,
      imageCardId: undefined,
      memoryItems: undefined,
      targetLabel: undefined,
      error: originalError
    });
  });
});
