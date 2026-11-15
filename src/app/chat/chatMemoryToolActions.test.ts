import { describe, expect, it, vi } from 'vitest';
import { createChatMemoryActions } from './chatMemoryToolActions';
import type { ChatMessage, Persona, ToolInvocation } from '../../types/domain';
import type { WritableConversationBody } from '../../stores/chatStore';

function writableConversation(): WritableConversationBody {
  return {
    conversationId: 'conv-1',
    conversation: {
      id: 'conv-1',
      title: '测试对话',
      collaboratorId: 'pharos',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    },
    messages: []
  };
}

function createPersona(): Persona {
  return {
    id: 'pharos',
    name: 'Pharos',
    avatar: '',
    role: 'assistant',
    prompt: '',
    tone: '',
    accent: '',
    tags: {
      temperament: [],
      interaction: [],
      expression: [],
      thinking: [],
      action: []
    },
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    memory: {
      inheritGlobal: true,
      excludedGlobalIds: [],
      personalMemories: [],
      referenceDocs: []
    },
    deepDefinition: {
      identityHint: '',
      missionHint: '',
      conflictPriority: '',
      conflictReason: '',
      avoidBecoming: '',
      correctiveAction: '',
      vulnerableFirst: '',
      vulnerableThen: '',
      hardBoundary: '',
      hardBoundaryAction: ''
    },
    advanced: {
      modelOverride: '',
      temperature: '',
      topP: '',
      maxTokens: '',
      thinkingBudget: '',
      contextMessageLimit: '',
      showThinking: false,
      streaming: true,
      customHeaders: '',
      customBody: '',
      regexRules: '',
      snippets: []
    }
  } as unknown as Persona;
}

function createMemoryActions() {
  const persona = createPersona();
  const addRuntimeToolMessage = vi.fn();
  const setCommandStatus = vi.fn();
  const updateCollaborator = vi.fn();
  const updateMessage = vi.fn();
  const actions = createChatMemoryActions({
    ui: { setCommandStatus },
    store: {
      chat: {
        findConversation: vi.fn(() => ({ id: 'conv-1', collaboratorId: 'pharos' })),
        updateMessage
      } as never,
      persona: {
        activeCollaboratorId: 'pharos',
        findCollaborator: vi.fn((id: string) => id === 'pharos' ? persona : null),
        updateCollaborator
      } as never
    },
    frontstageCollaboratorId: null,
    activeConversation: { id: 'conv-1', collaboratorId: 'pharos' },
    addRuntimeToolMessage
  });

  return {
    actions,
    addRuntimeToolMessage,
    setCommandStatus,
    updateMessage,
    updateCollaborator
  };
}

function memoryPreviewMessage(): ChatMessage {
  return {
    id: 'memory-preview-message',
    role: 'system',
    content: '确认写入记忆',
    timestamp: 1,
    toolInvocation: {
      id: 'tool-memory-preview',
      kind: 'writeMemory',
      status: 'preview',
      title: '确认写入记忆',
      summary: '确认写入',
      memoryItems: ['她的手机号是 123456']
    }
  };
}

describe('createChatMemoryActions', () => {
  it('writes low-risk memory items immediately', () => {
    const { actions, addRuntimeToolMessage } = createMemoryActions();

    const handled = actions.maybeHandleWriteMemoryAction(writableConversation(), {
      kind: 'writeMemory',
      memory: ['喜欢清楚边界']
    });

    expect(handled).toBe(true);
    const invocation = addRuntimeToolMessage.mock.calls[0]?.[1] as ToolInvocation | undefined;
    expect(invocation?.status).toBe('executed');
    expect(invocation?.summary).toContain('已写入 1 条低风险记忆');
  });

  it('does not show removed legacy copy for low-risk writes', () => {
    const { actions, addRuntimeToolMessage, setCommandStatus } = createMemoryActions();

    const handled = actions.maybeHandleWriteMemoryAction(writableConversation(), {
      kind: 'writeMemory',
      memory: ['喜欢清楚边界']
    });

    expect(handled).toBe(true);
    const invocation = addRuntimeToolMessage.mock.calls[0]?.[1] as ToolInvocation | undefined;
    expect(invocation?.status).toBe('executed');
    expect(invocation?.summary).not.toContain('关闭了自动写入');
    expect(setCommandStatus).not.toHaveBeenCalled();
  });

  it('previews sensitive memory writes without removed legacy copy', () => {
    const { actions, addRuntimeToolMessage } = createMemoryActions();

    const handled = actions.maybeHandleWriteMemoryAction(writableConversation(), {
      kind: 'writeMemory',
      memory: ['她的手机号是 123456']
    });

    expect(handled).toBe(true);
    const invocation = addRuntimeToolMessage.mock.calls[0]?.[1] as ToolInvocation | undefined;
    expect(invocation?.status).toBe('preview');
    expect(invocation?.summary).toContain('可能偏敏感');
    expect(invocation?.summary).not.toContain('关闭了自动写入');
  });

  it('applies memory previews through the provided writable conversation', () => {
    const target = writableConversation();
    const { actions, updateMessage } = createMemoryActions();
    const message = memoryPreviewMessage();

    expect(actions.applyMemoryPreview(target, message)).toBe(true);

    expect(updateMessage).toHaveBeenCalledWith(
      target,
      'memory-preview-message',
      expect.objectContaining({
        content: '已写入当前协作者记忆。',
        toolInvocation: expect.objectContaining({ status: 'applied' })
      })
    );
  });

  it('rolls back memory previews through the provided writable conversation', () => {
    const target = writableConversation();
    const { actions, updateMessage } = createMemoryActions();
    const message = memoryPreviewMessage();

    expect(actions.rollbackMemoryPreview(target, message)).toBe(true);

    expect(updateMessage).toHaveBeenCalledWith(
      target,
      'memory-preview-message',
      expect.objectContaining({
        content: '这批记忆没有写入。',
        toolInvocation: expect.objectContaining({ status: 'rolled_back' })
      })
    );
  });
});

describe('memory confirmation outcomes', () => {
  it('records the completed outcome on the writable conversation body', () => {
    const { actions, updateMessage } = createMemoryActions();
    expect(actions.applyMemoryPreview(writableConversation(), memoryPreviewMessage())).toBe(true);
    expect(updateMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1' }), 'memory-preview-message', expect.objectContaining({
      toolInvocation: expect.objectContaining({ status: 'applied', summary: '已写入 1 条记忆' })
    }));
  });
  it('records cancellation without leaving confirmation text or a stale error', () => {
    const { actions, updateMessage } = createMemoryActions();
    actions.rollbackMemoryPreview(writableConversation(), memoryPreviewMessage());
    expect(updateMessage).toHaveBeenCalledWith(expect.anything(), 'memory-preview-message', expect.objectContaining({
      toolInvocation: expect.objectContaining({ status: 'rolled_back', summary: '已取消，这批记忆没有写入。', error: undefined })
    }));
  });
});
