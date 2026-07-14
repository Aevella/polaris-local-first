import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from './requestMessage';
import type { AssistantSemanticRecallCandidateDecision } from './requestSemanticRecallPlan';
import { createPersonaTemplate } from '../../config/persona/personaBuilder';
import {
  buildRequestImageDataUrl,
  hydrateConversationAssets,
  prepareCollaboratorReplyRequest,
  resolveContextTokenBudget,
  resolvePreparedAdvancedSettings,
  resolveRequestImageHydrationMessageIds
} from './requestPreparation';
import { getAssetBlob } from '../../infrastructure/assetStore';
import type { ChatMessage, Conversation, ProviderProfile } from '../../types/domain';

const resolveRequestSemanticVectorCandidatesMock = vi.hoisted(() =>
  vi.fn<() => Promise<AssistantSemanticRecallCandidateDecision[]>>(async () => [])
);

vi.mock('../../infrastructure/assetStore', () => ({
  getAssetBlob: vi.fn()
}));

vi.mock('./requestSemanticVectorRecall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./requestSemanticVectorRecall')>()),
  resolveRequestSemanticVectorCandidates: resolveRequestSemanticVectorCandidatesMock
}));

const mockedGetAssetBlob = vi.mocked(getAssetBlob);

const textProvider: ProviderProfile = {
  id: 'provider-test',
  name: 'Test Provider',
  protocol: 'openai-completions',
  baseUrl: 'https://example.test/v1',
  path: '/chat/completions',
  apiKey: 'sk-test',
  model: 'test-model',
  capabilities: {
    images: false,
    streaming: true,
    thinking: false
  }
};

const visionProvider: ProviderProfile = {
  ...textProvider,
  id: 'provider-vision',
  name: 'Vision Provider',
  model: 'vision-model',
  capabilities: {
    images: true,
    streaming: true,
    thinking: false
  }
};

function createUserMessage(id: string, content: string, timestamp: number): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    timestamp
  };
}

function createConversation(seed: {
  id: string;
  title: string;
  collaboratorId?: string | null;
  messages: ChatMessage[];
  updatedAt?: number;
}): Conversation {
  return {
    id: seed.id,
    title: seed.title,
    collaboratorId: seed.collaboratorId ?? 'pharos',
    messages: seed.messages,
    pinnedAt: null,
    updatedAt: seed.updatedAt ?? 1
  };
}

function createImageMessage(seed: {
  id: string;
  assetId: string;
  size: number;
  timestamp: number;
}): RequestMessage {
  return {
    id: seed.id,
    role: 'user',
    content: '',
    timestamp: seed.timestamp,
    attachments: [{
      id: `${seed.id}:image`,
      assetId: seed.assetId,
      kind: 'image',
      name: `${seed.assetId}.png`,
      mimeType: 'image/png',
      size: seed.size
    }]
  };
}

describe('hydrateConversationAssets', () => {
  beforeEach(() => {
    mockedGetAssetBlob.mockReset();
  });

  it('skips a broken image asset instead of failing the whole request', async () => {
    mockedGetAssetBlob.mockRejectedValueOnce(new Error('Load failed'));

    const messages = [createImageMessage({
      id: 'm1',
      assetId: 'asset-broken',
      size: 128 * 1024,
      timestamp: 1
    })];

    await expect(hydrateConversationAssets(messages)).resolves.toEqual(messages);
  });

  it('hydrates only the latest image-bearing user turns', async () => {
    mockedGetAssetBlob.mockImplementation(async (assetId: string) => new Blob([assetId], { type: 'image/png' }));

    const oldest = createImageMessage({
      id: 'm1',
      assetId: 'asset-oldest',
      size: 1_600 * 1024,
      timestamp: 1
    });
    const older = createImageMessage({
      id: 'm2',
      assetId: 'asset-older',
      size: 900 * 1024,
      timestamp: 2
    });
    const latest = createImageMessage({
      id: 'm3',
      assetId: 'asset-latest',
      size: 700 * 1024,
      timestamp: 3
    });

    const hydrated = await hydrateConversationAssets([oldest, older, latest]);

    expect(mockedGetAssetBlob).toHaveBeenCalledTimes(2);
    expect(mockedGetAssetBlob).toHaveBeenNthCalledWith(1, 'asset-older');
    expect(mockedGetAssetBlob).toHaveBeenNthCalledWith(2, 'asset-latest');
    expect(hydrated[0]?.attachments?.[0]).not.toHaveProperty('dataUrl');
    expect(hydrated[1]?.attachments?.[0]).toHaveProperty('dataUrl');
    expect(hydrated[2]?.attachments?.[0]).toHaveProperty('dataUrl');
  });

  it('reuses the same hydrated image payload for repeated references to one asset', async () => {
    mockedGetAssetBlob.mockResolvedValue(new Blob(['same-asset'], { type: 'image/png' }));

    const first = createImageMessage({
      id: 'm1',
      assetId: 'asset-shared',
      size: 64 * 1024,
      timestamp: 1
    });
    const second = createImageMessage({
      id: 'm2',
      assetId: 'asset-shared',
      size: 64 * 1024,
      timestamp: 2
    });

    const hydrated = await hydrateConversationAssets([first, second]);

    expect(mockedGetAssetBlob).toHaveBeenCalledTimes(1);
    expect(hydrated[0]?.attachments?.[0]).toHaveProperty('dataUrl');
    expect(hydrated[1]?.attachments?.[0]).toHaveProperty('dataUrl');
    expect(hydrated[0]?.attachments?.[0]?.dataUrl).toBe(hydrated[1]?.attachments?.[0]?.dataUrl);
  });
});

