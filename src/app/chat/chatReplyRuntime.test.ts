import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationTaskState, ToolLedgerEntry } from '../../types/domain';
import { createConversationTaskShell } from '../../engines/conversationTask';
import { requestReply } from './chatReplyRuntime';
import type { ChatStreamingState } from './chatStreamingDisplay';
import type { ChatReplyRequestSnapshot } from './chatReplyContext';
import type { ToolActionRunOutcome } from './chatToolOutcome';
import type { ToolAction } from '../../engines/toolExecutor';
import type { McpToolCatalogResolution } from '../../engines/mcpRuntime';
import type { WritableConversationBody } from '../../stores/chatStore';

const requestCollaboratorReplyMock = vi.hoisted(() => vi.fn());
const resolveMcpToolCatalogMock = vi.hoisted(() =>
  vi.fn<() => Promise<McpToolCatalogResolution>>(() => Promise.resolve({ tools: [], errors: [] }))
);

vi.mock('../../engines/request/requestPipeline', () => ({
  requestCollaboratorReply: requestCollaboratorReplyMock
}));

vi.mock('../../engines/mcpRuntime', () => ({
  resolveMcpToolCatalog: resolveMcpToolCatalogMock
}));

function buildRequestSnapshot(
  currentTask: ConversationTaskState | null,
  overrides: Partial<ChatReplyRequestSnapshot> = {}
): ChatReplyRequestSnapshot {
  const snapshot = {
    api: {
      id: 'provider-1',
      name: 'Provider',
      kind: 'custom' as const,
      baseUrl: 'https://example.com',
      protocol: 'openai-completions' as const,
      path: '/v1/chat/completions',
      apiKey: '',
      model: 'test-model',
      capabilities: {
        images: false,
        toolUse: true,
        thinking: false,
        streaming: true
      }
    },
    activeWorld: 'chat' as const,
    collectionShelf: 'code' as const,
    chatAvatarLayoutEnabled: false,
    themeToolMode: 'off' as const,
    enabledToolGroups: {
      room: true,
      project: true,
      theme: true,
      attachment: true,
      generation: true,
      archive: true,
      web: true,
      memory: true
    },
    taskModeEnabled: false,
    mcpServers: [],
    mcpToolTimeoutSeconds: 30,
    themePreviewActive: false,
    currentThemeFrame: {
      activePresetId: null,
      activeSavedSkinId: null,
      cssVariables: {},
      presetCSS: '',
      customCSS: '',
      generatedCSS: '',
      recipe: undefined
    },
    selectedSurfaceCodes: [],
    collectionCards: [],
    projectFiles: [],
    roomProjects: [],
    activeCardId: null,
    activeProjectId: null,
    currentTask,
    pendingWorkspaceProposal: null,
    runtimeFeedbackEvents: [],
    conversations: [],
    personas: [],
    currentCollaboratorId: 'pharos',
    activeConversationTitle: '测试对话',
    activeCollaborator: {
      id: 'pharos',
      name: 'Pharos',
      advanced: {
        modelOverride: '',
        temperature: '',
        topP: '',
        maxTokens: '',
        thinkingBudget: '',
        contextMessageLimit: '',
        showThinking: true,
        streaming: true,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        snippets: []
      },
      systemPrompt: '',
      assistantIntro: '',
      userNickname: '',
      createdAt: 1,
      updatedAt: 1
    } as never
  } as unknown as ChatReplyRequestSnapshot;
  return {
    ...snapshot,
    ...overrides
  };
}

function buildWritableConversation(messages: ChatMessage[]): WritableConversationBody {
  return {
    conversationId: 'conversation-1',
    conversation: {
      id: 'conversation-1',
      title: '测试对话',
      collaboratorId: 'pharos',
      activeProjectId: null,
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages
    },
    messages
  };
}

function buildExecutedStartTaskOutcome(action: Extract<ToolActionRunOutcome['action'], { kind: 'startTask' }>): ToolActionRunOutcome {
  return {
    path: 'direct',
    status: 'executed',
    action,
    toolInvocation: {
      id: `tool-${action.capability ?? 'task'}`,
      kind: 'startTask',
      status: 'executed',
      title: '换肤任务',
      summary: '已开启任务'
    }
  };
}

