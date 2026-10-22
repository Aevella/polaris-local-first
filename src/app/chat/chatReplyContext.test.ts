import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeFeedbackEvent } from '../../engines/runtime-feedback/runtimeFeedbackEvents';
import {
  filterCodeCardsForCollaboratorScope,
  filterImageCardsForCollaboratorScope,
  filterProjectFilesForCollaboratorScope
} from '../../engines/collectionOwnership';
import type { ChatMessage, CodeCard, Conversation, ImageAssetCard, ImageGenerationSettings, ProjectFile, ProviderProfile, RoomProject } from '../../types/domain';
import {
  buildReplyToolContext,
  createChatReplyRequestSnapshot,
  type ChatReplyRequestSnapshot,
  type ChatReplyRequestSnapshotSource
} from './chatReplyContext';
import type { PendingWorkspaceProposalRecord } from '../../engines/workspaceBinding';

function createSnapshot(
  cards: CodeCard[],
  activeCardId: string | null,
  options?: {
    currentCollaboratorId?: string | null;
    conversations?: Conversation[];
    imageCards?: ImageAssetCard[];
    projectFiles?: ProjectFile[];
    roomProjects?: RoomProject[];
    providers?: ProviderProfile[];
    imageGeneration?: ImageGenerationSettings;
    activeProjectId?: string | null;
    pendingWorkspaceProposal?: PendingWorkspaceProposalRecord | null;
    runtimeFeedbackEvents?: RuntimeFeedbackEvent[];
  }
): ChatReplyRequestSnapshot {
  const conversations = options?.conversations ?? [];
  const currentCollaboratorId = options?.currentCollaboratorId ?? 'persona-1';
  const activeProjectId = options?.activeProjectId ?? null;
  const collectionCards = filterCodeCardsForCollaboratorScope(cards, conversations, currentCollaboratorId);
  const imageCards = filterImageCardsForCollaboratorScope(
    options?.imageCards ?? [],
    conversations,
    currentCollaboratorId
  );
  const projectFiles = filterProjectFilesForCollaboratorScope(
    options?.projectFiles ?? [],
    currentCollaboratorId,
    activeProjectId
  );

  return {
    api: {
      id: 'provider-1',
      name: 'Test Provider',
      protocol: 'openai-completions',
      baseUrl: 'https://example.com/v1',
      path: '/chat/completions',
      apiKey: 'sk-test',
      model: 'mimo-v2-pro',
      capabilities: {
        images: false,
        streaming: true,
        thinking: false
      }
    },
    providers: options?.providers,
    imageGeneration: options?.imageGeneration,
    activeWorld: 'chat',
    collectionShelf: 'code',
    chatAvatarLayoutEnabled: false,
    themeToolMode: 'stable',
    enabledToolGroups: {},
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
      generatedCSS: ''
    },
    selectedSurfaceCodes: [],
    collectionCards,
    imageCards,
    projectFiles,
    roomProjects: options?.roomProjects ?? [],
    activeCardId,
    activeProjectId,
    pendingWorkspaceProposal: options?.pendingWorkspaceProposal ?? null,
    runtimeFeedbackEvents: options?.runtimeFeedbackEvents ?? [],
    conversations,
    personas: [{
      id: 'persona-1',
      name: '灯塔',
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
    } as never],
    currentCollaboratorId,
    activeConversationTitle: '测试会话',
    activeCollaborator: {
      id: 'persona-1',
      name: '灯塔',
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
    } as never
  };
}

function createSnapshotSource(
  overrides?: Partial<ChatReplyRequestSnapshotSource>
): ChatReplyRequestSnapshotSource {
  const snapshot = createSnapshot([], null);

  return {
    api: snapshot.api,
    activeWorld: snapshot.activeWorld,
    collectionShelf: snapshot.collectionShelf,
    chatAvatarLayoutEnabled: snapshot.chatAvatarLayoutEnabled,
    themeToolMode: snapshot.themeToolMode,
    enabledToolGroups: snapshot.enabledToolGroups,
    taskModeEnabled: snapshot.taskModeEnabled,
    mcpServers: snapshot.mcpServers,
    mcpToolTimeoutSeconds: snapshot.mcpToolTimeoutSeconds,
    themePreviewActive: snapshot.themePreviewActive,
    currentThemeFrame: snapshot.currentThemeFrame,
    recentThemeToolModeSwitch: snapshot.recentThemeToolModeSwitch,
    selectedSurfaceCodes: snapshot.selectedSurfaceCodes,
    collectionCards: snapshot.collectionCards,
    imageCards: snapshot.imageCards,
    projectFiles: snapshot.projectFiles,
    roomProjects: snapshot.roomProjects,
    activeCardId: snapshot.activeCardId,
    conversations: snapshot.conversations,
    personas: snapshot.personas,
    currentCollaboratorId: snapshot.currentCollaboratorId,
    currentTask: snapshot.currentTask,
    pendingWorkspaceProposal: snapshot.pendingWorkspaceProposal,
    runtimeFeedbackEvents: snapshot.runtimeFeedbackEvents,
    activeConversationTitle: snapshot.activeConversationTitle,
    activeCollaborator: snapshot.activeCollaborator,
    ...overrides
  };
}

