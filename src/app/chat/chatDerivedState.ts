import { useMemo } from 'react';
import { extractCodeBlocksFromMessage } from '../../engines/codeCardEngine';
import { resolveConversationCollaboratorName } from '../../engines/conversationOwnership';
import {
  resolveImageUnderstandingProvider,
  resolveProviderImageUnderstandingSettings
} from '../../engines/imageUnderstandingClient';
import { isProductGuidePersona } from '../../engines/personaBuiltin';
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
import { isThemeCssCodeBlock, readMessageCodeBlocks, hasThemeCssProjectionToolCall } from './chatCodeBlockSemantics';
import { resolveContinuationCodeBlockState } from './chatMessageCardReference';

export type CodeCardActionMode = 'hidden' | 'save' | 'open';
export type CodeCardMessageProgress = {
  saved: number;
  total: number;
};

type SavedCodeCardIndex = {
  cardsById: ReadonlyMap<string, CodeCard>;
  chatGeneratedCodes: ReadonlySet<string>;
  exactOriginMatchesByMessageKey: ReadonlyMap<string, ReadonlySet<number>>;
};

function buildMessageOriginKey(conversationId: string, messageId: string) {
  return `${conversationId}\n${messageId}`;
}

function buildSavedCodeCardIndex(collectionCards: CodeCard[]): SavedCodeCardIndex {
  const cardsById = new Map<string, CodeCard>();
  const chatGeneratedCodes = new Set<string>();
  const exactOriginMatchesByMessageKey = new Map<string, Set<number>>();

  collectionCards.forEach((card) => {
    cardsById.set(card.id, card);

    const code = card.code.trim();
    if (card.source === 'chat-generated' && code) {
      chatGeneratedCodes.add(code);
    }

    if (!card.originConversationId || !card.originMessageId) return;
    const key = buildMessageOriginKey(card.originConversationId, card.originMessageId);
    const blockIndexes = exactOriginMatchesByMessageKey.get(key) ?? new Set<number>();
    blockIndexes.add(card.originBlockIndex ?? 0);
    exactOriginMatchesByMessageKey.set(key, blockIndexes);
  });

  return {
    cardsById,
    chatGeneratedCodes,
    exactOriginMatchesByMessageKey
  };
}

function isCodeBlockSaved(
  savedCodeCardIndex: SavedCodeCardIndex,
  conversationId: string,
  messageId: string,
  candidate: ReturnType<typeof extractCodeBlocksFromMessage>[number]
) {
  const blockIndexes = savedCodeCardIndex.exactOriginMatchesByMessageKey.get(buildMessageOriginKey(conversationId, messageId));
  return Boolean(blockIndexes?.has(candidate.blockIndex)) || savedCodeCardIndex.chatGeneratedCodes.has(candidate.code.trim());
}

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
    persona: currentCollaborator
  }).api;
  const apiImagesEnabled = providerRuntimeSupportsImageInput(effectiveApi, currentCollaborator?.advanced);
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
  const showThinking = isProductGuidePersona(currentCollaborator)
    ? false
    : currentCollaborator?.advanced.showThinking ?? true;
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
  const savedCodeCardIndex = useMemo(
    () => buildSavedCodeCardIndex(collectionCards),
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
  const { codeCardActionModeByMessageId, codeCardProgressByMessageId } = useMemo(() => {
    const modes: Record<string, CodeCardActionMode> = {};
    const progress: Record<string, CodeCardMessageProgress> = {};
    if (!activeConversation) return { codeCardActionModeByMessageId: modes, codeCardProgressByMessageId: progress };

    for (const message of messages) {
      if (message.role !== 'assistant' || message.toolInvocation) continue;
      const codeBlocks = readMessageCodeBlocks(message);
      if (codeBlocks.length === 0) continue;
      const hidden = codeBlocks.every(isThemeCssCodeBlock) && hasThemeCssProjectionToolCall(message.nativeToolCalls);
      const continuation = resolveContinuationCodeBlockState({
        messages,
        assistantMessageId: message.id,
        cards: collectionCards,
        cardsById: savedCodeCardIndex.cardsById,
        codeBlocks
      });
      const saved = continuation
        ? Number(continuation.isSynced)
        : codeBlocks.filter(candidate => isCodeBlockSaved(savedCodeCardIndex, activeConversation.id, message.id, candidate)).length;
      const total = continuation ? 1 : codeBlocks.length;
      modes[message.id] = hidden ? 'hidden' : saved === total ? 'open' : 'save';
      progress[message.id] = { saved, total };
    }
    return { codeCardActionModeByMessageId: modes, codeCardProgressByMessageId: progress };
  }, [activeConversation, collectionCards, messages, savedCodeCardIndex]);

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
