import { useEffect, useState } from 'react';
import type { CollaboratorInfoOverviewItem } from '../../../app/collection/buildCollaboratorInfoOverview';
import type { Conversation, McpServerConfig, Persona, PolarisTriggerRule, PolarisTriggerSchedule, ProviderProfile } from '../../../types/domain';
import { BasicSettingsTab } from '../../shell/persona/settings/BasicSettingsTab';
import { MemorySettingsTab } from '../../shell/persona/settings/MemorySettingsTab';
import { PromptSettingsTab } from '../../shell/persona/settings/PromptSettingsTab';
import { RequestSettingsTab } from '../../shell/persona/settings/RequestSettingsTab';
import { RoomSettingsTab } from '../../shell/persona/settings/RoomSettingsTab';
import { AutomationRulesPanel } from '../../shell/menu/AutomationRulesPanel';
import type { PersonaUpdatePatch } from '../../shell/persona/personaUiShared';
import { CollaboratorOverviewRail } from './CollaboratorOverviewRail';
import { CollaboratorCreatePicker } from '../../worlds/chat/collaborator/CollaboratorCreatePicker';
import { CollectionFloatingCreateAction } from '../grid/CollectionFloatingCreateAction';
import { isCompanionCollaboratorId } from '../../../engines/companion';
import type { I18nKey } from '../../../i18n/messages';
import { useI18n } from '../../../i18n/useI18n';
const INFO_TABS = ['identity', 'prompt', 'memory', 'room', 'automation', 'request'] as const;
type CollaboratorInfoTab = (typeof INFO_TABS)[number];
const INFO_TAB_LABEL_KEYS = {
  identity: 'collaborator.info.tab.identity',
  prompt: 'collaborator.info.tab.prompt',
  memory: 'collaborator.info.tab.memory',
  room: 'collaborator.info.tab.room',
  automation: 'collaborator.info.tab.automation',
  request: 'collaborator.info.tab.request'
} satisfies Record<CollaboratorInfoTab, I18nKey>;

type CollaboratorInfoShelfProps = {
  isAggregateScope: boolean;
  currentCollaboratorId: string | null;
  currentCollaborator: Persona | null;
  fullscreenOpen: boolean;
  showChatAvatars: boolean;
  providers: ProviderProfile[];
  activeProviderId: string | null;
  conversations: Conversation[];
  triggerRules: PolarisTriggerRule[];
  mcpServers: McpServerConfig[];
  mcpToolTimeoutSeconds: number;
  collaboratorOverviewItems: CollaboratorInfoOverviewItem[];
  editing: boolean;
  onUpdateCollaborator: (patch: PersonaUpdatePatch) => void;
  onSelectCollaborator: (collaboratorId: string) => void;
  onToggleCollaboratorPinned: (collaboratorId: string) => void;
  onDeleteCollaborator: (collaboratorId: string) => void;
  onSelectCollaboratorAvatar: (role: 'assistant' | 'user', files: FileList | File[]) => Promise<void>;
  onCreateFromBuilder: () => void;
  onCreateCustomCollaborator: () => void;
  onOpenProviderSettings: () => void;
  onCreateTriggerRule: (seed: {
    collaboratorId: string;
    conversationMode?: PolarisTriggerRule['target']['conversationMode'];
    conversationId?: string | null;
    schedule: PolarisTriggerSchedule;
    prompt: string;
    name?: string;
  }) => string | null;
  onUpdateTriggerRule: (ruleId: string, patch: Partial<PolarisTriggerRule>) => void;
  onDeleteTriggerRule: (ruleId: string) => void;
  onTestTriggerRule: (ruleId: string) => void;
  onCopyTriggerUrl: (ruleId: string) => void;
  onCreateMcpServer: (seed?: Partial<McpServerConfig>) => string;
  onUpdateMcpServer: (serverId: string, patch: Partial<McpServerConfig>) => void;
};

