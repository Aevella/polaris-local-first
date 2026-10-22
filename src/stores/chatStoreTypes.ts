import type { StateCreator } from 'zustand';
import type { RuntimeFeedbackEvent } from '../engines/runtime-feedback/runtimeFeedbackEvents';
import type { PendingWorkspaceProposalRecord } from '../engines/workspaceBinding';
import type {
  ChatMessage,
  Conversation,
  ConversationTaskMode,
  ConversationTaskState
} from '../types/domain';
import type {
  ChatConversationBodyStatus,
  WritableConversationBody
} from './chatConversationBodyStatus';
import type { WorkspaceScopeChangeEvent } from './chatWorkspaceFeedback';

export type ChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
  conversationBodyStatuses: Record<string, ChatConversationBodyStatus>;
  loadedMessageConversationIds: string[];
  loadingMessageConversationIds: string[];
  inputDraft: string;
  pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
  transientRuntimeFeedbackEventsByConversationId: Record<string, RuntimeFeedbackEvent[]>;
  workspaceScopeEventsByConversationId: Record<string, WorkspaceScopeChangeEvent[]>;
  dirtyConversationIds: string[];
  deletedConversationIds: string[];
  conversationPersistVersion: number;
  hydrated: boolean;
  setInputDraft: (value: string) => void;
  setConversationDraft: (conversationId: string, value: string) => void;
  setActiveConversation: (id: string) => void;
  createConversation: (
    collaboratorId?: string | null,
    options?: {
      activeProjectId?: string | null;
      draft?: string;
    }
  ) => string;
  createGroupConversation: (options: {
    title?: string;
    memberIds: string[];
    lineageId?: string;
  }) => string;
  updateGroupConversation: (
    conversationId: string,
    patch: Partial<NonNullable<Conversation['group']>>
  ) => void;
  addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
  insertMessageBefore: (target: WritableConversationBody, beforeMessageId: string, message: ChatMessage) => void;
  insertMessageAfter: (target: WritableConversationBody, afterMessageId: string, message: ChatMessage) => void;
  updateMessage: (target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) => void;
  replaceConversationMessages: (target: WritableConversationBody, messages: ChatMessage[]) => void;
  setConversationWindowPreferences: (id: string, patch: Partial<NonNullable<Conversation['windowPreferences']>>) => void;
  setConversationRequestContext: (id: string, context: NonNullable<Conversation['requestContext']>) => void;
  setConversationReasoningStrength: (id: string, strength: NonNullable<Conversation['reasoningStrength']>) => void;
  reassignCollaboratorConversations: (sourceId: string, targetId: string) => string[];
  setConversationActiveProject: (conversationId: string, projectId: string | null) => void;
  reconcileConversationWorkspaceBindings: (validProjectIds: string[]) => void;
  upsertPendingWorkspaceProposal: (proposal: PendingWorkspaceProposalRecord) => void;
  removePendingWorkspaceProposal: (proposalId: string) => void;
  appendRuntimeFeedbackEvent: (conversationId: string, event: RuntimeFeedbackEvent) => void;
  getRuntimeFeedbackEvents: (conversationId: string) => RuntimeFeedbackEvent[];
  getWorkspaceScopeEvents: (conversationId: string) => WorkspaceScopeChangeEvent[];
  getConversationTask: (conversationId: string) => ConversationTaskState | null;
  ensureConversationTask: (
    conversationId: string,
    messages: ChatMessage[],
    options?: { mode?: ConversationTaskMode }
  ) => ConversationTaskState | null;
  setConversationTask: (conversationId: string, task: ConversationTaskState | null) => void;
  touchConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => void;
  toggleConversationPinned: (conversationId: string) => void;
  orphanConversation: (conversationId: string) => void;
  clearConversationAttachmentsByAssetIds: (assetIds: string[], clearedAt?: number) => void;
  deleteConversation: (conversationId: string) => void;
  getConversationWritable: (conversationId: string) => WritableConversationBody | null;
  ensureConversationMessagesLoaded: (conversationId: string) => Promise<Conversation | null>;
  ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
  ensureFullConversationBodiesLoaded: () => Promise<Conversation[]>;
  hydrateFromDb: () => Promise<void>;
  persistToDb: () => Promise<void>;
};

export type ChatStoreSet = Parameters<StateCreator<ChatState>>[0];
export type ChatStoreGet = Parameters<StateCreator<ChatState>>[1];
