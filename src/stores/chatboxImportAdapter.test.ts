import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  convertChatboxExportBlobToStructuredExportSnapshot,
  convertChatboxExportToStructuredExportSnapshot
} from './chatboxImportAdapter';

describe('convertChatboxExportToStructuredExportSnapshot', () => {
  it('converts chat-sessions-list exports with session records and threads', () => {
    const { snapshot, stats } = convertChatboxExportToStructuredExportSnapshot({
      __exported_items: ['conversations'],
      __exported_at: '2026-06-09T00:00:00.000Z',
      'chat-sessions-list': [
        { id: 'session-a', name: 'Main Session' }
      ],
      'session:session-a': {
        id: 'session-a',
        name: 'Main Session',
        type: 'chat',
        messages: [
          {
            id: 'm1',
            role: 'user',
            timestamp: 1000,
            contentParts: [{ type: 'text', text: 'hello' }]
          },
          {
            id: 'm2',
            role: 'assistant',
            timestamp: 2000,
            contentParts: [
              { type: 'text', text: 'hi there' },
              { type: 'image', storageKey: 'image-key' }
            ]
          }
        ],
        threads: [
          {
            id: 'thread-a',
            name: 'Old Branch',
            messages: [
              {
                id: 'tm1',
                role: 'user',
                contentParts: [{ type: 'text', text: 'branched question' }]
              }
            ]
          }
        ]
      }
    });

    expect(stats.sessions).toBe(1);
    expect(stats.conversations).toBe(2);
    expect(stats.messages).toBe(3);
    expect(stats.threadConversations).toBe(1);
    expect(stats.unsupportedParts).toBe(1);
    expect(snapshot.chatState?.conversations.map((conversation) => conversation.title).sort()).toEqual([
      'Main Session',
      'Main Session / Old Branch'
    ].sort());
    const mainConversation = snapshot.chatState?.conversations.find((conversation) => conversation.title === 'Main Session');
    expect(mainConversation?.messages[1]?.content).toContain('[Chatbox image: image-key]');
    expect(snapshot.personaState?.personas[0]?.id).toBe('chatbox-imported-assistant');
  });

  it('converts legacy chat-sessions exports with content fields', () => {
    const { snapshot, stats } = convertChatboxExportToStructuredExportSnapshot({
      'chat-sessions': [
        {
          id: 'legacy-session',
          messages: [
            {
              id: 'legacy-message',
              role: 'assistant',
              content: 'legacy text'
            }
          ]
        }
      ]
    });

    expect(stats.sessions).toBe(1);
    expect(stats.conversations).toBe(1);
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('legacy text');
  });

  it('skips picture sessions and empty messages', () => {
    const { stats } = convertChatboxExportToStructuredExportSnapshot({
      'chat-sessions': [
        {
          id: 'picture-session',
          type: 'picture',
          messages: [{ id: 'image', role: 'user', content: 'draw' }]
        },
        {
          id: 'empty-session',
          type: 'chat',
          messages: [{ id: 'empty', role: 'assistant', contentParts: [{ type: 'reasoning', text: 'hidden' }] }]
        }
      ]
    });

    expect(stats.sessions).toBe(0);
    expect(stats.skippedSessions).toBe(2);
    expect(stats.skippedMessages).toBe(1);
  });
});

describe('convertChatboxExportBlobToStructuredExportSnapshot', () => {
  it('finds chatbox json inside a zip', async () => {
    const zip = new JSZip();
    zip.file('chatbox-exported-data.json', JSON.stringify({
      'chat-sessions': [
        {
          id: 'zip-session',
          name: 'Zip Session',
          messages: [{ id: 'm1', role: 'user', content: 'from zip' }]
        }
      ]
    }));

    const blob = await zip.generateAsync({ type: 'blob' });
    const { snapshot } = await convertChatboxExportBlobToStructuredExportSnapshot(blob);

    expect(snapshot.chatState?.conversations[0]?.title).toBe('Zip Session');
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('from zip');
  });

  it('skips malformed and unrelated JSON entries when finding Chatbox data in a zip', async () => {
    const zip = new JSZip();
    zip.file('a-metadata.json', '{invalid metadata');
    zip.file('b-index.json', JSON.stringify([]));
    zip.file('conversations.json', JSON.stringify({
      'chat-sessions': [
        {
          id: 'synthetic-session',
          name: 'Synthetic Session',
          messages: [{ id: 'synthetic-message', role: 'user', content: 'synthetic text' }]
        }
      ]
    }));

    const blob = await zip.generateAsync({ type: 'blob' });
    const { snapshot } = await convertChatboxExportBlobToStructuredExportSnapshot(blob);

    expect(snapshot.chatState?.conversations[0]?.title).toBe('Synthetic Session');
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('synthetic text');
  });
});
