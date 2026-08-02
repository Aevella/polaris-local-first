import { createContext, useContext } from 'react';
import type { CodeCardActionMode, CodeCardMessageProgress } from '../../../../app/chat/chatDerivedState';
import type { WorkspaceBannerState } from '../../../../engines/workspaceBannerState';
import type { ChatAttachment, ChatCardReference, ChatMessage, ChatMessageVoiceCache, CodeCard, Conversation, Persona, ThemeToolMode } from '../../../../types/domain';
import type { PolarisToolPromptGroup } from '../../../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ChatCommandStatus, ChatEditingState, ChatStreamingState, ChatSubmitFlightState } from './ChatUiState';
import type { ChatConversationBodyStatus } from '../../../../stores/chatConversationBodyStatus';

// Split map lives in CHAT_CONTEXT_SPLIT.md so future拆分 has a stable field-level boundary.
export type ChatContextPresentationValue = {
  assistantName: string;
  fallbackAssistantName: string;
  personaColor: string;
  conversationTitle: string | null;
  isActiveWorld: boolean;
  recentConversations: Conversation[];
  workspaceTitleById: Record<string, string>;
  activeConversationId: string | null;
  activeCollaboratorId: string | null;
  showChatAvatars: boolean;
  personas: Persona[];
  startupReady: boolean;
  interactionLocked: boolean;
  hasUnsupportedPendingImages: boolean;
  timelineDensity: 'light' | 'dense' | 'heavy';
  activeConversationBodyStatus: ChatConversationBodyStatus | null;
};

export type ChatContextComposerValue = {
  inputDraft: string;
  dragActive: boolean;
  pendingCardReference: ChatCardReference | null;
  availableCards: CodeCard[];
  workspaceBanner: WorkspaceBannerState;
  toolPromptPreferences: Record<PolarisToolPromptGroup, boolean>;
  taskModeEnabled: boolean;
  themeToolMode: ThemeToolMode;
  canReviveTheme: boolean;
};

export type ChatContextUiValue = {
  commandStatus: ChatCommandStatus;
  submitFlight: ChatSubmitFlightState;
  editing: ChatEditingState;
  streaming: ChatStreamingState;
  focusedMessageId: string | null;
  showThinking: boolean;
  showLiveThinking: boolean;
  showEmptyState: boolean;
  sending: boolean;
  collapsedThinkingMessageIds: string[];
  expandedCodeMessageIds: string[];
  latestRetryableAssistantId: string | null;
  activePreviewMessage: ChatMessage | null;
  thinkingSummaryMessageId: string | null;
  codeCardActionModeByMessageId: Record<string, CodeCardActionMode>;
  codeCardProgressByMessageId: Record<string, CodeCardMessageProgress>;
};

export type ChatContextAttachmentsValue = {
  pending: ChatAttachment[];
  add: (attachments: ChatAttachment[]) => void;
  remove: (attachmentId: string) => void;
  clear: () => void;
};

