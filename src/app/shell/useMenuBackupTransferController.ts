import { useState } from 'react';
import { isWebDavConfigured } from '../../engines/webdavBackup';
import {
  canUseNativeSystemBackupFiles,
  getSystemBackupAvailability,
  importBackupViaSystemFiles
} from '../../native/systemBackupFiles';
import { downloadLatestBackupFromWebDav, uploadBackupToWebDav } from '../../native/webdavBackup';
import {
  formatStoreTransferProgress,
  resolveStoreTransferProgressPercent,
  type StoreTransferProgress
} from '../../stores/storeImportProgress';
import {
  buildCurrentExportPackage,
  exportCompleteBackup,
  formatCompleteBackupExportError
} from './completeBackupExport';
import { formatStoreImportResult } from '../../stores/storeImportResult';

type MenuBackupTransferUi = {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  downloadFile: (blob: Blob, fileName: string) => void;
  triggerBrowserImportPicker: () => void;
};

type MenuBackupTransferWebDavConfig = Parameters<typeof isWebDavConfigured>[0];

type UseMenuBackupTransferControllerArgs = {
  ui: MenuBackupTransferUi;
  webdav: MenuBackupTransferWebDavConfig;
};

export function formatMenuLocalBackupError(error: unknown, action: '导出' | '导入') {
  if (action === '导出') return formatCompleteBackupExportError(error);
  const message = error instanceof Error ? error.message : '';
  if (/SystemFile/i.test(message) || /not implemented on ios/i.test(message)) {
    return '当前 App 版暂时无法使用本地备份包，请先使用 WebDAV 导入备份包。';
  }
  if (/I\/O read operation failed|读取导入文件失败/i.test(message)) {
    return 'iOS 没能读到刚选中的备份文件。请先在“文件”App 或 iCloud 里确认备份包已经下载完成，再重新选择一次；这一步还没有开始解析备份内容。';
  }
  return message || `${action}备份包失败`;
}

export function resolveMenuLocalBackupDetails(systemBackupAvailability: ReturnType<typeof getSystemBackupAvailability>) {
  return {
    localBackupAvailable: systemBackupAvailability !== 'unavailable',
    localExportDetail: systemBackupAvailability === 'native'
      ? '保存到系统文件'
      : systemBackupAvailability === 'browser'
        ? '下载到当前设备'
        : '当前 App 版暂未接通',
    localImportDetail: systemBackupAvailability === 'native'
      ? '从系统文件选取'
      : systemBackupAvailability === 'browser'
        ? '从当前设备选一个 zip'
        : '当前 App 版暂未接通'
  };
}

async function importBackupData(file: Blob, onProgress: (progress: StoreTransferProgress) => void) {
  const { importAllData } = await import('../../stores/spaceStoreDataTransfer');
  return await importAllData(file, { onProgress });
}

export function useMenuBackupTransferController({
  ui,
  webdav
}: UseMenuBackupTransferControllerArgs) {
  const [exportingData, setExportingData] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [exportProgress, setExportProgress] = useState<StoreTransferProgress | null>(null);
  const [importProgress, setImportProgress] = useState<StoreTransferProgress | null>(null);
  const [exportingWebDav, setExportingWebDav] = useState(false);
  const [importingWebDav, setImportingWebDav] = useState(false);

  const systemBackupAvailability = getSystemBackupAvailability();
  const {
    localBackupAvailable,
    localExportDetail,
    localImportDetail
  } = resolveMenuLocalBackupDetails(systemBackupAvailability);
  const visibleLocalExportDetail = exportingData && exportProgress
    ? formatStoreTransferProgress(exportProgress)
    : localExportDetail;
  const visibleLocalImportDetail = importingData && importProgress
    ? formatStoreTransferProgress(importProgress)
    : localImportDetail;
  const localExportProgress = exportingData ? resolveStoreTransferProgressPercent(exportProgress) : null;
  const localImportProgress = importingData ? resolveStoreTransferProgressPercent(importProgress) : null;

  const runImport = async (file: Blob) => {
    try {
      setImportingData(true);
      setImportProgress({ message: '识别备份包' });
      const result = await importBackupData(file, setImportProgress);
      ui.alert(formatStoreImportResult(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件格式不正确';
      ui.alert(message);
    } finally {
      setImportingData(false);
      setImportProgress(null);
    }
  };

  const exportData = async () => {
    try {
      setExportingData(true);
      setExportProgress({ message: '读取对话和设置' });
      await exportCompleteBackup({
        onProgress: setExportProgress,
        downloadFile: ui.downloadFile
      });
    } catch (error) {
      ui.alert(formatMenuLocalBackupError(error, '导出'));
    } finally {
      setExportingData(false);
      setExportProgress(null);
    }
  };

  const importData = async () => {
    if (systemBackupAvailability === 'unavailable') {
      ui.alert('当前 App 版请先使用 WebDAV 导入备份包。');
      return;
    }

    if (!ui.confirm('导入会覆盖当前数据，确定吗？')) return;

    if (!canUseNativeSystemBackupFiles()) {
      ui.triggerBrowserImportPicker();
      return;
    }

    let completionMessage: string | null = null;
    try {
      setImportingData(true);
      setImportProgress({ message: '等待选择备份包' });
      const file = await importBackupViaSystemFiles();
      if (!file) return;
      const result = await importBackupData(file, setImportProgress);
      completionMessage = formatStoreImportResult(result);
    } catch (error) {
      completionMessage = formatMenuLocalBackupError(error, '导入');
    } finally {
      setImportingData(false);
      setImportProgress(null);
    }
    if (completionMessage) {
      ui.alert(completionMessage);
    }
  };

  const exportToWebDav = async () => {
    try {
      setExportingWebDav(true);
      setExportProgress({ message: '读取对话和设置' });
      const { blob, fileName } = await buildCurrentExportPackage({ onProgress: setExportProgress });
      setExportProgress({ message: '上传 WebDAV' });
      await uploadBackupToWebDav(webdav, blob, fileName);
      ui.alert(`已上传到 WebDAV：${fileName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传 WebDAV 失败';
      ui.alert(message);
    } finally {
      setExportingWebDav(false);
      setExportProgress(null);
    }
  };

  const importFromWebDav = async () => {
    try {
      setImportingWebDav(true);
      if (!ui.confirm('会从 WebDAV 拉取最近一份备份，并覆盖当前数据，确定吗？')) return;
      const file = await downloadLatestBackupFromWebDav(webdav);
      const result = await importBackupData(file, setImportProgress);
      ui.alert(formatStoreImportResult(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 WebDAV 备份失败';
      ui.alert(message);
    } finally {
      setImportingWebDav(false);
      setImportProgress(null);
    }
  };

  return {
    readyForWebDav: isWebDavConfigured(webdav),
    exportingData,
    importingData,
    exportingWebDav,
    importingWebDav,
    localBackupAvailable,
    localExportDetail: visibleLocalExportDetail,
    localImportDetail: visibleLocalImportDetail,
    localExportProgress,
    localImportProgress,
    onImportBrowserFileSelected: async (file: File | null) => {
      if (!file) return;
      await runImport(file);
    },
    onExportData: exportData,
    onImportData: importData,
    onExportToWebDav: exportToWebDav,
    onImportFromWebDav: importFromWebDav
  };
}
