import type { MutableRefObject } from 'react';
import { createChatReplyRequestSnapshot } from '../../app/chat/chatReplyContext';
import { requestReply, type RequestReplyChatPort } from '../../app/chat/chatReplyRuntime';
import { createChatToolActions } from '../../app/chat/chatToolActions';
import { createMessage } from '../../engines/chatMessageFactory';
import { isCompanionCollaboratorId } from '../../engines/companion';
import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import { useChatStore } from '../../stores/chatStore';
import type { WritableConversationBody } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { selectRuntimeApi, selectVisibleProviders, useRuntimeStore } from '../../stores/runtimeStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { toThemeFrame } from '../../stores/spaceStoreTheme';
import type { ChatMessage, PolarisCompanionCommand, PolarisCompanionTriggerCommand } from '../../types/domain';
import type { ChatStreamingState } from '../worlds/chat/context/ChatUiState';
import { resolveTriggerConversationForTarget } from '../../app/chat/triggerConversationResolution';
import { buildProactiveReplyNotification } from '../../app/chat/proactiveReplyNotification';
import { postNativeProactiveReplyNotification } from '../../native/localTriggerNotifications';

function resolveCompanionTriggerConversation(trigger: PolarisCompanionTriggerCommand) {
  const chatState = useChatStore.getState();
  return resolveTriggerConversationForTarget(trigger.target, {
    conversations: chatState.conversations,
    activeConversationId: chatState.activeConversationId
  }, {
    createConversation: (collaboratorId) => chatState.createConversation(collaboratorId),
    getConversations: () => useChatStore.getState().conversations
  });
}

function buildCompanionTriggerMessage(command: PolarisCompanionCommand) {
  return {
    ...createMessage('system', `（中转唤醒：${command.trigger?.name ?? '主动消息'}）`, undefined, 'trigger-runtime'),
    requestRole: 'user' as const,
    requestContent: command.text
  };
}

function buildCompanionRequestSnapshot(collaboratorId: string, targetConversationId: string) {
  const latestChatState = useChatStore.getState();
  const latestPersonaState = usePersonaStore.getState();
  const latestRuntimeState = useRuntimeStore.getState();
  const latestCollectionState = useCollectionStore.getState();
  const latestSpaceState = useSpaceStore.getState();
  const latestActiveConversation = latestChatState.conversations.find(
    (conversation) => conversation.id === targetConversationId
  ) ?? null;
  const pendingWorkspaceProposal =
    latestChatState.pendingWorkspaceProposals.find((proposal) => proposal.conversationId === targetConversationId) ?? null;
  const activeCollaborator = latestPersonaState.personas.find((persona) => persona.id === collaboratorId) ?? null;
  const effectiveProviderBinding = resolvePersonaProviderBinding({
    globalApi: selectRuntimeApi(latestRuntimeState),
    providers: selectVisibleProviders(latestRuntimeState),
    persona: activeCollaborator
  });

  return createChatReplyRequestSnapshot({
    source: {
      api: effectiveProviderBinding.api,
      activeWorld: latestSpaceState.activeWorld,
      collectionShelf: latestSpaceState.collectionShelf,
      chatAvatarLayoutEnabled: latestSpaceState.customization.showChatAvatars,
      themeToolMode: latestSpaceState.theme.toolMode,
      enabledToolGroups: latestRuntimeState.toolPromptPreferences,
      taskModeEnabled: latestRuntimeState.taskModeEnabled,
      mcpServers: latestRuntimeState.mcpServers,
      mcpToolTimeoutSeconds: latestRuntimeState.mcpToolTimeoutSeconds,
      themePreviewActive: Boolean(latestSpaceState.activeThemePreview),
      currentThemeFrame: toThemeFrame(latestSpaceState.theme),
      selectedSurfaceCodes: latestSpaceState.theme.selectedSurfaceCodes,
      collectionCards: latestCollectionState.cards,
      imageCards: latestCollectionState.imageCards,
      projectFiles: latestCollectionState.projectFiles,
      workspaceReferenceDocs: latestCollectionState.workspaceReferenceDocs,
      roomProjects: latestCollectionState.roomProjects,
      activeCardId: latestSpaceState.activeCardId,
      conversations: latestChatState.conversations,
      personas: latestPersonaState.personas,
      currentCollaboratorId: collaboratorId,
      currentTask: latestActiveConversation?.task ?? null,
      pendingWorkspaceProposal,
      runtimeFeedbackEvents: latestChatState.getRuntimeFeedbackEvents(targetConversationId),
      activeConversationTitle: latestActiveConversation?.title,
      activeCollaborator
    },
    activeConversation: latestActiveConversation
      ? {
          id: latestActiveConversation.id,
          title: latestActiveConversation.title,
          activeProjectId: latestActiveConversation.activeProjectId ?? null
        }
      : null
  });
}

