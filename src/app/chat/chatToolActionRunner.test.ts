import { describe, expect, it, vi } from 'vitest';
import { wrapThemeCssLayer } from '../../engines/themeCssLayers';
import { createInitialThemeState, toThemeFrame } from '../../stores/spaceStoreTheme';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../../stores/runtimeStoreSearch';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ChatMessage, CodeCard, Conversation, ImageAssetCard, ProjectFile, RoomProject, ToolInvocation } from '../../types/domain';
import { createToolActionRunner } from './chatToolActionRunner';

function writableConversation(conversationId = 'c1', messages: ChatMessage[] = []): WritableConversationBody {
  return {
    conversationId,
    conversation: {
      id: conversationId,
      title: '测试对话',
      collaboratorId: 'pharos',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages
    },
    messages
  };
}

function createPersonaBindings() {
  return {
    activeCollaboratorId: null,
    personas: [],
    findCollaborator: vi.fn(),
    updateCollaborator: vi.fn()
  };
}

function createRunner(options?: {
  cards?: CodeCard[];
  imageCards?: ImageAssetCard[];
  projectFiles?: ProjectFile[];
  roomProjects?: RoomProject[];
  conversation?: Conversation | null;
}) {
  const theme = createInitialThemeState();
  const setCommandStatus = vi.fn();
  const addRuntimeToolMessage = vi.fn();
  const createCard = vi.fn(() => 'new-card');
  const createProjectFile = vi.fn(() => 'new-file');
  const createProject = vi.fn(() => 'new-project');
  const promoteCardToProject = vi.fn((() => null) as () => { projectId: string; fileId: string } | null);
  const updateCard = vi.fn();
  const updateProject = vi.fn();
  const updateProjectFile = vi.fn();
  const deleteProjectFile = vi.fn();
  const setConversationActiveProject = vi.fn();
  const setActiveCard = vi.fn();
  const setCollectionShelf = vi.fn();
  const setWorld = vi.fn();
  const spotlightCard = vi.fn();
  const conversation = options?.conversation ?? null;
  const latestCollectionState = {
    cards: options?.cards ?? [],
    imageCards: options?.imageCards ?? [],
    projectFiles: options?.projectFiles ?? [],
    roomProjects: options?.roomProjects ?? []
  };
  const upsertPendingWorkspaceProposal = vi.fn();
  const appendRuntimeFeedbackEvent = vi.fn();
  const beginThemePreview = vi.fn((
    ..._args: [string, string, ReturnType<typeof toThemeFrame>, string]
  ) => ({
    visibleThemeBeforeStart: toThemeFrame(theme)
  }));

  const runner = createToolActionRunner({
    local: {
      setCommandStatus
    },
    chat: {
      conversations: conversation ? [conversation] : [],
      pendingWorkspaceProposals: [],
      addMessage: vi.fn(),
      insertMessageBefore: vi.fn(),
      insertMessageAfter: vi.fn(),
      createConversation: vi.fn(),
      findConversation: vi.fn((conversationId: string) =>
        conversation?.id === conversationId ? conversation : undefined
      ),
      ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
      getConversationWritable: vi.fn((conversationId: string) => writableConversation(conversationId)),
      getConversationMessages: vi.fn(() => []),
      getConversationTask: vi.fn(() => null),
      setConversationTask: vi.fn(),
      updateMessage: vi.fn(),
      setConversationActiveProject,
      upsertPendingWorkspaceProposal,
      removePendingWorkspaceProposal: vi.fn(),
      appendRuntimeFeedbackEvent,
      getRuntimeFeedbackEvents: vi.fn(() => [])
    },
    persona: createPersonaBindings(),
    collection: {
        cards: latestCollectionState.cards,
        imageCards: latestCollectionState.imageCards,
        projectFiles: latestCollectionState.projectFiles,
        roomProjects: latestCollectionState.roomProjects,
        readLatestState: () => latestCollectionState,
        createCard,
        createProjectFile,
        createProject,
        promoteCardToProject,
        saveCardFromChat: vi.fn(),
        saveImageCardFromChat: vi.fn(),
        updateCard,
        updateProject,
        updateProjectFile,
        deleteProjectFile
    },
    runtime: {
      api: {} as never,
      providers: [] as never[],
      imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
      search: {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        provider: 'bingLocal',
        apiKey: '',
        bochaSummary: true,
        bochaFreshness: 'noLimit'
      },
      mcpServers: [],
      mcpToolTimeoutSeconds: 30,
      readLatestState: () => ({
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
        imageUnderstanding: { enabled: false },
        search: {
          ...DEFAULT_WEB_SEARCH_CONFIG,
          provider: 'bingLocal',
          apiKey: '',
          bochaSummary: true,
          bochaFreshness: 'noLimit'
        },
        mcpServers: [],
        mcpToolTimeoutSeconds: 30,
        triggerRules: []
      }),
      setTaskModeEnabled: vi.fn(),
      getTriggerRules: vi.fn(() => []),
      createTriggerRule: vi.fn(() => 'trigger-1'),
      updateTriggerRule: vi.fn(),
      deleteTriggerRule: vi.fn()
    },
    space: {
      activeThemePreview: null,
      activeWorld: 'chat',
      activeCardId: null,
      applyThemePatch: vi.fn(),
      applyThemePreset: vi.fn(),
      beginThemePreview,
      collectionShelf: 'code',
      commitThemePreview: vi.fn(),
      frontstageCollaboratorId: null,
      currentThemeFrame: toThemeFrame(theme),
      getActiveThemePreview: vi.fn(() => null),
      getCurrentThemeFrame: vi.fn(() => toThemeFrame(theme)),
      rollbackThemePreview: vi.fn(),
      saveCurrentSkin: vi.fn(() => null),
      setActiveCard,
      setCollectionShelf,
      setThemeToolMode: vi.fn(),
      setWorld,
      spotlightCard,
      themeToolMode: theme.toolMode
    },
    derived: {
      activeConversation: null,
      activeCollaboratorSourceId: null,
      codeCardActionModeByMessageId: {}
    },
    memoryActions: {
      appendCollaboratorMemories: vi.fn(() => true),
      writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
      readCollaboratorMemoryDoc: vi.fn(async () => null),
      maybeHandleWriteMemoryAction: vi.fn(() => false),
      applyMemoryPreview: vi.fn(() => false),
      rollbackMemoryPreview: vi.fn(() => false)
    },
    addRuntimeToolMessage
  });

  return {
    runner,
    beginThemePreview,
    addRuntimeToolMessage,
    createCard,
    createProjectFile,
    createProject,
    promoteCardToProject,
    setConversationActiveProject,
    setActiveCard,
    setCollectionShelf,
    setCommandStatus,
    setWorld,
    spotlightCard,
    upsertPendingWorkspaceProposal,
    appendRuntimeFeedbackEvent,
    updateCard,
    updateProjectFile
  };
}

