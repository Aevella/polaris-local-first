import { describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../../config/persona/personaBuilder';
import { projectToolInvocationForRequest } from '../../engines/request/requestToolResultProjection';
import { resolveAssistantToolRequestTools } from '../../engines/tool-protocol/assistantToolProtocolRequestTools';
import type { ToolActionRunOutcome } from './chatToolOutcome';
import {
  buildReplyToolContext,
  createChatReplyRequestSnapshot,
  type ChatReplyRequestSnapshotSource
} from './chatReplyContext';
import { resolveToolFollowupPlan } from './chatToolFollowup';
import type { ChatMessage, Persona, ProviderProfile, ThemeFrame, ToolInvocation } from '../../types/domain';

function createStorageMock(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    }
  };
}

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

function createPersona(): Persona {
  return createPersonaTemplate({
    id: 'pharos',
    name: 'Pharos',
    description: 'Test collaborator',
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
    }
  });
}

function createUserMessage(content: string): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content,
    timestamp: 1_774_000_000_000,
    origin: 'user-input'
  };
}

function toolNames(toolContext: ReturnType<typeof buildReplyToolContext>['toolContext']) {
  return resolveAssistantToolRequestTools(toolContext).tools.map((tool) => tool.function.name);
}

async function createContractStores() {
  vi.resetModules();
  vi.stubGlobal('localStorage', createStorageMock());
  const [{ useChatStore }, { useCollectionStore }, { useSpaceStore }] = await Promise.all([
    import('../../stores/chatStore'),
    import('../../stores/collectionStore'),
    import('../../stores/spaceStore')
  ]);
  useChatStore.setState(useChatStore.getInitialState(), true);
  useCollectionStore.setState(useCollectionStore.getInitialState(), true);
  useSpaceStore.setState(useSpaceStore.getInitialState(), true);
  return { useChatStore, useCollectionStore, useSpaceStore };
}

