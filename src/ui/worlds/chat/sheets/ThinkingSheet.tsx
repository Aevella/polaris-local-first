import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ToolInvocation } from '../../../../types/domain';
import type { I18nTranslator } from '../../../../i18n';
import { APP_LANGUAGE_LABELS, useI18n } from '../../../../i18n';
import type { ThinkingTranslationResult, ThinkingTranslationSection } from '../../../../engines/thinkingTranslation';
import { Icon } from '../../../Icon';
import { toolIconName } from '../chatToolIcons';
import { buildThinkingSessionSummary, buildThinkingSummary, createThinkingSummaryCopy } from '../thinkingSummary';

type ThinkingSheetProps = {
  message: ChatMessage | null;
  messages: ChatMessage[];
  assistantName: string;
  onTranslate: (
    sections: ThinkingTranslationSection[],
    targetLanguage: string,
    signal?: AbortSignal
  ) => Promise<ThinkingTranslationResult>;
  onClose: () => void;
};

function localizeToolStatus(status: ToolInvocation['status'], t: I18nTranslator['t']) {
  switch (status) {
    case 'running':
      return t('chat.thinking.toolStatus.running');
    case 'preview':
      return t('chat.thinking.toolStatus.preview');
    case 'applied':
      return t('chat.thinking.toolStatus.applied');
    case 'rolled_back':
      return t('chat.thinking.toolStatus.rolled_back');
    case 'superseded':
      return t('chat.thinking.toolStatus.superseded');
    case 'executed':
      return t('chat.thinking.toolStatus.executed');
    case 'saved':
      return t('chat.thinking.toolStatus.saved');
    case 'failed':
      return t('chat.thinking.toolStatus.failed');
    default:
      return status;
  }
}

