import { getVisibleToolboxPromptGroups } from '../../../app/shell/menuToolboxGroups';
import type { PolarisToolPromptGroup } from '../../../engines/tool-protocol/assistantToolProtocolTypes';
import type { I18nKey } from '../../../i18n/messages';
import type { I18nTranslator } from '../../../i18n';
import type { NativePersonalDataStatus } from '../../../native/personalData';
import type { ThemeState, WebSearchConfig, WebSearchProviderType } from '../../../types/domain';
import { HelpHint } from '../../HelpHint';
import { Icon, type IconName } from '../../Icon';
import { useI18n } from '../../../i18n';
import {
  buildThemeToolModePanelDescription
} from '../../theme-tool-mode/themeToolModeGuidance';
import {
  ThemeToolModeInlineConfig,
  ToolboxToggleRow,
  WebSearchInlineConfig
} from './MenuToolboxInlineSections';

type MenuToolboxPageProps = {
  theme: ThemeState;
  search: WebSearchConfig;
  toolPromptPreferences: Record<PolarisToolPromptGroup, boolean>;
  desktopLocalAvailable: boolean;
  memorySearchAvailable: boolean;
  personalDataStatus: NativePersonalDataStatus;
  taskModeEnabled: boolean;
  onBack: () => void;
  onOpenMemorySettings: () => void;
  onRefreshPersonalDataStatus: () => void;
  onRequestPersonalCalendarAccess: () => void;
  onSetToolPromptGroupEnabled: (group: PolarisToolPromptGroup, enabled: boolean) => void;
  onSetThemeToolMode: (mode: ThemeState['toolMode']) => void;
  onSetSearchConfig: (patch: Partial<WebSearchConfig>) => void;
  onSetTaskModeEnabled: (enabled: boolean) => void;
};

const SEARCH_PROVIDER_LABEL_KEYS: Record<WebSearchProviderType, I18nKey> = {
  bingLocal: 'settings.toolbox.searchProviderDefault',
  bocha: 'settings.toolbox.searchProviderBocha',
  brave: 'settings.toolbox.searchProviderBrave',
  tavily: 'settings.toolbox.searchProviderTavily',
  custom: 'settings.toolbox.searchProviderCustom'
};

const TOOLBOX_TOGGLE_META: Record<PolarisToolPromptGroup, { icon: IconName; labelKey: I18nKey; descriptionKey: I18nKey }> = {
  environment: {
    icon: 'compass',
    labelKey: 'settings.toolbox.group.environment.label',
    descriptionKey: 'settings.toolbox.group.environment.detail'
  },
  task: {
    icon: 'task',
    labelKey: 'settings.toolbox.group.task.label',
    descriptionKey: 'settings.toolbox.group.task.detail'
  },
  room: {
    icon: 'navCard',
    labelKey: 'settings.toolbox.group.room.label',
    descriptionKey: 'settings.toolbox.group.room.detail'
  },
  project: {
    icon: 'navWorkspace',
    labelKey: 'settings.toolbox.group.project.label',
    descriptionKey: 'settings.toolbox.group.project.detail'
  },
  desktop: {
    icon: 'zap',
    labelKey: 'settings.toolbox.group.desktop.label',
    descriptionKey: 'settings.toolbox.group.desktop.detail'
  },
  theme: {
    icon: 'brush',
    labelKey: 'settings.toolbox.group.theme.label',
    descriptionKey: 'settings.toolbox.group.theme.detail'
  },
  attachment: {
    icon: 'folder',
    labelKey: 'settings.toolbox.group.attachment.label',
    descriptionKey: 'settings.toolbox.group.attachment.detail'
  },
  generation: {
    icon: 'zap',
    labelKey: 'settings.toolbox.group.generation.label',
    descriptionKey: 'settings.toolbox.group.generation.detail'
  },
  archive: {
    icon: 'inbox',
    labelKey: 'settings.toolbox.group.archive.label',
    descriptionKey: 'settings.toolbox.group.archive.detail'
  },
  web: {
    icon: 'search',
    labelKey: 'settings.toolbox.group.web.label',
    descriptionKey: 'settings.toolbox.group.web.detail'
  },
  personalData: {
    icon: 'inbox',
    labelKey: 'settings.toolbox.group.personalData.label',
    descriptionKey: 'settings.toolbox.group.personalData.detail'
  },
  mcp: {
    icon: 'mcpServer',
    labelKey: 'settings.toolbox.group.mcp.label',
    descriptionKey: 'settings.toolbox.group.mcp.detail'
  },
  knowledge: {
    icon: 'fileText',
    labelKey: 'settings.toolbox.group.knowledge.label',
    descriptionKey: 'settings.toolbox.group.knowledge.detail'
  },
  memory: {
    icon: 'fileText',
    labelKey: 'settings.toolbox.group.memory.label',
    descriptionKey: 'settings.toolbox.group.memory.detail'
  },
  memoryRecall: {
    icon: 'search',
    labelKey: 'settings.toolbox.group.memoryRecall.label',
    descriptionKey: 'settings.toolbox.group.memoryRecall.detail'
  },
  memoryWrite: {
    icon: 'feather',
    labelKey: 'settings.toolbox.group.memoryWrite.label',
    descriptionKey: 'settings.toolbox.group.memoryWrite.detail'
  },
  proactive: {
    icon: 'sparkle',
    labelKey: 'settings.toolbox.group.proactive.label',
    descriptionKey: 'settings.toolbox.group.proactive.detail'
  }
};

