import { Children, type ReactNode } from 'react';
import type { ThemeState, WebSearchConfig, WebSearchProviderType } from '../../../types/domain';
import { useI18n } from '../../../i18n';
import { HelpHint } from '../../HelpHint';
import { Icon, type IconName } from '../../Icon';
import { getThemeToolModeLabel } from '../../theme-tool-mode/themeToolModeGuidance';

type ToolboxToggleRowProps = {
  icon: IconName;
  label: string;
  description: string;
  checked: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onToggle: () => void;
};

export function ToolboxToggleRow({
  icon,
  label,
  description,
  checked,
  children,
  disabled = false,
  onToggle
}: ToolboxToggleRowProps) {
  const { t } = useI18n();
  const inlineConfig = Children.toArray(children);
  const toggleStatus = checked ? t('common.toggleOn') : t('common.toggleOff');

  return (
    <div className="memory-toggle memory-toggle--switch toolbox-toggle-row" data-checked={checked ? 'true' : 'false'}>
      <div className="toolbox-toggle-row-head">
        <div className="memory-toggle-copy toolbox-toggle-copy">
          <strong>
            <span className="toolbox-toggle-icon" aria-hidden="true">
              <Icon name={icon} size={13} />
            </span>
            {label}
          </strong>
          <span>{description}</span>
        </div>
        <button
          type="button"
          className={`ps-toggle-sw memory-toggle-switch ${checked ? 'ps-toggle-sw--on' : ''}`}
          aria-pressed={checked}
          aria-label={t('common.toggleAria', { label, status: toggleStatus })}
          disabled={disabled}
          onClick={onToggle}
        >
          <span className="ps-toggle-knob" />
        </button>
      </div>
      {checked && inlineConfig.length > 0 ? <div className="toolbox-inline-config">{inlineConfig}</div> : null}
    </div>
  );
}

type ThemeToolModeInlineConfigProps = {
  mode: ThemeState['toolMode'];
  description: string;
  onSetMode: (mode: ThemeState['toolMode']) => void;
};

export function ThemeToolModeInlineConfig({
  mode,
  description,
  onSetMode
}: ThemeToolModeInlineConfigProps) {
  const { t } = useI18n();

  return (
    <>
      <span className="menu-section-kicker menu-section-kicker-row">
        {t('theme.toolMode.inlineTitle')}
        <HelpHint
          label={t('theme.toolMode.inlineTitle')}
          text={t('theme.toolMode.inlineHelp')}
        />
      </span>
      <p className="menu-section-note">{t('theme.toolMode.inlineNote')}</p>
      <div className="theme-mode-switch">
        <button
          type="button"
          className={`theme-mode-chip ${mode === 'stable' ? 'active' : ''}`}
          onClick={() => onSetMode('stable')}
        >
          {getThemeToolModeLabel('stable', t)}
        </button>
        <button
          type="button"
          className={`theme-mode-chip ${mode === 'creative' ? 'active' : ''}`}
          onClick={() => onSetMode('creative')}
        >
          {getThemeToolModeLabel('creative', t)}
        </button>
      </div>
      <div className="theme-mode-guidance">
        <strong>{getThemeToolModeLabel(mode, t)}</strong>
        <p>{description}</p>
      </div>
    </>
  );
}

type WebSearchInlineConfigProps = {
  search: WebSearchConfig;
  activeLabel: string;
  requiresKey: boolean;
  onSetSearchConfig: (patch: Partial<WebSearchConfig>) => void;
};

