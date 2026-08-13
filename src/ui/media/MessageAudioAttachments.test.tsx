import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../../types/domain';
import { MessageAudioAttachments } from './MessageAudioAttachments';

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

describe('MessageAudioAttachments', () => {
  it('renders a durable audio result card with loading and download affordances', () => {
    const html = renderToStaticMarkup(createElement(MessageAudioAttachments, {
      attachments: [createAttachment()]
    }));

    expect(html).toContain('message-audio-card');
    expect(html).toContain('reply.mp3');
    expect(html).toContain('200 KB');
    expect(html).toContain('message-audio-download');
    expect(html).toContain('message-audio-loading');
  });

  it('shows a cleared state without a download action', () => {
    const html = renderToStaticMarkup(createElement(MessageAudioAttachments, {
      attachments: [createAttachment({ clearedAt: 5 })]
    }));

    expect(html).toContain('is-cleared');
    expect(html).not.toContain('message-audio-download');
  });

  it('renders nothing for non-audio attachments', () => {
    const html = renderToStaticMarkup(createElement(MessageAudioAttachments, {
      attachments: [createAttachment({ mimeType: 'text/plain' })]
    }));
    expect(html).toBe('');
  });
});
