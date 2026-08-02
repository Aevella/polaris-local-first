import type { RuntimeFeedbackEvent } from '../engines/runtime-feedback/runtimeFeedbackEvents';
import type { PendingWorkspaceProposalRecord } from '../engines/workspaceBinding';
import type { Conversation } from '../types/domain';
import type { PersistedChatState } from './chatCurrentPersistence';
import type { ChatConversationBodyStatus } from './chatConversationBodyStatus';
import { hydrateConversationBodyStatuses } from './chatConversationBodyStatus';
import {
  filterRetiredGroupConversations,
  resolveHydratedActiveConversationId
} from './chatHydratedSnapshotCommit';
import {
  hydrateWorkspaceScopeEvents,
  type WorkspaceScopeChangeEvent
} from './chatWorkspaceFeedback';

export type ChatHydratedStorePatch = {
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
  hydrated: true;
};

export function projectHydratedChatStorePatch(
  payload: PersistedChatState | null | undefined
): ChatHydratedStorePatch {
  const lifecycleConversationIds = new Set(Object.keys(payload?.legacyLifecycleByConversationId ?? {}));
  const conversations = filterRetiredGroupConversations(payload?.conversations ?? [])
    .filter((conversation) => !lifecycleConversationIds.has(conversation.id));
  const conversationIds = new Set(conversations.map((conversation) => conversation.id));
  const activeConversationId = resolveHydratedActiveConversationId(
    payload?.activeConversationId ?? null,
    conversations,
    lifecycleConversationIds
  );
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const loadedConversationIds = (payload?.loadedConversationIds ?? []).filter((conversationId) =>
    conversationIds.has(conversationId)
  );
  const failedConversationIds = (payload?.failedConversationIds ?? []).filter((conversationId) =>
    conversationIds.has(conversationId)
  );

  return {
    conversations,
    activeConversationId,
    conversationBodyStatuses: hydrateConversationBodyStatuses(
      conversations,
      loadedConversationIds,
      failedConversationIds
    ),
    loadedMessageConversationIds: loadedConversationIds,
    loadingMessageConversationIds: [],
    inputDraft: activeConversation?.draft ?? '',
    pendingWorkspaceProposals: [],
    transientRuntimeFeedbackEventsByConversationId: {},
    workspaceScopeEventsByConversationId: hydrateWorkspaceScopeEvents(conversations),
    dirtyConversationIds: [],
    deletedConversationIds: [],
    conversationPersistVersion: 0,
    hydrated: true
  };
}
