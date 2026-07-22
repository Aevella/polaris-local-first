import { Capacitor } from '@capacitor/core';
import { buildApiEndpoint, buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import { isProviderAudioRelayTarget } from './chat-api/providerAudioRelayShared';
import { assertHttpHeaderValue } from './httpHeaderValue';
import type {
  VoiceGenerationFormat,
  VoiceGenerationProviderType,
  VoiceGenerationSettings
} from '../types/domain';

export type VoiceGenerationRequest = {
  settings: VoiceGenerationSettings;
  text: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type VoiceGenerationResult = {
  blob: Blob;
  mimeType: string;
  model: string;
  voice: string;
  format: VoiceGenerationFormat;
};

const MIME_TYPE_BY_FORMAT: Record<VoiceGenerationFormat, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm'
};

const MINIMAX_VOICE_FORMATS = new Set<VoiceGenerationFormat>(['mp3', 'flac', 'wav']);
const FISHAUDIO_VOICE_FORMATS = new Set<VoiceGenerationFormat>(['mp3', 'opus', 'wav', 'pcm']);
const DEFAULT_MINIMAX_MODEL = 'speech-2.8-turbo';
const DEFAULT_MINIMAX_VOICE = 'Chinese (Mandarin)_Warm_Girl';
const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const DEFAULT_ELEVENLABS_VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const DEFAULT_FISHAUDIO_MODEL = 's2-pro';
const ELEVENLABS_OUTPUT_FORMAT_BY_FORMAT: Partial<Record<VoiceGenerationFormat, string>> = {
  mp3: 'mp3_44100_128',
  opus: 'opus_48000_128',
  pcm: 'pcm_44100',
  wav: 'wav_44100'
};

function normalizeVoiceGenerationPath(path: string) {
  const trimmed = path.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/audio/speech`;
  }
  if (lower.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/audio/speech`;
  }
  if (lower.endsWith('/images/generations')) {
    return `${normalized.slice(0, -'/images/generations'.length)}/audio/speech`;
  }
  if (lower.endsWith('/audio/speech')) {
    return normalized;
  }
  return '/audio/speech';
}

function normalizeMiniMaxVoicePath(path: string) {
  const trimmed = path.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/t2a_v2')) {
    return normalized;
  }
  return '/t2a_v2';
}

function normalizeElevenLabsBasePath(path: string) {
  const trimmed = path.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/text-to-speech')) {
    return normalized;
  }
  if (/\/text-to-speech\/[^/]+$/.test(lower)) {
    return normalized.slice(0, normalized.lastIndexOf('/'));
  }
  return '/text-to-speech';
}

function normalizeFishAudioVoicePath(path: string) {
  const trimmed = path.trim();
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/tts')) {
    return normalized;
  }
  return '/tts';
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/%2F/gi, '');
}

function resolveElevenLabsVoiceName(configuredVoice?: string) {
  const trimmed = configuredVoice?.trim();
  return trimmed && trimmed !== 'alloy' && trimmed !== DEFAULT_MINIMAX_VOICE
    ? trimmed
    : DEFAULT_ELEVENLABS_VOICE;
}

function resolveVoiceProviderType(settings?: Pick<VoiceGenerationSettings, 'providerType'>): VoiceGenerationProviderType {
  if (settings?.providerType === 'minimax') return 'minimax';
  if (settings?.providerType === 'elevenlabs') return 'elevenlabs';
  if (settings?.providerType === 'fishaudio') return 'fishaudio';
  return 'openai-compatible';
}

