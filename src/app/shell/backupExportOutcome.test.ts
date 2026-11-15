import { beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ mode: 'zip', saved: false }));
vi.mock('../../native/systemBackupFiles', () => ({
  getSystemBackupAvailability: () => harness.mode === 'browser' ? 'browser' : 'native',
  canStreamNativeZipBackupFiles: () => harness.mode === 'zip',
  canStreamNativeSystemBackupFiles: () => harness.mode === 'stream',
  canUseNativeSystemBackupFiles: () => harness.mode === 'file',
  beginZipExportViaSystemFiles: async () => 'zip', beginExportFileViaSystemFiles: async () => 'stream',
  finishZipExportViaSystemFiles: async () => harness.saved,
  finishExportFileViaSystemFiles: async () => harness.saved,
  exportFileViaSystemFiles: async () => harness.saved,
  cancelZipExportViaSystemFiles: vi.fn(), cancelExportFileViaSystemFiles: vi.fn(),
  appendExportFileChunkViaSystemFiles: vi.fn(), addZipTextEntryViaSystemFiles: vi.fn(),
  addZipNativePersistenceBinaryEntryViaSystemFiles: vi.fn(), appendZipBinaryChunkViaSystemFiles: vi.fn(),
  beginZipBinaryEntryViaSystemFiles: vi.fn(), finishZipBinaryEntryViaSystemFiles: vi.fn()
}));
vi.mock('../../stores/storeExportPackage', () => ({
  buildStructuredExportPackage: async () => ({ blob: new Blob(['synthetic']), fileName: 'synthetic.zip' }),
  streamStructuredExportPackage: async (_snapshot: unknown, handlers: { onStart: (value: unknown) => Promise<void> }) => { await handlers.onStart({ fileName: 'synthetic.zip', mimeType: 'application/zip' }); },
  streamStructuredExportPackageEntries: async (_snapshot: unknown, handlers: { onStart: (value: unknown) => Promise<void> }) => { await handlers.onStart({ fileName: 'synthetic.zip', mimeType: 'application/zip' }); }
}));
vi.mock('../../stores/workspaceReferenceDocContentPersistence', () => ({ loadWorkspaceReferenceDocsContent: async () => [] }));
import { useChatStore } from '../../stores/chatStore';
import { exportCompleteBackup } from './completeBackupExport';
import { exportPersistedCompleteBackup } from './persistedBackupExport';
beforeEach(() => { harness.saved = false; vi.spyOn(useChatStore.getState(), 'persistToDb').mockResolvedValue(); });
describe.each([['current', exportCompleteBackup], ['persisted', exportPersistedCompleteBackup]] as const)('%s backup result', (_label, exportBackup) => {
  it.each(['zip', 'stream', 'file'])('keeps native %s cancellation distinct from success', async (mode) => {
    harness.mode = mode;
    expect(await exportBackup({ downloadFile: vi.fn() })).toMatchObject({ saved: false });
    harness.saved = true;
    expect(await exportBackup({ downloadFile: vi.fn() })).toMatchObject({ saved: true });
  });
  it('records completion after the browser download callback succeeds', async () => {
    harness.mode = 'browser'; const download = vi.fn();
    expect(await exportBackup({ downloadFile: download })).toMatchObject({ target: 'browser-download', saved: true });
    expect(download).toHaveBeenCalledOnce();
  });
});