describe('createChatReplyRequestSnapshot', () => {
  it('keeps a pending workspace proposal for the active conversation', () => {
    const proposal: PendingWorkspaceProposalRecord = {
      id: 'proposal-1',
      conversationId: 'conversation-1',
      source: 'model-proposed',
      requestedProjectTitle: 'Workspace',
      requestedActionKinds: ['createRoomProject'],
      status: 'pending',
      createdAt: 1,
      requestedActions: []
    };

    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource({
        pendingWorkspaceProposal: proposal
      }),
      activeConversation: {
        id: 'conversation-1',
        title: '工作区对话'
      }
    });

    expect(snapshot.pendingWorkspaceProposal).toBe(proposal);
  });

  it('drops a pending workspace proposal from another conversation', () => {
    const proposal: PendingWorkspaceProposalRecord = {
      id: 'proposal-1',
      conversationId: 'other-conversation',
      source: 'model-proposed',
      requestedProjectTitle: 'Workspace',
      requestedActionKinds: ['createRoomProject'],
      status: 'pending',
      createdAt: 1,
      requestedActions: []
    };

    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource({
        pendingWorkspaceProposal: proposal
      }),
      activeConversation: {
        id: 'conversation-1',
        title: '工作区对话'
      }
    });

    expect(snapshot.pendingWorkspaceProposal).toBeNull();
  });

  it('copies the active workspace binding from the live conversation into the request snapshot', () => {
    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource({
        roomProjects: [{
          id: 'workspace-3',
          title: '工作区',
          slug: 'workspace',
          fileIds: [],
          tags: [],
          source: 'manual',
          createdAt: 1,
          updatedAt: 1
        }]
      }),
      activeConversation: {
        id: 'conversation-1',
        title: '工作区对话',
        activeProjectId: 'workspace-3'
      }
    });

    expect(snapshot.activeProjectId).toBe('workspace-3');
    expect(snapshot.activeConversationTitle).toBe('测试会话');
  });

  it('carries avatar chat layout state into the model-facing ui snapshot', () => {
    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource({
        chatAvatarLayoutEnabled: true
      }),
      activeConversation: {
        id: 'conversation-1',
        title: '头像房间'
      }
    });

    const context = buildReplyToolContext({
      snapshot,
      collaboratorId: 'persona-1',
      messages: []
    });

    expect(context.toolContext.uiSnapshot?.chatAvatarLayoutEnabled).toBe(true);
  });

  it('drops a stale workspace binding when the project no longer exists', () => {
    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource(),
      activeConversation: {
        id: 'conversation-1',
        title: '旧工作区对话',
        activeProjectId: 'missing-workspace'
      }
    });

    expect(snapshot.activeProjectId).toBeNull();
    expect(snapshot.projectFiles).toEqual([]);
  });

  it('filters image collection materials into theme-visible snapshot context', () => {
    const conversations: Conversation[] = [
      { id: 'conv-1', title: 'Nova', collaboratorId: 'persona-1', updatedAt: 1, pinnedAt: null, messages: [] },
      { id: 'conv-2', title: 'Other', collaboratorId: 'persona-2', updatedAt: 1, pinnedAt: null, messages: [] }
    ];
    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource({
        conversations,
        imageCards: [
          {
            id: 'image-toast',
            assetId: 'asset-toast',
            title: '吐司贴纸',
            tags: ['贴纸'],
            source: 'imported',
            createdAt: 1,
            updatedAt: 2,
            originConversationId: 'conv-1'
          },
          {
            id: 'image-other',
            assetId: 'asset-other',
            title: '别人的素材',
            tags: ['背景'],
            source: 'imported',
            createdAt: 1,
            updatedAt: 3,
            originConversationId: 'conv-2'
          }
        ]
      }),
      activeConversation: {
        id: 'conversation-1',
        title: '换肤对话',
        activeProjectId: null
      }
    });

    const result = buildReplyToolContext({
      snapshot,
      collaboratorId: 'persona-1',
      messages: []
    });

    expect(result.toolContext.imageAssetSnapshot?.available).toEqual([{
      id: 'image-toast',
      assetId: 'asset-toast',
      title: '吐司贴纸',
      tags: ['贴纸'],
      source: 'imported',
      cssUrl: 'url("polaris-asset://asset-toast")'
    }]);
  });

  it('keeps the workspace binding empty when the live conversation is not bound', () => {
    const snapshot = createChatReplyRequestSnapshot({
      source: createSnapshotSource(),
      activeConversation: {
        id: 'conversation-1',
        title: '普通对话',
        activeProjectId: null
      }
    });

    expect(snapshot.activeProjectId).toBeNull();
  });
});

