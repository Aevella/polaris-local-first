import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ProviderProfile } from '../types/domain';
import type {
  MemoryVectorIndexEmbeddingRequest,
  MemoryVectorIndexPreparationRequestReply
} from './memoryVectorIndexPreparationRunner';
import type {
  MemoryVectorIndexEntry,
  MemoryVectorIndexMetadata,
  MemoryVectorIndexModelIdentity,
  UpsertMemoryVectorIndexEntriesArgs
} from './memoryVectorIndexStorage';

const storageMocks = vi.hoisted(() => ({
  entries: new Map<string, MemoryVectorIndexEntry>(),
  readMemoryVectorIndexEntries: vi.fn(),
  readMemoryVectorIndexEntryRows: vi.fn(),
  replaceMemoryVectorIndexEntries: vi.fn(),
  upsertMemoryVectorIndexEntries: vi.fn()
}));

vi.mock('./memoryVectorIndexStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./memoryVectorIndexStorage')>();
  return {
    ...actual,
    readMemoryVectorIndexEntries: storageMocks.readMemoryVectorIndexEntries,
    readMemoryVectorIndexEntryRows: storageMocks.readMemoryVectorIndexEntryRows,
    replaceMemoryVectorIndexEntries: storageMocks.replaceMemoryVectorIndexEntries,
    upsertMemoryVectorIndexEntries: storageMocks.upsertMemoryVectorIndexEntries,
    writeMemoryVectorIndexEntryBatch: storageMocks.upsertMemoryVectorIndexEntries
  };
});

import {
  MEMORY_VECTOR_EMBEDDING_BATCH_MAX_INPUTS,
  MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS,
  resolveMemorySemanticPreparationBatches,
  resolveMemoryVectorEmbeddingBatches,
  resolveMemoryVectorSourceChunks,
  runMemoryVectorIndexPreparation
} from './memoryVectorIndexPreparationRunner';
import { buildConversationSemanticChunks } from './memoryRetrievalIndex';
import { MemoryVectorEmbeddingRequestError } from './memoryVectorEmbeddingClient';

const ZHIPU_PARAMETER_ERROR_BODY = JSON.stringify({
  error: { code: '1210', message: 'API 调用参数有误，请检查文档。' }
});

const baseProvider: ProviderProfile = {
  id: 'main-provider',
  name: 'Main Provider',
  protocol: 'openai-completions',
  baseUrl: 'https://api.example.test',
  path: '/v1/chat/completions',
  apiKey: 'key',
  model: 'main-model',
  capabilities: {
    images: false,
    streaming: false,
    thinking: false
  }
};

const smallProvider: ProviderProfile = {
  ...baseProvider,
  id: 'small-provider',
  name: 'Small Provider',
  model: 'small-default'
};

function conversation(seed: {
  id: string;
  collaboratorId: string;
  content: string;
  timestamp: number;
}): Conversation {
  return {
    id: seed.id,
    title: `对话 ${seed.id}`,
    collaboratorId: seed.collaboratorId,
    messages: [{
      id: `${seed.id}-user`,
      role: 'user',
      content: seed.content,
      timestamp: seed.timestamp
    }],
    pinnedAt: null,
    updatedAt: seed.timestamp
  };
}

function metadataFor(args: {
  collaboratorId: string;
  model: MemoryVectorIndexModelIdentity | null;
  entryCount: number;
  now: number;
}): MemoryVectorIndexMetadata {
  return {
    version: 1,
    schemaVersion: 1,
    collaboratorId: args.collaboratorId,
    model: args.model,
    entryCount: args.entryCount,
    embeddedCount: Array.from(storageMocks.entries.values()).filter((entry) => Boolean(entry.embedding)).length,
    updatedAt: args.now
  };
}