describe('prepareCollaboratorReplyRequest image capabilities', () => {
  beforeEach(() => {
    mockedGetAssetBlob.mockReset();
  });

  it('respects configured image capability without overriding it from the MiMo model name', async () => {
    mockedGetAssetBlob.mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    const prepared = await prepareCollaboratorReplyRequest({
      api: {
        id: 'custom-mimo',
        name: 'Xiaomi MiMo',
        protocol: 'openai-completions',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        path: '/chat/completions',
        apiKey: 'sk-test',
        model: 'mimo-v2-pro',
        capabilities: {
          images: true,
          streaming: true,
          thinking: false
        }
      },
      persona: null,
      messages: [
        createImageMessage({
          id: 'mimo-text-image',
          assetId: 'asset-mimo-text',
          size: 256 * 1024,
          timestamp: 1
        })
      ]
    });
    const conversationSegment = prepared.context.segments.find((segment) => segment.kind === 'conversation');

    expect(mockedGetAssetBlob).toHaveBeenCalledWith('asset-mimo-text');
    expect(JSON.stringify(conversationSegment)).toContain('data:image/png;base64,');
  });

  it('uses the provider scoped image understanding model before sending images to a text-only provider', async () => {
    mockedGetAssetBlob.mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    const requestImageUnderstanding = vi.fn(async () => ({
      content: '图片里写着：供应商线路里的 OCR 模型是 Qwen3.7-Plus。'
    }));

    const prepared = await prepareCollaboratorReplyRequest({
      api: {
        ...textProvider,
        imageUnderstanding: {
          enabled: true,
          providerId: visionProvider.id
        }
      },
      providers: [visionProvider],
      globalApi: textProvider,
      persona: null,
      messages: [
        createImageMessage({
          id: 'image-user',
          assetId: 'asset-ocr',
          size: 256 * 1024,
          timestamp: 1
        })
      ],
      requestImageUnderstanding
    });
    const conversationSegment = prepared.context.segments.find((segment) => segment.kind === 'conversation');
    const content = conversationSegment?.messages
      .map((message) => typeof message.content === 'string' ? message.content : '')
      .find((value) => value.includes('[图片理解结果]')) ?? '';

    expect(requestImageUnderstanding).toHaveBeenCalledWith(expect.objectContaining({
      api: visionProvider,
      context: expect.objectContaining({
        attachmentSlots: expect.objectContaining({
          pending: [expect.objectContaining({ name: 'asset-ocr.png' })]
        })
      })
    }));
    expect(prepared.imageUnderstandingResults).toEqual([{
      messageId: 'image-user',
      attachmentId: 'image-user:image',
      textContent: '图片里写着：供应商线路里的 OCR 模型是 Qwen3.7-Plus。'
    }]);
    expect(content).toContain('[图片理解结果]');
    expect(content).toContain('供应商线路里的 OCR 模型是 Qwen3.7-Plus');
  });
});

