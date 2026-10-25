import { useMenuSheetController } from '../../app/shell/useMenuSheetController';
import { MEMORY_RELEASE_GATES } from '../../config/memoryReleaseGates';
import type { MenuOverlayPage } from '../../app/shell/appShellContracts';
import type { ThemeState } from '../../types/domain';
import { MenuBackupPage } from './menu/MenuBackupPage';
import { MenuGatewayPage } from './menu/MenuGatewayPage';
import { MenuGenerationPage } from './menu/MenuGenerationPage';
import { MenuMcpPage } from './menu/MenuMcpPage';
import { MenuMemoryPage } from './menu/MenuMemoryPage';
import { MenuAutomationPage } from './menu/MenuAutomationPage';
import { MenuDocsPage } from './menu/MenuDocsPage';
import { MenuDesktopLocalPage } from './menu/MenuDesktopLocalPage';
import { MenuDisplayPage } from './menu/MenuDisplayPage';
import { MenuFontsPage } from './menu/MenuFontsPage';
import { MenuRootPage } from './menu/MenuRootPage';
import { MenuStoragePage } from './menu/MenuStoragePage';
import { MenuToolboxPage } from './menu/MenuToolboxPage';
import { MenuUsagePage } from './menu/MenuUsagePage';
import { MenuVoicePage } from './menu/MenuVoicePage';
import { RuntimePerformanceSurfaceMounted } from '../runtime-performance/RuntimePerformanceSurfaceSignals';
import { useRef } from 'react';

type MenuPage = MenuOverlayPage;

type MenuSheetProps = {
  open: boolean;
  initialPage?: MenuPage;
  theme: ThemeState;
  onClose: () => void;
  onOpenApi: (returnPage: MenuPage) => void;
};

