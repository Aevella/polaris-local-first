import type { ProviderProfile } from '../../types/domain';
import { discoverProviderModels } from '../providerModelDiscovery';
import { resolveProviderCapability } from './providerCapability';

const openRouterModelLimitByRoute = new Map<string, Promise<number>>();

function buildModelLimitKey(provider: ProviderProfile) {
  return [
    provider.id,
    provider.protocol,
    provider.baseUrl.trim().replace(/\/$/, '').toLowerCase(),
    provider.path.trim().toLowerCase(),
    provider.model.trim().toLowerCase()
  ].join('|');
}

function requiresOpenRouterAnthropicModelLimit(provider: ProviderProfile) {
  const capability = resolveProviderCapability(provider);
  return (
    capability.route.protocol === 'anthropic-messages'
    && capability.route.labelKey === 'provider.route.openRouter'
  );
}

async function discoverOpenRouterAnthropicModelLimit(
  provider: ProviderProfile,
  signal?: AbortSignal
) {
  const result = await discoverProviderModels({ api: provider, signal });
  if (!result.ok) {
    throw new Error(`无法读取 OpenRouter 模型输出上限：${result.error}`);
  }

  const selectedModel = provider.model.trim();
  const model = result.models.find((candidate) => candidate.id === selectedModel);
  if (!model) {
    throw new Error(`OpenRouter 模型列表里没有找到 ${selectedModel}，没有发送聊天请求。`);
  }
  if (model.maxOutputTokens === undefined) {
    throw new Error(`OpenRouter 没有返回 ${selectedModel} 的最大输出 token，不能安全构造 Anthropic 请求。`);
  }
  return model.maxOutputTokens;
}

export async function resolveProviderRuntimeMaxOutputTokens(
  provider: ProviderProfile,
  signal?: AbortSignal
) {
  if (!requiresOpenRouterAnthropicModelLimit(provider)) return undefined;

  const key = buildModelLimitKey(provider);
  const cached = openRouterModelLimitByRoute.get(key);
  if (cached) return cached;

  const pending = discoverOpenRouterAnthropicModelLimit(provider, signal);
  openRouterModelLimitByRoute.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    if (openRouterModelLimitByRoute.get(key) === pending) {
      openRouterModelLimitByRoute.delete(key);
    }
    throw error;
  }
}

export function clearProviderRuntimeModelLimitCache() {
  openRouterModelLimitByRoute.clear();
}
