import { useEffect, useMemo, useState } from 'react';
import type { RequestDebugEntry } from '../../engines/request/requestDebugRuntime';
import type { LocalDataHealthSnapshot } from '../../infrastructure/localDataHealth';
import type { LocalRuntimeLogEntry } from './localRuntimeLog';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { useRuntimeStore, selectRuntimeApi } from '../../stores/runtimeStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useI18n } from '../../i18n';
import { EMPTY_MENU_TOKEN_USAGE_SUMMARY, summarizeMenuTokenUsage } from './menuTokenUsage';
import { useMenuAndroidUpdateController } from './useMenuAndroidUpdateController';
import { useMenuAutomationController } from './useMenuAutomationController';
import { useMenuBackupTransferController } from './useMenuBackupTransferController';
import { useMenuFontLibraryController } from './useMenuFontLibraryController';
import { useMenuGatewayController } from './useMenuGatewayController';
import { useMenuGenerationSettingsController } from './useMenuGenerationSettingsController';
import { useMenuToolboxController } from './useMenuToolboxController';
import { createMenuStorageMaintenanceActions } from './menuStorageMaintenanceActions';

export type MenuPage = 'root' | 'backup' | 'gateway' | 'memory' | 'generation' | 'voice' | 'toolbox' | 'mcp' | 'desktopLocal' | 'automation' | 'usage' | 'display' | 'fonts' | 'storage' | 'docs' | 'privacy';
const REQUEST_DEBUG_EVENT = 'polaris:request-debug-updated';

export function shouldSyncMenuRequestEntries(open: boolean, page: MenuPage) {
  return open && (page === 'usage' || page === 'storage');
}

export function shouldBuildMenuTokenUsageSummary(open: boolean, page: MenuPage) {
  return open && page === 'usage';
}

export function shouldIncludeMenuRequestUsageReceipts(page: MenuPage) {
  return page === 'usage';
}

export function shouldRefreshMenuStorageHealth(open: boolean, page: MenuPage) {
  return open && page === 'storage';
}

export function shouldRefreshMenuRuntimeLog(open: boolean, page: MenuPage) {
  return open && page === 'storage';
}

type UseMenuSheetControllerArgs = {
  open: boolean;
  initialPage?: MenuPage;
  onOpenApi: (returnPage: MenuPage) => void;
  ui: {
    alert: (message: string) => void;
    confirm: (message: string) => boolean;
    downloadFile: (blob: Blob, fileName: string) => void;
    triggerBrowserImportPicker: () => void;
    triggerBrowserFontPicker: () => void;
  };
};