describe('prepareCollaboratorReplyRequest semantic recall', () => {
  beforeEach(() => {
    resolveRequestSemanticVectorCandidatesMock.mockReset();
    resolveRequestSemanticVectorCandidatesMock.mockResolvedValue([]);
  });

  it('keeps cross-conversation recall out of provider context when the collaborator disables it', async () => {
    const persona = createPersonaTemplate({
      id: 'pharos',
      name: 'Pharos',
      description: '灯塔',
      memory: {
        crossConversationRecallEnabled: false
      }
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      persona,
      messages: [createUserMessage('current-user', '跨对话记忆地基', 10)],
      semanticRecallConversations: [
        createConversation({
          id: 'older-match',
          title: '旧记忆讨论',
          messages: [createUserMessage('old-user', '跨对话记忆地基应该召回原话。', 1)]
        })
      ],
      activeConversationId: 'active'
    });

    expect(prepared.audit.semanticRecallPlan.status).toBe('disabled');
    expect(prepared.audit.conversationSummaryPlan.status).toBe('disabled');
    expect(prepared.context.segments.some((segment) => segment.kind === 'semantic_recall')).toBe(false);
    expect(prepared.context.segments.some((segment) => segment.kind === 'conversation_summary')).toBe(false);
  });

  it('keeps short memory entries while a request-level switch disables recall lanes', async () => {
    const persona = createPersonaTemplate({
      id: 'pharos',
      name: 'Pharos',
      description: '灯塔',
      memory: {
        personalMemories: ['喜欢直接说清楚边界。'],
        conversationSummaries: [{
          id: 'summary-profile',
          kind: 'relational_profile',
          title: '互动画像',
          content: '用户 常用很短的话指出结构问题。',
          sequence: 1,
          sourceConversationIds: ['old-conversation'],
          sourceMessageIds: ['old-user'],
          sourceCharCount: 50_000,
          generator: 'small_model',
          generatedAt: 1,
          updatedAt: 2
        }]
      }
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      persona,
      semanticRecallEnabled: false,
      messages: [createUserMessage('current-user', '跨对话记忆地基', 10)],
      semanticRecallConversations: [
        createConversation({
          id: 'older-match',
          title: '旧记忆讨论',
          messages: [createUserMessage('old-user', '跨对话记忆地基应该召回原话。', 1)]
        })
      ],
      activeConversationId: 'active'
    });
    const memorySegment = prepared.context.segments.find((segment) => segment.kind === 'memory');

    expect(prepared.audit.semanticRecallPlan.status).toBe('disabled');
    expect(prepared.audit.conversationSummaryPlan.status).toBe('disabled');
    expect(memorySegment?.messages[0]?.content).toContain('喜欢直接说清楚边界。');
    expect(prepared.context.segments.some((segment) => segment.kind === 'semantic_recall')).toBe(false);
    expect(prepared.context.segments.some((segment) => segment.kind === 'conversation_summary')).toBe(false);
  });

  it('keeps cross-conversation recall enabled by default for existing collaborators', async () => {
    const persona = createPersonaTemplate({
      id: 'pharos',
      name: 'Pharos',
      description: '灯塔'
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      persona,
      messages: [createUserMessage('current-user', '跨对话记忆地基', 10)],
      semanticRecallConversations: [
        createConversation({
          id: 'older-match',
          title: '旧记忆讨论',
          messages: [createUserMessage('old-user', '跨对话记忆地基应该召回原话。', 1)]
        })
      ],
      activeConversationId: 'active'
    });

    expect(prepared.audit.semanticRecallPlan.status).toBe('within_budget');
    expect(prepared.context.segments.some((segment) => segment.kind === 'semantic_recall')).toBe(true);
  });

  it('passes stored conversation summaries into the cross-conversation context lane', async () => {
    const persona = createPersonaTemplate({
      id: 'pharos',
      name: 'Pharos',
      description: '灯塔',
      memory: {
        conversationSummaries: [{
          id: 'summary-profile',
          kind: 'relational_profile',
          title: '互动画像',
          content: '用户 常用很短的话指出结构问题，助手要主动补全体验闭环。',
          sequence: 1,
          sourceConversationIds: ['old-conversation'],
          sourceMessageIds: ['old-user'],
          sourceCharCount: 50_000,
          generator: 'small_model',
          generatedAt: 1,
          updatedAt: 2
        }]
      }
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      persona,
      messages: [createUserMessage('current-user', '接着做记忆', 10)],
      activeConversationId: 'active'
    });
    const summarySegment = prepared.context.segments.find((segment) => segment.kind === 'conversation_summary');

    expect(prepared.audit.conversationSummaryPlan.status).toBe('within_budget');
    expect(prepared.audit.conversationSummaryPlan.selectedSummaries).toContainEqual(expect.objectContaining({
      id: 'summary-profile',
      kind: 'relational_profile',
      sourceMessageIds: ['old-user']
    }));
    expect(summarySegment?.messages[0]?.content).toContain('[跨对话总结]');
    expect(prepared.audit.requestReceipt.blocks.some((block) => block.intent === 'conversation_summary')).toBe(true);
  });

  it('passes collaborator semantic recall config into the request planner', async () => {
    const persona = createPersonaTemplate({
      id: 'pharos',
      name: 'Pharos',
      description: '灯塔',
      memory: {
        semanticRecall: {
          recentTailUserMessageCount: 1
        }
      }
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      persona,
      messages: [createUserMessage('current-user', '继续跨对话记忆', 10)],
      semanticRecallConversations: [
        createConversation({
          id: 'older-match',
          title: '旧记忆讨论',
          messages: [
            createUserMessage('old-user-1', '第一句旧用户原话。', 1),
            createUserMessage('old-user-2', '第二句旧用户原话。', 2),
            createUserMessage('old-user-3', '第三句旧用户原话。', 3)
          ]
        })
      ],
      activeConversationId: 'active'
    });

    expect(prepared.audit.semanticRecallPlan.selectedCandidates).toContainEqual(expect.objectContaining({
      id: 'recall:recent_tail:older-match:old-user-3',
      kind: 'recent_tail',
      sourceMessageIds: ['old-user-3']
    }));
  });

  it('loads vector source conversation bodies while vector request recall is enabled', async () => {
    resolveRequestSemanticVectorCandidatesMock.mockResolvedValue([{
      id: 'recall:vector_match:older-vector:chunk-1',
      kind: 'vector_match',
      label: '向量旧对话',
      sourceConversationId: 'older-vector',
      sourceMessageIds: ['vector-assistant'],
      estimatedTokens: 4,
      charCount: 12,
      score: 0.9,
      contentFingerprint: 'vector-fingerprint',
      status: 'kept'
    }]);
    const loadSemanticRecallConversations = vi.fn(async (conversationIds: string[]) =>
      conversationIds.map((conversationId) => createConversation({
        id: conversationId,
        title: '向量旧对话',
        messages: [{
          id: 'vector-assistant',
          role: 'assistant',
          content: 'vector source original text',
          timestamp: 1
        }]
      }))
    );

    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider,
      globalApi: textProvider,
      persona: createPersonaTemplate({
        id: 'pharos',
        name: 'Pharos',
        description: '灯塔'
      }),
      messages: [createUserMessage('current-user', 'vector query', 10)],
      semanticRecallConversations: [
        createConversation({
          id: 'older-vector',
          title: '向量旧对话',
          messages: []
        })
      ],
      loadSemanticRecallConversations,
      activeConversationId: 'active'
    });
    const semanticRecall = prepared.context.segments.find((segment) => segment.kind === 'semantic_recall');

    expect(loadSemanticRecallConversations).toHaveBeenCalledWith(['older-vector']);
    expect(prepared.audit.semanticRecallPlan.selectedCandidates).toContainEqual(expect.objectContaining({
      id: 'recall:vector_match:older-vector:chunk-1',
      kind: 'vector_match'
    }));
    expect(semanticRecall?.messages[0]?.content).toContain('vector source original text');
  });
});

