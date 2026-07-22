import { useEffect, useMemo, useRef, useState } from 'react';
import { requestGeneratedSpeech } from '../../../engines/voiceGenerationClient';
import type {
  VoiceGenerationFormat,
  VoiceGenerationProviderType,
  VoiceGenerationSettings
} from '../../../types/domain';
import { useI18n } from '../../../i18n';
import { HelpHint } from '../../HelpHint';
import { Icon } from '../../Icon';
import { MiniMaxVoiceDesignerDialog } from './MiniMaxVoiceDesignerDialog';

type MenuVoicePageProps = {
  voiceGeneration: VoiceGenerationSettings;
  onBack: () => void;
  onSetVoiceGeneration: (patch: Partial<VoiceGenerationSettings>) => void;
};

type VoicePreset = {
  value: string;
  label: string;
};

const CUSTOM_VOICE_VALUE = '__custom_voice__';

const VOICE_PRESETS: Record<VoiceGenerationProviderType, VoicePreset[]> = {
  'openai-compatible': [
    { value: 'alloy', label: 'Alloy' },
    { value: 'echo', label: 'Echo' },
    { value: 'fable', label: 'Fable' },
    { value: 'onyx', label: 'Onyx' },
    { value: 'nova', label: 'Nova' },
    { value: 'shimmer', label: 'Shimmer' }
  ],
  minimax: [
    { value: 'Chinese (Mandarin)_Warm_Girl', label: 'Warm Girl' }
  ],
  elevenlabs: [
    { value: 'JBFqnCBsd6RMkjVDRZzb', label: 'Default multilingual' }
  ],
  fishaudio: []
};