describe('resolveMemorySemanticPreparationBatches', () => {
  it('groups chunks by source text target without dropping oversize chunks', () => {
    const chunks = [
      {
        id: 'chunk-1',
        exactText: '12345'
      },
      {
        id: 'chunk-2',
        exactText: '67890'
      },
      {
        id: 'chunk-3',
        exactText: 'oversize source text'
      }
    ] as ReturnType<typeof import('./memoryRetrievalIndex').buildConversationSemanticChunks>;

    expect(resolveMemorySemanticPreparationBatches({
      chunks,
      targetSourceChars: 10
    }).map((batch) => batch.chunks.map((chunk) => chunk.id))).toEqual([
      ['chunk-1', 'chunk-2'],
      ['chunk-3']
    ]);
  });
});

describe('resolveMemoryVectorSourceChunks', () => {
  it('splits oversized semantic chunks before they reach the embeddings API', () => {
    const [sourceChunk] = buildConversationSemanticChunks({
      conversations: [
        conversation({
          id: 'long',
          collaboratorId: 'aa',
          content: '很长的旧对话。'.repeat(1600),
          timestamp: 1
        })
      ],
      currentCollaboratorId: 'aa'
    });
    if (!sourceChunk) throw new Error('Expected source chunk.');

    const chunks = resolveMemoryVectorSourceChunks([sourceChunk]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.semanticText.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS)).toBe(true);
    expect(chunks[0]?.id).toContain(':part-1-of-');
    expect(chunks[1]?.id).toContain(':part-2-of-');
    expect(new Set(chunks.map((chunk) => chunk.sourceMessageIds[0]))).toEqual(new Set(['long-user']));
  });
});

describe('resolveMemoryVectorEmbeddingBatches', () => {
  it('keeps default embedding batches within the smallest known provider item cap', () => {
    const chunks = Array.from({ length: 23 }, (_, index) => ({
      id: `prepared-${index + 1}`,
      sourceChunkId: `chunk-${index + 1}`,
      kind: 'source_message' as const,
      collaboratorId: 'aa',
      conversationId: `c${index + 1}`,
      conversationTitle: `对话 ${index + 1}`,
      sourceMessageIds: [`m${index + 1}`],
      sourceRefs: [],
      title: `片段 ${index + 1}`,
      keywords: [],
      summary: `摘要 ${index + 1}`,
      semanticText: `语义文本 ${index + 1}`,
      sourceCharCount: 10,
      generator: 'raw_source' as const,
      generatedAt: 1,
      createdAt: 1,
      updatedAt: 1
    }));

    const batches = resolveMemoryVectorEmbeddingBatches({ chunks });

    expect(MEMORY_VECTOR_EMBEDDING_BATCH_MAX_INPUTS).toBe(10);
    expect(batches.map((batch) => batch.chunks.length)).toEqual([10, 10, 3]);
    expect(batches.every((batch) => batch.chunks.length <= 10)).toBe(true);
  });
});

