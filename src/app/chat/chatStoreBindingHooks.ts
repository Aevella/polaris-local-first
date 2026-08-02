import { useMemo } from 'react';
import type { ChatMessage, ConversationTaskState } from '../../types/domain';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { selectRuntimeApi, selectVisibleProviders, useRuntimeStore } from '../../stores/runtimeStore';
import { useSpaceFrontstageBindings } from '../../stores/spaceStoreFrontstageBindings';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSpaceThemeSessionBindings } from '../../stores/spaceStoreThemeSessionBindings';
import { toThemeFrame } from '../../stores/spaceStoreTheme';

export function useChatConversationStoreBindings() {
  return {
    inputDraft: useChatStore((state) => state.inputDraft),
    pendingWorkspaceProposals: useChatStore((state) => state.pendingWorkspaceProposals),
    setInputDraft: useChatStore((state) => state.setInputDraft),
    setConversationDraft: useChatStore((state) => state.setConversationDraft),
    conversations: useChatStore((state) => state.conversations),
    activeConversationId: useChatStore((state) => state.activeConversationId),
    conversationBodyStatuses: useChatStore((state) => state.conversationBodyStatuses),
    hydrated: useChatStore((state) => state.hydrated),
    setActiveConversation: useChatStore((state) => state.setActiveConversation),
    createConversation: useChatStore((state) => state.createConversation),
    createGroupConversation: useChatStore((state) => state.createGroupConversation),
    updateGroupConversation: useChatStore((state) => state.updateGroupConversation),
    getConversationWritable: useChatStore((state) => state.getConversationWritable),
    ensureConversationMessagesLoaded: useChatStore((state) => state.ensureConversationMessagesLoaded),
    ensureConversationWritable: useChatStore((state) => state.ensureConversationWritable),
    ensureFullConversationBodiesLoaded: useChatStore((state) => state.ensureFullConversationBodiesLoaded),
    addMessage: useChatStore((state) => state.addMessage),
    orphanConversation: useChatStore((state) => state.orphanConversation),
    insertMessageBefore: useChatStore((state) => state.insertMessageBefore),
    insertMessageAfter: useChatStore((state) => state.insertMessageAfter),
    updateMessage: useChatStore((state) => state.updateMessage),
    persistToDb: useChatStore((state) => state.persistToDb),
    replaceConversationMessages: useChatStore((state) => state.replaceConversationMessages),
    setConversationActiveProject: useChatStore((state) => state.setConversationActiveProject),
    upsertPendingWorkspaceProposal: useChatStore((state) => state.upsertPendingWorkspaceProposal),
    removePendingWorkspaceProposal: useChatStore((state) => state.removePendingWorkspaceProposal),
    appendRuntimeFeedbackEvent: useChatStore((state) => state.appendRuntimeFeedbackEvent),
    renameConversation: useChatStore((state) => state.renameConversation),
    toggleConversationPinned: useChatStore((state) => state.toggleConversationPinned),
    deleteConversation: useChatStore((state) => state.deleteConversation),
    clearConversationAttachmentsByAssetIds: useChatStore((state) => state.clearConversationAttachmentsByAssetIds),
    findConversation: (conversationId: string) =>
      useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId),
    getConversationMessages: (conversationId: string) =>
      useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)?.messages ?? [],
    findConversationMessage: (conversationId: string, messageId: string) =>
      useChatStore.getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.find((message) => message.id === messageId),
    getRuntimeFeedbackEvents: (conversationId: string) =>
      useChatStore.getState().getRuntimeFeedbackEvents(conversationId),
    getConversationTask: (conversationId: string) =>
      useChatStore.getState().getConversationTask(conversationId),
    ensureConversationTask: (
      conversationId: string,
      messages: ChatMessage[],
      options?: { mode?: import('../../types/domain').ConversationTaskMode }
    ) =>
      useChatStore.getState().ensureConversationTask(conversationId, messages, options),
    setConversationTask: (conversationId: string, task: ConversationTaskState | null) =>
      useChatStore.getState().setConversationTask(conversationId, task),
    readLatestState: () => {
      const state = useChatStore.getState();
      return {
        inputDraft: state.inputDraft,
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        pendingWorkspaceProposals: state.pendingWorkspaceProposals
      };
    }
  };
}

export function useChatPersonaStoreBindings() {
  return {
    personas: usePersonaStore((state) => state.personas),
    activeCollaboratorId: usePersonaStore((state) => state.activeCollaboratorId),
    hydrated: usePersonaStore((state) => state.hydrated),
    setActiveCollaborator: usePersonaStore((state) => state.setActiveCollaborator),
    createPersona: usePersonaStore((state) => state.createPersona),
    deleteCollaborator: usePersonaStore((state) => state.deleteCollaborator),
    updateCollaborator: usePersonaStore((state) => state.updateCollaborator),
    findCollaborator: (collaboratorId: string) =>
      usePersonaStore.getState().personas.find((entry) => entry.id === collaboratorId),
    readLatestState: () => {
      const state = usePersonaStore.getState();
      return {
        activeCollaboratorId: state.activeCollaboratorId,
        personas: state.personas
      };
    }
  };
}

