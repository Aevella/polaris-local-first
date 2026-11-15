import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  assertWebDavConfigReady,
  buildWebDavBackupFileUrl,
  buildWebDavDirectoryUrl,
  createWebDavAuthorizationHeader,
  formatWebDavStatusError,
  formatWebDavTransportError,
  parseWebDavDirectoryListing,
  selectLatestPolarisBackup
} from '../engines/webdavBackup';
import type { WebDavConfig } from '../types/domain';
import { base64ToBytes, bytesToBase64 } from './nativeBase64';
import type { NativeBackupImportSource } from '../infrastructure/backupImportSource';

type NativeListResult = {
  statusCode: number;
  body?: string;
};

type NativeDownloadResult = {
  statusCode: number;
  mimeType?: string;
  dataBase64?: string;
  downloadId?: string;
  size?: number;
};

type NativeUploadResult = {
  statusCode: number;
  body?: string;
};

type WebDavPlugin = {
  listDirectory: (options: {
    url: string;
    username: string;
    password: string;
  }) => Promise<NativeListResult>;
  downloadFile: (options: {
    url: string;
    username: string;
    password: string;
  }) => Promise<NativeDownloadResult>;
  uploadFile: (options: {
    url: string;
    username: string;
    password: string;
    mimeType: string;
    dataBase64: string;
  }) => Promise<NativeUploadResult>;
  readDownloadFileChunk?: (options: {
    downloadId: string;
    offset: number;
    length: number;
  }) => Promise<{ dataBase64: string }>;
  releaseDownloadFile?: (options: { downloadId: string }) => Promise<void>;
  beginUploadFile?: (options: {
    url: string;
    username: string;
    password: string;
    mimeType: string;
  }) => Promise<{ uploadId: string }>;
  appendUploadFileChunk?: (options: {
    uploadId: string;
    dataBase64: string;
  }) => Promise<void>;
  finishUploadFile?: (options: { uploadId: string }) => Promise<NativeUploadResult>;
  cancelUploadFile?: (options: { uploadId: string }) => Promise<void>;
};

const WebDav = registerPlugin<WebDavPlugin>('WebDav');
const NATIVE_WEBDAV_UPLOAD_CHUNK_BYTES = 512 * 1024;

function canUseNativeWebDav() {
  return Capacitor.isNativePlatform()
    && (Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android');
}

function canStreamNativeWebDavUpload() {
  return Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === 'android'
    && typeof WebDav.beginUploadFile === 'function'
    && typeof WebDav.appendUploadFileChunk === 'function'
    && typeof WebDav.finishUploadFile === 'function';
}

function ensureStatus(statusCode: number, allowed: number[], action: string) {
  if (!allowed.includes(statusCode)) {
    throw new Error(formatWebDavStatusError(statusCode, action));
  }
}

async function fetchWebDav(endpoint: string, action: string, input: RequestInfo | URL, init: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new Error(formatWebDavTransportError(error, endpoint, action));
  }
}

