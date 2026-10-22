import { useMemo, useRef } from 'react';
import { createChatActionHandlers } from '../../../app/chat/chatActions';
import type { ChatDerivedState } from '../../../app/chat/chatDerivedState';
import type { ChatPresentation } from '../../../app/chat/chatPresentation';
import { createChatReplyRunner } from '../../../app/chat/chatReplyFlow';
import type { ChatReplyRunResult } from '../../../app/chat/chatReplyRuntime';
import { useThemeSessionActions } from '../../../app/theme/useThemeSessionActions';
import { resolveRoomProjectFiles } from '../../../engines/roomProjects';
import { deriveWorkspaceBannerState } from '../../../engines/workspaceBannerState';
import { resolveWorkspaceProposalLabel } from '../../../engines/workspaceBinding';
import {
  exitConversationWorkspaceScope,
  openWorkspaceInCollectionFromChat
} from '../../../app/shell/workspaceNavigation';
import type { ToolActions } from '../../../app/chat/chatToolActions';
import { PERSONA_COLORS } from '../../../config/persona/personaColors';
import type {
  ChatActionStoreBindings,
  ChatReplyStoreBindings,
  ChatStoreBindings
} from '../../../app/chat/useChatStoreBindings';
import type { ChatMessage } from '../../../types/domain';
import { cancelChatStreaming } from './chatStreamingLifecycle';
import type {
  ChatContextActionsValue,
  ChatContextAttachmentsValue,
  ChatContextComposerValue,
  ChatContextPresentationValue,
  ChatContextUiValue,
  ChatContextValue
} from './context/ChatContext';
import type { ChatUiState } from './context/ChatUiState';
import { buildThemeToolModeSwitchFeedback } from '../../theme-tool-mode/themeToolModeGuidance';
import { acceptPendingWorkspaceProposal, rejectPendingWorkspaceProposal } from './workspaceProposalActions';
import { useChatStore } from '../../../stores/chatStore';
import { createChatSlashCommandHandler } from '../../../app/chat/chatSlashCommands';
import { setTaskModeEnabledForConversations } from '../../../app/chat/taskModeToggle';
import { useI18n, type I18nTranslator } from '../../../i18n';
import { resolvePersonaProviderBinding } from '../../../engines/personaProviderBinding';
import { requestThinkingTranslation } from '../../../engines/thinkingTranslation';

type UseChatProviderValueArgs = {
  ui: ChatUiState;
  store: ChatStoreBindings;
  actionStore: ChatActionStoreBindings;
  replyStore: ChatReplyStoreBindings;
  derived: ChatDerivedState;
  presentation: ChatPresentation;
  startupReady: boolean;
  toolActions: ToolActions;
  isActiveWorld: boolean;
  openToolbox: () => void;
};

type Translate = I18nTranslator['t'];

function buildPresentationSection(args: {
  presentation: ChatPresentation;
  derived: ChatDerivedState;
  isActiveWorld: boolean;
}): ChatContextPresentationValue {
  return {
    ...args.presentation,
    isActiveWorld: args.isActiveWorld,
    personaColor: args.derived.persona ? (PERSONA_COLORS[args.derived.persona.id] || '#7B8ABF') : '#7B8ABF'
  };
}

