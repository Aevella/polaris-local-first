import { Capacitor } from '@capacitor/core';
import { buildApiEndpoint, buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import { isProviderImageRelayTarget } from './chat-api/providerImageRelayShared';
import type { ImageGenerationSettings, ProviderProfile } from '../types/domain';

export type ImageGenerationRequest = {
  api: ProviderProfile;
  settings: ImageGenerationSettings;
  prompt: string;
  title?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type ImageGenerationResult = {
  blob: Blob;
  mimeType: string;
  fileName: string;
  model: string;
  size: string;
};

export type ImageGenerationConnectionTestResult = {
  model: string;
  size: string;
  mimeType: string;
  byteLength: number;
};

export type ImageGenerationConfigurationCheckResult = {
  endpoint: string;
  model: string;
  size: string;
};

const IMAGE_GENERATION_TEST_PROMPT =
  'Polaris image generation connectivity test: a simple blue circle on a white background.';

type ImageGenerationEndpointKind =
  | 'openai-compatible'
  | 'minimax';

function normalizeImageGenerationPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return '/images/generations';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  const lower = normalized.toLowerCase();

  if (lower.endsWith('/chat/completions')) {
    return `${normalized.slice(0, -'/chat/completions'.length)}/images/generations`;
  }
  if (lower.endsWith('/responses')) {
    return `${normalized.slice(0, -'/responses'.length)}/images/generations`;
  }
  if (lower.endsWith('/images/generations')) {
    return normalized;
  }
  if (lower.endsWith('/image_generation')) {
    return normalized;
  }
  return '/images/generations';
}

function isAbsoluteUrl(value: string) {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(value.trim());
}

function normalizeAbsoluteImageEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!isAbsoluteUrl(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (path.endsWith('/images/generations') || path.endsWith('/image_generation')) {
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeRelativeImageEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.toLowerCase().endsWith('/step_plan/v1/images/generations')) {
    return `https://api.stepfun.com${trimmed}`;
  }
  return null;
}

export function buildImageGenerationEndpoint(api: ProviderProfile) {
  if (api.protocol !== 'openai-completions' && api.protocol !== 'openai-responses') {
    throw new Error('生图目前只支持通过 OpenAI 兼容线路配置的 HTTP 图片生成接口。');
  }
  const fullEndpointInBaseUrl = normalizeAbsoluteImageEndpoint(api.baseUrl)
    ?? normalizeRelativeImageEndpoint(api.baseUrl);
  if (fullEndpointInBaseUrl) {
    return fullEndpointInBaseUrl;
  }
  return buildApiEndpoint(api.baseUrl, normalizeImageGenerationPath(api.path));
}

function getImageEndpointKind(endpoint: string): ImageGenerationEndpointKind {
  try {
    const parsed = new URL(endpoint);
    if (parsed.pathname.toLowerCase().replace(/\/+$/, '').endsWith('/image_generation')) {
      return 'minimax';
    }
  } catch {
    return 'openai-compatible';
  }
  return 'openai-compatible';
}

function isStepImageEndpoint(endpoint: string, model: string) {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (
      model.toLowerCase().startsWith('step-image')
      || host.includes('stepfun.')
      || path.includes('/step_plan/')
    );
  } catch {
    return model.toLowerCase().startsWith('step-image');
  }
}

function shouldUseImageRelay(endpoint: string) {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
  if (!isProviderImageRelayTarget(endpoint)) return false;

  const currentOrigin = window.location?.origin;
  if (typeof currentOrigin !== 'string' || !currentOrigin) return false;

  try {
    return new URL(endpoint).origin !== currentOrigin;
  } catch {
    return false;
  }
}

function buildImageHeaders(api: ProviderProfile) {
  const apiKey = api.apiKey.trim();
  if (!apiKey) {
    throw new Error('请先在生图模型选择的线路里填写 API Key。');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

function fileExtensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function sanitizeFileName(value: string | undefined, mimeType: string) {
  const title = value?.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
  return `${title || 'generated-image'}.${fileExtensionForMimeType(mimeType)}`;
}

function base64ToBlob(base64: string, mimeType: string) {
  const normalized = base64.trim().replace(/^data:[^;]+;base64,/i, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function pickFirstString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
  }
  return undefined;
}

function readMiniMaxBaseResp(data: Record<string, unknown>) {
  const baseResp = data.base_resp;
  if (!baseResp || typeof baseResp !== 'object' || Array.isArray(baseResp)) return;

  const record = baseResp as { status_code?: unknown; status_msg?: unknown };
  if (record.status_code !== undefined && Number(record.status_code) !== 0) {
    const message = typeof record.status_msg === 'string' && record.status_msg.trim()
      ? record.status_msg.trim()
      : 'MiniMax 生图接口请求失败。';
    throw new Error(message);
  }
}

async function parseImageResponse(data: unknown, fetchImpl: typeof fetch): Promise<{ blob: Blob; mimeType: string }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('生图响应不是 JSON 对象。');
  }

  const responseObject = data as Record<string, unknown>;
  readMiniMaxBaseResp(responseObject);

  const minimaxData = responseObject.data;
  if (minimaxData && typeof minimaxData === 'object' && !Array.isArray(minimaxData)) {
    const result = minimaxData as { image_base64?: unknown; image_urls?: unknown };
    const base64 = pickFirstString(result.image_base64);
    if (base64) {
      return {
        blob: base64ToBlob(base64, 'image/jpeg'),
        mimeType: 'image/jpeg'
      };
    }

    const imageUrl = pickFirstString(result.image_urls);
    if (imageUrl) {
      const response = await fetchImpl(imageUrl);
      if (!response.ok) {
        throw new Error(`读取生图结果失败：${response.status}`);
      }
      const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
      return {
        blob: await response.blob(),
        mimeType
      };
    }
  }

  const first = responseObject.data;
  if (!Array.isArray(first) || !first.length || !first[0] || typeof first[0] !== 'object') {
    throw new Error('生图响应缺少 data 图片结果。');
  }

  const item = first[0] as { b64_json?: unknown; url?: unknown };
  if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
    return {
      blob: base64ToBlob(item.b64_json.trim(), 'image/png'),
      mimeType: 'image/png'
    };
  }

  if (typeof item.url === 'string' && item.url.trim()) {
    const response = await fetchImpl(item.url.trim());
    if (!response.ok) {
      throw new Error(`读取生图结果失败：${response.status}`);
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
    return {
      blob: await response.blob(),
      mimeType
    };
  }

  throw new Error('生图响应没有 b64_json 或 url。');
}

