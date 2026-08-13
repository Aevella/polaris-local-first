import { describe, expect, it, vi } from 'vitest';
import type { ChatActionStoreBindings, ChatDerivedStatePort, ChatUiActionState } from './chatPorts';
import { createChatActionHandlers } from './chatActions';
import type { ChatMessage, Conversation } from '../../types/domain';
import type { PendingWorkspaceProposalRecord } from '../../engines/workspaceBinding';

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
    setConversationTask: vi.fn(),
    setConversationActiveProject: vi.fn(),
    upsertPendingWorkspaceProposal: vi.fn(),
    removePendingWorkspaceProposal: vi.fn(),
    appendRuntimeFeedbackEvent: vi.fn(),
    getRuntimeFeedbackEvents: vi.fn(() => []),
    setActiveConversation: vi.fn(),
    readLatestState: () => ({
      inputDraft: '',
      conversations: [params.conversation],
      activeConversationId: params.conversation.id,
      pendingWorkspaceProposals: []
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

  const runReply = vi.fn(() => Promise.resolve());
  return {
    chat,
    space,
    ui,
    runReply,
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
      runReply,
      submitToolCommand: vi.fn(() => Promise.resolve(false)),
      activeSubmitFingerprintRef: { current: null }
    })
  };
}

describe('assistant message actions', () => {
  function segmentedConversation() {
    const userMessage = message('user-1', 'user', '问题', 1000);
    const firstSegment: ChatMessage = {
      ...message('assistant-prefix', 'assistant', '第一条。', 1001),
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 0
    };
    const terminalSegment: ChatMessage = {
      ...message('assistant-anchor', 'assistant', '第二条。', 1002),
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 1
    };
    return {
      userMessage,
      firstSegment,
      terminalSegment,
      conversation: {
        id: 'conv-segmented',
        title: '分段回答',
        collaboratorId: 'pharos',
        activeProjectId: null,
        messages: [userMessage, firstSegment, terminalSegment],
        pinnedAt: null,
        updatedAt: 1002
      } satisfies Conversation
    };
  }

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
    expect(space.clearPendingAttachments).toHaveBeenCalled();
    expect(space.clearPendingCardReference).toHaveBeenCalled();
    expect(chat.setActiveConversation).toHaveBeenCalledWith('conv-branch');
  });

  it('retries a segmented reply from before its first persisted bubble', async () => {
    const { conversation, terminalSegment, userMessage } = segmentedConversation();
    const { chat, handlers, runReply } = createHandlersForConversation({ conversation });

    await handlers.retryLatestAssistant(terminalSegment);

    expect(chat.replaceConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-segmented' }),
      [userMessage]
    );
    expect(runReply).toHaveBeenCalledWith(expect.objectContaining({ messages: [userMessage] }));
  });

  it('edits a segmented reply as one complete answer instead of leaving sibling fragments behind', async () => {
    const { conversation, terminalSegment, userMessage } = segmentedConversation();
    const { chat, handlers } = createHandlersForConversation({ conversation });

    await handlers.updateAssistantMessage(terminalSegment, '合并后的新回答。');

    expect(chat.replaceConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-segmented' }),
      [
        userMessage,
        expect.objectContaining({
          id: 'assistant-anchor',
          content: '合并后的新回答。',
          assistantReplyId: undefined,
          assistantReplySegmentIndex: undefined
        })
      ]
    );
  });

  it('remaps segmented reply ownership when forking the complete reply', async () => {
    const { conversation, terminalSegment } = segmentedConversation();
    const { chat, handlers } = createHandlersForConversation({ conversation });

    await handlers.forkConversationFromMessage(terminalSegment);

    const cloned = vi.mocked(chat.replaceConversationMessages).mock.calls[0]?.[1] ?? [];
    const clonedPrefix = cloned[1];
    const clonedAnchor = cloned[2];
    expect(clonedPrefix?.assistantReplyId).toBe(clonedAnchor?.id);
    expect(clonedAnchor?.assistantReplyId).toBe(clonedAnchor?.id);
    expect(clonedAnchor?.id).not.toBe('assistant-anchor');
  });
});

describe('user message actions', () => {
  it('deletes the selected user turn and keeps later turns intact', async () => {
    const userMessage = message('user-1', 'user', '第一问', 1000);
    const assistantMessage = message('assistant-1', 'assistant', '第一答', 1001);
    const laterUserMessage = message('user-2', 'user', '第二问', 1002);
    const laterAssistantMessage = message('assistant-2', 'assistant', '第二答', 1003);
    const conversation: Conversation = {
      id: 'conv-delete-turn',
      title: '删除一轮',
      collaboratorId: 'pharos',
      activeProjectId: null,
      messages: [userMessage, assistantMessage, laterUserMessage, laterAssistantMessage],
      task: null,
      pinnedAt: null,
      updatedAt: 1003
    };
    const { chat, handlers, ui } = createHandlersForConversation({ conversation });

    await handlers.deleteUserMessage(userMessage);

    expect(ui.confirm).toHaveBeenCalledWith('删除这条消息及它引出的整轮回答？之后的对话会保留。');
    expect(chat.replaceConversationMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-delete-turn' }),
      [laterUserMessage, laterAssistantMessage]
    );
    expect(chat.setConversationTask).toHaveBeenCalledWith('conv-delete-turn', null);
    expect(ui.setCommandStatus).toHaveBeenCalledWith('已删除这轮消息。');
  });

  it('does not mutate messages when deletion is cancelled', async () => {
    const userMessage = message('user-1', 'user', '不要删', 1000);
    const conversation: Conversation = {
      id: 'conv-keep-turn',
      title: '保留一轮',
      collaboratorId: 'pharos',
      messages: [userMessage],
      pinnedAt: null,
      updatedAt: 1000
    };
    const { chat, handlers } = createHandlersForConversation({
      conversation,
      ui: { confirm: vi.fn(() => false) }
    });

    await handlers.deleteUserMessage(userMessage);

    expect(chat.replaceConversationMessages).not.toHaveBeenCalled();
    expect(chat.setConversationTask).not.toHaveBeenCalled();
  });

  it('clears a pending workspace proposal when its latest turn is deleted', async () => {
    const userMessage = message('user-1', 'user', '创建工作区', 1000);
    const assistantMessage = message('assistant-1', 'assistant', '等待确认', 1001);
    const conversation: Conversation = {
      id: 'conv-delete-proposal',
      title: '待确认工作区',
      collaboratorId: 'pharos',
      messages: [userMessage, assistantMessage],
      pinnedAt: null,
      updatedAt: 1001
    };
    const proposal = {
      id: 'proposal-1',
      conversationId: conversation.id,
      source: 'model-proposed',
      requestedActionKinds: ['createRoomProject'],
      status: 'pending',
      createdAt: 1001,
      requestedActions: []
    } satisfies PendingWorkspaceProposalRecord;
    const { chat, handlers } = createHandlersForConversation({
      conversation,
      chat: {
        pendingWorkspaceProposals: [proposal],
        readLatestState: () => ({
          inputDraft: '',
          conversations: [conversation],
          activeConversationId: conversation.id,
          pendingWorkspaceProposals: [proposal]
        })
      }
    });

    await handlers.deleteUserMessage(userMessage);

    expect(chat.removePendingWorkspaceProposal).toHaveBeenCalledWith('proposal-1');
  });
});
