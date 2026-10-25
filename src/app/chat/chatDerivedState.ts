import { useMemo } from 'react';
import { resolveConversationCollaboratorName } from '../../engines/conversationOwnership';
import {
  resolveImageUnderstandingProvider,
  resolveProviderImageUnderstandingSettings
} from '../../engines/imageUnderstandingClient';
import { resolvePersonaProviderBinding } from '../../engines/personaProviderBinding';
import { providerRuntimeSupportsImageInput } from '../../engines/provider-runtime';
import { PERSONA_COLORS } from '../../config/persona/personaColors';
import type {
  ChatAttachment,
  ChatCardReference,
  CodeCard,
  Conversation,
  Persona,
  ProviderProfile
} from '../../types/domain';
import type { ChatStreamingState } from './chatStreamingDisplay';
import { resolveChatStreamingPresentation } from './chatStreamingDisplay';
import { createCodeCardProjectionReader } from './chatCodeCardProjection';
export type { CodeCardActionMode, CodeCardMessageProgress } from './chatCodeCardProjection';

type ChatDerivedArgs = {
  startupReady: boolean;
  activeConversationId: string | null;
  activeThemePreview: { id: string; conversationId: string; before: unknown } | null;
  frontstageCollaboratorId: string | null;
  activeCollaboratorId: string | null;
  inputDraft: string;
  conversationSearch: string;
  conversations: Conversation[];
  personas: Persona[];
  pendingAttachments: ChatAttachment[];
  pendingCardReference: ChatCardReference | null;
  api: ProviderProfile;
  providers: ProviderProfile[];
  streaming: ChatStreamingState;
  sending: boolean;
  collectionCards: CodeCard[];
  focusedMessageTarget: { conversationId: string; messageId: string } | null;
};

export function useChatDerived({
  startupReady,
  activeConversationId,
  activeThemePreview,
  frontstageCollaboratorId,
  activeCollaboratorId,
  inputDraft,
  conversationSearch,
  conversations,
  personas,
  pendingAttachments,
  pendingCardReference,
  api,
  providers,
  streaming,
  sending,
  collectionCards,
  focusedMessageTarget
}: ChatDerivedArgs) {
  const collaborators = personas;
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );
  const activeCollaboratorSourceId = frontstageCollaboratorId ?? activeConversation?.collaboratorId ?? activeCollaboratorId;
  const currentCollaborator = useMemo(
    () => collaborators.find((entry) => entry.id === activeCollaboratorSourceId) ?? null,
    [activeCollaboratorSourceId, collaborators]
  );
  const messages = activeConversation?.messages ?? [];
  const activePreviewMessage = useMemo(() => {
    if (!activeConversation || !activeThemePreview) return null;
    if (activeConversation.id !== activeThemePreview.conversationId) return null;

    return [...activeConversation.messages]
      .reverse()
      .find((message) => message.toolInvocation?.previewId === activeThemePreview.id) ?? null;
  }, [activeConversation, activeThemePreview]);
  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) => {
      const collaboratorName = resolveConversationCollaboratorName(conversation, collaborators);
      const recentContent = conversation.messages
        .slice(-3)
        .map((message) => [message.content, ...(message.attachments ?? []).map((attachment) => attachment.name)].join('\n'))
        .join('\n');

      return [conversation.title, collaboratorName, recentContent].join('\n').toLowerCase().includes(query);
    });
  }, [collaborators, conversationSearch, conversations]);
  const collaboratorColor = currentCollaborator ? (PERSONA_COLORS[currentCollaborator.id] || '#7B8ABF') : '#7B8ABF';
  const effectiveApi = resolvePersonaProviderBinding({
    globalApi: api,
    providers,
    persona: currentCollaborator,
    windowBinding: activeConversation?.windowPreferences?.modelBinding
  }).api;
  const effectiveAdvanced = activeConversation?.windowPreferences?.modelBinding?.providerId === effectiveApi.id && currentCollaborator ? { ...currentCollaborator.advanced, modelOverride: effectiveApi.model } : currentCollaborator?.advanced;
  const apiImagesEnabled = providerRuntimeSupportsImageInput(effectiveApi, effectiveAdvanced);
  const effectiveImageUnderstanding = resolveProviderImageUnderstandingSettings({
    api: effectiveApi
  });
  const imageUnderstandingApi = resolveImageUnderstandingProvider({
    settings: effectiveImageUnderstanding,
    providers,
    globalApi: effectiveApi
  });
  const imageUnderstandingEnabled = Boolean(
    imageUnderstandingApi && providerRuntimeSupportsImageInput(imageUnderstandingApi)
  );
  const showThinking = currentCollaborator?.advanced.showThinking ?? true;
  const streamingPresentation = useMemo(() => resolveChatStreamingPresentation({
    showThinking,
    sending,
    messages,
    streaming
  }), [messages, sending, showThinking, streaming]);
  const displayStreaming = streamingPresentation.displayStreaming;
  const showEmptyState = startupReady
    && !sending
    && messages.length === 0
    && !inputDraft.trim()
    && pendingAttachments.length === 0
    && !pendingCardReference
    && !activePreviewMessage;
  const hasUnsupportedPendingImages =
    pendingAttachments.some((attachment) => attachment.kind === 'image')
    && !apiImagesEnabled
    && !imageUnderstandingEnabled;
  const readCodeCardProjection = useMemo(
    () => createCodeCardProjectionReader(collectionCards),
    [collectionCards]
  );
  const showLiveThinking = streamingPresentation.showLiveThinking;
  const focusedMessageId = useMemo(
    () => focusedMessageTarget?.conversationId === activeConversationId ? focusedMessageTarget.messageId : null,
    [activeConversationId, focusedMessageTarget]
  );
  const latestRetryableAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant' && !message.toolInvocation)?.id ?? null,
    [messages]
  );
  const { codeCardActionModeByMessageId, codeCardProgressByMessageId } = useMemo(
    () => readCodeCardProjection(activeConversationId ?? '', messages),
    [activeConversationId, messages, readCodeCardProjection]
  );

  return {
    activeConversation,
    messages,
    persona: currentCollaborator,
    activeCollaboratorSourceId,
    activePreviewMessage,
    filteredConversations,
    personaColor: collaboratorColor,
    showThinking,
    displayStreaming,
    sending,
    showEmptyState,
    hasUnsupportedPendingImages,
    showLiveThinking,
    focusedMessageId,
    latestRetryableAssistantId,
    codeCardActionModeByMessageId,
    codeCardProgressByMessageId
  };
}

export type ChatDerivedState = ReturnType<typeof useChatDerived>;
