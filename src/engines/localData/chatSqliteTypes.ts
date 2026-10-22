import type { ChatMessage, Conversation } from '../../types/domain';
import type { LocalDataSqliteDriver } from './localDataSqliteBackend';

export type TypedChatSqliteConversationSummary = {
  id: string;
  title: string;
  kind: Conversation['kind'];
  collaboratorId: string | null;
  groupRoomId: string | null;
  activeProjectId: string | null;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  latestMessageTimestamp: number;
};

export type TypedChatSqliteConversationMetadata = Pick<
  Conversation,
  | 'id'
  | 'title'
  | 'kind'
  | 'collaboratorId'
  | 'group'
  | 'groupRoomId'
  | 'activeProjectId'
  | 'reasoningStrength'
  | 'requestContext'
  | 'windowPreferences'
  | 'workspaceLedger'
  | 'task'
  | 'draft'
  | 'pinnedAt'
  | 'updatedAt'
>;

export type TypedChatSqliteMessageWindow =
  | {
      status: 'missing';
      messages: [];
      expectedCount: 0;
      nextBeforeSeq: null;
    }
  | {
      status: 'loaded' | 'partial';
      messages: ChatMessage[];
      expectedCount: number;
      nextBeforeSeq: number | null;
    };

export type TypedChatSqliteStore = {
  initialize(): Promise<void>;
  writeConversations(conversations: Conversation[]): Promise<void>;
  readConversationSummaries(): Promise<TypedChatSqliteConversationSummary[]>;
  readConversationMetadata(conversationId: string): Promise<TypedChatSqliteConversationMetadata | null>;
  readMessageWindow(
    conversationId: string,
    options: { limit: number; beforeSeq?: number }
  ): Promise<TypedChatSqliteMessageWindow>;
};

export type TypedChatSqliteStoreOptions = {
  driver: LocalDataSqliteDriver;
};
