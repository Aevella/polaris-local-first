import type { ChatAttachment } from '../types/domain';

export function isPlayableAudioAttachment(attachment: ChatAttachment) {
  return attachment.kind === 'file' && attachment.mimeType.trim().toLowerCase().startsWith('audio/');
}
