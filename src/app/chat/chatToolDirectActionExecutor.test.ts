import { describe, expect, it, vi } from 'vitest';
import { createDirectToolActionExecutor } from './chatToolDirectActionExecutor';
import { DEFAULT_WEB_SEARCH_CONFIG } from '../../stores/runtimeStoreSearch';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ProjectFile, RoomProject } from '../../types/domain';

type DirectActionExecutorArgs = Parameters<typeof createDirectToolActionExecutor>[0];

function writableConversation(): WritableConversationBody {
  return {
    conversationId: 'conversation-1',
    conversation: {
      id: 'conversation-1',
      title: 'Workspace chat',
      collaboratorId: 'pharos',
      activeProjectId: 'project-1',
      draft: '',
      pinnedAt: null,
      updatedAt: 1,
      messages: []
    },
    messages: []
  };
}

function createProject(patch: Partial<RoomProject> = {}): RoomProject {
  return {
    id: 'project-1',
    title: 'Active Workspace',
    slug: 'active-workspace',
    fileIds: [],
    tags: [],
    source: 'manual',
    createdAt: 1,
    updatedAt: 2,
    ...patch
  };
}

function createProjectFile(patch: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    projectId: 'project-1',
    filePath: 'src/App.tsx',
    fileRole: 'entry',
    language: 'tsx',
    content: 'export function App() {\n  return <main>Old</main>;\n}\n',
    ownerCollaboratorId: 'pharos',
    source: 'chat-generated',
    createdAt: 1,
    updatedAt: 2,
    ...patch
  };
}

function createExecutorHarness() {
  const projectFiles: ProjectFile[] = [createProjectFile()];
  const roomProjects: RoomProject[] = [createProject()];
  const addRuntimeToolMessage = vi.fn();
  const updateMessage = vi.fn();
  const setCommandStatus = vi.fn();
  const createProjectFileMock = vi.fn((seed: Partial<ProjectFile> & Pick<ProjectFile, 'projectId' | 'filePath'>) => {
    const file = createProjectFile({
      id: 'file-created',
      projectId: seed.projectId,
      filePath: seed.filePath,
      fileRole: seed.fileRole,
      language: seed.language ?? 'txt',
      content: seed.content ?? ''
    });
    projectFiles.push(file);
    return file.id;
  });
  const updateProjectFile = vi.fn((fileId: string, patch: Partial<ProjectFile>) => {
    const file = projectFiles.find((entry) => entry.id === fileId);
    if (!file) return;
    Object.assign(file, patch);
  });
  const collectionState = () => ({
    cards: [],
    imageCards: [],
    projectFiles,
    workspaceReferenceDocs: [],
    roomProjects
  });
  const args: DirectActionExecutorArgs = {
    local: { setCommandStatus },
    chat: {
      conversations: [{
        id: 'conversation-1',
        title: 'Workspace chat',
        collaboratorId: 'pharos',
        activeProjectId: 'project-1',
        messages: [],
        pinnedAt: null,
        updatedAt: 1
      }],
      findConversation: () => ({
        id: 'conversation-1',
        collaboratorId: 'pharos',
        activeProjectId: 'project-1'
      }),
      getConversationMessages: () => [],
      readLatestState: () => ({
        conversations: [{
          id: 'conversation-1',
          title: 'Workspace chat',
          collaboratorId: 'pharos',
          activeProjectId: 'project-1',
          messages: [],
          pinnedAt: null,
          updatedAt: 1
        }],
        groupRooms: [],
        activeGroupRoomId: null,
        pendingWorkspaceProposals: []
      }),
      updateMessage,
      appendRuntimeFeedbackEvent: vi.fn(),
      setConversationActiveProject: vi.fn()
    },
    persona: {
      personas: [{
        id: 'pharos',
        name: 'Pharos',
        avatar: '',
        prompt: '',
        compiledPrompt: '',
        color: '#7B8ABF',
        createdAt: 1,
        updatedAt: 1
      } as never]
    },
    collection: {
      cards: [],
      imageCards: [],
      projectFiles,
      workspaceReferenceDocs: [],
      roomProjects,
      readLatestState: collectionState,
      createCard: vi.fn(),
      createProjectFile: createProjectFileMock,
      createProject: vi.fn(),
      updateProject: vi.fn(),
      promoteCardToProject: vi.fn(),
      saveCardFromChat: vi.fn(),
      saveImageCardFromChat: vi.fn(),
      updateCard: vi.fn(),
      updateProjectFile,
      deleteProjectFile: vi.fn()
    },
    runtime: {
      api: {} as never,
      providers: [] as never[],
      imageGeneration: { enabled: false },
      imageUnderstanding: { enabled: false },
      search: { ...DEFAULT_WEB_SEARCH_CONFIG, provider: 'bingLocal', apiKey: '', bochaSummary: false, bochaFreshness: '' },
      mcpServers: [],
      mcpToolTimeoutSeconds: 30,
      readLatestState: () => ({
        api: {} as never,
        providers: [] as never[],
        imageGeneration: { enabled: false },
        imageUnderstanding: { enabled: false },
        search: { ...DEFAULT_WEB_SEARCH_CONFIG, provider: 'bingLocal', apiKey: '', bochaSummary: false, bochaFreshness: '' },
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
      activeWorld: 'chat',
      collectionShelf: 'code',
      frontstageCollaboratorId: 'pharos',
      activeCardId: null,
      setCollectionShelf: vi.fn(),
      setWorld: vi.fn(),
      setActiveCard: vi.fn(),
      spotlightCard: vi.fn(),
      applyThemePatch: vi.fn(),
      applyThemePreset: vi.fn(),
      getCurrentThemeFrame: () => ({
        activePresetId: null,
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: ''
      })
    },
    memoryActions: {
      appendCollaboratorMemories: vi.fn(() => true),
      writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'doc-1', title: 'Memory', created: true })),
      readCollaboratorMemoryDoc: vi.fn(async () => null),
      listCollaboratorMemoryDocs: vi.fn(() => []),
      maybeHandleWriteMemoryAction: vi.fn(() => false),
      applyMemoryPreview: vi.fn(() => false),
      rollbackMemoryPreview: vi.fn(() => false)
    },
    addRuntimeToolMessage
  };

  return {
    run: createDirectToolActionExecutor(args),
    addRuntimeToolMessage,
    createProjectFileMock,
    projectFiles,
    setCommandStatus,
    updateMessage,
    updateProjectFile
  };
}

