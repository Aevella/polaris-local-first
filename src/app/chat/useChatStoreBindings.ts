import type {
  ChatActionStoreBindings,
  ChatReplyStoreBindings,
  ChatToolStoreBindings
} from './chatPorts';
import {
  useChatCollectionStoreBindings,
  useChatConversationStoreBindings,
  useChatPersonaStoreBindings,
  useChatRuntimeStoreBindings,
  useChatSpaceStoreBindings
} from './chatStoreBindingHooks';
import { selectChatConversations } from './liveConversationCatalog';
export type {
  ChatActionStoreBindings,
  ChatReplyStoreBindings,
  ChatToolStoreBindings
} from './chatPorts';

export function useChatStoreBindings() {
  const chat = useChatConversationStoreBindings();
  const persona = useChatPersonaStoreBindings();
  const collection = useChatCollectionStoreBindings();
  const runtime = useChatRuntimeStoreBindings();
  const space = useChatSpaceStoreBindings();

  return {
    chat,
    persona,
    collection,
    runtime,
    space
  };
}

export type ChatStoreBindings = ReturnType<typeof useChatStoreBindings>;

type ChatStoreConversationBindingOptions = {
  includeGroupConversations?: boolean;
};

export function createChatActionStoreBindings(store: ChatStoreBindings): ChatActionStoreBindings {
  return {
    chat: {
      conversations: store.chat.conversations,
      activeConversationId: store.chat.activeConversationId,
      inputDraft: store.chat.inputDraft,
      pendingWorkspaceProposals: store.chat.pendingWorkspaceProposals,
      createConversation: store.chat.createConversation,
      ensureConversationMessagesLoaded: store.chat.ensureConversationMessagesLoaded,
      ensureConversationWritable: store.chat.ensureConversationWritable,
      addMessage: store.chat.addMessage,
      updateMessage: store.chat.updateMessage,
      persistToDb: store.chat.persistToDb,
      orphanConversation: store.chat.orphanConversation,
      deleteConversation: store.chat.deleteConversation,
      setInputDraft: store.chat.setInputDraft,
      replaceConversationMessages: store.chat.replaceConversationMessages,
      setConversationActiveProject: store.chat.setConversationActiveProject,
      upsertPendingWorkspaceProposal: store.chat.upsertPendingWorkspaceProposal,
      removePendingWorkspaceProposal: store.chat.removePendingWorkspaceProposal,
      appendRuntimeFeedbackEvent: store.chat.appendRuntimeFeedbackEvent,
      getRuntimeFeedbackEvents: store.chat.getRuntimeFeedbackEvents,
      setActiveConversation: store.chat.setActiveConversation,
      readLatestState: store.chat.readLatestState
    },
    persona: {
      activeCollaboratorId: store.persona.activeCollaboratorId,
      personas: store.persona.personas,
      setActiveCollaborator: store.persona.setActiveCollaborator,
      deleteCollaborator: store.persona.deleteCollaborator,
      readLatestState: store.persona.readLatestState
    },
    space: {
      frontstageCollaboratorId: store.space.frontstageCollaboratorId,
      setFrontstageCollaboratorId: store.space.setFrontstageCollaboratorId,
      editingCollaboratorId: store.space.editingCollaboratorId,
      setEditingCollaboratorId: store.space.setEditingCollaboratorId,
      pendingCardReference: store.space.pendingCardReference,
      pendingAttachments: store.space.pendingAttachments,
      setPendingCardReference: store.space.setPendingCardReference,
      clearPendingCardReference: store.space.clearPendingCardReference,
      clearPendingAttachments: store.space.clearPendingAttachments,
      readLatestState: store.space.readLatestState,
      rollbackPreviewForConversationDeletion: (conversationId: string) => {
        const activePreview = store.space.activeThemePreview;
        if (!activePreview || activePreview.conversationId !== conversationId) return false;
        return store.space.rollbackThemePreview(activePreview.id);
      }
    },
    runtime: {
      companionConnections: store.runtime.companionConnections,
      deleteCompanionConnection: store.runtime.deleteCompanionConnection
    }
  };
}