describe('buildReplyToolContext', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the current turn continue-card over a stale active card and forces a real room action', () => {
    const cards: CodeCard[] = [
      {
        id: 'card-1',
        kind: 'card',
        title: '旧房间',
        language: 'html',
        code: '<div>old</div>',
        tags: [],
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'card-2',
        kind: 'card',
        title: '新房间',
        language: 'html',
        code: '<div>new</div>',
        tags: [],
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      }
    ];
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: '继续改这张',
        timestamp: 1,
        cardReference: {
          id: 'card-2',
          title: '新房间',
          language: 'html',
          code: '<div>new</div>',
          mode: 'continue'
        }
      }
    ];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.effectiveActiveCardId).toBe('card-2');
    expect(result.toolContext.activeCard?.id).toBe('card-2');
    expect(result.toolContext.activeCardReferenceMode).toBe('continue');
    expect(result.toolContext.toolEnforcementMode).toBe('force');
    expect(result.toolContext.toolEnforcementScope).toBeUndefined();
  });

  it('marks image generation available only when the selected provider still exists', () => {
    const provider: ProviderProfile = {
      id: 'image-provider',
      name: 'Image Provider',
      protocol: 'openai-completions',
      baseUrl: 'https://example.com/v1',
      path: '/chat/completions',
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      capabilities: {
        images: true,
        streaming: false,
        thinking: false
      }
    };
    const imageGeneration: ImageGenerationSettings = {
      enabled: true,
      providerId: provider.id,
      size: '1024x1024'
    };

    expect(buildReplyToolContext({
      snapshot: createSnapshot([], null, {
        providers: [provider],
        imageGeneration
      }),
      collaboratorId: 'persona-1',
      messages: []
    }).toolContext.imageGenerationAvailable).toBe(true);

    expect(buildReplyToolContext({
      snapshot: createSnapshot([], null, {
        providers: [],
        imageGeneration
      }),
      collaboratorId: 'persona-1',
      messages: []
    }).toolContext.imageGenerationAvailable).toBe(false);
  });

  it('falls back to the collection active card when this turn did not attach a continue-card', () => {
    const cards: CodeCard[] = [{
      id: 'card-1',
      kind: 'card',
      title: '旧房间',
      language: 'html',
      code: '<div>old</div>',
      tags: [],
      ownerCollaboratorId: 'persona-1',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '随便聊聊',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.effectiveActiveCardId).toBe('card-1');
    expect(result.toolContext.activeCard?.id).toBe('card-1');
    expect(result.toolContext.activeCardReferenceMode).toBe('ambient');
    expect(result.toolContext.toolEnforcementMode).toBe('normal');
  });

  it('treats an attached reference card as context without forcing a room action', () => {
    const cards: CodeCard[] = [
      {
        id: 'card-1',
        kind: 'card',
        title: '屏幕上旧房间',
        language: 'html',
        code: '<div>old</div>',
        tags: [],
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'card-2',
        kind: 'card',
        title: '附带参考房间',
        language: 'html',
        code: '<div>reference</div>',
        tags: [],
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      }
    ];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '这张像什么？',
      timestamp: 1,
      cardReference: {
        id: 'card-2',
        title: '附带参考房间',
        language: 'html',
        code: '<div>reference</div>',
        mode: 'reference'
      }
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.effectiveActiveCardId).toBe('card-2');
    expect(result.toolContext.activeCard?.id).toBe('card-2');
    expect(result.toolContext.activeCardReferenceMode).toBe('reference');
    expect(result.toolContext.toolEnforcementMode).toBe('normal');
  });

  it('projects workspace read-write history into the unified work context', () => {
    const projectFiles: ProjectFile[] = [
      {
        id: 'file-entry',
        projectId: 'workspace-1',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main />',
        source: 'chat-generated',
        createdAt: 1,
        updatedAt: 10
      },
      {
        id: 'file-style',
        projectId: 'workspace-1',
        filePath: 'styles.css',
        fileRole: 'style',
        language: 'css',
        content: 'body {}',
        source: 'chat-generated',
        createdAt: 2,
        updatedAt: 20
      }
    ];
    const roomProjects: RoomProject[] = [{
      id: 'workspace-1',
      title: 'Mini Phone',
      slug: 'mini-phone',
      fileIds: ['file-entry', 'file-style'],
      entryFileId: 'file-entry',
      tags: [],
      source: 'chat-generated',
      createdAt: 1,
      updatedAt: 20
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot([], null, {
        projectFiles,
        roomProjects,
        activeProjectId: 'workspace-1',
      }),
      collaboratorId: 'persona-1',
      messages: [
        {
          id: 'tool-read',
          role: 'system',
          origin: 'tool-runtime',
          content: '已读取 index.html',
          timestamp: 10,
          toolInvocation: {
            id: 'tool-read',
            kind: 'readProjectFile',
            status: 'executed',
            title: '已读取工作区文件',
            summary: '已读取 index.html',
            projectFileId: 'file-entry'
          }
        },
        {
          id: 'tool-write',
          role: 'system',
          origin: 'tool-runtime',
          content: '已写入 styles.css',
          timestamp: 20,
          toolInvocation: {
            id: 'tool-write',
            kind: 'writeProjectFiles',
            status: 'executed',
            title: '已写入工作区文件',
            summary: '已写入 styles.css',
            projectFileId: 'file-style'
          }
        }
      ]
    });

    expect(result.toolContext.workContext?.workspaceLines).toEqual([
      '最近刚改过：styles.css',
      '工作台状态：最近修改未验证。'
    ]);
  });

  it('does not force a room action from plain user wording alone', () => {
    const cards: CodeCard[] = [{
      id: 'card-1',
      kind: 'card',
      title: 'Mini iPhone',
      language: 'html',
      code: '<main></main>',
      tags: [],
      ownerCollaboratorId: 'persona-1',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '继续做，给这个项目加一个控制中心',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.effectiveActiveCardId).toBe('card-1');
    expect(result.toolContext.toolEnforcementMode).toBe('normal');
  });

  it('does not force a room action for an explanatory question about the active card', () => {
    const cards: CodeCard[] = [{
      id: 'card-1',
      kind: 'card',
      title: 'Mini iPhone',
      language: 'html',
      code: '<main></main>',
      tags: [],
      ownerCollaboratorId: 'persona-1',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '这个项目为什么这样写？',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.toolEnforcementMode).toBe('normal');
  });

  it('does not force a room action for project-like wording without an explicit continue reference', () => {
    const cards: CodeCard[] = [{
      id: 'card-1',
      kind: 'card',
      title: 'Mini iPhone',
      language: 'html',
      code: '<main></main>',
      tags: [],
      ownerCollaboratorId: 'persona-1',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '继续做，给这个项目加一个控制中心',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-1'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.toolEnforcementMode).toBe('normal');
    expect(result.toolContext.toolEnforcementScope).toBeUndefined();
  });

  it('passes a recent theme mode switch into the tool context as a hard handoff hint', () => {
    const cards: CodeCard[] = [];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '再换一个',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: {
        ...createSnapshot(cards, null),
        recentThemeToolModeSwitch: {
          from: 'creative',
          to: 'stable'
        }
      },
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.themeModeSwitchHint).toEqual({
      from: 'creative',
      to: 'stable'
    });
  });

  it('keeps the full collection card directory visible instead of truncating it to four cards', () => {
    const cards: CodeCard[] = Array.from({ length: 6 }, (_, index) => ({
      id: `card-${index + 1}`,
      kind: 'card',
      title: `房间 ${index + 1}`,
      language: 'html',
      code: `<div>${index + 1}</div>`,
      tags: [],
      ownerCollaboratorId: 'persona-1',
      source: 'manual',
      createdAt: index + 1,
      updatedAt: index + 1
    }));
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '看看收藏里都有什么',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, null, { currentCollaboratorId: null }),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.visibleCards).toHaveLength(6);
    expect(result.toolContext.visibleCards[5]?.id).toBe('card-6');
  });

  it('hides other collaborators cards from the visible directory and active room context', () => {
    const cards: CodeCard[] = [
      {
        id: 'card-1',
        kind: 'card',
        title: '灯塔的房间',
        language: 'html',
        code: '<div>mine</div>',
        tags: [],
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'card-2',
        kind: 'card',
        title: '别人的房间',
        language: 'html',
        code: '<div>other</div>',
        tags: [],
        ownerCollaboratorId: 'persona-2',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      }
    ];
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '看看收藏里都有什么',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot(cards, 'card-2'),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.visibleCards.map((card) => card.id)).toEqual(['card-1']);
    expect(result.toolContext.activeCard).toBeNull();
  });

  it('includes the current runCode sandbox profile in the tool context', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem(key: string) {
          return key === 'polaris-run-code-sandbox-mode' ? 'experimental' : null;
        }
      }
    });
    const messages: ChatMessage[] = [{
      id: 'user-1',
      role: 'user',
      content: '跑点代码',
      timestamp: 1
    }];

    const result = buildReplyToolContext({
      snapshot: createSnapshot([], null),
      collaboratorId: 'persona-1',
      messages
    });

    expect(result.toolContext.runCodeSandboxProfile).toBe('experimental');
  });

  it('projects pending workspace proposals and project open loops into runtime feedback', () => {
    const proposal: PendingWorkspaceProposalRecord = {
      id: 'proposal-1',
      conversationId: 'conversation-1',
      source: 'model-proposed',
      requestedProjectTitle: 'Mini Phone',
      requestedActionKinds: ['createRoomProject', 'createProjectFile'],
      requestedFilePaths: ['index.html', 'app.js'],
      draftProjectId: 'mini-phone',
      status: 'pending',
      createdAt: 1,
      requestedActions: []
    };

    const result = buildReplyToolContext({
      snapshot: {
        ...createSnapshot([], null, {
          pendingWorkspaceProposal: proposal,
          runtimeFeedbackEvents: [{
            id: 'rtf-1',
            kind: 'assistant_tool_preparation_failed',
            createdAt: 2,
            status: 'parse_failed',
            summary: '上一轮工具准备失败，工具块没有通过解析。'
          }]
        }),
        activeProjectId: 'mini-phone',
        roomProjects: [{
          id: 'mini-phone',
          title: 'Mini Phone',
          slug: 'mini-phone',
          fileIds: [],
          tags: [],
          source: 'manual',
          createdAt: 1,
          updatedAt: 1
        }]
      },
      collaboratorId: 'persona-1',
      messages: []
    });

    expect(result.toolContext.activeProject).toMatchObject({
      id: 'mini-phone',
      title: 'Mini Phone',
      fileCount: 0,
      files: []
    });
    expect(result.toolContext.runtimeFeedback?.pendingWorkspaceProposal?.id).toBe('proposal-1');
    expect(result.toolContext.workContext?.feedbackLines).toContain(
      '当前工作区“Mini Phone”还没有文件。'
    );
    expect(result.toolContext.runtimeFeedback?.events).toEqual([
      expect.objectContaining({
        id: 'rtf-1',
        kind: 'assistant_tool_preparation_failed'
      })
    ]);
  });

  it('keeps the active workspace files visible even when they belong to another collaborator', () => {
    const roomProjects: RoomProject[] = [{
      id: 'workspace-1',
      title: '今日随机小助手',
      slug: 'workspace-1',
      ownerCollaboratorId: 'persona-2',
      entryFileId: 'file-index',
      fileIds: ['file-index', 'file-script', 'file-style'],
      tags: [],
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    }];
    const projectFiles: ProjectFile[] = [
      {
        id: 'file-index',
        projectId: 'workspace-1',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main></main>',
        ownerCollaboratorId: 'persona-2',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'file-script',
        projectId: 'workspace-1',
        filePath: 'script.js',
        fileRole: 'logic',
        language: 'javascript',
        content: 'console.log(\"hi\")',
        ownerCollaboratorId: 'persona-2',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      },
      {
        id: 'file-style',
        projectId: 'workspace-1',
        filePath: 'style.css',
        fileRole: 'style',
        language: 'css',
        content: 'body {}',
        ownerCollaboratorId: 'persona-2',
        source: 'manual',
        createdAt: 3,
        updatedAt: 3
      },
      {
        id: 'other-file',
        projectId: 'workspace-2',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main>other</main>',
        ownerCollaboratorId: 'persona-2',
        source: 'manual',
        createdAt: 4,
        updatedAt: 4
      }
    ];

    const result = buildReplyToolContext({
      snapshot: createSnapshot([], null, {
        currentCollaboratorId: 'persona-1',
        projectFiles,
        roomProjects,
        activeProjectId: 'workspace-1'
      }),
      collaboratorId: 'persona-1',
      messages: []
    });

    expect(result.toolContext.visibleProjectFiles.map((file) => file.id)).toEqual([
      'file-index',
      'file-script',
      'file-style'
    ]);
    expect(result.toolContext.activeProject?.id).toBe('workspace-1');
    expect(result.toolContext.activeProject?.fileCount).toBe(3);
    expect(result.toolContext.activeProject?.entryFilePath).toBe('index.html');
    expect(result.toolContext.workContext?.feedbackLines).toEqual([]);
  });

  it('hides sibling workspace files once the conversation is already inside one workspace', () => {
    const roomProjects: RoomProject[] = [
      {
        id: 'workspace-1',
        title: '当前工作区',
        slug: 'workspace-1',
        entryFileId: 'file-index',
        fileIds: ['file-index'],
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'workspace-2',
        title: '别的工作区',
        slug: 'workspace-2',
        entryFileId: 'other-file',
        fileIds: ['other-file'],
        tags: [],
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      }
    ];
    const projectFiles: ProjectFile[] = [
      {
        id: 'file-index',
        projectId: 'workspace-1',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main>current</main>',
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'other-file',
        projectId: 'workspace-2',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main>other</main>',
        ownerCollaboratorId: 'persona-1',
        source: 'manual',
        createdAt: 2,
        updatedAt: 2
      }
    ];

    const result = buildReplyToolContext({
      snapshot: createSnapshot([], null, {
        currentCollaboratorId: 'persona-1',
        projectFiles,
        roomProjects,
        activeProjectId: 'workspace-1'
      }),
      collaboratorId: 'persona-1',
      messages: []
    });

    expect(result.toolContext.visibleProjectFiles.map((file) => file.id)).toEqual(['file-index']);
    expect(result.toolContext.visibleProjects?.map((project) => project.id)).toEqual(['workspace-1']);
  });
});


