import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  systemFile: {
    importBackup: vi.fn(),
    exportBackup: vi.fn(),
    beginExportBackup: vi.fn(),
    appendExportBackupChunk: vi.fn(),
    finishExportBackup: vi.fn(),
    cancelExportBackup: vi.fn(),
    beginZipExport: vi.fn(),
    addZipTextEntry: vi.fn(),
    beginZipTextEntry: vi.fn(),
    appendZipTextChunk: vi.fn(),
    finishZipTextEntry: vi.fn(),
    beginZipBinaryEntry: vi.fn(),
    appendZipBinaryChunk: vi.fn(),
    addZipNativePersistenceBinaryEntry: vi.fn(),
    finishZipBinaryEntry: vi.fn(),
    finishZipExport: vi.fn(),
    cancelZipExport: vi.fn()
  }
}));

const capacitorState = {
  isNativePlatform: false,
  platform: 'web'
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.isNativePlatform,
    getPlatform: () => capacitorState.platform,
    convertFileSrc: (fileUrl: string) => `converted:${fileUrl}`
  },
  registerPlugin: vi.fn(() => mocks.systemFile)
}));

import {
  appendExportFileChunkViaSystemFiles,
  addZipTextEntryViaSystemFiles,
  appendZipBinaryChunkViaSystemFiles,
  addZipNativePersistenceBinaryEntryViaSystemFiles,
  beginZipBinaryEntryViaSystemFiles,
  beginExportFileViaSystemFiles,
  beginZipExportViaSystemFiles,
  canStreamNativeSystemBackupFiles,
  canStreamNativeZipBackupFiles,
  canUseNativeSystemBackupFiles,
  exportFileViaSystemFiles,
  finishZipBinaryEntryViaSystemFiles,
  finishExportFileViaSystemFiles,
  finishZipExportViaSystemFiles,
  getSystemBackupAvailability,
  importBackupViaSystemFiles
} from './systemBackupFiles';