describe('resolveRequestImageHydrationMessageIds', () => {
  it('selects the latest two image-bearing user turns', () => {
    const messages: RequestMessage[] = [
      createImageMessage({
        id: 'm1',
        assetId: 'asset-1',
        size: 128,
        timestamp: 1
      }),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '我看到了。',
        timestamp: 2
      },
      createImageMessage({
        id: 'm2',
        assetId: 'asset-2',
        size: 128,
        timestamp: 3
      }),
      createImageMessage({
        id: 'm3',
        assetId: 'asset-3',
        size: 128,
        timestamp: 4
      })
    ];

    expect([...resolveRequestImageHydrationMessageIds(messages)]).toEqual(['m3', 'm2']);
  });
});

describe('buildRequestImageDataUrl', () => {
  it('falls back to the original data url when browser image compression is unavailable', async () => {
    const dataUrl = await buildRequestImageDataUrl(new Blob(['tiny'], { type: 'image/png' }));
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('re-encodes small png screenshots instead of keeping the original format', async () => {
    const originalDocument = globalThis.document;
    const originalImage = globalThis.Image;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;

    class MockImage {
      decoding = 'async';
      naturalWidth = 1600;
      naturalHeight = 900;
      width = 1600;
      height = 900;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn()
      })),
      toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob([new Uint8Array(120 * 1024)], { type: 'image/jpeg' }));
      })
    } as unknown as HTMLCanvasElement;

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        createElement: vi.fn((tagName: string) => {
          if (tagName !== 'canvas') {
            throw new Error(`Unexpected tag: ${tagName}`);
          }
          return mockCanvas;
        })
      }
    });
    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      writable: true,
      value: MockImage
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-image')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn()
    });

    try {
      const dataUrl = await buildRequestImageDataUrl(
        new Blob([new Uint8Array(236 * 1024)], { type: 'image/png' })
      );

      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(mockCanvas.toBlob).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: originalDocument
      });
      Object.defineProperty(globalThis, 'Image', {
        configurable: true,
        writable: true,
        value: originalImage
      });
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectUrl
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectUrl
      });
    }
  });
});