function getSearchProviderLabel(provider: WebSearchProviderType, t: I18nTranslator['t']) {
  return t(SEARCH_PROVIDER_LABEL_KEYS[provider]);
}

function personalDataPermissionLabel(permission: string, t: I18nTranslator['t']) {
  switch (permission) {
    case 'authorized':
      return t('settings.toolbox.permissionAuthorized');
    case 'notDetermined':
      return t('settings.toolbox.permissionNotDetermined');
    case 'denied':
      return t('settings.toolbox.permissionDenied');
    case 'restricted':
      return t('settings.toolbox.permissionRestricted');
    case 'writeOnly':
      return t('settings.toolbox.permissionWriteOnly');
    case 'unavailable':
      return t('settings.toolbox.permissionUnavailable');
    default:
      return permission;
  }
}

function PersonalDataInlineConfig({
  status,
  onRefresh,
  onRequestCalendar
}: {
  status: NativePersonalDataStatus;
  onRefresh: () => void;
  onRequestCalendar: () => void;
}) {
  const { t } = useI18n();
  const calendarReady = status.calendar.available
    && status.calendar.permission !== 'denied'
    && status.calendar.permission !== 'restricted';

  return (
    <>
      <span className="menu-section-kicker">{t('settings.toolbox.personalDataPermissions')}</span>
      <p className="menu-section-note">
        {t('settings.toolbox.personalDataPlatformNote', { platform: status.platform })}
      </p>
      <div className="theme-mode-guidance">
        <strong>{t('settings.toolbox.personalDataCalendarStatus', {
          status: calendarReady ? t('settings.toolbox.personalDataVisible') : t('settings.toolbox.personalDataHidden')
        })}</strong>
        <p>{personalDataPermissionLabel(status.calendar.permission, t)}{status.calendar.detail ? ` · ${status.calendar.detail}` : ''}</p>
      </div>
      <div className="theme-mode-switch">
        <button type="button" className="theme-mode-chip" onClick={onRequestCalendar}>
          {t('settings.toolbox.requestCalendar')}
        </button>
        <button type="button" className="theme-mode-chip" onClick={onRefresh}>
          {t('settings.toolbox.refreshStatus')}
        </button>
      </div>
    </>
  );
}