describe('conversation context request projection', () => {
  it('carries the selected window override into the effective request persona', () => {
    const source = createSnapshotSource();
    const conversation: Conversation = { id: 'context-window', title: 'Window', collaboratorId: 'persona-1', messages: [], pinnedAt: null, updatedAt: 1, requestContext: { mode: 'recent' as const, messageCount: 500 } };
    source.conversations = [conversation];
    const snapshot = createChatReplyRequestSnapshot({ source, activeConversation: conversation });
    expect(snapshot.requestContext).toEqual({ mode: 'recent', messageCount: 500 });
    const result = buildReplyToolContext({ snapshot, collaboratorId: 'persona-1', messages: [] });
    expect(result.collaboratorForReply?.advanced.contextMessageLimit).toBe('500');
    expect(source.personas.find(persona => persona.id === 'persona-1')?.advanced.contextMessageLimit).not.toBe('500');
  });
});


describe('window MCP scope projection', () => {
  it('filters the real snapshot and tool context through the same selected set', () => {
    const source = createSnapshotSource();
    source.mcpServers = [{ id: 'allowed', name: 'Allowed' }, { id: 'other', name: 'Other' }] as typeof source.mcpServers;
    const conversation: Conversation = { id: 'mcp-window', title: 'Window', collaboratorId: 'persona-1', messages: [], pinnedAt: null, updatedAt: 1, windowPreferences: { historicalImagePolicy: 'smart', composerReturnKeyBehavior: 'automatic', mcpScope: { mode: 'selected', serverIds: ['allowed', 'outside-collaborator-scope'] } } };
    source.conversations = [conversation];
    const snapshot = createChatReplyRequestSnapshot({ source, activeConversation: conversation });
    expect(snapshot.mcpServers.map(server => server.id)).toEqual(['allowed']);
    expect(buildReplyToolContext({ snapshot, collaboratorId: 'persona-1', messages: [] }).toolContext.mcpServers?.map(server => server.id)).toEqual(['allowed']);
  });
});