export function CollaboratorInfoShelf({
  isAggregateScope,
  currentCollaboratorId,
  currentCollaborator,
  fullscreenOpen,
  showChatAvatars,
  providers,
  activeProviderId,
  conversations,
  triggerRules,
  mcpServers,
  mcpToolTimeoutSeconds,
  collaboratorOverviewItems,
  editing,
  onUpdateCollaborator,
  onSelectCollaborator,
  onToggleCollaboratorPinned,
  onDeleteCollaborator,
  onSelectCollaboratorAvatar,
  onCreateFromBuilder,
  onCreateCustomCollaborator,
  onOpenProviderSettings,
  onCreateTriggerRule,
  onUpdateTriggerRule,
  onDeleteTriggerRule,
  onTestTriggerRule,
  onCopyTriggerUrl,
  onCreateMcpServer,
  onUpdateMcpServer
}: CollaboratorInfoShelfProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<CollaboratorInfoTab>('identity');
  const [createPickerOpen, setCreatePickerOpen] = useState(false);
  const visibleTabs = INFO_TABS;
  const isCompanionCollaborator = isCompanionCollaboratorId(currentCollaboratorId);
  const collaboratorName = currentCollaborator?.name.trim() || t('collaborator.info.fallbackName');

  useEffect(() => {
    setActiveTab('identity');
  }, [currentCollaboratorId]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab === activeTab)) {
      setActiveTab('identity');
    }
  }, [activeTab, visibleTabs]);

  if (isAggregateScope) {
    return (
      <section className="collaborator-info-shelf collaborator-info-shelf-overview">
        <CollaboratorOverviewRail
          items={collaboratorOverviewItems}
          editing={editing}
          onSelectCollaborator={onSelectCollaborator}
          onToggleCollaboratorPinned={onToggleCollaboratorPinned}
          onCreateFromBuilder={onCreateFromBuilder}
          onCreateCustomCollaborator={onCreateCustomCollaborator}
          onOpenProviderSettings={onOpenProviderSettings}
        />
      </section>
    );
  }

  if (!currentCollaborator) {
    return (
      <section className="collaborator-info-shelf collaborator-info-shelf-empty">
        <div className="empty-state-floating">
          <p className="empty-state-title">{t('collaborator.info.emptyTitle')}</p>
          <p className="empty-state-hint">{t('collaborator.info.emptyHint')}</p>
          <CollectionFloatingCreateAction
            label={createPickerOpen ? t('collaborator.info.closeCreateAction') : t('collaborator.info.createAction')}
            expanded={createPickerOpen}
            onPress={() => setCreatePickerOpen((current) => !current)}
          >
            {createPickerOpen ? (
              <CollaboratorCreatePicker
                showCloseButton={false}
                onCloseCreatePicker={() => setCreatePickerOpen(false)}
                onCreateFromBuilder={() => {
                  setCreatePickerOpen(false);
                  onCreateFromBuilder();
                }}
                onCreateCustomCollaborator={() => {
                  setCreatePickerOpen(false);
                  onCreateCustomCollaborator();
                }}
              />
            ) : null}
          </CollectionFloatingCreateAction>
        </div>
      </section>
    );
  }

  return (
    <section className={`collaborator-info-shelf ${fullscreenOpen ? 'collaborator-info-shelf--fullscreen' : ''}`.trim()}>
      <div className={`collaborator-info-detail-shell ${fullscreenOpen ? 'collaborator-info-detail-shell--fullscreen' : ''}`.trim()}>
        <div className="ps-nav collaborator-info-nav">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`ps-nav-item ${activeTab === tab ? 'ps-nav-item--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(INFO_TAB_LABEL_KEYS[tab])}
            </button>
          ))}
        </div>

        <div className="ps-content collaborator-info-content">
          <div className="ps-section">
            {activeTab === 'identity' && (
              <BasicSettingsTab
                activeCollaboratorId={currentCollaboratorId}
                activePersona={currentCollaborator}
                providers={providers}
                activeProviderId={activeProviderId}
                showChatAvatars={showChatAvatars}
                onUpdatePersona={onUpdateCollaborator}
                deletePersonaLabel={isCompanionCollaborator
                  ? t('collaborator.info.disconnectLabel', { name: collaboratorName })
                  : t('collaborator.info.deleteLabel', { name: collaboratorName })}
                deletePersonaHint={
                  isCompanionCollaborator
                    ? t('collaborator.info.disconnectHint')
                    : t('collaborator.info.deleteHint')
                }
                onDeletePersona={() => {
                  if (!currentCollaboratorId) return;
                  onDeleteCollaborator(currentCollaboratorId);
                }}
                onSelectPersonaAvatar={onSelectCollaboratorAvatar}
                onSetPersonaAvatarIcon={(role, iconId) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarIconId: iconId } : { userAvatarIconId: iconId }
                  )}
                onSetPersonaAvatarShape={(role, shape) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarShape: shape } : { userAvatarShape: shape }
                  )}
                onSetPersonaAvatarSize={(role, size) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarSize: size } : { userAvatarSize: size }
                  )}
              />
            )}
            {activeTab === 'room' && (
              <RoomSettingsTab
                activeCollaboratorId={currentCollaboratorId}
                activePersona={currentCollaborator}
                onUpdatePersona={onUpdateCollaborator}
                onSelectPersonaAvatar={onSelectCollaboratorAvatar}
                onSetPersonaAvatarIcon={(role, iconId) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarIconId: iconId } : { userAvatarIconId: iconId }
                  )}
                onSetPersonaAvatarShape={(role, shape) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarShape: shape } : { userAvatarShape: shape }
                  )}
                onSetPersonaAvatarSize={(role, size) =>
                  onUpdateCollaborator(
                    role === 'assistant' ? { assistantAvatarSize: size } : { userAvatarSize: size }
                  )}
              />
            )}
            {activeTab === 'prompt' && (
              <PromptSettingsTab
                activeCollaboratorId={currentCollaboratorId}
                activePersona={currentCollaborator}
                onUpdatePersona={onUpdateCollaborator}
                expandedUsesPageScroll={fullscreenOpen}
              />
            )}
            {activeTab === 'memory' && (
              <MemorySettingsTab
                activeCollaboratorId={currentCollaboratorId}
                activePersona={currentCollaborator}
                onUpdatePersona={onUpdateCollaborator}
              />
            )}
            {activeTab === 'automation' && (
              <AutomationRulesPanel
                personas={[currentCollaborator]}
                conversations={conversations}
                triggerRules={triggerRules}
                lockedCollaboratorId={currentCollaboratorId}
                emptyTitle={t('settings.automation.collaboratorEmptyTitle')}
                emptyActionLabel={t('settings.automation.collaboratorEmptyAction')}
                formNote={t('settings.automation.collaboratorFormNote')}
                rulesNote={t('settings.automation.collaboratorRulesNote')}
                onCreateTriggerRule={onCreateTriggerRule}
                onUpdateTriggerRule={onUpdateTriggerRule}
                onDeleteTriggerRule={onDeleteTriggerRule}
                onTestTriggerRule={onTestTriggerRule}
                onCopyTriggerUrl={onCopyTriggerUrl}
              />
            )}
            {activeTab === 'request' && (
              <RequestSettingsTab
                activeCollaboratorId={currentCollaboratorId}
                activePersona={currentCollaborator}
                providers={providers}
                activeProviderId={activeProviderId}
                onUpdatePersona={onUpdateCollaborator}
                onOpenProviderSettings={onOpenProviderSettings}
                mcpServers={mcpServers}
                mcpToolTimeoutSeconds={mcpToolTimeoutSeconds}
                onCreateMcpServer={onCreateMcpServer}
                onUpdateMcpServer={onUpdateMcpServer}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