export function useChatCollectionStoreBindings() {
  return {
    cards: useCollectionStore((state) => state.cards),
    imageCards: useCollectionStore((state) => state.imageCards),
    projectFiles: useCollectionStore((state) => state.projectFiles),
    workspaceReferenceDocs: useCollectionStore((state) => state.workspaceReferenceDocs),
    roomProjects: useCollectionStore((state) => state.roomProjects),
    hydrated: useCollectionStore((state) => state.hydrated),
    createCard: useCollectionStore((state) => state.createCard),
    createProjectFile: useCollectionStore((state) => state.createProjectFile),
    createWorkspaceReferenceDoc: useCollectionStore((state) => state.createWorkspaceReferenceDoc),
    deleteWorkspaceReferenceDoc: useCollectionStore((state) => state.deleteWorkspaceReferenceDoc),
    createProject: useCollectionStore((state) => state.createProject),
    updateProject: useCollectionStore((state) => state.updateProject),
    promoteCardToProject: useCollectionStore((state) => state.promoteCardToProject),
    updateCard: useCollectionStore((state) => state.updateCard),
    updateProjectFile: useCollectionStore((state) => state.updateProjectFile),
    deleteProjectFile: useCollectionStore((state) => state.deleteProjectFile),
    deleteCard: useCollectionStore((state) => state.deleteCard),
    deleteImageCard: useCollectionStore((state) => state.deleteImageCard),
    saveCardFromChat: useCollectionStore((state) => state.saveCardFromChat),
    saveImageCardFromChat: useCollectionStore((state) => state.saveImageCardFromChat),
    readLatestState: () => {
      const state = useCollectionStore.getState();
      return {
        cards: state.cards,
        imageCards: state.imageCards,
        projectFiles: state.projectFiles,
        workspaceReferenceDocs: state.workspaceReferenceDocs,
        roomProjects: state.roomProjects
      };
    }
  };
}

export function useChatRuntimeStoreBindings() {
  return {
    api: useRuntimeStore(selectRuntimeApi),
    providers: useRuntimeStore(selectVisibleProviders),
    hydrated: useRuntimeStore((state) => state.hydrated),
    memoryVectorRetrieval: useRuntimeStore((state) => state.memoryVectorRetrieval),
    imageGeneration: useRuntimeStore((state) => state.imageGeneration),
    imageUnderstanding: useRuntimeStore((state) => state.imageUnderstanding),
    search: useRuntimeStore((state) => state.search),
    toolPromptPreferences: useRuntimeStore((state) => state.toolPromptPreferences),
    mcpServers: useRuntimeStore((state) => state.mcpServers),
    mcpToolTimeoutSeconds: useRuntimeStore((state) => state.mcpToolTimeoutSeconds),
    triggerRules: useRuntimeStore((state) => state.triggerRules),
    pendingTriggerEvents: useRuntimeStore((state) => state.pendingTriggerEvents),
    companionConnections: useRuntimeStore((state) => state.companionConnections),
    companionSnapshots: useRuntimeStore((state) => state.companionSnapshots),
    deleteCompanionConnection: useRuntimeStore((state) => state.deleteCompanionConnection),
    setActiveProvider: useRuntimeStore((state) => state.setActiveProvider),
    updateProvider: useRuntimeStore((state) => state.updateProvider),
    setToolPromptGroupEnabled: useRuntimeStore((state) => state.setToolPromptGroupEnabled),
    taskModeEnabled: useRuntimeStore((state) => state.taskModeEnabled),
    setTaskModeEnabled: useRuntimeStore((state) => state.setTaskModeEnabled),
    createTriggerRule: useRuntimeStore((state) => state.createTriggerRule),
    updateTriggerRule: useRuntimeStore((state) => state.updateTriggerRule),
    deleteTriggerRule: useRuntimeStore((state) => state.deleteTriggerRule),
    enqueueTriggerEvent: useRuntimeStore((state) => state.enqueueTriggerEvent),
    consumeTriggerEvent: useRuntimeStore((state) => state.consumeTriggerEvent),
    markTriggerFired: useRuntimeStore((state) => state.markTriggerFired),
    markTriggerFailed: useRuntimeStore((state) => state.markTriggerFailed),
    readLatestState: () => {
      const state = useRuntimeStore.getState();
      return {
        api: selectRuntimeApi(state),
        providers: selectVisibleProviders(state),
        memoryVectorRetrieval: state.memoryVectorRetrieval,
        imageGeneration: state.imageGeneration,
        imageUnderstanding: state.imageUnderstanding,
        search: state.search,
        mcpServers: state.mcpServers,
        mcpToolTimeoutSeconds: state.mcpToolTimeoutSeconds,
        toolPromptPreferences: state.toolPromptPreferences,
        taskModeEnabled: state.taskModeEnabled,
        triggerRules: state.triggerRules,
        pendingTriggerEvents: state.pendingTriggerEvents
      };
    }
  };
}