export function MenuSheet({
  open,
  initialPage = 'root',
  theme,
  onClose,
  onOpenApi
}: MenuSheetProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const controller = useMenuSheetController({
    open,
    initialPage,
    onOpenApi,
    ui: {
      alert: (message) => window.alert(message),
      confirm: (message) => window.confirm(message),
      downloadFile: (blob, fileName) => {
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        window.URL.revokeObjectURL(url);
      },
      triggerBrowserImportPicker: () => {
        importInputRef.current?.click();
      },
      triggerBrowserFontPicker: () => {
        fontInputRef.current?.click();
      }
    }
  });

  if (!open) return null;
  const visiblePage = controller.page === 'desktopLocal' && !controller.desktopLocalAvailable
    ? 'root'
    : controller.page === 'memory' && !MEMORY_RELEASE_GATES.showGlobalConversationSummarySettings
      ? 'root'
      : controller.page;

  return (
    <div
      className="settings-overlay menu-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="settings-sheet menu-sheet">
        <RuntimePerformanceSurfaceMounted surface="menu-sheet" />
        <div className="sheet-handle" />
        <input
          ref={importInputRef}
          type="file"
          hidden
          accept="application/zip,application/json,application/vnd.sqlite3,.zip,.json,.db,.sqlite,.sqlite3"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = '';
            void controller.onImportBrowserFileSelected(file);
          }}
        />
        <input
          ref={fontInputRef}
          type="file"
          hidden
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/font-woff,application/font-woff2"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = '';
            void controller.onImportFontBrowserFileSelected(file);
          }}
        />
        {visiblePage === 'root' ? (
          <MenuRootPage
            enabledToolGroupsCount={controller.enabledToolGroupsCount}
            enabledMcpServerCount={controller.mcpServers.filter((server) => server.isActive).length}
            mcpServerCount={controller.mcpServers.length}
            tokenUsageSummary={controller.tokenUsageSummary}
            customFontCount={controller.customFontCount}
            storageHealthSnapshot={controller.storageHealthSnapshot}
            memorySettingsVisible={MEMORY_RELEASE_GATES.showGlobalConversationSummarySettings}
            desktopLocalAvailable={controller.desktopLocalAvailable}
            androidApkUpdateAvailable={controller.androidApkUpdateAvailable}
            onOpenDisplay={() => controller.onSetPage('display')}
            onOpenFonts={() => controller.onSetPage('fonts')}
            onOpenMemory={() => controller.onSetPage('memory')}
            onOpenGeneration={() => controller.onSetPage('generation')}
            onOpenVoice={() => controller.onSetPage('voice')}
            onOpenToolbox={() => controller.onSetPage('toolbox')}
            onOpenMcp={() => controller.onSetPage('mcp')}
            onOpenDesktopLocal={() => controller.onSetPage('desktopLocal')}
            onOpenUsage={() => controller.onSetPage('usage')}
            onOpenStorage={() => controller.onSetPage('storage')}
            onOpenDocs={() => controller.onSetPage('docs')}
            onOpenApi={controller.onOpenApiFromRoot}
            onOpenGateway={() => controller.onSetPage('gateway')}
            onOpenBackup={() => controller.onSetPage('backup')}
            onOpenPrivacy={() => controller.onSetPage('privacy')}
            onClose={onClose}
            onCheckAndroidApkUpdate={() => {
              void controller.onCheckAndroidApkUpdate();
            }}
          />
        ) : null}
        {visiblePage === 'backup' ? (
          <MenuBackupPage
            webdav={controller.webdav}
            readyForWebDav={controller.readyForWebDav}
            busy={controller.busy}
            localBackupAvailable={controller.localBackupAvailable}
            exportingData={controller.exportingData}
            importingData={controller.importingData}
            exportingWebDav={controller.exportingWebDav}
            importingWebDav={controller.importingWebDav}
            localExportDetail={controller.localExportDetail}
            localImportDetail={controller.localImportDetail}
            localExportProgress={controller.localExportProgress}
            localImportProgress={controller.localImportProgress}
            onBack={() => controller.onSetPage('root')}
            onSetWebDavEndpoint={controller.onSetWebDavEndpoint}
            onSetWebDavUsername={controller.onSetWebDavUsername}
            onSetWebDavPassword={controller.onSetWebDavPassword}
            onExportData={() => {
              void controller.onExportData();
            }}
            onImportData={() => {
              void controller.onImportData();
            }}
            onExportToWebDav={() => {
              void controller.onExportToWebDav();
            }}
            onImportFromWebDav={() => {
              void controller.onImportFromWebDav();
            }}
          />
        ) : null}
        {visiblePage === 'gateway' ? (
          <MenuGatewayPage
            api={controller.api}
            providerRouteLabelKey={controller.providerRouteLabelKey}
            providerProtocolLabelKey={controller.providerProtocolLabelKey}
            onBack={() => controller.onSetPage('root')}
            onOpenApi={controller.onOpenApiFromGateway}
            onCreateGatewayProvider={controller.onApplyGatewayPreset}
            onSetApiConfig={controller.onSetApiConfig}
          />
        ) : null}
        {visiblePage === 'toolbox' ? (
          <MenuToolboxPage
            theme={theme}
            search={controller.search}
            toolPromptPreferences={controller.toolPromptPreferences}
            desktopLocalAvailable={controller.desktopLocalAvailable}
            memorySearchAvailable={controller.memorySearchAvailable}
            personalDataStatus={controller.personalDataStatus}
            taskModeEnabled={controller.taskModeEnabled}
            onBack={() => controller.onSetPage('root')}
            onOpenMemorySettings={() => controller.onSetPage('memory')}
            onRefreshPersonalDataStatus={controller.onRefreshPersonalDataStatus}
            onRequestPersonalCalendarAccess={controller.onRequestPersonalCalendarAccess}
            onSetToolPromptGroupEnabled={controller.onSetToolPromptGroupEnabled}
            onSetThemeToolMode={controller.onSetThemeToolMode}
            onSetSearchConfig={controller.onSetSearchConfig}
            onSetTaskModeEnabled={controller.onSetTaskModeEnabled}
          />
        ) : null}
        {visiblePage === 'memory' ? (
          <MenuMemoryPage
            conversationSummaryModel={controller.conversationSummaryModel}
            memoryVectorRetrieval={controller.memoryVectorRetrieval}
            providers={controller.providers}
            onBack={() => controller.onSetPage('root')}
            onSetConversationSummaryModel={controller.onSetConversationSummaryModel}
            onSetMemoryVectorRetrieval={controller.onSetMemoryVectorRetrieval}
          />
        ) : null}
        {visiblePage === 'generation' ? (
          <MenuGenerationPage
            imageGeneration={controller.imageGeneration}
            providers={controller.providers}
            onBack={() => controller.onSetPage('root')}
            onSetImageGeneration={controller.onSetImageGeneration}
          />
        ) : null}
        {visiblePage === 'voice' ? (
          <MenuVoicePage
            voiceGeneration={controller.voiceGeneration}
            onBack={() => controller.onSetPage('root')}
            onSetVoiceGeneration={controller.onSetVoiceGeneration}
          />
        ) : null}
        {visiblePage === 'mcp' ? (
          <MenuMcpPage
            mcpServers={controller.mcpServers}
            timeoutSeconds={controller.mcpToolTimeoutSeconds}
            onBack={() => controller.onSetPage('root')}
            onSetTimeoutSeconds={controller.onSetMcpToolTimeoutSeconds}
            onSetServers={controller.onSetMcpServers}
            onCreateServer={controller.onCreateMcpServer}
            onUpdateServer={controller.onUpdateMcpServer}
            onDeleteServer={controller.onDeleteMcpServer}
          />
        ) : null}
        {visiblePage === 'desktopLocal' ? (
          <MenuDesktopLocalPage
            onBack={() => controller.onSetPage('root')}
          />
        ) : null}
        {visiblePage === 'automation' ? (
          <MenuAutomationPage
            personas={controller.personas}
            conversations={controller.conversations}
            triggerRules={controller.triggerRules}
            onBack={() => controller.onSetPage('root')}
            onCreateTriggerRule={controller.onCreateAutomationRule}
            onUpdateTriggerRule={controller.onUpdateAutomationRule}
            onDeleteTriggerRule={controller.onDeleteAutomationRule}
            onTestTriggerRule={controller.onTestAutomationRule}
            onCopyTriggerUrl={controller.onCopyAutomationTriggerUrl}
            onAfterTestTriggerRule={onClose}
          />
        ) : null}
        {visiblePage === 'usage' ? (
          <MenuUsagePage
            summary={controller.tokenUsageSummary}
            onBack={() => controller.onSetPage('root')}
          />
        ) : null}
        {visiblePage === 'display' ? (
          <MenuDisplayPage
            displayPreferences={controller.displayPreferences}
            onBack={() => controller.onSetPage('root')}
            onSetTopbarLayout={controller.onSetTopbarLayout}
            onSetAppearance={controller.onSetAppearance}
            onSetHapticsEnabled={controller.onSetHapticsEnabled}
          />
        ) : null}
        {visiblePage === 'fonts' ? (
          <MenuFontsPage
            customization={controller.customization}
            displayPreferences={controller.displayPreferences}
            onBack={() => controller.onSetPage('root')}
            onImportFont={controller.onImportFont}
            onSetFontScale={controller.onSetDisplayFontScale}
            onSetCustomFontScope={controller.onSetCustomFontScope}
            onDeleteCustomFont={controller.onDeleteCustomFont}
          />
        ) : null}
        {visiblePage === 'storage' ? (
          <MenuStoragePage
            snapshot={controller.storageHealthSnapshot}
            error={controller.storageHealthError}
            runtimeLogEntries={controller.runtimeLogEntries}
            refreshing={controller.refreshingStorageHealth}
            clearingDiagnostics={controller.clearingDiagnostics}
            clearingConversationAttachments={controller.clearingConversationAttachments}
            clearingOrphanAssets={controller.clearingOrphanAssets}
            clearingRedundantPreviews={controller.clearingRedundantPreviews}
            onBack={() => controller.onSetPage('root')}
            onRefresh={() => {
              void controller.onRefreshStorageHealth();
            }}
            onClearDiagnostics={() => {
              void controller.onClearDiagnostics();
            }}
            onClearOrphanAssets={() => {
              void controller.onClearOrphanAssets();
            }}
            onClearConversationAttachmentCopies={() => {
              void controller.onClearConversationAttachmentCopies();
            }}
            onClearRedundantAssetPreviews={() => {
              void controller.onClearRedundantAssetPreviews();
            }}
          />
        ) : null}
        {visiblePage === 'docs' ? (
          <MenuDocsPage
            initialDocId="user-guide"
            onBack={() => controller.onSetPage('root')}
          />
        ) : null}
        {visiblePage === 'privacy' ? (
          <MenuDocsPage
            initialDocId="privacy"
            onBack={() => controller.onSetPage('root')}
          />
        ) : null}
      </div>
    </div>
  );
}