export function ThinkingSheet({
  message,
  messages,
  assistantName,
  onTranslate,
  onClose
}: ThinkingSheetProps) {
  const { language, t } = useI18n();
  const [rawExpanded, setRawExpanded] = useState(false);
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'loading' | 'translated' | 'error'>('idle');
  const [translations, setTranslations] = useState<ThinkingTranslationResult>({});
  const [translationError, setTranslationError] = useState('');
  const translationAbortRef = useRef<AbortController | null>(null);
  const copy = useMemo(() => createThinkingSummaryCopy(t), [t]);
  const session = useMemo(
    () => (message ? buildThinkingSessionSummary(messages, message.id, copy) : null),
    [copy, message, messages]
  );
  const translationSections = useMemo<ThinkingTranslationSection[]>(() => (
    session?.steps.flatMap((step) => {
      if (step.kind === 'thinking') {
        return [{ id: `thought:${step.id}`, text: step.rawText }];
      }
      return [
        { id: `tool-title:${step.id}`, text: step.tool.title },
        { id: `tool-summary:${step.id}`, text: step.tool.summary }
      ].filter((section) => section.text.trim());
    }) ?? []
  ), [session]);

  useEffect(() => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    setRawExpanded(false);
    setTranslationStatus('idle');
    setTranslations({});
    setTranslationError('');
  }, [language, message?.id]);

  useEffect(() => () => translationAbortRef.current?.abort(), []);

  const requestTranslation = async () => {
    if (translationStatus === 'translated') {
      setTranslationStatus('idle');
      return;
    }
    if (translationStatus === 'loading' || translationSections.length === 0) return;

    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslationStatus('loading');
    setTranslationError('');
    try {
      const result = await onTranslate(
        translationSections,
        APP_LANGUAGE_LABELS[language],
        controller.signal
      );
      if (controller.signal.aborted || translationAbortRef.current !== controller) return;
      setTranslations(result);
      setTranslationStatus('translated');
    } catch (error) {
      if (controller.signal.aborted || translationAbortRef.current !== controller) return;
      setTranslationError(error instanceof Error ? error.message : t('chat.thinking.translationFailed'));
      setTranslationStatus('error');
    } finally {
      if (translationAbortRef.current === controller) translationAbortRef.current = null;
    }
  };

  if (!message || !session) return null;

  return (
    <div className="thinking-summary-overlay" role="dialog" aria-modal="true" aria-label={t('chat.thinking.sheetAria')}>
      <button type="button" className="thinking-summary-backdrop" aria-label={t('chat.thinking.closeAria')} onClick={onClose} />
      <div className="thinking-summary-sheet">
        <div className="sheet-handle" />
        <div className="thinking-summary-topbar">
          <button type="button" className="thinking-summary-close" onClick={onClose} aria-label={t('chat.thinking.closeAria')}>
            <Icon name="x" size={18} />
          </button>
          <div className="thinking-summary-title">
            <strong>Summary</strong>
            <span>{[message.assistantName || assistantName, session.statsLabel].filter(Boolean).join(' · ')}</span>
          </div>
          <button
            type="button"
            className={`thinking-summary-translate ${translationStatus}`}
            onClick={() => { void requestTranslation(); }}
            disabled={translationStatus === 'loading'}
            aria-busy={translationStatus === 'loading'}
          >
            {translationStatus === 'translated'
              ? t('chat.thinking.showOriginal')
              : translationStatus === 'loading'
                ? t('chat.thinking.translating')
                : t('chat.thinking.translate')}
          </button>
        </div>
        {translationStatus === 'error' ? (
          <div className="thinking-summary-translation-error" role="alert">
            <span>{translationError || t('chat.thinking.translationFailed')}</span>
            <button type="button" onClick={() => { void requestTranslation(); }}>
              {t('chat.thinking.translationRetry')}
            </button>
          </div>
        ) : null}
        <div className="thinking-summary-list">
          {session.steps.map((step) => (
            <article key={step.id} className={`thinking-summary-step ${step.kind}`}>
              <div className="thinking-summary-item-rail" aria-hidden="true">
                <span className={`thinking-summary-item-dot ${step.kind} ${step.kind === 'tool' ? step.tool.status : ''}`}>
                  {step.kind === 'thinking' ? <Icon name="polarisStar" size={11} color="polarisDeepSpace" /> : <Icon name={toolIconName(step.tool)} size={12} />}
                </span>
              </div>
              <div className={`thinking-summary-step-shell ${step.kind} ${step.kind === 'tool' ? step.tool.status : ''}`}>
                {step.kind === 'thinking' ? (
                  <div className="thinking-summary-phase-list">
                    {buildThinkingSummary(
                      translationStatus === 'translated'
                        ? translations[`thought:${step.id}`] ?? step.rawText
                        : step.rawText
                    ).map((item) => (
                      <div key={item.id} className={`thinking-summary-phase-item ${item.kind}`}>
                        <span className={`thinking-summary-phase-dot ${item.kind}`} aria-hidden="true" />
                        <div className="thinking-summary-phase-copy">
                          <p>{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="thinking-summary-tool-head">
                      <span className="thinking-summary-step-kicker">{t('chat.thinking.toolKicker')}</span>
                      <span className={`thinking-summary-tool-status ${step.tool.status}`}>{localizeToolStatus(step.tool.status, t)}</span>
                    </div>
                    <strong className="thinking-summary-step-preview">
                      {translationStatus === 'translated'
                        ? translations[`tool-title:${step.id}`] ?? step.tool.title
                        : step.tool.title}
                    </strong>
                    <p className="thinking-summary-tool-detail">
                      {translationStatus === 'translated'
                        ? translations[`tool-summary:${step.id}`] ?? step.tool.summary
                        : step.tool.summary}
                    </p>
                    {step.tool.themeSurfaceLabels?.length ? (
                      <div className="thinking-summary-tool-chip-row">
                        {step.tool.themeSurfaceLabels.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                    ) : null}
                    {step.tool.memoryItems?.length ? (
                      <div className="thinking-summary-tool-chip-row">
                        {step.tool.memoryItems.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="thinking-summary-raw">
          <button
            type="button"
            className="thinking-summary-raw-toggle"
            onClick={() => setRawExpanded((value) => !value)}
            aria-expanded={rawExpanded}
          >
            <span>{t('chat.thinking.raw')}</span>
            <Icon name={rawExpanded ? 'chevronUp' : 'chevronDown'} size={14} />
          </button>
          {rawExpanded ? (
            <div className="thinking-summary-raw-sections">
              {session.rawSections.map((section) => (
                <section key={section.id} className="thinking-summary-raw-section">
                  <span className="thinking-summary-raw-kicker">{section.label}</span>
                  <pre className="thinking-summary-raw-body">
                    {translationStatus === 'translated'
                      ? translations[`thought:${section.id.replace(/-raw$/, '')}`] ?? section.content
                      : section.content}
                  </pre>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