function buildComposerSection(args: {
  ui: ChatUiState;
  store: ChatStoreBindings;
  derived: ChatDerivedState;
}): ChatContextComposerValue {
  const activeConversation = args.derived.activeConversation;
  const activeProject = activeConversation?.activeProjectId
    ? args.store.collection.roomProjects.find((project) => project.id === activeConversation.activeProjectId) ?? null
    : null;
  const pendingWorkspaceProposal = activeConversation
    ? args.store.chat.pendingWorkspaceProposals.find((proposal) => proposal.conversationId === activeConversation.id) ?? null
    : null;
  const activeWorkspace = activeProject
    ? {
        projectId: activeProject.id,
        title: activeProject.title,
        fileCount: resolveRoomProjectFiles(activeProject, args.store.collection.projectFiles).length
      }
    : null;

  return {
    inputDraft: args.store.chat.inputDraft,
    dragActive: args.ui.dragActive,
    pendingCardReference: args.store.space.pendingCardReference,
    availableCards: args.store.collection.cards,
    workspaceBanner: deriveWorkspaceBannerState({
      activeWorkspace,
      pendingWorkspaceProposal: pendingWorkspaceProposal
        ? {
            ...pendingWorkspaceProposal,
            requestedProjectTitle: resolveWorkspaceProposalLabel(pendingWorkspaceProposal)
          }
        : null
    }),
    toolPromptPreferences: args.store.runtime.toolPromptPreferences,
    taskModeEnabled: args.store.runtime.taskModeEnabled,
    themeToolMode: args.store.space.theme.toolMode,
    canReviveTheme: args.store.space.theme.skinHistory.length > 0,
    reasoningStrength: activeConversation?.reasoningStrength ?? 'automatic'
  };
}

function buildUiSection(args: {
  ui: ChatUiState;
  derived: ChatDerivedState;
}): ChatContextUiValue {
  return {
    commandStatus: args.ui.commandStatus,
    submitFlight: args.ui.submitFlight,
    editing: args.ui.editing,
    streaming: args.derived.displayStreaming,
    focusedMessageId: args.derived.focusedMessageId,
    showThinking: args.derived.showThinking,
    showLiveThinking: args.derived.showLiveThinking,
    showEmptyState: args.derived.showEmptyState,
    sending: args.derived.sending,
    collapsedThinkingMessageIds: args.ui.collapsedThinkingMessageIds,
    expandedCodeMessageIds: args.ui.expandedCodeMessageIds,
    latestRetryableAssistantId: args.derived.latestRetryableAssistantId,
    activePreviewMessage: args.derived.activePreviewMessage,
    thinkingSummaryMessageId: args.ui.thinkingSummaryMessageId,
    codeCardActionModeByMessageId: args.derived.codeCardActionModeByMessageId,
    codeCardProgressByMessageId: args.derived.codeCardProgressByMessageId
  };
}

function buildAttachmentsSection(store: ChatStoreBindings): ChatContextAttachmentsValue {
  return {
    pending: store.space.pendingAttachments,
    add: store.space.addPendingAttachments,
    remove: store.space.removePendingAttachment,
    clear: store.space.clearPendingAttachments
  };
}

