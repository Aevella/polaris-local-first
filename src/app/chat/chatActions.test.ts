import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitMessageMock: vi.fn(() => Promise.resolve()),
  chatState: {
    inputDraft: '',
    conversations: [] as Array<{
      id: string;
      title: string;
      collaboratorId: string | null;
      activeProjectId?: string | null;
      messages: unknown[];
    }>,
    activeConversationId: null as string | null
  },
  personaState: {
    activeCollaboratorId: 'pharos',
    personas: [{ id: 'pharos', name: 'Pharos' }] as never[]
  },
  spaceState: {
    frontstageCollaboratorId: 'pharos',
    pendingAttachments: [] as never[],
    pendingCardReference: null as null
  }
}));

vi.mock('./chatSubmitFlow', () => ({
  buildSubmitFingerprint: (inputDraft: string) => inputDraft,
  submitMessage: mocks.submitMessageMock
}));

vi.mock('./chatCompanionSubmit', () => ({
  submitCompanionMessage: vi.fn(() => Promise.resolve())
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => mocks.chatState
  }
}));

vi.mock('../../stores/personaStore', () => ({
  usePersonaStore: {
    getState: () => mocks.personaState
  }
}));

vi.mock('../../stores/spaceStore', () => ({
  useSpaceStore: {
    getState: () => mocks.spaceState
  }
}));

import { createChatActionHandlers } from './chatActions';

