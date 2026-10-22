import { buildAnthropicRequest } from '../provider-runtime/providerRuntimeAnthropicAdapter';
import { buildGeminiNativeRequest } from '../provider-runtime/providerRuntimeGeminiAdapter';
import { parseWorldBookRegexTriggers } from '../regexTriggerProcessor';
import { buildRequestImageDataUrl, hydrateConversationAssets, omitUnselectedRequestImageBytes, resolveRequestImageHydrationMessageIds } from './requestImagePreparation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestMessage } from './requestMessage';
import type { AssistantSemanticRecallCandidateDecision } from './requestSemanticRecallPlan';
import { createPersonaTemplate } from '../../config/persona/personaBuilder';
import {
  prepareCollaboratorReplyRequest,
  resolveContextTokenBudget,
  resolvePreparedAdvancedSettings
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

  it('honors current-turn and always policies and removes stale inline bytes only from the request copy', async () => {
    mockedGetAssetBlob.mockImplementation(async (id: string) => new Blob([id], { type: 'image/jpeg' }));
    const old = createImageMessage({ id: 'old', assetId: 'old-image', size: 1, timestamp: 1 });
    old.attachments![0].dataUrl = 'data:image/jpeg;base64,b2xk';
    const latest = createImageMessage({ id: 'latest', assetId: 'latest-image', size: 1, timestamp: 2 });
    const current = await hydrateConversationAssets([old, latest], 'currentTurnOnly');
    expect(current[0].attachments![0].dataUrl).toBeUndefined();
    expect(current[1].attachments![0].dataUrl).toBeDefined();
    expect(old.attachments![0].dataUrl).toBe('data:image/jpeg;base64,b2xk');
    expect(mockedGetAssetBlob).toHaveBeenCalledTimes(1);
    mockedGetAssetBlob.mockClear();
    const all = await hydrateConversationAssets([old, latest], 'always');
    expect(mockedGetAssetBlob).toHaveBeenCalledTimes(2);
    expect(all.every(message => Boolean(message.attachments![0].dataUrl))).toBe(true);
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


describe('prepareCollaboratorReplyRequest persona material delivery', () => {
  const routes = [
    { protocol: 'anthropic-messages' as const, model: 'claude-test', path: '/messages', build: buildAnthropicRequest },
    { protocol: 'gemini-generate-content' as const, model: 'gemini-2.5-pro', path: '', build: buildGeminiNativeRequest }
  ];

  it.each(routes)('sends the latest custom prompt and a readable directory on $protocol', async (route) => {
    const persona = createPersonaTemplate({ id: 'material-test', name: '资料测试', description: '测试' });
    persona.compiledPrompt = '人格标记：始终用完整句子回应。';
    persona.memory.referenceDocs = [{
      id: 'document-marker', title: '资料目录标记', summary: '关于旧约定的摘要',
      content: '资料正文标记：只在工具读取后可见。', source: 'user', updatedAt: 1
    }];
    const api = { ...textProvider, protocol: route.protocol, model: route.model, path: route.path };
    for (const prompt of ['人格标记：始终用完整句子回应。', '更新人格标记：不要用列表回应。']) {
      persona.compiledPrompt = prompt;
      const prepared = await prepareCollaboratorReplyRequest({
        api, persona, semanticRecallEnabled: false,
        toolContext: { activeCard: null, visibleCards: [], enabledToolGroups: { memory: true } },
        messages: [createUserMessage('material-user', '你好', 2)]
      });
      const body = route.build({ api, context: prepared.context }).body;
      const encoded = JSON.stringify(body);
      expect(prepared.audit.personaPromptSource).toBe('custom');
      expect(encoded).toContain(prompt);
      expect(encoded).toContain('资料目录标记');
      expect(encoded).toContain('document-marker');
      expect(encoded).toContain('readMemoryDoc');
      expect(encoded).not.toContain('资料正文标记');
      expect(prepared.context.tools?.some(tool => tool.function.name === 'readMemoryDoc')).toBe(true);
    }
  });

  it.each(routes)('respects the disabled long-term material group on $protocol', async (route) => {
    const persona = createPersonaTemplate({ id: 'material-disabled', name: '资料测试', description: '测试' });
    persona.compiledPrompt = '人格仍应生效';
    persona.memory.referenceDocs = [{
      id: 'disabled-document', title: '已关闭资料标记', summary: '目录摘要',
      content: '已关闭正文标记', source: 'user', updatedAt: 1
    }];
    const api = { ...textProvider, protocol: route.protocol, model: route.model, path: route.path };
    const prepared = await prepareCollaboratorReplyRequest({
      api, persona, semanticRecallEnabled: false,
      toolContext: { activeCard: null, visibleCards: [], enabledToolGroups: { memory: false } },
      messages: [createUserMessage('material-user', '你好', 2)]
    });
    const encoded = JSON.stringify(route.build({ api, context: prepared.context }).body);
    expect(encoded).toContain('人格仍应生效');
    expect(encoded).not.toContain('已关闭资料标记');
    expect(encoded).not.toContain('已关闭正文标记');
    expect(prepared.context.tools?.some(tool => tool.function.name === 'readMemoryDoc')).toBe(false);
  });

  it.each(routes)('sends material body and its ending in the tool follow-up on $protocol', async (route) => {
    const api = { ...textProvider, protocol: route.protocol, model: route.model, path: route.path };
    const detailText = '资料内容测试。'.repeat(4000) + '长期资料全文末尾标记';
    const prepared = await prepareCollaboratorReplyRequest({
      api, persona: null, semanticRecallEnabled: false,
      toolContext: { activeCard: null, visibleCards: [], enabledToolGroups: { memory: true } },
      messages: [
        createUserMessage('material-user', '请读资料', 1),
        { id: 'material-assistant', role: 'assistant', content: '', timestamp: 2,
          nativeToolCalls: [{ id: 'material-call', name: 'readMemoryDoc', argumentsText: '{"docId":"material-doc"}' }] },
        { id: 'material-result', role: 'system', origin: 'tool-runtime', content: '已读取长期资料', timestamp: 3,
          toolInvocation: {
            id: 'material-result', kind: 'readMemoryDoc', status: 'executed', title: '读取长期资料',
            summary: '已读取长期资料', detailText, originMessageId: 'material-assistant', toolCallId: 'material-call'
          } }
      ]
    });
    const encoded = JSON.stringify(route.build({ api, context: prepared.context }).body);
    expect(encoded).toContain(detailText);
    expect(encoded).toContain('readMemoryDoc');
  });
});

describe('prepareCollaboratorReplyRequest worldbook injection', () => {
  it('includes an imported constant on every request without keyword matches', async () => {
    const persona = createPersonaTemplate({ id: 'constant-book', name: '常驻测试', description: '世界书测试' });
    const imported = parseWorldBookRegexTriggers(JSON.stringify({ entries: {
      constant: { key: ['永远不会出现的关键词'], content: '常驻验收：天空永远是紫色。', constant: true }
    } }));
    persona.advanced.regexTriggers = JSON.stringify(imported.rules);
    for (const [index, text] of ['你好', '继续', '说说今天'].entries()) {
      const prepared = await prepareCollaboratorReplyRequest({
        api: textProvider, persona: JSON.parse(JSON.stringify(persona)), semanticRecallEnabled: false,
        messages: [createUserMessage(`constant-${index}`, text, index + 1)]
      });
      const worldbook = prepared.context.segments.flatMap((segment) => segment.messages)
        .find((message) => message.promptPartName === 'regex_trigger_context');
      expect(worldbook?.role).toBe('system');
      expect(worldbook?.content).toContain('常驻验收：天空永远是紫色。');
      const anthropic = buildAnthropicRequest({
        api: { ...textProvider, protocol: 'anthropic-messages', path: '/messages', model: 'claude-test' },
        context: prepared.context
      });
      const gemini = buildGeminiNativeRequest({
        api: { ...textProvider, protocol: 'gemini-generate-content', model: 'gemini-test' },
        context: prepared.context
      });
      for (const history of [anthropic.body.messages, gemini.body.contents]) {
        expect(JSON.stringify(history)).toContain('常驻验收：天空永远是紫色。');
        expect(JSON.stringify(history)).toContain('不是用户新发的消息');
      }
    }
  });

  it('injects imported constants and conditional entries after canonical save and hydration', async () => {
    const persona = createPersonaTemplate({ id: 'imported-book', name: '白树', description: '世界书测试' });
    const imported = parseWorldBookRegexTriggers(JSON.stringify({ data: { character_book: { entries: [
      { content: '{{char}} 的常驻设定', constant: true, enabled: true },
      { keys: ['白树'], secondary_keys: ['夜晚'], selective: true, content: '白树的夜晚设定', enabled: true },
      { keys: ['白树'], secondary_keys: ['白天'], selective: true, content: '白树的白天设定', enabled: true }
    ] } } }));
    persona.advanced.regexTriggers = JSON.stringify(imported.rules);
    const hydratedPersona = JSON.parse(JSON.stringify(persona));
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider, persona: hydratedPersona, semanticRecallEnabled: false,
      messages: [createUserMessage('book-user', '夜晚的白树', 1)]
    });
    const context = JSON.stringify(prepared.context);
    expect(context).toContain('白树 的常驻设定');
    expect(context).toContain('白树的夜晚设定');
    expect(context).not.toContain('白树的白天设定');
    expect(context).not.toContain('{{char}}');
  });

  it('injects a default-depth worldbook matched by recent assistant context into the request', async () => {
    const persona = createPersonaTemplate({ id: 'worldbook-test', name: '世界书测试', description: '请求测试' });
    persona.advanced = {
      ...persona.advanced,
      regexTriggers: JSON.stringify([
        { id: 'recent', name: '白树', pattern: '白树', prompt: '世界书设定：白树位于北境。', enabled: true },
        { id: 'latest', name: '仅最新', pattern: '白树', prompt: '不该注入的规则', enabled: true, scanDepth: 1 }
      ])
    };
    const prepared = await prepareCollaboratorReplyRequest({
      api: textProvider, persona, semanticRecallEnabled: false,
      messages: [
        createUserMessage('u1', '继续故事', 1),
        { id: 'a1', role: 'assistant', content: '你来到白树旁。', timestamp: 2 },
        createUserMessage('u2', '这里发生了什么？', 3)
      ]
    });
    const requestContext = JSON.stringify(prepared.context);
    expect(requestContext).toContain('世界书设定：白树位于北境。');
    expect(requestContext).not.toContain('不该注入的规则');
  });
});


describe('omitUnselectedRequestImageBytes', () => {
  it('removes unselected inline bytes on text routes while preserving stored attachment text and identity', () => {
    const old = createImageMessage({ id: 'old', assetId: 'old-image', size: 1, timestamp: 1 });
    old.attachments![0].dataUrl = 'data:image/jpeg;base64,b2xk';
    old.attachments![0].textContent = 'saved OCR text';
    const latest: RequestMessage = { id: 'latest', role: 'user', content: 'text', timestamp: 2 };
    const projected = omitUnselectedRequestImageBytes([old, latest], 'currentTurnOnly');
    expect(projected[0].attachments![0]).toMatchObject({ id: old.attachments![0].id, assetId: 'old-image', textContent: 'saved OCR text', dataUrl: undefined });
    expect(old.attachments![0].dataUrl).toBe('data:image/jpeg;base64,b2xk');
    expect(projected[1]).toBe(latest);
    expect(omitUnselectedRequestImageBytes([old], 'always')[0]).toBe(old);
    expect(omitUnselectedRequestImageBytes([])).toEqual([]);
  });
});
