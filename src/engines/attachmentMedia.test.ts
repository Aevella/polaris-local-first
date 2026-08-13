import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../types/domain';
import { isPlayableAudioAttachment } from './attachmentMedia';

function createAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: 'audio-1',
    assetId: 'asset-audio-1',
    kind: 'file',
    name: 'reply.mp3',
    mimeType: 'audio/mpeg',
    size: 204800,
    ...overrides
  };
}

describe('isPlayableAudioAttachment', () => {
  it('accepts audio file attachments without treating arbitrary files as media', () => {
    expect(isPlayableAudioAttachment(createAttachment())).toBe(true);
    expect(isPlayableAudioAttachment(createAttachment({ mimeType: 'application/pdf' }))).toBe(false);
    expect(isPlayableAudioAttachment(createAttachment({ kind: 'image', mimeType: 'audio/mpeg' }))).toBe(false);
  });
});
