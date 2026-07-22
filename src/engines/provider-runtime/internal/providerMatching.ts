function normalizeProviderText(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

export function parseProviderHost(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.startsWith('/')) return '';
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return '';
  }
}

export function isGatewayBaseUrl(baseUrl: string) {
  return baseUrl.trim().startsWith('/');
}

export function isSiliconFlowHost(host: string) {
  return host.includes('siliconflow.cn') || host.includes('siliconflow.com');
}

export function isN1nHost(host: string) {
  return host.includes('n1n.ai');
}

export function isSenseNovaHost(host: string) {
  return host.includes('sensenova.cn');
}

export function isOpenRouterHost(host: string) {
  return host.includes('openrouter.ai');
}

export function isOpenRouterAnthropicClaudeModel(modelId?: string | null) {
  const model = normalizeProviderText(modelId).replace(/^~/, '');
  return model.startsWith('anthropic/') && model.includes('claude');
}

export function isOpenAiHost(host: string) {
  return host.includes('openai.com');
}

export function isAnthropicHost(host: string) {
  return host.includes('anthropic.com');
}

export function isGoogleApisHost(host: string) {
  return host.includes('googleapis.com');
}

export function isMoonshotHost(host: string) {
  return host.includes('moonshot.cn');
}

export function isDeepSeekHost(host: string) {
  return host.includes('deepseek.com');
}

export function isXAiHost(host: string) {
  return host.includes('x.ai');
}

export function isMimoHost(host: string) {
  return host.includes('xiaomimimo.com');
}

export function isMiniMaxHost(host: string) {
  return (
    host.includes('minimax.io')
    || host.includes('minimax.chat')
    || host.includes('minimaxi.com')
    || host.includes('minimax-m2.com')
  );
}

export function isClaudeModel(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('claude');
}

export function isClaude46Model(modelId?: string | null) {
  const model = normalizeProviderText(modelId)
    .replace(/\./g, '-');
  return model.includes('claude-opus-4-6') || model.includes('claude-sonnet-4-6');
}

export function isGeminiModel(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('gemini');
}

export function isKimiK2Model(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('kimi-k2');
}

export function isKimiK2InstructModel(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('kimi-k2-instruct');
}

export function isKimiK2ThinkingModel(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('kimi-k2-thinking');
}

export function isDeepSeekReasonerModel(modelId?: string | null) {
  return normalizeProviderText(modelId).includes('deepseek-reasoner');
}

export function isDeepSeekThinkingModel(modelId?: string | null) {
  const model = normalizeProviderText(modelId);
  return (
    model.includes('deepseek-reasoner')
    || model.includes('deepseek-v4')
    || model.includes('deepseek-r1')
  );
}

export function isMimoModel(modelId?: string | null) {
  const model = normalizeProviderText(modelId);
  return model.startsWith('mimo-') || model.startsWith('xiaomi/mimo-');
}

export function isMiniMaxModel(modelId?: string | null) {
  const model = normalizeProviderText(modelId);
  return model.includes('minimax-m2');
}
