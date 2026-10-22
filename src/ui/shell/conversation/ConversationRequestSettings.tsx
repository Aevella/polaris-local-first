import { useId } from 'react';
import type { ConversationWindowPreferences, McpServerConfig } from '../../../types/domain';
import { useI18n } from '../../../i18n';

export function ConversationRequestSettings({ preferences, servers, onChange }: {
  preferences: ConversationWindowPreferences;
  servers: McpServerConfig[];
  onChange: (patch: Partial<ConversationWindowPreferences>) => void;
}) {
  const { t } = useI18n();
  const returnGroup = useId();
  const selected = preferences.mcpScope.mode === 'selected' ? preferences.mcpScope.serverIds : [];
  return <>
    <section className="conversation-menu-section">
      <h3>{t('conversation.menu.images')}</h3><p>{t('conversation.menu.imagesDetail')}</p>
      <div className="conversation-settings-options">
        {(['smart', 'currentTurnOnly', 'always'] as const).map(policy => <button key={policy} type="button" aria-pressed={preferences.historicalImagePolicy === policy}
          onClick={() => onChange({ historicalImagePolicy: policy })}>
          <span>{t(`conversation.menu.image.${policy}`)}</span><small>{t(`conversation.menu.image.${policy}Detail`)}</small>
        </button>)}
      </div>
    </section>
    <section className="conversation-menu-section">
      <h3 id={`${returnGroup}-title`}>{t('conversation.menu.returnKey')}</h3>
      <div className="conversation-return-options" role="radiogroup" aria-labelledby={`${returnGroup}-title`}>
        {(['automatic', 'newline', 'send'] as const).map(value => <label className="conversation-return-option" key={value}>
          <input type="radio" name={returnGroup} value={value} checked={preferences.composerReturnKeyBehavior === value}
            onChange={() => onChange({ composerReturnKeyBehavior: value })} />
          <span><strong>{t(`conversation.menu.return.${value}`)}</strong><small>{t(`conversation.menu.return.${value}Detail`)}</small></span>
        </label>)}
      </div>
      <p>{t('conversation.menu.returnDetail')}</p>
    </section>
    <section className="conversation-menu-section">
      <h3>{t('conversation.menu.mcp')}</h3><p>{t('conversation.menu.mcpDetail')}</p>
      <div className="conversation-menu-choices conversation-menu-choices--two" role="group" aria-label={t('conversation.menu.mcp')}>
        <button type="button" aria-pressed={preferences.mcpScope.mode === 'inherit'} onClick={() => onChange({ mcpScope: { mode: 'inherit' } })}>{t('conversation.menu.mcpInherit')}</button>
        <button type="button" aria-pressed={preferences.mcpScope.mode === 'selected'} onClick={() => onChange({ mcpScope: { mode: 'selected', serverIds: selected } })}>{t('conversation.menu.mcpSelected')}</button>
      </div>
      {preferences.mcpScope.mode === 'selected' && <div className="conversation-settings-server-list">
        {servers.length === 0 && <p>{t('conversation.menu.noMcp')}</p>}
        {servers.map(server => <label key={server.id} className="menu-preference-row menu-preference-row--switch"><span>{server.name}</span>
          <input type="checkbox" checked={selected.includes(server.id)} onChange={event => onChange({ mcpScope: { mode: 'selected', serverIds: event.target.checked ? [...selected, server.id] : selected.filter(id => id !== server.id) } })} /></label>)}
        <p>{t('conversation.menu.mcpNone')}</p>
      </div>}
    </section>
  </>;
}
