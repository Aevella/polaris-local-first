import { useMemo } from 'react';
import { useChatDerived } from '../../../app/chat/chatDerivedState';
import { buildChatPresentation } from '../../../app/chat/chatPresentation';
import { createChatToolActions } from '../../../app/chat/chatToolActions';
import { createCompanionPersonaProjection } from '../../../engines/companion';
import { isGroupConversation } from '../../../engines/conversationOwnership';
import {
  createChatActionStoreBindings,
  createChatReplyStoreBindings,
  createChatToolStoreBindings,
  useChatStoreBindings
} from '../../../app/chat/useChatStoreBindings';
import type { ChatUiState } from './context/ChatUiState';
import { useChatProviderValue } from './useChatProviderValue';

type UseChatProviderControllerArgs = {
  isActiveWorld: boolean;
  openToolbox: () => void;
  openProviderSettings: () => void;
  ui: ChatUiState;
};

export function useChatProviderController({
  isActiveWorld,
  openToolbox,
  openProviderSettings,
  ui
}: UseChatProviderControllerArgs) {
  const store = useChatStoreBindings();
  const collaborators = useMemo(
    () => [
      ...store.persona.personas,
      ...store.runtime.companionConnections.map((connection) =>
        createCompanionPersonaProjection(connection, store.runtime.companionSnapshots[connection.id] ?? null)
      )
    ],
    [store.persona.personas, store.runtime.companionConnections, store.runtime.companionSnapshots]
  );
  const startupReady =
    store.chat.hydrated
    && store.persona.hydrated
    && store.runtime.hydrated
    && store.collection.hydrated;
  const activeGeneration = store.chat.activeConversationId
    ? ui.generationByConversationId[store.chat.activeConversationId] ?? null
    : null;
  const directConversations = useMemo(
    () => store.chat.conversations.filter((conversation) => !isGroupConversation(conversation)),
    [store.chat.conversations]
  );

  const derived = useChatDerived({
    startupReady,
    activeConversationId: store.chat.activeConversationId,
    activeThemePreview: store.space.activeThemePreview,
    frontstageCollaboratorId: store.space.frontstageCollaboratorId,
    activeCollaboratorId: store.persona.activeCollaboratorId,
    inputDraft: store.chat.inputDraft,
    conversationSearch: ui.conversationSearch,
    conversations: directConversations,
    personas: collaborators,
    pendingAttachments: store.space.pendingAttachments,
    pendingCardReference: store.space.pendingCardReference,
    api: store.runtime.api,
    providers: store.runtime.providers,
    streaming: activeGeneration?.streaming ?? null,
    sending: activeGeneration?.sending ?? false,
    collectionCards: store.collection.cards,
    focusedMessageTarget: store.space.focusedMessageTarget
  });

  const presentation = buildChatPresentation({
    activeConversation: derived.activeConversation,
    messages: derived.messages,
    conversations: directConversations,
    roomProjects: store.collection.roomProjects,
    persona: derived.persona,
    activeCollaboratorId: derived.activeCollaboratorSourceId,
    showChatAvatars: store.space.customization.showChatAvatars,
    personas: collaborators,
    startupReady,
    hasUnsupportedPendingImages: derived.hasUnsupportedPendingImages,
    activeConversationBodyStatus: derived.activeConversation
      ? store.chat.conversationBodyStatuses[derived.activeConversation.id] ?? null
      : null
  });

  const actionStore = createChatActionStoreBindings(store);
  const replyStore = createChatReplyStoreBindings(store);
  const toolStore = createChatToolStoreBindings(store);
  const toolActions = useMemo(() => createChatToolActions({
    ui: {
      ...ui,
      openProviderSettings
    },
    store: toolStore,
    derived
  }), [derived, openProviderSettings, toolStore, ui]);
  const value = useChatProviderValue({
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
  });

  return {
    ui,
    store,
    derived,
    value
  };
}
