import { describe, expect, it } from 'vitest';
import { validateProviderImageRelayTarget } from './providerImageRelayTarget.js';

describe('validateProviderImageRelayTarget', () => {
  it('accepts public https image generation endpoints after DNS validation', async () => {
    await expect(
      validateProviderImageRelayTarget('https://relay.example.com/v1/images/generations', {
        lookupAddress: async () => [{ address: '8.8.8.8' }]
      })
    ).resolves.toBe('https://relay.example.com/v1/images/generations');
    await expect(
      validateProviderImageRelayTarget('https://api.minimax.io/v1/image_generation', {
        lookupAddress: async () => [{ address: '8.8.4.4' }]
      })
    ).resolves.toBe('https://api.minimax.io/v1/image_generation');
  });

  it('rejects non-image and private targets', async () => {
    await expect(
      validateProviderImageRelayTarget('https://relay.example.com/v1/chat/completions', {
        lookupAddress: async () => [{ address: '8.8.8.8' }]
      })
    ).rejects.toThrow('图片生成 relay 只接受公开 HTTPS 的图片生成接口。');
    await expect(
      validateProviderImageRelayTarget('https://relay.example.com/v1/images/generations', {
        lookupAddress: async () => [{ address: '10.0.0.2' }]
      })
    ).rejects.toThrow('图片生成 relay 目标解析到了本地或内网地址。');
  });
});
