import type { ChatAttachment, ChatCardReference, ChatMessage, Persona } from '../../types/domain';
import { createMessage } from '../../engines/chatMessageFactory';
import { ensureConversationSession } from './chatConversationSession';
import type { WritableConversationBody } from '../../stores/chatStore';
import {
  ensureChatSendPerformanceTrace,
  finishChatSendPerformanceTrace,
  recordChatSendPerformanceMark
} from './chatSendPerformanceTrace';
import { resolveChatReplyPersistenceStatus } from './chatReplyPersistence';

type SubmitMessageState = {
  inputDraft: string;
  pendingAttachments: ChatAttachment[];
  pendingCardReference: ChatCardReference | null;
  sending: boolean;
  hasUnsupportedPendingImages: boolean;
  conversations: {
    id: string;
    collaboratorId: string | null;
    activeProjectId?: string | null;
    messages: ChatMessage[];
  }[];
  activeConversationId: string | null;
  frontstageCollaboratorId: string | null;
  activeCollaboratorId: string | null;
  personas: Persona[];
};

type SubmitMessageHandlers = {
  createConversation: (
    collaboratorId?: string | null,
    options?: {
      activeProjectId?: string | null;
    }
  ) => string;
  ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
  addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
  setInputDraft: (value: string) => void;
  clearPendingAttachments: () => void;
  clearPendingCardReference: () => void;
  setCommandStatus: (value: string, isError?: boolean) => void;
  submitToolCommand: (rawInput: string) => Promise<boolean>;
  requestReply: (params: {
    conversationId: string;
    collaboratorId: string;
    messages: ChatMessage[];
  }) => Promise<unknown>;
  onUserMessageSubmitted?: (params: {
    conversationId: string;
    message: ChatMessage;
  }) => void;
};

export function buildSubmitFingerprint(
  inputDraft: string,
  pendingAttachments: ChatAttachment[],
  pendingCardReference: ChatCardReference | null
) {
  return [
    inputDraft.trim(),
    ...pendingAttachments.map((attachment) => `${attachment.kind}:${attachment.name}:${attachment.id}`),
    pendingCardReference ? `card:${pendingCardReference.id}:${pendingCardReference.mode}` : ''
  ].join('||');
}

export async function submitMessage(state: SubmitMessageState, handlers: SubmitMessageHandlers) {
  const trimmedDraft = state.inputDraft.trim();
  const escapedSlashCommand = trimmedDraft.startsWith('//');
  const raw = escapedSlashCommand ? trimmedDraft.slice(1) : trimmedDraft;
  if (
    (!raw && state.pendingAttachments.length === 0 && !state.pendingCardReference)
    || state.sending
    || state.hasUnsupportedPendingImages
  ) {
    if (state.activeConversationId) {
      finishChatSendPerformanceTrace(state.activeConversationId, 'aborted', {
        extra: ['submit ignored']
      });
    }
    return;
  }

  const consumedAsToolAction =
    raw && !escapedSlashCommand && state.pendingAttachments.length === 0
      ? await handlers.submitToolCommand(raw)
      : false;
  if (consumedAsToolAction) {
    handlers.setInputDraft('');
    handlers.clearPendingAttachments();
    handlers.clearPendingCardReference();
    if (state.activeConversationId) {
      finishChatSendPerformanceTrace(state.activeConversationId, 'completed', {
        extra: ['tool command']
      });
    }
    return;
  }

  const selectedCollaboratorId = state.frontstageCollaboratorId ?? state.activeCollaboratorId;
  const activeConversation = state.activeConversationId
    ? state.conversations.find((conversation) => conversation.id === state.activeConversationId) ?? null
    : null;
  const conversationForSelectedCollaborator =
    state.frontstageCollaboratorId
    && activeConversation?.collaboratorId !== state.frontstageCollaboratorId
      ? null
      : activeConversation;

  const conversationSession = ensureConversationSession(
    {
      activeConversation: conversationForSelectedCollaborator,
      activeCollaboratorId: selectedCollaboratorId,
      personas: state.personas
    },
    {
      createConversation: handlers.createConversation
    }
  );
  if (!conversationSession) {
    handlers.setCommandStatus('当前没有可用协作者，先新建一个协作者再继续聊天。', true);
    if (state.activeConversationId) {
      finishChatSendPerformanceTrace(state.activeConversationId, 'failed', {
        extra: ['no collaborator']
      });
    }
    return;
  }
  if (state.activeConversationId && state.activeConversationId !== conversationSession.conversationId) {
    finishChatSendPerformanceTrace(state.activeConversationId, 'aborted', {
      extra: ['conversation switched']
    });
  }
  ensureChatSendPerformanceTrace(conversationSession.conversationId, {
    conversationCount: state.conversations.length,
    messageCount: conversationSession.messages.length,
    attachmentCount: state.pendingAttachments.length,
    hasCardReference: Boolean(state.pendingCardReference)
  });
  let writableSession: WritableConversationBody | null = null;
  try {
    writableSession = await handlers.ensureConversationWritable(conversationSession.conversationId);
  } catch {
    handlers.setCommandStatus('读取当前对话历史失败，先别发送，避免用空历史继续。', true);
    finishChatSendPerformanceTrace(conversationSession.conversationId, 'failed', {
      extra: ['history load failed']
    });
    return;
  }
  if (!writableSession) {
    handlers.setCommandStatus('当前对话还没准备好，先别发送。', true);
    finishChatSendPerformanceTrace(conversationSession.conversationId, 'failed', {
      extra: ['conversation not writable']
    });
    return;
  }
  if (conversationForSelectedCollaborator?.collaboratorId === null) {
    handlers.setCommandStatus('原协作者已删除，已为当前协作者新开对话继续聊天。');
  }
  const userMessage = createMessage(
    'user',
    raw,
    state.pendingAttachments.length ? state.pendingAttachments : undefined,
    'user-input',
    undefined,
    state.pendingCardReference
  );
  const nextMessages = [...writableSession.messages, userMessage];

  handlers.addMessage(writableSession, userMessage);
  handlers.setInputDraft('');
  handlers.clearPendingAttachments();
  handlers.clearPendingCardReference();
  handlers.onUserMessageSubmitted?.({
    conversationId: writableSession.conversationId,
    message: userMessage
  });
  recordChatSendPerformanceMark(writableSession.conversationId, '聊天发送 · 用户消息已入列', {
    messageCount: nextMessages.length,
    attachmentCount: userMessage.attachments?.length ?? 0,
    hasCardReference: Boolean(userMessage.cardReference)
  });

  try {
    await handlers.requestReply({
      conversationId: writableSession.conversationId,
      collaboratorId: conversationSession.collaboratorId,
      messages: nextMessages
    });
  } catch (error) {
    const persistenceStatus = resolveChatReplyPersistenceStatus(error);
    if (!persistenceStatus) throw error;
    handlers.setCommandStatus(persistenceStatus, true);
    finishChatSendPerformanceTrace(writableSession.conversationId, 'failed', {
      extra: ['persistence boundary failed']
    });
  }
}