function buildActionsSection(args: {
  ui: ChatUiState;
  store: ChatStoreBindings;
  toolActions: ToolActions;
  chatActions: ReturnType<typeof createChatActionHandlers>;
  runReply: (params: {
    conversationId: string;
    collaboratorId: string;
    messages: ChatMessage[];
  }) => Promise<ChatReplyRunResult>;
  openToolbox: () => void;
  themeSession: ReturnType<typeof useThemeSessionActions>;
  persona: ChatDerivedState['persona'];
  t: Translate;
}): ChatContextActionsValue {
  return {
    submit: args.chatActions.handleSubmit,
    stopGeneration: () => {
      const activeConversationId = args.store.chat.activeConversationId;
      if (!activeConversationId) return;
      cancelChatStreaming(args.ui.getConversationGenerationControls(activeConversationId));
    },
    retry: args.chatActions.retryLatestAssistant,
    editMessage: args.ui.startEditingMessage,
    deleteUserMessage: args.chatActions.deleteUserMessage,
    editAssistantMessage: args.chatActions.updateAssistantMessage,
    cacheAssistantSpeech: args.chatActions.cacheAssistantSpeech,
    forkFromMessage: args.chatActions.forkConversationFromMessage,
    updateEditingDraft: (value: string) =>
      args.ui.setEditing((current) => (current ? { ...current, draft: value } : null)),
    removeEditingAttachment: (attachmentId: string) =>
      args.ui.setEditing((current) => current
        ? { ...current, attachments: current.attachments.filter((item) => item.id !== attachmentId) }
        : null),
    commitEdit: args.chatActions.commitMessageEdit,
    cancelEdit: args.ui.cancelEditingMessage,
    toggleThinkingCollapsed: (messageId: string) =>
      args.ui.setCollapsedThinkingMessageIds((current) =>
        current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId]),
    openThinkingSummary: (message: ChatMessage) => {
      args.ui.setCollapsedThinkingMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
      args.ui.setThinkingSummaryMessageId(message.id);
    },
    translateThinking: (sections, targetLanguage, signal) => {
      const binding = resolvePersonaProviderBinding({
        globalApi: args.store.runtime.api,
        providers: args.store.runtime.providers,
        persona: args.persona
      });
      return requestThinkingTranslation({
        api: binding.api,
        advanced: args.persona?.advanced,
        sections,
        targetLanguage,
        signal
      });
    },
    toggleCodeExpanded: (messageId: string) =>
      args.ui.setExpandedCodeMessageIds((current) =>
        current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId]),
    applyToolPreview: args.toolActions.applyToolPreview,
    saveToolPreview: args.toolActions.saveToolPreview,
    rollbackToolPreview: args.toolActions.rollbackToolPreview,
    applyCustomCss: (css: string) => {
      const trimmed = css.trim();
      if (!trimmed) {
        args.ui.setCommandStatus(args.t('chat.command.emptyCss'), true);
        return;
      }
      args.themeSession.applyCustomCss(trimmed);
      args.ui.setCommandStatus(args.t('chat.command.customCssApplied'));
    },
    openCodeCard: (cardId: string) => {
      const card = args.store.collection.cards.find((entry) => entry.id === cardId) ?? null;
      if (!card) {
        args.ui.setCommandStatus(args.t('chat.command.codeCardMissing'), true);
        return;
      }
      args.store.space.setActiveCard(card.id);
      args.store.space.spotlightCard(card.id);
      args.store.space.setCollectionShelf('code');
      args.store.space.setWorld('collection');
    },
    saveImageAttachment: args.toolActions.saveMessageImageCard,
    codeCardAction: args.toolActions.handleCodeCardAction,
    setInputDraft: args.store.chat.setInputDraft,
    setConversationDraft: args.store.chat.setConversationDraft,
    setConversationReasoningStrength: (strength) => {
      const activeConversationId = args.store.chat.activeConversationId;
      if (!activeConversationId) return;
      args.store.chat.setConversationReasoningStrength(activeConversationId, strength);
      args.ui.setCommandStatus(args.t('chat.reasoning.changed'));
    },
    setPendingCardReference: (reference) => {
      args.store.space.setPendingCardReference(reference);
      if (reference) {
        args.store.space.setActiveCard(reference.id);
      }
    },
    setDragActive: args.ui.setDragActive,
    setCommandStatus: args.ui.setCommandStatus,
    clearCommandStatus: args.ui.clearCommandStatus,
    setToolPromptGroupEnabled: (group, enabled) => {
      args.store.runtime.setToolPromptGroupEnabled(group, enabled);
      if (group !== 'theme' || enabled) return;
      const previousMode = args.store.space.themeToolMode;
      if (previousMode === 'off') return;
      args.store.space.setThemeToolMode('off');
      args.ui.themeToolModeSwitchRef.current = {
        from: previousMode,
        to: 'off',
        pendingTurns: 2
      };
      args.ui.setCommandStatus(buildThemeToolModeSwitchFeedback('off', args.t));
    },
    setTaskModeEnabled: (enabled: boolean) => {
      const chatState = useChatStore.getState();
      setTaskModeEnabledForConversations({
        runtime: {
          setTaskModeEnabled: args.store.runtime.setTaskModeEnabled
        },
        chat: {
          conversations: chatState.conversations,
          setConversationTask: chatState.setConversationTask
        }
      }, enabled);
      args.ui.setCommandStatus(
        enabled
          ? args.t('chat.command.taskModeOn')
          : args.t('chat.command.taskModeOff')
      );
    },
    setThemeToolMode: (mode) => {
      const previousMode = args.store.space.themeToolMode;
      args.store.space.setThemeToolMode(mode);
      if (mode !== previousMode) {
        args.ui.themeToolModeSwitchRef.current = {
          from: previousMode,
          to: mode,
          pendingTurns: 2
        };
      }
      args.ui.setCommandStatus(buildThemeToolModeSwitchFeedback(mode, args.t));
    },
    reviveTheme: () => {
      if (args.store.space.theme.skinHistory.length === 0) {
        args.ui.setCommandStatus(args.t('chat.command.noThemeToRevive'), true);
        return;
      }
      args.store.space.rollbackLastSkin();
      args.ui.setCommandStatus(args.t('chat.command.themeRevived'));
    },
    restoreDefaultTheme: () => {
      args.themeSession.restoreDefaultTheme();
      args.ui.setCommandStatus(args.t('chat.command.themeDefaultRestored'));
    },
    openToolbox: args.openToolbox,
    createConversation: args.chatActions.createConversation,
    openConversation: (conversationId: string) => {
      if (conversationId !== args.store.chat.activeConversationId) {
        args.store.space.clearPendingAttachments();
        args.store.space.clearPendingCardReference();
      }
      args.store.chat.setActiveConversation(conversationId);
    },
    acceptWorkspaceProposal: async () => {
      const activeConversation = args.store.chat.conversations.find(
        (conversation) => conversation.id === args.store.chat.activeConversationId
      ) ?? null;
      if (!activeConversation) return;
      const proposal = args.store.chat.pendingWorkspaceProposals.find(
        (entry) => entry.conversationId === activeConversation.id
      ) ?? null;
      if (!proposal) return;
      await acceptPendingWorkspaceProposal({
        activeConversation,
        proposal,
        workspaces: args.store.collection.roomProjects,
        setConversationActiveProject: args.store.chat.setConversationActiveProject,
        removePendingWorkspaceProposal: args.store.chat.removePendingWorkspaceProposal,
        submitAssistantToolActions: args.toolActions.submitAssistantToolActions,
        findConversation: (conversationId) =>
          useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId) ?? null,
        appendRuntimeFeedbackEvent: args.store.chat.appendRuntimeFeedbackEvent,
        getConversationTask: args.store.chat.getConversationTask,
        setConversationTask: args.store.chat.setConversationTask,
        continueAfterAccept: async (conversationId) => {
          const conversation = args.store.chat.findConversation(conversationId) ?? null;
          const collaboratorId = conversation?.collaboratorId ?? args.store.persona.activeCollaboratorId;
          if (!collaboratorId) return;
          await args.runReply({
            conversationId,
            collaboratorId,
            messages: args.store.chat.getConversationMessages(conversationId)
          });
        },
        setCommandStatus: args.ui.setCommandStatus,
        t: args.t
      });
    },
    rejectWorkspaceProposal: () => {
      const activeConversation = args.store.chat.conversations.find(
        (conversation) => conversation.id === args.store.chat.activeConversationId
      ) ?? null;
      if (!activeConversation) return;
      const proposal = args.store.chat.pendingWorkspaceProposals.find(
        (entry) => entry.conversationId === activeConversation.id
      ) ?? null;
      if (!proposal) return;
      rejectPendingWorkspaceProposal({
        activeConversation,
        proposal,
        workspaces: args.store.collection.roomProjects,
        removePendingWorkspaceProposal: args.store.chat.removePendingWorkspaceProposal,
        appendRuntimeFeedbackEvent: args.store.chat.appendRuntimeFeedbackEvent,
        getConversationTask: args.store.chat.getConversationTask,
        setConversationTask: args.store.chat.setConversationTask,
        setCommandStatus: args.ui.setCommandStatus,
        t: args.t
      });
    },
    openActiveWorkspace: () => {
      const activeConversationId = args.store.chat.activeConversationId;
      if (!activeConversationId) return;
      const activeConversation = args.store.chat.conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? null;
      const activeProjectId = activeConversation?.activeProjectId ?? null;
      if (!activeProjectId) return;
      openWorkspaceInCollectionFromChat({
        projectId: activeProjectId,
        conversationId: activeConversationId,
        setPendingProjectOpenId: args.store.space.setPendingProjectOpenId,
        setPendingProjectOpenSource: args.store.space.setPendingProjectOpenSource,
        setCollectionShelf: args.store.space.setCollectionShelf,
        setWorld: args.store.space.setWorld
      });
    },
    exitWorkspace: () => {
      const activeConversationId = args.store.chat.activeConversationId;
      if (!activeConversationId) return;
      exitConversationWorkspaceScope({
        conversationId: activeConversationId,
        setConversationActiveProject: args.store.chat.setConversationActiveProject
      });
      args.ui.setCommandStatus(args.t('chat.command.workspaceExited'));
    },
    selectPersona: args.chatActions.selectPersona,
    deleteCollaborator: args.chatActions.deleteCollaborator,
    closeThinkingSummary: () => args.ui.setThinkingSummaryMessageId(null)
  };
}

