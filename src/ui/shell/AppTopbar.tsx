import { useEffect, useRef, useState } from 'react';
import {
  getRunCodeSandboxProfile,
  lockRunCodeSandbox,
  unlockRunCodeSandbox
} from '../../infrastructure/runCodeSandboxMode';
import type { ActiveThemePreview } from '../../stores/spaceStore';
import type { CollectionShelf, World } from '../../types/domain';
import { Icon } from '../Icon';
import { runSelectionAction } from '../haptics';
import { WorldAnchor } from './WorldAnchor';
import { ConversationMenu } from './conversation/ConversationMenu';
import { useI18n } from '../../i18n';

export type AppTopbarState = {
  topbarLayout?: 'centered' | 'leading';
  activeWorld: World;
  title: string;
  titleTone: 'brand' | 'collaborator';
  isAggregateCollectionScope: boolean;
  worldLabel: string;
  worldDetail: string | null;
  showWorldLabel: boolean;
  showShell: boolean;
  showTitle: boolean;
  collaboratorSwitchOpen: boolean;
  collectionShelf: CollectionShelf;
  searchOpen: boolean;
  collectionInfoFullscreenOpen: boolean;
  menuOpen: boolean;
  activeThemePreview: ActiveThemePreview;
};

export type AppTopbarActions = {
  onToggleWorld: () => void;
  onToggleCollaboratorSwitch: () => void;
  onCreateConversation: () => void;
  onToggleSearch: () => void;
  onOpenCollectionInfoFullscreen: () => void;
  onToggleMenu: () => void;
  onOpenSettings: () => void;
  onOpenPreviewChat: () => void;
};

export type AppTopbarProps = {
  state: AppTopbarState;
  actions: AppTopbarActions;
};

export function AppTopbar({
  state,
  actions
}: AppTopbarProps) {
  const { t } = useI18n();
  const [brandSpinning, setBrandSpinning] = useState(false);
  const spinResetTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (spinResetTimeoutRef.current !== null) {
        window.clearTimeout(spinResetTimeoutRef.current);
      }
    },
    []
  );

  const handleToggleWorld = (trigger: HTMLElement | null) => {
    void trigger;
    if (spinResetTimeoutRef.current !== null) {
      window.clearTimeout(spinResetTimeoutRef.current);
    }
    setBrandSpinning(false);
    window.requestAnimationFrame(() => {
      setBrandSpinning(true);
      spinResetTimeoutRef.current = window.setTimeout(() => {
        setBrandSpinning(false);
        spinResetTimeoutRef.current = null;
      }, 380);
    });
    actions.onToggleWorld();
  };

  const handleSelectionAction = (action: () => void, trigger: EventTarget | null) => {
    runSelectionAction(action, { element: trigger });
  };
  const handleSecretSandboxPrompt = () => {
    const currentProfile = getRunCodeSandboxProfile();
    const value = window.prompt(
      currentProfile === 'experimental'
        ? t('topbar.secretPromptExperimental')
        : t('topbar.secretPromptLocked'),
      ''
    );
    if (value === null) return;

    const trimmed = value.trim();
    if (!trimmed && currentProfile !== 'safe') {
      if (lockRunCodeSandbox()) {
        window.alert(t('topbar.sandboxLocked'));
      }
      return;
    }

    const nextProfile = unlockRunCodeSandbox(trimmed);
    if (nextProfile === 'experimental') {
      window.alert(t('topbar.sandboxUnlocked'));
      return;
    }

    window.alert(t('topbar.secretWrong'));
  };
  const collectionCardsEditable = state.activeWorld === 'collection'
    && (state.collectionShelf === 'code' || state.collectionShelf === 'dialogue' || state.collectionShelf === 'image');
  const canOpenCollectionSearch = state.activeWorld === 'collection' && state.collectionShelf !== 'info';
  const canOpenCollectionInfoSettings = state.activeWorld === 'collection' && state.collectionShelf === 'info';
  const collectionSearchTitle = collectionCardsEditable ? t('common.editOrSearch') : t('common.search');
  const collectionSearchLabel = collectionSearchTitle;
  const collectionSearchIcon = collectionCardsEditable ? 'editList' : 'search';
  const showCollaboratorGate = state.activeWorld === 'collection';

  if (!state.showShell) {
    return null;
  }

  return (
    <header className={`topbar chat-topbar-shell ${state.topbarLayout === 'leading' ? 'topbar--leading-context' : 'topbar--mirrored topbar--centered-context'}`}>
      <div className="topbar-surface">
        <div className="topbar-main">
          <WorldAnchor
            activeWorld={state.activeWorld}
            title={state.title}
            titleTone={state.titleTone}
            aggregateCollectionScope={state.isAggregateCollectionScope}
            worldLabel={state.worldLabel}
            worldDetail={state.worldDetail}
            showWorldLabel={state.showWorldLabel}
            showTitle={state.showTitle}
            spinning={brandSpinning}
            onToggleWorld={handleToggleWorld}
            onSecretLongPress={handleSecretSandboxPrompt}
            switchLabel={t('topbar.switchRoom')}
          />

          {showCollaboratorGate ? (
            <div className="topbar-actions topbar-actions--leading">
              <button
                type="button"
                className={`action-btn icon-btn collaborator-gate-btn ${state.collaboratorSwitchOpen ? 'active' : ''}`}
                title={t('topbar.switchCollaboratorSpace')}
                aria-label={t('topbar.switchCollaboratorSpace')}
                aria-expanded={state.collaboratorSwitchOpen}
                onClick={(event) => handleSelectionAction(actions.onToggleCollaboratorSwitch, event.currentTarget)}
              >
                <Icon name="drawerGate" size={19} />
              </button>
            </div>
          ) : null}

          <div className="topbar-actions">
            {canOpenCollectionInfoSettings && (
              <button
                type="button"
                className={`action-btn icon-btn topbar-settings-btn ${state.menuOpen ? 'active' : ''}`}
                title={t('common.settings')}
                aria-label={t('common.settings')}
                onClick={(event) => handleSelectionAction(actions.onOpenSettings, event.currentTarget)}
              >
                <Icon name="settings" size={18} />
              </button>
            )}

            {state.activeWorld === 'chat' && (
              <ConversationMenu onCreateConversation={actions.onCreateConversation} />
            )}

            {canOpenCollectionSearch && (
              <button type="button" className={`action-btn icon-btn ${state.searchOpen ? 'active' : ''}`} title={collectionSearchTitle} aria-label={collectionSearchLabel} onClick={(event) => handleSelectionAction(actions.onToggleSearch, event.currentTarget)}>
                <Icon name={collectionSearchIcon} size={19} />
              </button>
            )}
          </div>
        </div>
      </div>

      {state.activeThemePreview && (
        <button type="button" className="preview-banner-trigger" onClick={(event) => handleSelectionAction(actions.onOpenPreviewChat, event.currentTarget)}>
          <span className="preview-banner-dot" />
          <span>{t('topbar.previewActive')}</span>
        </button>
      )}
    </header>
  );
}
