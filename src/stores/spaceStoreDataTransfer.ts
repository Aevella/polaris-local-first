import { importStructuredExportPackage } from './storeImportPackage';
import { importKelivoBackupPackageIfMatched } from './kelivoImportAdapter';
import type { StoreImportProgressReporter } from './storeImportProgress';
import type { StoreImportResult } from './storeImportResult';
import { fingerprintDiagnosticId, reportPersistenceError } from '../infrastructure/persistenceDiagnostics';

export async function importAllData(
  file: Blob,
  options: { onProgress?: StoreImportProgressReporter } = {}
): Promise<StoreImportResult> {
  options.onProgress?.({ message: '识别备份包' });
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip =
    header[0] === 0x50
    && header[1] === 0x4b
    && (
      (header[2] === 0x03 && header[3] === 0x04)
      || (header[2] === 0x05 && header[3] === 0x06)
      || (header[2] === 0x07 && header[3] === 0x08)
    );

  if (!isZip) {
    throw new Error('无法识别的备份格式：请选择 Polaris 导出的 zip 备份');
  }

  try {
    const kelivoResult = await importKelivoBackupPackageIfMatched(file, options);
    if (kelivoResult) return kelivoResult;
    return await importStructuredExportPackage(file, options);
  } catch (error) {
    reportPersistenceError({
      label: '[store:import]',
      store: 'import',
      operation: 'import-preflight-failed',
      stage: 'package-preflight',
      integrity: 'failed',
      rowCount: 0,
      fingerprint: fingerprintDiagnosticId(`package:${file.size}:${file.type}`)
    }, error);
    throw error;
  }
}