export function useMenuSheetController({
  open,
  initialPage = 'root',
  onOpenApi,
  ui
}: UseMenuSheetControllerArgs) {
  const copy = useI18n();
  const api = useRuntimeStore(selectRuntimeApi);
  const providers = useRuntimeStore((state) => state.providers);
  const webdav = useRuntimeStore((state) => state.webdav);
  const search = useRuntimeStore((state) => state.search);
  const conversationSummaryModel = useRuntimeStore((state) => state.conversationSummaryModel);
  const memoryVectorRetrieval = useRuntimeStore((state) => state.memoryVectorRetrieval);
  const imageGeneration = useRuntimeStore((state) => state.imageGeneration);
  const voiceGeneration = useRuntimeStore((state) => state.voiceGeneration);
  const toolPromptPreferences = useRuntimeStore((state) => state.toolPromptPreferences);
  const taskModeEnabled = useRuntimeStore((state) => state.taskModeEnabled);
  const mcpServers = useRuntimeStore((state) => state.mcpServers);
  const mcpToolTimeoutSeconds = useRuntimeStore((state) => state.mcpToolTimeoutSeconds);
  const companionHost = useRuntimeStore((state) => state.companionHost);
  const triggerRules = useRuntimeStore((state) => state.triggerRules);
  const createTriggerRule = useRuntimeStore((state) => state.createTriggerRule);
  const updateTriggerRule = useRuntimeStore((state) => state.updateTriggerRule);
  const deleteTriggerRule = useRuntimeStore((state) => state.deleteTriggerRule);
  const personas = usePersonaStore((state) => state.personas);
  const activeCollaboratorId = usePersonaStore((state) => state.activeCollaboratorId);
  const createProvider = useRuntimeStore((state) => state.createProvider);
  const setWebDavConfig = useRuntimeStore((state) => state.setWebDavConfig);
  const setSearchConfig = useRuntimeStore((state) => state.setSearchConfig);
  const setConversationSummaryModel = useRuntimeStore((state) => state.setConversationSummaryModel);
  const setMemoryVectorRetrieval = useRuntimeStore((state) => state.setMemoryVectorRetrieval);
  const setImageGeneration = useRuntimeStore((state) => state.setImageGeneration);
  const setVoiceGeneration = useRuntimeStore((state) => state.setVoiceGeneration);
  const setToolPromptGroupEnabled = useRuntimeStore((state) => state.setToolPromptGroupEnabled);
  const setTaskModeEnabled = useRuntimeStore((state) => state.setTaskModeEnabled);
  const setMcpServers = useRuntimeStore((state) => state.setMcpServers);
  const createMcpServer = useRuntimeStore((state) => state.createMcpServer);
  const updateMcpServer = useRuntimeStore((state) => state.updateMcpServer);
  const deleteMcpServer = useRuntimeStore((state) => state.deleteMcpServer);
  const setMcpToolTimeoutSeconds = useRuntimeStore((state) => state.setMcpToolTimeoutSeconds);
  const duplicateProvider = useRuntimeStore((state) => state.duplicateProvider);
  const setApiConfig = useRuntimeStore((state) => state.setApiConfig);
  const setThemeToolMode = useSpaceStore((state) => state.setThemeToolMode);
  const customization = useSpaceStore((state) => state.customization);
  const displayPreferences = useSpaceStore((state) => state.displayPreferences);
  const setCustomization = useSpaceStore((state) => state.setCustomization);
  const setDisplayPreferences = useSpaceStore((state) => state.setDisplayPreferences);
  const conversations = useChatStore((state) => state.conversations);

  const [page, setPage] = useState<MenuPage>(() => initialPage);
  const [requestDebugEntries, setRequestDebugEntries] = useState<RequestDebugEntry[]>([]);
  const [storageHealthSnapshot, setStorageHealthSnapshot] = useState<LocalDataHealthSnapshot | null>(null);
  const [storageHealthError, setStorageHealthError] = useState<string | null>(null);
  const [runtimeLogEntries, setRuntimeLogEntries] = useState<LocalRuntimeLogEntry[]>([]);
  const [refreshingStorageHealth, setRefreshingStorageHealth] = useState(false);
  const [clearingDiagnostics, setClearingDiagnostics] = useState(false);
  const [clearingConversationAttachments, setClearingConversationAttachments] = useState(false);
  const [clearingOrphanAssets, setClearingOrphanAssets] = useState(false);
  const [clearingRedundantPreviews, setClearingRedundantPreviews] = useState(false);

  useEffect(() => {
    if (open) setPage(initialPage);
  }, [open, initialPage]);

  useEffect(() => {
    if (!shouldSyncMenuRequestEntries(open, page) || typeof window === 'undefined') return;

    let disposed = false;
    const syncRequestEntries = async () => {
      const { readRequestDebugEntries } = await import('../../engines/request/requestDebugRuntime');
      if (!disposed) {
        setRequestDebugEntries(readRequestDebugEntries());
        if (shouldRefreshMenuRuntimeLog(open, page)) {
          void refreshRuntimeLog();
        }
      }
    };
    const handleRequestDebugUpdated = () => {
      void syncRequestEntries();
    };

    void syncRequestEntries();
    window.addEventListener(REQUEST_DEBUG_EVENT, handleRequestDebugUpdated);

    return () => {
      disposed = true;
      window.removeEventListener(REQUEST_DEBUG_EVENT, handleRequestDebugUpdated);
    };
  }, [open, page]);

  const refreshStorageHealth = async (options?: { includeRuntimeLog?: boolean }) => {
    try {
      setRefreshingStorageHealth(true);
      const { readLocalDataHealthSnapshot } = await import('../../infrastructure/localDataHealth');
      const snapshot = await readLocalDataHealthSnapshot();
      setStorageHealthSnapshot(snapshot);
      setStorageHealthError(null);
      void import('../bootstrap/clientDiagnosticsReporter')
        .then(({ reportLocalDataHealthDiagnostics }) => reportLocalDataHealthDiagnostics(snapshot));
      if (options?.includeRuntimeLog) {
        await refreshRuntimeLog();
      }
    } catch (error) {
      setStorageHealthError(error instanceof Error ? error.message : '读取本地数据体检失败');
    } finally {
      setRefreshingStorageHealth(false);
    }
  };

  const refreshRuntimeLog = async () => {
    const { readLocalRuntimeLogEntries } = await import('./localRuntimeLog');
    setRuntimeLogEntries(readLocalRuntimeLogEntries());
  };

  useEffect(() => {
    if (!shouldRefreshMenuStorageHealth(open, page)) return;
    void refreshStorageHealth({
      includeRuntimeLog: shouldRefreshMenuRuntimeLog(open, page)
    });
  }, [open, page]);

  const backupTransfer = useMenuBackupTransferController({ ui, webdav });
  const fontLibrary = useMenuFontLibraryController({
    ui,
    customization,
    setCustomization,
    setPage
  });
  const toolbox = useMenuToolboxController({
    open,
    page,
    ui,
    toolPromptPreferences,
    setToolPromptGroupEnabled,
    setTaskModeEnabled,
    setThemeToolMode
  });
  const busy = backupTransfer.exportingData
    || backupTransfer.importingData
    || backupTransfer.exportingWebDav
    || backupTransfer.importingWebDav;
  const androidUpdate = useMenuAndroidUpdateController({ ui });
  const tokenUsageSummary = useMemo(() => {
    if (!shouldBuildMenuTokenUsageSummary(open, page)) return EMPTY_MENU_TOKEN_USAGE_SUMMARY;
    return summarizeMenuTokenUsage(
      conversations,
      shouldIncludeMenuRequestUsageReceipts(page) ? requestDebugEntries : []
    );
  }, [open, page, conversations, requestDebugEntries]);
  const gateway = useMenuGatewayController({
    api,
    onOpenApi,
    createProvider,
    duplicateProvider,
    setApiConfig
  });
  const automation = useMenuAutomationController({
    personas,
    triggerRules,
    companionHost,
    createTriggerRule,
    updateTriggerRule,
    deleteTriggerRule,
    ui,
    copy
  });
  const generationSettings = useMenuGenerationSettingsController({
    personas,
    activeCollaboratorId,
    conversationSummaryModel,
    memoryVectorRetrieval,
    imageGeneration,
    voiceGeneration,
    setConversationSummaryModel,
    setMemoryVectorRetrieval,
    setImageGeneration,
    setVoiceGeneration
  });

  const {
    clearDiagnostics,
    clearOrphanAssets,
    clearConversationAttachmentCopies,
    clearRedundantAssetPreviews
  } = createMenuStorageMaintenanceActions({
    ui,
    refreshStorageHealth,
    setClearingDiagnostics,
    setClearingConversationAttachments,
    setClearingOrphanAssets,
    setClearingRedundantPreviews
  });

  return {
    page,
    api,
    providers,
    webdav,
    search,
    conversationSummaryModel: generationSettings.conversationSummaryModel,
    memoryVectorRetrieval: generationSettings.memoryVectorRetrieval,
    memorySearchAvailable: generationSettings.memorySearchAvailable,
    personalDataStatus: toolbox.personalDataStatus,
    imageGeneration: generationSettings.imageGeneration,
    voiceGeneration: generationSettings.voiceGeneration,
    toolPromptPreferences,
    taskModeEnabled,
    customization,
    displayPreferences,
    customFontCount: fontLibrary.customFontCount,
    tokenUsageSummary,
    storageHealthSnapshot,
    storageHealthError,
    runtimeLogEntries,
    refreshingStorageHealth,
    clearingDiagnostics,
    clearingConversationAttachments,
    clearingOrphanAssets,
    clearingRedundantPreviews,
    mcpServers,
    mcpToolTimeoutSeconds,
    personas,
    conversations,
    triggerRules,
    providerRouteLabelKey: gateway.providerRouteLabelKey,
    providerProtocolLabelKey: gateway.providerProtocolLabelKey,
    busy,
    readyForWebDav: backupTransfer.readyForWebDav,
    exportingData: backupTransfer.exportingData,
    importingData: backupTransfer.importingData,
    exportingWebDav: backupTransfer.exportingWebDav,
    importingWebDav: backupTransfer.importingWebDav,
    enabledToolGroupsCount: toolbox.enabledToolGroupsCount,
    desktopLocalAvailable: toolbox.desktopLocalAvailable,
    onRefreshPersonalDataStatus: toolbox.onRefreshPersonalDataStatus,
    onRequestPersonalCalendarAccess: toolbox.onRequestPersonalCalendarAccess,
    enabledTriggerRulesCount: automation.enabledTriggerRulesCount,
    androidApkUpdateAvailable: androidUpdate.androidApkUpdateAvailable,
    localBackupAvailable: backupTransfer.localBackupAvailable,
    localExportDetail: backupTransfer.localExportDetail,
    localImportDetail: backupTransfer.localImportDetail,
    localExportProgress: backupTransfer.localExportProgress,
    localImportProgress: backupTransfer.localImportProgress,
    onSetPage: setPage,
    onOpenApiFromRoot: gateway.onOpenApiFromRoot,
    onOpenApiFromGateway: gateway.onOpenApiFromGateway,
    onSetWebDavEndpoint: (value: string) => setWebDavConfig({ endpoint: value }),
    onSetWebDavUsername: (value: string) => setWebDavConfig({ username: value }),
    onSetWebDavPassword: (value: string) => setWebDavConfig({ password: value }),
    onSetSearchConfig: setSearchConfig,
    onSetConversationSummaryModel: generationSettings.onSetConversationSummaryModel,
    onSetMemoryVectorRetrieval: generationSettings.onSetMemoryVectorRetrieval,
    onSetImageGeneration: generationSettings.onSetImageGeneration,
    onSetVoiceGeneration: generationSettings.onSetVoiceGeneration,
    onSetToolPromptGroupEnabled: toolbox.onSetToolPromptGroupEnabled,
    onSetThemeToolMode: setThemeToolMode,
    onSetTaskModeEnabled: toolbox.onSetTaskModeEnabled,
    onSetMcpServers: setMcpServers,
    onCreateMcpServer: createMcpServer,
    onUpdateMcpServer: updateMcpServer,
    onDeleteMcpServer: deleteMcpServer,
    onSetMcpToolTimeoutSeconds: setMcpToolTimeoutSeconds,
    onCreateAutomationRule: automation.onCreateAutomationRule,
    onUpdateAutomationRule: automation.onUpdateAutomationRule,
    onDeleteAutomationRule: automation.onDeleteAutomationRule,
    onTestAutomationRule: automation.onTestAutomationRule,
    onCopyAutomationTriggerUrl: automation.onCopyAutomationTriggerUrl,
    onSetCustomFontScope: fontLibrary.onSetCustomFontScope,
    onSetTopbarLayout: (topbarLayout: 'centered' | 'leading') => setDisplayPreferences({ topbarLayout }),
    onSetAppearance: (appearance: typeof displayPreferences.appearance) => setDisplayPreferences({ appearance }),
    onSetDisplayFontScale: (fontScale: number) => setDisplayPreferences({ fontScale }),
    onSetHapticsEnabled: (enabled: boolean) => setDisplayPreferences({ hapticsEnabled: enabled }),
    onDeleteCustomFont: fontLibrary.onDeleteCustomFont,
    onRefreshStorageHealth: () => refreshStorageHealth({ includeRuntimeLog: true }),
    onClearDiagnostics: clearDiagnostics,
    onClearOrphanAssets: clearOrphanAssets,
    onClearConversationAttachmentCopies: clearConversationAttachmentCopies,
    onClearRedundantAssetPreviews: clearRedundantAssetPreviews,
    onCheckAndroidApkUpdate: androidUpdate.onCheckAndroidApkUpdate,
    onSetApiConfig: gateway.onSetApiConfig,
    onApplyGatewayPreset: gateway.onApplyGatewayPreset,
    onImportBrowserFileSelected: backupTransfer.onImportBrowserFileSelected,
    onImportFont: fontLibrary.onImportFont,
    onImportFontBrowserFileSelected: fontLibrary.onImportFontBrowserFileSelected,
    onExportData: backupTransfer.onExportData,
    onImportData: backupTransfer.onImportData,
    onExportToWebDav: backupTransfer.onExportToWebDav,
    onImportFromWebDav: backupTransfer.onImportFromWebDav
  };
}
