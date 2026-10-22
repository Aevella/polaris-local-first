import { describe, it, expect, vi } from 'vitest';
import { buildRoomProjectFullscreenPresentation } from './roomProjectFullscreenPresentation';
import { createTranslator } from '../../i18n';
import type { PolarisCompanionConnection } from '../../types/domain';

type Input = Parameters<typeof buildRoomProjectFullscreenPresentation>[0];
function input(overrides: Partial<Input> = {}): Input {
  return {
    project: { id: 'project', title: 'Workspace', slug: 'workspace', fileIds: [], tags: [], source: 'manual', createdAt: 1, updatedAt: 1 },
    desktopCommandResult: null, files: [], conversations: [], referenceDocs: [], desktopCommandSessions: [],
    desktopLocalAvailable: false, companionConnections: [], language: 'zh-CN',
    t: createTranslator('zh-CN').t, previewStateReadEnabled: false,
    importingFiles: false, importingReferences: false, ...overrides
  };
}
function connection(overrides: Partial<PolarisCompanionConnection> = {}): PolarisCompanionConnection {
  return { id: 'host', source: 'polaris', collaboratorId: 'person', conversationId: 'chat', relayUrl: '', hostId: 'host', clientId: 'client', clientSecret: '', label: 'Host', hostLabel: 'Host', pushToken: null, pushPlatform: null, createdAt: 1, lastSnapshotAt: null, lastError: null, ...overrides };
}

describe('buildRoomProjectFullscreenPresentation', () => {
  it('shows an offline computer when no host capability or connection exists', () => {
    const result = buildRoomProjectFullscreenPresentation(input());
    expect(result.computerStatus.tone).toBe('offline');
    expect(result.activeCommandSession).toBeNull();
  });
  it('distinguishes recent, stale, waiting and failed companion facts', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      for (const [facts, tone] of [
        [{ lastSnapshotAt: 90_000 }, 'online'],
        [{ lastSnapshotAt: 60_000 }, 'offline'],
        [{ lastSnapshotAt: null }, 'waiting'],
        [{ lastSnapshotAt: 90_000, lastError: 'unreachable' }, 'error']
      ] as const) {
        expect(buildRoomProjectFullscreenPresentation(input({ companionConnections: [connection(facts)] })).computerStatus.tone).toBe(tone);
      }
    } finally { clock.mockRestore(); }
  });
  it('uses the explicit local host capability before companion connection errors', () => {
    const result = buildRoomProjectFullscreenPresentation(input({ desktopLocalAvailable: true, companionConnections: [connection({ lastError: 'unreachable' })] }));
    expect(result.computerStatus.tone).toBe('online');
  });
});