describe('createDirectToolActionExecutor', () => {
  it('records stable project file evidence when creating a workspace file', async () => {
    const harness = createExecutorHarness();

	    const outcome = await harness.run(writableConversation(), {
      kind: 'createProjectFile',
      file: {
        projectId: 'project-1',
        filePath: 'src/main.ts',
        fileRole: 'logic',
        language: 'ts',
        code: 'export const value = 1;\n',
        replaceContent: true
      },
      targetLabel: 'main file',
      openInCollection: false
    }, true, {
      insertBeforeMessageId: 'assistant-1',
      sourceToolCallId: 'tool-call-1'
    });

    expect(outcome).toMatchObject({
      path: 'direct',
      status: 'executed',
      toolInvocation: {
        status: 'executed',
        kind: 'createProjectFile',
        projectFileId: 'file-created',
        projectFilePaths: ['src/main.ts'],
        originMessageId: 'assistant-1',
        toolCallId: 'tool-call-1',
        targetLabel: 'main file',
        projectFileEffects: [
          expect.objectContaining({
            operation: 'created',
            projectId: 'project-1',
            fileId: 'file-created',
            filePath: 'src/main.ts'
          })
        ],
        codeWriteDetails: [
          expect.objectContaining({
            label: 'main file',
            language: 'ts',
            addedLines: 2,
            removedLines: 0
          })
        ]
      }
    });
    expect(harness.createProjectFileMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      filePath: 'src/main.ts',
      fileRole: 'logic',
      language: 'ts',
      content: 'export const value = 1;\n',
      ownerCollaboratorId: 'pharos',
      source: 'chat-generated'
    }));
	    expect(harness.addRuntimeToolMessage).toHaveBeenCalledWith(
	      expect.objectContaining({ conversationId: 'conversation-1' }),
      expect.objectContaining({
        status: 'running',
        kind: 'createProjectFile',
        originMessageId: 'assistant-1',
        toolCallId: 'tool-call-1'
      }),
      undefined,
      { beforeMessageId: 'assistant-1' }
    );
	    expect(harness.updateMessage).toHaveBeenCalledWith(
	      expect.objectContaining({ conversationId: 'conversation-1' }),
      expect.any(String),
      expect.objectContaining({
        toolInvocation: expect.objectContaining({
          projectFileId: 'file-created',
          projectFilePaths: ['src/main.ts']
        })
      })
    );
  });

  it('keeps failed project edits attached to the requested file evidence', async () => {
    const harness = createExecutorHarness();

	    const outcome = await harness.run(writableConversation(), {
      kind: 'editProjectFileText',
      fileId: 'file-1',
      oldString: 'Missing text',
      newString: 'New text'
    }, false, {
      insertBeforeMessageId: 'assistant-2',
      sourceToolCallId: 'tool-call-2'
    });

    expect(outcome).toMatchObject({
      path: 'direct',
      status: 'failed',
      error: expect.stringContaining('要替换的原文片段没有命中 · src/App.tsx。'),
      toolInvocation: {
        status: 'failed',
        kind: 'editProjectFileText',
        projectFileId: 'file-1',
        originMessageId: 'assistant-2',
        toolCallId: 'tool-call-2',
        error: expect.stringContaining('要替换的原文片段没有命中 · src/App.tsx。')
      }
    });
    expect(harness.updateProjectFile).not.toHaveBeenCalled();
    expect(harness.setCommandStatus).toHaveBeenCalledWith(
      expect.stringContaining('要替换的原文片段没有命中 · src/App.tsx。')
    );
	    expect(harness.addRuntimeToolMessage).toHaveBeenCalledWith(
	      expect.objectContaining({ conversationId: 'conversation-1' }),
      expect.objectContaining({
        status: 'failed',
        projectFileId: 'file-1',
        originMessageId: 'assistant-2',
        toolCallId: 'tool-call-2'
      }),
      undefined,
      { beforeMessageId: 'assistant-2' }
    );
  });
});
