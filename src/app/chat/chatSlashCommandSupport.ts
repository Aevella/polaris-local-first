import { createUid } from '../../engines/id';
import type { ChatMessage } from '../../types/domain';
import type { ChatDerivedState } from './chatDerivedState';
import type { ChatStoreBindings } from './useChatStoreBindings';

export function latestAssistantMessage(messages: ChatMessage[]) {
  return messages.slice().reverse().find((message) => message.role === 'assistant') ?? null;
}

export function cloneMessageForFork(message: ChatMessage): ChatMessage {
  return {
    ...message,
    id: createUid(message.role)
  };
}

export function normalizeLookupText(value: string) {
  return value.trim().toLowerCase();
}

export function findLatestUserMessageIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function resolveOwnerCollaboratorId(args: {
  frontstageCollaboratorId: string | null;
  activeConversationCollaboratorId: string | null | undefined;
  activeCollaboratorId: string | null;
}) {
  return args.frontstageCollaboratorId
    ?? args.activeConversationCollaboratorId
    ?? args.activeCollaboratorId
    ?? undefined;
}

export function buildContextSummary(args: {
  store: ChatStoreBindings;
  derived: ChatDerivedState;
}) {
  const { store, derived } = args;
  const activeConversation = derived.activeConversation;
  const personaName = derived.persona?.name ?? activeConversation?.collaboratorId ?? '未选择';
  const activeProject = activeConversation?.activeProjectId
    ? store.collection.roomProjects.find((project) => project.id === activeConversation.activeProjectId) ?? null
    : null;
  const toolGroups = Object.entries(store.runtime.toolPromptPreferences)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ') || '无';
  const task = activeConversation ? store.chat.getConversationTask(activeConversation.id) : null;

  return [
    `人格：${personaName}`,
    `对话：${activeConversation?.title ?? '无'}`,
    `工作区：${activeProject?.title ?? '未绑定'}`,
    `工具组：${toolGroups}`,
    `任务：${task ? `${task.title} · ${task.status}` : (store.runtime.taskModeEnabled ? '任务模式开启，当前无任务' : '关闭')}`
  ].join('｜');
}

export function saveNoteCard(args: {
  store: ChatStoreBindings;
  derived: ChatDerivedState;
  content: string;
  title: string;
  language?: string;
  originMessage?: ChatMessage | null;
  tags: string[];
}) {
  const activeConversation = args.derived.activeConversation;
  const ownerCollaboratorId = resolveOwnerCollaboratorId({
    frontstageCollaboratorId: args.store.space.frontstageCollaboratorId,
    activeConversationCollaboratorId: activeConversation?.collaboratorId,
    activeCollaboratorId: args.store.persona.activeCollaboratorId
  });
  const cardId = args.store.collection.createCard({
    title: args.title,
    language: args.language ?? 'markdown',
    code: args.content,
    tags: args.tags,
    source: 'chat-generated',
    ownerCollaboratorId,
    originConversationId: activeConversation?.id,
    originMessageId: args.originMessage?.id,
    originBlockIndex: 0,
    originBlockTitle: args.title
  });
  args.store.space.setActiveCard(cardId);
  args.store.space.spotlightCard(cardId);
  args.store.space.setCollectionShelf('code');
  args.store.space.setWorld('collection');
  return cardId;
}