function imageSizeToMiniMaxAspectRatio(size: string) {
  if (size === '1024x1536') return '2:3';
  if (size === '1536x1024') return '3:2';
  if (size === '1024x1024') return '1:1';
  return undefined;
}

function normalizeStepImageSize(size: string) {
  if (size === '1024x1024') return '1024x1024';
  if (size === '1024x1536') return '1360x768';
  if (size === '1536x1024') return '768x1360';
  return undefined;
}

function buildImageRequestBody(args: {
  endpoint: string;
  model: string;
  prompt: string;
  size: string;
}): Record<string, unknown> {
  const kind = getImageEndpointKind(args.endpoint);
  if (kind === 'minimax') {
    const body: Record<string, unknown> = {
      model: args.model,
      prompt: args.prompt,
      n: 1,
      response_format: 'base64'
    };
    const aspectRatio = imageSizeToMiniMaxAspectRatio(args.size);
    if (aspectRatio) {
      body.aspect_ratio = aspectRatio;
    }
    return body;
  }

  const body: Record<string, unknown> = {
    model: args.model,
    prompt: args.prompt,
    n: 1,
    response_format: 'b64_json'
  };
  if (args.size !== 'auto') {
    body.size = isStepImageEndpoint(args.endpoint, args.model)
      ? normalizeStepImageSize(args.size)
      : args.size;
  }
  if (body.size === undefined) {
    delete body.size;
  }
  return body;
}

export async function requestGeneratedImage(params: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('生图提示词不能为空。');
  }
  if (!params.settings.enabled) {
    throw new Error('生图模型尚未开启。请先到设置 → 生图里打开生图。');
  }

  const model = params.settings.modelOverride?.trim() || params.api.model.trim();
  if (!model) {
    throw new Error('生图模型不能为空。');
  }

  const endpoint = buildImageGenerationEndpoint(params.api);
  const headers = buildImageHeaders(params.api);
  const size = params.settings.size || '1024x1024';
  const body = buildImageRequestBody({ endpoint, model, prompt, size });

  const fetchImpl = params.fetchImpl ?? fetch;
  const useRelay = shouldUseImageRelay(endpoint);
  const response = await fetchImpl(
    useRelay ? buildInternalApiEndpoint('/api/provider-images') : endpoint,
    {
      method: 'POST',
      headers: useRelay ? { 'Content-Type': 'application/json' } : headers,
      body: JSON.stringify(useRelay ? { endpoint, headers, body } : body),
      signal: params.signal
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`生图 API ${response.status}: ${text.slice(0, 180)}`);
  }

  const parsed = await parseImageResponse(await response.json(), fetchImpl);
  return {
    ...parsed,
    fileName: sanitizeFileName(params.title, parsed.mimeType),
    model,
    size
  };
}

export function checkImageGenerationConfiguration(
  params: Pick<ImageGenerationRequest, 'api' | 'settings'>
): ImageGenerationConfigurationCheckResult {
  if (!params.settings.enabled) {
    throw new Error('生图模型尚未开启。请先到设置 → 生图里打开生图。');
  }

  const model = params.settings.modelOverride?.trim() || params.api.model.trim();
  if (!model) {
    throw new Error('生图模型不能为空。');
  }

  const endpoint = buildImageGenerationEndpoint(params.api);
  buildImageHeaders(params.api);
  return {
    endpoint,
    model,
    size: params.settings.size || '1024x1024'
  };
}

export async function requestImageGenerationConnectivityTest(
  params: Omit<ImageGenerationRequest, 'prompt' | 'title'> & {
    prompt?: string;
  }
): Promise<ImageGenerationConnectionTestResult> {
  const result = await requestGeneratedImage({
    ...params,
    prompt: params.prompt ?? IMAGE_GENERATION_TEST_PROMPT,
    title: 'Polaris image test'
  });

  return {
    model: result.model,
    size: result.size,
    mimeType: result.mimeType,
    byteLength: result.blob.size
  };
}