export function buildVoiceGenerationEndpoint(
  settings: Pick<VoiceGenerationSettings, 'providerType' | 'baseUrl' | 'path' | 'voice'>
) {
  const providerType = resolveVoiceProviderType(settings);
  const baseUrl = settings.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error('请先填写语音模型的 Base URL。');
  }

  if (providerType === 'minimax') {
    return buildApiEndpoint(baseUrl, normalizeMiniMaxVoicePath(settings.path ?? ''));
  }
  if (providerType === 'elevenlabs') {
    const voice = resolveElevenLabsVoiceName(settings?.voice);
    return buildApiEndpoint(baseUrl, `${normalizeElevenLabsBasePath(settings.path ?? '')}/${encodePathSegment(voice)}`);
  }
  if (providerType === 'fishaudio') {
    return buildApiEndpoint(baseUrl, normalizeFishAudioVoicePath(settings.path ?? ''));
  }

  return buildApiEndpoint(baseUrl, normalizeVoiceGenerationPath(settings.path ?? ''));
}

function shouldUseAudioRelay(endpoint: string) {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
  if (!isProviderAudioRelayTarget(endpoint)) return false;

  const currentOrigin = window.location?.origin;
  if (typeof currentOrigin !== 'string' || !currentOrigin) return false;

  try {
    return new URL(endpoint).origin !== currentOrigin;
  } catch {
    return false;
  }
}

function buildAudioHeaders(
  settings: Pick<VoiceGenerationSettings, 'apiKey'>,
  providerType: VoiceGenerationProviderType,
  model?: string
) {
  const apiKey = settings.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error('请先填写语音模型的 API Key。');
  }
  assertHttpHeaderValue(apiKey, '语音 API Key');

  const baseHeaders = {
    'Content-Type': 'application/json'
  };
  if (providerType === 'elevenlabs') {
    return {
      ...baseHeaders,
      'xi-api-key': apiKey
    };
  }
  if (providerType === 'fishaudio') {
    const fishAudioModel = model?.trim() || DEFAULT_FISHAUDIO_MODEL;
    assertHttpHeaderValue(fishAudioModel, 'FishAudio 模型');
    return {
      ...baseHeaders,
      Authorization: `Bearer ${apiKey}`,
      model: fishAudioModel
    };
  }
  return {
    ...baseHeaders,
    Authorization: `Bearer ${apiKey}`
  };
}

function resolveVoiceModel(settings: VoiceGenerationSettings, providerType: VoiceGenerationProviderType) {
  const configuredModel = settings.model?.trim() || settings.modelOverride?.trim();
  if (configuredModel) return configuredModel;
  if (providerType === 'minimax') return DEFAULT_MINIMAX_MODEL;
  if (providerType === 'elevenlabs') return DEFAULT_ELEVENLABS_MODEL;
  if (providerType === 'fishaudio') return DEFAULT_FISHAUDIO_MODEL;
  return '';
}

function resolveVoiceName(settings: VoiceGenerationSettings, providerType: VoiceGenerationProviderType) {
  const configuredVoice = settings.voice?.trim();
  if (providerType === 'minimax') {
    return configuredVoice && configuredVoice !== 'alloy' ? configuredVoice : DEFAULT_MINIMAX_VOICE;
  }
  if (providerType === 'elevenlabs') {
    return resolveElevenLabsVoiceName(configuredVoice);
  }
  if (providerType === 'fishaudio') {
    return configuredVoice || '';
  }
  return configuredVoice || 'alloy';
}