describe('createChatActionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.inputDraft = '';
    mocks.chatState.conversations = [];
    mocks.chatState.activeConversationId = null;
    mocks.personaState.activeCollaboratorId = 'pharos';
    mocks.personaState.personas = [{ id: 'pharos', name: 'Pharos' }] as never[];
    mocks.spaceState.frontstageCollaboratorId = 'pharos';
    mocks.spaceState.pendingAttachments = [] as never[];
    mocks.spaceState.pendingCardReference = null;
  });

  it('creates a fresh conversation without inheriting the active workspace', () => {
    mocks.chatState.conversations = [
      {
        id: 'conv-workspace',
        title: '工作区对话',
        collaboratorId: 'pharos',
        activeProjectId: 'workspace-3',
        messages: []
      }
    ];
    mocks.chatState.activeConversationId = 'conv-workspace';
    const createConversationSpy = vi.fn(() => 'conv-new');
    const setActiveConversationSpy = vi.fn();
    const handlers = createChatActionHandlers({
      startupReady: true,
      ui: {
        sending: false,
        editing: null,
        confirm: vi.fn(() => true),
        setCommandStatus: vi.fn(),
        triggerSubmitFlight: vi.fn(),
        cancelEditingMessage: vi.fn()
      },
      store: {
        chat: {
          conversations: [],
          activeConversationId: null,
          inputDraft: '',
          pendingWorkspaceProposals: [],
          createConversation: createConversationSpy,
          ensureConversationWritable: vi.fn(async (conversationId: string) => ({
            conversationId,
            conversation: { id: conversationId, title: '', collaboratorId: 'pharos', messages: [] } as never,
            messages: []
          })),
          addMessage: vi.fn(),
          orphanConversation: vi.fn(),
          deleteConversation: vi.fn(),
          setInputDraft: vi.fn(),
          replaceConversationMessages: vi.fn(),
          setConversationTask: vi.fn(),
          updateMessage: vi.fn(),
          setConversationActiveProject: vi.fn(),
          upsertPendingWorkspaceProposal: vi.fn(),
          removePendingWorkspaceProposal: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          setActiveConversation: setActiveConversationSpy,
          readLatestState: () => ({
            inputDraft: mocks.chatState.inputDraft,
            conversations: mocks.chatState.conversations as never[],
            activeConversationId: mocks.chatState.activeConversationId,
            pendingWorkspaceProposals: []
          })
        },
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [{ id: 'pharos', name: 'Pharos' }] as never[],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: mocks.personaState.activeCollaboratorId,
            personas: mocks.personaState.personas as never[]
          })
        },
        space: {
          frontstageCollaboratorId: 'pharos',
          editingCollaboratorId: null,
          pendingCardReference: null,
          pendingAttachments: [],
          setFrontstageCollaboratorId: vi.fn(),
          setEditingCollaboratorId: vi.fn(),
          setPendingCardReference: vi.fn(),
          clearPendingCardReference: vi.fn(),
          clearPendingAttachments: vi.fn(),
          readLatestState: () => ({
            frontstageCollaboratorId: mocks.spaceState.frontstageCollaboratorId,
            pendingCardReference: mocks.spaceState.pendingCardReference,
            pendingAttachments: mocks.spaceState.pendingAttachments as never[]
          }),
          rollbackPreviewForConversationDeletion: vi.fn(() => false)
        },
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      runReply: vi.fn(() => Promise.resolve()),
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    });

    handlers.createConversation();

    expect(createConversationSpy).toHaveBeenCalledWith('pharos');
    expect(setActiveConversationSpy).toHaveBeenCalledWith('conv-new');
  });

  it('submits using the latest chat store snapshot instead of stale bindings', async () => {
    mocks.chatState.inputDraft = '你接着做';
    mocks.chatState.conversations = [
      {
        id: 'conv-new',
        title: '新工作区对话',
        collaboratorId: 'pharos',
        activeProjectId: 'workspace-new',
        messages: []
      }
    ];
    mocks.chatState.activeConversationId = 'conv-new';
    const handlers = createChatActionHandlers({
      startupReady: true,
      ui: {
        sending: false,
        editing: null,
        confirm: vi.fn(() => true),
        setCommandStatus: vi.fn(),
        triggerSubmitFlight: vi.fn(),
        cancelEditingMessage: vi.fn()
      },
      store: {
        chat: {
          conversations: [
            {
              id: 'conv-old',
              title: '旧对话',
              collaboratorId: 'pharos',
              activeProjectId: 'workspace-old',
              messages: []
            }
          ] as never[],
          activeConversationId: 'conv-old',
          inputDraft: '旧草稿',
          pendingWorkspaceProposals: [],
          createConversation: vi.fn(() => 'conv-fallback'),
          ensureConversationWritable: vi.fn(async (conversationId: string) => ({
            conversationId,
            conversation: { id: conversationId, title: '', collaboratorId: 'pharos', messages: [] } as never,
            messages: []
          })),
          addMessage: vi.fn(),
          orphanConversation: vi.fn(),
          deleteConversation: vi.fn(),
          setInputDraft: vi.fn(),
          replaceConversationMessages: vi.fn(),
          setConversationTask: vi.fn(),
          updateMessage: vi.fn(),
          setConversationActiveProject: vi.fn(),
          upsertPendingWorkspaceProposal: vi.fn(),
          removePendingWorkspaceProposal: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          setActiveConversation: vi.fn(),
          readLatestState: () => ({
            inputDraft: mocks.chatState.inputDraft,
            conversations: mocks.chatState.conversations as never[],
            activeConversationId: mocks.chatState.activeConversationId,
            pendingWorkspaceProposals: []
          })
        },
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [{ id: 'pharos', name: 'Pharos' }] as never[],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: mocks.personaState.activeCollaboratorId,
            personas: mocks.personaState.personas as never[]
          })
        },
        space: {
          frontstageCollaboratorId: 'pharos',
          editingCollaboratorId: null,
          pendingCardReference: null,
          pendingAttachments: [],
          setFrontstageCollaboratorId: vi.fn(),
          setEditingCollaboratorId: vi.fn(),
          setPendingCardReference: vi.fn(),
          clearPendingCardReference: vi.fn(),
          clearPendingAttachments: vi.fn(),
          readLatestState: () => ({
            frontstageCollaboratorId: mocks.spaceState.frontstageCollaboratorId,
            pendingCardReference: mocks.spaceState.pendingCardReference,
            pendingAttachments: mocks.spaceState.pendingAttachments as never[]
          }),
          rollbackPreviewForConversationDeletion: vi.fn(() => false)
        },
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: {
          id: 'conv-old',
          title: '旧对话',
          collaboratorId: 'pharos',
          activeProjectId: 'workspace-old',
          messages: []
        },
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      runReply: vi.fn(() => Promise.resolve()),
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    });

    await handlers.handleSubmit();

    expect(mocks.submitMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      inputDraft: '你接着做',
      activeConversationId: 'conv-new',
      conversations: expect.arrayContaining([
        expect.objectContaining({
          id: 'conv-new',
          activeProjectId: 'workspace-new'
        })
      ])
    }), expect.any(Object));
  });

  it('does not copy the active conversation workspace into a fresh chat', () => {
    mocks.chatState.conversations = [
      {
        id: 'conv-workspace',
        title: '工作区对话',
        collaboratorId: 'pharos',
        activeProjectId: 'workspace-7',
        messages: []
      }
    ];
    mocks.chatState.activeConversationId = 'conv-workspace';
    const createConversationSpy = vi.fn(() => 'conv-next');
    const handlers = createChatActionHandlers({
      startupReady: true,
      ui: {
        sending: false,
        editing: null,
        confirm: vi.fn(() => true),
        setCommandStatus: vi.fn(),
        triggerSubmitFlight: vi.fn(),
        cancelEditingMessage: vi.fn()
      },
      store: {
        chat: {
          conversations: [],
          activeConversationId: null,
          inputDraft: '',
          pendingWorkspaceProposals: [],
          createConversation: createConversationSpy,
          ensureConversationWritable: vi.fn(async (conversationId: string) => ({
            conversationId,
            conversation: { id: conversationId, title: '', collaboratorId: 'pharos', messages: [] } as never,
            messages: []
          })),
          addMessage: vi.fn(),
          orphanConversation: vi.fn(),
          deleteConversation: vi.fn(),
          setInputDraft: vi.fn(),
          replaceConversationMessages: vi.fn(),
          setConversationTask: vi.fn(),
          updateMessage: vi.fn(),
          setConversationActiveProject: vi.fn(),
          upsertPendingWorkspaceProposal: vi.fn(),
          removePendingWorkspaceProposal: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          setActiveConversation: vi.fn(),
          readLatestState: () => ({
            inputDraft: mocks.chatState.inputDraft,
            conversations: mocks.chatState.conversations as never[],
            activeConversationId: mocks.chatState.activeConversationId,
            pendingWorkspaceProposals: []
          })
        },
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [{ id: 'pharos', name: 'Pharos' }] as never[],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: mocks.personaState.activeCollaboratorId,
            personas: mocks.personaState.personas as never[]
          })
        },
        space: {
          frontstageCollaboratorId: 'pharos',
          editingCollaboratorId: null,
          pendingCardReference: null,
          pendingAttachments: [],
          setFrontstageCollaboratorId: vi.fn(),
          setEditingCollaboratorId: vi.fn(),
          setPendingCardReference: vi.fn(),
          clearPendingCardReference: vi.fn(),
          clearPendingAttachments: vi.fn(),
          readLatestState: () => ({
            frontstageCollaboratorId: mocks.spaceState.frontstageCollaboratorId,
            pendingCardReference: mocks.spaceState.pendingCardReference,
            pendingAttachments: mocks.spaceState.pendingAttachments as never[]
          }),
          rollbackPreviewForConversationDeletion: vi.fn(() => false)
        },
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      runReply: vi.fn(() => Promise.resolve()),
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    });

    handlers.createConversation();

    expect(createConversationSpy).toHaveBeenCalledWith('pharos');
  });

  it('does not invent a workspace when there is no active conversation binding', () => {
    mocks.chatState.conversations = [];
    mocks.chatState.activeConversationId = null;

    const createConversationSpy = vi.fn(() => 'conv-next');
    const handlers = createChatActionHandlers({
      startupReady: true,
      ui: {
        sending: false,
        editing: null,
        confirm: vi.fn(() => true),
        setCommandStatus: vi.fn(),
        triggerSubmitFlight: vi.fn(),
        cancelEditingMessage: vi.fn()
      },
      store: {
        chat: {
          conversations: [],
          activeConversationId: null,
          inputDraft: '',
          pendingWorkspaceProposals: [],
          createConversation: createConversationSpy,
          ensureConversationWritable: vi.fn(async (conversationId: string) => ({
            conversationId,
            conversation: { id: conversationId, title: '', collaboratorId: 'pharos', messages: [] } as never,
            messages: []
          })),
          addMessage: vi.fn(),
          orphanConversation: vi.fn(),
          deleteConversation: vi.fn(),
          setInputDraft: vi.fn(),
          replaceConversationMessages: vi.fn(),
          setConversationTask: vi.fn(),
          updateMessage: vi.fn(),
          setConversationActiveProject: vi.fn(),
          upsertPendingWorkspaceProposal: vi.fn(),
          removePendingWorkspaceProposal: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          setActiveConversation: vi.fn(),
          readLatestState: () => ({
            inputDraft: mocks.chatState.inputDraft,
            conversations: mocks.chatState.conversations as never[],
            activeConversationId: mocks.chatState.activeConversationId,
            pendingWorkspaceProposals: []
          })
        },
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [{ id: 'pharos', name: 'Pharos' }] as never[],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: mocks.personaState.activeCollaboratorId,
            personas: mocks.personaState.personas as never[]
          })
        },
        space: {
          frontstageCollaboratorId: 'pharos',
          editingCollaboratorId: null,
          pendingCardReference: null,
          pendingAttachments: [],
          setFrontstageCollaboratorId: vi.fn(),
          setEditingCollaboratorId: vi.fn(),
          setPendingCardReference: vi.fn(),
          clearPendingCardReference: vi.fn(),
          clearPendingAttachments: vi.fn(),
          readLatestState: () => ({
            frontstageCollaboratorId: mocks.spaceState.frontstageCollaboratorId,
            pendingCardReference: mocks.spaceState.pendingCardReference,
            pendingAttachments: mocks.spaceState.pendingAttachments as never[]
          }),
          rollbackPreviewForConversationDeletion: vi.fn(() => false)
        },
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      runReply: vi.fn(() => Promise.resolve()),
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    });

    handlers.createConversation();

    expect(createConversationSpy).toHaveBeenCalledWith('pharos');
  });

  it('retries an assistant message from the writable conversation body instead of stale derived messages', async () => {
    const staleMessages = [
      { id: 'user-stale', role: 'user', content: '旧投影', timestamp: 1 },
      { id: 'assistant-1', role: 'assistant', content: '旧回答', timestamp: 2 }
    ];
    const liveMessages = [
      { id: 'user-live', role: 'user', content: '事实源里的用户消息', timestamp: 10 },
      { id: 'assistant-1', role: 'assistant', content: '事实源里的回答', timestamp: 11 }
    ];
    const replaceConversationMessages = vi.fn();
    const runReply = vi.fn(() => Promise.resolve());
    const handlers = createChatActionHandlers({
      startupReady: true,
      ui: {
        sending: false,
        editing: null,
        confirm: vi.fn(() => true),
        setCommandStatus: vi.fn(),
        triggerSubmitFlight: vi.fn(),
        cancelEditingMessage: vi.fn()
      },
      store: {
        chat: {
          conversations: [],
          activeConversationId: null,
          inputDraft: '',
          pendingWorkspaceProposals: [],
          createConversation: vi.fn(() => 'conv-next'),
          ensureConversationWritable: vi.fn(async (conversationId: string) => ({
            conversationId,
            conversation: {
              id: conversationId,
              title: '事实源对话',
              collaboratorId: 'pharos',
              messages: liveMessages
            } as never,
            messages: liveMessages as never[]
          })),
          addMessage: vi.fn(),
          orphanConversation: vi.fn(),
          deleteConversation: vi.fn(),
          setInputDraft: vi.fn(),
          replaceConversationMessages,
          setConversationTask: vi.fn(),
          updateMessage: vi.fn(),
          setConversationActiveProject: vi.fn(),
          upsertPendingWorkspaceProposal: vi.fn(),
          removePendingWorkspaceProposal: vi.fn(),
          appendRuntimeFeedbackEvent: vi.fn(),
          getRuntimeFeedbackEvents: vi.fn(() => []),
          setActiveConversation: vi.fn(),
          readLatestState: () => ({
            inputDraft: '',
            conversations: [],
            activeConversationId: null,
            pendingWorkspaceProposals: []
          })
        },
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [{ id: 'pharos', name: 'Pharos' }] as never[],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: 'pharos',
            personas: [{ id: 'pharos', name: 'Pharos' }] as never[]
          })
        },
        space: {
          frontstageCollaboratorId: 'pharos',
          editingCollaboratorId: null,
          pendingCardReference: null,
          pendingAttachments: [],
          setFrontstageCollaboratorId: vi.fn(),
          setEditingCollaboratorId: vi.fn(),
          setPendingCardReference: vi.fn(),
          clearPendingCardReference: vi.fn(),
          clearPendingAttachments: vi.fn(),
          readLatestState: () => ({
            frontstageCollaboratorId: 'pharos',
            pendingCardReference: null,
            pendingAttachments: []
          }),
          rollbackPreviewForConversationDeletion: vi.fn(() => false)
        },
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: {
          id: 'conv-1',
          title: '旧投影对话',
          collaboratorId: 'pharos',
          messages: staleMessages
        } as never,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {}
      },
      runReply,
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    });

    await handlers.retryLatestAssistant(staleMessages[1] as never);

    expect(replaceConversationMessages).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1'
    }), [
      expect.objectContaining({ id: 'user-live', content: '事实源里的用户消息' })
    ]);
    expect(runReply).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        expect.objectContaining({ id: 'user-live', content: '事实源里的用户消息' })
      ]
    }));
  });

});
