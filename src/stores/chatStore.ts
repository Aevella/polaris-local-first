import { normalizeConversationWindowPreferences } from '../engines/conversationWindowSettings';
import { createConversationWindowSettings } from '../engines/conversationContextSettings';
import { usePersonaStore } from './personaStore';
import { create } from 'zustand';
import { sortConversations } from './chatCurrentPersistence';
import { scheduleHydratedSnapshotCommit } from './chatHydratedSnapshotCommit';
import { createChatConversationActions } from './chatStoreConversationActions';
import { createChatLifecycleActions } from './chatStoreLifecycleActions';
import { createChatMessageActions } from './chatStoreMessageActions';
import type { ChatState } from './chatStoreTypes';
import { createChatWorkspaceTaskActions } from './chatStoreWorkspaceTaskActions';

export type { ChatConversationBodyStatus, WritableConversationBody } from './chatConversationBodyStatus';
export type { WorkspaceScopeChangeEvent } from './chatWorkspaceFeedback';
export { scheduleHydratedSnapshotCommit } from './chatHydratedSnapshotCommit';

const INITIAL_CONVERSATIONS: ChatState['conversations'] = [];

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: sortConversations(INITIAL_CONVERSATIONS),
  activeConversationId: INITIAL_CONVERSATIONS[0]?.id ?? null,
  conversationBodyStatuses: {},
  loadedMessageConversationIds: [],
  loadingMessageConversationIds: [],
  inputDraft: '',
  pendingWorkspaceProposals: [],
  transientRuntimeFeedbackEventsByConversationId: {},
  workspaceScopeEventsByConversationId: {},
  dirtyConversationIds: [],
  deletedConversationIds: [],
  conversationPersistVersion: 0,
  hydrated: false,
  ...createChatConversationActions(set, get),
  ...createChatMessageActions(set, get),
  ...createChatWorkspaceTaskActions(set, get),
  ...createChatLifecycleActions(set, get)
}));