export function useChatSpaceStoreBindings() {
  const frontstage = useSpaceFrontstageBindings();
  const themeSession = useSpaceThemeSessionBindings();
  const currentThemeFrame = useMemo(
    () => toThemeFrame(themeSession.theme),
    [
      themeSession.theme.activePresetId,
      themeSession.theme.activeSavedSkinId,
      themeSession.theme.cssVariables,
      themeSession.theme.presetCSS,
      themeSession.theme.customCSS,
      themeSession.theme.generatedCSS,
      themeSession.theme.recipe?.name,
      themeSession.theme.recipe?.note
    ]
  );

  return {
    activeWorld: frontstage.activeWorld,
    collectionShelf: frontstage.collectionShelf,
    frontstageCollaboratorId: frontstage.frontstageCollaboratorId,
    editingCollaboratorId: frontstage.editingCollaboratorId,
    focusedMessageTarget: frontstage.focusedMessageTarget,
    activeCardId: frontstage.activeCardId,
    spotlightCardId: frontstage.spotlightCardId,
    pendingProjectOpenId: frontstage.pendingProjectOpenId,
    pendingProjectOpenSource: frontstage.pendingProjectOpenSource,
    pendingCardReference: frontstage.pendingCardReference,
    pendingAttachments: frontstage.pendingAttachments,
    replyNotifications: frontstage.replyNotifications,
    setWorld: frontstage.setWorld,
    setCollectionShelf: frontstage.setCollectionShelf,
    setFrontstageCollaboratorId: frontstage.setFrontstageCollaboratorId,
    setEditingCollaboratorId: frontstage.setEditingCollaboratorId,
    setFocusedMessageTarget: frontstage.setFocusedMessageTarget,
    setActiveCard: frontstage.setActiveCard,
    spotlightCard: frontstage.spotlightCard,
    clearSpotlightCard: frontstage.clearSpotlightCard,
    setPendingProjectOpenId: frontstage.setPendingProjectOpenId,
    setPendingProjectOpenSource: frontstage.setPendingProjectOpenSource,
    setPendingCardReference: frontstage.setPendingCardReference,
    clearPendingCardReference: frontstage.clearPendingCardReference,
    addPendingAttachments: frontstage.addPendingAttachments,
    removePendingAttachment: frontstage.removePendingAttachment,
    clearPendingAttachments: frontstage.clearPendingAttachments,
    enqueueReplyNotification: frontstage.enqueueReplyNotification,
    dismissReplyNotification: frontstage.dismissReplyNotification,
    clearReplyNotifications: frontstage.clearReplyNotifications,
    theme: themeSession.theme,
    activeThemePreview: themeSession.activeThemePreview,
    getActiveThemePreview: () => useSpaceStore.getState().activeThemePreview,
    getCurrentThemeFrame: () => toThemeFrame(useSpaceStore.getState().theme),
    customization: themeSession.customization,
    applyThemePatch: themeSession.applyThemePatch,
    applyThemePreset: themeSession.applyThemePreset,
    beginThemePreview: themeSession.beginThemePreview,
    commitThemePreview: themeSession.commitThemePreview,
    rollbackLastSkin: themeSession.rollbackLastSkin,
    rollbackThemePreview: themeSession.rollbackThemePreview,
    saveCurrentSkin: themeSession.saveCurrentSkin,
    setThemeToolMode: themeSession.setThemeToolMode,
    themeToolMode: themeSession.theme.toolMode,
    selectedSurfaceCodes: themeSession.theme.selectedSurfaceCodes,
    currentThemeFrame,
    readLatestState: () => {
      const state = useSpaceStore.getState();
      return {
        frontstageCollaboratorId: state.frontstageCollaboratorId,
        pendingCardReference: state.pendingCardReference,
        pendingAttachments: state.pendingAttachments,
        replyNotifications: state.replyNotifications,
        activeWorld: state.activeWorld,
        collectionShelf: state.collectionShelf,
        activeCardId: state.activeCardId,
        activeThemePreview: state.activeThemePreview,
        currentThemeFrame: toThemeFrame(state.theme),
        customization: state.customization,
        themeToolMode: state.theme.toolMode,
        selectedSurfaceCodes: state.theme.selectedSurfaceCodes
      };
    }
  };
}