describe('requestReply task activation', () => {
  it('auto-retries a tool preparation failure before showing a failed tool event', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-proactive',
      role: 'user',
      content: '把这条主动消息改到 22:30',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    const appendRuntimeFeedbackEvent = vi.fn();
    const insertMessageBefore = vi.fn();

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: '好，我来改。\n\n```polaris-tools {"actions":[{"kind":"updateProactiveMessageRule","ruleId":"trigger-1","unknown":"22:30"}]}```',
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '```polaris-tools {"actions":[{"kind":"updateProactiveMessageRule","ruleId":"trigger-1","time":"22:30"}]}```',
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '改好了，时间已经换到 22:30。',
        finishReason: 'stop'
      });

    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolActionRunOutcome['action'][]) =>
      actions.map((action) => {
        if (action.kind !== 'updateProactiveMessageRule') {
          throw new Error(`unexpected action ${action.kind}`);
        }
        return {
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: {
            id: 'tool-update-proactive',
            kind: 'updateProactiveMessageRule',
            status: 'executed',
            title: '修改主动消息规则',
            summary: '已修改主动消息规则 · 晚间问候'
          }
        } satisfies ToolActionRunOutcome;
      })
    );

    const baseSnapshot = buildRequestSnapshot(null);
    const requestSnapshot = buildRequestSnapshot(null, {
      enabledToolGroups: {
        ...baseSnapshot.enabledToolGroups,
        proactive: true
      } as never
    });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent,
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore,
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot,
      refreshRequestSnapshot: () => requestSnapshot
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(3);
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('工具准备没有通过');
    expect(executeToolActions).toHaveBeenCalledTimes(1);
    expect(executeToolActions.mock.calls[0]?.[1]).toEqual([expect.objectContaining({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      schedule: { kind: 'daily', time: '22:30' }
    })]);
    expect(appendRuntimeFeedbackEvent).not.toHaveBeenCalled();
    expect(insertMessageBefore).not.toHaveBeenCalled();
  });

  it('uses transcript tool history for ordinary tool followups', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-memory',
      role: 'user',
      content: '你觉得这份资料怎么样',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: '我先读一下。\n\n```polaris-tools {"actions":[{"kind":"readMemoryDoc","docId":"doc-1"}]}```',
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '读完了，我来说感受。',
        finishReason: 'stop'
      });

    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolActionRunOutcome['action'][]) =>
      actions.map((action) => {
        if (action.kind !== 'readMemoryDoc') {
          throw new Error(`unexpected action ${action.kind}`);
        }
        return {
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: {
            id: 'tool-read-memory-doc',
            kind: 'readMemoryDoc',
            status: 'executed',
            title: '读取长期资料',
            summary: '已读取长期资料 · 资料'
          }
        } satisfies ToolActionRunOutcome;
      })
    );

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(null),
      refreshRequestSnapshot: () => buildRequestSnapshot(null)
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.preferredOpenAiToolHistoryMode).toBeUndefined();
  });

  it('executes a native MCP tool call only once', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    resolveMcpToolCatalogMock.mockResolvedValueOnce({
      tools: [{
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-weather',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object'
        }
      }],
      errors: []
    });

    const userMessage: ChatMessage = {
      id: 'user-mcp',
      role: 'user',
      content: '查一下天气',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: '',
        finishReason: 'tool_calls',
        nativeToolCalls: [{
          id: 'call-weather',
          name: 'mcp__weather__get_weather',
          argumentsText: '{"city":"Shanghai"}'
        }]
      })
      .mockResolvedValueOnce({
        content: '天气查好了。',
        finishReason: 'stop'
      });

    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolActionRunOutcome['action'][]) =>
      actions.map((action) => {
        if (action.kind !== 'invokeMcpTool') {
          throw new Error(`unexpected action ${action.kind}`);
        }
        return {
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: {
            id: 'tool-weather',
            kind: 'invokeMcpTool',
            status: 'executed',
            title: '已调用 MCP 工具',
            summary: '已调用 MCP 工具 · Weather MCP / get_weather'
          }
        } satisfies ToolActionRunOutcome;
      })
    );

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        })
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(null),
      refreshRequestSnapshot: () => buildRequestSnapshot(null)
    });

    expect(executeToolActions).toHaveBeenCalledTimes(1);
    expect(executeToolActions.mock.calls[0]?.[1]).toEqual([{
      kind: 'invokeMcpTool',
      serverId: 'server-weather',
      serverName: 'Weather MCP',
      schemaName: 'mcp__weather__get_weather',
      toolName: 'get_weather',
      argumentsObject: {
        city: 'Shanghai'
      },
      targetLabel: 'Weather MCP / get_weather'
    }]);
  });

  it('auto-follows into a newly activated task without waiting for another user turn', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '做一个小页面',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let currentTask: ConversationTaskState | null = createConversationTaskShell({
      sourceMessage: userMessage,
      createdAt: 1
    });
    let streamingState: ChatStreamingState = null;
    let sending = false;

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: [
          '我来接这个活。',
          '```polaris-task {"id":"ignored","title":"做一个小页面","status":"running","stage":"开始搭页面","steps":[{"id":"step-1","title":"起页面壳","status":"in_progress"}]}```'
        ].join('\n\n')
      })
      .mockResolvedValueOnce({
        content: '继续往下做。',
        finishReason: 'stop'
      });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: (next) => {
          sending = next;
        },
        setStreaming: (next) => {
          streamingState = typeof next === 'function' ? next(streamingState) : next;
        },
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn((_conversationId, nextMessages) => {
          conversationMessages = nextMessages;
        }),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions: vi.fn(async () => []),
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(currentTask),
      refreshRequestSnapshot: () => buildRequestSnapshot(currentTask)
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(requestCollaboratorReplyMock.mock.calls[0]?.[0]?.currentTask?.mode).toBe('seed');
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.currentTask?.mode).toBe('active');
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.preferredOpenAiToolHistoryMode).toBeUndefined();
    expect(currentTask?.mode).toBe('active');
    expect(currentTask?.stage).toBe('开始搭页面');
    expect(streamingState).toEqual(expect.objectContaining({ phase: 'settling' }));
    expect(sending).toBe(false);
  });

  it('requires one theme tool turn after the assistant explicitly starts a theme task', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-theme',
      role: 'user',
      content: '给我换肤，随便换什么',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let currentTask: ConversationTaskState | null = createConversationTaskShell({
      sourceMessage: userMessage,
      createdAt: 1
    });

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: '```polaris-tools {"actions":[{"kind":"startTask","capability":"theme","title":"换肤任务","steps":["试穿主题"]}]}```',
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '我先接着试穿。',
        finishReason: 'stop'
      });

    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolActionRunOutcome['action'][]) =>
      actions.map((action) => {
        if (action.kind !== 'startTask') {
          throw new Error(`unexpected action ${action.kind}`);
        }
        return buildExecutedStartTaskOutcome(action);
      })
    );

    const buildSnapshot = () => buildRequestSnapshot(currentTask, {
      themeToolMode: 'creative'
    });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildSnapshot(),
      refreshRequestSnapshot: buildSnapshot
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.toolContext).toMatchObject({
      taskMode: 'active',
      toolEnforcementMode: 'force',
      toolEnforcementScope: 'theme-only'
    });
  });

  it('does not force tools after a general task activation', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-general',
      role: 'user',
      content: '先帮我慢慢分析这个问题',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let currentTask: ConversationTaskState | null = createConversationTaskShell({
      sourceMessage: userMessage,
      createdAt: 1
    });

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: '```polaris-tools {"actions":[{"kind":"startTask","capability":"general","title":"分析问题","steps":["先判断"]}]}```',
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '我先把这个问题拆开看。',
        finishReason: 'stop'
      });

    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolActionRunOutcome['action'][]) =>
      actions.map((action) => {
        if (action.kind !== 'startTask') {
          throw new Error(`unexpected action ${action.kind}`);
        }
        return buildExecutedStartTaskOutcome(action);
      })
    );

    const buildSnapshot = () => buildRequestSnapshot(currentTask);

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildSnapshot(),
      refreshRequestSnapshot: buildSnapshot
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.toolContext).toMatchObject({
      taskMode: 'active',
      toolEnforcementMode: 'normal'
    });
    expect(requestCollaboratorReplyMock.mock.calls[1]?.[0]?.toolContext.toolEnforcementScope).toBeUndefined();
  });

  it('completes a lingering running task when the model naturally stops without another tool call', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '看看那些皮肤为什么点不动',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let currentTask: ConversationTaskState | null = createConversationTaskShell({
      sourceMessage: userMessage,
      createdAt: 1,
      mode: 'active'
    });
    let streamingState: ChatStreamingState = null;

    requestCollaboratorReplyMock.mockResolvedValueOnce({
      content: [
        '我先读入口文件再看主题切换逻辑。',
        '```polaris-task {"id":"ignored","title":"检查皮肤切换","status":"running","stage":"正在看入口文件","focus":"我先确认主题切换脚本。","next":"等下核对样式文件路径。","steps":[{"id":"step-1","title":"读入口文件","status":"completed"},{"id":"step-2","title":"定位皮肤切换卡点","status":"in_progress"}]}```'
      ].join('\n\n'),
      finishReason: 'stop'
    });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: (next) => {
          streamingState = typeof next === 'function' ? next(streamingState) : next;
        },
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions: vi.fn(async () => []),
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(currentTask),
      refreshRequestSnapshot: () => buildRequestSnapshot(currentTask)
    });

    expect(currentTask).toMatchObject({
      status: 'completed',
      stage: '正在看入口文件',
      focus: undefined,
      next: undefined,
      steps: [
        { id: 'step-1', title: '读入口文件', status: 'completed' },
        { id: 'step-2', title: '定位皮肤切换卡点', status: 'completed' }
      ]
    });
    expect(streamingState).toEqual(expect.objectContaining({ phase: 'settling' }));
  });

  it('completes a single-step task after a direct card creation succeeds at the followup cap', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '把这段提醒放到房间里',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let toolLedger: ToolLedgerEntry[] | undefined;
    let currentTask: ConversationTaskState | null = {
      ...createConversationTaskShell({
        sourceMessage: userMessage,
        createdAt: 1,
        mode: 'active'
      }),
      title: '放置卡片到房间',
      stage: '准备放置',
      steps: [{
        id: 'step-1',
        title: '写入卡片内容',
        status: 'in_progress'
      }]
    };

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: [
          '```polaris-tools',
          '{"actions":[{"kind":"createCodeCard","card":{"title":"温柔的提醒","language":"markdown","code":"**今天的你**\\n\\n仍在坚持。"},"openInCollection":true}]}',
          '```'
        ].join('\n'),
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '已经放进房间了。',
        finishReason: 'stop'
      });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions: vi.fn(async (_conversationId, actions, options) => {
        const action = actions[0];
        if (!action || action.kind !== 'createCodeCard') {
          throw new Error('expected createCodeCard');
        }
        const assistantMessageId = options?.beforeMessageId ?? 'assistant-1';
        const toolCallId = options?.toolCallIds?.[0] ?? `${assistantMessageId}:tool-call:1`;
        const toolMessage: ChatMessage = {
          id: 'tool-created-card',
          role: 'system',
          content: '已创建卡片',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-created-card',
            kind: 'createCodeCard',
            status: 'executed',
            title: '已创建卡片',
            summary: '温柔的提醒',
            originMessageId: assistantMessageId,
            toolCallId
          }
        };
        conversationMessages = [...conversationMessages, toolMessage];
        toolLedger = [{
          id: `${assistantMessageId}:tool-ledger:1`,
          toolCallId,
          assistantMessageId,
          order: 0,
          toolName: 'createCodeCard',
          argumentsText: JSON.stringify({ card: action.card, openInCollection: true }),
          resultMessageId: toolMessage.id,
          resultToolName: 'createCodeCard',
          resultStatus: 'executed',
          resultIsError: false,
          resultSourceMessageId: assistantMessageId
        }];

        const outcome: ToolActionRunOutcome = {
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: toolMessage.toolInvocation!
        };
        return [outcome];
      }),
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(currentTask),
      refreshRequestSnapshot: () => buildRequestSnapshot(currentTask)
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(currentTask).toMatchObject({
      status: 'completed',
      stage: '已完成',
      focus: undefined,
      next: undefined,
      steps: [
        { id: 'step-1', title: '写入卡片内容', status: 'completed' }
      ]
    });
  });

  it('keeps a preview-verified task completed through the natural followup answer', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '这个工作区好像有点 bug 你修一下',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let toolLedger: ToolLedgerEntry[] | undefined;
    let currentTask: ConversationTaskState | null = {
      ...createConversationTaskShell({
        sourceMessage: userMessage,
        createdAt: 1,
        mode: 'active'
      }),
      title: '修复工作区 bug',
      stage: '检查工作区预览',
      steps: [{
        id: 'step-1',
        title: '检查工作区预览',
        status: 'in_progress'
      }]
    };
    const buildWorkspaceSnapshot = () => ({
      ...buildRequestSnapshot(currentTask),
      activeProjectId: 'mini-phone',
      roomProjects: [{
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: [],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      }]
    }) as ChatReplyRequestSnapshot;

    requestCollaboratorReplyMock
      .mockResolvedValueOnce({
        content: [
          '```polaris-tools',
          '{"actions":[{"kind":"checkProjectPreview","projectId":"mini-phone","targetLabel":"index.html"}]}',
          '```'
        ].join('\n'),
        finishReason: 'stop'
      })
      .mockResolvedValueOnce({
        content: '修好了，预览检查也通过了。',
        finishReason: 'stop'
      });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions: vi.fn(async (_conversationId, actions, options) => {
        const action = actions[0];
        if (!action || action.kind !== 'checkProjectPreview') {
          throw new Error('expected checkProjectPreview');
        }
        const assistantMessageId = options?.beforeMessageId ?? 'assistant-1';
        const toolCallId = options?.toolCallIds?.[0] ?? `${assistantMessageId}:tool-call:1`;
        const toolMessage: ChatMessage = {
          id: 'tool-preview-ok',
          role: 'system',
          content: '预览检查通过 · index.html',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-preview-ok',
            kind: 'checkProjectPreview',
            status: 'executed',
            title: '检查工作区预览',
            summary: '预览检查通过 · index.html',
            originMessageId: assistantMessageId,
            toolCallId,
            projectPreviewRunnable: true
          }
        };
        conversationMessages = [...conversationMessages, toolMessage];
        toolLedger = [{
          id: `${assistantMessageId}:tool-ledger:1`,
          toolCallId,
          assistantMessageId,
          order: 0,
          toolName: 'checkProjectPreview',
          argumentsText: JSON.stringify({ projectId: action.projectId }),
          resultMessageId: toolMessage.id,
          resultToolName: 'checkProjectPreview',
          resultStatus: 'executed',
          resultIsError: false,
          resultSourceMessageId: assistantMessageId
        }];

        const outcome: ToolActionRunOutcome = {
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: toolMessage.toolInvocation!,
          projectPreviewRunnable: true
        };
        return [outcome];
      }),
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildWorkspaceSnapshot(),
      refreshRequestSnapshot: buildWorkspaceSnapshot
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(currentTask).toMatchObject({
      status: 'completed',
      stage: '已完成',
      focus: undefined,
      next: undefined,
      steps: [
        { id: 'step-1', title: '检查工作区预览', status: 'completed' }
      ]
    });
  });

  it('completes the active task when the assistant calls completeTask', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '把工作区页面做完并检查',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    let currentTask: ConversationTaskState | null = {
      ...createConversationTaskShell({
        sourceMessage: userMessage,
        createdAt: 1,
        mode: 'active'
      }),
      title: '完成工作区页面',
      stage: '检查预览',
      steps: [
        { id: 'step-1', title: '写入文件', status: 'completed' },
        { id: 'step-2', title: '检查预览', status: 'in_progress' }
      ]
    };

    requestCollaboratorReplyMock.mockResolvedValueOnce({
      content: [
        '```polaris-tools',
        '{"actions":[{"kind":"completeTask","stage":"预览检查通过","summary":"页面文件已经写好，预览检查通过。"}]}',
        '```'
      ].join('\n'),
      finishReason: 'stop'
    }).mockResolvedValueOnce({
      content: '好了，页面文件已经写好，预览检查也通过了。',
      finishReason: 'stop'
    });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => currentTask),
        setConversationTask: vi.fn((_conversationId, nextTask) => {
          currentTask = nextTask;
        }),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions: vi.fn(async (_conversationId, actions, options) => {
        const action = actions[0];
        if (!action || action.kind !== 'completeTask') {
          throw new Error('expected completeTask');
        }
        return [{
          path: 'direct',
          status: 'executed',
          action,
          toolInvocation: {
            id: 'tool-complete-task',
            kind: 'completeTask',
            status: 'executed',
            title: '完成任务',
            summary: '预览检查通过',
            originMessageId: options?.beforeMessageId ?? 'assistant-1',
            toolCallId: options?.toolCallIds?.[0] ?? 'call-1'
          }
        }] satisfies ToolActionRunOutcome[];
      }),
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(currentTask),
      refreshRequestSnapshot: () => buildRequestSnapshot(currentTask)
    });

    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(conversationMessages[conversationMessages.length - 1]?.content).toContain('预览检查也通过了');
    expect(currentTask).toMatchObject({
      status: 'completed',
      stage: '预览检查通过',
      summary: '页面文件已经写好，预览检查通过。',
      focus: undefined,
      next: undefined,
      steps: [
        { id: 'step-1', title: '写入文件', status: 'completed' },
        { id: 'step-2', title: '检查预览', status: 'completed' }
      ]
    });
  });

  it('recovers visible workspace draft writes when the stream errors mid-file', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id)
    });
    requestCollaboratorReplyMock.mockReset();
    resolveMcpToolCatalogMock.mockClear();

    const userMessage: ChatMessage = {
      id: 'user-1',
      role: 'user',
      content: '继续写这个工作区页面',
      timestamp: 1,
      origin: 'user-input'
    };
    let conversationMessages: ChatMessage[] = [userMessage];
    const executeToolActions = vi.fn(async (_conversationId: string, actions: ToolAction[], options?: {
      beforeMessageId?: string;
      toolCallIds?: string[];
      signal?: AbortSignal;
    }) => actions.map((action) => ({
      path: 'direct' as const,
      status: 'executed' as const,
      action,
      toolInvocation: {
        id: `tool-${action.kind}`,
        kind: action.kind,
        status: 'executed' as const,
        title: '已写入工作区文件',
        summary: '已从中断流恢复工作区草稿',
        originMessageId: options?.beforeMessageId
      }
    })));

    requestCollaboratorReplyMock.mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.({
        content: [
          '我先把文件落下。',
          '```polaris-project-file {"projectId":"rental-check","filePath":"index.html","language":"html","fileRole":"entry","mode":"replace"}',
          '<main>Recovered before disconnect</main>'
        ].join('\n'),
        model: 'kimi-k2.6'
      });
      throw new Error('stream disconnected');
    }).mockResolvedValueOnce({
      content: '已接上刚才恢复写入的工作区文件，我会继续检查下一步。',
      finishReason: 'stop'
    });

    await requestReply({
      ui: {
        abortControllerRef: { current: null },
        setSending: vi.fn(),
        setStreaming: vi.fn(),
        streamingLifecycleReleaseRef: { current: null }
      },
      chat: {
        addMessage: (_conversationId, message) => {
          conversationMessages = [...conversationMessages, message];
        },
        appendRuntimeFeedbackEvent: vi.fn(),
        findConversation: vi.fn(() => ({
          id: 'conversation-1',
          title: '测试对话',
          collaboratorId: 'pharos',
          toolLedger: undefined
        })),
        insertMessageBefore: vi.fn(),
        findConversationMessage: vi.fn((_conversationId, messageId) =>
          conversationMessages.find((message) => message.id === messageId)
        ),
        getConversationMessages: vi.fn(() => conversationMessages),
        replaceConversationMessages: vi.fn(),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn((_conversationId, messageId, patch) => {
          conversationMessages = conversationMessages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message
          );
        }),
      },
      executeToolActions,
      conversationId: 'conversation-1',
      writableConversation: buildWritableConversation(conversationMessages),
      collaboratorId: 'pharos',
      messages: conversationMessages,
      requestSnapshot: buildRequestSnapshot(null, {
        activeProjectId: 'rental-check',
        roomProjects: [{
          id: 'rental-check',
          title: '出租屋验房单',
          slug: 'rental-check',
          fileIds: [],
          tags: [],
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }]
      }),
      refreshRequestSnapshot: () => buildRequestSnapshot(null, {
        activeProjectId: 'rental-check',
        roomProjects: [{
          id: 'rental-check',
          title: '出租屋验房单',
          slug: 'rental-check',
          fileIds: [],
          tags: [],
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }]
      })
    });

    expect(executeToolActions).toHaveBeenCalledTimes(1);
    expect(executeToolActions.mock.calls[0]?.[0]).toBe('conversation-1');
    expect(executeToolActions.mock.calls[0]?.[1]).toEqual([{
      kind: 'writeProjectFiles',
      projectId: 'rental-check',
      files: [{
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main>Recovered before disconnect</main>',
        replaceContent: true,
        projectId: 'rental-check'
      }],
      openInCollection: false
    }]);
    expect(executeToolActions.mock.calls[0]?.[2]?.beforeMessageId).toEqual(
      expect.stringMatching(/^assistant-/)
    );
    expect(requestCollaboratorReplyMock).toHaveBeenCalledTimes(2);
    expect(conversationMessages.some((message) =>
      message.role === 'assistant'
      && message.content.includes('已接上刚才恢复写入的工作区文件')
    )).toBe(true);
    expect(conversationMessages.some((message) =>
      message.role === 'system'
      && message.content.includes('流式连接提前结束')
    )).toBe(true);
  });
});