describe('resolveContextTokenBudget', () => {
  it('uses enforced provider prompt budgets for preflight trimming', () => {
    expect(resolveContextTokenBudget({
      recommendedPromptTokens: 48_000,
      promptBudgetPolicy: 'enforced'
    })).toBe(48_000);
  });

  it('keeps advisory provider prompt budgets out of hard request trimming', () => {
    expect(resolveContextTokenBudget({
      recommendedPromptTokens: 48_000,
      promptBudgetPolicy: 'advisory'
    })).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('resolvePreparedAdvancedSettings', () => {
  it('does not invent a default output budget when a project workspace is active', () => {
    const advanced = resolvePreparedAdvancedSettings({
      advanced: {
        modelOverride: '',
        temperature: '',
        topP: '',
        maxTokens: '',
        thinkingBudget: '',
        contextMessageLimit: '',
        showThinking: true,
        streaming: true,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        snippets: []
      },
      toolContext: {
        activeCard: null,
        visibleCards: [],
        activeProject: {
          id: 'mini-phone',
          title: 'Mini Phone',
          slug: 'mini-phone',
          source: 'manual',
          tags: [],
          fileCount: 1,
          files: [{
            fileId: 'file:index',
            title: 'index.html',
            language: 'html',
            path: 'index.html',
            isEntry: true
          }]
        }
      }
    });

    expect(advanced?.maxTokens).toBe('');
  });

  it('does not widen the budget when project tools are merely available', () => {
    const advanced = resolvePreparedAdvancedSettings({
      advanced: {
        modelOverride: '',
        temperature: '',
        topP: '',
        maxTokens: '',
        thinkingBudget: '',
        contextMessageLimit: '',
        showThinking: true,
        streaming: true,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        snippets: []
      },
      toolContext: {
        activeCard: null,
        visibleCards: [],
        enabledToolGroups: {
          project: true
        }
      }
    });

    expect(advanced?.maxTokens).toBe('');
  });

  it('preserves an explicit max token override even inside a project workspace', () => {
    const advanced = resolvePreparedAdvancedSettings({
      advanced: {
        modelOverride: '',
        temperature: '',
        topP: '',
        maxTokens: '4096',
        thinkingBudget: '',
        contextMessageLimit: '',
        showThinking: true,
        streaming: true,
        customHeaders: '',
        customBody: '',
        regexRules: '',
        snippets: []
      },
      toolContext: {
        activeCard: null,
        visibleCards: [],
        activeProject: {
          id: 'mini-phone',
          title: 'Mini Phone',
          slug: 'mini-phone',
          source: 'manual',
          tags: [],
          fileCount: 1,
          files: [{
            fileId: 'file:index',
            title: 'index.html',
            language: 'html',
            path: 'index.html',
            isEntry: true
          }]
        }
      }
    });

    expect(advanced?.maxTokens).toBe('4096');
  });
});
