import { Suspense, lazy } from 'react';
import { AppShellView } from './app-shell/AppShellView';
import { useAppRuntime } from './app-shell/useAppRuntime';
import { useAppShellController } from './app-shell/useAppShellController';
import { useAppShellViewController } from './app-shell/useAppShellViewController';
import { WorldSwitchVeil } from './shell/WorldSwitchVeil';
import { ScreenshotDebugOverlay } from './ScreenshotDebugOverlay';
import { RequestDebugOverlay } from './RequestDebugOverlay';
import { closeDebugSurfaces } from './developer/debugSurfaceState';
import { useSpaceStore } from '../stores/spaceStore';
import { shouldShowWorldSwitchVeil } from '../app/shell/worldSwitchVeilVisibility';

const AssetGovernanceDebugLayer = lazy(() =>
  import('./AssetGovernanceDebugLayer').then((module) => ({ default: module.AssetGovernanceDebugLayer }))
);

export function AppShell() {
  const controller = useAppShellController();
  const appLanguage = useSpaceStore((state) => state.appLanguage);
  const screenshotDebugOverlayEnabled = useSpaceStore((state) => state.screenshotDebugOverlayEnabled);
  const appRuntime = useAppRuntime({
    appLanguage,
    chatRuntime: controller.chatRuntimePort,
    collectionOwnershipBackfill: controller.collectionOwnershipBackfillPort,
    screenshotDebugOverlayEnabled
  });
  const appShellView = useAppShellViewController({
    ...controller,
    startupThemeReady: appRuntime.persistentStoreLifecycle.startupThemeReady,
    persistenceReadFailureNotice: appRuntime.persistenceReadFailureNotice,
    onRetryPersistenceReadFailure: appRuntime.retryPersistenceReadFailure,
    onOpenBackupFromReadFailure: controller.openBackupSettings
  });

  return (
    <>
      <AppShellView {...appShellView} />
      {shouldShowWorldSwitchVeil(
        controller.activeWorld,
        controller.customization.showWorldSwitchHandle
      ) ? (
        <WorldSwitchVeil
          activeWorld={controller.activeWorld}
          canReviveTheme={controller.canReviveTheme}
          onToggleWorld={controller.topbarProps.actions.onToggleWorld}
          onReviveLastSkin={controller.restoreLastThemeSkin}
          onRestoreDefaultTheme={controller.restoreDefaultTheme}
        />
      ) : null}
      <ScreenshotDebugOverlay
        visible={appRuntime.screenshotDebugOverlay.visible}
        capturedAt={appRuntime.screenshotDebugOverlay.capturedAt}
        topbarState={controller.topbarProps.state}
        activeConversationTitle={controller.screenshotDebugContext.activeConversationTitle}
        activeConversationMessageCount={controller.screenshotDebugContext.activeConversationMessageCount}
        activeConversationCollaboratorName={controller.screenshotDebugContext.activeConversationCollaboratorName}
        frontstageCollaboratorName={controller.screenshotDebugContext.frontstageCollaboratorName}
      />
      <RequestDebugOverlay
        enabled={appRuntime.requestDebug.enabled}
        latestEntry={appRuntime.requestDebug.latestEntry}
        entryCount={appRuntime.requestDebug.entryCount}
        clearEntries={appRuntime.requestDebug.clearEntries}
        onClose={closeDebugSurfaces}
      />
      {appRuntime.showAssetGovernanceDebug ? (
        <Suspense fallback={null}>
          <AssetGovernanceDebugLayer onClose={closeDebugSurfaces} />
        </Suspense>
      ) : null}
    </>
  );
}
