import { describe, expect, it } from 'vitest';
import { buildDirectToolExecutionContext } from './chatToolExecutionContext';

describe('buildDirectToolExecutionContext', () => {
  it('keeps the environment directory in the composed execution surface', () => {
    const collectionState = {
      cards: [],
      imageCards: [],
      roomProjects: [],
      projectFiles: [],
      workspaceReferenceDocs: []
    };
    const context = buildDirectToolExecutionContext({
      chat: {
        conversations: [],
        findConversation: () => null,
        getConversationMessages: () => [],
        setConversationActiveProject: () => undefined,
        readLatestState: () => ({ conversations: [] })
      },
      collection: {
        ...collectionState,
        readLatestState: () => collectionState
      },
      persona: { personas: [] },
      runtime: {
        api: { id: 'test-provider' },
        providers: [],
        mcpServers: [],
        search: {},
        imageGeneration: { enabled: false }
      },
      space: {
        activeCardId: null,
        activeWorld: 'chat',
        collectionShelf: 'code',
        setCollectionShelf: () => undefined,
        setWorld: () => undefined,
        setActiveCard: () => undefined,
        spotlightCard: () => undefined,
        applyThemePatch: () => undefined,
        applyThemePreset: () => undefined,
        getCurrentThemeFrame: () => ({})
      },
      memoryActions: {
        appendCollaboratorMemories: () => undefined,
        writeCollaboratorMemoryDoc: () => undefined,
        readCollaboratorMemoryDoc: () => null
      },
      conversationId: 'conversation-test',
      ownerCollaboratorId: null,
      activeProjectId: null
    } as unknown as Parameters<typeof buildDirectToolExecutionContext>[0]);

    expect(context.readEnvironmentDirectory).toBeTypeOf('function');
  });
});
