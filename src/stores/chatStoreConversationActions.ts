import { normalizeConversationWindowPreferences } from '../engines/conversationWindowSettings';
import { usePersonaStore } from './personaStore';
import { sortConversations } from './chatCurrentPersistence';
import {
  createBodyStatus,
  withConversationBodyStatus
} from './chatConversationBodyStatus';
import {
  activateConversation,
  updateActiveConversationDraft,
  updateConversationDraft
} from './chatConversationDrafts';
import {
  createDirectConversationRecord,
  createGroupConversationRecord,
  orphanConversationInRecords,
  renameConversationInRecords,
  toggleConversationPinnedInRecords,
  touchConversationInRecords,
  updateGroupConversationInRecords
} from './chatConversationRecords';
import {
  markChatIndexDirty,
  markConversationDirty
} from './chatPersistenceMarkers';
import { flushChatPersistenceIfHydrated } from './chatStoreFlush';
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chatStoreTypes';

type ChatConversationActions = Pick<
  ChatState,
  | 'setInputDraft'
  | 'setConversationDraft'
  | 'setActiveConversation'
  | 'createConversation'
  | 'createGroupConversation'
  | 'updateGroupConversation'
  | 'touchConversation'
  | 'renameConversation'
  | 'toggleConversationPinned'
  | 'orphanConversation'
  | 'setConversationWindowPreferences'
  | 'setConversationRequestContext'
  | 'setConversationReasoningStrength'
  | 'reassignCollaboratorConversations'
>;

export function createChatConversationActions(
  set: ChatStoreSet,
  get: ChatStoreGet
): ChatConversationActions {
  return {
  setConversationWindowPreferences: (conversationId, patch) => {
    set((state) => {
      const target = state.conversations.find(item => item.id === conversationId);
      if (!target) return state;
      const windowPreferences = { ...normalizeConversationWindowPreferences(target.windowPreferences), ...patch };
      if (JSON.stringify(windowPreferences) === JSON.stringify(target.windowPreferences)) return state;
      return {
        conversations: state.conversations.map(item => item.id === conversationId ? { ...item, windowPreferences } : item),
        ...markConversationDirty(state, conversationId)
      };
    });
    flushChatPersistenceIfHydrated(get, 'set-conversation-window-preferences-flush');
  },

  setConversationRequestContext: (conversationId, context) => {
    const requestContext = { ...context };
    set((state) => {
      const target = state.conversations.find((conversation) => conversation.id === conversationId);
      if (!target || JSON.stringify(target.requestContext) === JSON.stringify(requestContext)) return state;
      return {
        conversations: state.conversations.map((conversation) => conversation.id === conversationId
          ? { ...conversation, requestContext } : conversation),
        ...markConversationDirty(state, conversationId)
      };
    });
    flushChatPersistenceIfHydrated(get, 'set-conversation-request-context-flush');
  },

  setConversationReasoningStrength: (conversationId, reasoningStrength) => {
    set((state) => {
      const targetConversation = state.conversations.find((conversation) => conversation.id === conversationId);
      if (!targetConversation) return state;
      if ((targetConversation.reasoningStrength ?? 'automatic') === reasoningStrength) return state;

      return {
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, reasoningStrength }
            : conversation
        ),
        ...markConversationDirty(state, conversationId)
      };
    });
    flushChatPersistenceIfHydrated(get, 'set-conversation-reasoning-strength-flush');
  },

  reassignCollaboratorConversations: (sourceId, targetId) => {
    if (!sourceId.trim() || !targetId.trim() || sourceId === targetId) return [];
    const ids = get().conversations.filter(c => c.kind !== 'group' && c.collaboratorId === sourceId).map(c => c.id);
    if (!ids.length) return [];
    set(state => ({ conversations: state.conversations.map(c => ids.includes(c.id) ? { ...c, collaboratorId: targetId } : c),
      dirtyConversationIds: [...new Set([...state.dirtyConversationIds, ...ids])], conversationPersistVersion: state.conversationPersistVersion + 1 }));
    flushChatPersistenceIfHydrated(get, 'reassign-collaborator-conversations');
    return ids;
  },

    setInputDraft: (value) =>
      set((state) => {
        const result = updateActiveConversationDraft(state, value);
        if (!result) return state;
        return {
          ...result.patch,
          ...(result.dirtyConversationId ? markConversationDirty(state, result.dirtyConversationId) : {})
        };
      }),

    setConversationDraft: (conversationId, value) =>
      set((state) => {
        const result = updateConversationDraft(state, conversationId, value);
        if (!result) return state;
        return {
          ...result.patch,
          ...(result.dirtyConversationId ? markConversationDirty(state, result.dirtyConversationId) : {})
        };
      }),

    setActiveConversation: (id) => {
      set((state) => {
        const patch = activateConversation(state, id);
        if (!patch) return state;
        return {
          ...patch,
          ...markChatIndexDirty(state)
        };
      });
      void get().ensureConversationMessagesLoaded(id);
    },

    createConversation: (collaboratorId = null, options) => {
      const next = createDirectConversationRecord({
        collaboratorId,
        activeProjectId: options?.activeProjectId ?? null,
        draft: options?.draft,
        defaults: usePersonaStore.getState().personas.find(persona => persona.id === collaboratorId)?.conversationDefaults
      });
      set((state) => ({
        conversations: sortConversations([next, ...state.conversations]),
        activeConversationId: next.id,
        ...withConversationBodyStatus(state, next.id, createBodyStatus('loaded')),
        inputDraft: next.draft ?? '',
        ...markConversationDirty(state, next.id)
      }));
      flushChatPersistenceIfHydrated(get, 'create-conversation-flush');
      return next.id;
    },

    createGroupConversation: (options) => {
      const next = createGroupConversationRecord(options);
      set((state) => ({
        conversations: sortConversations([next, ...state.conversations]),
        activeConversationId: next.id,
        ...withConversationBodyStatus(state, next.id, createBodyStatus('loaded')),
        inputDraft: next.draft ?? '',
        ...markConversationDirty(state, next.id)
      }));
      flushChatPersistenceIfHydrated(get, 'create-group-conversation-flush');
      return next.id;
    },

    updateGroupConversation: (conversationId, patch) => {
      set((state) => {
        const conversations = updateGroupConversationInRecords(state.conversations, conversationId, patch);
        if (!conversations) return state;
        return {
          conversations: sortConversations(conversations),
          ...markConversationDirty(state, conversationId)
        };
      });
      flushChatPersistenceIfHydrated(get, 'update-group-conversation-flush');
    },

    touchConversation: (conversationId) => {
      set((state) => ({
        conversations: sortConversations(touchConversationInRecords(state.conversations, conversationId)),
        ...markConversationDirty(state, conversationId)
      }));
    },

    renameConversation: (conversationId, title) => {
      set((state) => {
        const conversations = renameConversationInRecords(state.conversations, conversationId, title);
        if (!conversations) return state;
        return {
          conversations: sortConversations(conversations),
          ...markConversationDirty(state, conversationId)
        };
      });
    },

    toggleConversationPinned: (conversationId) => {
      set((state) => ({
        conversations: sortConversations(toggleConversationPinnedInRecords(state.conversations, conversationId)),
        ...markConversationDirty(state, conversationId)
      }));
    },

    orphanConversation: (conversationId) => {
      set((state) => ({
        conversations: orphanConversationInRecords(state.conversations, conversationId),
        ...markConversationDirty(state, conversationId)
      }));
    }
  };
}
