import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestCollaboratorReply } from './requestPipeline';
import { getAssetBlob } from '../../infrastructure/assetStore';
import type { ChatMessage, ProviderProfile } from '../../types/domain';

const requestAssistantReplyMock = vi.hoisted(() => vi.fn());

vi.mock('../../infrastructure/assetStore', () => ({
  getAssetBlob: vi.fn()
}));

vi.mock('../chatApi', () => ({
  requestAssistantReply: requestAssistantReplyMock
}));

const textProvider: ProviderProfile = {
  id: 'custom-text',
  name: 'Text Provider',
  protocol: 'openai-completions',
  baseUrl: 'https://api.xiaomimimo.com/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'text-model',
  capabilities: {
    images: false,
    streaming: true,
    thinking: false
  }
};

const visionProvider: ProviderProfile = {
  id: 'vision-provider',
  name: 'Vision Provider',
  protocol: 'openai-completions',
  baseUrl: 'https://vision.example.test/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'vision-model',
  capabilities: {
    images: true,
    streaming: true,
    thinking: false
  }
};

const imageMessage: ChatMessage = {
  id: 'user-image',
  role: 'user',
  content: 'helphelp!',
  timestamp: 1,
  attachments: [{
    id: 'image-1',
    assetId: 'asset-1',
    kind: 'image',
    name: 'help.png',
    mimeType: 'image/png',
    size: 1024
  }]
};

describe('requestPipeline', () => {
  beforeEach(() => {
    vi.mocked(getAssetBlob).mockReset();
    requestAssistantReplyMock.mockReset();
  });

  it('exports the collaborator request entrypoint', () => {
    expect(typeof requestCollaboratorReply).toBe('function');
  });

  it('blocks image turns before sending when the effective model is text-only and OCR is unavailable', async () => {
    await expect(requestCollaboratorReply({
      api: textProvider,
      persona: null,
      messages: [imageMessage]
    })).rejects.toThrow('当前模型没有直接图片能力');
  });

  it('sends inline images to a vision model without requiring an OCR route', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    requestAssistantReplyMock.mockResolvedValueOnce({ content: '主模型直接看到了图片' });

    const reply = await requestCollaboratorReply({
      api: visionProvider,
      imageUnderstanding: { enabled: false },
      persona: null,
      activeConversationId: 'conversation-vision-1',
      messages: [imageMessage]
    });

    expect(reply.content).toBe('主模型直接看到了图片');
    expect(getAssetBlob).toHaveBeenCalledWith('asset-1');
    expect(requestAssistantReplyMock).toHaveBeenCalledTimes(1);
    expect(requestAssistantReplyMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'conversation-vision-1'
    }));
    const mainRequestContext = requestAssistantReplyMock.mock.calls[0]?.[0]?.context;
    expect(JSON.stringify(mainRequestContext)).toContain('data:image/png;base64,');
  });

  it('does not send a blind vision request when image hydration fails', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(null);

    await expect(requestCollaboratorReply({
      api: visionProvider,
      persona: null,
      messages: [imageMessage]
    })).rejects.toThrow('图片附件没有成功进入模型请求');

    expect(requestAssistantReplyMock).not.toHaveBeenCalled();
  });

  it('does not let a tool followup bypass failed image hydration', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(null);

    await expect(requestCollaboratorReply({
      api: visionProvider,
      persona: null,
      messages: [
        imageMessage,
        {
          id: 'tool-followup',
          role: 'system',
          content: '图片属性工具已经执行，请继续回答用户。',
          timestamp: 2,
          origin: 'tool-runtime'
        }
      ]
    })).rejects.toThrow('图片附件没有成功进入模型请求');

    expect(requestAssistantReplyMock).not.toHaveBeenCalled();
  });

  it('ignores the legacy global image understanding route for text-only chat providers', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));

    await expect(requestCollaboratorReply({
      api: textProvider,
      providers: [visionProvider],
      imageUnderstanding: {
        enabled: true,
        providerId: visionProvider.id
      },
      persona: null,
      messages: [imageMessage]
    })).rejects.toThrow('当前模型没有直接图片能力');

    expect(requestAssistantReplyMock).not.toHaveBeenCalled();
  });

  it('uses the chat provider scoped image understanding route before sending image turns to a text-only model', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    requestAssistantReplyMock
      .mockResolvedValueOnce({ content: '图片里写着：OCR OK' })
      .mockResolvedValueOnce({ content: '主模型收到 OCR' });

    const reply = await requestCollaboratorReply({
      api: {
        ...textProvider,
        imageUnderstanding: {
          enabled: true,
          providerId: visionProvider.id
        }
      },
      providers: [visionProvider],
      persona: null,
      messages: [imageMessage]
    });

    expect(reply.content).toBe('主模型收到 OCR');
    expect(requestAssistantReplyMock).toHaveBeenCalledTimes(2);
    expect(requestAssistantReplyMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      api: visionProvider
    }));
    expect(requestAssistantReplyMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      api: expect.objectContaining({
        id: textProvider.id,
        model: textProvider.model
      })
    }));
    const mainRequestContext = requestAssistantReplyMock.mock.calls[1]?.[0]?.context;
    expect(JSON.stringify(mainRequestContext)).toContain('OCR OK');
  });

  it('uses the chat provider scoped image understanding route without reading the legacy global fallback', async () => {
    vi.mocked(getAssetBlob).mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    requestAssistantReplyMock
      .mockResolvedValueOnce({ content: 'provider scoped OCR' })
      .mockResolvedValueOnce({ content: '主模型收到 provider OCR' });

    const reply = await requestCollaboratorReply({
      api: {
        ...textProvider,
        imageUnderstanding: {
          enabled: true,
          providerId: visionProvider.id,
          modelOverride: 'vision-ocr-model'
        }
      },
      providers: [visionProvider],
      imageUnderstanding: {
        enabled: false
      },
      persona: null,
      messages: [imageMessage]
    });

    expect(reply.content).toBe('主模型收到 provider OCR');
    expect(requestAssistantReplyMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      api: expect.objectContaining({
        id: visionProvider.id,
        model: 'vision-ocr-model'
      })
    }));
    const mainRequestContext = requestAssistantReplyMock.mock.calls[1]?.[0]?.context;
    expect(JSON.stringify(mainRequestContext)).toContain('provider scoped OCR');
  });
});
