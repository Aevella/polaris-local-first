import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatReplyRunner } from './chatReplyFlow';
import { DEFAULT_APP_CUSTOMIZATION } from '../../stores/runtimeStoreCustomization';
import type { ChatMessage } from '../../types/domain';
import type { WritableConversationBody } from '../../stores/chatStore';

const requestReplyMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const readConversationMessagesMock = vi.hoisted(() => vi.fn<(conversationId: string) => Promise<unknown>>(async () => []));

vi.mock('./chatReplyRuntime', () => ({
  requestReply: requestReplyMock
}));

vi.mock('../../stores/chatCurrentPersistence', () => ({
  readConversationMessages: readConversationMessagesMock
}));

function writableConversation(conversationId: string, messages: ChatMessage[] = []): WritableConversationBody {
  return {
    conversationId,
    conversation: {
      id: conversationId,
      title: '最新对话',
      collaboratorId: 'pharos',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages
    },
    messages
  };
}

describe('createChatReplyRunner', () => {
  beforeEach(() => {
    requestReplyMock.mockClear();
    readConversationMessagesMock.mockReset();
    readConversationMessagesMock.mockResolvedValue([]);
  });

  it.each([false, true])('builds fresh request snapshots with window model override %s', async (windowOverride) => {
    const ensureConversationTask = vi.fn(() => null);
    const liveMessages: ChatMessage[] = [{
      id: 'live-user-1',
      role: 'user',
      content: '事实源里的消息',
      timestamp: 10
    }];
    const staleMessages: ChatMessage[] = [{
      id: 'stale-user-1',
      role: 'user',
      content: '调用方旧消息',
      timestamp: 1
    }];
    const generationControls = {
      abortControllerRef: { current: null },
      setSending: vi.fn(),
      setStreaming: vi.fn(),
      streamingLifecycleReleaseRef: { current: null }
    };
    const getConversationGenerationControls = vi.fn(() => generationControls);
    const runner = createChatReplyRunner({
      ui: {
        themeToolModeSwitchRef: { current: null },
        getConversationGenerationControls,
        toolPromptPreferences: {} as never,
        taskModeEnabled: false
      },
      store: {
        chat: {
          conversations: [{
            id: 'stale-conversation',
            title: '旧对话',
            collaboratorId: 'pharos',
            activeProjectId: 'workspace-old',
            draft: '',
            pinnedAt: null,
            updatedAt: 1,
            messages: []
          }] as never[],
          pendingWorkspaceProposals: [] as never[],
          findConversation: vi.fn(),
          ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId, liveMessages)),
          addMessage: vi.fn(),
          insertMessageBefore: vi.fn(),
          insertMessageAfter: vi.fn(),
          findConversationMessage: vi.fn(),
          getConversationMessages: vi.fn(() => []),
          replaceConversationMessages: vi.fn(),
          updateMessage: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          getConversationTask: vi.fn(() => null),
          ensureConversationTask,
          setConversationTask: vi.fn(),
          readLatestState: () => ({
            conversations: [{
              id: 'conversation-1',
              title: '最新对话',
              windowPreferences: windowOverride ? { modelBinding: { providerId: 'window-route', model: 'window-model' } } : undefined,
              collaboratorId: 'pharos',
              activeProjectId: 'workspace-fresh',
              draft: '',
              pinnedAt: null,
              updatedAt: 2,
              messages: []
            }] as never[],
            pendingWorkspaceProposals: [{
              id: 'proposal-1',
              conversationId: 'conversation-1',
              source: 'model-proposed',
              requestedProjectTitle: 'Fresh Workspace',
              requestedActionKinds: ['createProjectFile'],
              requestedFilePaths: ['index.html'],
              status: 'pending',
              createdAt: 1,
              requestedActions: []
            }] as never[]
          })
        },
        persona: {
          personas: [] as never[],
          readLatestState: () => ({
            personas: [{
              id: 'pharos',
              name: 'Pharos',
              systemPrompt: '',
              assistantIntro: '',
              userNickname: '',
              createdAt: 1,
              updatedAt: 1
            }] as never[]
          })
        },
        collection: {
          cards: [] as never[],
          imageCards: [] as never[],
          projectFiles: [] as never[],
          roomProjects: [] as never[],
          readLatestState: () => ({
            cards: [] as never[],
            imageCards: [] as never[],
            projectFiles: [] as never[],
            workspaceReferenceDocs: [{
              id: 'reference-1',
              projectId: 'workspace-fresh',
              title: '项目说明',
              summary: '说明摘要',
              content: '说明正文',
              source: 'manual',
              createdAt: 1,
              updatedAt: 1
            }] as never[],
            roomProjects: [{
              id: 'workspace-fresh',
              title: 'Fresh Workspace',
              slug: 'fresh-workspace',
              fileIds: [],
              tags: [],
              source: 'chat-generated',
              createdAt: 1,
              updatedAt: 1
            }] as never[]
          })
        },
        runtime: {
          api: {
            id: 'stale-provider',
            name: 'Stale',
            kind: 'custom',
            baseUrl: 'https://stale.example.com',
            apiKey: '',
            model: 'old-model',
            capabilities: { images: false, toolUse: true, thinking: false }
          } as never,
          providers: [] as never[],
          memoryVectorRetrieval: { enabled: false },
          imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
          mcpServers: [] as never[],
          mcpToolTimeoutSeconds: 30,
          toolPromptPreferences: {} as never,
          taskModeEnabled: false,
          readLatestState: () => ({
            api: {
              id: 'live-provider',
              name: 'Live',
              kind: 'custom',
              baseUrl: 'https://live.example.com',
              apiKey: '',
              model: 'fresh-model',
              capabilities: { images: false, toolUse: true, thinking: false }
            } as never,
            providers: [{ id: 'window-route', name: 'Window route', kind: 'custom', protocol: 'openai-completions', baseUrl: 'https://window.example.test', path: '/v1/chat/completions', apiKey: '', model: 'route-default', capabilities: { images: false, thinking: false, streaming: true } }] as never[],
            memoryVectorRetrieval: { enabled: false },
            imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
            mcpServers: [] as never[],
            mcpToolTimeoutSeconds: 45,
            toolPromptPreferences: {} as never,
            taskModeEnabled: true
          })
        },
        space: {
          activeWorld: 'chat',
          collectionShelf: 'code',
          focusedMessageTarget: null,
          activeCardId: null,
          activeThemePreview: null,
          currentThemeFrame: {
            activePresetId: null,
            activeSavedSkinId: null,
            cssVariables: {},
            presetCSS: '',
            customCSS: '',
            generatedCSS: '',
            recipe: undefined
          },
          customization: DEFAULT_APP_CUSTOMIZATION,
          themeToolMode: 'off',
          selectedSurfaceCodes: [],
          readLatestState: () => ({
            activeWorld: 'collection' as const,
            collectionShelf: 'project' as const,
            activeCardId: 'card-live',
            activeThemePreview: null,
            currentThemeFrame: {
              activePresetId: null,
              activeSavedSkinId: null,
              cssVariables: {},
              presetCSS: '',
              customCSS: '',
              generatedCSS: '',
              recipe: undefined
            },
            customization: DEFAULT_APP_CUSTOMIZATION,
            themeToolMode: 'stable' as const,
            selectedSurfaceCodes: ['shell']
          })
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      toolActions: {
        submitAssistantToolActions: vi.fn()
      }
    });

    await runner({
      conversationId: 'conversation-1',
      collaboratorId: 'pharos',
      messages: staleMessages
    });

    expect(requestReplyMock).toHaveBeenCalledTimes(1);
    expect(ensureConversationTask).toHaveBeenCalledWith(
      'conversation-1',
      liveMessages,
      { mode: 'active' }
    );
    expect(getConversationGenerationControls).toHaveBeenCalledWith('conversation-1');
    expect(requestReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      collaboratorId: 'pharos',
      messages: liveMessages,
      requestSnapshot: expect.objectContaining({
        api: expect.objectContaining({
          id: windowOverride ? 'window-route' : 'live-provider',
          model: windowOverride ? 'window-model' : 'fresh-model'
        }),
        activeWorld: 'collection',
        collectionShelf: 'project',
        activeCardId: 'card-live',
        activeProjectId: 'workspace-fresh',
        taskModeEnabled: true,
        pendingWorkspaceProposal: expect.objectContaining({
          id: 'proposal-1',
          conversationId: 'conversation-1'
        }),
        workspaceReferenceDocs: [
          expect.objectContaining({
            id: 'reference-1',
            title: '项目说明'
          })
        ]
      })
    }));
  });

  it('uses the current chat catalog for recall without rereading persisted catalog rows', async () => {
    const latestConversations = [
      {
        id: 'conversation-1',
        title: '当前对话',
        collaboratorId: 'pharos',
        activeProjectId: null,
        draft: '',
        pinnedAt: null,
        updatedAt: 2,
        messages: []
      },
      {
        id: 'conversation-old',
        title: '旧对话',
        collaboratorId: 'pharos',
        activeProjectId: null,
        draft: '',
        pinnedAt: null,
        updatedAt: 1,
        messages: []
      },
      {
        id: 'conversation-group',
        title: '群聊',
        kind: 'group',
        group: { title: '群聊', memberIds: [] },
        collaboratorId: 'pharos',
        activeProjectId: null,
        draft: '',
        pinnedAt: null,
        updatedAt: 3,
        messages: []
      }
    ] as never[];
    readConversationMessagesMock.mockResolvedValue([{
      id: 'old-user-1',
      role: 'user',
      content: '以前聊过跨对话记忆的地基',
      timestamp: 1
    }]);
    const generationControls = {
      abortControllerRef: { current: null },
      setSending: vi.fn(),
      setStreaming: vi.fn(),
      streamingLifecycleReleaseRef: { current: null }
    };
    const runner = createChatReplyRunner({
      ui: {
        themeToolModeSwitchRef: { current: null },
        getConversationGenerationControls: vi.fn(() => generationControls),
        toolPromptPreferences: {} as never,
        taskModeEnabled: false
      },
      store: {
        chat: {
          conversations: latestConversations,
          pendingWorkspaceProposals: [] as never[],
          findConversation: vi.fn(),
          ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
          addMessage: vi.fn(),
          insertMessageBefore: vi.fn(),
          insertMessageAfter: vi.fn(),
          findConversationMessage: vi.fn(),
          getConversationMessages: vi.fn(() => []),
          replaceConversationMessages: vi.fn(),
          updateMessage: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          getConversationTask: vi.fn(() => null),
          ensureConversationTask: vi.fn(() => null),
          setConversationTask: vi.fn(),
          readLatestState: () => ({
            conversations: latestConversations,
            pendingWorkspaceProposals: [] as never[]
          })
        },
        persona: {
          personas: [] as never[],
          readLatestState: () => ({
            personas: [{
              id: 'pharos',
              name: 'Pharos',
              systemPrompt: '',
              assistantIntro: '',
              userNickname: '',
              createdAt: 1,
              updatedAt: 1
            }] as never[]
          })
        },
        collection: {
          cards: [] as never[],
          imageCards: [] as never[],
          projectFiles: [] as never[],
          roomProjects: [] as never[],
          readLatestState: () => ({
            cards: [] as never[],
            imageCards: [] as never[],
            projectFiles: [] as never[],
            workspaceReferenceDocs: [] as never[],
            roomProjects: [] as never[]
          })
        },
        runtime: {
          api: {
            id: 'provider',
            name: 'Provider',
            kind: 'custom',
            baseUrl: 'https://provider.example.com',
            apiKey: '',
            model: 'model',
            capabilities: { images: false, toolUse: true, thinking: false }
          } as never,
          providers: [] as never[],
          memoryVectorRetrieval: { enabled: false },
          imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
          mcpServers: [] as never[],
          mcpToolTimeoutSeconds: 30,
          toolPromptPreferences: {} as never,
          taskModeEnabled: false,
          readLatestState: () => ({
            api: {
              id: 'provider',
              name: 'Provider',
              kind: 'custom',
              baseUrl: 'https://provider.example.com',
              apiKey: '',
              model: 'model',
              capabilities: { images: false, toolUse: true, thinking: false }
            } as never,
            providers: [] as never[],
            memoryVectorRetrieval: { enabled: false },
            imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
            mcpServers: [] as never[],
            mcpToolTimeoutSeconds: 30,
            toolPromptPreferences: {} as never,
            taskModeEnabled: false
          })
        },
        space: {
          activeWorld: 'chat',
          collectionShelf: 'code',
          focusedMessageTarget: null,
          activeCardId: null,
          activeThemePreview: null,
          currentThemeFrame: {
            activePresetId: null,
            activeSavedSkinId: null,
            cssVariables: {},
            presetCSS: '',
            customCSS: '',
            generatedCSS: '',
            recipe: undefined
          },
          customization: DEFAULT_APP_CUSTOMIZATION,
          themeToolMode: 'off',
          selectedSurfaceCodes: [],
          readLatestState: () => ({
            activeWorld: 'chat' as const,
            collectionShelf: 'code' as const,
            activeCardId: null,
            activeThemePreview: null,
            currentThemeFrame: {
              activePresetId: null,
              activeSavedSkinId: null,
              cssVariables: {},
              presetCSS: '',
              customCSS: '',
              generatedCSS: '',
              recipe: undefined
            },
            customization: DEFAULT_APP_CUSTOMIZATION,
            themeToolMode: 'off' as const,
            selectedSurfaceCodes: []
          })
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      toolActions: {
        submitAssistantToolActions: vi.fn()
      }
    });

    await runner({
      conversationId: 'conversation-1',
      collaboratorId: 'pharos',
      messages: []
    });

    expect(readConversationMessagesMock).toHaveBeenCalledWith('conversation-old');
    expect(readConversationMessagesMock).not.toHaveBeenCalledWith('conversation-group');
    const requestReplyCalls = requestReplyMock.mock.calls as unknown as Array<[{
      requestSnapshot: {
        conversations: Array<{ id: string }>;
        semanticRecallConversations: Array<{ id: string }>;
      };
    }]>;
    const requestSnapshot = requestReplyCalls[0][0].requestSnapshot;
    expect(requestSnapshot.conversations.map((conversation: { id: string }) => conversation.id)).toEqual([
      'conversation-1',
      'conversation-old'
    ]);
    expect(requestSnapshot.semanticRecallConversations.map((conversation: { id: string }) => conversation.id)).not.toContain(
      'conversation-group'
    );
    expect(requestReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      requestSnapshot: expect.objectContaining({
        conversations: latestConversations.filter(
          (conversation: { id: string }) => conversation.id !== 'conversation-group'
        ),
        semanticRecallConversations: expect.arrayContaining([
          expect.objectContaining({
            id: 'conversation-old',
            messages: [expect.objectContaining({
              id: 'old-user-1',
              content: '以前聊过跨对话记忆的地基'
            })]
          })
        ])
      })
    }));
  });

  it('does not read old conversation bodies when cross-conversation recall is disabled', async () => {
    const latestConversations = [{
      id: 'conversation-1',
      title: '当前对话',
      collaboratorId: 'pharos',
      activeProjectId: null,
      draft: '',
      pinnedAt: null,
      updatedAt: 2,
      messages: []
    }] as never[];
    const generationControls = {
      abortControllerRef: { current: null },
      setSending: vi.fn(),
      setStreaming: vi.fn(),
      streamingLifecycleReleaseRef: { current: null }
    };
    const disabledRecallPersona = {
      id: 'pharos',
      name: 'Pharos',
      memory: {
        crossConversationRecallEnabled: false
      }
    } as never;
    const runtimeState = {
      api: {
        id: 'provider',
        name: 'Provider',
        kind: 'custom',
        baseUrl: 'https://provider.example.com',
        apiKey: '',
        model: 'model',
        capabilities: { images: false, toolUse: true, thinking: false }
      } as never,
      providers: [] as never[],
      memoryVectorRetrieval: { enabled: false },
      imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
      mcpServers: [] as never[],
      mcpToolTimeoutSeconds: 30,
      toolPromptPreferences: {} as never,
      taskModeEnabled: false
    };
    const spaceState = {
      activeWorld: 'chat' as const,
      collectionShelf: 'code' as const,
      activeCardId: null,
      activeThemePreview: null,
      currentThemeFrame: {
        activePresetId: null,
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: '',
        recipe: undefined
      },
      customization: DEFAULT_APP_CUSTOMIZATION,
      themeToolMode: 'off' as const,
      selectedSurfaceCodes: []
    };
    const runner = createChatReplyRunner({
      ui: {
        themeToolModeSwitchRef: { current: null },
        getConversationGenerationControls: vi.fn(() => generationControls),
        toolPromptPreferences: {} as never,
        taskModeEnabled: false
      },
      store: {
        chat: {
          conversations: latestConversations,
          pendingWorkspaceProposals: [] as never[],
          findConversation: vi.fn(),
          ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
          addMessage: vi.fn(),
          insertMessageBefore: vi.fn(),
          insertMessageAfter: vi.fn(),
          findConversationMessage: vi.fn(),
          getConversationMessages: vi.fn(() => []),
          replaceConversationMessages: vi.fn(),
          updateMessage: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          getConversationTask: vi.fn(() => null),
          ensureConversationTask: vi.fn(() => null),
          setConversationTask: vi.fn(),
          readLatestState: () => ({
            conversations: latestConversations,
            pendingWorkspaceProposals: [] as never[]
          })
        },
        persona: {
          personas: [disabledRecallPersona],
          readLatestState: () => ({
            personas: [disabledRecallPersona]
          })
        },
        collection: {
          cards: [] as never[],
          imageCards: [] as never[],
          projectFiles: [] as never[],
          roomProjects: [] as never[],
          readLatestState: () => ({
            cards: [] as never[],
            imageCards: [] as never[],
            projectFiles: [] as never[],
            workspaceReferenceDocs: [] as never[],
            roomProjects: [] as never[]
          })
        },
        runtime: {
          ...runtimeState,
          readLatestState: () => runtimeState
        },
        space: {
          ...spaceState,
          focusedMessageTarget: null,
          readLatestState: () => spaceState
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: disabledRecallPersona,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      toolActions: {
        submitAssistantToolActions: vi.fn()
      }
    });

    await runner({
      conversationId: 'conversation-1',
      collaboratorId: 'pharos',
      messages: []
    });

    expect(readConversationMessagesMock).not.toHaveBeenCalled();
    expect(requestReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      requestSnapshot: expect.objectContaining({
        semanticRecallConversations: []
      })
    }));
  });

  it('lets a request-scope owner disable semantic recall before old bodies are read', async () => {
    const latestConversations = [{
      id: 'conversation-1',
      title: '当前对话',
      collaboratorId: 'pharos',
      activeProjectId: null,
      draft: '',
      pinnedAt: null,
      updatedAt: 2,
      messages: []
    }, {
      id: 'conversation-old',
      title: '旧对话',
      collaboratorId: 'pharos',
      activeProjectId: null,
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    }] as never[];
    readConversationMessagesMock.mockResolvedValue([{
      id: 'old-user-1',
      role: 'user',
      content: '以前聊过跨对话记忆的地基',
      timestamp: 1
    }]);
    const generationControls = {
      abortControllerRef: { current: null },
      setSending: vi.fn(),
      setStreaming: vi.fn(),
      streamingLifecycleReleaseRef: { current: null }
    };
    const persona = {
      id: 'pharos',
      name: 'Pharos',
      memory: {
        crossConversationRecallEnabled: true
      }
    } as never;
    const runtimeState = {
      api: {
        id: 'provider',
        name: 'Provider',
        kind: 'custom',
        baseUrl: 'https://provider.example.com',
        apiKey: '',
        model: 'model',
        capabilities: { images: false, toolUse: true, thinking: false }
      } as never,
      providers: [] as never[],
      memoryVectorRetrieval: { enabled: false },
      imageGeneration: { enabled: false },
            imageUnderstanding: { enabled: false },
      mcpServers: [] as never[],
      mcpToolTimeoutSeconds: 30,
      toolPromptPreferences: {} as never,
      taskModeEnabled: false
    };
    const spaceState = {
      activeWorld: 'chat' as const,
      collectionShelf: 'code' as const,
      activeCardId: null,
      activeThemePreview: null,
      currentThemeFrame: {
        activePresetId: null,
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: '',
        recipe: undefined
      },
      customization: DEFAULT_APP_CUSTOMIZATION,
      themeToolMode: 'off' as const,
      selectedSurfaceCodes: []
    };
    const runner = createChatReplyRunner({
      ui: {
        themeToolModeSwitchRef: { current: null },
        getConversationGenerationControls: vi.fn(() => generationControls),
        toolPromptPreferences: {} as never,
        taskModeEnabled: false
      },
      store: {
        chat: {
          conversations: latestConversations,
          pendingWorkspaceProposals: [] as never[],
          findConversation: vi.fn(),
          ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
          addMessage: vi.fn(),
          insertMessageBefore: vi.fn(),
          insertMessageAfter: vi.fn(),
          findConversationMessage: vi.fn(),
          getConversationMessages: vi.fn(() => []),
          replaceConversationMessages: vi.fn(),
          updateMessage: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          getConversationTask: vi.fn(() => null),
          ensureConversationTask: vi.fn(() => null),
          setConversationTask: vi.fn(),
          readLatestState: () => ({
            conversations: latestConversations,
            pendingWorkspaceProposals: [] as never[]
          })
        },
        persona: {
          personas: [persona],
          readLatestState: () => ({
            personas: [persona]
          })
        },
        collection: {
          cards: [] as never[],
          imageCards: [] as never[],
          projectFiles: [] as never[],
          roomProjects: [] as never[],
          readLatestState: () => ({
            cards: [] as never[],
            imageCards: [] as never[],
            projectFiles: [] as never[],
            workspaceReferenceDocs: [] as never[],
            roomProjects: [] as never[]
          })
        },
        runtime: {
          ...runtimeState,
          readLatestState: () => runtimeState
        },
        space: {
          ...spaceState,
          focusedMessageTarget: null,
          readLatestState: () => spaceState
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      toolActions: {
        submitAssistantToolActions: vi.fn()
      },
      resolveSemanticRecallEnabled: () => false
    });

    await runner({
      conversationId: 'conversation-1',
      collaboratorId: 'pharos',
      messages: []
    });

    expect(readConversationMessagesMock).not.toHaveBeenCalled();
    expect(requestReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      requestSnapshot: expect.objectContaining({
        semanticRecallEnabled: false,
        semanticRecallConversations: []
      })
    }));
  });
});