function hexToAudioBlob(hex: string, mimeType: string) {
  const normalized = hex.trim();
  if (!normalized || normalized.length % 2 !== 0 || !/^[\da-f]+$/i.test(normalized)) {
    throw new Error('MiniMax 语音 API 返回了无效的音频数据。');
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return new Blob([bytes], { type: mimeType });
}

function buildOpenAiSpeechBody(model: string, input: string, voice: string, format: VoiceGenerationFormat) {
  return {
    model,
    input,
    voice,
    response_format: format
  };
}

function buildMiniMaxSpeechBody(model: string, input: string, voice: string, format: VoiceGenerationFormat) {
  if (!MINIMAX_VOICE_FORMATS.has(format)) {
    throw new Error('MiniMax 语音非流式接口只支持 MP3、WAV、FLAC。');
  }

  return {
    model,
    text: input,
    stream: false,
    output_format: 'hex',
    voice_setting: {
      voice_id: voice,
      speed: 1,
      vol: 1,
      pitch: 0
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format,
      channel: 1
    }
  };
}

function buildElevenLabsSpeechBody(model: string, input: string, format: VoiceGenerationFormat) {
  return {
    text: input,
    model_id: model
  };
}

function buildFishAudioSpeechBody(input: string, voice: string, format: VoiceGenerationFormat) {
  if (!FISHAUDIO_VOICE_FORMATS.has(format)) {
    throw new Error('FishAudio TTS 接口只支持 MP3、WAV、PCM、Opus。');
  }

  return {
    text: input,
    ...(voice ? { reference_id: voice } : {}),
    format,
    normalize: true
  };
}

async function parseMiniMaxSpeechBlob(response: Response, mimeType: string) {
  const payload = await response.json() as {
    data?: {
      audio?: unknown;
    };
    base_resp?: {
      status_code?: unknown;
      status_msg?: unknown;
    };
  };
  const statusCode = payload.base_resp?.status_code;
  if (typeof statusCode === 'number' && statusCode !== 0) {
    const statusMessage = typeof payload.base_resp?.status_msg === 'string'
      ? payload.base_resp.status_msg
      : 'MiniMax 语音生成失败。';
    throw new Error(statusMessage);
  }
  const audioHex = payload.data?.audio;
  if (typeof audioHex !== 'string') {
    throw new Error('MiniMax 语音 API 没有返回音频数据。');
  }
  return hexToAudioBlob(audioHex, mimeType);
}

export async function requestGeneratedSpeech(params: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
  const input = params.text.trim();
  if (!input) {
    throw new Error('朗读文本不能为空。');
  }
  if (!params.settings.enabled) {
    throw new Error('语音模型尚未开启。请先到设置 → 语音里打开朗读。');
  }

  const providerType = resolveVoiceProviderType(params.settings);
  const model = resolveVoiceModel(params.settings, providerType);
  if (!model) {
    throw new Error('语音模型不能为空。');
  }

  const voice = resolveVoiceName(params.settings, providerType);
  const format = params.settings.format || 'mp3';
  const endpoint = buildVoiceGenerationEndpoint(params.settings);
  const headers = buildAudioHeaders(params.settings, providerType, model);
  const body = providerType === 'minimax'
    ? buildMiniMaxSpeechBody(model, input, voice, format)
    : providerType === 'elevenlabs'
      ? buildElevenLabsSpeechBody(model, input, format)
      : providerType === 'fishaudio'
        ? buildFishAudioSpeechBody(input, voice, format)
        : buildOpenAiSpeechBody(model, input, voice, format);
  const requestEndpoint = providerType === 'elevenlabs'
    ? `${endpoint}?output_format=${ELEVENLABS_OUTPUT_FORMAT_BY_FORMAT[format] ?? format}`
    : endpoint;

  const fetchImpl = params.fetchImpl ?? fetch;
  const useRelay = shouldUseAudioRelay(requestEndpoint);
  const response = await fetchImpl(
    useRelay ? buildInternalApiEndpoint('/api/provider-audio') : requestEndpoint,
    {
      method: 'POST',
      headers: useRelay ? { 'Content-Type': 'application/json' } : headers,
      body: JSON.stringify(useRelay ? { endpoint: requestEndpoint, headers, body } : body),
      signal: params.signal
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`语音 API ${response.status}: ${text.slice(0, 180)}`);
  }

  const responseMimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
  const mimeType = providerType === 'minimax' || providerType === 'elevenlabs'
    ? MIME_TYPE_BY_FORMAT[format]
    : responseMimeType || MIME_TYPE_BY_FORMAT[format];
  return {
    blob: providerType === 'minimax'
      ? await parseMiniMaxSpeechBlob(response, mimeType)
      : await response.blob(),
    mimeType,
    model,
    voice,
    format
  };
}
