import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../../config/persona/personaBuilder';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { usePersonaStore } from '../../stores/personaStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import type { Conversation, ProviderProfile } from '../../types/domain';
import {
  clearMemoryVectorIndexForCollaboratorAction,
  testMemoryVectorModelConnection,
  updateMemoryVectorIndexForCollaborator
} from './memoryVectorIndexActions';
import type {
  MemoryVectorIndexEmbeddingRequest,
  MemoryVectorIndexPreparationRequestReply
} from '../../engines/memoryVectorIndexPreparationRunner';
import { memoryVectorIndexMetadataKey } from '../../engines/memoryVectorIndexStorage';
import { MemoryVectorEmbeddingRequestError } from '../../engines/memoryVectorEmbeddingClient';
import {
  buildChatDomainMetaLocalDataRow,
  buildConversationLocalDataProjection,
  getChatDomainMetaLocalDataRef,
  getConversationCatalogLocalDataRef,
  getConversationRecordLocalDataRef,
  getLocalDataRowKey
} from '../../engines/localData';

const persistence = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const kvKeys = vi.fn(async () => [...values.keys()]);
  const kvKeysWithPrefix = vi.fn(async (prefix: string) => [...values.keys()].filter((key) => key.startsWith(prefix)));
  const kvGet = vi.fn(async (key: string) => values.get(key) ?? null);
  const kvSet = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  const getPersistenceLocalDataCommitMode = vi.fn(() => 'transactional');
  const kvApplyMutations = vi.fn(async (mutations: Array<{
    type: 'set' | 'delete';
    key: string;
    value?: unknown;
  }>) => {
    for (const mutation of mutations) {
      if (mutation.type === 'set') {
        values.set(mutation.key, mutation.value);
      } else {
        values.delete(mutation.key);
      }
    }
  });
  return {
    values,
    kvKeys,
    kvKeysWithPrefix,
    kvGet,
    kvSet,
    kvApplyMutations,
    getPersistenceLocalDataCommitMode
  };
});

vi.mock('../../infrastructure/persistence', () => ({
  kvKeys: persistence.kvKeys,
  kvKeysWithPrefix: persistence.kvKeysWithPrefix,
  kvGet: persistence.kvGet,
  kvSet: persistence.kvSet,
  kvApplyMutations: persistence.kvApplyMutations,
  getPersistenceLocalDataCommitMode: persistence.getPersistenceLocalDataCommitMode
}));

const provider: ProviderProfile = {
  id: 'provider-a',
  name: 'Provider A',
  protocol: 'openai-completions',
  baseUrl: 'https://api.example.test',
  path: '/v1/chat/completions',
  apiKey: 'key',
  model: 'semantic-model',
  capabilities: {
    images: false,
    streaming: false,
    thinking: false
  }
};
const vectorProviderId = `memory-vector:${provider.baseUrl}:/embeddings`;

function createConversation(content = '用户 想让向量索引在后台整理，不能卡住前台聊天。'): Conversation {
  return {
    id: 'c1',
    title: '记忆讨论',
    collaboratorId: 'aa',
    messages: [{
      id: 'm1',
      role: 'user',
      content,
      timestamp: 100
    }],
    pinnedAt: null,
    updatedAt: 100
  };
}

function seedLiveChatState(conversation = createConversation()) {
  const now = conversation.updatedAt;
  const projection = buildConversationLocalDataProjection({
    conversation,
    bodyState: 'complete',
    version: 1,
    committedAt: now
  });
  const domainMeta = buildChatDomainMetaLocalDataRow({
    activeConversationId: conversation.id,
    activeConversationCount: 1,
    quarantinedConversationCount: 0,
    totalConversationCount: 1,
    version: 1,
    updatedAt: now
  });

  persistence.values.set(getLocalDataRowKey(getChatDomainMetaLocalDataRef()), domainMeta);
  persistence.values.set(getLocalDataRowKey(getConversationCatalogLocalDataRef(conversation.id)), projection.catalogRow);
  if (projection.recordRow) {
    persistence.values.set(getLocalDataRowKey(getConversationRecordLocalDataRef(conversation.id)), projection.recordRow);
  }
}

