import { useEffect, useState } from 'react';
import type { ConversationWindowPreferences, ProviderProfile } from '../../../types/domain';
import type { ProviderModelOption } from '../../../engines/providerModelDiscovery';
import { getProviderModelDisplayLabel, isBuiltInProviderDisplay } from '../apiProviderDisplay';
import { useI18n } from '../../../i18n';

export function ConversationModelSettings({ binding, providers, effectiveApi, modelList, onChange, onFetchModels }: {
  binding: ConversationWindowPreferences['modelBinding'];
  providers: ProviderProfile[];
  effectiveApi: ProviderProfile;
  modelList: { loading: boolean; models: ProviderModelOption[]; loaded?: boolean; error?: string };
  onChange: (patch: Partial<ConversationWindowPreferences>) => void;
  onFetchModels: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [model, setModel] = useState(binding?.model ?? '');
  useEffect(() => { setModel(binding?.model ?? ''); }, [binding?.providerId, binding?.model]);
  const selected = binding ? providers.find(provider => provider.id === binding.providerId) : null;
  const builtIn = selected && isBuiltInProviderDisplay(selected);
  return <section className="conversation-menu-section">
    <h3>{t('conversation.menu.model')}</h3><p>{t('conversation.menu.modelDetail')}</p>
    <button type="button" className="conversation-model-current" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span><small>{binding ? t('conversation.menu.modelOverride') : t('conversation.menu.modelInherit')}</small><strong>{getProviderModelDisplayLabel(effectiveApi)}</strong><small>{effectiveApi.name}</small></span>
      <span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="conversation-settings-options conversation-model-list" role="group" aria-label={t('conversation.menu.model')}>
      <button type="button" aria-pressed={!binding} onClick={() => onChange({ modelBinding: undefined })}><span>{t('conversation.menu.modelInherit')}</span><small>{t('conversation.menu.modelInheritDetail')}</small></button>
      {providers.map(provider => <button key={provider.id} type="button" aria-pressed={binding?.providerId === provider.id}
        onClick={() => onChange({ modelBinding: { providerId: provider.id, model: '' } })}>
        <span>{getProviderModelDisplayLabel(provider)}</span><small>{provider.name}</small>
      </button>)}
    </div>}
    {binding && !selected && <p role="status">{t('conversation.menu.modelMissing')}</p>}
    {selected && !builtIn && <>
      <label className="ps-field conversation-model-input"><span className="ps-field-label">{t('conversation.menu.modelId')}</span>
        <input className="ps-input" value={model} placeholder={selected.model} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={event => setModel(event.target.value)} onBlur={() => onChange({ modelBinding: { providerId: selected.id, model: model.trim() } })}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
      <button type="button" className="conversation-menu-save-defaults" disabled={modelList.loading} onClick={() => { void onFetchModels(); }}>{t(modelList.loading ? 'conversation.menu.modelsLoading' : 'conversation.menu.modelsFetch')}</button>
      {modelList.loaded && modelList.models.length === 0 && <p role="status">{t('conversation.menu.modelsEmpty')}</p>}
      {modelList.error && <p role="alert">{t('conversation.menu.modelsError', { error: modelList.error })}</p>}
      {!modelList.loading && modelList.models.length > 0 && <div className="conversation-settings-options conversation-model-list" role="group" aria-label={t('conversation.menu.modelId')}>
        {modelList.models.map(item => <button key={item.id} type="button" aria-pressed={effectiveApi.model === item.id} onClick={() => onChange({ modelBinding: { providerId: selected.id, model: item.id } })}><span>{item.id}</span></button>)}
      </div>}
    </>}
  </section>;
}
