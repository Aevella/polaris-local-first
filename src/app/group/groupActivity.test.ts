import { describe, expect, it } from 'vitest';
import {
  memberRunningActivityKey,
  messageGeneratedAudioAttachments,
  messageGeneratedImageAttachments,
  toolActivityKey
} from './groupActivity';
import type { ChatMessage, Conversation } from '../../types/domain';

function toolMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'tool-1',
    role: 'system',
    content: '',
    timestamp: 1,
    origin: 'tool-runtime',
    ...overrides
  } as ChatMessage;
}

function conversationWith(messages: ChatMessage[]): Conversation {
  return { id: 'group-1', kind: 'group', title: '群', messages } as unknown as Conversation;
}

describe('toolActivityKey', () => {
  it('maps memory search to recall', () => {
    expect(toolActivityKey('searchMemory')).toBe('group.activity.recall');
  });

  it('maps image generation to image', () => {
    expect(toolActivityKey('generateImage')).toBe('group.activity.image');
  });

  it('falls back to the generic tool label', () => {
    expect(toolActivityKey('somethingUnknown')).toBe('group.activity.tool');
    expect(toolActivityKey(undefined)).toBe('group.activity.tool');
  });
});

describe('memberRunningActivityKey', () => {
  it('returns the label of the running tool owned by the member', () => {
    const conversation = conversationWith([
      toolMessage({
        id: 'a',
        speakerCollaboratorId: 'm1',
        toolInvocation: { id: 'a', kind: 'generateImage', status: 'running', title: '', summary: '' } as ChatMessage['toolInvocation']
      })
    ]);
    expect(memberRunningActivityKey(conversation, 'm1')).toBe('group.activity.image');
  });

  it('ignores finished tools and other members', () => {
    const conversation = conversationWith([
      toolMessage({
        id: 'a',
        speakerCollaboratorId: 'm1',
        toolInvocation: { id: 'a', kind: 'generateImage', status: 'executed', title: '', summary: '' } as ChatMessage['toolInvocation']
      }),
      toolMessage({
        id: 'b',
        speakerCollaboratorId: 'm2',
        toolInvocation: { id: 'b', kind: 'webSearch', status: 'running', title: '', summary: '' } as ChatMessage['toolInvocation']
      })
    ]);
    expect(memberRunningActivityKey(conversation, 'm1')).toBeNull();
    expect(memberRunningActivityKey(conversation, 'm2')).toBe('group.activity.webSearch');
  });
});

describe('messageGeneratedImageAttachments', () => {
  const imageAttachment = { id: 'att-1', kind: 'image', assetId: 'asset-1', name: '图.png' } as NonNullable<ChatMessage['attachments']>[number];

  it('returns image attachments of a finished tool message', () => {
    const message = toolMessage({
      toolInvocation: { id: 't', kind: 'generateImage', status: 'executed', title: '', summary: '' } as ChatMessage['toolInvocation'],
      attachments: [imageAttachment]
    });
    expect(messageGeneratedImageAttachments(message)).toHaveLength(1);
  });

  it('returns nothing while the tool is still running or failed', () => {
    for (const status of ['running', 'failed'] as const) {
      const message = toolMessage({
        toolInvocation: { id: 't', kind: 'generateImage', status, title: '', summary: '' } as ChatMessage['toolInvocation'],
        attachments: [imageAttachment]
      });
      expect(messageGeneratedImageAttachments(message)).toHaveLength(0);
    }
  });

  it('skips cleared and non-image attachments', () => {
    const message = toolMessage({
      toolInvocation: { id: 't', kind: 'generateImage', status: 'executed', title: '', summary: '' } as ChatMessage['toolInvocation'],
      attachments: [
        { ...imageAttachment, clearedAt: 5 },
        { id: 'att-2', kind: 'file', assetId: 'asset-2', name: 'a.txt' } as NonNullable<ChatMessage['attachments']>[number]
      ]
    });
    expect(messageGeneratedImageAttachments(message)).toHaveLength(0);
  });
});

describe('messageGeneratedAudioAttachments', () => {
  const audioAttachment = {
    id: 'att-audio',
    kind: 'file',
    assetId: 'asset-audio',
    name: 'reply.mp3',
    mimeType: 'audio/mpeg'
  } as NonNullable<ChatMessage['attachments']>[number];

  it('returns playable audio from a finished tool message', () => {
    const message = toolMessage({
      toolInvocation: { id: 't', kind: 'invokeMcpTool', status: 'executed', title: '', summary: '' } as ChatMessage['toolInvocation'],
      attachments: [audioAttachment]
    });
    expect(messageGeneratedAudioAttachments(message)).toEqual([audioAttachment]);
  });

  it('skips unfinished, cleared, and non-audio attachments', () => {
    const running = toolMessage({
      toolInvocation: { id: 't', kind: 'invokeMcpTool', status: 'running', title: '', summary: '' } as ChatMessage['toolInvocation'],
      attachments: [audioAttachment]
    });
    const executed = toolMessage({
      toolInvocation: { id: 't', kind: 'invokeMcpTool', status: 'executed', title: '', summary: '' } as ChatMessage['toolInvocation'],
      attachments: [
        { ...audioAttachment, clearedAt: 5 },
        { ...audioAttachment, id: 'att-text', mimeType: 'text/plain' }
      ]
    });

    expect(messageGeneratedAudioAttachments(running)).toHaveLength(0);
    expect(messageGeneratedAudioAttachments(executed)).toHaveLength(0);
  });
});