export function useChatProviderValue({
  ui,
  store,
  actionStore,
  replyStore,
  derived,
  presentation,
  startupReady,
  toolActions,
  isActiveWorld,
  openToolbox
}: UseChatProviderValueArgs): ChatContextValue {
  const { t } = useI18n();
  const activeSubmitFingerprintRef = useRef<string | null>(null);
  const themeSession = useThemeSessionActions();
  const runReply = createChatReplyRunner({
    ui: {
      themeToolModeSwitchRef: ui.themeToolModeSwitchRef,
      getConversationGenerationControls: ui.getConversationGenerationControls,
      toolPromptPreferences: store.runtime.toolPromptPreferences,
      taskModeEnabled: store.runtime.taskModeEnabled
    },
    store: replyStore,
    derived,
    toolActions
  });
  const submitSlashCommand = createChatSlashCommandHandler({
    ui: {
      sending: derived.sending,
      setCommandStatus: ui.setCommandStatus
    },
    store,
    derived,
    toolActions,
    runReply
  });
  const chatActions = createChatActionHandlers({
    startupReady,
    ui: {
      sending: derived.sending,
      editing: ui.editing,
      confirm: (message) => window.confirm(message),
      setCommandStatus: ui.setCommandStatus,
      triggerSubmitFlight: ui.triggerSubmitFlight,
      cancelEditingMessage: ui.cancelEditingMessage
    },
    store: actionStore,
    derived,
    runReply,
    submitToolCommand: submitSlashCommand,
    activeSubmitFingerprintRef,
    t
  });
  return useMemo(() => {
    const activeConversation = derived.activeConversation;
    const presentationSection = buildPresentationSection({
      presentation,
      derived,
      isActiveWorld
    });
    const composerSection = buildComposerSection({ ui, store, derived });
    const uiSection = buildUiSection({ ui, derived });
    const attachmentsSection = buildAttachmentsSection(store);
    const actionsSection = buildActionsSection({
      ui,
      store,
      toolActions,
      chatActions,
      runReply,
      openToolbox,
      themeSession,
      persona: derived.persona,
      t
    });

    return {
      conversation: activeConversation,
      messages: derived.messages,
      persona: derived.persona,
      presentation: presentationSection,
      composer: composerSection,
      ui: uiSection,
      attachments: attachmentsSection,
      actions: actionsSection
    };
  }, [chatActions, derived, isActiveWorld, openToolbox, presentation, startupReady, store, themeSession, t, toolActions, ui]);
}