export function MenuToolboxPage({
  theme,
  search,
  toolPromptPreferences,
  desktopLocalAvailable,
  memorySearchAvailable,
  personalDataStatus,
  taskModeEnabled,
  onBack,
  onOpenMemorySettings,
  onRefreshPersonalDataStatus,
  onRequestPersonalCalendarAccess,
  onSetToolPromptGroupEnabled,
  onSetThemeToolMode,
  onSetSearchConfig,
  onSetTaskModeEnabled
}: MenuToolboxPageProps) {
  const { t } = useI18n();
  const visibleThemeToolMode = theme.toolMode === 'off' ? 'stable' : theme.toolMode;
  const themeModeDescription = buildThemeToolModePanelDescription(visibleThemeToolMode, t);
  const taskToolsEnabled = toolPromptPreferences.task;
  const searchRequiresKey = search.provider !== 'bingLocal';
  const activeSearchLabel = getSearchProviderLabel(search.provider, t);
  const visibleToolGroups = getVisibleToolboxPromptGroups({ desktopLocalAvailable });


  return (
    <div className="menu-sheet-page">
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title">
          <h2>{t('settings.toolbox.title')}</h2>
        </div>
      </div>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker menu-section-kicker-row">
            {t('settings.toolbox.alwaysOnSection')}
            <HelpHint
              label={t('settings.toolbox.alwaysOnHelpLabel')}
              text={t('settings.toolbox.alwaysOnHelpText')}
            />
          </span>
          <p className="menu-section-note">{t('settings.toolbox.alwaysOnNote')}</p>
        </div>
        <div className="memory-toggle-grid">
          {visibleToolGroups.map((group) => {
            const meta = TOOLBOX_TOGGLE_META[group];
            return (
              <ToolboxToggleRow
                key={group}
                icon={meta.icon}
                label={t(meta.labelKey)}
                description={t(meta.descriptionKey)}
                checked={toolPromptPreferences[group]}
                onToggle={() => onSetToolPromptGroupEnabled(group, !toolPromptPreferences[group])}
              >
                {group === 'theme' ? (
                  <ThemeToolModeInlineConfig
                    mode={visibleThemeToolMode}
                    description={themeModeDescription}
                    onSetMode={onSetThemeToolMode}
                  />
                ) : null}
                {group === 'web' ? (
                  <WebSearchInlineConfig
                    search={search}
                    activeLabel={activeSearchLabel}
                    requiresKey={searchRequiresKey}
                    onSetSearchConfig={onSetSearchConfig}
                  />
                ) : null}
                {group === 'memoryRecall' && !memorySearchAvailable ? (
                  <>
                    <span className="menu-section-kicker">{t('settings.toolbox.memoryRecallSection')}</span>
                    <p className="menu-section-note">{t('settings.toolbox.memoryRecallUnavailable')}</p>
                    <button
                      type="button"
                      className="memory-doc-import-btn"
                      onClick={onOpenMemorySettings}
                    >
                      {t('settings.toolbox.openMemorySettings')}
                    </button>
                  </>
                ) : null}
                {group === 'personalData' ? (
                  <PersonalDataInlineConfig
                    status={personalDataStatus}
                    onRefresh={onRefreshPersonalDataStatus}
                    onRequestCalendar={onRequestPersonalCalendarAccess}
                  />
                ) : null}
              </ToolboxToggleRow>
            );
          })}
        </div>
      </section>

      {taskToolsEnabled ? (
        <section className="menu-section">
          <div className="menu-section-head">
            <span className="menu-section-kicker menu-section-kicker-row">
              {t('settings.toolbox.quickAssistSection')}
              <HelpHint
                label={t('settings.toolbox.taskModeHelpLabel')}
                text={t('settings.toolbox.taskModeHelpText')}
              />
            </span>
            <p className="menu-section-note">{t('settings.toolbox.taskModeNote')}</p>
          </div>
          <ToolboxToggleRow
            icon="task"
            label={t('settings.toolbox.defaultTaskModeLabel')}
            description={t('settings.toolbox.defaultTaskModeDetail')}
            checked={taskModeEnabled}
            onToggle={() => onSetTaskModeEnabled(!taskModeEnabled)}
          />
        </section>
      ) : null}
    </div>
  );
}
