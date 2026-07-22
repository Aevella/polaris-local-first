import { isPrivateHostname } from './providerRelayShared.js';

function normalizeImagePath(pathname: string) {
  return pathname.replace(/\/+$/, '').toLowerCase();
}

function isSupportedImageGenerationPath(pathname: string) {
  const normalized = normalizeImagePath(pathname);
  return (
    normalized.endsWith('/images/generations')
    || normalized.endsWith('/image_generation')
  );
}

export function isProviderImageRelayTarget(endpoint: string) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (isPrivateHostname(parsed.hostname)) return false;
  return isSupportedImageGenerationPath(parsed.pathname);
}

export function isProviderImageGenerationRequestBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.model !== 'string' || !record.model.trim()) return false;
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) return false;
  if (record.size !== undefined && (typeof record.size !== 'string' || !record.size.trim())) return false;
  if (record.aspect_ratio !== undefined && (typeof record.aspect_ratio !== 'string' || !record.aspect_ratio.trim())) return false;
  if (record.response_format !== undefined && (typeof record.response_format !== 'string' || !record.response_format.trim())) return false;
  if (record.width !== undefined && (!Number.isInteger(record.width) || Number(record.width) < 1)) return false;
  if (record.height !== undefined && (!Number.isInteger(record.height) || Number(record.height) < 1)) return false;
  if ((record.width === undefined) !== (record.height === undefined)) return false;
  if (record.prompt_optimizer !== undefined && typeof record.prompt_optimizer !== 'boolean') return false;
  if (record.n !== undefined && (!Number.isInteger(record.n) || Number(record.n) < 1 || Number(record.n) > 9)) return false;
  return true;
}