describe('systemBackupFiles availability', () => {
  beforeEach(() => {
    capacitorState.isNativePlatform = false;
    capacitorState.platform = 'web';
    mocks.systemFile.importBackup.mockReset();
    mocks.systemFile.exportBackup.mockReset();
    mocks.systemFile.beginExportBackup.mockReset();
    mocks.systemFile.appendExportBackupChunk.mockReset();
    mocks.systemFile.finishExportBackup.mockReset();
    mocks.systemFile.cancelExportBackup.mockReset();
    mocks.systemFile.beginZipExport.mockReset();
    mocks.systemFile.addZipTextEntry.mockReset();
    mocks.systemFile.beginZipTextEntry.mockReset();
    mocks.systemFile.appendZipTextChunk.mockReset();
    mocks.systemFile.finishZipTextEntry.mockReset();
    mocks.systemFile.beginZipBinaryEntry.mockReset();
    mocks.systemFile.appendZipBinaryChunk.mockReset();
    mocks.systemFile.addZipNativePersistenceBinaryEntry.mockReset();
    mocks.systemFile.finishZipBinaryEntry.mockReset();
    mocks.systemFile.finishZipExport.mockReset();
    mocks.systemFile.cancelZipExport.mockReset();
    vi.restoreAllMocks();
  });

  it('uses browser downloads on the web', () => {
    expect(getSystemBackupAvailability()).toBe('browser');
    expect(canUseNativeSystemBackupFiles()).toBe(false);
  });

  it('treats iOS native builds as system-file capable', () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'ios';

    expect(getSystemBackupAvailability()).toBe('native');
    expect(canUseNativeSystemBackupFiles()).toBe(true);
    expect(canStreamNativeSystemBackupFiles()).toBe(true);
    expect(canStreamNativeZipBackupFiles()).toBe(false);
  });

  it('streams Android native exports through the system-file plugin', () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'android';

    expect(getSystemBackupAvailability()).toBe('native');
    expect(canUseNativeSystemBackupFiles()).toBe(true);
    expect(canStreamNativeSystemBackupFiles()).toBe(true);
    expect(canStreamNativeZipBackupFiles()).toBe(true);
  });

  it('keeps unsupported native platforms unavailable', () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'electron';

    expect(getSystemBackupAvailability()).toBe('unavailable');
    expect(canUseNativeSystemBackupFiles()).toBe(false);
  });

  it('imports native files by URL instead of bridge base64 when available', async () => {
    mocks.systemFile.importBackup.mockResolvedValue({
      canceled: false,
      name: 'polaris-export.zip',
      mimeType: 'application/zip',
      fileUrl: 'file:///tmp/polaris-export.zip'
    });
    const fetchMock = vi.fn(async () => new Response(new Blob(['zip-content'], { type: 'application/zip' })));
    vi.stubGlobal('fetch', fetchMock);

    const file = await importBackupViaSystemFiles();

    expect(fetchMock).toHaveBeenCalledWith('converted:file:///tmp/polaris-export.zip');
    expect(file?.name).toBe('polaris-export.zip');
    expect(file ? await file.text() : '').toBe('zip-content');
  });

  it('wraps native file URL fetch failures with the import-file boundary', async () => {
    mocks.systemFile.importBackup.mockResolvedValue({
      canceled: false,
      name: 'polaris-export.zip',
      mimeType: 'application/zip',
      fileUrl: 'file:///tmp/polaris-export.zip'
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('failed to fetch');
    }));

    await expect(importBackupViaSystemFiles()).rejects.toThrow('读取系统导入文件失败：failed to fetch');
  });

  it('writes iOS native export chunks without building one bridge-sized base64 payload', async () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'ios';
    mocks.systemFile.beginExportBackup.mockResolvedValue({ exportId: 'export-1' });
    mocks.systemFile.finishExportBackup.mockResolvedValue({ canceled: false });

    const exportId = await beginExportFileViaSystemFiles('polaris-export.zip');
    await appendExportFileChunkViaSystemFiles(exportId, new Uint8Array([80, 75]));
    const saved = await finishExportFileViaSystemFiles(exportId);

    expect(exportId).toBe('export-1');
    expect(mocks.systemFile.beginExportBackup).toHaveBeenCalledWith({
      fileName: 'polaris-export.zip',
      mimeType: 'application/zip'
    });
    expect(mocks.systemFile.appendExportBackupChunk).toHaveBeenCalledWith({
      exportId: 'export-1',
      dataBase64: 'UEs='
    });
    expect(saved).toBe(true);
  });

  it('streams native Blob exports when the platform plugin supports chunks', async () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'android';
    mocks.systemFile.beginExportBackup.mockResolvedValue({ exportId: 'export-blob' });
    mocks.systemFile.finishExportBackup.mockResolvedValue({ canceled: false });

    const saved = await exportFileViaSystemFiles(new Blob([new Uint8Array([1, 2, 3])], {
      type: 'application/zip'
    }), 'polaris-export.zip');

    expect(saved).toBe(true);
    expect(mocks.systemFile.exportBackup).not.toHaveBeenCalled();
    expect(mocks.systemFile.beginExportBackup).toHaveBeenCalledWith({
      fileName: 'polaris-export.zip',
      mimeType: 'application/zip'
    });
    expect(mocks.systemFile.appendExportBackupChunk).toHaveBeenCalledWith({
      exportId: 'export-blob',
      dataBase64: 'AQID'
    });
    expect(mocks.systemFile.finishExportBackup).toHaveBeenCalledWith({
      exportId: 'export-blob'
    });
  });

  it('writes Android ZIP entries through the native streaming writer', async () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'android';
    mocks.systemFile.beginZipExport.mockResolvedValue({ exportId: 'zip-export' });
    mocks.systemFile.finishZipExport.mockResolvedValue({ canceled: false });

    const exportId = await beginZipExportViaSystemFiles('polaris-export.zip');
    await addZipTextEntryViaSystemFiles(exportId, 'manifest.json', '{}');
    await beginZipBinaryEntryViaSystemFiles(exportId, 'assets/images/a.png');
    await appendZipBinaryChunkViaSystemFiles(exportId, new Uint8Array([1, 2, 3]));
    mocks.systemFile.addZipNativePersistenceBinaryEntry.mockResolvedValue({ written: true, size: 3 });
    const wroteNativeEntry = await addZipNativePersistenceBinaryEntryViaSystemFiles(
      exportId,
      'asset-binary',
      'asset-1',
      'assets/images/native.png'
    );
    await finishZipBinaryEntryViaSystemFiles(exportId);
    const saved = await finishZipExportViaSystemFiles(exportId);

    expect(exportId).toBe('zip-export');
    expect(mocks.systemFile.beginZipExport).toHaveBeenCalledWith({
      fileName: 'polaris-export.zip',
      mimeType: 'application/zip'
    });
    expect(mocks.systemFile.beginZipTextEntry).toHaveBeenCalledWith({
      exportId: 'zip-export',
      path: 'manifest.json'
    });
    expect(mocks.systemFile.appendZipTextChunk).toHaveBeenCalledWith({
      exportId: 'zip-export',
      text: '{}'
    });
    expect(mocks.systemFile.finishZipTextEntry).toHaveBeenCalledWith({
      exportId: 'zip-export'
    });
    expect(mocks.systemFile.beginZipBinaryEntry).toHaveBeenCalledWith({
      exportId: 'zip-export',
      path: 'assets/images/a.png'
    });
    expect(mocks.systemFile.appendZipBinaryChunk).toHaveBeenCalledWith({
      exportId: 'zip-export',
      dataBase64: 'AQID'
    });
    expect(mocks.systemFile.addZipNativePersistenceBinaryEntry).toHaveBeenCalledWith({
      exportId: 'zip-export',
      path: 'assets/images/native.png',
      storeName: 'asset-binary',
      key: 'asset-1'
    });
    expect(wroteNativeEntry).toBe(true);
    expect(mocks.systemFile.finishZipBinaryEntry).toHaveBeenCalledWith({
      exportId: 'zip-export'
    });
    expect(mocks.systemFile.finishZipExport).toHaveBeenCalledWith({
      exportId: 'zip-export'
    });
    expect(saved).toBe(true);
  });

  it('splits Android ZIP text entries instead of sending one bridge-sized string', async () => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = 'android';
    mocks.systemFile.beginZipExport.mockResolvedValue({ exportId: 'zip-export' });

    const exportId = await beginZipExportViaSystemFiles('polaris-export.zip');
    await addZipTextEntryViaSystemFiles(exportId, 'stores/chat.json', 'abcd');

    expect(mocks.systemFile.beginZipTextEntry).toHaveBeenCalledWith({
      exportId: 'zip-export',
      path: 'stores/chat.json'
    });
    expect(mocks.systemFile.appendZipTextChunk).toHaveBeenCalledWith({
      exportId: 'zip-export',
      text: 'abcd'
    });
    expect(mocks.systemFile.finishZipTextEntry).toHaveBeenCalledWith({
      exportId: 'zip-export'
    });
    expect(mocks.systemFile.addZipTextEntry).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])('keeps surrogate pairs intact at %s ZIP text chunk boundaries', async (platform) => {
    capacitorState.isNativePlatform = true;
    capacitorState.platform = platform;
    mocks.systemFile.beginZipExport.mockResolvedValue({ exportId: 'zip-export' });
    const text = `${'a'.repeat(128 * 1024 - 1)}😀tail`;

    const exportId = await beginZipExportViaSystemFiles('polaris-export.zip');
    await addZipTextEntryViaSystemFiles(exportId, 'stores/chat.json', text);

    const chunks = mocks.systemFile.appendZipTextChunk.mock.calls.map(([options]) => options.text);
    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).toBe(text);
    expect(chunks[0]).toBe('a'.repeat(128 * 1024 - 1));
    expect(chunks[1]).toBe('😀tail');
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
  });
});
