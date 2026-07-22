import { describe, expect, it } from 'vitest';
import { buildApiRequest } from '../../engines/chat-api/chatApiRequestBuilder';
import { prepareCollaboratorReplyRequest } from '../../engines/request/requestPreparation';
import { resolveAssistantToolRequestTools } from '../../engines/tool-protocol/assistantToolProtocolRequestTools';
import type { AssistantToolContext } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ToolActionRunOutcome } from './chatToolOutcome';
import type {
  ChatMessage,
  CodeCard,
  Conversation,
  ConversationTaskState,
  Persona,
  ProjectFile,
  ProviderProfile,
  RoomProject,
  ThemeFrame
} from '../../types/domain';
import {
  buildReplyToolContext,
  type ChatReplyRequestSnapshot
} from './chatReplyContext';
import {
  resolveToolFollowupPlan,
  shouldRequestLengthFollowup
} from './chatToolFollowup';

const now = 1_774_000_000_000;

function createProvider(): ProviderProfile {
  return {
    id: 'provider-1',
    name: 'OpenAI compatible',
    protocol: 'openai-completions',
    baseUrl: 'https://example.com/v1',
    path: '/chat/completions',
    apiKey: 'sk-test',
    model: 'test-model',
    capabilities: {
      images: false,
      streaming: true,
      thinking: false
    }
  };
}

function createAdvanced(overrides: Partial<Persona['advanced']> = {}): Persona['advanced'] {
  return {
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
    snippets: [],
    ...overrides
  };
}

function createPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-1',
    name: 'Pharos',
    advanced: createAdvanced(),
    ...overrides
  } as Persona;
}

function createThemeFrame(): ThemeFrame {
  return {
    activePresetId: null,
    activeSavedSkinId: null,
    cssVariables: {},
    presetCSS: '',
    customCSS: '',
    generatedCSS: ''
  };
}

function createUserMessage(content: string, id = 'user-1'): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp: now,
    origin: 'user-input'
  };
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    title: 'Flow replay',
    collaboratorId: 'persona-1',
    activeProjectId: null,
    messages: [],
    pinnedAt: null,
    updatedAt: now,
    ...overrides
  };
}