describe('runMemoryVectorIndexPreparation', () => {
  beforeEach(() => {
    storageMocks.entries.clear();
    storageMocks.readMemoryVectorIndexEntries.mockReset();
    storageMocks.readMemoryVectorIndexEntryRows.mockReset();
    storageMocks.replaceMemoryVectorIndexEntries.mockReset();
    storageMocks.upsertMemoryVectorIndexEntries.mockReset();
    storageMocks.readMemoryVectorIndexEntries.mockImplementation(async () => [...storageMocks.entries.values()]);
    storageMocks.readMemoryVectorIndexEntryRows.mockImplementation(async () =>
      [...storageMocks.entries.entries()].map(([key, value]) => ({ key, value }))
    );
    storageMocks.upsertMemoryVectorIndexEntries.mockImplementation(async (args: UpsertMemoryVectorIndexEntriesArgs & {
      staleKeys?: string[];
      entryCount?: number;
      embeddedCount?: number;
    }) => {
      args.staleKeys?.forEach((key) => {
        storageMocks.entries.delete(key);
      });
      if (args.allSourceChunkIds) {
        const expectedSourceChunkIds = new Set(args.allSourceChunkIds);
        Array.from(storageMocks.entries.keys()).forEach((sourceChunkId) => {
          if (!expectedSourceChunkIds.has(sourceChunkId)) {
            storageMocks.entries.delete(sourceChunkId);
          }
        });
      }
      args.preparedChunks.forEach((preparedChunk) => {
        storageMocks.entries.set(preparedChunk.sourceChunkId, {
          version: 1,
          collaboratorId: args.collaboratorId,
          sourceChunkId: preparedChunk.sourceChunkId,
          kind: preparedChunk.kind,
          conversationId: preparedChunk.conversationId,
          conversationTitle: preparedChunk.conversationTitle,
          sourceMessageIds: preparedChunk.sourceMessageIds,
          sourceRefs: preparedChunk.sourceRefs,
          title: preparedChunk.title,
          keywords: preparedChunk.keywords,
          summary: preparedChunk.summary,
          semanticText: preparedChunk.semanticText,
          sourceCharCount: preparedChunk.sourceCharCount,
          generator: preparedChunk.generator,
          generatedAt: preparedChunk.generatedAt,
          createdAt: preparedChunk.createdAt,
          updatedAt: preparedChunk.updatedAt,
          ...(args.embeddingsBySourceChunkId?.get(preparedChunk.sourceChunkId)
            ? { embedding: args.embeddingsBySourceChunkId.get(preparedChunk.sourceChunkId) }
            : {})
        });
      });
      return metadataFor({
        collaboratorId: args.collaboratorId,
        model: args.model,
        entryCount: args.allSourceChunkIds?.length ?? args.entryCount ?? storageMocks.entries.size,
        now: args.now
      });
    });
    storageMocks.replaceMemoryVectorIndexEntries.mockImplementation(async (args) => ({
      version: 1,
      schemaVersion: 1,
      collaboratorId: args.collaboratorId,
      model: args.model,
      entryCount: args.preparedChunks.length,
      embeddedCount: args.embeddingsBySourceChunkId?.size ?? 0,
      updatedAt: args.now
    }));
  });

  it('embeds raw local chunks without calling the organizer model when small-model preparation is disabled', async () => {
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>();
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.inputs).toEqual(['对话 c1\n需要整理的旧对话。']);
      return [[0.1, 0.2, 0.3]];
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [conversation({ id: 'c1', collaboratorId: 'aa', content: '需要整理的旧对话。', timestamp: 1 })],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 123
    });

    expect(result.status).toBe('completed');
    expect(result.preparedChunkCount).toBe(1);
    expect(result.embeddedChunkCount).toBe(1);
    expect(result.providerId).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(requestReply).not.toHaveBeenCalled();
    expect(requestEmbeddings).toHaveBeenCalledTimes(1);
    expect(storageMocks.upsertMemoryVectorIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      preparedChunks: [
        expect.objectContaining({
          generator: 'raw_source',
          sourceMessageIds: ['c1-user'],
          semanticText: '对话 c1\n需要整理的旧对话。'
        })
      ]
    }));
  });

  it('prepares chunks in async batches, yields between work, and stores source-backed rows', async () => {
    const progress: Array<[number, number]> = [];
    const yieldToForeground = vi.fn(async () => undefined);
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.api.id).toBe('embed-provider');
      expect(params.model).toBe('embed-model');
      expect(params.dimensions).toBe(1536);
      return params.inputs.map((_, index) => [1, index, 0]);
    });
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async (params) => {
      const prompt = params.context.segments.flatMap((segment) => segment.messages.map((message) => message.content)).join('\n');
      const chunkIds = Array.from(prompt.matchAll(/chunkId: ([^\n]+)/g)).map((match) => match[1]);
      expect(prompt).not.toContain('其他协作者不该进来');
      return {
        content: JSON.stringify({
          chunks: chunkIds.map((chunkId) => ({
            chunkId,
            title: '语义索引块',
            keywords: ['记忆', '索引'],
            summary: '整理后的摘要。',
            semanticText: '整理后的语义文本。'
          }))
        })
      };
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '第一条需要整理的旧对话。', timestamp: 1 }),
        conversation({ id: 'c2', collaboratorId: 'aa', content: '第二条需要整理的旧对话。', timestamp: 2 }),
        conversation({ id: 'c3', collaboratorId: 'other', content: '其他协作者不该进来。', timestamp: 3 })
      ],
      settings: {
        enabled: true,
        providerId: 'small-provider',
        modelOverride: 'semantic-small',
        targetSourceChars: 1
      },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider',
        model: 'chat-model-that-should-not-be-used'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 1234,
      yieldToForeground,
      onProgress: ({ processedChunkCount, totalChunkCount }) => {
        progress.push([processedChunkCount, totalChunkCount]);
      }
    });

    expect(result).toMatchObject({
      status: 'completed',
      providerId: 'small-provider',
      model: 'semantic-small',
      totalChunkCount: 2,
      preparedChunkCount: 2,
      embeddedChunkCount: 2,
      generatedAt: 1234
    });
    expect(requestReply).toHaveBeenCalledTimes(2);
    expect(requestEmbeddings).toHaveBeenCalledTimes(2);
    expect(storageMocks.readMemoryVectorIndexEntryRows).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2]
    ]);
    expect(Array.from(storageMocks.entries.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceMessageIds: ['c1-user'],
        semanticText: '整理后的语义文本。'
      }),
      expect.objectContaining({
        sourceMessageIds: ['c2-user'],
        semanticText: '整理后的语义文本。'
      })
    ]));
    expect(Array.from(storageMocks.entries.values()).every((entry) => Boolean(entry.embedding))).toBe(true);
    expect(Array.from(storageMocks.entries.values())[0]?.embedding)
      .toEqual(expect.objectContaining({
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536,
        embeddedAt: 1234
      }));
  });

  it('resumes from existing embeddings and only prepares missing chunks', async () => {
    const conversations = [
      conversation({ id: 'c1', collaboratorId: 'aa', content: '已经完成的旧片段。', timestamp: 1 }),
      conversation({ id: 'c2', collaboratorId: 'aa', content: '还没有向量的旧片段。', timestamp: 2 })
    ];
    const sourceChunks = buildConversationSemanticChunks({
      conversations,
      currentCollaboratorId: 'aa'
    });
    const completedChunk = sourceChunks.find((chunk) => chunk.exactText.includes('已经完成的旧片段'));
    if (!completedChunk) throw new Error('Expected source chunk.');
    storageMocks.entries.set(completedChunk.id, {
      version: 1,
      collaboratorId: 'aa',
      sourceChunkId: completedChunk.id,
      kind: completedChunk.kind,
      conversationId: completedChunk.conversationId,
      conversationTitle: completedChunk.conversationTitle,
      sourceMessageIds: completedChunk.sourceMessageIds,
      sourceRefs: completedChunk.sourceRefs,
      title: completedChunk.title,
      keywords: completedChunk.keywords,
      summary: completedChunk.semanticText,
      semanticText: completedChunk.semanticText,
      sourceCharCount: completedChunk.exactText.length,
      generator: 'raw_source',
      generatedAt: 1,
      createdAt: completedChunk.createdAt,
      updatedAt: completedChunk.updatedAt,
      embedding: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536,
        vector: [9, 9, 9],
        embeddedAt: 1
      }
    });
    const progress: Array<[number, number]> = [];
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async (params) => {
      const prompt = params.context.segments.flatMap((segment) => segment.messages.map((message) => message.content)).join('\n');
      expect(prompt).not.toContain('已经完成的旧片段');
      const chunkId = prompt.match(/chunkId: ([^\n]+)/)?.[1] ?? '';
      return {
        content: JSON.stringify({
          chunks: [{
            chunkId,
            title: '续跑片段',
            keywords: ['续跑'],
            summary: '只补缺失的片段。',
            semanticText: '向量索引续跑时只处理没有 embedding 的片段。'
          }]
        })
      };
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.inputs).toEqual(['向量索引续跑时只处理没有 embedding 的片段。']);
      return [[0.1, 0.2, 0.3]];
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations,
      settings: {
        enabled: true,
        providerId: 'small-provider',
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000
      },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 999,
      onProgress: ({ processedChunkCount, totalChunkCount }) => {
        progress.push([processedChunkCount, totalChunkCount]);
      }
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 2,
      preparedChunkCount: 2,
      embeddedChunkCount: 2
    });
    expect(progress[0]).toEqual([1, 2]);
    expect(requestReply).toHaveBeenCalledTimes(1);
    expect(requestEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('falls back to raw chunks when the organizer model returns malformed JSON', async () => {
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async () => ({
      content: '{"chunks":[{"chunkId":"broken","summary":'
    }));
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.inputs).toEqual(['对话 c1\n这批小模型输出坏 JSON 时也要继续写向量。']);
      return [[0.5, 0.4, 0.3]];
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({
          id: 'c1',
          collaboratorId: 'aa',
          content: '这批小模型输出坏 JSON 时也要继续写向量。',
          timestamp: 1
        })
      ],
      settings: {
        enabled: true,
        providerId: 'small-provider',
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000
      },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 4321
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 1,
      preparedChunkCount: 1,
      embeddedChunkCount: 1
    });
    expect(storageMocks.upsertMemoryVectorIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      preparedChunks: [
        expect.objectContaining({
          generator: 'raw_source',
          semanticText: '对话 c1\n这批小模型输出坏 JSON 时也要继续写向量。'
        })
      ]
    }));
  });

  it('falls back to raw chunks for the rest of the run when the organizer model request fails', async () => {
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async () => {
      throw new Error('流式响应超时，请重试。');
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      return params.inputs.map((_, index) => [0.7, 0.8, index]);
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({
          id: 'c1',
          collaboratorId: 'aa',
          content: '整理模型超时时也要继续写向量。',
          timestamp: 1
        }),
        conversation({
          id: 'c2',
          collaboratorId: 'aa',
          content: '同一轮后续片段不应该继续等整理模型。',
          timestamp: 2
        })
      ],
      settings: {
        enabled: true,
        providerId: 'small-provider',
        modelOverride: 'semantic-small',
        targetSourceChars: 1
      },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 5432
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 2,
      preparedChunkCount: 2,
      embeddedChunkCount: 2
    });
    expect(requestReply).toHaveBeenCalledTimes(1);
    expect(requestEmbeddings).toHaveBeenCalledTimes(2);
    expect(storageMocks.upsertMemoryVectorIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      preparedChunks: [
        expect.objectContaining({
          generator: 'raw_source',
          semanticText: '对话 c1\n整理模型超时时也要继续写向量。'
        })
      ]
    }));
    expect(storageMocks.upsertMemoryVectorIndexEntries).toHaveBeenCalledWith(expect.objectContaining({
      preparedChunks: [
        expect.objectContaining({
          generator: 'raw_source',
          semanticText: '对话 c2\n同一轮后续片段不应该继续等整理模型。'
        })
      ]
    }));
  });

  it('does not send oversized prepared semantic text to the embeddings API', async () => {
    const content = '需要被安全切开的旧对话。'.repeat(1300);
    const requestReply = vi.fn<MemoryVectorIndexPreparationRequestReply>(async (params) => {
      const prompt = params.context.segments.flatMap((segment) => segment.messages.map((message) => message.content)).join('\n');
      const chunkId = prompt.match(/chunkId: ([^\n]+)/)?.[1] ?? '';
      return {
        content: JSON.stringify({
          chunks: [{
            chunkId,
            title: '过长整理结果',
            keywords: ['索引'],
            summary: '整理模型不该把 semanticText 扩到超过 embedding 上限。',
            semanticText: '过长 semanticText。'.repeat(1200)
          }]
        })
      };
    });
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      expect(params.inputs.length).toBeGreaterThan(0);
      expect(params.inputs.every((input) => input.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS)).toBe(true);
      expect(params.inputs.some((input) => input.includes('过长 semanticText'))).toBe(false);
      return params.inputs.map((_, index) => [0.1, index, 0.3]);
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({
          id: 'long',
          collaboratorId: 'aa',
          content,
          timestamp: 1
        })
      ],
      settings: {
        enabled: true,
        providerId: 'small-provider',
        modelOverride: 'semantic-small',
        targetSourceChars: 50_000
      },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestReply,
      requestEmbeddings,
      now: 6789
    });

    expect(result.status).toBe('completed');
    expect(result.embeddedChunkCount).toBe(result.totalChunkCount);
    expect(Array.from(storageMocks.entries.values()).every((entry) =>
      entry.semanticText.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS
    )).toBe(true);
  });

  it('skips only the embedding input that still exceeds provider limits after single-item retry', async () => {
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      if (params.inputs.length > 1) {
        throw new Error('embedding API 400: Range of input length should be less than 8192');
      }
      if (params.inputs[0]?.includes('第二条')) {
        throw new Error('embedding API 400: Range of input length should be less than 8192');
      }
      return [[0.1, 0.2, 0.3]];
    });
    const progress: Array<[number, number]> = [];

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '第一条可以写入向量。', timestamp: 1 }),
        conversation({ id: 'c2', collaboratorId: 'aa', content: '第二条会被供应商判定过长。', timestamp: 2 })
      ],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestEmbeddings,
      now: 7890,
      onProgress: ({ processedChunkCount, totalChunkCount }) => {
        progress.push([processedChunkCount, totalChunkCount]);
      }
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 2,
      preparedChunkCount: 2,
      embeddedChunkCount: 1
    });
    expect(requestEmbeddings).toHaveBeenCalledTimes(3);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
    const entries = Array.from(storageMocks.entries.values());
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry) => Boolean(entry.embedding))).toHaveLength(1);
    expect(entries.find((entry) => entry.semanticText.includes('第二条'))?.embedding).toBeUndefined();
  });

  it('retries embedding batches as single inputs when the provider rejects batch size', async () => {
    const conversations = Array.from({ length: 3 }, (_, index) => conversation({
      id: `c${index + 1}`,
      collaboratorId: 'aa',
      content: `第 ${index + 1} 条要写进向量的旧对话。`,
      timestamp: index + 1
    }));
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      if (params.inputs.length > 1) {
        throw new Error('embedding API 400: batch size is invalid, it should not be larger than 1.: input.contents');
      }
      return [[0.1, params.inputs[0]?.length ?? 0, 0.3]];
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations,
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestEmbeddings,
      now: 8010
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 3,
      preparedChunkCount: 3,
      embeddedChunkCount: 3
    });
    expect(requestEmbeddings).toHaveBeenCalledTimes(4);
    expect(requestEmbeddings.mock.calls[0]?.[0].inputs).toHaveLength(3);
    const retryInputs = requestEmbeddings.mock.calls.slice(1).flatMap((call) => call[0].inputs);
    expect(retryInputs).toHaveLength(3);
    expect(retryInputs).toEqual(expect.arrayContaining([
      expect.stringContaining('第 1 条'),
      expect.stringContaining('第 2 条'),
      expect.stringContaining('第 3 条')
    ]));
  });

  it('still fails the run for non-input embedding API errors', async () => {
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async () => {
      throw new Error('embedding API 401: invalid api key');
    });

    await expect(runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '配置错误不能被跳过。', timestamp: 1 })
      ],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: {
        ...baseProvider,
        id: 'embed-provider'
      },
      vectorModel: {
        providerId: 'embed-provider',
        model: 'embed-model',
        dimensions: 1536
      },
      requestEmbeddings,
      now: 8901
    })).rejects.toThrow('invalid api key');
  });

  it('shrinks the per-input budget after a provider rejects a long input and embeds it truncated', async () => {
    const providerInputCap = 1_000;
    const longContent = '这是一段会超过智谱 embedding-3 单条上限的旧对话。'.repeat(120);
    const sentLengths: number[][] = [];
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      sentLengths.push(params.inputs.map((input) => input.length));
      if (params.inputs.some((input) => input.length > providerInputCap)) {
        throw new MemoryVectorEmbeddingRequestError(400, ZHIPU_PARAMETER_ERROR_BODY);
      }
      return params.inputs.map(() => [0.1, 0.2, 0.3]);
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '短的一条，直接能过。', timestamp: 1 }),
        conversation({ id: 'c2', collaboratorId: 'aa', content: longContent, timestamp: 2 })
      ],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: { ...baseProvider, id: 'embed-provider' },
      vectorModel: { providerId: 'embed-provider', model: 'embedding-3', dimensions: null },
      requestEmbeddings,
      now: 9100
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 2,
      embeddedChunkCount: 2,
      skippedChunkCount: 0,
      skipReason: null
    });
    // batch → short alone → long input shrinks by the ratio each retry until the provider accepts it
    expect(sentLengths[0]).toHaveLength(2);
    const longAttempts = sentLengths.slice(1).flat().filter((length) => length > 20);
    expect(longAttempts.length).toBeGreaterThanOrEqual(3);
    expect(longAttempts[0]).toBeGreaterThan(providerInputCap);
    longAttempts.slice(1).forEach((length, index) => {
      expect(length).toBeLessThan(longAttempts[index]!);
      expect(length).toBeGreaterThanOrEqual(800);
    });
    expect(longAttempts[longAttempts.length - 1]).toBeLessThanOrEqual(providerInputCap);
    const entries = Array.from(storageMocks.entries.values());
    expect(entries.filter((entry) => Boolean(entry.embedding))).toHaveLength(2);
  });

  it('skips an input the provider keeps rejecting at the minimum budget and reports it without failing the run', async () => {
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async (params) => {
      if (params.inputs.some((input) => input.includes('被拒'))) {
        throw new MemoryVectorEmbeddingRequestError(400, ZHIPU_PARAMETER_ERROR_BODY);
      }
      return params.inputs.map(() => [0.1, 0.2, 0.3]);
    });

    const result = await runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '正常的一条。', timestamp: 1 }),
        conversation({ id: 'c2', collaboratorId: 'aa', content: '这一条总是被拒。', timestamp: 2 }),
        conversation({ id: 'c3', collaboratorId: 'aa', content: '后面的一条也要继续。', timestamp: 3 })
      ],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: { ...baseProvider, id: 'embed-provider' },
      vectorModel: { providerId: 'embed-provider', model: 'embedding-3', dimensions: null },
      requestEmbeddings,
      now: 9200
    });

    expect(result).toMatchObject({
      status: 'completed',
      totalChunkCount: 3,
      embeddedChunkCount: 2,
      skippedChunkCount: 1,
      skipReason: '1210 API 调用参数有误，请检查文档。'
    });
    const entries = Array.from(storageMocks.entries.values());
    expect(entries.find((entry) => entry.semanticText.includes('被拒'))?.embedding).toBeUndefined();
    expect(entries.filter((entry) => Boolean(entry.embedding))).toHaveLength(2);
  });

  it('stops the run on route-level embedding failures such as rate limits', async () => {
    const requestEmbeddings = vi.fn<MemoryVectorIndexEmbeddingRequest>(async () => {
      throw new MemoryVectorEmbeddingRequestError(429, '{"error":{"code":"1302","message":"您的请求过于频繁"}}');
    });

    await expect(runMemoryVectorIndexPreparation({
      collaboratorId: 'aa',
      conversations: [
        conversation({ id: 'c1', collaboratorId: 'aa', content: '限流不能被当成输入问题跳过。', timestamp: 1 })
      ],
      settings: { enabled: false },
      providers: [smallProvider],
      globalApi: baseProvider,
      vectorApi: { ...baseProvider, id: 'embed-provider' },
      vectorModel: { providerId: 'embed-provider', model: 'embedding-3', dimensions: null },
      requestEmbeddings,
      now: 9300
    })).rejects.toThrow('embedding API 429');
    expect(requestEmbeddings).toHaveBeenCalledTimes(1);
  });
});