function createCompanionReplyChatPort(): RequestReplyChatPort {
  return {
    addMessage: (target, message) =>
      useChatStore.getState().addMessage(target, message),
    findConversation: (conversationId: string) =>
      useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId),
    insertMessageBefore: (target, beforeMessageId, message) =>
      useChatStore.getState().insertMessageBefore(target, beforeMessageId, message),
    findConversationMessage: (conversationId: string, messageId: string) =>
      useChatStore.getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.find((message) => message.id === messageId),
    getConversationTask: useChatStore.getState().getConversationTask,
    getConversationMessages: (conversationId: string) =>
      useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)?.messages ?? [],
    replaceConversationMessages: (target, messages) =>
      useChatStore.getState().replaceConversationMessages(target, messages),
    setConversationTask: useChatStore.getState().setConversationTask,
    updateMessage: (target, messageId, patch) =>
      useChatStore.getState().updateMessage(target, messageId, patch),
    appendRuntimeFeedbackEvent: useChatStore.getState().appendRuntimeFeedbackEvent
  };
}

function createCompanionToolActionStore() {
  const chatState = useChatStore.getState();
  const personaState = usePersonaStore.getState();
  const runtimeState = useRuntimeStore.getState();
  const collectionState = useCollectionStore.getState();
  const spaceState = useSpaceStore.getState();

  return {
    chat: {
      conversations: chatState.conversations,
      pendingWorkspaceProposals: chatState.pendingWorkspaceProposals,
      ensureConversationWritable: useChatStore.getState().ensureConversationWritable,
      addMessage: (target: WritableConversationBody, message: ChatMessage) =>
        useChatStore.getState().addMessage(target, message),
      insertMessageBefore: (target: WritableConversationBody, beforeMessageId: string, message: ChatMessage) =>
        useChatStore.getState().insertMessageBefore(target, beforeMessageId, message),
      insertMessageAfter: (target: WritableConversationBody, afterMessageId: string, message: ChatMessage) =>
        useChatStore.getState().insertMessageAfter(target, afterMessageId, message),
      createConversation: chatState.createConversation,
      findConversation: (conversationId: string) =>
        useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId),
      getConversationWritable: (conversationId: string) =>
        useChatStore.getState().getConversationWritable(conversationId),
      getConversationMessages: (conversationId: string) =>
        useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)?.messages ?? [],
      getConversationTask: useChatStore.getState().getConversationTask,
      setConversationTask: useChatStore.getState().setConversationTask,
      updateMessage: (target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) =>
        useChatStore.getState().updateMessage(target, messageId, patch),
      setConversationActiveProject: useChatStore.getState().setConversationActiveProject,
      upsertPendingWorkspaceProposal: useChatStore.getState().upsertPendingWorkspaceProposal,
      removePendingWorkspaceProposal: useChatStore.getState().removePendingWorkspaceProposal,
      appendRuntimeFeedbackEvent: useChatStore.getState().appendRuntimeFeedbackEvent,
      getRuntimeFeedbackEvents: useChatStore.getState().getRuntimeFeedbackEvents
    },
    persona: {
      activeCollaboratorId: personaState.activeCollaboratorId,
      personas: personaState.personas,
      findCollaborator: (entryId: string) =>
        usePersonaStore.getState().personas.find((persona) => persona.id === entryId),
      updateCollaborator: usePersonaStore.getState().updateCollaborator
    },
    collection: {
      cards: collectionState.cards,
      imageCards: collectionState.imageCards,
      projectFiles: collectionState.projectFiles,
      roomProjects: collectionState.roomProjects,
      readLatestState: () => {
        const state = useCollectionStore.getState();
        return {
          cards: state.cards,
          imageCards: state.imageCards,
          projectFiles: state.projectFiles,
          roomProjects: state.roomProjects
        };
      },
      createCard: collectionState.createCard,
      createProjectFile: collectionState.createProjectFile,
      createProject: collectionState.createProject,
      updateProject: collectionState.updateProject,
      promoteCardToProject: collectionState.promoteCardToProject,
      saveCardFromChat: collectionState.saveCardFromChat,
      saveImageCardFromChat: collectionState.saveImageCardFromChat,
      updateCard: collectionState.updateCard,
      updateProjectFile: collectionState.updateProjectFile,
      deleteProjectFile: collectionState.deleteProjectFile
    },
    runtime: {
      api: selectRuntimeApi(runtimeState),
      providers: selectVisibleProviders(runtimeState),
      imageGeneration: runtimeState.imageGeneration,
      imageUnderstanding: runtimeState.imageUnderstanding,
      voiceGeneration: runtimeState.voiceGeneration,
      search: runtimeState.search,
      mcpServers: runtimeState.mcpServers,
      mcpToolTimeoutSeconds: runtimeState.mcpToolTimeoutSeconds,
      readLatestState: () => {
        const state = useRuntimeStore.getState();
        return {
          api: selectRuntimeApi(state),
          providers: selectVisibleProviders(state),
          imageGeneration: state.imageGeneration,
          imageUnderstanding: state.imageUnderstanding,
          search: state.search,
          mcpServers: state.mcpServers,
          mcpToolTimeoutSeconds: state.mcpToolTimeoutSeconds,
          triggerRules: state.triggerRules
        };
      },
      setTaskModeEnabled: runtimeState.setTaskModeEnabled,
      getTriggerRules: () => useRuntimeStore.getState().triggerRules,
      createTriggerRule: runtimeState.createTriggerRule,
      updateTriggerRule: runtimeState.updateTriggerRule,
      deleteTriggerRule: runtimeState.deleteTriggerRule
    },
    space: {
      activeThemePreview: spaceState.activeThemePreview,
      activeWorld: spaceState.activeWorld,
      activeCardId: spaceState.activeCardId,
      applyThemePatch: spaceState.applyThemePatch,
      applyThemePreset: spaceState.applyThemePreset,
      beginThemePreview: spaceState.beginThemePreview,
      collectionShelf: spaceState.collectionShelf,
      commitSkinSnapshot: spaceState.commitSkinSnapshot,
      commitThemePreview: spaceState.commitThemePreview,
      currentThemeFrame: {
        activePresetId: spaceState.theme.activePresetId,
        activeSavedSkinId: spaceState.theme.activeSavedSkinId,
        cssVariables: spaceState.theme.cssVariables,
        presetCSS: spaceState.theme.presetCSS,
        customCSS: spaceState.theme.customCSS,
        generatedCSS: spaceState.theme.generatedCSS,
        recipe: spaceState.theme.recipe
      },
      getActiveThemePreview: () => useSpaceStore.getState().activeThemePreview,
      getCurrentThemeFrame: () => toThemeFrame(useSpaceStore.getState().theme),
      frontstageCollaboratorId: spaceState.frontstageCollaboratorId,
      rollbackThemePreview: spaceState.rollbackThemePreview,
      saveCurrentSkin: spaceState.saveCurrentSkin,
      setActiveCard: spaceState.setActiveCard,
      setCollectionShelf: spaceState.setCollectionShelf,
      setThemeToolMode: spaceState.setThemeToolMode,
      setWorld: spaceState.setWorld,
      spotlightCard: spaceState.spotlightCard,
      themeToolMode: spaceState.theme.toolMode
    }
  };
}

