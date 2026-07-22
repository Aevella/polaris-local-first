import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canFallbackThroughProviderRelay,
  hasProviderRelayAuthHeader,
  isAllowedProviderRelayTarget,
  isProviderModelListRelayTarget,
  sanitizeProviderRelayHeaders
} from './providerRelay';

const nativePlatform = vi.hoisted(() => ({ value: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativePlatform.value
  }
}));

describe('canFallbackThroughProviderRelay', () => {
  beforeEach(() => {
    nativePlatform.value = false;
    vi.stubGlobal('window', {
      location: { origin: 'https://polaris-public-demo.vercel.app' }
    });
  });

  it('keeps native requests on the native provider transport', () => {
    nativePlatform.value = true;
    vi.stubGlobal('window', {
      location: { origin: 'capacitor://localhost' }
    });

    expect(canFallbackThroughProviderRelay('https://relay.example.com/v1/chat/completions')).toBe(false);
  });

  it('allows public cross-origin endpoints without classifying domain suffixes', () => {
    expect(canFallbackThroughProviderRelay('https://example.tailnet.ts.net/v1/chat/completions')).toBe(true);
    expect(canFallbackThroughProviderRelay('https://api.openai.com/v1/chat/completions')).toBe(true);
  });

  it('keeps same-origin requests off the relay', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://polaris-public-demo.vercel.app' }
    });

    expect(canFallbackThroughProviderRelay('https://polaris-public-demo.vercel.app/api/chat/completions')).toBe(false);
  });

  it('keeps private targets outside the relay fallback boundary', () => {
    expect(canFallbackThroughProviderRelay('https://127.0.0.1/v1/chat/completions')).toBe(false);
  });
});

describe('isAllowedProviderRelayTarget', () => {
  it('accepts supported public https model endpoints', () => {
    expect(isAllowedProviderRelayTarget('https://opencode.ai/zen/v1/messages')).toBe(true);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/chat/completions')).toBe(true);
    expect(isAllowedProviderRelayTarget('https://api.minimax.chat/v1/text/chatcompletion_v2')).toBe(true);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v42/llm')).toBe(true);
    expect(
      isAllowedProviderRelayTarget(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
      )
    ).toBe(true);
    expect(isAllowedProviderRelayTarget('https://fcm.googleapis.com/v1/messages')).toBe(true);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/chat/completion_pro')).toBe(true);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/models')).toBe(true);
  });

  it('rejects private, local, or unsupported targets', () => {
    expect(isAllowedProviderRelayTarget('http://relay.example.com/v1/messages')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://127.0.0.1/v1/messages')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://[::ffff:127.0.0.1]/v1/messages')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://[fc00::1]/v1/messages')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://[fe80::1]/v1/messages')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/embeddings')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/files')).toBe(false);
    expect(isAllowedProviderRelayTarget('https://relay.example.com/v1/uploads')).toBe(false);
  });
});

describe('isProviderModelListRelayTarget', () => {
  it('accepts only public /models targets', () => {
    expect(isProviderModelListRelayTarget('https://relay.example.com/v1/models')).toBe(true);
    expect(isProviderModelListRelayTarget('https://relay.example.com/v1/chat/completions')).toBe(false);
    expect(isProviderModelListRelayTarget('https://127.0.0.1/v1/models')).toBe(false);
  });
});

describe('sanitizeProviderRelayHeaders', () => {
  it('drops hop-by-hop and origin headers', () => {
    expect(
      sanitizeProviderRelayHeaders({
        Authorization: 'Bearer sk-test',
        Host: 'relay.example.com',
        Origin: 'https://polaris-public-demo.vercel.app',
        'X-Custom': 'ok'
      })
    ).toEqual({
      Authorization: 'Bearer sk-test',
      'X-Custom': 'ok'
    });
  });
});

describe('hasProviderRelayAuthHeader', () => {
  it('accepts Gemini x-goog-api-key as upstream auth', () => {
    expect(hasProviderRelayAuthHeader({ 'x-goog-api-key': 'gemini-key' })).toBe(true);
    expect(hasProviderRelayAuthHeader({ Authorization: 'Bearer sk-test' })).toBe(true);
    expect(hasProviderRelayAuthHeader({ 'x-api-key': 'anthropic-key' })).toBe(true);
    expect(hasProviderRelayAuthHeader({ 'xi-api-key': 'elevenlabs-key' })).toBe(true);
    expect(hasProviderRelayAuthHeader({ 'X-Custom': 'not-auth' })).toBe(false);
  });
});
