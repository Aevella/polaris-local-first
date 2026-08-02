import React from 'react';
import ReactDOM from 'react-dom/client';
import { installBootRescueSurface } from './app/bootstrap/bootRescueSurface';
import { installClientDiagnosticsReporter } from './app/bootstrap/clientDiagnosticsReporter';
import { installGlobalClientErrorLogging } from './app/bootstrap/clientErrorLog';
import { initializeRuntimeStoreLocalDataBackend } from './app/bootstrap/storeLocalDataBackendBootstrap';
import { recordAppRuntimeLogEntry } from './infrastructure/appRuntimeLog';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import { AppShell } from './ui/AppShell';
import './app/bootstrap/appLayoutSurfaceBootstrap';
import './app/bootstrap/nativeShellBootstrap';
import './styles/tokens.css';
import './styles/base.css';

installGlobalClientErrorLogging();
installClientDiagnosticsReporter();
const rootElement = document.getElementById('root');
const bootRescueSurface = installBootRescueSurface({ root: rootElement });

recordAppRuntimeLogEntry({
  at: Date.now(),
  kind: 'startup',
  title: '应用启动',
  detail: 'app-shell · 空 root boot 面承接到 React 挂载'
});

async function startApplication() {
  // Install the one LocalData backend, reconcile only already-active pointers left behind by old
  // clean builds, then finish or abandon any durable asset-import stage before stores hydrate.
  await initializeRuntimeStoreLocalDataBackend();
  ReactDOM.createRoot(rootElement!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <AppShell />
      </AppErrorBoundary>
    </React.StrictMode>
  );
  bootRescueSurface.watchReactRoot();
}

void startApplication();
