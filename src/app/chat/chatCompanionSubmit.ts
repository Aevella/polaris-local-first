import { createMessage } from '../../engines/chatMessageFactory';
import { sendCompanionClientCommand } from '../../engines/companionApi';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import type { ChatAttachment, ChatCardReference, ChatMessage, PolarisCompanionConnection } from '../../types/domain';
import type { WritableConversationBody } from '../../stores/chatStore';

type SubmitCompanionMessageState = {
  inputDraft: string;
  pendingAttachments: ChatAttachment[];
  pendingCardReference: ChatCardReference | null;
  activeConversation: {
    id: string;
    collaboratorId: string | null;
    messages: ChatMessage[];
  } | null;
};

type SubmitCompanionMessageHandlers = {
  ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
  addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
  setInputDraft: (value: string) => void;
  clearPendingAttachments: () => void;
  clearPendingCardReference: () => void;
  setCommandStatus: (value: string, isError?: boolean) => void;
  persistToDb?: () => Promise<void>;
  onUserMessageSubmitted?: (params: {
    conversationId: string;
    message: ChatMessage;
  }) => void;
};

export async function submitCompanionMessage(
  state: SubmitCompanionMessageState,
  handlers: SubmitCompanionMessageHandlers,
  connection: PolarisCompanionConnection
) {
  const raw = state.inputDraft.trim();
  if (!raw) return;
  if (state.pendingAttachments.length > 0 || state.pendingCardReference) {
    handlers.setCommandStatus('电脑端 companion 第一版先只收纯文本。', true);
    return;
  }
  if (!state.activeConversation) {
    handlers.setCommandStatus('这条 companion 对话还没准备好。', true);
    return;
  }

  const optimisticMessage = createMessage('user', raw, undefined, 'user-input');
  let writableSession: WritableConversationBody | null = null;
  try {
    writableSession = await handlers.ensureConversationWritable(state.activeConversation.id);
  } catch {
    handlers.setCommandStatus('读取当前对话历史失败，先别发送，避免用空历史继续。', true);
    return;
  }
  if (!writableSession) {
    handlers.setCommandStatus('这条 companion 对话还没准备好。', true);
    return;
  }
  handlers.addMessage(writableSession, optimisticMessage);
  handlers.setInputDraft('');
  handlers.clearPendingAttachments();
  handlers.clearPendingCardReference();
  handlers.onUserMessageSubmitted?.({
    conversationId: writableSession.conversationId,
    message: optimisticMessage
  });

  try {
    await handlers.persistToDb?.();
  } catch (error) {
    reportPersistenceError({
      label: '[store:persist]',
      store: 'chat',
      operation: 'before-companion-send'
    }, error);
    handlers.setCommandStatus('本机保存还没有完成，这次没有发送到电脑端。消息仍留在当前界面，请先不要关闭 Polaris。', true);
    return;
  }

  await sendCompanionClientCommand({
    relayUrl: connection.relayUrl,
    hostId: connection.hostId,
    clientId: connection.clientId,
    clientSecret: connection.clientSecret,
    text: raw
  });
  handlers.setCommandStatus('已经送到电脑端了。');
}
