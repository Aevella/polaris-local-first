import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  plugin: {
    listDirectory: vi.fn(),
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
    readDownloadFileChunk: vi.fn(),
    releaseDownloadFile: vi.fn(),
    beginUploadFile: vi.fn(),
    appendUploadFileChunk: vi.fn(),
    finishUploadFile: vi.fn(),
    cancelUploadFile: vi.fn()
  }
}));

const capacitorState = {
  native: true,
  platform: 'android'
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.native,
    getPlatform: () => capacitorState.platform
  },
  registerPlugin: vi.fn(() => mocks.plugin)
}));

import { downloadLatestBackupFromWebDav, uploadBackupToWebDav } from './webdavBackup';

const config = {
  endpoint: 'https://dav.example.com/Polaris',
  username: 'angel@example.com',
  password: 'app-password'
};

beforeEach(() => {
  capacitorState.native = true;
  capacitorState.platform = 'android';
  Object.values(mocks.plugin).forEach((mock) => mock.mockReset());
});

describe('Android native WebDAV', () => {
  it('uploads large backups through bounded native chunks', async () => {
    mocks.plugin.beginUploadFile.mockResolvedValue({ uploadId: 'upload-1' });
    mocks.plugin.finishUploadFile.mockResolvedValue({ statusCode: 201 });
    const bytes = new Uint8Array((512 * 1024) + 3);
    bytes.set([1, 2, 3], 512 * 1024);

    await uploadBackupToWebDav(config, new Blob([bytes], { type: 'application/zip' }), 'polaris-export.zip');

    expect(mocks.plugin.uploadFile).not.toHaveBeenCalled();
    expect(mocks.plugin.beginUploadFile).toHaveBeenCalledWith({
      url: 'https://dav.example.com/Polaris/polaris-export.zip',
      username: config.username,
      password: config.password,
      mimeType: 'application/zip'
    });
    expect(mocks.plugin.appendUploadFileChunk).toHaveBeenCalledTimes(2);
    expect(mocks.plugin.appendUploadFileChunk.mock.calls[1]?.[0]).toEqual({
      uploadId: 'upload-1',
      dataBase64: 'AQID'
    });
    expect(mocks.plugin.finishUploadFile).toHaveBeenCalledWith({ uploadId: 'upload-1' });
  });

  it('keeps downloaded backups in a native range-backed file session', async () => {
    mocks.plugin.listDirectory.mockResolvedValue({
      statusCode: 207,
      body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response>
        <d:href>/Polaris/polaris-export-20260830.zip</d:href>
        <d:propstat><d:prop><d:getlastmodified>Sun, 30 Aug 2026 12:00:00 GMT</d:getlastmodified></d:prop></d:propstat>
      </d:response></d:multistatus>`
    });
    mocks.plugin.downloadFile.mockResolvedValue({
      statusCode: 200,
      downloadId: 'download-1',
      mimeType: 'application/zip',
      size: 4
    });
    mocks.plugin.readDownloadFileChunk.mockResolvedValue({ dataBase64: 'UEsDBA==' });

    const source = await downloadLatestBackupFromWebDav(config);

    expect(source).toMatchObject({
      kind: 'native-file',
      name: 'polaris-export-20260830.zip',
      size: 4
    });
    if (source instanceof Blob) throw new Error('expected native WebDAV source');
    expect(Array.from(await source.readRange(0, 4))).toEqual([80, 75, 3, 4]);
    await source.release();
    expect(mocks.plugin.releaseDownloadFile).toHaveBeenCalledWith({ downloadId: 'download-1' });
  });
});

describe('iOS native WebDAV', () => {
  it('keeps using the implemented whole-file native upload method', async () => {
    capacitorState.platform = 'ios';
    mocks.plugin.uploadFile.mockResolvedValue({ statusCode: 204 });

    await uploadBackupToWebDav(
      config,
      new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/zip' }),
      'polaris-export.zip'
    );

    expect(mocks.plugin.beginUploadFile).not.toHaveBeenCalled();
    expect(mocks.plugin.uploadFile).toHaveBeenCalledWith({
      url: 'https://dav.example.com/Polaris/polaris-export.zip',
      username: config.username,
      password: config.password,
      mimeType: 'application/zip',
      dataBase64: 'UEsDBA=='
    });
  });
});
