import { useMemo } from 'react';
import { buildConversationCardSummary } from '../../app/collection/conversationCardSummary';
import { resolveCollectionRenderItemCount } from '../../app/shell/collectionRenderLoad';
import { deriveAppShellState } from '../../app/shell/deriveAppShellState';
import { useAppShellStoreBindings } from '../../app/shell/useAppShellStoreBindings';
import { createCompanionPersonaProjection, isCompanionCollaboratorId } from '../../engines/companion';
import {
  conversationMatchesCollaboratorScope,
  resolveConversationCollaboratorId
} from '../../engines/conversationOwnership';
import { useCollectionShellState } from './useCollectionShellState';
import { useAppShellNavigationActions } from './useAppShellNavigationActions';
import { useCollaboratorFrontstageSync } from './useCollaboratorFrontstageSync';
import { useEditingCollaboratorFrontstageSync } from './useEditingCollaboratorFrontstageSync';
import { useAppShellOverlayController } from './useAppShellOverlayController';
import { useAppShellWorldController } from './useAppShellWorldController';
import { enterCollaboratorCollectionScope } from '../../app/shell/frontstageNavigation';
import { useThemeSessionActions } from '../../app/theme/useThemeSessionActions';
import { useAbortStreamingCleanupEffect } from '../worlds/chat/effects/useAbortStreamingCleanupEffect';
import { useChatUiState } from '../worlds/chat/context/ChatUiState';
import { useI18n } from '../../i18n';
import type { AppTriggerChatRuntimePort } from '../../app/shell/useAppTriggerRuntime';

