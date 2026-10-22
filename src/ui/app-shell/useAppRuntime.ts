import { useEffect, useState } from 'react';
import { useAndroidApkUpdateRuntime } from '../../app/android/useAndroidApkUpdateRuntime';
import { useAutomaticConversationSummaryMemory } from '../../app/chat/useAutomaticConversationSummaryMemory';
import { useDesktopWorkspaceAutoSync } from '../../app/desktop/useDesktopWorkspaceAutoSync';
import { usePersistentStoreLifecycle } from '../../app/bootstrap/usePersistentStoreLifecycle';
import { useAppTriggerRuntime, type AppTriggerChatRuntimePort } from '../../app/shell/useAppTriggerRuntime';
import type { AppLanguage } from '../../i18n';
import { useDeveloperModeRuntime } from '../useDeveloperModeRuntime';
import { useIosKeyboardAccessoryBar } from '../useIosKeyboardAccessoryBar';
import { useCompanionRuntime } from '../useCompanionRuntime';
import { useMcpSessionLifecycle } from '../useMcpSessionLifecycle';
import { useRequestDebugState } from '../useRequestDebugState';
import { useScreenshotDebugOverlay } from '../useScreenshotDebugOverlay';
import { useViewportShellVars } from '../useViewportShellVars';
import { useCollectionOwnershipBackfill } from './useCollectionOwnershipBackfill';
import {
  DEVELOPER_DEBUG_ROUTE_SYNC_EVENTS,
  readDebugSurfaceEnabled,
  subscribeWindowSyncEvents
} from '../developer/debugSurfaceState';
import { usePersistenceReadFailureNotice } from './usePersistenceReadFailureNotice';
import type { Conversation } from '../../types/domain';

function readAssetGovernanceDebugEnabled() {
  return readDebugSurfaceEnabled({ developerMode: true, queryParams: ['debugAssets'] });
}

type UseAppRuntimeArgs = {
  appLanguage: AppLanguage;
  chatRuntime: AppTriggerChatRuntimePort;
  collectionOwnershipBackfill: {
    collectionHydrated: boolean;
    conversations: Conversation[];
    backfillOwnershipFromConversations: (conversations: Conversation[]) => void;
  };
  screenshotDebugOverlayEnabled: boolean;
};

export function useAppRuntime({
  appLanguage,
  chatRuntime,
  collectionOwnershipBackfill,
  screenshotDebugOverlayEnabled
}: UseAppRuntimeArgs) {
  useDeveloperModeRuntime();
  const persistentStoreLifecycle = usePersistentStoreLifecycle();
  const backgroundRuntimeReady = (
    persistentStoreLifecycle.startupThemeReady
    && persistentStoreLifecycle.startupStoresReady
  );
  useIosKeyboardAccessoryBar();
  useViewportShellVars();
  useCompanionRuntime({ enabled: backgroundRuntimeReady });
  useMcpSessionLifecycle({ enabled: backgroundRuntimeReady });
  useDesktopWorkspaceAutoSync();
  useAndroidApkUpdateRuntime({ enabled: backgroundRuntimeReady });
  useAutomaticConversationSummaryMemory({ startupReady: backgroundRuntimeReady });
  useCollectionOwnershipBackfill({
    startupReady: backgroundRuntimeReady,
    ...collectionOwnershipBackfill
  });
  useAppTriggerRuntime({ chatRuntime, startupReady: backgroundRuntimeReady });

  const persistenceReadFailureNotice = usePersistenceReadFailureNotice(
    backgroundRuntimeReady
  );
  const screenshotDebugOverlay = useScreenshotDebugOverlay(screenshotDebugOverlayEnabled);
  const requestDebug = useRequestDebugState();
  const [showAssetGovernanceDebug, setShowAssetGovernanceDebug] = useState(() => readAssetGovernanceDebugEnabled());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncVisibility = () => {
      setShowAssetGovernanceDebug(readAssetGovernanceDebugEnabled());
    };

    syncVisibility();
    const unsubscribeSyncEvents = subscribeWindowSyncEvents(DEVELOPER_DEBUG_ROUTE_SYNC_EVENTS, syncVisibility);

    return () => {
      unsubscribeSyncEvents();
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = appLanguage;
    document.documentElement.dataset.polarisLanguage = appLanguage;
  }, [appLanguage]);

  const retryPersistenceReadFailure = () => {
    if (typeof window === 'undefined') return;
    window.location.reload();
  };

  return {
    persistentStoreLifecycle,
    persistenceReadFailureNotice,
    retryPersistenceReadFailure,
    screenshotDebugOverlay,
    requestDebug,
    showAssetGovernanceDebug
  };
}
