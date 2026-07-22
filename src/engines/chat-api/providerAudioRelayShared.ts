import { isPrivateHostname } from './providerRelayShared.js';

function normalizeAudioPath(pathname: string) {
  return pathname.replace(/\/+$/, '').toLowerCase();
}

function isElevenLabsTextToSpeechPath(pathname: string) {
  const normalizedPath = normalizeAudioPath(pathname);
  return /^\/v\d+\/text-to-speech\/[^/]+$/.test(normalizedPath);
}

function isMiniMaxVoiceManagementPath(pathname: string) {
  const normalizedPath = normalizeAudioPath(pathname);
  return normalizedPath.endsWith('/get_voice')
    || normalizedPath.endsWith('/voice_design');
}

function isFishAudioTextToSpeechPath(pathname: string) {
  return normalizeAudioPath(pathname).endsWith('/tts');
}

export function isProviderAudioRelayTarget(endpoint: string) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (isPrivateHostname(parsed.hostname)) return false;
  const normalizedPath = normalizeAudioPath(parsed.pathname);
  return normalizedPath.endsWith('/audio/speech')
    || normalizedPath.endsWith('/t2a_v2')
    || isMiniMaxVoiceManagementPath(parsed.pathname)
    || isElevenLabsTextToSpeechPath(parsed.pathname)
    || isFishAudioTextToSpeechPath(parsed.pathname);
}

export const isProviderAudioSpeechRelayTarget = isProviderAudioRelayTarget;

export function isOpenAiAudioSpeechRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.model !== 'string' || !record.model.trim()) return false;
  if (typeof record.input !== 'string' || !record.input.trim()) return false;
  if (typeof record.voice !== 'string' || !record.voice.trim()) return false;
  if (record.response_format !== undefined && (typeof record.response_format !== 'string' || !record.response_format.trim())) return false;
  return true;
}

export function isMiniMaxAudioRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const voiceSetting = record.voice_setting;
  const audioSetting = record.audio_setting;
  if (typeof record.model !== 'string' || !record.model.trim()) return false;
  if (typeof record.text !== 'string' || !record.text.trim()) return false;
  if (record.stream !== false) return false;
  if (record.output_format !== 'hex') return false;
  if (!voiceSetting || typeof voiceSetting !== 'object' || Array.isArray(voiceSetting)) return false;
  const voiceSettingRecord = voiceSetting as Record<string, unknown>;
  const voiceId = voiceSettingRecord.voice_id;
  if (typeof voiceId !== 'string' || !voiceId.trim()) return false;
  if (!audioSetting || typeof audioSetting !== 'object' || Array.isArray(audioSetting)) return false;
  const audioSettingRecord = audioSetting as Record<string, unknown>;
  const format = audioSettingRecord.format;
  if (typeof format !== 'string' || !format.trim()) return false;
  return true;
}

export function isMiniMaxVoiceListRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.voice_type === 'system'
    || record.voice_type === 'voice_cloning'
    || record.voice_type === 'voice_generation'
    || record.voice_type === 'all';
}

export function isMiniMaxVoiceDesignRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) return false;
  if (typeof record.preview_text !== 'string' || !record.preview_text.trim()) return false;
  if (record.preview_text.length > 500) return false;
  if (record.voice_id !== undefined && (typeof record.voice_id !== 'string' || !record.voice_id.trim())) return false;
  return true;
}

export function isElevenLabsAudioRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.input !== undefined
    || record.voice !== undefined
    || record.stream !== undefined
    || record.output_format !== undefined
    || record.voice_setting !== undefined
    || record.audio_setting !== undefined
  ) {
    return false;
  }
  if (typeof record.text !== 'string' || !record.text.trim()) return false;
  if (record.model_id !== undefined && (typeof record.model_id !== 'string' || !record.model_id.trim())) return false;
  return true;
}

export function isFishAudioRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(['text', 'reference_id', 'format', 'normalize']);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return false;
  if (typeof record.text !== 'string' || !record.text.trim()) return false;
  if (record.reference_id !== undefined && (typeof record.reference_id !== 'string' || !record.reference_id.trim())) return false;
  if (record.format !== undefined && !['mp3', 'opus', 'wav', 'pcm'].includes(String(record.format))) return false;
  if (record.normalize !== undefined && typeof record.normalize !== 'boolean') return false;
  return true;
}

export function isProviderAudioRelayRequestBody(value: unknown): value is Record<string, unknown> {
  return isOpenAiAudioSpeechRequestBody(value)
    || isMiniMaxAudioRequestBody(value)
    || isMiniMaxVoiceListRequestBody(value)
    || isMiniMaxVoiceDesignRequestBody(value)
    || isElevenLabsAudioRequestBody(value)
    || isFishAudioRequestBody(value);
}

export const isProviderAudioSpeechRequestBody = isProviderAudioRelayRequestBody;
