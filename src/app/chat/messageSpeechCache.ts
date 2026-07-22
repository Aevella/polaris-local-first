import { getAssetBlob, saveAsset } from '../../infrastructure/assetStore';
import type {
  ChatMessageVoiceCache,
  VoiceGenerationProviderType,
  VoiceGenerationSettings
} from '../../types/domain';
import type { VoiceGenerationResult } from '../../engines/voiceGenerationClient';

type SaveMessageSpeechCacheArgs = {
  text: string;
  settings: VoiceGenerationSettings;
  result: VoiceGenerationResult;
  createdAt?: number;
};

function resolveProviderType(settings: VoiceGenerationSettings): VoiceGenerationProviderType {
  if (settings.providerType === 'minimax') return 'minimax';
  if (settings.providerType === 'elevenlabs') return 'elevenlabs';
  if (settings.providerType === 'fishaudio') return 'fishaudio';
  return 'openai-compatible';
}

function resolveAudioExtension(format: VoiceGenerationResult['format'], mimeType: string) {
  if (format) return format;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('opus')) return 'opus';
  return 'mp3';
}

function formatDateStamp(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function fallbackHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function hashText(value: string) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return fallbackHash(value);
}

export async function saveMessageSpeechCache({
  text,
  settings,
  result,
  createdAt = Date.now()
}: SaveMessageSpeechCacheArgs): Promise<ChatMessageVoiceCache> {
  const normalizedText = text.trim();
  const textHash = await hashText(normalizedText);
  const extension = resolveAudioExtension(result.format, result.mimeType);
  const name = `Polaris-voice-${formatDateStamp(createdAt)}-${textHash.slice(0, 8)}.${extension}`;
  const meta = await saveAsset({
    kind: 'file',
    name,
    mimeType: result.mimeType,
    blob: result.blob,
    createdAt
  });

  return {
    assetId: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    createdAt: meta.createdAt,
    textHash,
    textLength: normalizedText.length,
    providerType: resolveProviderType(settings),
    model: result.model,
    voice: result.voice,
    format: result.format
  };
}

export async function readMessageSpeechCacheBlob(cache: ChatMessageVoiceCache): Promise<Blob> {
  const blob = await getAssetBlob(cache.assetId);
  if (!blob) {
    throw new Error('这条回答的语音缓存文件已经不在本机了。');
  }
  return blob;
}