describe('createToolActionRunner', () => {
  it('returns failed preview outcome when preview preparation rejects the action', async () => {
    const { runner, addRuntimeToolMessage, beginThemePreview, setCommandStatus } = createRunner();

    const outcome = await runner.runToolAction('c1', {
      kind: 'patchRawCss',
      css: ''
    }, false);

    expect(outcome).toEqual({
      path: 'preview',
      status: 'failed',
      action: {
        kind: 'patchRawCss',
        css: ''
      },
      error: '整页 CSS 不能为空。'
    });
    expect(setCommandStatus).toHaveBeenCalledWith('整页 CSS 不能为空。');
    expect(beginThemePreview).not.toHaveBeenCalled();
    expect(addRuntimeToolMessage).not.toHaveBeenCalled();
  });

  it('returns previewed outcome when preview preparation succeeds', async () => {
    const { runner, addRuntimeToolMessage, beginThemePreview } = createRunner();

    const outcome = await runner.runToolAction('c1', {
      kind: 'patchRawCss',
      css: '.app-shell.chat .bubble.user { color: red; }'
    }, false);

    expect(outcome).toEqual({
      path: 'preview',
      status: 'previewed',
      action: {
        kind: 'patchRawCss',
        css: '.app-shell.chat .bubble.user { color: red; }'
      }
    });
    expect(beginThemePreview).toHaveBeenCalledTimes(1);
    expect(addRuntimeToolMessage).toHaveBeenCalledTimes(1);
  });

  it('supersedes the previous preview when another preview starts before React re-renders', async () => {
    const theme = createInitialThemeState();
    const committedBase = toThemeFrame(theme);
    let activePreview: {
      id: string;
      conversationId: string;
      before: ReturnType<typeof toThemeFrame>;
      pending: string;
    } | null = null;
    let currentFrame = committedBase;
    const messages: ChatMessage[] = [];
    const updateMessage = vi.fn((target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) => {
      expect(target.conversationId).toBe('c1');
      const message = messages.find((entry) => entry.id === messageId);
      if (!message) return;
      Object.assign(message, patch);
    });
    const beginThemePreview = vi.fn((
      previewId: string,
      conversationId: string,
      nextTheme: ReturnType<typeof toThemeFrame>,
      pending: string
    ) => {
      activePreview = {
        id: previewId,
        conversationId,
        before: activePreview?.before ?? currentFrame,
        pending
      };
      currentFrame = nextTheme;
      return {
        visibleThemeBeforeStart: currentFrame
      };
    });
    const addRuntimeToolMessage = vi.fn((target: WritableConversationBody, toolInvocation: ToolInvocation) => {
      expect(target.conversationId).toBe('c1');
      messages.push({
        id: toolInvocation.id,
        role: 'system',
        content: toolInvocation.summary,
        timestamp: Date.now(),
        toolInvocation
      });
    });

    const runner = createToolActionRunner({
      local: {
        setCommandStatus: vi.fn()
      },
      chat: {
        conversations: [],
        pendingWorkspaceProposals: [],
        addMessage: vi.fn(),
        insertMessageBefore: vi.fn(),
        insertMessageAfter: vi.fn(),
        createConversation: vi.fn(),
        findConversation: vi.fn(),
        ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId, messages)),
        getConversationWritable: vi.fn((conversationId: string) => writableConversation(conversationId, messages)),
        getConversationMessages: vi.fn(() => messages),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage,
        setConversationActiveProject: vi.fn(),
        upsertPendingWorkspaceProposal: vi.fn(),
        removePendingWorkspaceProposal: vi.fn(),
        appendRuntimeFeedbackEvent: vi.fn(),
        getRuntimeFeedbackEvents: vi.fn(() => [])
      },
      persona: createPersonaBindings(),
      collection: {
        cards: [],
        imageCards: [],
        projectFiles: [],
        roomProjects: [],
        readLatestState: () => ({
          cards: [],
          imageCards: [],
          projectFiles: [],
          roomProjects: []
        }),
        createCard: vi.fn(),
        createProjectFile: vi.fn(),
        createProject: vi.fn(),
        promoteCardToProject: vi.fn(() => null),
        saveCardFromChat: vi.fn(),
        saveImageCardFromChat: vi.fn(),
        updateCard: vi.fn(),
        updateProject: vi.fn(),
        updateProjectFile: vi.fn(),
        deleteProjectFile: vi.fn()
      },
      runtime: {
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
        search: {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        provider: 'bingLocal',
        apiKey: '',
        bochaSummary: true,
        bochaFreshness: 'noLimit'
      },
        mcpServers: [],
        mcpToolTimeoutSeconds: 30,
        setTaskModeEnabled: vi.fn(),
        getTriggerRules: vi.fn(() => []),
        createTriggerRule: vi.fn(() => 'trigger-1'),
        updateTriggerRule: vi.fn(),
        deleteTriggerRule: vi.fn()
      },
      space: {
        activeThemePreview: null,
        activeWorld: 'chat',
        activeCardId: null,
        applyThemePatch: vi.fn(),
        applyThemePreset: vi.fn(),
        beginThemePreview,
        collectionShelf: 'code',
        commitThemePreview: vi.fn(),
        frontstageCollaboratorId: null,
        currentThemeFrame: committedBase,
        getActiveThemePreview: vi.fn(() => activePreview),
        getCurrentThemeFrame: vi.fn(() => currentFrame),
        rollbackThemePreview: vi.fn(),
        saveCurrentSkin: vi.fn(() => null),
        setActiveCard: vi.fn(),
        setCollectionShelf: vi.fn(),
        setThemeToolMode: vi.fn(),
        setWorld: vi.fn(),
        spotlightCard: vi.fn(),
        themeToolMode: theme.toolMode
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: null,
        codeCardActionModeByMessageId: {}
      },
      memoryActions: {
        appendCollaboratorMemories: vi.fn(() => true),
        writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
        readCollaboratorMemoryDoc: vi.fn(async () => null),
        maybeHandleWriteMemoryAction: vi.fn(() => false),
        applyMemoryPreview: vi.fn(() => false),
        rollbackMemoryPreview: vi.fn(() => false)
      },
      addRuntimeToolMessage
    });

    await runner.runAssistantToolActions('c1', [
      {
        kind: 'patchRawCss',
        css: '.app-shell.chat .bubble.assistant { color: #a8d8a8; }',
        label: '淡绿色字体'
      },
      {
        kind: 'patchRawCss',
        css: '.app-shell.chat .bubble.assistant { color: #111111; }',
        label: '黑色字体'
      }
    ]);

    expect(messages).toHaveLength(2);
    const [firstMessage, secondMessage] = messages;
    expect(firstMessage).toBeDefined();
    expect(secondMessage).toBeDefined();
    if (!firstMessage || !secondMessage) {
      throw new Error('Expected two preview messages');
    }
    expect(firstMessage.toolInvocation?.status).toBe('superseded');
    expect(firstMessage.toolInvocation?.foldedIntoPreviewId).toBe(secondMessage.toolInvocation?.previewId);
    expect(secondMessage.toolInvocation?.status).toBe('preview');
  });

  it('rebases a new preview on the committed base instead of the currently visible preview', async () => {
    const theme = createInitialThemeState();
    const committedBase = toThemeFrame(theme);
    const visiblePreview = {
      ...toThemeFrame(theme),
      generatedCSS: wrapThemeCssLayer('existing-preview', '.old { color: red; }')
    };
    const beginThemePreview = vi.fn((
      ..._args: [string, string, ReturnType<typeof toThemeFrame>, string]
    ) => ({
      visibleThemeBeforeStart: visiblePreview
    }));

    const runner = createToolActionRunner({
      local: {
        setCommandStatus: vi.fn()
      },
      chat: {
        conversations: [],
        pendingWorkspaceProposals: [],
        addMessage: vi.fn(),
        insertMessageBefore: vi.fn(),
        insertMessageAfter: vi.fn(),
        createConversation: vi.fn(),
        findConversation: vi.fn(),
        ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
        getConversationWritable: vi.fn((conversationId: string) => writableConversation(conversationId)),
        getConversationMessages: vi.fn(() => []),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn(),
        setConversationActiveProject: vi.fn(),
        upsertPendingWorkspaceProposal: vi.fn(),
        removePendingWorkspaceProposal: vi.fn(),
        appendRuntimeFeedbackEvent: vi.fn(),
        getRuntimeFeedbackEvents: vi.fn(() => [])
      },
      persona: createPersonaBindings(),
      collection: {
        cards: [],
        imageCards: [],
        projectFiles: [],
        roomProjects: [],
        readLatestState: () => ({
          cards: [],
          imageCards: [],
          projectFiles: [],
          roomProjects: []
        }),
        createCard: vi.fn(),
        createProjectFile: vi.fn(),
        createProject: vi.fn(),
        promoteCardToProject: vi.fn(() => null),
        saveCardFromChat: vi.fn(),
        saveImageCardFromChat: vi.fn(),
        updateCard: vi.fn(),
        updateProject: vi.fn(),
        updateProjectFile: vi.fn(),
        deleteProjectFile: vi.fn()
      },
      runtime: {
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
        search: {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        provider: 'bingLocal',
        apiKey: '',
        bochaSummary: true,
        bochaFreshness: 'noLimit'
      },
        mcpServers: [],
        mcpToolTimeoutSeconds: 30,
        setTaskModeEnabled: vi.fn(),
        getTriggerRules: vi.fn(() => []),
        createTriggerRule: vi.fn(() => 'trigger-1'),
        updateTriggerRule: vi.fn(),
        deleteTriggerRule: vi.fn()
      },
      space: {
        activeThemePreview: {
          id: 'preview-1',
          conversationId: 'c1',
          before: committedBase,
          pending: visiblePreview.generatedCSS
        },
        activeWorld: 'chat',
        activeCardId: null,
        applyThemePatch: vi.fn(),
        applyThemePreset: vi.fn(),
        beginThemePreview,
        collectionShelf: 'code',
        commitThemePreview: vi.fn(),
        frontstageCollaboratorId: null,
        currentThemeFrame: visiblePreview,
        getActiveThemePreview: vi.fn(() => ({
          id: 'preview-1',
          conversationId: 'c1',
          before: committedBase,
          pending: visiblePreview.generatedCSS
        })),
        getCurrentThemeFrame: vi.fn(() => visiblePreview),
        rollbackThemePreview: vi.fn(),
        saveCurrentSkin: vi.fn(() => null),
        setActiveCard: vi.fn(),
        setCollectionShelf: vi.fn(),
        setThemeToolMode: vi.fn(),
        setWorld: vi.fn(),
        spotlightCard: vi.fn(),
        themeToolMode: theme.toolMode
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: null,
        codeCardActionModeByMessageId: {}
      },
      memoryActions: {
        appendCollaboratorMemories: vi.fn(() => true),
        writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
        readCollaboratorMemoryDoc: vi.fn(async () => null),
        maybeHandleWriteMemoryAction: vi.fn(() => false),
        applyMemoryPreview: vi.fn(() => false),
        rollbackMemoryPreview: vi.fn(() => false)
      },
      addRuntimeToolMessage: vi.fn()
    });

    await runner.runToolAction('c1', {
      kind: 'patchRawCss',
      css: '.app-shell.chat .bubble.user { color: blue; }'
    }, false);

    const firstBeginPreviewCall = beginThemePreview.mock.calls[0];
    expect(firstBeginPreviewCall).toBeDefined();
    const nextTheme = firstBeginPreviewCall?.[2];
    expect(nextTheme).toBeDefined();
    if (!nextTheme) {
      throw new Error('Expected beginThemePreview to receive nextTheme');
    }
    expect(nextTheme.generatedCSS).toContain('.app-shell.chat .bubble.user');
    expect(nextTheme.generatedCSS).not.toContain('existing-preview');
  });

  it('updates the existing project file instead of creating a duplicate card', async () => {
    const existingCard: CodeCard = {
      id: 'card-1',
      title: 'index.html',
      language: 'html',
      code: '<main>old</main>',
      tags: [],
      source: 'chat-generated',
      createdAt: 1,
      updatedAt: 1
    };
    const {
      runner,
      createCard,
      createProjectFile,
      setCollectionShelf,
      updateProjectFile
    } = createRunner({
      cards: [existingCard],
      projectFiles: [{
        id: 'card-1',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main>old</main>',
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }],
      roomProjects: [{
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        tags: [],
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1,
        fileIds: ['card-1'],
        entryFileId: 'card-1'
      }]
    });

    const outcome = await runner.runToolAction('c1', {
      kind: 'createProjectFile',
      file: {
        projectId: 'mini-phone',
        filePath: './index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main>new</main>'
      },
      openInCollection: true
    }, false);

    expect(outcome.path).toBe('direct');
    expect(outcome.status).toBe('executed');
    expect(outcome.action).toEqual({
      kind: 'createProjectFile',
      file: {
        projectId: 'mini-phone',
        filePath: './index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main>new</main>'
      },
      openInCollection: true
    });
    expect(outcome.path === 'direct' ? outcome.toolInvocation.projectFileId : null).toBe('card-1');
    expect(createCard).not.toHaveBeenCalled();
    expect(createProjectFile).not.toHaveBeenCalled();
    expect(updateProjectFile).toHaveBeenCalledWith('card-1', {
      fileRole: 'entry',
      language: 'html',
      content: '<main>new</main>',
      ownerCollaboratorId: undefined,
      source: 'chat-generated'
    });
    expect(setCollectionShelf).toHaveBeenCalledWith('project');
  });

  it('reads the active workspace file even when its owner differs from the current collaborator', async () => {
    const theme = createInitialThemeState();
    const conversation: Conversation = {
      id: 'c1',
      title: '工作区对话',
      collaboratorId: 'persona-1',
      activeProjectId: 'workspace-1',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    };
    const projectFiles: ProjectFile[] = [{
      id: 'file-index',
      projectId: 'workspace-1',
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      content: '<main>hello</main>',
      ownerCollaboratorId: 'persona-2',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];

    const runner = createToolActionRunner({
      local: {
        setCommandStatus: vi.fn()
      },
      chat: {
        conversations: [conversation],
        pendingWorkspaceProposals: [],
        addMessage: vi.fn(),
        insertMessageBefore: vi.fn(),
        insertMessageAfter: vi.fn(),
        createConversation: vi.fn(),
      findConversation: vi.fn((conversationId: string) =>
        conversationId === 'c1' ? conversation : undefined
      ),
      ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
      getConversationWritable: vi.fn((conversationId: string) => writableConversation(conversationId)),
      getConversationMessages: vi.fn(() => []),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn(),
        setConversationActiveProject: vi.fn(),
        upsertPendingWorkspaceProposal: vi.fn(),
        removePendingWorkspaceProposal: vi.fn(),
        appendRuntimeFeedbackEvent: vi.fn(),
        getRuntimeFeedbackEvents: vi.fn(() => [])
      },
      persona: createPersonaBindings(),
      collection: {
        cards: [],
        imageCards: [],
        projectFiles,
        roomProjects: [{
          id: 'workspace-1',
          title: '今日随机小助手',
          slug: 'workspace-1',
          ownerCollaboratorId: 'persona-2',
          entryFileId: 'file-index',
          fileIds: ['file-index'],
          tags: [],
          source: 'manual',
          createdAt: 1,
          updatedAt: 1
        }],
        readLatestState: () => ({
          cards: [],
          imageCards: [],
          projectFiles,
          roomProjects: [{
            id: 'workspace-1',
            title: '今日随机小助手',
            slug: 'workspace-1',
            ownerCollaboratorId: 'persona-2',
            entryFileId: 'file-index',
            fileIds: ['file-index'],
            tags: [],
            source: 'manual',
            createdAt: 1,
            updatedAt: 1
          }]
        }),
        createCard: vi.fn(),
        createProjectFile: vi.fn(),
        createProject: vi.fn(),
        promoteCardToProject: vi.fn(() => null),
        saveCardFromChat: vi.fn(),
        saveImageCardFromChat: vi.fn(),
        updateCard: vi.fn(),
        updateProject: vi.fn(),
        updateProjectFile: vi.fn(),
        deleteProjectFile: vi.fn()
      },
      runtime: {
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
        search: {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        provider: 'bingLocal',
        apiKey: '',
        bochaSummary: true,
        bochaFreshness: 'noLimit'
      },
        mcpServers: [],
        mcpToolTimeoutSeconds: 30,
        setTaskModeEnabled: vi.fn(),
        getTriggerRules: vi.fn(() => []),
        createTriggerRule: vi.fn(() => 'trigger-1'),
        updateTriggerRule: vi.fn(),
        deleteTriggerRule: vi.fn()
      },
      space: {
        activeThemePreview: null,
        activeWorld: 'chat',
        activeCardId: null,
        applyThemePatch: vi.fn(),
        applyThemePreset: vi.fn(),
        beginThemePreview: vi.fn(),
        collectionShelf: 'project',
        commitThemePreview: vi.fn(),
        frontstageCollaboratorId: 'persona-1',
        currentThemeFrame: toThemeFrame(theme),
        getActiveThemePreview: vi.fn(() => null),
        getCurrentThemeFrame: vi.fn(() => toThemeFrame(theme)),
        rollbackThemePreview: vi.fn(),
        saveCurrentSkin: vi.fn(() => null),
        setActiveCard: vi.fn(),
        setCollectionShelf: vi.fn(),
        setThemeToolMode: vi.fn(),
        setWorld: vi.fn(),
        spotlightCard: vi.fn(),
        themeToolMode: theme.toolMode
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: null,
        codeCardActionModeByMessageId: {}
      },
      memoryActions: {
        appendCollaboratorMemories: vi.fn(() => true),
        writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
        readCollaboratorMemoryDoc: vi.fn(async () => null),
        maybeHandleWriteMemoryAction: vi.fn(() => false),
        applyMemoryPreview: vi.fn(() => false),
        rollbackMemoryPreview: vi.fn(() => false)
      },
      addRuntimeToolMessage: vi.fn()
    });

    const outcome = await runner.runToolAction('c1', {
      kind: 'readProjectFile',
      fileId: 'file-index',
      targetLabel: 'index.html'
    }, false);

    expect(outcome.path).toBe('direct');
    expect(outcome.status).toBe('executed');
    expect(outcome.path === 'direct' ? outcome.toolInvocation.summary : null).toBe('已读取工作区文件 · index.html');
  });

  it('uses the latest workspace file content across repeated direct edits on the same runner', async () => {
    const theme = createInitialThemeState();
    const latestCollectionState: {
      cards: CodeCard[];
      imageCards: ImageAssetCard[];
      projectFiles: ProjectFile[];
      roomProjects: RoomProject[];
    } = {
      cards: [],
      imageCards: [],
      projectFiles: [{
        id: 'file-1',
        projectId: 'workspace-1',
        filePath: 'styles.css',
        fileRole: 'style',
        language: 'css',
        content: '.phone {\n  color: red;\n}\n',
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }],
      roomProjects: []
    };
    const updateProjectFile = vi.fn((fileId: string, patch: Partial<ProjectFile>) => {
      latestCollectionState.projectFiles = latestCollectionState.projectFiles.map((file) => (
        file.id === fileId
          ? {
              ...file,
              ...patch,
              content: typeof patch.content === 'string' ? patch.content : file.content,
              updatedAt: file.updatedAt + 1
            }
          : file
      ));
    });

    const runner = createToolActionRunner({
      local: {
        setCommandStatus: vi.fn()
      },
      chat: {
        conversations: [],
        pendingWorkspaceProposals: [],
        addMessage: vi.fn(),
        insertMessageBefore: vi.fn(),
        insertMessageAfter: vi.fn(),
        createConversation: vi.fn(),
        findConversation: vi.fn(() => undefined),
        ensureConversationWritable: vi.fn(async (conversationId: string) => writableConversation(conversationId)),
        getConversationWritable: vi.fn((conversationId: string) => writableConversation(conversationId)),
        getConversationMessages: vi.fn(() => []),
        getConversationTask: vi.fn(() => null),
        setConversationTask: vi.fn(),
        updateMessage: vi.fn(),
        setConversationActiveProject: vi.fn(),
        upsertPendingWorkspaceProposal: vi.fn(),
        removePendingWorkspaceProposal: vi.fn(),
        appendRuntimeFeedbackEvent: vi.fn(),
        getRuntimeFeedbackEvents: vi.fn(() => [])
      },
      persona: createPersonaBindings(),
      collection: {
        cards: latestCollectionState.cards,
        imageCards: latestCollectionState.imageCards,
        projectFiles: latestCollectionState.projectFiles,
        roomProjects: latestCollectionState.roomProjects,
        readLatestState: () => latestCollectionState,
        createCard: vi.fn(),
        createProjectFile: vi.fn(),
        createProject: vi.fn(),
        promoteCardToProject: vi.fn(() => null),
        saveCardFromChat: vi.fn(),
        saveImageCardFromChat: vi.fn(),
        updateCard: vi.fn(),
        updateProject: vi.fn(),
        updateProjectFile,
        deleteProjectFile: vi.fn()
      },
      runtime: {
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
        search: {
        ...DEFAULT_WEB_SEARCH_CONFIG,
        provider: 'bingLocal',
        apiKey: '',
        bochaSummary: true,
        bochaFreshness: 'noLimit'
      },
        mcpServers: [],
        mcpToolTimeoutSeconds: 30,
        setTaskModeEnabled: vi.fn(),
        getTriggerRules: vi.fn(() => []),
        createTriggerRule: vi.fn(() => 'trigger-1'),
        updateTriggerRule: vi.fn(),
        deleteTriggerRule: vi.fn()
      },
      space: {
        activeThemePreview: null,
        activeWorld: 'chat',
        activeCardId: null,
        applyThemePatch: vi.fn(),
        applyThemePreset: vi.fn(),
        beginThemePreview: vi.fn(() => ({
          visibleThemeBeforeStart: toThemeFrame(theme)
        })),
        collectionShelf: 'project',
        commitThemePreview: vi.fn(),
        frontstageCollaboratorId: null,
        currentThemeFrame: toThemeFrame(theme),
        getActiveThemePreview: vi.fn(() => null),
        getCurrentThemeFrame: vi.fn(() => toThemeFrame(theme)),
        rollbackThemePreview: vi.fn(),
        saveCurrentSkin: vi.fn(() => null),
        setActiveCard: vi.fn(),
        setCollectionShelf: vi.fn(),
        setThemeToolMode: vi.fn(),
        setWorld: vi.fn(),
        spotlightCard: vi.fn(),
        themeToolMode: theme.toolMode
      },
      derived: {
        activeConversation: null,
        activeCollaboratorSourceId: null,
        codeCardActionModeByMessageId: {}
      },
      memoryActions: {
        appendCollaboratorMemories: vi.fn(() => true),
        writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
        readCollaboratorMemoryDoc: vi.fn(async () => null),
        maybeHandleWriteMemoryAction: vi.fn(() => false),
        applyMemoryPreview: vi.fn(() => false),
        rollbackMemoryPreview: vi.fn(() => false)
      },
      addRuntimeToolMessage: vi.fn()
    });

    const firstOutcome = await runner.runToolAction('c1', {
      kind: 'editProjectFileText',
      fileId: 'file-1',
      oldString: 'color: red;',
      newString: 'color: blue;',
      targetLabel: 'styles.css',
      openInCollection: false
    }, false);
    const secondOutcome = await runner.runToolAction('c1', {
      kind: 'editProjectFileText',
      fileId: 'file-1',
      oldString: 'color: blue;',
      newString: 'color: green;',
      targetLabel: 'styles.css',
      openInCollection: false
    }, false);

    expect(firstOutcome.status).toBe('executed');
    expect(secondOutcome.status).toBe('executed');
    expect(updateProjectFile).toHaveBeenCalledTimes(2);
    expect(latestCollectionState.projectFiles[0]?.content).toBe('.phone {\n  color: green;\n}\n');
  });

  it('stops the remaining assistant tool batch once the abort signal trips', async () => {
    const { runner, createCard } = createRunner();
    const controller = new AbortController();
    createCard.mockImplementationOnce(() => {
      controller.abort();
      return 'new-card';
    });

    await expect(runner.runAssistantToolActions('c1', [
      {
        kind: 'createCodeCard',
        card: {
          title: 'First',
          language: 'markdown',
          code: '# first'
        },
        openInCollection: true
      },
      {
        kind: 'createCodeCard',
        card: {
          title: 'Second',
          language: 'markdown',
          code: '# second'
        },
        openInCollection: true
      }
    ], {
      signal: controller.signal
    })).rejects.toMatchObject({
      name: 'AbortError'
    });

    expect(createCard).toHaveBeenCalledTimes(1);
  });

  it('keeps assistant-created collection cards in chat even when the model requests opening collection', async () => {
    const {
      runner,
      createCard,
      setActiveCard,
      setCollectionShelf,
      setWorld,
      spotlightCard
    } = createRunner();

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createCodeCard',
        card: {
          title: 'Welcome',
          language: 'html',
          code: '<main>hi</main>'
        },
        openInCollection: true
      }
    ]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      path: 'direct',
      status: 'executed',
      action: expect.objectContaining({
        kind: 'createCodeCard',
        openInCollection: false
      })
    });
    expect(createCard).toHaveBeenCalledTimes(1);
    expect(setActiveCard).toHaveBeenCalledWith('new-card');
    expect(spotlightCard).toHaveBeenCalledWith('new-card');
    expect(setCollectionShelf).not.toHaveBeenCalled();
    expect(setWorld).not.toHaveBeenCalled();
  });

  it('blocks assistant workspace creation when the conversation is not inside a workspace', async () => {
    const {
      runner,
      createProject,
      createProjectFile,
      updateProjectFile,
      setCommandStatus
    } = createRunner();

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createRoomProject',
        project: {
          projectId: 'mini-phone',
          title: 'Mini Phone'
        },
        openInCollection: true
      },
      {
        kind: 'createProjectFile',
        file: {
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          code: '<main />'
        },
        openInCollection: true
      }
    ]);

    expect(outcomes).toEqual([]);
    expect(createProject).not.toHaveBeenCalled();
    expect(createProjectFile).not.toHaveBeenCalled();
    expect(updateProjectFile).not.toHaveBeenCalled();
    expect(setCommandStatus).toHaveBeenCalledWith('工作区边界由你决定。请先新建或进入工作区，再让我在里面改文件。');
  });

  it('drops redundant createRoomProject actions when the conversation is already inside that workspace', async () => {
    const {
      runner,
      createProject,
      createProjectFile,
      setCollectionShelf
    } = createRunner({
      conversation: {
        id: 'c1',
        title: 'Mini Phone chat',
        collaboratorId: null,
        activeProjectId: 'mini-phone',
        draft: '',
        pinnedAt: null,
        updatedAt: 1,
        messages: []
      },
      roomProjects: [{
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-1'],
        entryFileId: 'file-1',
        tags: [],
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createRoomProject',
        project: {
          projectId: 'mini-phone',
          title: 'Mini Phone'
        },
        openInCollection: false
      },
      {
        kind: 'createProjectFile',
        file: {
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          code: '<main />'
        },
        openInCollection: false
      }
    ]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('executed');
    expect(createProject).not.toHaveBeenCalled();
    expect(createProjectFile).toHaveBeenCalledTimes(1);
    expect(setCollectionShelf).not.toHaveBeenCalledWith('project');
  });

  it('routes assistant createCodeCard actions into the active workspace instead of creating room cards', async () => {
    const {
      runner,
      createCard,
      createProjectFile,
      setCollectionShelf
    } = createRunner({
      conversation: {
        id: 'c1',
        title: '用户 的小餐厅',
        collaboratorId: null,
        activeProjectId: 'restaurant-workspace',
        draft: '',
        pinnedAt: null,
        updatedAt: 1,
        messages: []
      },
      roomProjects: [{
        id: 'restaurant-workspace',
        title: '新工作区',
        slug: 'new-workspace',
        fileIds: [],
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createCodeCard',
        card: {
          title: '用户 的小餐厅',
          language: 'html',
          code: '<main>menu</main>'
        },
        openInCollection: true
      }
    ]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('executed');
    expect(createCard).not.toHaveBeenCalled();
    expect(createProjectFile).toHaveBeenCalledWith({
      projectId: 'restaurant-workspace',
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      content: '<main>menu</main>',
      ownerCollaboratorId: undefined,
      source: 'chat-generated'
    });
    expect(setCollectionShelf).not.toHaveBeenCalledWith('code');
    expect(setCollectionShelf).not.toHaveBeenCalledWith('project');
  });

  it('still creates the workspace after approval when the conversation is only prebound to the draft id', async () => {
    const conversation: Conversation = {
      id: 'c1',
      title: 'Workspace chat',
      collaboratorId: null,
      activeProjectId: 'mini-phone',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    };
    const {
      runner,
      createProject,
      createProjectFile
    } = createRunner({
      conversation,
      roomProjects: []
    });

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createRoomProject',
        project: {
          projectId: 'mini-phone',
          title: 'Mini Phone'
        },
        openInCollection: false
      }
    ], {
      workspaceExecutionMode: 'execute-approved'
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('executed');
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProjectFile).not.toHaveBeenCalled();
  });

  it('blocks cross-workspace actions instead of silently forking away', async () => {
    const {
      runner,
      createProject,
      createProjectFile,
      upsertPendingWorkspaceProposal,
      appendRuntimeFeedbackEvent,
      setCommandStatus
    } = createRunner({
      conversation: {
        id: 'c1',
        title: 'Mini Phone chat',
        collaboratorId: null,
        activeProjectId: 'mini-phone',
        draft: '',
        pinnedAt: null,
        updatedAt: 1,
        messages: []
      },
      roomProjects: [{
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-1'],
        entryFileId: 'file-1',
        tags: [],
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createRoomProject',
        project: {
          projectId: 'random-helper',
          title: 'Random Helper'
        },
        openInCollection: false
      },
      {
        kind: 'createProjectFile',
        file: {
          projectId: 'random-helper',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          code: '<main />'
        },
        openInCollection: false
      }
    ]);

    expect(outcomes).toEqual([]);
    expect(createProject).not.toHaveBeenCalled();
    expect(createProjectFile).not.toHaveBeenCalled();
    expect(upsertPendingWorkspaceProposal).not.toHaveBeenCalled();
    expect(appendRuntimeFeedbackEvent).not.toHaveBeenCalled();
    expect(setCommandStatus).toHaveBeenCalledWith('工作区边界由你决定。当前对话留在 Mini Phone；要切换工作区，请先从目标工作区打开对话。');
  });

  it('blocks existing-workspace file work until the user enters that workspace', async () => {
    const {
      runner,
      createProject,
      createProjectFile,
      upsertPendingWorkspaceProposal,
      setCommandStatus
    } = createRunner({
      roomProjects: [{
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-1'],
        entryFileId: 'file-1',
        tags: [],
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }],
      projectFiles: [{
        id: 'file-1',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main />',
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'createProjectFile',
        file: {
          projectId: 'mini-phone',
          filePath: 'script.js',
          fileRole: 'logic',
          language: 'javascript',
          code: 'console.log(\"hi\")'
        },
        openInCollection: false
      }
    ]);

    expect(outcomes).toEqual([]);
    expect(createProject).not.toHaveBeenCalled();
    expect(createProjectFile).not.toHaveBeenCalled();
    expect(upsertPendingWorkspaceProposal).not.toHaveBeenCalled();
    expect(setCommandStatus).toHaveBeenCalledWith('工作区边界由你决定。请先新建或进入工作区，再让我在里面改文件。');
  });

  it('executes accepted promote-to-project actions instead of proposing them again', async () => {
    const conversation: Conversation = {
      id: 'c1',
      title: 'Card chat',
      collaboratorId: null,
      activeProjectId: null,
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    };
    const {
      runner,
      promoteCardToProject,
      setConversationActiveProject,
      upsertPendingWorkspaceProposal
    } = createRunner({
      cards: [{
        id: 'card-1',
        title: 'Landing Page',
        language: 'html',
        code: '<main />',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }],
      conversation
    });
    setConversationActiveProject.mockImplementation((conversationId: string, projectId: string | null) => {
      expect(conversationId).toBe('c1');
      conversation.activeProjectId = projectId;
    });
    promoteCardToProject.mockImplementation(() => ({
      projectId: 'workspace-landing-page',
      fileId: 'file-1'
    }));

    const outcomes = await runner.runAssistantToolActions('c1', [
      {
        kind: 'promoteCardToProject',
        cardId: 'card-1',
        projectTitle: 'Landing Page',
        filePath: 'index.html',
        fileRole: 'entry',
        openInCollection: false
      }
    ], {
      workspaceExecutionMode: 'execute-approved'
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('executed');
    expect(promoteCardToProject).toHaveBeenCalledTimes(1);
    expect(upsertPendingWorkspaceProposal).not.toHaveBeenCalled();
    expect(setConversationActiveProject).toHaveBeenCalledWith('c1', 'workspace-landing-page');
    expect(conversation.activeProjectId).toBe('workspace-landing-page');
  });
});