describe('workspace scope contract', () => {
  it('uses conversation.activeProjectId as the workspace truth even when the chat mirror drifted', async () => {
    const { useChatStore, useCollectionStore, useSpaceStore } = await createContractStores();
    try {
      const collection = useCollectionStore.getState();
      const activeProjectId = collection.createProject({
        id: 'project-active',
        title: 'Active Workspace',
        slug: 'active-workspace',
        source: 'manual'
      });
      const shadowProjectId = collection.createProject({
        id: 'project-shadow',
        title: 'Shadow Workspace',
        slug: 'shadow-workspace',
        source: 'manual'
      });
      const activeFileId = collection.createProjectFile({
        id: 'file-active-index',
        projectId: activeProjectId,
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main data-marker="ACTIVE_SCOPE">Active</main>',
        ownerCollaboratorId: 'pharos',
        source: 'manual'
      });
      const shadowFileId = collection.createProjectFile({
        id: 'file-shadow-index',
        projectId: shadowProjectId,
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main data-marker="SHADOW_SCOPE">Shadow</main>',
        ownerCollaboratorId: 'pharos',
        source: 'manual'
      });
      const looseCardId = collection.createCard({
        id: 'card-index-html',
        kind: 'card',
        title: 'index.html',
        language: 'html',
        code: '<main data-marker="LOOSE_CARD">Loose</main>',
        ownerCollaboratorId: 'pharos',
        source: 'manual'
      });
      if (!activeFileId || !shadowFileId) throw new Error('Expected both project files to be created.');

      const conversationId = useChatStore.getState().createConversation('pharos', {
        activeProjectId
      });
      useSpaceStore.getState().setWorld('chat');
      useSpaceStore.getState().setCollectionShelf('code');
      useSpaceStore.getState().setFrontstageCollaboratorId('pharos');
      useSpaceStore.getState().setCollectionProjectId(shadowProjectId);
      useSpaceStore.getState().setActiveCard(looseCardId);

      const message = createUserMessage('继续修改当前工作区的 index.html');
      const writableConversation = useChatStore.getState().getConversationWritable(conversationId);
      expect(writableConversation).not.toBeNull();
      useChatStore.getState().addMessage(writableConversation!, message);

      const chatState = useChatStore.getState();
      const collectionState = useCollectionStore.getState();
      const spaceState = useSpaceStore.getState();
      const activeConversation = chatState.conversations.find((conversation) => conversation.id === conversationId) ?? null;
      const persona = createPersona();
      const source: ChatReplyRequestSnapshotSource = {
        api: createProvider(),
        activeWorld: spaceState.activeWorld,
        collectionShelf: spaceState.collectionShelf,
        chatAvatarLayoutEnabled: spaceState.customization.showChatAvatars,
        themeToolMode: spaceState.theme.toolMode,
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
        collectionCards: collectionState.cards,
        imageCards: collectionState.imageCards,
        projectFiles: collectionState.projectFiles,
        workspaceReferenceDocs: collectionState.workspaceReferenceDocs,
        roomProjects: collectionState.roomProjects,
        activeCardId: spaceState.activeCardId,
        pendingWorkspaceProposal: null,
        runtimeFeedbackEvents: [],
        conversations: chatState.conversations,
        personas: [persona],
        currentCollaboratorId: 'pharos',
        activeConversationTitle: activeConversation?.title,
        activeCollaborator: persona
      };

      const snapshot = createChatReplyRequestSnapshot({
        source,
        activeConversation
      });
      const { toolContext } = buildReplyToolContext({
        snapshot,
        collaboratorId: 'pharos',
        messages: activeConversation?.messages ?? []
      });
      const names = toolNames(toolContext);

      expect(spaceState.collectionProjectId).toBe(shadowProjectId);
      expect(snapshot.activeProjectId).toBe(activeProjectId);
      expect(toolContext.activeProject?.id).toBe(activeProjectId);
      expect(toolContext.visibleProjectFiles.map((file) => file.id)).toEqual([activeFileId]);
      expect(toolContext.visibleProjectFiles.some((file) => file.id === shadowFileId)).toBe(false);
      expect(names).toContain('readProjectFile');
      expect(names).toContain('editProjectFileText');
      expect(names).not.toContain('readCodeCard');
      expect(names).not.toContain('editCodeCardText');

      const projected = projectToolInvocationForRequest({
        id: 'tool-edit',
        kind: 'editProjectFileText',
        status: 'executed',
        title: '已局部替换工作区文件',
        summary: '已局部替换工作区文件 · index.html',
        projectFileId: activeFileId,
        projectFilePaths: ['index.html'],
        projectFileEffects: [{
          projectId: activeProjectId,
          fileId: activeFileId,
          filePath: 'index.html',
          operation: 'replaced',
          afterExcerpt: '<main data-marker="ACTIVE_SCOPE">Updated</main>',
          matchCount: 1,
          changedLines: {
            start: 1,
            end: 1
          }
        }]
      } satisfies ToolInvocation);
      const followupPlan = resolveToolFollowupPlan({
        outcomes: [{
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'editProjectFileText',
            fileId: activeFileId,
            oldString: 'Active',
            newString: 'Updated'
          },
          toolInvocation: {
            id: 'tool-edit',
            kind: 'editProjectFileText',
            status: 'executed',
            title: '已局部替换工作区文件',
            summary: '已局部替换工作区文件 · index.html',
            projectFileId: activeFileId,
            projectFilePaths: ['index.html']
          }
        } satisfies ToolActionRunOutcome]
      });

      expect(projected.projectFileEffects).toEqual([
        expect.objectContaining({
          projectId: activeProjectId,
          fileId: activeFileId,
          filePath: 'index.html'
        })
      ]);
      expect(JSON.stringify(projected)).not.toContain(shadowProjectId);
      expect(followupPlan?.exchangeFingerprint).toContain('index.html');
      expect(followupPlan).not.toHaveProperty('message');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
