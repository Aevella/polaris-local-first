import { useEffect, useState } from 'react';
import { isProductGuidePersona } from '../../../../engines/personaBuiltin';
import { Icon, type IconName } from '../../../Icon';
import { type PersonaTabProps } from '../personaUiShared';
import { PromptCoreSettingsPage } from './PromptCoreSettingsPage';
import { SnippetsSettingsTab } from './SnippetsSettingsTab';

type PromptSettingsTabProps = PersonaTabProps & {
  expandedUsesPageScroll?: boolean;
};

type PromptSettingsPage = 'prompt' | 'message' | 'tone' | 'rules';

const PROMPT_PAGE_META: Record<PromptSettingsPage, {
  label: string;
  icon: IconName;
}> = {
  prompt: { label: '提示词', icon: 'promptScript' },
  message: { label: '消息', icon: 'promptMessage' },
  tone: { label: '调性', icon: 'promptTone' },
  rules: { label: '世界书', icon: 'promptRules' }
};

const PROMPT_PAGES: PromptSettingsPage[] = ['prompt', 'message', 'tone', 'rules'];

export function PromptSettingsTab({
  activeCollaboratorId,
  activePersona,
  onUpdatePersona,
  expandedUsesPageScroll = false
}: PromptSettingsTabProps) {
  const [activePromptPage, setActivePromptPage] = useState<PromptSettingsPage>('prompt');

  useEffect(() => {
    setActivePromptPage('prompt');
  }, [activeCollaboratorId]);

  if (isProductGuidePersona(activePersona)) {
    return null;
  }

  return (
    <div className="prompt-settings-flow">
      <div className="room-theme-page-nav prompt-page-nav" role="tablist" aria-label="提示词设置分页">
        {PROMPT_PAGES.map((page) => (
          <button
            key={page}
            type="button"
            role="tab"
            aria-selected={activePromptPage === page}
            className={activePromptPage === page ? 'active' : ''}
            onClick={() => setActivePromptPage(page)}
          >
            <Icon name={PROMPT_PAGE_META[page].icon} size={14} />
            <span>{PROMPT_PAGE_META[page].label}</span>
          </button>
        ))}
      </div>

      {activePromptPage === 'prompt' ? (
        <PromptCoreSettingsPage
          activeCollaboratorId={activeCollaboratorId}
          activePersona={activePersona}
          onUpdatePersona={onUpdatePersona}
          page="prompt"
          expandedUsesPageScroll={expandedUsesPageScroll}
        />
      ) : null}

      {activePromptPage === 'message' ? (
        <>
          <PromptCoreSettingsPage
            activeCollaboratorId={activeCollaboratorId}
            activePersona={activePersona}
            onUpdatePersona={onUpdatePersona}
            page="message"
            expandedUsesPageScroll={expandedUsesPageScroll}
          />
          <SnippetsSettingsTab
            activeCollaboratorId={activeCollaboratorId}
            activePersona={activePersona}
            onUpdatePersona={onUpdatePersona}
            visibleSections="textRules"
          />
        </>
      ) : null}

      {activePromptPage === 'tone' ? (
        <SnippetsSettingsTab
          activeCollaboratorId={activeCollaboratorId}
          activePersona={activePersona}
          onUpdatePersona={onUpdatePersona}
          visibleSections="tone"
        />
      ) : null}

      {activePromptPage === 'rules' ? (
        <SnippetsSettingsTab
          activeCollaboratorId={activeCollaboratorId}
          activePersona={activePersona}
          onUpdatePersona={onUpdatePersona}
          visibleSections="worldBook"
        />
      ) : null}
    </div>
  );
}