export function MenuVoicePage({
  voiceGeneration,
  onBack,
  onSetVoiceGeneration
}: MenuVoicePageProps) {
  const { t } = useI18n();
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [previewStatus, setPreviewStatus] = useState('');
  const [voiceDesignerOpen, setVoiceDesignerOpen] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const voiceGenerationStateLabel = voiceGeneration.enabled ? t('settings.enabled') : t('settings.disabled');
  const voiceProviderType = voiceGeneration.providerType ?? 'openai-compatible';
  const voicePresets = useMemo(() => {
    const presets = [...VOICE_PRESETS[voiceProviderType]];
    for (const customVoice of voiceGeneration.customVoices ?? []) {
      if (customVoice.providerType !== voiceProviderType) continue;
      if (presets.some((preset) => preset.value === customVoice.voice)) continue;
      presets.push({
        value: customVoice.voice,
        label: customVoice.label
      });
    }
    return presets;
  }, [voiceGeneration.customVoices, voiceProviderType]);
  const selectedVoicePreset = voicePresets.some((preset) => preset.value === voiceGeneration.voice)
    ? voiceGeneration.voice ?? CUSTOM_VOICE_VALUE
    : CUSTOM_VOICE_VALUE;
  const voiceProviderTypeOptions: Array<{ value: VoiceGenerationProviderType; label: string }> = [
    { value: 'openai-compatible', label: t('settings.voice.providerTypeOpenAi') },
    { value: 'minimax', label: t('settings.voice.providerTypeMiniMax') },
    { value: 'elevenlabs', label: t('settings.voice.providerTypeElevenLabs') },
    { value: 'fishaudio', label: t('settings.voice.providerTypeFishAudio') }
  ];
  const openAiVoiceFormatOptions: Array<{ value: VoiceGenerationFormat; label: string }> = [
    { value: 'mp3', label: 'MP3' },
    { value: 'opus', label: 'Opus' },
    { value: 'aac', label: 'AAC' },
    { value: 'flac', label: 'FLAC' },
    { value: 'wav', label: 'WAV' },
    { value: 'pcm', label: 'PCM' }
  ];
  const miniMaxVoiceFormatOptions = openAiVoiceFormatOptions.filter((option) => option.value === 'mp3' || option.value === 'flac' || option.value === 'wav');
  const elevenLabsVoiceFormatOptions = openAiVoiceFormatOptions.filter((option) => (
    option.value === 'mp3'
    || option.value === 'opus'
    || option.value === 'pcm'
    || option.value === 'wav'
  ));
  const fishAudioVoiceFormatOptions = elevenLabsVoiceFormatOptions;
  const voiceFormatOptions = voiceProviderType === 'minimax'
    ? miniMaxVoiceFormatOptions
    : voiceProviderType === 'elevenlabs'
      ? elevenLabsVoiceFormatOptions
      : voiceProviderType === 'fishaudio'
        ? fishAudioVoiceFormatOptions
        : openAiVoiceFormatOptions;
  const voiceModelPlaceholder = voiceProviderType === 'minimax'
    ? t('settings.voice.modelPlaceholderMiniMax')
    : voiceProviderType === 'elevenlabs'
      ? t('settings.voice.modelPlaceholderElevenLabs')
      : voiceProviderType === 'fishaudio'
        ? t('settings.voice.modelPlaceholderFishAudio')
        : t('settings.voice.modelPlaceholder');
  const voiceNamePlaceholder = voiceProviderType === 'minimax'
    ? t('settings.voice.namePlaceholderMiniMax')
    : voiceProviderType === 'elevenlabs'
      ? t('settings.voice.namePlaceholderElevenLabs')
      : voiceProviderType === 'fishaudio'
        ? t('settings.voice.namePlaceholderFishAudio')
        : t('settings.voice.namePlaceholder');

  const stopVoicePreview = () => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      previewAudioRef.current = null;
    }
    const audioUrl = previewAudioUrlRef.current;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      previewAudioUrlRef.current = null;
    }
    setPreviewState('idle');
  };

  useEffect(() => () => {
    stopVoicePreview();
  }, []);

  const setVoiceProviderType = (providerType: VoiceGenerationProviderType) => {
    stopVoicePreview();
    setPreviewStatus('');
    const patch: Partial<VoiceGenerationSettings> = {
      providerType,
      path: providerType === 'minimax'
        ? '/t2a_v2'
        : providerType === 'elevenlabs'
          ? '/text-to-speech'
          : providerType === 'fishaudio'
            ? '/tts'
            : '/audio/speech'
    };
    if (providerType === 'openai-compatible') {
      if (!voiceGeneration.voice?.trim()) {
        patch.voice = 'alloy';
      }
    }
    if (providerType === 'minimax') {
      if (!voiceGeneration.model?.trim()) {
        patch.model = 'speech-2.8-turbo';
      }
      if (!voiceGeneration.voice?.trim() || voiceGeneration.voice === 'alloy') {
        patch.voice = 'Chinese (Mandarin)_Warm_Girl';
      }
      if (voiceGeneration.format && !miniMaxVoiceFormatOptions.some((option) => option.value === voiceGeneration.format)) {
        patch.format = 'mp3';
      }
    }
    if (providerType === 'elevenlabs') {
      if (!voiceGeneration.model?.trim() || voiceGeneration.model === 'speech-2.8-turbo') {
        patch.model = 'eleven_multilingual_v2';
      }
      if (!voiceGeneration.voice?.trim() || voiceGeneration.voice === 'alloy' || voiceGeneration.voice === 'Chinese (Mandarin)_Warm_Girl') {
        patch.voice = 'JBFqnCBsd6RMkjVDRZzb';
      }
      if (voiceGeneration.format && !elevenLabsVoiceFormatOptions.some((option) => option.value === voiceGeneration.format)) {
        patch.format = 'mp3';
      }
    }
    if (providerType === 'fishaudio') {
      if (!voiceGeneration.model?.trim() || voiceGeneration.model === 'speech-2.8-turbo' || voiceGeneration.model === 'eleven_multilingual_v2') {
        patch.model = 's2-pro';
      }
      if (
        voiceGeneration.voice === 'alloy'
        || voiceGeneration.voice === 'Chinese (Mandarin)_Warm_Girl'
        || voiceGeneration.voice === 'JBFqnCBsd6RMkjVDRZzb'
      ) {
        patch.voice = '';
      }
      if (voiceGeneration.format && !fishAudioVoiceFormatOptions.some((option) => option.value === voiceGeneration.format)) {
        patch.format = 'mp3';
      }
    }
    onSetVoiceGeneration(patch);
  };

  const setVoicePreset = (value: string) => {
    stopVoicePreview();
    setPreviewStatus('');
    if (value === CUSTOM_VOICE_VALUE) {
      onSetVoiceGeneration({ voice: '' });
      return;
    }
    onSetVoiceGeneration({ voice: value });
  };

  const setCustomVoice = (voice: string) => {
    stopVoicePreview();
    setPreviewStatus('');
    onSetVoiceGeneration({ voice });
  };

  const playVoicePreview = async () => {
    if (previewState !== 'idle') {
      stopVoicePreview();
      setPreviewStatus('');
      return;
    }
    if (!voiceGeneration.baseUrl?.trim() || !voiceGeneration.apiKey?.trim()) {
      setPreviewStatus(t('settings.voice.previewMissingConfig'));
      return;
    }

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewState('loading');
    setPreviewStatus(t('settings.voice.previewLoading'));
    try {
      const result = await requestGeneratedSpeech({
        settings: {
          ...voiceGeneration,
          enabled: true
        },
        text: t('settings.voice.previewText'),
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      const audioUrl = URL.createObjectURL(result.blob);
      const audio = new Audio(audioUrl);
      previewAudioRef.current = audio;
      previewAudioUrlRef.current = audioUrl;
      audio.onended = () => {
        stopVoicePreview();
        setPreviewStatus(t('settings.voice.previewReady'));
      };
      audio.onerror = () => {
        stopVoicePreview();
        setPreviewStatus(t('settings.voice.previewFailed'));
      };
      setPreviewState('playing');
      setPreviewStatus(t('settings.voice.previewPlaying'));
      await audio.play();
    } catch (error) {
      if (controller.signal.aborted) return;
      stopVoicePreview();
      const message = error instanceof Error ? error.message : t('settings.voice.previewFailed');
      setPreviewStatus(message);
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
    }
  };

  const previewButtonLabel = previewState === 'loading'
    ? t('settings.voice.previewLoadingShort')
    : previewState === 'playing'
      ? t('settings.voice.previewStop')
      : t('settings.voice.previewPlay');

  return (
    <div className="menu-sheet-page">
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title">
          <h2>{t('settings.voice.title')}</h2>
        </div>
      </div>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker menu-section-kicker-row">
            {t('settings.voice.section')}
            <HelpHint
              label={t('settings.voice.helpLabel')}
              text={t('settings.voice.helpText')}
            />
          </span>
          <p className="menu-section-note">{t('settings.voice.note')}</p>
        </div>

        <div className="memory-toggle-grid">
          <div className="memory-toggle memory-toggle--switch toolbox-toggle-row" data-checked={voiceGeneration.enabled ? 'true' : 'false'}>
            <div className="toolbox-toggle-row-head">
              <div className="memory-toggle-copy toolbox-toggle-copy">
                <strong>
                  <span className="toolbox-toggle-icon" aria-hidden="true">
                    <Icon name="voice" size={13} />
                  </span>
                  {t('settings.voice.toggleTitle')}
                </strong>
                <span>{t('settings.voice.toggleDetail')}</span>
              </div>
              <button
                type="button"
                className={`ps-toggle-sw memory-toggle-switch ${voiceGeneration.enabled ? 'ps-toggle-sw--on' : ''}`}
                aria-pressed={voiceGeneration.enabled}
                aria-label={`${t('settings.voice.toggleTitle')} ${voiceGenerationStateLabel}`}
                onClick={() => onSetVoiceGeneration({ enabled: !voiceGeneration.enabled })}
              >
                <span className="ps-toggle-knob" />
              </button>
            </div>

            {voiceGeneration.enabled ? (
              <div className="toolbox-inline-config">
                <div className="settings-form">
                  <label>{t('settings.voice.providerTypeLabel')}</label>
                  <select
                    value={voiceProviderType}
                    onChange={(event) => setVoiceProviderType(event.target.value as VoiceGenerationProviderType)}
                  >
                    {voiceProviderTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <label>{t('settings.voice.baseUrlLabel')}</label>
                  <input
                    value={voiceGeneration.baseUrl ?? ''}
                    onChange={(event) => onSetVoiceGeneration({ baseUrl: event.target.value })}
                    placeholder={t('settings.voice.baseUrlPlaceholder')}
                  />

                  <label>{t('settings.voice.apiKeyLabel')}</label>
                  <input
                    type="password"
                    value={voiceGeneration.apiKey ?? ''}
                    onChange={(event) => onSetVoiceGeneration({ apiKey: event.target.value })}
                    placeholder={t('settings.voice.apiKeyPlaceholder')}
                  />

                  <label>{t('settings.voice.modelLabel')}</label>
                  <input
                    value={voiceGeneration.model ?? ''}
                    onChange={(event) => onSetVoiceGeneration({ model: event.target.value })}
                    placeholder={voiceModelPlaceholder}
                  />

                  <label>{t('settings.voice.pathLabel')}</label>
                  <input
                    value={voiceGeneration.path ?? '/audio/speech'}
                    onChange={(event) => onSetVoiceGeneration({ path: event.target.value })}
                    placeholder={t('settings.voice.pathPlaceholder')}
                  />

                  <label>{t('settings.voice.presetLabel')}</label>
                  <div className="voice-preset-row">
                    <select
                      value={selectedVoicePreset}
                      onChange={(event) => setVoicePreset(event.target.value)}
                    >
                      {voicePresets.map((preset) => (
                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                      ))}
                      <option value={CUSTOM_VOICE_VALUE}>{t('settings.voice.presetCustom')}</option>
                    </select>
                    {voiceProviderType === 'minimax' ? (
                      <button
                        type="button"
                        className="btn-secondary compact voice-library-button"
                        onClick={() => setVoiceDesignerOpen(true)}
                      >
                        <Icon name="wand" size={14} />
                        <span>{t('settings.voice.designerOpen')}</span>
                      </button>
                    ) : null}
                  </div>

                  <label>{t('settings.voice.nameLabel')}</label>
                  <div className="voice-setting-row">
                    <input
                      value={voiceGeneration.voice ?? ''}
                      onChange={(event) => setCustomVoice(event.target.value)}
                      placeholder={voiceNamePlaceholder}
                    />
                    <button
                      type="button"
                      className="btn-secondary compact voice-preview-button"
                      onClick={playVoicePreview}
                      aria-label={previewButtonLabel}
                      title={previewButtonLabel}
                    >
                      <Icon name={previewState === 'playing' || previewState === 'loading' ? 'pause' : 'play'} size={14} />
                      <span>{previewButtonLabel}</span>
                    </button>
                  </div>
                  {previewStatus ? (
                    <p className="voice-preview-status" data-state={previewState}>{previewStatus}</p>
                  ) : null}

                  <label>{t('settings.voice.formatLabel')}</label>
                  <select
                    value={voiceGeneration.format ?? 'mp3'}
                    onChange={(event) => onSetVoiceGeneration({ format: event.target.value as VoiceGenerationFormat })}
                  >
                    {voiceFormatOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {voiceDesignerOpen ? (
        <MiniMaxVoiceDesignerDialog
          voiceGeneration={voiceGeneration}
          onClose={() => setVoiceDesignerOpen(false)}
          onSetVoiceGeneration={onSetVoiceGeneration}
        />
      ) : null}
    </div>
  );
}
