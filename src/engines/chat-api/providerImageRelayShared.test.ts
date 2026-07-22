import { describe, expect, it } from 'vitest';
import {
  isProviderImageGenerationRequestBody,
  isProviderImageRelayTarget
} from './providerImageRelayShared';

describe('providerImageRelayShared', () => {
  it('accepts only public https image generation endpoints', () => {
    expect(isProviderImageRelayTarget('https://api.example.com/v1/images/generations')).toBe(true);
    expect(isProviderImageRelayTarget('https://api.stepfun.com/step_plan/v1/images/generations')).toBe(true);
    expect(isProviderImageRelayTarget('https://api.minimax.io/v1/image_generation')).toBe(true);
    expect(isProviderImageRelayTarget('https://api.example.com/v1/chat/completions')).toBe(false);
    expect(isProviderImageRelayTarget('http://api.example.com/v1/images/generations')).toBe(false);
    expect(isProviderImageRelayTarget('https://127.0.0.1/v1/images/generations')).toBe(false);
  });

  it('accepts image generation request bodies for a single requested image', () => {
    expect(isProviderImageGenerationRequestBody({
      model: 'gpt-image-1',
      prompt: '一只玻璃感小猫',
      size: '1024x1024',
      n: 1
    })).toBe(true);
    expect(isProviderImageGenerationRequestBody({
      model: 'image-01',
      prompt: '一只玻璃感小猫',
      aspect_ratio: '16:9',
      response_format: 'base64',
      n: 9,
      prompt_optimizer: true
    })).toBe(true);
    expect(isProviderImageGenerationRequestBody({ model: '', prompt: 'x' })).toBe(false);
    expect(isProviderImageGenerationRequestBody({ model: 'gpt-image-1', prompt: '' })).toBe(false);
    expect(isProviderImageGenerationRequestBody({ model: 'gpt-image-1', prompt: 'x', n: 0 })).toBe(false);
    expect(isProviderImageGenerationRequestBody({ model: 'image-01', prompt: 'x', width: 1024 })).toBe(false);
    expect(isProviderImageGenerationRequestBody({ model: 'gpt-image-1', prompt: 'x', size: '' })).toBe(false);
  });
});
