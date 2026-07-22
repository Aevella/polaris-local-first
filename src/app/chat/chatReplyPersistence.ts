import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';

export type ChatReplyPersistencePhase = 'before-request' | 'after-reply';

export class ChatReplyPersistenceError extends Error {
  readonly phase: ChatReplyPersistencePhase;
  readonly causeError: unknown;

  constructor(phase: ChatReplyPersistencePhase, causeError: unknown) {
    super(
      phase === 'before-request'
        ? '本机没有确认保存当前消息，已停止本次模型请求。'
        : '模型回复已经完成，但本机没有确认保存最新对话。'
    );
    this.name = 'ChatReplyPersistenceError';
    this.phase = phase;
    this.causeError = causeError;
  }
}

export async function persistChatReplyBoundary(
  persistToDb: (() => Promise<void>) | undefined,
  phase: ChatReplyPersistencePhase
) {
  if (!persistToDb) return;

  try {
    await persistToDb();
  } catch (error) {
    reportPersistenceError({
      label: '[store:persist]',
      store: 'chat',
      operation: phase
    }, error);
    throw new ChatReplyPersistenceError(phase, error);
  }
}

export function resolveChatReplyPersistenceStatus(error: unknown) {
  if (!(error instanceof ChatReplyPersistenceError)) return null;
  return error.phase === 'before-request'
    ? '本机保存还没有完成，这次没有请求模型。消息仍留在当前界面，请先不要关闭 Polaris。'
    : '回复已经显示，但本机还没有确认保存最新对话。请先不要关闭 Polaris；应用会继续重试落盘。';
}