async function listDirectoryXml(config: WebDavConfig) {
  const directoryUrl = buildWebDavDirectoryUrl(config.endpoint);
  if (canUseNativeWebDav()) {
    const result = await WebDav.listDirectory({
      url: directoryUrl,
      username: config.username,
      password: config.password
    });
    ensureStatus(result.statusCode, [200, 207], '读取 WebDAV 目录');
    return result.body ?? '';
  }

  const response = await fetchWebDav(config.endpoint, '读取 WebDAV 目录', directoryUrl, {
    method: 'PROPFIND',
    headers: {
      Authorization: createWebDavAuthorizationHeader(config.username, config.password),
      Depth: '1',
      Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
  ensureStatus(response.status, [200, 207], '读取 WebDAV 目录');
  return await response.text();
}

async function downloadFile(url: string, config: WebDavConfig, name: string) {
  if (canUseNativeWebDav()) {
    const result = await WebDav.downloadFile({
      url,
      username: config.username,
      password: config.password
    });
    ensureStatus(result.statusCode, [200], '下载 WebDAV 备份');
    if (
      result.downloadId
      && Number.isSafeInteger(result.size)
      && (result.size ?? -1) >= 0
      && WebDav.readDownloadFileChunk
      && WebDav.releaseDownloadFile
    ) {
      const downloadId = result.downloadId;
      const readDownloadFileChunk = WebDav.readDownloadFileChunk;
      const releaseDownloadFile = WebDav.releaseDownloadFile;
      return {
        kind: 'native-file',
        name,
        mimeType: result.mimeType || 'application/zip',
        size: result.size!,
        async readRange(start, length) {
          const chunk = await readDownloadFileChunk({ downloadId, offset: start, length });
          return base64ToBytes(chunk.dataBase64);
        },
        async release() {
          await releaseDownloadFile({ downloadId });
        }
      } satisfies NativeBackupImportSource;
    }
    if (!result.dataBase64) {
      throw new Error('WebDAV 返回的备份内容不完整');
    }
    const bytes = base64ToBytes(result.dataBase64);
    return new File([bytes], name, {
      type: result.mimeType || 'application/zip'
    });
  }

  const response = await fetchWebDav(config.endpoint, '下载 WebDAV 备份', url, {
    method: 'GET',
    headers: {
      Authorization: createWebDavAuthorizationHeader(config.username, config.password)
    }
  });
  ensureStatus(response.status, [200], '下载 WebDAV 备份');
  return new File([await response.blob()], name, {
    type: response.headers.get('content-type') || 'application/zip'
  });
}

export async function uploadBackupToWebDav(config: WebDavConfig, blob: Blob, fileName: string) {
  assertWebDavConfigReady(config);
  const targetUrl = buildWebDavBackupFileUrl(config.endpoint, fileName);

  if (canUseNativeWebDav()) {
    if (canStreamNativeWebDavUpload()) {
      const { uploadId } = await WebDav.beginUploadFile!({
        url: targetUrl,
        username: config.username,
        password: config.password,
        mimeType: blob.type || 'application/zip'
      });
      try {
        for (let offset = 0; offset < blob.size; offset += NATIVE_WEBDAV_UPLOAD_CHUNK_BYTES) {
          const chunk = new Uint8Array(await blob.slice(
            offset,
            Math.min(offset + NATIVE_WEBDAV_UPLOAD_CHUNK_BYTES, blob.size)
          ).arrayBuffer());
          await WebDav.appendUploadFileChunk!({
            uploadId,
            dataBase64: bytesToBase64(chunk)
          });
        }
        const result = await WebDav.finishUploadFile!({ uploadId });
        ensureStatus(result.statusCode, [200, 201, 204], '上传 WebDAV 备份');
        return;
      } catch (error) {
        await WebDav.cancelUploadFile?.({ uploadId });
        throw error;
      }
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await WebDav.uploadFile({
      url: targetUrl,
      username: config.username,
      password: config.password,
      mimeType: blob.type || 'application/zip',
      dataBase64: bytesToBase64(bytes)
    });
    ensureStatus(result.statusCode, [200, 201, 204], '上传 WebDAV 备份');
    return;
  }

  const response = await fetchWebDav(config.endpoint, '上传 WebDAV 备份', targetUrl, {
    method: 'PUT',
    headers: {
      Authorization: createWebDavAuthorizationHeader(config.username, config.password),
      'Content-Type': blob.type || 'application/zip'
    },
    body: blob
  });
  ensureStatus(response.status, [200, 201, 204], '上传 WebDAV 备份');
}

export async function downloadLatestBackupFromWebDav(config: WebDavConfig) {
  assertWebDavConfigReady(config);
  const directoryUrl = buildWebDavDirectoryUrl(config.endpoint);
  const xml = await listDirectoryXml(config);
  const latest = selectLatestPolarisBackup(parseWebDavDirectoryListing(xml, directoryUrl));
  return await downloadFile(latest.url, config, latest.name);
}
