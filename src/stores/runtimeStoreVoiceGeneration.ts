import type {
  ProviderProfile,
  VoiceGenerationCustomVoice,
  VoiceGenerationCustomVoiceSource,
  VoiceGenerationFormat,
  VoiceGenerationProviderType,
  VoiceGenerationSettings
} from '../types/domain';

const VOICE_GENERATION_FORMATS = new Set<VoiceGenerationFormat>([
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm'
]);

const VOICE_GENERATION_PROVIDER_TYPES = new Set<VoiceGenerationProviderType>([
  'openai-compatible',
  'minimax',
  'elevenlabs',
  'fishaudio'
]);

const VOICE_GENERATION_CUSTOM_VOICE_SOURCES = new Set<VoiceGenerationCustomVoiceSource>([
  'manual',
  'minimax-system',
  'minimax-clone',
  'minimax-generation'
]);

export const DEFAULT_VOICE_GENERATION_SETTINGS: VoiceGenerationSettings = {
  enabled: false,
  providerType: 'openai-compatible',
  baseUrl: '',
  path: '/audio/speech',
  apiKey: '',
  model: '',
  voice: 'alloy',
  customVoices: [],
  format: 'mp3'
};

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeVoiceGenerationFormat(value: unknown): VoiceGenerationFormat {
  return typeof value === 'string' && VOICE_GENERATION_FORMATS.has(value as VoiceGenerationFormat)
    ? value as VoiceGenerationFormat
    : DEFAULT_VOICE_GENERATION_SETTINGS.format ?? 'mp3';
}

function normalizeVoiceGenerationProviderType(value: unknown): VoiceGenerationProviderType {
  return typeof value === 'string' && VOICE_GENERATION_PROVIDER_TYPES.has(value as VoiceGenerationProviderType)
    ? value as VoiceGenerationProviderType
    : DEFAULT_VOICE_GENERATION_SETTINGS.providerType ?? 'openai-compatible';
}

function defaultVoiceGenerationPath(providerType: VoiceGenerationProviderType) {
  if (providerType === 'minimax') return '/t2a_v2';
  if (providerType === 'elevenlabs') return '/text-to-speech';
  if (providerType === 'fishaudio') return '/tts';
  return '/audio/speech';
}

function findLegacyVoiceProvider(providerId: string | undefined, providers: ProviderProfile[]) {
  if (!providerId) return null;
  return providers.find((provider) => provider.id === providerId) ?? null;
}

function normalizeCustomVoiceSource(value: unknown): VoiceGenerationCustomVoiceSource {
  return typeof value === 'string' && VOICE_GENERATION_CUSTOM_VOICE_SOURCES.has(value as VoiceGenerationCustomVoiceSource)
    ? value as VoiceGenerationCustomVoiceSource
    : 'manual';
}

export function normalizeVoiceGenerationCustomVoices(value: unknown): VoiceGenerationCustomVoice[] {
  if (!Array.isArray(value)) return [];
  const voices: VoiceGenerationCustomVoice[] = [];
  const seenKeys = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Partial<VoiceGenerationCustomVoice>;
    const providerType = normalizeVoiceGenerationProviderType(record.providerType);
    const voice = normalizeString(record.voice);
    if (!voice) continue;
    const key = `${providerType}:${voice}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const label = normalizeString(record.label) || voice;
    const id = normalizeString(record.id) || `voice-${providerType}-${voice}`;
    voices.push({
      id,
      providerType,
      label,
      voice,
      source: normalizeCustomVoiceSource(record.source),
      createdAt: normalizeTimestamp(record.createdAt),
      updatedAt: normalizeTimestamp(record.updatedAt)
    });
  }

  return voices;
}

export function normalizeVoiceGenerationSettings(
  value: unknown,
  providers: ProviderProfile[] = []
): VoiceGenerationSettings {
  const settings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<VoiceGenerationSettings>
    : {};
  const providerType = normalizeVoiceGenerationProviderType(settings.providerType);
  const providerId = normalizeOptionalString(settings.providerId);
  const legacyProvider = findLegacyVoiceProvider(providerId, providers);

  return {
    enabled: settings.enabled === true,
    providerType,
    baseUrl: normalizeString(settings.baseUrl) || legacyProvider?.baseUrl?.trim() || '',
    path: normalizeString(settings.path) || defaultVoiceGenerationPath(providerType),
    apiKey: normalizeString(settings.apiKey) || legacyProvider?.apiKey?.trim() || '',
    model: normalizeString(settings.model)
      || normalizeString(settings.modelOverride)
      || (providerType === 'openai-compatible' ? legacyProvider?.model?.trim() || '' : ''),
    providerId,
    modelOverride: normalizeOptionalString(settings.modelOverride),
    voice: normalizeOptionalString(settings.voice) ?? DEFAULT_VOICE_GENERATION_SETTINGS.voice,
    customVoices: normalizeVoiceGenerationCustomVoices(settings.customVoices),
    format: normalizeVoiceGenerationFormat(settings.format),
    lastUpdatedAt: typeof settings.lastUpdatedAt === 'number' && Number.isFinite(settings.lastUpdatedAt)
      ? settings.lastUpdatedAt
      : undefined
  };
}

export function mergeVoiceGenerationSettings(
  current: VoiceGenerationSettings,
  patch: Partial<VoiceGenerationSettings>
): VoiceGenerationSettings {
  return normalizeVoiceGenerationSettings({
    ...current,
    ...patch,
    lastUpdatedAt: Date.now()
  });
}
