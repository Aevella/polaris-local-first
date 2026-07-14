import { buildApiEndpoint, buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import { ANTHROPIC_VERSION } from './provider-runtime/requestShared/headers';
import { resolveProviderCapability } from './provider-runtime/providerCapability';
import { inferProviderProtocol } from './providerProtocol';
import type { ProviderProfile } from '../types/domain';
import {
  ANTHROPIC_BROWSER_ACCESS_HEADER,
  canFallbackThroughProviderRelay,
  isOfficialAnthropicApiEndpoint,
  sanitizeProviderRelayHeaders
} from './chat-api/providerRelay';

export type ProviderModelOption = {
  id: string;
  label?: string;
  ownedBy?: string;
};

export type ProviderModelDiscoveryResult =
  | {
      ok: true;
      models: ProviderModelOption[];
      source: 'live';
    }
  | {
      ok: false;
      error: string;
    };

type ProviderModelListPayload = Record<string, unknown>;

function uniqueModels(models: ProviderModelOption[]) {
  const seen = new Set<string>();
  const unique: ProviderModelOption[] = [];

  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({
      ...model,
      id
    });
  }

  return unique;
}

function readObjectArray(payload: ProviderModelListPayload, key: 'data' | 'models') {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function normalizeOpenAiCompatibleModels(payload: ProviderModelListPayload): ProviderModelOption[] {
  return uniqueModels(
    readObjectArray(payload, 'data').flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      return typeof item.id === 'string'
        ? [{
            id: item.id,
            ownedBy: typeof item.owned_by === 'string' ? item.owned_by : undefined
          }]
        : [];
    })
  );
}

function normalizeAnthropicModels(payload: ProviderModelListPayload): ProviderModelOption[] {
  return uniqueModels(
    readObjectArray(payload, 'data').flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      return typeof item.id === 'string'
        ? [{
            id: item.id,
            label: typeof item.display_name === 'string' ? item.display_name : undefined
          }]
        : [];
    })
  );
}

function normalizeGeminiModels(payload: ProviderModelListPayload): ProviderModelOption[] {
  return uniqueModels(
    readObjectArray(payload, 'models').flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const rawName = typeof item.name === 'string' ? item.name : '';
      if (!rawName) return [];
      const supportedGenerationMethods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods.filter((method): method is string => typeof method === 'string')
        : [];
      if (supportedGenerationMethods.length && !supportedGenerationMethods.includes('generateContent')) return [];

      return [{
        id: rawName.replace(/^models\//, ''),
        label: typeof item.displayName === 'string' ? item.displayName : undefined
      }];
    })
  );
}

export function normalizeProviderModelList(
  api: Pick<ProviderProfile, 'protocol' | 'path'>,
  payload: unknown
): ProviderModelOption[] {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return [];

  const protocol = inferProviderProtocol(api);
  const body = payload as ProviderModelListPayload;
  if (protocol === 'anthropic-messages') return normalizeAnthropicModels(body);
  if (protocol === 'gemini-generate-content') return normalizeGeminiModels(body);
  return normalizeOpenAiCompatibleModels(body);
}

export function buildProviderModelListEndpoint(api: Pick<ProviderProfile, 'baseUrl'>) {
  return buildApiEndpoint(api.baseUrl, '/models');
}

function isAbsoluteProviderBaseUrl(baseUrl: string) {
  return /^https?:\/\//i.test(baseUrl.trim());
}

function buildProviderModelHeaders(api: ProviderProfile): Record<string, string> {
  const apiKey = api.apiKey.trim();
  const capability = resolveProviderCapability(api);
  const shouldSendAnthropicBrowserAccessHeader =
    typeof window !== 'undefined'
    && inferProviderProtocol(api) === 'anthropic-messages'
    && isOfficialAnthropicApiEndpoint(buildProviderModelListEndpoint(api));

  const authHeaders: Record<string, string> =
    capability.auth.scheme === 'x-goog-api-key'
      ? { 'x-goog-api-key': apiKey }
      : capability.auth.scheme === 'x-api-key'
        ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
        : capability.auth.scheme === 'authorization-bearer-with-anthropic-version'
          ? { Authorization: `Bearer ${apiKey}`, 'anthropic-version': ANTHROPIC_VERSION }
          : { Authorization: `Bearer ${apiKey}` };

  return {
    Accept: 'application/json',
    ...(shouldSendAnthropicBrowserAccessHeader ? { [ANTHROPIC_BROWSER_ACCESS_HEADER]: 'true' } : {}),
    ...authHeaders
  };
}

async function readProviderModelResponse(res: Response) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`模型列表 API ${res.status}: ${text.slice(0, 180)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('模型列表返回的不是 JSON。');
  }
}

export function canDiscoverProviderModels(api: ProviderProfile) {
  return Boolean(isAbsoluteProviderBaseUrl(api.baseUrl) && api.apiKey.trim());
}

export async function discoverProviderModels(params: {
  api: ProviderProfile;
  signal?: AbortSignal;
}): Promise<ProviderModelDiscoveryResult> {
  const { api, signal } = params;
  if (!api.baseUrl.trim()) return { ok: false, error: '未填写 API Base URL' };
  if (!api.apiKey.trim()) return { ok: false, error: '未填写 API Key' };
  if (!isAbsoluteProviderBaseUrl(api.baseUrl)) {
    return { ok: false, error: '当前线路不是公开供应商 Base URL。' };
  }

  try {
    const endpoint = buildProviderModelListEndpoint(api);
    const upstreamHeaders = buildProviderModelHeaders(api);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'GET',
        headers: upstreamHeaders,
        signal
      });
    } catch (error) {
      if (signal?.aborted || !canFallbackThroughProviderRelay(endpoint)) {
        throw error;
      }
      res = await fetch(buildInternalApiEndpoint('/api/provider-models'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint,
          headers: sanitizeProviderRelayHeaders(upstreamHeaders)
        }),
        signal
      });
    }
    const payload = await readProviderModelResponse(res);
    const models = normalizeProviderModelList(api, payload);
    if (!models.length) {
      return { ok: false, error: '上游没有返回可用模型。' };
    }
    return { ok: true, models, source: 'live' };
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: '模型列表请求失败。' };
  }
}
