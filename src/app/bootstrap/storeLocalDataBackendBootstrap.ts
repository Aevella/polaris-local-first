import type { LocalDataBackend } from '../../engines/localData';
import {
  canUseNativeLocalDataSqlite,
  createNativeLocalDataSqliteBackend
} from '../../native/localDataSqlite';
import { installStoreLocalDataBackend } from '../../stores/storeLocalDataBackendHost';
import { recoverPendingAssetImportStage } from '../../infrastructure/assetStore';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import {
  reconcileLegacyActiveLocalDataPointers,
  type LegacyActivePointerReconciliationResult
} from '../../stores/localDataActivePointerReconciliation';

export type RuntimeStoreLocalDataBackendKind = 'native-sqlite' | 'kv-default';

export type RuntimeStoreLocalDataBackendInstall = {
  installed: boolean;
  backend: RuntimeStoreLocalDataBackendKind;
};

export type RuntimeStoreLocalDataBackendInitialization = RuntimeStoreLocalDataBackendInstall & {
  activePointerReconciliation: LegacyActivePointerReconciliationResult;
  assetImportRecovery: 'none' | 'abandoned' | 'published' | 'failed';
};

/**
 * Composition root for the store LocalData backend, run once at app startup before any store
 * hydrates or persists.
 *
 * On a native platform whose SQLite plugin is available, install the native SQLite backend as THE
 * single current fact source: every host-routed read/write/discovery then lands in SQLite.
 * Everywhere else (web, tests, non-native shells) install nothing, so the host keeps its KV
 * default. KV/memory stays a fallback for those environments, never a second concurrent source
 * alongside SQLite.
 *
 * This only CHOOSES where ordinary reads/writes land. It never promotes, migrates, or copies legacy
 * data — moving old data into SQLite-backed rows stays on the explicit migration/import boundary,
 * driven elsewhere. A fresh install simply starts writing its rows into the installed backend and
 * self-activates from those committed rows on first save.
 */
export function installRuntimeStoreLocalDataBackend(options: {
  canUseNativeSqlite?: () => boolean;
  createNativeBackend?: () => LocalDataBackend;
  install?: (backend: LocalDataBackend) => void;
} = {}): RuntimeStoreLocalDataBackendInstall {
  const canUseNativeSqlite = options.canUseNativeSqlite ?? canUseNativeLocalDataSqlite;
  if (!canUseNativeSqlite()) {
    return { installed: false, backend: 'kv-default' };
  }

  const createNativeBackend = options.createNativeBackend ?? createNativeLocalDataSqliteBackend;
  const install = options.install ?? installStoreLocalDataBackend;
  install(createNativeBackend());
  return { installed: true, backend: 'native-sqlite' };
}

export async function initializeRuntimeStoreLocalDataBackend(options: {
  installBackend?: typeof installRuntimeStoreLocalDataBackend;
  reconcileActivePointers?: typeof reconcileLegacyActiveLocalDataPointers;
  recoverAssetImport?: typeof recoverPendingAssetImportStage;
} = {}): Promise<RuntimeStoreLocalDataBackendInitialization> {
  const installed = (options.installBackend ?? installRuntimeStoreLocalDataBackend)();
  const activePointerReconciliation = await (options.reconcileActivePointers
    ?? reconcileLegacyActiveLocalDataPointers)();
  try {
    const assetImportRecovery = await (options.recoverAssetImport ?? recoverPendingAssetImportStage)();
    return { ...installed, activePointerReconciliation, assetImportRecovery };
  } catch (error) {
    reportPersistenceError({
      label: '[store:import:recovery]',
      store: 'asset',
      operation: 'recover-pending-import-stage',
      domain: 'asset',
      stage: 'startup-recovery',
      integrity: 'degraded',
      rowCount: 0
    }, error);
    return { ...installed, activePointerReconciliation, assetImportRecovery: 'failed' };
  }
}
