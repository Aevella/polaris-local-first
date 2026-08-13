import { useState } from 'react';
import { useThemeStudioController } from '../../../../app/theme/useThemeStudioController';
import { exportThemeFile } from '../../../../app/theme/themeFileExport';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import { useSpaceThemeSessionBindings } from '../../../../stores/spaceStoreThemeSessionBindings';
import type { I18nKey } from '../../../../i18n/messages';
import { useI18n } from '../../../../i18n/useI18n';
import { CustomCssSection } from '../../../sheets/themeStudio/CustomCssSection';
import { CollaboratorAvatarEditor } from '../../../collection/info/CollaboratorAvatarEditor';
import { Icon, type IconName } from '../../../Icon';
import { PersonaToggle } from '../PersonaToggle';
import { type PersonaTabProps } from '../personaUiShared';
import { RoomBackgroundSettingsSection } from './RoomBackgroundSettingsSection';
import { RoomStarSettingsSection } from './RoomStarSettingsSection';
import { RoomThemeActionsSection } from './RoomThemeActionsSection';
import { RoomThemeLibrarySection } from './RoomThemeLibrarySection';

type RoomThemePage = 'overview' | 'css' | 'library';

const ROOM_THEME_PAGES: Array<{
  id: RoomThemePage;
  labelKey: I18nKey;
  icon: IconName;
}> = [
  { id: 'overview', labelKey: 'room.settings.pageOverview', icon: 'layers' },
  { id: 'css', labelKey: 'room.settings.pageCss', icon: 'code' },
  { id: 'library', labelKey: 'room.settings.pageLibrary', icon: 'cardStack' }
];

function downloadThemeBlobInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function RoomSettingsTab({
  activePersona,
  onSelectPersonaAvatar,
  onSetPersonaAvatarIcon,
  onSetPersonaAvatarShape,
  onSetPersonaAvatarSize
}: PersonaTabProps) {
  const { t } = useI18n();
  const [activeThemePage, setActiveThemePage] = useState<RoomThemePage>('overview');
  const themeBindings = useSpaceThemeSessionBindings();
  const controller = useThemeStudioController(true, {
    copyText: async (text) => {
      await writeTextToClipboard(text);
      return true;
    },
    downloadFile: (blob, fileName) => exportThemeFile(blob, fileName, downloadThemeBlobInBrowser)
  });
  const roomName = activePersona?.name.trim() || t('room.settings.fallbackName');
  const showChatAvatars = themeBindings.customization.showChatAvatars;
  const showWorldSwitchHandle = themeBindings.customization.showWorldSwitchHandle;
  const canEditAvatars = Boolean(activePersona && onSelectPersonaAvatar && onSetPersonaAvatarIcon && onSetPersonaAvatarShape && onSetPersonaAvatarSize);

  return (
    <div className="room-settings-flow">
      <div className="room-theme-page-nav" role="tablist" aria-label={t('room.settings.pageNavAria')}>
        {ROOM_THEME_PAGES.map((page) => (
          <button
            key={page.id}
            type="button"
            role="tab"
            aria-selected={activeThemePage === page.id}
            className={activeThemePage === page.id ? 'active' : ''}
            onClick={() => setActiveThemePage(page.id)}
          >
            <Icon name={page.icon} size={14} />
            <span>{t(page.labelKey)}</span>
          </button>
        ))}
      </div>

      {activeThemePage === 'overview' ? (
        <>
          <section className="theme-studio-section room-toggle-section room-display-settings">
            <PersonaToggle
              label={t('room.settings.chatAvatarLayout')}
              description={t('room.settings.chatAvatarLayoutDetail')}
              checked={showChatAvatars}
              onToggle={() => themeBindings.setCustomization({ showChatAvatars: !showChatAvatars })}
            />

            {showChatAvatars && activePersona && canEditAvatars ? (
              <div className="room-avatar-settings">
                <div className="collaborator-avatar-inline-grid">
                  <CollaboratorAvatarEditor
                    compact
                    label={roomName}
                    role="assistant"
                    seed={activePersona.id}
                    assetId={activePersona.assistantAvatarAssetId}
                    iconId={activePersona.assistantAvatarIconId}
                    shape={activePersona.assistantAvatarShape}
                    size={activePersona.assistantAvatarSize}
                    onSelectFiles={(files) => onSelectPersonaAvatar?.('assistant', files) ?? Promise.resolve()}
                    onSetIcon={(iconId) => onSetPersonaAvatarIcon?.('assistant', iconId)}
                    onSetShape={(shape) => onSetPersonaAvatarShape?.('assistant', shape)}
                    onSetSize={(size) => onSetPersonaAvatarSize?.('assistant', size)}
                  />
                  <CollaboratorAvatarEditor
                    compact
                    label={t('room.settings.userAvatarLabel')}
                    role="user"
                    seed={activePersona.id}
                    assetId={activePersona.userAvatarAssetId}
                    iconId={activePersona.userAvatarIconId}
                    shape={activePersona.userAvatarShape}
                    size={activePersona.userAvatarSize}
                    onSelectFiles={(files) => onSelectPersonaAvatar?.('user', files) ?? Promise.resolve()}
                    onSetIcon={(iconId) => onSetPersonaAvatarIcon?.('user', iconId)}
                    onSetShape={(shape) => onSetPersonaAvatarShape?.('user', shape)}
                    onSetSize={(size) => onSetPersonaAvatarSize?.('user', size)}
                  />
                </div>
              </div>
            ) : null}

            <PersonaToggle
              label={t('room.settings.worldSwitchHandle')}
              description={t('room.settings.worldSwitchHandleDetail')}
              checked={showWorldSwitchHandle}
              onToggle={() => themeBindings.setCustomization({ showWorldSwitchHandle: !showWorldSwitchHandle })}
            />
          </section>

          <RoomBackgroundSettingsSection
            customization={themeBindings.customization}
            onSetCustomization={themeBindings.setCustomization}
          />

          <RoomStarSettingsSection
            customization={themeBindings.customization}
            onSetCustomization={themeBindings.setCustomization}
          />

          <RoomThemeActionsSection
            copyFeedback={controller.copyFeedback}
            onCopyThemeBundle={() => {
              void controller.handleCopyThemeBundle();
            }}
            onRollbackLastSkin={controller.themeSession.rollbackLastSkin}
            onRestoreDefaultTheme={controller.themeSession.restoreDefaultTheme}
          />
        </>
      ) : null}

      {activeThemePage === 'css' ? (
        <CustomCssSection
          themeCustomCss={controller.theme.customCSS}
          guard={controller.customCssGuard}
          applyFeedback={controller.customCssApplyFeedback}
          onCustomCssDraftChange={controller.setCustomCssDraft}
          onClearCustomCss={controller.clearCustomCss}
        />
      ) : null}

      {activeThemePage === 'library' ? (
        <RoomThemeLibrarySection controller={controller} />
      ) : null}
    </div>
  );
}
