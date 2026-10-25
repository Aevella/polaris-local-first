import { createConversationWindowSettings } from '../engines/conversationContextSettings';
import type { ConversationWindowDefaults } from '../types/domain';
import { createUid } from '../engines/id';
import type { Conversation } from '../types/domain';

function normalizeMemberIds(memberIds: string[]) {
  return Array.from(new Set(memberIds.map((memberId) => memberId.trim()).filter(Boolean)));
}

export function createDirectConversationRecord(args: {
  collaboratorId?: string | null;
  activeProjectId?: string | null;
  draft?: string;
  defaults?: ConversationWindowDefaults;
} = {}): Conversation {
  return {
    id: createUid('c'),
    title: '新对话',
    kind: 'direct',
    collaboratorId: args.collaboratorId ?? null,
    groupRoomId: null,
    activeProjectId: args.activeProjectId ?? null,
    toolLedger: undefined,
    draft: args.draft ?? '',
    ...createConversationWindowSettings(args.defaults),
    pinnedAt: null,
    updatedAt: Date.now(),
    messages: []
  };
}

export function createGroupConversationState(options: {
  title?: string;
  memberIds: string[];
  lineageId: string;
}): NonNullable<Conversation['group']> {
  const now = Date.now();
  return {
    title: options.title?.trim() || '新群聊',
    memberIds: normalizeMemberIds(options.memberIds),
    lineageId: options.lineageId,
    background: 'aurora',
    backgroundAssetId: null,
    backgroundVeil: 0.45,
    replyMode: 'round',
    allowMemberSilence: false,
    memoryRecallEnabled: true,
    toolSettings: {
      cards: false,
      images: false,
      attachments: false,
      web: false,
      mcp: false
    },
    privateLanes: {},
    createdAt: now,
    updatedAt: now
  };
}

export function createGroupConversationRecord(options: {
  title?: string;
  memberIds: string[];
  lineageId?: string;
}): Conversation {
  const id = createUid('g');
  const group = createGroupConversationState({
    ...options,
    lineageId: options.lineageId ?? id
  });

  return {
    id,
    title: group.title,
    kind: 'group',
    collaboratorId: null,
    group,
    groupRoomId: null,
    activeProjectId: null,
    toolLedger: undefined,
    draft: '',
    ...createConversationWindowSettings(),
    pinnedAt: null,
    updatedAt: group.updatedAt,
    messages: []
  };
}

export function updateGroupConversationRecord(
  conversation: Conversation,
  patch: Partial<NonNullable<Conversation['group']>>
): Conversation | null {
  if (!conversation.group || conversation.kind !== 'group') return null;
  const updatedAt = Date.now();
  const nextGroup = {
    ...conversation.group,
    ...patch,
    memberIds: patch.memberIds
      ? normalizeMemberIds(patch.memberIds)
      : conversation.group.memberIds,
    toolSettings: patch.toolSettings
      ? { ...conversation.group.toolSettings, ...patch.toolSettings }
      : conversation.group.toolSettings,
    updatedAt
  };

  return {
    ...conversation,
    title: patch.title ?? conversation.title,
    group: nextGroup,
    updatedAt
  };
}

export function updateGroupConversationInRecords(
  conversations: Conversation[],
  conversationId: string,
  patch: Partial<NonNullable<Conversation['group']>>
): Conversation[] | null {
  const target = conversations.find((conversation) => conversation.id === conversationId);
  if (!target) return null;
  const nextConversation = updateGroupConversationRecord(target, patch);
  if (!nextConversation) return null;
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? nextConversation
      : conversation
  );
}

export function touchConversationRecord(conversation: Conversation): Conversation {
  return {
    ...conversation,
    updatedAt: Date.now()
  };
}

export function touchConversationInRecords(
  conversations: Conversation[],
  conversationId: string
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? touchConversationRecord(conversation) : conversation
  );
}

export function renameConversationRecord(conversation: Conversation, title: string): Conversation {
  return {
    ...conversation,
    title,
    updatedAt: Date.now()
  };
}

export function renameConversationInRecords(
  conversations: Conversation[],
  conversationId: string,
  title: string
): Conversation[] | null {
  const nextTitle = title.trim();
  if (!nextTitle) return null;
  return conversations.map((conversation) =>
    conversation.id === conversationId ? renameConversationRecord(conversation, nextTitle) : conversation
  );
}

export function toggleConversationPinnedRecord(conversation: Conversation): Conversation {
  return {
    ...conversation,
    pinnedAt: conversation.pinnedAt ? null : Date.now()
  };
}

export function toggleConversationPinnedInRecords(
  conversations: Conversation[],
  conversationId: string
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId ? toggleConversationPinnedRecord(conversation) : conversation
  );
}

export function orphanConversationRecord(conversation: Conversation): Conversation {
  return {
    ...conversation,
    collaboratorId: null
  };
}

export function orphanConversationInRecords(
  conversations: Conversation[],
  conversationId: string
): Conversation[] {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? orphanConversationRecord(conversation)
      : conversation
  );
}