export function useAppShellController() {
  const chatUi = useChatUiState();
  const { t } = useI18n();
  useAbortStreamingCleanupEffect(chatUi);
  const stores = useAppShellStoreBindings();
  const {
    space: {
      activeWorld,
      setWorld,
      toggleWorld,
      collectionShelf,
      setCollectionShelf,
      frontstageCollaboratorId,
      collectionProjectId,
      editingCollaboratorId,
      setFrontstageCollaboratorId,
      setEditingCollaboratorId,
      setActiveCard,
      spotlightCard,
      clearPendingAttachments,
      clearPendingCardReference,
      replyNotifications,
      dismissReplyNotification,
      activeThemePreview,
      theme,
      customization,
      displayPreferences
    },
    collaborator: {
      personas,
      activeCollaboratorId,
    },
    runtime: {
      companionConnections,
      companionSnapshots
    },
    chat: {
      conversations,
      loadedMessageConversationIds,
      activeConversationId,
      activeConversationTitle,
      activeConversationCollaboratorId,
      activeConversationMessageCount,
      createConversation,
      renameConversation,
      toggleConversationPinned,
      deleteConversation,
      setActiveConversation
    },
    collection: {
      collectionHydrated,
      collectionCards,
      imageCards,
      roomProjects,
      projectFiles,
      createCard,
      backfillOwnershipFromConversations
    }
  } = stores;
  const collaborators = useMemo(
    () => [
      ...personas,
      ...companionConnections.map((connection) =>
        createCompanionPersonaProjection(connection, companionSnapshots[connection.id] ?? null)
      )
    ],
    [companionConnections, companionSnapshots, personas]
  );
  const activeConversationCollaboratorName = collaborators.find((persona) => persona.id === activeConversationCollaboratorId)?.name ?? null;
  const frontstageCollaborator = collaborators.find((persona) => persona.id === frontstageCollaboratorId) ?? null;
  const frontstageCollaboratorName = frontstageCollaborator?.name ?? null;
  const collaboratorIds = useMemo(() => collaborators.map((collaborator) => collaborator.id), [collaborators]);
  const desktopSidebarConversations = useMemo(
    () => {
      const projectTitleById = new Map(roomProjects.map((project) => [project.id, project.title.trim() || t('common.untitledWorkspace')]));
      return conversations
        .filter((conversation) => conversationMatchesCollaboratorScope(conversation, frontstageCollaboratorId, collaboratorIds))
        .map((conversation) => {
          const summary = buildConversationCardSummary(conversation);
          return {
            ...summary,
            activeProjectTitle: summary.activeProjectId ? projectTitleById.get(summary.activeProjectId) ?? t('common.workspace') : null
          };
        });
    },
    [collaboratorIds, conversations, frontstageCollaboratorId, roomProjects, t]
  );
  const desktopSidebarShelfItems = useMemo(
    () => [
      { shelf: 'project' as const, label: t('common.workspace') },
      { shelf: 'code' as const, label: t('desktop.navCards') },
      { shelf: 'image' as const, label: t('desktop.navImages') },
      { shelf: 'info' as const, label: frontstageCollaboratorName ?? t('desktop.collaboratorSettings') }
    ],
    [frontstageCollaboratorName, t]
  );
  const collectionRenderItemCount = useMemo(
    () => resolveCollectionRenderItemCount({
      collectionShelf,
      frontstageCollaboratorId,
      knownCollaboratorIds: collaboratorIds,
      loadedMessageConversationIds,
      conversations,
      cards: collectionCards,
      imageCards,
      roomProjects,
      projectFiles
    }),
    [
      collaboratorIds,
      collectionShelf,
      frontstageCollaboratorId,
      loadedMessageConversationIds,
      conversations,
      collectionCards,
      imageCards,
      roomProjects,
      projectFiles
    ]
  );

  const collection = useCollectionShellState();
  const themeSession = useThemeSessionActions();
  const chatRuntimePort: AppTriggerChatRuntimePort = useMemo(() => ({
    generationByConversationId: chatUi.generationByConversationId,
    getConversationGenerationControls: chatUi.getConversationGenerationControls,
    setCommandStatus: chatUi.setCommandStatus,
    themeToolModeSwitchRef: chatUi.themeToolModeSwitchRef
  }), [
    chatUi.generationByConversationId,
    chatUi.getConversationGenerationControls,
    chatUi.setCommandStatus,
    chatUi.themeToolModeSwitchRef
  ]);

  useCollaboratorFrontstageSync({
    personas,
    activeCollaboratorId,
    frontstageCollaboratorId,
    setActiveCollaborator: stores.collaborator.setActiveCollaborator
  });
  useEditingCollaboratorFrontstageSync({
    personas,
    editingCollaboratorId,
    frontstageCollaboratorId,
    activeCollaboratorId,
    setEditingCollaboratorId
  });
  const derived = deriveAppShellState({
    activeWorld,
    activeThemePreview,
    personas: collaborators,
    frontstageCollaboratorId,
    activeConversationTitle,
    activeConversationCollaboratorId,
    activeConversationMessageCount,
    collectionRenderItemCount,
    labels: {
      collectionWorld: t('common.room'),
      chatWorld: t('common.conversation'),
      unnamedConversation: t('chat.untitledConversation')
    }
  });
  const navigationActions = useAppShellNavigationActions({
    previewConversationId: derived.previewConversationId,
    personas: collaborators,
    conversations,
    activeWorld,
    frontstageCollaboratorId,
    collectionProjectId,
    activeCollaboratorId,
    activeConversationId,
    activeConversationCollaboratorId,
    activeConversationProjectId: conversations.find((conversation) => conversation.id === activeConversationId)?.activeProjectId ?? null,
    setWorld,
    createConversation,
    setActiveConversation,
    clearPendingAttachments,
    clearPendingCardReference
  });
  const overlays = useAppShellOverlayController({
    stores,
    collection,
    frontstage: {
      frontstageCollaboratorId,
      editingCollaboratorId,
      activeWorld,
      collectionShelf,
      setFrontstageCollaboratorId,
      setEditingCollaboratorId,
      setActiveCard,
      spotlightCard,
      clearPendingAttachments,
      clearPendingCardReference,
      setWorld,
      setCollectionShelf
    }
  });
  const world = useAppShellWorldController({
    activeWorld,
    activeThemePreview,
    theme,
    collectionShelf,
    toggleWorld,
    derived,
    collection,
    navigationActions,
    chatUi,
    toggleMenu: overlays.toggleMenu,
    openSettings: overlays.collectionOpenSettings,
    openToolbox: () => overlays.openMenuAt('toolbox'),
    openProviderSettings: overlays.collectionOpenProviderSettings
  });
  const desktopSidebarProps = {
    activeWorld,
    activeConversationId,
    collectionShelf,
    collaboratorScopeId: frontstageCollaboratorId,
    currentCollaborator: frontstageCollaborator,
    collaborators,
    conversations: desktopSidebarConversations,
    shelfItems: desktopSidebarShelfItems,
    onSelectCollaborator: (collaboratorId: string | null) => {
      enterCollaboratorCollectionScope({
        activeWorld,
        setFrontstageCollaboratorId,
        setCollectionShelf,
        setWorld
      }, collaboratorId);
      if (collaboratorId && !isCompanionCollaboratorId(collaboratorId)) {
        stores.collaborator.setActiveCollaborator(collaboratorId);
        setEditingCollaboratorId(collaboratorId);
      }
    },
    onCreateCollaboratorFromBuilder: () => {
      setWorld('collection');
      overlays.collectionOpenCollaboratorBuilderForCreate();
    },
    onCreateCustomCollaborator: () => {
      setWorld('collection');
      overlays.collectionCreateCustomCollaborator();
    },
    onSelectShelf: (shelf: typeof collectionShelf) => {
      if (shelf === 'info' && frontstageCollaboratorId) {
        setEditingCollaboratorId(frontstageCollaboratorId);
      }
      setCollectionShelf(shelf);
      setWorld('collection');
    },
    onOpenConversation: (conversationId: string) => {
      if (conversationId !== activeConversationId) {
        clearPendingAttachments();
        clearPendingCardReference();
      }
      setActiveConversation(conversationId);
      setWorld('chat');
    },
    onRenameConversation: renameConversation,
    onToggleConversationPinned: toggleConversationPinned,
    onDeleteConversation: (conversationId: string, title: string) => {
      if (!window.confirm(t('desktop.deleteConversationConfirm', { title }))) return;
      themeSession.rollbackPreviewForConversationDeletion(conversationId);
      deleteConversation(conversationId);
      if (conversationId === activeConversationId) {
        clearPendingAttachments();
        clearPendingCardReference();
      }
    },
    onCreateConversation: navigationActions.openFreshConversation,
    onOpenGroupWorld: () => {
      clearPendingAttachments();
      clearPendingCardReference();
      setWorld('group');
    },
    onOpenSettings: overlays.collectionOpenSettings
  };
  const openReplyNotification = (notification: typeof replyNotifications[number]) => {
    if (notification.conversationId !== activeConversationId) {
      clearPendingAttachments();
      clearPendingCardReference();
    }
    setFrontstageCollaboratorId(notification.collaboratorId);
    setActiveConversation(notification.conversationId);
    setWorld('chat');
    dismissReplyNotification(notification.id);
  };
  return {
    activeWorld,
    shellWorld: world.shellWorld,
    activeChatDensity: derived.activeChatDensity,
    customization,
    displayPreferences,
    themeTransitionPhase: world.themeTransitionPhase,
    worldPresence: world.worldPresence,
    collectionSearchOpen: collection.searchOpen,
    collectionCollaboratorSwitchOpen: collection.collaboratorSwitchOpen,
    setCollectionCollaboratorSwitchOpen: collection.setCollaboratorSwitchOpen,
    collectionInfoFullscreenOpen: collection.infoFullscreenOpen,
    setCollectionInfoFullscreenOpen: collection.setInfoFullscreenOpen,
    collectionDetailOpen: collection.detailOpen,
    setCollectionDetailOpen: collection.setDetailOpen,
    collectionOpenCollaboratorBuilderForCreate: overlays.collectionOpenCollaboratorBuilderForCreate,
    collectionCreateCustomCollaborator: overlays.collectionCreateCustomCollaborator,
    collectionOpenProviderSettings: overlays.collectionOpenProviderSettings,
    collectionOpenSettings: overlays.collectionOpenSettings,
    openBackupSettings: () => overlays.openMenuAt('backup'),
    collectionOpenDesktopLocalSettings: overlays.collectionOpenDesktopLocalSettings,
    collectionDeleteCollaborator: overlays.collaboratorActions.deleteCollaboratorFromPanel,
    canReviveTheme: overlays.canReviveTheme,
    restoreLastThemeSkin: overlays.restoreLastThemeSkin,
    restoreDefaultTheme: overlays.restoreDefaultTheme,
    topbarProps: {
      ...world.topbarProps,
      state: {
        ...world.topbarProps.state,
        topbarLayout: displayPreferences.topbarLayout,
        menuOpen: overlays.modals.menuOpen
      }
    },
    chatRuntimePort,
    collectionOwnershipBackfillPort: {
      collectionHydrated,
      conversations,
      backfillOwnershipFromConversations
    },
    chatWorldProps: world.chatWorldProps,
    groupWorldProps: world.groupWorldProps,
    desktopSidebarProps,
    replyNotificationProps: {
      notifications: replyNotifications,
      activeWorld,
      activeConversationId,
      onOpen: openReplyNotification,
      onDismiss: dismissReplyNotification
    },
    overlaysProps: overlays.overlaysProps,
    screenshotDebugContext: {
      activeConversationTitle,
      activeConversationMessageCount,
      collectionRenderItemCount,
      activeConversationCollaboratorName,
      frontstageCollaboratorName
    },
    collaboratorTransitionKey: frontstageCollaboratorId ?? '__aggregate__'
  };
}
