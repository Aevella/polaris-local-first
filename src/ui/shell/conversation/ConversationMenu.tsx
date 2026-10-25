import { ConversationModelSettings } from './ConversationModelSettings';
import { normalizeConversationWindowPreferences } from '../../../engines/conversationWindowSettings';
import { ConversationRequestSettings } from './ConversationRequestSettings';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConversationMenuController } from '../../../app/shell/useConversationMenuController';
import { useI18n } from '../../../i18n';
import { Icon } from '../../Icon';
import type { ConversationReasoningStrength } from '../../../types/domain';
import { CONVERSATION_REASONING_STRENGTHS } from '../../../engines/conversationReasoning';

type MenuController = ReturnType<typeof useConversationMenuController>;

export function ConversationMenu({ onCreateConversation, conversationId, className, showLabel = false }: { onCreateConversation?: () => void; conversationId?: string; className?: string; showLabel?: boolean }) {
  const controller = useConversationMenuController(onCreateConversation, conversationId);
  const { t } = useI18n();
  return <>
    <button type="button" className={className ?? "action-btn icon-btn topbar-conversation-menu-btn"} aria-label={t('conversation.menu.title')}
      aria-haspopup="dialog" aria-expanded={controller.open} onClick={(event) => { event.stopPropagation(); controller.onOpen(); }}>
      <Icon name="settings" size={18} />{showLabel && <span>{t('conversation.menu.title')}</span>}
    </button>
    {controller.open && createPortal(<ConversationMenuSheet controller={controller} />, document.querySelector('.app-global-overlays') ?? document.body)}
  </>;
}

export function ConversationMenuSheet({ controller }: { controller: MenuController }) {
  const { t } = useI18n();
  const { conversation, settings } = controller;
  const [title, setTitle] = useState(conversation?.title ?? '');
  const [limit, setLimit] = useState(String(settings.requestContext.mode === 'recent' ? settings.requestContext.messageCount : 40));
  const [error, setError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { setTitle(conversation?.title ?? ''); }, [conversation?.id]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); controller.onClose(); }
      if (event.key !== 'Tab') return;
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus(); };
  }, []);
  const saveLimit = () => {
    const value = Number(limit);
    const valid = limit.trim() !== '' && Number.isSafeInteger(value) && value > 0;
    setError(!valid);
    if (valid) controller.onSetContext({ mode: 'recent', messageCount: value });
  };
  const mode = settings.requestContext.mode;
  return <div className="settings-overlay conversation-menu-overlay" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) controller.onClose();
  }}>
    <div ref={panel} tabIndex={-1} className="settings-sheet conversation-menu-sheet" role="dialog" aria-modal="true" aria-label={t('conversation.menu.title')}>
      <div className="sheet-handle" />
      <div className="conversation-menu-heading"><div><small>{t('conversation.menu.scope')}</small><h2>{t('conversation.menu.title')}</h2></div>
        <button className="action-btn icon-btn" onClick={controller.onClose} aria-label={t('conversation.menu.close')}><Icon name="x" size={18} /></button>
      </div>
      {controller.canCreate && <button className="conversation-menu-create" onClick={controller.onCreate}><Icon name="plus" size={20} /><span>{t('common.newConversation')}</span></button>}
      {!controller.editable ? <p className="conversation-menu-empty">{t('conversation.menu.empty')}</p> : <>
        <section className="conversation-menu-section">
          {conversation && <><label className="ps-field"><span className="ps-field-label">{t('conversation.menu.name')}</span>
            <input className="ps-input" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => controller.onRename(title)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
          <label className="menu-preference-row menu-preference-row--switch"><span>{t('conversation.menu.pin')}</span>
            <input type="checkbox" checked={Boolean(conversation.pinnedAt)} onChange={controller.onTogglePin} /></label></>}
          {!conversation && <p>{t('conversation.menu.unsent')}</p>}
        </section>
        <section className="conversation-menu-section">
          <h3>{t('conversation.menu.context')}</h3><p>{t('conversation.menu.contextDetail')}</p>
          <div className="conversation-menu-choices conversation-menu-choices--context" role="group" aria-label={t('conversation.menu.context')}>
            {(['inherit', 'all', 'recent', 'fromMessage'] as const).map((item) => <button key={item} aria-pressed={mode === item} className={mode === item ? 'active' : ''}
              onClick={() => { setError(false); controller.onSetContext(item === 'recent' ? { mode: 'recent', messageCount: Number.isSafeInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 40 } : item === 'fromMessage' ? { mode: item, anchorMessageId: settings.requestContext.mode === 'fromMessage' ? settings.requestContext.anchorMessageId : null } : { mode: item }); }}>
              {t(`conversation.menu.${item}`)}
            </button>)}
          </div>
          {mode === 'recent' && <><p>{t('conversation.menu.steppedDetail')}</p><label className="conversation-menu-limit"><span>{t('conversation.menu.messageCount')}</span>
            <input className="ps-input" inputMode="numeric" type="number" min={1} step={1} value={limit} onChange={(event) => setLimit(event.target.value)} onBlur={saveLimit}
              aria-invalid={error} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </label></>}
          {settings.requestContext.mode === 'fromMessage' && <>
            <p>{t('conversation.menu.anchorDetail')}</p>
            <p>{t(settings.requestContext.anchorMessageId ? 'conversation.menu.anchorSelected' : 'conversation.menu.anchorPending')}</p>
          </>}
          {error && <p role="alert" className="conversation-menu-error">{t('conversation.menu.invalidLimit')}</p>}
        </section>
        <section className="conversation-menu-section">
          <label className="ps-field"><span className="ps-field-label">{t('chat.reasoning.title')}</span>
            <select className="ps-input" value={settings.reasoningStrength} onChange={(event) => controller.onSetReasoning(event.target.value as ConversationReasoningStrength)}>
              {CONVERSATION_REASONING_STRENGTHS.map((strength) => <option key={strength} value={strength}>{t(`chat.reasoning.${strength}`)}</option>)}
            </select></label>
          <p>{t('conversation.menu.nextReply')}</p>
        </section>
        <ConversationModelSettings binding={settings.windowPreferences?.modelBinding} providers={controller.providers} effectiveApi={controller.providerBinding.api}
          modelList={controller.modelList} onChange={controller.onSetPreferences} onFetchModels={controller.onFetchModels} />
        <ConversationRequestSettings preferences={normalizeConversationWindowPreferences(settings.windowPreferences)} servers={controller.mcpServers} onChange={controller.onSetPreferences} />
        {controller.canSaveDefaults && <section className="conversation-menu-section"><button type="button" className="conversation-menu-save-defaults" onClick={controller.onSaveDefaults}>{t('conversation.menu.saveDefaults')}</button>
            <p aria-live="polite">{t(controller.defaultsSaved ? 'conversation.menu.defaultsSaved' : 'conversation.menu.defaultsDetail')}</p></section>}
      </>}
    </div>
  </div>;
}