export function createChatReplyStoreBindings(
  store: ChatStoreBindings,
  options: ChatStoreConversationBindingOptions = {}
): ChatReplyStoreBindings {
  return {
    chat: {
      conversations: selectChatConversations(store.chat.conversations, options),
      pendingWorkspaceProposals: store.chat.pendingWorkspaceProposals,
      findConversation: store.chat.findConversation,
      ensureConversationWritable: store.chat.ensureConversationWritable,
      addMessage: store.chat.addMessage,
      insertMessageBefore: store.chat.insertMessageBefore,
      insertMessageAfter: store.chat.insertMessageAfter,
      findConversationMessage: store.chat.findConversationMessage,
      getConversationMessages: store.chat.getConversationMessages,
      ensureConversationMessagesLoaded: store.chat.ensureConversationMessagesLoaded,
      replaceConversationMessages: store.chat.replaceConversationMessages,
      updateMessage: store.chat.updateMessage,
      persistToDb: store.chat.persistToDb,
      appendRuntimeFeedbackEvent: store.chat.appendRuntimeFeedbackEvent,
      getRuntimeFeedbackEvents: store.chat.getRuntimeFeedbackEvents,
      getConversationTask: store.chat.getConversationTask,
      ensureConversationTask: store.chat.ensureConversationTask,
      setConversationTask: store.chat.setConversationTask,
      readLatestState: () => {
        const latest = store.chat.readLatestState();
        return {
          conversations: selectChatConversations(latest.conversations, options),
          pendingWorkspaceProposals: latest.pendingWorkspaceProposals
        };
      }
    },
    persona: {
      personas: store.persona.personas,
      readLatestState: () => ({
        personas: store.persona.readLatestState().personas
      })
    },
    collection: {
      cards: store.collection.cards,
      imageCards: store.collection.imageCards,
      projectFiles: store.collection.projectFiles,
      workspaceReferenceDocs: store.collection.workspaceReferenceDocs,
      roomProjects: store.collection.roomProjects,
      readLatestState: store.collection.readLatestState
    },
    runtime: {
      api: store.runtime.api,
      providers: store.runtime.providers,
      memoryVectorRetrieval: store.runtime.memoryVectorRetrieval,
      imageGeneration: store.runtime.imageGeneration,
      imageUnderstanding: store.runtime.imageUnderstanding,
      mcpServers: store.runtime.mcpServers,
      mcpToolTimeoutSeconds: store.runtime.mcpToolTimeoutSeconds,
      toolPromptPreferences: store.runtime.toolPromptPreferences,
      taskModeEnabled: store.runtime.taskModeEnabled,
      readLatestState: store.runtime.readLatestState
    },
    space: {
      activeWorld: store.space.activeWorld,
      collectionShelf: store.space.collectionShelf,
      focusedMessageTarget: store.space.focusedMessageTarget,
      activeCardId: store.space.activeCardId,
      activeThemePreview: store.space.activeThemePreview,
      currentThemeFrame: store.space.currentThemeFrame,
      customization: store.space.customization,
      themeToolMode: store.space.themeToolMode,
      selectedSurfaceCodes: store.space.selectedSurfaceCodes,
      readLatestState: store.space.readLatestState
    }
  };
}

