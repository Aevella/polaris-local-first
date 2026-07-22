import { describe, expect, it, vi } from 'vitest';
import {
  ChatReplyPersistenceError,
  persistChatReplyBoundary,
  resolveChatReplyPersistenceStatus
} from './chatReplyPersistence';

describe('persistChatReplyBoundary', () => {
  it('waits for the requested durable boundary', async () => {
    const persistToDb = vi.fn(async () => undefined);

    await persistChatReplyBoundary(persistToDb, 'before-request');

    expect(persistToDb).toHaveBeenCalledOnce();
  });

  it('preserves the failed phase for user-facing recovery', async () => {
    const cause = new Error('write failed');

    await expect(persistChatReplyBoundary(async () => {
      throw cause;
    }, 'after-reply')).rejects.toMatchObject({
      name: 'ChatReplyPersistenceError',
      phase: 'after-reply',
      causeError: cause
    } satisfies Partial<ChatReplyPersistenceError>);
  });
});

describe('resolveChatReplyPersistenceStatus', () => {
  it('distinguishes a blocked request from an unconfirmed final save', () => {
    expect(resolveChatReplyPersistenceStatus(
      new ChatReplyPersistenceError('before-request', new Error('failed'))
    )).toContain('没有请求模型');
    expect(resolveChatReplyPersistenceStatus(
      new ChatReplyPersistenceError('after-reply', new Error('failed'))
    )).toContain('回复已经显示');
  });
});