describe('memoryVectorIndexActions', () => {
  beforeEach(() => {
    persistence.values.clear();
    persistence.kvKeys.mockClear();
    persistence.kvKeysWithPrefix.mockClear();
    persistence.kvGet.mockClear();
    persistence.kvSet.mockClear();
    persistence.kvApplyMutations.mockClear();

    useRuntimeStore.setState({
      providers: [provider],
      activeProviderId: provider.id,
      conversationSummaryModel: {
        enabled: true,
        providerId: provider.id,
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000,
        lastUpdatedAt: 0
      },
      memoryVectorRetrieval: {
        enabled: true,
        baseUrl: provider.baseUrl,
        path: '/embeddings',
        apiKey: provider.apiKey,
        model: 'embedding-model',
        dimensions: 1536,
        lastUpdatedAt: 0
      },
      hydrated: true,
      persistToDb: vi.fn(async () => undefined)
    });
    usePersonaStore.setState({
      personas: [
        createPersonaTemplate({
          id: 'aa',
          name: '用户',
          description: '',
          memory: {
            crossConversationRecallEnabled: true,
            vectorIndex: {
              enabled: true,
              providerId: provider.id,
              modelOverride: 'embedding-model',
              dimensions: 1536,
              status: 'idle',
              indexedChunkCount: 0,
              totalChunkCount: 0,
              lastIndexedAt: 0,
              lastError: ''
            }
          }
        })
      ],
      activeCollaboratorId: 'aa',
      hydrated: true,
      persistToDb: vi.fn(async () => undefined)
    });
    seedLiveChatState(createConversation('用户 想让向量索引在后台整理，不能卡住前台聊天。'));
    const ensureFullConversationBodiesLoaded = vi.fn(async () => {
      throw new Error('derived work should not hydrate chat store');
    });
    useChatStore.setState({
      conversations: [createConversation()],
      activeConversationId: 'c1',
      hydrated: true,
      dirtyConversationIds: [],
      deletedConversationIds: [],
      loadingMessageConversationIds: [],
      ensureFullConversationBodiesLoaded
    });
    useCollectionStore.setState({
      hydrated: true
    });
  });

  it('runs background preparation, updates progress state, stores rows, and persists once complete', async () => {
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async (params) => {
      const prompt = params.context.segments.flatMap((segment) => segment.messages.map((message) => message.content)).join('\n');
      const chunkId = prompt.match(/chunkId: ([^\n]+)/)?.[1] ?? '';
      const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');
      expect(persona?.memory.vectorIndex?.status).toBe('indexing');
      expect(persona?.memory.vectorIndex?.totalChunkCount).toBe(1);
      return {
        content: JSON.stringify({
          chunks: [{
            chunkId,
            title: '后台整理',
            keywords: ['向量索引', '后台'],
            summary: '用户要求向量索引后台整理，不要卡前台。',
            semanticText: '向量索引应该在后台分批整理，前台聊天不能等待它。'
          }]
        })
      };
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.api.id).toBe(vectorProviderId);
      expect(params.model).toBe('embedding-model');
      expect(params.dimensions).toBe(1536);
      return params.inputs.map(() => [0.1, 0.2, 0.3]);
    });

    const result = await updateMemoryVectorIndexForCollaborator('aa', {
      requestReply,
      requestEmbeddings,
      now: 555,
      yieldToForeground: vi.fn(async () => undefined)
    });
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(result.status).toBe('completed');
    expect(result.embeddedChunkCount).toBe(1);
    expect(useChatStore.getState().ensureFullConversationBodiesLoaded).not.toHaveBeenCalled();
    expect(persona?.memory.vectorIndex).toMatchObject({
      enabled: true,
      status: 'idle',
      indexedChunkCount: 1,
      totalChunkCount: 1,
      lastIndexedAt: 555,
      lastError: ''
    });
    expect(persistence.values.has(memoryVectorIndexMetadataKey('aa'))).toBe(true);
    expect([...persistence.values.keys()].some((key) => key.startsWith('memory-vector-index-entry-v1:aa:'))).toBe(true);
    const entry = [...persistence.values.values()].find((value) =>
      Boolean(value && typeof value === 'object' && 'sourceChunkId' in value && 'embedding' in value)
    ) as { embedding?: unknown } | undefined;
    expect(entry?.embedding).toMatchObject({
      providerId: vectorProviderId,
      model: 'embedding-model',
      dimensions: 1536,
      vector: [0.1, 0.2, 0.3],
      embeddedAt: 555
    });
    expect(usePersonaStore.getState().persistToDb).toHaveBeenCalled();
  });

  it('indexes raw chunks when summary generation is off and only the embedding route is configured', async () => {
    useRuntimeStore.setState({
      providers: [{ ...provider, apiKey: '' }],
      activeProviderId: provider.id,
      conversationSummaryModel: {
        enabled: false,
        providerId: provider.id,
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000,
        lastUpdatedAt: 0
      },
      memoryVectorRetrieval: {
        enabled: true,
        baseUrl: provider.baseUrl,
        path: '/embeddings',
        apiKey: 'vector-key',
        model: 'embedding-model',
        dimensions: 1536,
        lastUpdatedAt: 0
      }
    });
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>();
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.api.apiKey).toBe('vector-key');
      expect(params.inputs).toEqual(['记忆讨论\n用户 想让向量索引在后台整理，不能卡住前台聊天。']);
      return [[0.1, 0.2, 0.3]];
    });

    const result = await updateMemoryVectorIndexForCollaborator('aa', {
      requestReply,
      requestEmbeddings,
      now: 777,
      yieldToForeground: vi.fn(async () => undefined)
    });
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(result.status).toBe('completed');
    expect(result.preparedChunkCount).toBe(1);
    expect(result.embeddedChunkCount).toBe(1);
    expect(requestReply).not.toHaveBeenCalled();
    expect(persona?.memory.vectorIndex).toMatchObject({
      status: 'idle',
      indexedChunkCount: 1,
      totalChunkCount: 1,
      lastIndexedAt: 777,
      lastError: ''
    });
  });

  it('finishes as idle with a visible notice when the embedding provider rejected some chunks', async () => {
    useRuntimeStore.setState({
      providers: [{ ...provider, apiKey: '' }],
      activeProviderId: provider.id,
      conversationSummaryModel: {
        enabled: false,
        providerId: provider.id,
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000,
        lastUpdatedAt: 0
      },
      memoryVectorRetrieval: {
        enabled: true,
        baseUrl: provider.baseUrl,
        path: '/embeddings',
        apiKey: 'vector-key',
        model: 'embedding-3',
        dimensions: null,
        lastUpdatedAt: 0
      }
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async () => {
      throw new MemoryVectorEmbeddingRequestError(400, JSON.stringify({
        error: { code: '1210', message: 'API 调用参数有误，请检查文档。' }
      }));
    });

    const result = await updateMemoryVectorIndexForCollaborator('aa', {
      requestEmbeddings,
      now: 778,
      yieldToForeground: vi.fn(async () => undefined)
    });
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(result.status).toBe('completed');
    expect(result.skippedChunkCount).toBe(1);
    expect(persona?.memory.vectorIndex).toMatchObject({
      status: 'idle',
      indexedChunkCount: 0,
      totalChunkCount: 1,
      lastIndexedAt: 778,
      lastError: '1 条片段被向量模型拒绝，已跳过，下次整理会重试：1210 API 调用参数有误，请检查文档。'
    });
  });

  it('tests the dedicated embedding route without requiring vector recall to be enabled', async () => {
    useRuntimeStore.setState({
      memoryVectorRetrieval: {
        enabled: false,
        baseUrl: provider.baseUrl,
        path: '/embeddings',
        apiKey: provider.apiKey,
        model: 'embedding-model',
        dimensions: 1024,
        lastUpdatedAt: 0
      }
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.api.id).toBe(vectorProviderId);
      expect(params.api.apiKey).toBe(provider.apiKey);
      expect(params.model).toBe('embedding-model');
      expect(params.dimensions).toBe(1024);
      expect(params.inputs).toEqual(['Polaris memory vector connection test']);
      return [[0.1, 0.2, 0.3, 0.4]];
    });

    await expect(testMemoryVectorModelConnection({ requestEmbeddings })).resolves.toEqual({
      providerId: vectorProviderId,
      model: 'embedding-model',
      dimensions: 1024,
      returnedDimensions: 4
    });
  });

  it('refuses connection tests while the dedicated embedding route is incomplete', async () => {
    useRuntimeStore.setState({
      memoryVectorRetrieval: {
        enabled: false,
        baseUrl: provider.baseUrl,
        path: '/embeddings',
        apiKey: '',
        model: 'embedding-model',
        dimensions: null,
        lastUpdatedAt: 0
      }
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>();

    await expect(testMemoryVectorModelConnection({ requestEmbeddings })).rejects.toThrow('请先填写向量模型的 API Key。');
    expect(requestEmbeddings).not.toHaveBeenCalled();
  });

  it('keeps stored rows and progress when vector recall is disabled', async () => {
    persistence.values.set(memoryVectorIndexMetadataKey('aa'), { version: 1 });
    persistence.values.set('memory-vector-index-entry-v1:aa:old', { version: 1 });
    usePersonaStore.getState().updateCollaborator('aa', {
      memory: {
        vectorIndex: {
          enabled: true,
          providerId: provider.id,
          modelOverride: 'embedding-model',
          dimensions: 1536,
          status: 'idle',
          indexedChunkCount: 3,
          totalChunkCount: 3,
          lastIndexedAt: 444,
          lastError: ''
        }
      }
    });
    usePersonaStore.getState().updateCollaborator('aa', {
      memory: {
        crossConversationRecallEnabled: false
      }
    });
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>();

    const result = await updateMemoryVectorIndexForCollaborator('aa', {
      requestReply,
      now: 666
    });
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(result.status).toBe('disabled');
    expect(requestReply).not.toHaveBeenCalled();
    expect(persistence.values.has(memoryVectorIndexMetadataKey('aa'))).toBe(true);
    expect(persistence.values.has('memory-vector-index-entry-v1:aa:old')).toBe(true);
    expect(persona?.memory.vectorIndex).toMatchObject({
      status: 'idle',
      indexedChunkCount: 3,
      totalChunkCount: 3,
      lastIndexedAt: 444,
      lastError: ''
    });
  });

  it('does not fall back to the global chat provider when vector provider is not configured', async () => {
    useRuntimeStore.setState({
      memoryVectorRetrieval: {
        enabled: true,
        baseUrl: '',
        path: '/embeddings',
        apiKey: provider.apiKey,
        model: 'embedding-model',
        dimensions: 1536,
        lastUpdatedAt: 0
      }
    });
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>();
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>();

    await expect(updateMemoryVectorIndexForCollaborator('aa', {
      requestReply,
      requestEmbeddings
    })).rejects.toThrow('请先在记忆设置里配置向量模型。');
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(requestReply).not.toHaveBeenCalled();
    expect(requestEmbeddings).not.toHaveBeenCalled();
    expect(persona?.memory.vectorIndex).toMatchObject({
      status: 'failed',
      indexedChunkCount: 0,
      totalChunkCount: 0,
      lastError: '请先在记忆设置里配置向量模型。'
    });
    expect(usePersonaStore.getState().persistToDb).toHaveBeenCalled();
  });

  it('refuses to start while source chat writes are still pending', async () => {
    useChatStore.setState({
      dirtyConversationIds: ['c1']
    });
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>();

    await expect(updateMemoryVectorIndexForCollaborator('aa', {
      requestReply
    })).rejects.toThrow('对话还有未落盘更改');

    expect(requestReply).not.toHaveBeenCalled();
    expect(useChatStore.getState().ensureFullConversationBodiesLoaded).not.toHaveBeenCalled();
  });

  it('clear action deletes local rows and can disable the setting', async () => {
    persistence.values.set(memoryVectorIndexMetadataKey('aa'), { version: 1 });
    persistence.values.set('memory-vector-index-entry-v1:aa:old', { version: 1 });

    await clearMemoryVectorIndexForCollaboratorAction('aa', { disable: true });
    const persona = usePersonaStore.getState().personas.find((item) => item.id === 'aa');

    expect(persistence.values.has(memoryVectorIndexMetadataKey('aa'))).toBe(false);
    expect(persistence.values.has('memory-vector-index-entry-v1:aa:old')).toBe(false);
    expect(persona?.memory.vectorIndex).toMatchObject({
      enabled: false,
      status: 'idle',
      indexedChunkCount: 0,
      totalChunkCount: 0
    });
    expect(usePersonaStore.getState().persistToDb).toHaveBeenCalled();
  });
});
