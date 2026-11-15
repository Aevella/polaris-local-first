import { useEffect, useMemo, useState } from 'react';
import { SELECTOR_CATALOG, type SelectorEntry } from '../../../config/theme/themeSelectorCatalog';
import { hasPolarisCssParts, parsePolarisCssParts } from '../../../engines/themeCssParts';
import type { ThemeCssGuardResult } from '../../../engines/themeCssGuard';
import type { I18nKey } from '../../../i18n/messages';
import { useI18n } from '../../../i18n/useI18n';
import { Icon } from '../../Icon';

type CustomCssApplyFeedback = {
  id: number;
  kind: 'applied' | 'blocked';
  message: string;
};

type CustomCssSectionProps = {
  themeCustomCss: string;
  guard: ThemeCssGuardResult;
  applyFeedback: CustomCssApplyFeedback | null;
  onCustomCssDraftChange: (value: string, options?: { feedback?: boolean }) => void;
  onClearCustomCss: () => void;
};

const SELECTOR_GROUP_LABEL_KEYS = {
  chat: 'theme.css.group.chat',
  collection: 'theme.css.group.collection',
  app: 'theme.css.group.app'
} satisfies Record<SelectorEntry['group'], I18nKey>;

function escapePartAttribute(value: string) {
  return value.replace(/"/g, '&quot;');
}

function buildSelectorPartDraft(entry: SelectorEntry) {
  return [
    `/* @polaris-part target="${escapePartAttribute(entry.alias)}" name="${escapePartAttribute(entry.name)}" */`,
    `${entry.selectors.join(',\n')} {`,
    '  ',
    '}',
    '/* @end-polaris-part */'
  ].join('\n');
}

function wrapSelectorPartDraft(entry: SelectorEntry, css: string) {
  return [
    `/* @polaris-part target="${escapePartAttribute(entry.alias)}" name="${escapePartAttribute(entry.name)}" */`,
    css.trim(),
    '/* @end-polaris-part */'
  ].join('\n');
}

export function CustomCssSection({
  themeCustomCss,
  guard,
  applyFeedback,
  onCustomCssDraftChange,
  onClearCustomCss
}: CustomCssSectionProps) {
  const { t } = useI18n();
  const hasCustomCss = Boolean(themeCustomCss.trim());
  const guardHasBlockingIssues = guard.blockingIssues.length > 0;
  const cssParts = useMemo(() => parsePolarisCssParts(themeCustomCss), [themeCustomCss]);
  const partByTarget = useMemo(() => new Map(cssParts.map((part) => [part.target, part])), [cssParts]);
  const selectorGroups = useMemo(() => {
    return SELECTOR_CATALOG.reduce<Record<SelectorEntry['group'], SelectorEntry[]>>(
      (groups, entry) => {
        groups[entry.group].push(entry);
        return groups;
      },
      { chat: [], collection: [], app: [] }
    );
  }, []);
  const [cssDraft, setCssDraft] = useState('');
  const [selectedPartTarget, setSelectedPartTarget] = useState<string | null>(null);
  const selectedSelector = selectedPartTarget
    ? SELECTOR_CATALOG.find((entry) => entry.alias === selectedPartTarget) ?? null
    : null;
  const selectedPart = selectedSelector ? partByTarget.get(selectedSelector.alias) ?? null : null;
  const cssEditorTitle = selectedSelector ? selectedSelector.name : t('theme.css.globalDetection');
  const cssEditorDetail = selectedSelector ? selectedSelector.alias : t('theme.css.globalDetail');

  useEffect(() => {
    if (!selectedSelector) return;
    setCssDraft(selectedPart?.raw ?? buildSelectorPartDraft(selectedSelector));
  }, [selectedPart, selectedSelector]);

  useEffect(() => {
    if (selectedSelector) return;
    setCssDraft('');
  }, [selectedSelector]);

  const applyDirectCssDraft = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onCustomCssDraftChange(trimmed, {
      feedback: true
    });
  };

  const applySelectedPartDraft = (value: string, entry: SelectorEntry) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onCustomCssDraftChange(hasPolarisCssParts(trimmed) ? trimmed : wrapSelectorPartDraft(entry, trimmed));
  };

  const handleCssDraftChange = (value: string) => {
    setCssDraft(value);
    if (!selectedSelector) return;
    applySelectedPartDraft(value, selectedSelector);
  };

  const handleApplyCssDraft = () => {
    if (selectedSelector) {
      applySelectedPartDraft(cssDraft, selectedSelector);
      return;
    }
    applyDirectCssDraft(cssDraft);
  };

  const handleSelectorClick = (entry: SelectorEntry) => {
    setSelectedPartTarget((current) => current === entry.alias ? null : entry.alias);
  };

  return (
    <section className="theme-studio-section theme-css-section">
      <div className="theme-studio-section-head">
        <h3>{t('theme.css.title')}</h3>
        {hasCustomCss && (
          <button type="button" className="theme-inline-action" onClick={onClearCustomCss}>
            {t('theme.css.clear')}
          </button>
        )}
      </div>

      {guardHasBlockingIssues && (
        <div className="theme-css-guard-card">
          <div className="theme-css-guard-list danger">
            {guard.blockingIssues.map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
        </div>
      )}
      {guard.warnings.length > 0 && (
        <div className="theme-css-guard-card">
          <div className="theme-css-guard-list warn">
            {guard.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        </div>
      )}

      <div className="theme-css-direct-panel">
        <div className="theme-css-panel-head">
          <strong>{cssEditorTitle}</strong>
          <span>{cssEditorDetail}</span>
          <button
            type="button"
            className="theme-inline-action"
            disabled={!cssDraft.trim()}
            onClick={handleApplyCssDraft}
          >
            {t('theme.css.apply')}
          </button>
        </div>
        <textarea
          className="theme-css-editor theme-css-direct-editor"
          value={cssDraft}
          onChange={(event) => handleCssDraftChange(event.target.value)}
          placeholder={selectedSelector ? t('theme.css.selectorPlaceholder') : t('theme.css.globalPlaceholder')}
        />
        {applyFeedback ? (
          <div
            key={applyFeedback.id}
            className={`theme-css-apply-feedback ${applyFeedback.kind}`}
            role="status"
            aria-live="polite"
          >
            <Icon name={applyFeedback.kind === 'applied' ? 'check' : 'x'} size={13} />
            <span>{applyFeedback.message}</span>
          </div>
        ) : null}
      </div>

      <div className="theme-css-parts-panel">
        <div className="theme-css-panel-head">
          <strong>{t('theme.css.selectorTitle')}</strong>
          <span>{t('theme.css.selectorCount', { count: SELECTOR_CATALOG.length })}</span>
        </div>

        <div className="theme-css-selector-catalog" aria-label={t('theme.css.selectorCatalogAria')}>
          {(['chat', 'collection', 'app'] as const).map((group) => (
            <div key={group} className="theme-css-selector-group">
              <div className="theme-css-selector-group-title">{t(SELECTOR_GROUP_LABEL_KEYS[group])}</div>
              <div className="theme-css-part-list">
                {selectorGroups[group].map((entry) => {
                  const hasPart = partByTarget.has(entry.alias);
                  return (
                    <button
                      key={entry.alias}
                      type="button"
                      className={selectedPartTarget === entry.alias ? 'active' : ''}
                      onClick={() => handleSelectorClick(entry)}
                    >
                      <span className="theme-css-part-row">
                        <strong>{entry.name}</strong>
                        {hasPart ? <em>{t('theme.css.hasPart')}</em> : null}
                      </span>
                      <span>{entry.alias}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
