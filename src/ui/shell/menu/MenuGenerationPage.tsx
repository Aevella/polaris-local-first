import type {
  ImageGenerationSettings,
  ImageGenerationSize,
  ProviderProfile
} from '../../../types/domain';
import { useI18n } from '../../../i18n';
import { HelpHint } from '../../HelpHint';
import { Icon } from '../../Icon';
import { useImageGenerationConnectionChecks } from './useImageGenerationConnectionChecks';

type MenuGenerationPageProps = {
  imageGeneration: ImageGenerationSettings;
  providers: ProviderProfile[];
  onBack: () => void;
  onSetImageGeneration: (patch: Partial<ImageGenerationSettings>) => void;
};

export function MenuGenerationPage({
  imageGeneration,
  providers,
  onBack,
  onSetImageGeneration
}: MenuGenerationPageProps) {
  const { t } = useI18n();
  const connectionCheck = useImageGenerationConnectionChecks({ imageGeneration, providers, t });
  const imageSizeOptions: Array<{ value: ImageGenerationSize; label: string }> = [
    { value: '1024x1024', label: t('settings.generation.sizeSquare') },
    { value: '1024x1536', label: t('settings.generation.sizePortrait') },
    { value: '1536x1024', label: t('settings.generation.sizeLandscape') },
    { value: 'auto', label: t('settings.generation.sizeAuto') }
  ];
  const imageGenerationStateLabel = imageGeneration.enabled ? t('settings.enabled') : t('settings.disabled');

  return (
    <div className="menu-sheet-page">
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title">
          <h2>{t('settings.generation.title')}</h2>
        </div>
      </div>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker menu-section-kicker-row">
            {t('settings.generation.imageSection')}
            <HelpHint
              label={t('settings.generation.imageHelpLabel')}
              text={t('settings.generation.imageHelpText')}
            />
          </span>
          <p className="menu-section-note">{t('settings.generation.note')}</p>
        </div>

        <div className="memory-toggle-grid">
          <div className="memory-toggle memory-toggle--switch toolbox-toggle-row" data-checked={imageGeneration.enabled ? 'true' : 'false'}>
            <div className="toolbox-toggle-row-head">
              <div className="memory-toggle-copy toolbox-toggle-copy">
                <strong>
                  <span className="toolbox-toggle-icon" aria-hidden="true">
                    <Icon name="image" size={13} />
                  </span>
                  {t('settings.generation.toggleTitle')}
                </strong>
                <span>{t('settings.generation.toggleDetail')}</span>
              </div>
              <button
                type="button"
                className={`ps-toggle-sw memory-toggle-switch ${imageGeneration.enabled ? 'ps-toggle-sw--on' : ''}`}
                aria-pressed={imageGeneration.enabled}
                aria-label={`${t('settings.generation.toggleTitle')} ${imageGenerationStateLabel}`}
                onClick={() => onSetImageGeneration({ enabled: !imageGeneration.enabled })}
              >
                <span className="ps-toggle-knob" />
              </button>
            </div>

            {imageGeneration.enabled ? (
              <div className="toolbox-inline-config">
                <div className="settings-form">
                  <label>{t('settings.generation.providerLabel')}</label>
                  <select
                    value={imageGeneration.providerId ?? ''}
                    onChange={(event) => {
                      connectionCheck.clearStatus();
                      onSetImageGeneration({ providerId: event.target.value });
                    }}
                  >
                    <option value="" disabled>{t('settings.generation.providerPlaceholder')}</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} · {provider.model}
                      </option>
                    ))}
                  </select>

                  <label>{t('settings.generation.modelLabel')}</label>
                  <input
                    value={imageGeneration.modelOverride ?? ''}
                    onChange={(event) => {
                      connectionCheck.clearStatus();
                      onSetImageGeneration({ modelOverride: event.target.value });
                    }}
                    placeholder={t('settings.generation.modelPlaceholder')}
                  />

                  <label>{t('settings.generation.sizeLabel')}</label>
                  <select
                    value={imageGeneration.size ?? '1024x1024'}
                    onChange={(event) => {
                      connectionCheck.clearStatus();
                      onSetImageGeneration({ size: event.target.value as ImageGenerationSize });
                    }}
                  >
                    {imageSizeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <div className="voice-setting-row">
                    <button
                      type="button"
                      className="btn-secondary compact voice-preview-button"
                      onClick={connectionCheck.checkConfig}
                      disabled={connectionCheck.state === 'loading'}
                      aria-label={connectionCheck.checkButtonLabel}
                      title={connectionCheck.checkButtonLabel}
                    >
                      <Icon name="check" size={14} />
                      <span>{connectionCheck.checkButtonLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary compact voice-preview-button"
                      onClick={connectionCheck.generateTestImage}
                      disabled={connectionCheck.state === 'loading'}
                      aria-label={connectionCheck.testButtonLabel}
                      title={connectionCheck.testButtonLabel}
                    >
                      <Icon name={connectionCheck.state === 'loading' ? 'refresh' : 'play'} size={14} />
                      <span>{connectionCheck.testButtonLabel}</span>
                    </button>
                  </div>
                  <p className="voice-preview-status" data-state="idle">{t('settings.generation.testCostNote')}</p>
                  {connectionCheck.status ? (
                    <p className="voice-preview-status" data-state={connectionCheck.state}>{connectionCheck.status}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
