import { normalizeForMatch } from '../../engines/stringMatch';
import type { ChatMessage, Conversation, Persona, RoomProject } from '../../types/domain';
import type { ChatConversationBodyStatus } from '../../stores/chatConversationBodyStatus';

function resolveConversationTitle(activeConversationTitle: string | null | undefined, messages: ChatMessage[]) {
  const latestUserSummary = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && !message.toolInvocation)?.content ?? '';
  const normalizedTitle = normalizeForMatch(activeConversationTitle ?? '', { stripPunctuation: true });
  const normalizedLatestUser = normalizeForMatch(latestUserSummary, { stripPunctuation: true });
  const shouldShowTitle =
    Boolean(normalizedTitle)
    && normalizedTitle !== '未命名对话'
    && normalizedTitle !== normalizedLatestUser;

  return shouldShowTitle ? activeConversationTitle ?? null : null;
}

function buildRecentConversations(conversations: Conversation[]) {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 8);
}

function buildWorkspaceTitleById(roomProjects: RoomProject[]) {
  return Object.fromEntries(roomProjects.map((project) => [project.id, project.title]));
}

export function buildChatPresentation(args: {
  activeConversation: Conversation | null;
  messages: ChatMessage[];
  conversations: Conversation[];
  roomProjects: RoomProject[];
  persona: Persona | null;
  activeCollaboratorId: string | null;
  showChatAvatars: boolean;
  personas: Persona[];
  startupReady: boolean;
  hasUnsupportedPendingImages: boolean;
  activeConversationBodyStatus: ChatConversationBodyStatus | null;
}) {
  const {
    activeConversation,
    messages,
    conversations,
    roomProjects,
    persona,
    activeCollaboratorId,
    showChatAvatars,
    personas,
    startupReady,
    hasUnsupportedPendingImages,
    activeConversationBodyStatus
  } = args;
  const timelineDensity: 'light' | 'dense' | 'heavy' =
    messages.length >= 42 ? 'heavy' : messages.length >= 22 ? 'dense' : 'light';
  const activeConversationId = activeConversation?.id ?? null;

  return {
    assistantName: persona?.name || '默认助手',
    fallbackAssistantName: persona?.name || 'Assistant',
    conversationTitle: resolveConversationTitle(activeConversation?.title, messages),
    recentConversations: buildRecentConversations(conversations),
    workspaceTitleById: buildWorkspaceTitleById(roomProjects),
    activeConversationId,
    activeCollaboratorId,
    showChatAvatars,
    personas,
    startupReady,
    interactionLocked: !startupReady || activeConversationBodyStatus?.state === 'failed' || activeConversationBodyStatus?.state === 'missing',
    activeConversationBodyStatus,
    hasUnsupportedPendingImages,
    timelineDensity
  };
}

export type ChatPresentation = ReturnType<typeof buildChatPresentation>;
