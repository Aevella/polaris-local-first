import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/domain';
import type {
  TypedChatSqliteConversationMetadata,
  TypedChatSqliteConversationSummary,
  TypedChatSqliteMessageWindow,
  TypedChatSqliteStore
} from '../engines/localData';
import { readChatStateFromTypedChatSqliteStore } from './chatTypedSqlitePersistence';

function message(id: string, timestamp: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: id,
    timestamp
  };
}

function summary(id: string, messages: ChatMessage[]): TypedChatSqliteConversationSummary {
  return {
    id,
    title: id,
    kind: 'direct',
    collaboratorId: 'pharos',
    groupRoomId: null,
    activeProjectId: 'project-1',
    pinnedAt: null,
    createdAt: 10,
    updatedAt: Math.max(0, ...messages.map((item) => item.timestamp), 10),
    messageCount: messages.length,
    latestMessageTimestamp: Math.max(0, ...messages.map((item) => item.timestamp))
  };
}

function metadata(id: string): TypedChatSqliteConversationMetadata {
  return {
    id,
    title: id,
    kind: 'direct',
    collaboratorId: 'pharos',
    activeProjectId: 'project-1',
    task: {
      id: 'task-1',
      sourceMessageId: 'm-1',
      goal: 'hydrate typed sqlite',
      title: 'Typed SQLite',
      status: 'running',
      stage: 'proof',
      steps: [],
      executions: [],
      createdAt: 10,
      updatedAt: 20
    },
    draft: 'draft survives',
    reasoningStrength: 'high',
    requestContext: { mode: 'fromMessage', anchorMessageId: 'm-1' },
    windowPreferences: { modelBinding: { providerId: 'provider-x', model: 'model-x' }, historicalImagePolicy: 'smart', composerReturnKeyBehavior: 'newline', mcpScope: { mode: 'inherit' } },
    workspaceLedger: [{
      id: 'ledger-1',
      kind: 'workspace_scope_changed',
      createdAt: 12,
      change: 'entered',
      previousProjectId: null,
      nextProjectId: 'project-1',
      summary: 'Entered project'
    }],
    pinnedAt: null,
    updatedAt: 30
  };
}

function createStore(args: {
  summaries: TypedChatSqliteConversationSummary[];
  metadataById?: Record<string, TypedChatSqliteConversationMetadata | null>;
  windowById?: Record<string, TypedChatSqliteMessageWindow>;
}): Pick<
  TypedChatSqliteStore,
  'readConversationSummaries' | 'readConversationMetadata' | 'readMessageWindow'
> {
  return {
    async readConversationSummaries() {
      return args.summaries;
    },

    async readConversationMetadata(conversationId) {
      return args.metadataById?.[conversationId] ?? null;
    },

    async readMessageWindow(conversationId) {
      const window = args.windowById?.[conversationId];
      if (!window) {
        return {
          status: 'missing',
          messages: [],
          expectedCount: 0,
          nextBeforeSeq: null
        };
      }
      return window;
    }
  };
}

describe('readChatStateFromTypedChatSqliteStore', () => {
  it('hydrates complete typed SQLite chat rows into persisted chat state', async () => {
    const messages = [message('m-1', 10), message('m-2', 20)];

    await expect(readChatStateFromTypedChatSqliteStore({
      store: createStore({
        summaries: [summary('c-1', messages)],
        metadataById: { 'c-1': metadata('c-1') },
        windowById: {
          'c-1': {
            status: 'loaded',
            messages,
            expectedCount: 2,
            nextBeforeSeq: null
          }
        }
      }),
      activeConversationId: 'c-1',
      version: 3,
      committedAt: 30,
      readAt: 40,
      messageWindowLimit: 50
    })).resolves.toEqual(expect.objectContaining({
      activeConversationId: 'c-1',
      loadedConversationIds: ['c-1'],
      quarantinedConversationIds: [],
      deletedConversationIds: [],
      conversations: [
        expect.objectContaining({
          id: 'c-1',
          messages,
          draft: 'draft survives',
    reasoningStrength: 'high',
    requestContext: { mode: 'fromMessage', anchorMessageId: 'm-1' },
    windowPreferences: { modelBinding: { providerId: 'provider-x', model: 'model-x' }, historicalImagePolicy: 'smart', composerReturnKeyBehavior: 'newline', mcpScope: { mode: 'inherit' } },
          task: expect.objectContaining({ id: 'task-1' }),
          workspaceLedger: [expect.objectContaining({ id: 'ledger-1' })]
        })
      ]
    }));
  });

  it('keeps partial typed SQLite bodies out of active chat state', async () => {
    const messages = [message('m-1', 10), message('m-2', 20), message('m-3', 30)];

    await expect(readChatStateFromTypedChatSqliteStore({
      store: createStore({
        summaries: [summary('c-partial', messages)],
        metadataById: { 'c-partial': metadata('c-partial') },
        windowById: {
          'c-partial': {
            status: 'partial',
            messages: messages.slice(1),
            expectedCount: 3,
            nextBeforeSeq: 1
          }
        }
      }),
      activeConversationId: 'c-partial',
      version: 3,
      committedAt: 30,
      readAt: 40,
      messageWindowLimit: 2
    })).resolves.toEqual(expect.objectContaining({
      conversations: [],
      activeConversationId: null,
      loadedConversationIds: [],
      quarantinedConversationIds: ['c-partial'],
      deletedConversationIds: []
    }));
  });

  it('returns null for an explicitly empty typed SQLite source', async () => {
    await expect(readChatStateFromTypedChatSqliteStore({
      store: createStore({ summaries: [] }),
      activeConversationId: null,
      version: 3,
      committedAt: 30,
      readAt: 40,
      messageWindowLimit: 50
    })).resolves.toBeNull();
  });
});
