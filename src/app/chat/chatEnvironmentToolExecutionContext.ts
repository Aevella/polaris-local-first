import {
  filterCodeCardsForCollaboratorScope,
  filterImageCardsForCollaboratorScope,
  filterProjectFilesForCollaboratorScope
} from '../../engines/collectionOwnership';
import { executeEnvironmentDirectoryAction } from '../../engines/environmentDirectory';
import { getDesktopLocalHostBridge } from '../../desktop/localHost';
import { getNativePersonalDataToolAvailability } from '../../native/personalData';
import type { ToolContext } from '../../engines/toolExecutorTypes';
import { toAttachmentEntries } from '../../engines/attachmentToolEntries';
import type {
  ChatSpaceFrontstagePort,
  ChatToolStoreBindings,
  MemoryActions,
  ToolActionChatState,
  ToolActionCollectionState
} from './chatToolActionTypes';

export function buildEnvironmentToolExecutionContext(args: {
  chat: Pick<ToolActionChatState, 'conversations' | 'findConversation' | 'getConversationMessages'>;
  collection: ToolActionCollectionState;
  persona: Pick<ChatToolStoreBindings['persona'], 'personas'>;
  runtime: ChatToolStoreBindings['runtime'];
  space: Pick<ChatSpaceFrontstagePort, 'activeWorld' | 'collectionShelf' | 'activeCardId'>;
  memoryActions: MemoryActions;
  conversationId: string;
  ownerCollaboratorId: string | null | undefined;
  activeProjectId: string | null;
}): Pick<ToolContext, 'readEnvironmentDirectory'> {
  const {
    chat,
    collection,
    persona,
    runtime,
    space,
    memoryActions,
    conversationId,
    ownerCollaboratorId,
    activeProjectId
  } = args;

  return {
    readEnvironmentDirectory: async (action) => {
      const collectionState = collection.readLatestState();
      const latestRuntime = runtime.readLatestState?.() ?? runtime;
      const conversation = chat.findConversation(conversationId) ?? null;
      const fullConversation = chat.conversations.find((entry) => entry.id === conversationId) ?? null;
      const messages = chat.getConversationMessages(conversationId);
      const attachmentEntries = toAttachmentEntries(messages, 'all');
      const desktopBridge = getDesktopLocalHostBridge();
      const desktopState = desktopBridge ? await desktopBridge.getState() : null;
      const personalDataAvailability = getNativePersonalDataToolAvailability();
      const memoryDocs = memoryActions.listCollaboratorMemoryDocs?.(conversationId) ?? [];
      const cards = filterCodeCardsForCollaboratorScope(
        collectionState.cards,
        chat.conversations,
        ownerCollaboratorId
      );
      const imageCards = filterImageCardsForCollaboratorScope(
        collectionState.imageCards,
        chat.conversations,
        ownerCollaboratorId
      );
      const projectFiles = filterProjectFilesForCollaboratorScope(
        collectionState.projectFiles,
        ownerCollaboratorId,
        conversation?.activeProjectId ?? activeProjectId
      );
      const archiveAttachmentCount = attachmentEntries.filter((entry) => {
        const mimeType = entry.attachment.mimeType?.toLowerCase() ?? '';
        const name = entry.name.toLowerCase();
        return mimeType.includes('zip') || name.endsWith('.zip');
      }).length;
      const imageAttachmentCount = attachmentEntries.filter(
        (entry) => entry.attachment.kind === 'image'
      ).length;

      return executeEnvironmentDirectoryAction({
        activeWorld: space.activeWorld,
        collectionShelf: space.collectionShelf,
        activeConversation: fullConversation ?? conversation,
        activeCollaboratorName:
          persona.personas.find((entry) => entry.id === ownerCollaboratorId)?.name ?? null,
        activeCardId: space.activeCardId,
        cards,
        imageCards,
        roomProjects: collectionState.roomProjects,
        projectFiles,
        workspaceReferenceDocs: collectionState.workspaceReferenceDocs ?? [],
        memoryDocs,
        providers: latestRuntime.providers,
        activeProviderId: latestRuntime.api.id,
        mcpServers: latestRuntime.mcpServers,
        webSearch: latestRuntime.search,
        desktopLocalHost: desktopState,
        attachmentCount: attachmentEntries.length,
        archiveAttachmentCount,
        imageAttachmentCount,
        calendarAvailable: personalDataAvailability.calendarAvailable,
        calendarWriteAvailable: personalDataAvailability.calendarWriteAvailable,
        imageGenerationAvailable: latestRuntime.imageGeneration.enabled,
        memorySearchAvailable: Boolean(memoryActions.searchCollaboratorMemory)
      }, action);
    }
  };
}
