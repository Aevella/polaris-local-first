import type { ProviderProfile, ProviderProtocol } from '../types/domain';

export const DEFAULT_PROVIDER_PROTOCOL: ProviderProtocol = 'openai-completions';
export type ProviderProtocolLabelKey =
  | 'provider.protocol.openaiCompletions'
  | 'provider.protocol.anthropicMessages'
  | 'provider.protocol.openaiResponses'
  | 'provider.protocol.geminiGenerateContent';

const PROVIDER_PROTOCOL_PATHS: Record<ProviderProtocol, string> = {
  'openai-completions': '/chat/completions',
  'anthropic-messages': '/messages',
  'openai-responses': '/responses',
  'gemini-generate-content': '/models/{model}:generateContent'
};

const PROVIDER_PROTOCOL_LABEL_KEYS: Record<ProviderProtocol, ProviderProtocolLabelKey> = {
  'openai-completions': 'provider.protocol.openaiCompletions',
  'anthropic-messages': 'provider.protocol.anthropicMessages',
  'openai-responses': 'provider.protocol.openaiResponses',
  'gemini-generate-content': 'provider.protocol.geminiGenerateContent'
};

export function getDefaultProviderPath(protocol: ProviderProtocol): string {
  return PROVIDER_PROTOCOL_PATHS[protocol];
}

export function getProviderProtocolLabelKey(protocol: ProviderProtocol): ProviderProtocolLabelKey {
  return PROVIDER_PROTOCOL_LABEL_KEYS[protocol];
}

export function inferProviderProtocol(input: Pick<Partial<ProviderProfile>, 'protocol' | 'path' | 'baseUrl' | 'model'>): ProviderProtocol {
  const path = input.path?.trim().split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase() ?? '';
  if ((!input.protocol || input.protocol === 'openai-completions') && /(?:^|\/)responses$/.test(path)) {
    return 'openai-responses';
  }
  if ((!input.protocol || input.protocol === 'openai-completions') && path.endsWith('/chat/completions')) {
    let host = '';
    try { host = new URL(input.baseUrl ?? '').hostname.toLowerCase(); } catch { /* relative/local route */ }
    if (host === 'api.openai.com' && /^(?:gpt-6(?:[.-]|$)|gpt-5\.[4-9](?:[.-]|$))/.test(input.model ?? '')) {
      return 'openai-responses';
    }
  }
  if (
    input.protocol === 'openai-completions'
    || input.protocol === 'anthropic-messages'
    || input.protocol === 'openai-responses'
    || input.protocol === 'gemini-generate-content'
  ) {
    return input.protocol;
  }

  const normalizedPath = input.path?.trim().replace(/^\/+/, '').toLowerCase() ?? '';
  if (normalizedPath === 'messages') return 'anthropic-messages';
  if (normalizedPath === 'responses') return 'openai-responses';
  if (normalizedPath.includes(':generatecontent')) return 'gemini-generate-content';
  return DEFAULT_PROVIDER_PROTOCOL;
}