export async function runCompanionHostCommand(
  command: PolarisCompanionCommand,
  abortControllerRef: MutableRefObject<AbortController | null>,
  streamingLifecycleReleaseRef: MutableRefObject<number | null>,
  setSending: (value: boolean) => void,
  setStreaming: (
    value: ChatStreamingState | ((current: ChatStreamingState) => ChatStreamingState)
  ) => void
) {
  const chatState = useChatStore.getState();
  const personaState = usePersonaStore.getState();
  const spaceState = useSpaceStore.getState();
  const trigger = command.trigger;

  if (trigger) {
    const targetPersona = personaState.personas.find((persona) => persona.id === trigger.target.collaboratorId) ?? null;
    if (!targetPersona || isCompanionCollaboratorId(trigger.target.collaboratorId)) return;

    const targetConversation = resolveCompanionTriggerConversation(trigger);
    if (!targetConversation) return;
    const writableTargetConversation = await chatState.ensureConversationWritable(targetConversation.id);
    if (!writableTargetConversation) return;

    const triggerMessage = buildCompanionTriggerMessage(command);
    const targetMessages = [...writableTargetConversation.messages, triggerMessage];
    const messageCountBeforeReply = targetMessages.length;
    chatState.addMessage(writableTargetConversation, triggerMessage);

    const result = await requestReply({
      ui: {
        abortControllerRef,
        setSending,
        setStreaming,
        streamingLifecycleReleaseRef
      },
      chat: createCompanionReplyChatPort(),
      executeToolActions: createChatToolActions({
        ui: {
          setCommandStatus: () => {}
        },
        store: createCompanionToolActionStore(),
        derived: {
          activeConversation: {
            id: writableTargetConversation.conversation.id,
            title: writableTargetConversation.conversation.title,
            collaboratorId: writableTargetConversation.conversation.collaboratorId,
            activeProjectId: writableTargetConversation.conversation.activeProjectId ?? null,
            messages: writableTargetConversation.messages
          },
          activeCollaboratorSourceId: trigger.target.collaboratorId,
          codeCardActionModeByMessageId: {}
        }
      }).submitAssistantToolActions,
      conversationId: writableTargetConversation.conversationId,
      writableConversation: writableTargetConversation,
      collaboratorId: trigger.target.collaboratorId,
      messages: targetMessages,
      requestSnapshot: buildCompanionRequestSnapshot(trigger.target.collaboratorId, writableTargetConversation.conversationId),
      refreshRequestSnapshot: () => buildCompanionRequestSnapshot(trigger.target.collaboratorId, writableTargetConversation.conversationId)
    });
    if (result.status === 'completed') {
      const latestChatState = useChatStore.getState();
      const latestSpaceState = useSpaceStore.getState();
      const latestConversation = latestChatState.conversations.find((entry) => entry.id === writableTargetConversation.conversationId) ?? null;
      const notification = buildProactiveReplyNotification({
        conversation: latestConversation,
        collaboratorId: trigger.target.collaboratorId,
        collaboratorName: targetPersona.name,
        messageCountBeforeReply,
        currentView: {
          activeWorld: latestSpaceState.activeWorld,
          activeConversationId: latestChatState.activeConversationId
        }
      });
      if (notification) {
        latestSpaceState.enqueueReplyNotification(notification);
        void postNativeProactiveReplyNotification(notification);
      }
    }
    return;
  }

  const activeConversation = chatState.activeConversationId
    ? await chatState.ensureConversationMessagesLoaded(chatState.activeConversationId)
    : null;
  const collaboratorId =
    activeConversation?.collaboratorId ??
    personaState.activeCollaboratorId ??
    personaState.personas[0]?.id ??
    null;
  if (!collaboratorId || isCompanionCollaboratorId(collaboratorId)) return;

  const userMessage = createMessage('user', command.text, undefined, 'user-input');
  const targetConversationId = activeConversation?.id ?? chatState.createConversation(collaboratorId);
  if (!activeConversation) {
    spaceState.clearPendingAttachments();
    spaceState.clearPendingCardReference();
  }
  const writableTargetConversation = await chatState.ensureConversationWritable(targetConversationId);
  if (!writableTargetConversation) return;
  const targetMessages = [...writableTargetConversation.messages, userMessage];
  chatState.addMessage(writableTargetConversation, userMessage);

  const toolActions = createChatToolActions({
    ui: {
      setCommandStatus: () => {}
    },
    store: createCompanionToolActionStore(),
    derived: {
      activeConversation: activeConversation
        ? {
            id: activeConversation.id,
            title: activeConversation.title,
            collaboratorId: activeConversation.collaboratorId,
            activeProjectId: activeConversation.activeProjectId ?? null,
            messages: activeConversation.messages
          }
        : null,
      activeCollaboratorSourceId: collaboratorId,
      codeCardActionModeByMessageId: {}
    }
  });

  await requestReply({
    ui: {
      abortControllerRef,
      setSending,
      setStreaming,
      streamingLifecycleReleaseRef
    },
    chat: createCompanionReplyChatPort(),
    executeToolActions: toolActions.submitAssistantToolActions,
    conversationId: targetConversationId,
    writableConversation: writableTargetConversation,
    collaboratorId,
    messages: targetMessages,
    requestSnapshot: buildCompanionRequestSnapshot(collaboratorId, targetConversationId),
    refreshRequestSnapshot: () => buildCompanionRequestSnapshot(collaboratorId, targetConversationId)
  });
}
