import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../types/domain';
import {
  buildImageGenerationEndpoint,
  checkImageGenerationConfiguration,
  requestGeneratedImage,
  requestImageGenerationConnectivityTest
} from './imageGenerationClient';

const provider: ProviderProfile = {
  id: 'provider-a',
  name: 'Provider A',
  protocol: 'openai-completions',
  baseUrl: 'https://api.example.com/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'chat-model',
  capabilities: {
    images: true,
    streaming: true,
    thinking: false
  }
};

describe('buildImageGenerationEndpoint', () => {
  it('routes OpenAI-compatible chat paths to images/generations', () => {
    expect(buildImageGenerationEndpoint(provider)).toBe('https://api.example.com/v1/images/generations');
    expect(buildImageGenerationEndpoint({
      ...provider,
      protocol: 'openai-responses',
      path: '/responses'
    })).toBe('https://api.example.com/v1/images/generations');
  });

  it('preserves dedicated image generation endpoints', () => {
    expect(buildImageGenerationEndpoint({
      ...provider,
      baseUrl: 'https://api.stepfun.com/step_plan/v1/images/generations',
      path: '/chat/completions'
    })).toBe('https://api.stepfun.com/step_plan/v1/images/generations');
    expect(buildImageGenerationEndpoint({
      ...provider,
      baseUrl: '/step_plan/v1/images/generations',
      path: '/chat/completions'
    })).toBe('https://api.stepfun.com/step_plan/v1/images/generations');
    expect(buildImageGenerationEndpoint({
      ...provider,
      baseUrl: 'https://api.minimax.io/v1',
      path: '/image_generation'
    })).toBe('https://api.minimax.io/v1/image_generation');
  });
});

describe('requestGeneratedImage', () => {
  it('requests one base64 image and returns an attachment-ready blob', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ b64_json: btoa('png-bytes') }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await requestGeneratedImage({
      api: provider,
      settings: {
        enabled: true,
        modelOverride: 'gpt-image-1',
        size: '1024x1024'
      },
      prompt: '画一张星星小屋',
      title: '星星小屋',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/images/generations', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-test'
      }
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      model: 'gpt-image-1',
      prompt: '画一张星星小屋',
      n: 1,
      response_format: 'b64_json',
      size: '1024x1024'
    });
    expect(result.fileName).toBe('星星小屋.png');
    expect(result.mimeType).toBe('image/png');
    expect(await result.blob.text()).toBe('png-bytes');
  });

  it('requests MiniMax image_generation with the native body and parses base64 results', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: { image_base64: [btoa('jpeg-bytes')] },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await requestGeneratedImage({
      api: {
        ...provider,
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        path: '/image_generation',
        model: 'image-01'
      },
      settings: {
        enabled: true,
        size: '1024x1536'
      },
      prompt: '一间玻璃花房',
      title: '花房',
      fetchImpl: fetchMock as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.minimax.io/v1/image_generation', expect.objectContaining({
      method: 'POST'
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toEqual({
      model: 'image-01',
      prompt: '一间玻璃花房',
      n: 1,
      response_format: 'base64',
      aspect_ratio: '2:3'
    });
    expect(result.fileName).toBe('花房.jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(await result.blob.text()).toBe('jpeg-bytes');
  });

  it('maps Step image sizes to the StepFun endpoint contract', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ b64_json: btoa('step-bytes') }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    await requestGeneratedImage({
      api: {
        ...provider,
        name: '官方 step 生图',
        baseUrl: 'https://api.stepfun.com/step_plan/v1/images/generations',
        path: '/chat/completions',
        model: 'step-image-edit-2'
      },
      settings: {
        enabled: true,
        size: '1536x1024'
      },
      prompt: '山谷里的小木屋',
      fetchImpl: fetchMock as typeof fetch
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.size).toBe('768x1360');
  });

  it('runs a real image request shape for connection tests without returning the blob', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ b64_json: btoa('test-image-bytes') }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await requestImageGenerationConnectivityTest({
      api: provider,
      settings: {
        enabled: true,
        modelOverride: 'gpt-image-1',
        size: 'auto'
      },
      fetchImpl: fetchMock as typeof fetch
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody).toMatchObject({
      model: 'gpt-image-1',
      prompt: expect.stringContaining('Polaris image generation connectivity test'),
      n: 1,
      response_format: 'b64_json'
    });
    expect(requestBody).not.toHaveProperty('size');
    expect(result).toEqual({
      model: 'gpt-image-1',
      size: 'auto',
      mimeType: 'image/png',
      byteLength: 'test-image-bytes'.length
    });
  });
});

describe('checkImageGenerationConfiguration', () => {
  it('validates image route settings without sending a generation request', () => {
    expect(checkImageGenerationConfiguration({
      api: {
        ...provider,
        baseUrl: 'https://api.minimax.io/v1',
        path: '/image_generation',
        model: 'image-01'
      },
      settings: {
        enabled: true,
        size: '1024x1024'
      }
    })).toEqual({
      endpoint: 'https://api.minimax.io/v1/image_generation',
      model: 'image-01',
      size: '1024x1024'
    });
  });

  it('reports missing API keys before a paid generation test', () => {
    expect(() => checkImageGenerationConfiguration({
      api: {
        ...provider,
        apiKey: ''
      },
      settings: {
        enabled: true,
        size: 'auto'
      }
    })).toThrow('请先在生图模型选择的线路里填写 API Key。');
  });
});