function createProject(overrides: Partial<RoomProject> = {}): RoomProject {
  return {
    id: 'project-1',
    title: 'Empty Workspace',
    slug: 'empty-workspace',
    fileIds: [],
    tags: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createProjectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    projectId: 'project-1',
    filePath: 'index.html',
    fileRole: 'entry',
    language: 'html',
    content: '<main>Hello</main>',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createCard(overrides: Partial<CodeCard> = {}): CodeCard {
  return {
    id: 'card-1',
    kind: 'card',
    title: 'Loose Card',
    language: 'html',
    code: '<main>Loose</main>',
    tags: [],
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createSeedTask(): ConversationTaskState {
  return {
    id: 'task-1',
    sourceMessageId: 'user-1',
    goal: 'Build the thing',
    title: 'Build the thing',
    mode: 'seed',
    status: 'running',
    stage: 'Starting',
    steps: [],
    executions: [],
    createdAt: now,
    updatedAt: now
  };
}

function createSnapshot(overrides: Partial<ChatReplyRequestSnapshot> = {}): ChatReplyRequestSnapshot {
  const persona = createPersona();

  return {
    api: createProvider(),
    activeWorld: 'chat',
    collectionShelf: 'code',
    chatAvatarLayoutEnabled: false,
    themeToolMode: 'stable',
    enabledToolGroups: {
      room: true,
      project: true,
      theme: true,
      attachment: true,
      archive: true,
      generation: true,
      web: true,
      memory: true
    },
    taskModeEnabled: false,
    mcpServers: [],
    mcpToolTimeoutSeconds: 30,
    themePreviewActive: false,
    currentThemeFrame: createThemeFrame(),
    selectedSurfaceCodes: [],
    collectionCards: [],
    imageCards: [],
    projectFiles: [],
    roomProjects: [],
    activeCardId: null,
    activeProjectId: null,
    pendingWorkspaceProposal: null,
    runtimeFeedbackEvents: [],
    conversations: [createConversation()],
    personas: [persona],
    currentCollaboratorId: persona.id,
    activeConversationTitle: 'Flow replay',
    activeCollaborator: persona,
    ...overrides
  };
}

function toolNames(context: AssistantToolContext) {
  return resolveAssistantToolRequestTools(context).tools.map((tool) => tool.function.name);
}

type DirectToolOutcome = Extract<ToolActionRunOutcome, { path: 'direct' }>;

function createExecutedOutcome(
  action: DirectToolOutcome['action'],
  toolInvocation: Partial<DirectToolOutcome['toolInvocation']> = {}
): ToolActionRunOutcome {
  return {
    path: 'direct',
    status: 'executed',
    action,
    toolInvocation: {
      id: `tool-${action.kind}`,
      kind: action.kind,
      status: 'executed',
      title: action.kind,
      summary: `executed ${action.kind}`,
      ...toolInvocation
    }
  } as ToolActionRunOutcome;
}

describe('chat workflow stability scenarios', () => {
  it('keeps an empty active workspace as workspace context instead of falling back to loose cards', async () => {
    const project = createProject();
    const looseCard = createCard();
    const conversation = createConversation({ activeProjectId: project.id });
    const messages = [createUserMessage('Create the first index file in this workspace')];
    const snapshot = createSnapshot({
      collectionCards: [looseCard],
      roomProjects: [project],
      projectFiles: [],
      conversations: [conversation],
      activeProjectId: project.id
    });

    const { toolContext } = buildReplyToolContext({
      snapshot,
      collaboratorId: 'persona-1',
      messages
    });
    const names = toolNames(toolContext);
    const prepared = await prepareCollaboratorReplyRequest({
      api: snapshot.api,
      persona: null,
      messages,
      toolContext,
      currentTask: snapshot.currentTask,
      nickname: '用户'
    });

    expect(toolContext.activeProject?.id).toBe(project.id);
    expect(toolContext.activeProject?.fileCount).toBe(0);
    expect(toolContext.visibleProjectFiles).toEqual([]);
    expect(toolContext.workContext?.feedbackLines).toContain('当前工作区“Empty Workspace”还没有文件。');
    expect(names).toContain('createProjectFile');
    expect(names).not.toContain('writeProjectFiles');
    expect(names).not.toContain('createCodeCard');
    expect(prepared.audit.tooling.toolNames).toContain('createProjectFile');
    expect(prepared.audit.tooling.toolNames).not.toContain('writeProjectFiles');
    expect(prepared.audit.tooling.toolNames).not.toContain('createCodeCard');
  });

  it('keeps ordinary seeded task chats chat-light enough to avoid forced tool calls and output caps', async () => {
    const messages = [createUserMessage('Think through a plan first, do not edit yet')];
    const seedTask = createSeedTask();
    const snapshot = createSnapshot({
      taskModeEnabled: true,
      currentTask: seedTask
    });

    const { toolContext } = buildReplyToolContext({
      snapshot,
      collaboratorId: 'persona-1',
      messages
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: snapshot.api,
      persona: null,
      messages,
      toolContext,
      currentTask: seedTask,
      nickname: '用户'
    });
    const built = buildApiRequest({
      api: snapshot.api,
      context: prepared.context,
      advanced: prepared.advanced
    });

    expect(toolContext.activeProject).toBeNull();
    expect(toolContext.toolEnforcementMode).toBe('normal');
    expect(prepared.context.toolChoice).toBe('auto');
    expect(built.body.tool_choice).toBe('auto');
    expect(built.body.max_tokens).toBeUndefined();
    expect(built.body.max_completion_tokens).toBeUndefined();
    expect(built.body.max_output_tokens).toBeUndefined();
  });

  it('uses project tools without inventing an output budget after the conversation is actually workspace-bound', async () => {
    const project = createProject({
      fileIds: ['file-1'],
      entryFileId: 'file-1'
    });
    const file = createProjectFile();
    const conversation = createConversation({ activeProjectId: project.id });
    const messages = [createUserMessage('Continue index.html')];
    const snapshot = createSnapshot({
      roomProjects: [project],
      projectFiles: [file],
      conversations: [conversation],
      activeProjectId: project.id
    });

    const { toolContext } = buildReplyToolContext({
      snapshot,
      collaboratorId: 'persona-1',
      messages
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: snapshot.api,
      persona: null,
      messages,
      toolContext,
      nickname: '用户'
    });
    const built = buildApiRequest({
      api: snapshot.api,
      context: prepared.context,
      advanced: prepared.advanced
    });
    const names = toolNames(toolContext);

    expect(toolContext.activeProject?.id).toBe(project.id);
    expect(names).toContain('appendProjectFile');
    expect(names).toContain('readProjectFile');
    expect(names).not.toContain('appendCodeCard');
    expect(prepared.advanced?.maxTokens).toBeUndefined();
    expect(built.body.max_tokens).toBeUndefined();
    expect(built.body.max_completion_tokens).toBeUndefined();
    expect(built.body.max_output_tokens).toBeUndefined();
  });

  it('continues new workspace exchanges without a depth cap but stops completed tasks', () => {
    const workspacePlan = resolveToolFollowupPlan({
      outcomes: [
        createExecutedOutcome({
          kind: 'appendProjectFile',
          fileId: 'file-1',
          code: '\n<section>Next chunk</section>'
        }, {
          projectFilePaths: ['index.html']
        })
      ]
    });
    const completedPlan = resolveToolFollowupPlan({
      outcomes: [
        createExecutedOutcome({
          kind: 'completeTask',
          stage: 'Done',
          summary: 'The workspace task is complete.'
        })
      ]
    });

    expect(workspacePlan?.exchangeFingerprint).toContain('index.html');
    expect(workspacePlan).not.toHaveProperty('message');
    expect(completedPlan).toBeNull();
  });

  it('continues a new desktop exchange from its real result without injecting instructions', () => {
    const desktopPlan = resolveToolFollowupPlan({
      outcomes: [
        createExecutedOutcome({
          kind: 'runDesktopCommand',
          command: 'npm',
          args: ['test'],
          rootId: 'root-1',
          cwdPath: '.'
        })
      ]
    });

    expect(desktopPlan?.exchangeFingerprint).toContain('runDesktopCommand');
    expect(desktopPlan).not.toHaveProperty('message');
  });

  it('requests continuation for length-truncated replies and truncated tool arguments before giving up', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 0
    })).toBe(true);
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'stop' },
      isTruncatedToolOutput: true,
      depth: 1
    })).toBe(true);
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 2
    })).toBe(false);
  });
});