export function WebSearchInlineConfig({
  search,
  activeLabel,
  requiresKey,
  onSetSearchConfig
}: WebSearchInlineConfigProps) {
  const { t } = useI18n();
  const summaryStatus = search.bochaSummary ? t('common.toggleOn') : t('common.toggleOff');
  const apiKeyPlaceholder =
    search.provider === 'bocha' || (search.provider === 'custom' && search.customAdapter === 'bocha')
      ? 'bocha_... / BOCHA-...'
      : search.provider === 'tavily' || (search.provider === 'custom' && search.customAdapter === 'tavily')
        ? 'tvly-...'
        : 'BSA...';

  return (
    <>
      <span className="menu-section-kicker">{t('settings.toolbox.searchSection')}</span>
      <p className="menu-section-note">
        {t('settings.toolbox.searchCurrent', { provider: activeLabel })}
        {requiresKey && !search.apiKey.trim() ? t('settings.toolbox.searchMissingKey') : ''}
      </p>
      <div className="settings-form">
        <label>{t('settings.toolbox.searchProviderLabel')}</label>
        <select
          value={search.provider}
          onChange={(event) => {
            onSetSearchConfig({
              provider: event.target.value as WebSearchProviderType
            });
          }}
        >
          <option value="bingLocal">{t('settings.toolbox.searchProviderDefault')}</option>
          <option value="bocha">{t('settings.toolbox.searchProviderBocha')}</option>
          <option value="brave">{t('settings.toolbox.searchProviderBrave')}</option>
          <option value="tavily">{t('settings.toolbox.searchProviderTavily')}</option>
          <option value="custom">{t('settings.toolbox.searchProviderCustom')}</option>
        </select>
        {requiresKey ? (
          <>
            <label>{t('settings.toolbox.apiKeyLabel')}</label>
            <input
              value={search.apiKey}
              onChange={(event) => onSetSearchConfig({ apiKey: event.target.value })}
              placeholder={apiKeyPlaceholder}
              type="password"
            />
          </>
        ) : null}
      </div>
      {search.provider === 'custom' ? (
        <div className="settings-form">
          <label>{t('settings.toolbox.customAdapterLabel')}</label>
          <select
            value={search.customAdapter}
            onChange={(event) => onSetSearchConfig({
              customAdapter: event.target.value as WebSearchConfig['customAdapter']
            })}
          >
            <option value="tavily">{t('settings.toolbox.customAdapterTavily')}</option>
            <option value="brave">{t('settings.toolbox.customAdapterBrave')}</option>
            <option value="bocha">{t('settings.toolbox.customAdapterBocha')}</option>
          </select>
          <label>{t('settings.toolbox.endpointLabel')}</label>
          <input
            value={search.customEndpoint}
            onChange={(event) => onSetSearchConfig({ customEndpoint: event.target.value })}
            placeholder={
              search.customAdapter === 'bocha'
                ? 'https://api.bochaai.com/v1/web-search'
                : search.customAdapter === 'brave'
                  ? 'https://api.search.brave.com/res/v1/web/search'
                  : 'https://api.tavily.com/search'
            }
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <label>{t('settings.toolbox.customLabelLabel')}</label>
          <input
            value={search.customLabel}
            onChange={(event) => onSetSearchConfig({ customLabel: event.target.value })}
            placeholder={t('settings.toolbox.customLabelPlaceholder')}
            autoComplete="off"
          />
        </div>
      ) : null}
      {search.provider === 'bocha' || (search.provider === 'custom' && search.customAdapter === 'bocha') ? (
        <>
          <div className="settings-form">
            <label>{t('settings.toolbox.freshnessLabel')}</label>
            <select
              value={search.bochaFreshness}
              onChange={(event) => onSetSearchConfig({ bochaFreshness: event.target.value })}
            >
              <option value="noLimit">{t('settings.toolbox.freshnessNoLimit')}</option>
              <option value="oneDay">{t('settings.toolbox.freshnessOneDay')}</option>
              <option value="oneWeek">{t('settings.toolbox.freshnessOneWeek')}</option>
              <option value="oneMonth">{t('settings.toolbox.freshnessOneMonth')}</option>
              <option value="oneYear">{t('settings.toolbox.freshnessOneYear')}</option>
            </select>
          </div>
          <div className="memory-toggle memory-toggle--switch search-summary-toggle">
            <div className="memory-toggle-copy">
              <strong>{t('settings.toolbox.summaryTitle')}</strong>
              <span>{summaryStatus}</span>
            </div>
            <button
              type="button"
              className={`ps-toggle-sw memory-toggle-switch ${search.bochaSummary ? 'ps-toggle-sw--on' : ''}`}
              aria-pressed={search.bochaSummary}
              aria-label={t('settings.toolbox.summaryAria', { status: summaryStatus })}
              onClick={() => onSetSearchConfig({ bochaSummary: !search.bochaSummary })}
            >
              <span className="ps-toggle-knob" />
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