export type ChatContextActionsValue = {
  submit: () => Promise<void>;
  stopGeneration: () => void;
  retry: (message: ChatMessage) => Promise<void>;
  editMessage: (message: ChatMessage) => void;
  editAssistantMessage: (message: ChatMessage, content: string) => void;
  cacheAssistantSpeech: (message: ChatMessage, voiceCache: ChatMessageVoiceCache) => void;
  forkFromMessage: (message: ChatMessage) => void;
  updateEditingDraft: (value: string) => void;
  removeEditingAttachment: (attachmentId: string) => void;
  commitEdit: (message: ChatMessage) => Promise<void>;
  cancelEdit: () => void;
  toggleThinkingCollapsed: (messageId: string) => void;
  openThinkingSummary: (message: ChatMessage) => void;
  toggleCodeExpanded: (messageId: string) => void;
  applyToolPreview: (message: ChatMessage) => void;
  saveToolPreview: (message: ChatMessage) => void;
  rollbackToolPreview: (message: ChatMessage) => void;
  applyCustomCss: (css: string) => void;
  openCodeCard: (cardId: string) => void;
  saveImageAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  codeCardAction: (message: ChatMessage) => void;
  setInputDraft: (value: string) => void;
  setConversationDraft: (conversationId: string, value: string) => void;
  setPendingCardReference: (reference: ChatCardReference | null) => void;
  setDragActive: (value: boolean) => void;
  setCommandStatus: (text: string, isError?: boolean) => void;
  clearCommandStatus: () => void;
  setToolPromptGroupEnabled: (group: PolarisToolPromptGroup, enabled: boolean) => void;
  setTaskModeEnabled: (enabled: boolean) => void;
  setThemeToolMode: (mode: ThemeToolMode) => void;
  reviveTheme: () => void;
  restoreDefaultTheme: () => void;
  openToolbox: () => void;
  createConversation: () => void;
  openConversation: (conversationId: string) => void;
  acceptWorkspaceProposal: () => Promise<void>;
  rejectWorkspaceProposal: () => void;
  openActiveWorkspace: () => void;
  exitWorkspace: () => void;
  selectPersona: (collaboratorId: string) => void;
  deleteCollaborator: (collaboratorId: string) => void;
  closeThinkingSummary: () => void;
};

export type ChatContextValue = {
  conversation: Conversation | null;
  messages: ChatMessage[];
  persona: Persona | null;
  presentation: ChatContextPresentationValue;
  composer: ChatContextComposerValue;
  ui: ChatContextUiValue;
  attachments: ChatContextAttachmentsValue;
  actions: ChatContextActionsValue;
};

export type ChatContextStablePayloadValue = Pick<ChatContextValue, 'conversation' | 'messages' | 'persona'>;

const ChatStablePayloadContext = createContext<ChatContextStablePayloadValue | null>(null);
const ChatPresentationContext = createContext<ChatContextPresentationValue | null>(null);
const ChatComposerContext = createContext<ChatContextComposerValue | null>(null);
const ChatUiContext = createContext<ChatContextUiValue | null>(null);
const ChatAttachmentsContext = createContext<ChatContextAttachmentsValue | null>(null);
const ChatActionsContext = createContext<ChatContextActionsValue | null>(null);

export function ChatContextProvider({ value, children }: { value: ChatContextValue; children: React.ReactNode }) {
  return (
    <ChatStablePayloadContext.Provider
      value={{
        conversation: value.conversation,
        messages: value.messages,
        persona: value.persona
      }}
    >
      <ChatPresentationContext.Provider value={value.presentation}>
        <ChatComposerContext.Provider value={value.composer}>
          <ChatUiContext.Provider value={value.ui}>
            <ChatAttachmentsContext.Provider value={value.attachments}>
              <ChatActionsContext.Provider value={value.actions}>
                {children}
              </ChatActionsContext.Provider>
            </ChatAttachmentsContext.Provider>
          </ChatUiContext.Provider>
        </ChatComposerContext.Provider>
      </ChatPresentationContext.Provider>
    </ChatStablePayloadContext.Provider>
  );
}

function useRequiredContext<T>(value: T | null, name: string) {
  if (!value) {
    throw new Error(`${name} must be used inside ChatProvider`);
  }
  return value;
}

export function useChatStablePayload() {
  return useRequiredContext(useContext(ChatStablePayloadContext), 'useChatStablePayload');
}

export function useChatPresentation() {
  return useRequiredContext(useContext(ChatPresentationContext), 'useChatPresentation');
}

export function useChatComposer() {
  return useRequiredContext(useContext(ChatComposerContext), 'useChatComposer');
}

export function useChatUi() {
  return useRequiredContext(useContext(ChatUiContext), 'useChatUi');
}

export function useChatAttachments() {
  return useRequiredContext(useContext(ChatAttachmentsContext), 'useChatAttachments');
}

export function useChatActions() {
  return useRequiredContext(useContext(ChatActionsContext), 'useChatActions');
}
