import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  convertChatboxExportToStructuredExportSnapshot
} from './chatboxImportAdapter';
import {
  convertChatboxExportBlobToStructuredExportSnapshot,
  isChatboxImportSource
} from './chatboxImportSource';

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

  it('skips picture sessions while preserving reasoning-only messages', () => {
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

    expect(stats.sessions).toBe(1);
    expect(stats.skippedSessions).toBe(1);
    expect(stats.skippedMessages).toBe(0);
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
    await expect(isChatboxImportSource(blob)).resolves.toBe(true);
    const { snapshot } = await convertChatboxExportBlobToStructuredExportSnapshot(blob);

    expect(snapshot.chatState?.conversations[0]?.title).toBe('Zip Session');
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('from zip');
  });

  it('imports current Chatbox v2 archives with verified resources', async () => {
    const zip = new JSZip();
    const session = {
      id: 'session-v2',
      name: 'Current backup',
      messages: [
        {
          id: 'm1',
          role: 'user',
          contentParts: [{ type: 'text', text: 'read this' }],
          files: [{
            name: 'notes.txt',
            fileType: 'text/plain',
            storageKey: 'parsed:key',
            rawStorageKey: 'raw:key'
          }]
        },
        {
          id: 'm2',
          role: 'assistant',
          contentParts: [
            { type: 'reasoning', text: 'private reasoning' },
            { type: 'text', text: 'done' },
            { type: 'image', storageKey: 'image:key' }
          ]
        }
      ],
      messageForksHash: {
        m1: {
          position: 0,
          lists: [
            { id: 'active', messages: [] },
            {
              id: 'alternative',
              messages: [{
                id: 'm-alt',
                role: 'assistant',
                contentParts: [{ type: 'text', text: 'alternate answer' }]
              }]
            }
          ],
          createdAt: 5
        }
      }
    };
    const sessionBytes = new TextEncoder().encode(JSON.stringify(session));
    const rawBytes = new TextEncoder().encode('raw attachment');
    const parsedBytes = new TextEncoder().encode('parsed attachment');
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const checksum = async (bytes: Uint8Array) => Array.from(
      new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))
    ).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const entry = async (path: string, bytes: Uint8Array) => ({
      path,
      size: bytes.length,
      checksum: { algorithm: 'sha256', value: await checksum(bytes) }
    });
    const sessionPath = 'sessions/session-v2/session.json';
    const rawPath = 'sessions/session-v2/resources/resource-raw.txt';
    const parsedPath = 'sessions/session-v2/resources/resource-parsed.txt';
    const imagePath = 'sessions/session-v2/resources/resource-image.png';
    zip.file(sessionPath, sessionBytes);
    zip.file(rawPath, rawBytes);
    zip.file(parsedPath, parsedBytes);
    zip.file(imagePath, imageBytes);
    zip.file('manifest.json', JSON.stringify({
      format: 'chatbox-backup',
      formatVersion: 2,
      exportedAt: '2026-08-10T00:00:00.000Z',
      application: { name: 'Chatbox', version: '1.15.0', platform: 'darwin' },
      exportItems: ['conversations'],
      data: {},
      sessions: [{
        id: session.id,
        meta: { id: session.id, name: session.name },
        resourceIds: ['resource-raw', 'resource-parsed', 'resource-image'],
        ...(await entry(sessionPath, sessionBytes))
      }],
      resources: [
        {
          id: 'resource-raw',
          originalStorageKeys: ['raw:key'],
          sessionIds: [session.id],
          scope: 'session',
          encoding: 'utf8',
          mimeType: 'text/plain',
          kind: 'raw-attachment',
          filename: 'notes.txt',
          ...(await entry(rawPath, rawBytes))
        },
        {
          id: 'resource-parsed',
          originalStorageKeys: ['parsed:key'],
          sessionIds: [session.id],
          scope: 'session',
          encoding: 'utf8',
          mimeType: 'text/plain',
          kind: 'parsed-attachment',
          filename: 'notes.txt',
          ...(await entry(parsedPath, parsedBytes))
        },
        {
          id: 'resource-image',
          originalStorageKeys: ['image:key'],
          sessionIds: [session.id],
          scope: 'session',
          encoding: 'data-url-base64',
          mimeType: 'image/png',
          kind: 'image',
          ...(await entry(imagePath, imageBytes))
        }
      ],
      warnings: [],
      stats: { sessionCount: 1, resourceCount: 3, deduplicatedResourceCount: 0, warningCount: 0 }
    }));

    const blob = await zip.generateAsync({ type: 'blob' });
    const { snapshot, stats, archiveEntryCount } = await convertChatboxExportBlobToStructuredExportSnapshot(blob);
    const main = snapshot.chatState?.conversations.find((conversation) => conversation.title === 'Current backup');
    const branch = snapshot.chatState?.conversations.find((conversation) => conversation.title === 'Current backup / 分支 1');
    const messages = main?.messages ?? [];

    expect(archiveEntryCount).toBe(5);
    expect(stats).toMatchObject({
      sessions: 1,
      conversations: 2,
      messages: 4,
      forkConversations: 1,
      skippedBranches: 0,
      skippedSourceAssets: 0
    });
    expect(branch?.messages.map((message) => message.content)).toEqual(['read this', 'alternate answer']);
    expect(messages[0]?.attachments).toEqual([
      expect.objectContaining({ kind: 'file', name: 'notes.txt', mimeType: 'text/plain' })
    ]);
    expect(messages[1]?.thinkingText).toBe('private reasoning');
    expect(messages[1]?.attachments).toEqual([
      expect.objectContaining({ kind: 'image', mimeType: 'image/png' })
    ]);
    expect((snapshot.chatState?.conversations ?? []).flatMap((conversation) => conversation.messages)
      .flatMap((message) => message.attachments ?? []).every((attachment) => (
      snapshot.assetEntries?.some((asset) => asset.meta.id === attachment.assetId)
    ))).toBe(true);
  });

  it('does not misclassify a Polaris structured package as Chatbox', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'polaris-export', version: 1 }));
    zip.file('stores/chat.json', JSON.stringify({
      'chat-sessions': [{ id: 'not-a-chatbox-container', messages: [] }]
    }));

    await expect(isChatboxImportSource(await zip.generateAsync({ type: 'blob' }))).resolves.toBe(false);
  });
});

 describe('legacy ZIP candidate regression coverage', () => {
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

  it('prefers session data over earlier export metadata', async () => {
    const zip = new JSZip();
    zip.file('a-metadata.json', JSON.stringify({ __exported_at: '2026-10-22' }));
    zip.file('b-conversations.json', JSON.stringify({
      'chat-sessions': [{ id: 's', messages: [{ role: 'user', content: 'found' }] }]
    }));
    const { snapshot } = await convertChatboxExportBlobToStructuredExportSnapshot(
      await zip.generateAsync({ type: 'blob' })
    );
    expect(snapshot.chatState?.conversations[0]?.messages[0]?.content).toBe('found');
  });

  it('preserves metadata-only exports when no session payload exists', async () => {
    const zip = new JSZip();
    zip.file('metadata.json', JSON.stringify({ __exported_items: [] }));
    zip.file('bad.json', '{invalid');
    const { stats } = await convertChatboxExportBlobToStructuredExportSnapshot(
      await zip.generateAsync({ type: 'blob' })
    );
    expect(stats.conversations).toBe(0);
  });

  it('reports the first invalid candidate when no Chatbox payload exists', async () => {
    const zip = new JSZip();
    zip.file('a.json', '{invalid');
    zip.file('b.json', '[]');
    await expect(convertChatboxExportBlobToStructuredExportSnapshot(
      await zip.generateAsync({ type: 'blob' })
    )).rejects.toThrow('a.json 不是有效 JSON');
  });

  it('reports a missing export when all JSON objects are unrelated', async () => {
    const zip = new JSZip();
    zip.file('metadata.json', '{}');
    await expect(convertChatboxExportBlobToStructuredExportSnapshot(
      await zip.generateAsync({ type: 'blob' })
    )).rejects.toThrow('压缩包里没有找到 Chatbox 导出的会话 JSON');
  });
});
