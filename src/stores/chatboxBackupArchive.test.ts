import { describe, expect, it } from 'vitest';
import type { BackupArchiveFile, BackupArchiveReader } from '../infrastructure/backupImportArchive';
import { parseChatboxBackupArchive, parseChatboxBackupManifest } from './chatboxBackupArchive';

describe('parseChatboxBackupArchive', () => {
  it('skips a session whose archived bytes do not match the manifest checksum', async () => {
    const manifest = parseChatboxBackupManifest({
      format: 'chatbox-backup',
      formatVersion: 2,
      exportedAt: '2026-08-10T00:00:00.000Z',
      application: { name: 'Chatbox', version: '1.15.0', platform: 'darwin' },
      exportItems: ['conversations'],
      data: {},
      sessions: [{
        id: 'session-1',
        meta: { id: 'session-1', name: 'Session' },
        resourceIds: [],
        path: 'sessions/session-1/session.json',
        size: 2,
        checksum: { algorithm: 'sha256', value: '0'.repeat(64) }
      }],
      resources: [],
      warnings: [],
      stats: { sessionCount: 1, resourceCount: 0, deduplicatedResourceCount: 0, warningCount: 0 }
    });
    expect(manifest).not.toBeNull();
    const bytes = new TextEncoder().encode('{}');
    const zip: BackupArchiveReader = {
      file: () => ({
        async: async (type: 'string' | 'blob' | 'arraybuffer') => {
          if (type === 'string') return '{}';
          if (type === 'blob') return new Blob([bytes]);
          return Uint8Array.from(bytes).buffer;
        }
      }) as BackupArchiveFile,
      forEach: () => undefined,
      entryCount: 1,
      size: bytes.length,
      close: async () => undefined
    };

    const parsed = await parseChatboxBackupArchive(zip, manifest!);

    expect(parsed.sessions).toEqual([]);
    expect(parsed.skippedSessionCount).toBe(1);
  });
});