export function createChatToolStoreBindings(
  store: ChatStoreBindings,
  options: ChatStoreConversationBindingOptions = {}
): ChatToolStoreBindings {
  const liveConversations = selectChatConversations(store.chat.conversations, options);
  return {
    chat: {
      conversations: liveConversations,
      pendingWorkspaceProposals: store.chat.pendingWorkspaceProposals,
      ensureConversationWritable: store.chat.ensureConversationWritable,
      addMessage: store.chat.addMessage,
      insertMessageBefore: store.chat.insertMessageBefore,
      insertMessageAfter: store.chat.insertMessageAfter,
      createConversation: store.chat.createConversation,
      findConversation: store.chat.findConversation,
      getConversationWritable: store.chat.getConversationWritable,
      getConversationMessages: store.chat.getConversationMessages,
      ensureConversationMessagesLoaded: store.chat.ensureConversationMessagesLoaded,
      getConversationTask: store.chat.getConversationTask,
      setConversationTask: store.chat.setConversationTask,
      readLatestState: () => {
        const latest = store.chat.readLatestState();
        return {
          conversations: selectChatConversations(latest.conversations, options),
          pendingWorkspaceProposals: latest.pendingWorkspaceProposals
        };
      },
      updateMessage: store.chat.updateMessage,
      setConversationActiveProject: store.chat.setConversationActiveProject,
      upsertPendingWorkspaceProposal: store.chat.upsertPendingWorkspaceProposal,
      removePendingWorkspaceProposal: store.chat.removePendingWorkspaceProposal,
      appendRuntimeFeedbackEvent: store.chat.appendRuntimeFeedbackEvent,
      getRuntimeFeedbackEvents: store.chat.getRuntimeFeedbackEvents,
    },
    persona: {
      activeCollaboratorId: store.persona.activeCollaboratorId,
      personas: store.persona.personas,
      findCollaborator: store.persona.findCollaborator,
      updateCollaborator: store.persona.updateCollaborator
    },
    collection: {
      cards: store.collection.cards,
      imageCards: store.collection.imageCards,
      projectFiles: store.collection.projectFiles,
      workspaceReferenceDocs: store.collection.workspaceReferenceDocs,
      roomProjects: store.collection.roomProjects,
      readLatestState: store.collection.readLatestState,
      createCard: store.collection.createCard,
      createProjectFile: store.collection.createProjectFile,
      createProject: store.collection.createProject,
      updateProject: store.collection.updateProject,
      promoteCardToProject: store.collection.promoteCardToProject,
      saveCardFromChat: store.collection.saveCardFromChat,
      saveImageCardFromChat: store.collection.saveImageCardFromChat,
      updateCard: store.collection.updateCard,
      updateProjectFile: store.collection.updateProjectFile,
      deleteProjectFile: store.collection.deleteProjectFile
    },
    runtime: {
      api: store.runtime.api,
      providers: store.runtime.providers,
      imageGeneration: store.runtime.imageGeneration,
      imageUnderstanding: store.runtime.imageUnderstanding,
      search: store.runtime.search,
      mcpServers: store.runtime.mcpServers,
      mcpToolTimeoutSeconds: store.runtime.mcpToolTimeoutSeconds,
      readLatestState: store.runtime.readLatestState,
      getTriggerRules: () => store.runtime.readLatestState().triggerRules,
      setTaskModeEnabled: store.runtime.setTaskModeEnabled,
      createTriggerRule: store.runtime.createTriggerRule,
      updateTriggerRule: store.runtime.updateTriggerRule,
      deleteTriggerRule: store.runtime.deleteTriggerRule
    },
    space: {
      activeThemePreview: store.space.activeThemePreview,
      activeWorld: store.space.activeWorld,
      activeCardId: store.space.activeCardId,
      applyThemePatch: store.space.applyThemePatch,
      applyThemePreset: store.space.applyThemePreset,
      beginThemePreview: store.space.beginThemePreview,
      collectionShelf: store.space.collectionShelf,
      commitThemePreview: store.space.commitThemePreview,
      frontstageCollaboratorId: store.space.frontstageCollaboratorId,
      getActiveThemePreview: store.space.getActiveThemePreview,
      getCurrentThemeFrame: store.space.getCurrentThemeFrame,
      currentThemeFrame: store.space.currentThemeFrame,
      rollbackThemePreview: store.space.rollbackThemePreview,
      saveCurrentSkin: store.space.saveCurrentSkin,
      setActiveCard: store.space.setActiveCard,
      setCollectionShelf: store.space.setCollectionShelf,
      setThemeToolMode: store.space.setThemeToolMode,
      setWorld: store.space.setWorld,
      spotlightCard: store.space.spotlightCard,
      themeToolMode: store.space.themeToolMode
    }
  };
}
