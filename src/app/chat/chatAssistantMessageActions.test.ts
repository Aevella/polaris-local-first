import { describe, expect, it, vi } from 'vitest';
import type { ChatActionStoreBindings, ChatDerivedStatePort, ChatUiActionState } from './chatPorts';
import { createChatActionHandlers } from './chatActions';
import type { ChatMessage, Conversation } from '../../types/domain';

function message(id: string, role: ChatMessage['role'], content: string, timestamp: number): ChatMessage {
  return { id, role, content, timestamp };
}

const pharosPersona = { id: 'pharos', name: 'Pharos' } as never;

function createHandlersForConversation(params: {
  conversation: Conversation;
  ui?: Partial<ChatUiActionState>;
  chat?: Partial<ChatActionStoreBindings['chat']>;
  space?: Partial<ChatActionStoreBindings['space']>;
  derived?: Partial<ChatDerivedStatePort>;
}) {
  const ui: ChatUiActionState = {
    sending: false,
    editing: null,
    confirm: vi.fn(() => true),
    setCommandStatus: vi.fn(),
    triggerSubmitFlight: vi.fn(),
    cancelEditingMessage: vi.fn(),
    ...params.ui
  };
  const chat: ChatActionStoreBindings['chat'] = {
    conversations: [params.conversation],
    activeConversationId: params.conversation.id,
    inputDraft: '',
    pendingWorkspaceProposals: [],
    createConversation: vi.fn(() => 'conv-branch'),
    ensureConversationWritable: vi.fn(async (conversationId: string) => ({
      conversationId,
      conversation: conversationId === params.conversation.id
        ? params.conversation
        : { ...params.conversation, id: conversationId, messages: [] },
      messages: conversationId === params.conversation.id ? params.conversation.messages : []
    })),
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    orphanConversation: vi.fn(),
    deleteConversation: vi.fn(),
    setInputDraft: vi.fn(),
    replaceConversationMessages: vi.fn(),
    setConversationActiveProject: vi.fn(),
    upsertPendingWorkspaceProposal: vi.fn(),
    removePendingWorkspaceProposal: vi.fn(),
    appendRuntimeFeedbackEvent: vi.fn(),
    getRuntimeFeedbackEvents: vi.fn(() => []),
    setActiveConversation: vi.fn(),
    readLatestState: () => ({
      inputDraft: '',
      conversations: [params.conversation],
      activeConversationId: params.conversation.id
    }),
    ...params.chat
  };
  const space: ChatActionStoreBindings['space'] = {
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
    rollbackPreviewForConversationDeletion: vi.fn(() => false),
    ...params.space
  };

  return {
    chat,
    space,
    ui,
    handlers: createChatActionHandlers({
      startupReady: true,
      ui,
      store: {
        chat,
        persona: {
          activeCollaboratorId: 'pharos',
          personas: [pharosPersona],
          setActiveCollaborator: vi.fn(),
          deleteCollaborator: vi.fn(() => true),
          readLatestState: () => ({
            activeCollaboratorId: 'pharos',
            personas: [pharosPersona]
          })
        },
        space,
        runtime: {
          companionConnections: [],
          deleteCompanionConnection: vi.fn()
        }
      },
      derived: {
        activeConversation: params.conversation,
        activeCollaboratorSourceId: 'pharos',
        persona: null,
        hasUnsupportedPendingImages: false,
        codeCardActionModeByMessageId: {},
        ...params.derived
      },
      runReply: vi.fn(() => Promise.resolve()),
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    })
  };
}

describe('assistant message actions', () => {
  it('edits an assistant message in place', async () => {
    const assistantMessage = message('assistant-1', 'assistant', '旧回答', 1000);
    const conversation: Conversation = {
      id: 'conv-edit',
      title: '可编辑对话',
      collaboratorId: 'pharos',
      activeProjectId: null,
      messages: [assistantMessage],
      pinnedAt: null,
      updatedAt: 1000
    };
    const { chat, handlers, ui } = createHandlersForConversation({ conversation });

    await handlers.updateAssistantMessage(assistantMessage, '  新回答  ');

    expect(chat.updateMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-edit'
    }), 'assistant-1', expect.objectContaining({
      content: '新回答',
      timestamp: expect.any(Number)
    }));
    expect(ui.setCommandStatus).toHaveBeenCalledWith('已修改这条回答。');
  });

  it('forks a conversation from the selected message', async () => {
    const userMessage = message('user-1', 'user', '问题', 1000);
    const assistantMessage = message('assistant-1', 'assistant', '回答', 1001);
    const laterMessage = message('user-2', 'user', '后续', 1002);
    const conversation: Conversation = {
      id: 'conv-source',
      title: '源对话',
      collaboratorId: 'pharos',
      activeProjectId: 'workspace-1',
      messages: [userMessage, assistantMessage, laterMessage],
      pinnedAt: null,
      updatedAt: 1002
    };
    const { chat, handlers, space } = createHandlersForConversation({ conversation });

    await handlers.forkConversationFromMessage(assistantMessage);

    expect(chat.createConversation).toHaveBeenCalledWith('pharos', { activeProjectId: 'workspace-1' });
    expect(chat.replaceConversationMessages).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-branch'
    }), [
      expect.objectContaining({ role: 'user', content: '问题' }),
      expect.objectContaining({ role: 'assistant', content: '回答' })
    ]);
    expect(vi.mocked(chat.replaceConversationMessages).mock.calls[0][1][0].id).not.toBe('user-1');
    expect(vi.mocked(chat.replaceConversationMessages).mock.calls[0][1][1].id).not.toBe('assistant-1');
    expect(vi.mocked(chat.replaceConversationMessages).mock.calls[0][1].map((entry) => entry.timestamp)).toEqual([1000, 1001]);
    expect(space.clearPendingAttachments).toHaveBeenCalled();
    expect(space.clearPendingCardReference).toHaveBeenCalled();
    expect(chat.setActiveConversation).toHaveBeenCalledWith('conv-branch');
  });
});

 it('requires confirmation before regeneration removes later user messages', async () => {
  const first = message('u1', 'user', 'first', 1);
  const answer = message('a1', 'assistant', 'answer', 2);
  const later = message('u2', 'user', 'later', 3);
  const confirm = vi.fn(() => false);
  const { handlers, chat } = createHandlersForConversation({ conversation: { id: 'c', title: 'c', collaboratorId: 'pharos', messages: [first, answer, later], updatedAt: 3, pinnedAt: null }, ui: { confirm } });
  await handlers.retryLatestAssistant(answer);
  expect(confirm).toHaveBeenCalledOnce();
  expect(chat.replaceConversationMessages).not.toHaveBeenCalled();
});
