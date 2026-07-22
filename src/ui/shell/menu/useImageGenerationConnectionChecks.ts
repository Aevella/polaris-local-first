import { useEffect, useMemo, useRef, useState } from 'react';
import {
  checkImageGenerationConfiguration,
  requestImageGenerationConnectivityTest
} from '../../../engines/imageGenerationClient';
import type { I18nTranslator } from '../../../i18n';
import type { ImageGenerationSettings, ProviderProfile } from '../../../types/domain';

type UseImageGenerationConnectionChecksArgs = {
  imageGeneration: ImageGenerationSettings;
  providers: ProviderProfile[];
  t: I18nTranslator['t'];
};

export function useImageGenerationConnectionChecks({
  imageGeneration,
  providers,
  t
}: UseImageGenerationConnectionChecksArgs) {
  const [state, setState] = useState<'idle' | 'loading'>('idle');
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === imageGeneration.providerId),
    [imageGeneration.providerId, providers]
  );
  const checkButtonLabel = t('settings.generation.checkConfig');
  const testButtonLabel = state === 'loading'
    ? t('settings.generation.testLoadingShort')
    : t('settings.generation.testConnection');

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const clearStatus = () => {
    setStatus('');
  };

  const checkConfig = () => {
    if (!selectedProvider) {
      setStatus(t('settings.generation.testMissingProvider'));
      return;
    }

    try {
      const result = checkImageGenerationConfiguration({
        api: selectedProvider,
        settings: {
          ...imageGeneration,
          enabled: true
        }
      });
      setStatus(t('settings.generation.checkSuccess', {
        endpoint: result.endpoint,
        model: result.model,
        size: result.size
      }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('settings.generation.checkFailed'));
    }
  };

  const generateTestImage = async () => {
    if (state === 'loading') return;
    if (!selectedProvider) {
      setStatus(t('settings.generation.testMissingProvider'));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState('loading');
    setStatus(t('settings.generation.testLoading'));

    try {
      const result = await requestImageGenerationConnectivityTest({
        api: selectedProvider,
        settings: {
          ...imageGeneration,
          enabled: true
        },
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      setStatus(t('settings.generation.testSuccess', {
        model: result.model,
        size: result.size,
        mimeType: result.mimeType
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : t('settings.generation.testFailed'));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setState('idle');
      }
    }
  };

  return {
    checkButtonLabel,
    checkConfig,
    clearStatus,
    generateTestImage,
    state,
    status,
    testButtonLabel
  };
}
