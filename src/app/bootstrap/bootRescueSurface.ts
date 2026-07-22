import type { StoreTransferProgressReporter } from '../../stores/storeImportProgress';

type BootRescueSurfaceOptions = {
  root: HTMLElement | null;
  timeoutMs?: number;
  exportPersistedBackup?: (options: {
    downloadFile: (blob: Blob, fileName: string) => void;
    onProgress: StoreTransferProgressReporter;
  }) => Promise<void>;
};

type BootRescueSurface = {
  watchReactRoot(): void;
  dispose(): void;
};

const DEFAULT_BOOT_RESCUE_TIMEOUT_MS = 18000;

function describeError(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return '应用启动失败。';
}

function downloadBlobInBrowser(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function rootHasMountedContent(root: HTMLElement) {
  return root.childElementCount > 0 || Boolean(root.textContent?.trim());
}

async function exportPersistedBackupByDefault(options: {
  downloadFile: (blob: Blob, fileName: string) => void;
  onProgress: StoreTransferProgressReporter;
}) {
  const { exportPersistedCompleteBackup } = await import('../shell/persistedBackupExport');
  await exportPersistedCompleteBackup(options);
}

export function installBootRescueSurface({
  root,
  timeoutMs = DEFAULT_BOOT_RESCUE_TIMEOUT_MS,
  exportPersistedBackup = exportPersistedBackupByDefault
}: BootRescueSurfaceOptions): BootRescueSurface {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !root) {
    return {
      watchReactRoot: () => undefined,
      dispose: () => undefined
    };
  }

  let reactRootMounted = false;
  let rescueVisible = false;
  let bootTimer: number | null = null;
  let mountWatchTimer: number | null = null;

  const clearBootTimer = () => {
    if (bootTimer !== null) {
      window.clearTimeout(bootTimer);
      bootTimer = null;
    }
  };

  const clearMountWatchTimer = () => {
    if (mountWatchTimer !== null) {
      window.clearTimeout(mountWatchTimer);
      mountWatchTimer = null;
    }
  };

  const setStatus = (statusNode: HTMLElement, message: string, isError = false) => {
    statusNode.textContent = message;
    statusNode.className = `app-error-backup-status${isError ? ' is-error' : ''}`;
    statusNode.hidden = false;
  };

  const showRescue = (reason: string) => {
    if (reactRootMounted || rescueVisible) return;
    rescueVisible = true;
    clearBootTimer();
    clearMountWatchTimer();

    const main = document.createElement('main');
    main.className = 'app-error-boundary';
    main.setAttribute('role', 'alert');

    const card = document.createElement('section');
    card.className = 'app-error-card';

    const kicker = document.createElement('small');
    kicker.textContent = 'Polaris 启动没有完成';

    const title = document.createElement('h1');
    title.textContent = '先把数据救出来';

    const copy = document.createElement('p');
    copy.textContent = '界面还没成功打开。可以先导出已保存的完整备份，再重新打开应用。';

    const code = document.createElement('div');
    code.className = 'app-error-code';
    code.textContent = reason;

    const status = document.createElement('div');
    status.className = 'app-error-backup-status';
    status.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'app-error-actions';

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = '导出完整备份';

    const reloadButton = document.createElement('button');
    reloadButton.type = 'button';
    reloadButton.textContent = '重新打开';
    reloadButton.addEventListener('click', () => window.location.reload());

    exportButton.addEventListener('click', async () => {
      try {
        exportButton.disabled = true;
        setStatus(status, '读取已保存数据');
        await exportPersistedBackup({
          downloadFile: downloadBlobInBrowser,
          onProgress: (progress) => {
            const suffix = typeof progress.current === 'number' && typeof progress.total === 'number'
              ? ` ${progress.current}/${progress.total}`
              : '';
            setStatus(status, `${progress.message}${suffix}`);
          }
        });
        setStatus(status, '备份已导出');
      } catch (error) {
        setStatus(status, describeError(error) || '导出备份包失败。', true);
      } finally {
        exportButton.disabled = false;
      }
    });

    actions.append(exportButton, reloadButton);
    card.append(kicker, title, copy, code, status, actions);
    main.append(card);
    root.replaceChildren(main);
  };

  const onWindowError = (event: ErrorEvent) => {
    if (reactRootMounted || rootHasMountedContent(root)) return;
    showRescue(describeError(event.error ?? event.message));
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (reactRootMounted || rootHasMountedContent(root)) return;
    showRescue(describeError(event.reason));
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  bootTimer = window.setTimeout(() => {
    if (!reactRootMounted && !rootHasMountedContent(root)) {
      showRescue('boot-timeout');
    }
  }, timeoutMs);

  const dispose = () => {
    clearBootTimer();
    clearMountWatchTimer();
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };

  const watchReactRoot = () => {
    const checkMounted = () => {
      if (rescueVisible) return;
      if (rootHasMountedContent(root)) {
        reactRootMounted = true;
        dispose();
        return;
      }
      mountWatchTimer = window.setTimeout(checkMounted, 250);
    };
    checkMounted();
  };

  return {
    watchReactRoot,
    dispose
  };
}
