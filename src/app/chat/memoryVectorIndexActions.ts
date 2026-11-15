import {
  runMemoryVectorIndexPreparation,
  type MemoryVectorIndexEmbeddingRequest,
  type MemoryVectorIndexPreparationRequestReply,
  type MemoryVectorIndexPreparationResult
} from '../../engines/memoryVectorIndexPreparationRunner';
import { requestMemoryVectorEmbeddings } from '../../engines/memoryVectorEmbeddingClient';
import {
  clearMemoryVectorIndexForCollaborator
} from '../../engines/memoryVectorIndexStorage';
import {
  resolveMemoryVectorIndexRuntimeModel,
  selectMemoryVectorIndexProvider
} from '../../engines/memoryVectorIndexModel';
import { usePersonaStore } from '../../stores/personaStore';
import {
  selectRuntimeApi,
  selectVisibleProviders,
  useRuntimeStore
} from '../../stores/runtimeStore';
import {
  readStableCompleteChatConversationsForDerivedDataWork,
  runDerivedDataWork
} from '../data-work/derivedDataWork';
import type { PersonaVectorIndexSettings } from '../../types/domain';

export type UpdateMemoryVectorIndexOptions = {
  requestReply?: MemoryVectorIndexPreparationRequestReply;
  requestEmbeddings?: MemoryVectorIndexEmbeddingRequest;
  now?: number;
  signal?: AbortSignal;
  yieldToForeground?: () => Promise<void>;
};

export type ClearMemoryVectorIndexOptions = {
  disable?: boolean;
};

export type TestMemoryVectorModelConnectionOptions = {
  requestEmbeddings?: MemoryVectorIndexEmbeddingRequest;
  signal?: AbortSignal;
};

export type TestMemoryVectorModelConnectionResult = {
  providerId: string;
  model: string;
  dimensions: number | null;
  returnedDimensions: number;
};

function formatSkippedChunkNotice(skippedChunkCount: number, skipReason: string | null) {
  if (skippedChunkCount <= 0) return '';
  const reason = skipReason?.trim() ? `：${skipReason.trim()}` : '';
  return `${skippedChunkCount} 条片段被向量模型拒绝，已跳过，下次整理会重试${reason}`;
}

function patchVectorIndexForCollaborator(
  collaboratorId: string,
  patch: Partial<PersonaVectorIndexSettings>
) {
  const personaState = usePersonaStore.getState();
  const latestPersona = personaState.personas.find((item) => item.id === collaboratorId);
  if (!latestPersona) return;

  personaState.updateCollaborator(collaboratorId, {
    memory: {
      vectorIndex: {
        ...(latestPersona.memory.vectorIndex ?? { enabled: false }),
        ...patch
      }
    }
  });
}

export async function clearMemoryVectorIndexForCollaboratorAction(
  collaboratorId: string,
  options: ClearMemoryVectorIndexOptions = {}
) {
  const personaState = usePersonaStore.getState();
  const persona = personaState.personas.find((item) => item.id === collaboratorId);
  if (!persona) return;

  await clearMemoryVectorIndexForCollaborator(collaboratorId);
  patchVectorIndexForCollaborator(collaboratorId, {
    ...(options.disable ? { enabled: false } : {}),
    status: 'idle',
    indexedChunkCount: 0,
    totalChunkCount: 0,
    lastIndexedAt: 0,
    lastError: ''
  });
  await usePersonaStore.getState().persistToDb();
}

export async function testMemoryVectorModelConnection(
  options: TestMemoryVectorModelConnectionOptions = {}
): Promise<TestMemoryVectorModelConnectionResult> {
  const runtime = useRuntimeStore.getState();
  const vectorRetrieval = runtime.memoryVectorRetrieval;
  const vectorSettings = {
    enabled: true,
    baseUrl: vectorRetrieval.baseUrl,
    path: vectorRetrieval.path,
    apiKey: vectorRetrieval.apiKey,
    model: vectorRetrieval.model,
    dimensions: vectorRetrieval.dimensions
  };
  if (!vectorSettings.baseUrl?.trim() || !vectorSettings.model?.trim()) {
    throw new Error('请先填写向量模型的 Base URL 和模型名。');
  }
  if (!vectorSettings.apiKey?.trim()) {
    throw new Error('请先填写向量模型的 API Key。');
  }

  const providers = selectVisibleProviders(runtime);
  const globalApi = selectRuntimeApi(runtime);
  const vectorModel = resolveMemoryVectorIndexRuntimeModel({
    settings: vectorSettings,
    providers,
    globalApi
  });
  const vectorApi = vectorModel
    ? selectMemoryVectorIndexProvider({ settings: vectorSettings, providers, globalApi })
    : null;
  if (!vectorModel || !vectorApi) {
    throw new Error('请先填写完整的向量模型配置。');
  }

  const requestEmbeddings = options.requestEmbeddings ?? requestMemoryVectorEmbeddings;
  const vectors = await requestEmbeddings({
    api: vectorApi,
    model: vectorModel.model,
    dimensions: vectorModel.dimensions,
    inputs: ['Polaris memory vector connection test'],
    signal: options.signal
  });
  const vector = vectors[0];
  if (!vector?.length) {
    throw new Error('embedding 测试没有返回可用向量。');
  }

  return {
    providerId: vectorModel.providerId,
    model: vectorModel.model,
    dimensions: vectorModel.dimensions,
    returnedDimensions: vector.length
  };
}

export async function updateMemoryVectorIndexForCollaborator(
  collaboratorId: string,
  options: UpdateMemoryVectorIndexOptions = {}
): Promise<MemoryVectorIndexPreparationResult> {
  return await runDerivedDataWork({
    id: `memory_vector_index:${collaboratorId}`,
    kind: 'memory_vector_index',
    priority: 'background',
    signal: options.signal,
    yieldToForeground: options.yieldToForeground,
    run: async ({ signal, yieldToForeground }) => {
      return await updateMemoryVectorIndexForCollaboratorNow(collaboratorId, {
        ...options,
        signal,
        yieldToForeground
      });
    }
  });
}

async function updateMemoryVectorIndexForCollaboratorNow(
  collaboratorId: string,
  options: UpdateMemoryVectorIndexOptions = {}
): Promise<MemoryVectorIndexPreparationResult> {
  const runtime = useRuntimeStore.getState();
  const personaState = usePersonaStore.getState();
  const persona = personaState.personas.find((item) => item.id === collaboratorId);

  if (!persona) {
    throw new Error('找不到要整理向量索引的协作者。');
  }

  const vectorIndex = persona.memory.vectorIndex ?? { enabled: false };
  const vectorRetrieval = runtime.memoryVectorRetrieval;
  const vectorSettings = {
    enabled: vectorRetrieval.enabled,
    baseUrl: vectorRetrieval.baseUrl,
    path: vectorRetrieval.path,
    apiKey: vectorRetrieval.apiKey,
    model: vectorRetrieval.model,
    dimensions: vectorRetrieval.dimensions ?? vectorIndex.dimensions
  };
  if (persona.memory.crossConversationRecallEnabled === false || vectorRetrieval.enabled !== true) {
    return {
      status: 'disabled',
      collaboratorId,
      totalChunkCount: 0,
      preparedChunkCount: 0,
      embeddedChunkCount: 0,
      skippedChunkCount: 0,
      skipReason: null,
      generatedAt: options.now ?? Date.now(),
      metadata: null
    };
  }

  const providers = selectVisibleProviders(runtime);
  const globalApi = selectRuntimeApi(runtime);
  const vectorModel = resolveMemoryVectorIndexRuntimeModel({
    settings: vectorSettings,
    providers,
    globalApi
  });
  const vectorApi = vectorModel
    ? selectMemoryVectorIndexProvider({ settings: vectorSettings, providers, globalApi })
    : null;
  if (!vectorModel || !vectorApi) {
    const errorMessage = '请先在记忆设置里配置向量模型。';
    patchVectorIndexForCollaborator(collaboratorId, {
      status: 'failed',
      indexedChunkCount: 0,
      totalChunkCount: 0,
      lastError: errorMessage
    });
    await usePersonaStore.getState().persistToDb();
    throw new Error(errorMessage);
  }

  patchVectorIndexForCollaborator(collaboratorId, {
    status: 'indexing',
    indexedChunkCount: 0,
    totalChunkCount: 0,
    lastError: ''
  });

  try {
    const conversations = await readStableCompleteChatConversationsForDerivedDataWork('memory_vector_index');
    const result = await runMemoryVectorIndexPreparation({
      collaboratorId,
      conversations,
      settings: runtime.conversationSummaryModel,
      providers,
      globalApi,
      vectorApi,
      vectorModel,
      requestReply: options.requestReply,
      requestEmbeddings: options.requestEmbeddings,
      now: options.now,
      signal: options.signal,
      yieldToForeground: options.yieldToForeground,
      onProgress: ({ processedChunkCount, totalChunkCount }) => {
        patchVectorIndexForCollaborator(collaboratorId, {
          status: 'indexing',
          indexedChunkCount: processedChunkCount,
          totalChunkCount,
          lastError: ''
        });
      }
    });

    if (result.status === 'completed') {
      patchVectorIndexForCollaborator(collaboratorId, {
        status: 'idle',
        indexedChunkCount: result.metadata?.embeddedCount ?? result.preparedChunkCount,
        totalChunkCount: result.totalChunkCount,
        lastIndexedAt: result.generatedAt,
        lastError: formatSkippedChunkNotice(result.skippedChunkCount, result.skipReason)
      });
      await usePersonaStore.getState().persistToDb();
    } else if (result.status === 'empty') {
      patchVectorIndexForCollaborator(collaboratorId, {
        status: 'idle',
        indexedChunkCount: 0,
        totalChunkCount: 0,
        lastIndexedAt: result.generatedAt,
        lastError: ''
      });
      await usePersonaStore.getState().persistToDb();
    } else {
      patchVectorIndexForCollaborator(collaboratorId, {
        status: 'idle',
        lastError: '向量索引已暂停。'
      });
      await usePersonaStore.getState().persistToDb();
    }

    return result;
  } catch (error) {
    patchVectorIndexForCollaborator(collaboratorId, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : '向量索引整理失败。'
    });
    await usePersonaStore.getState().persistToDb();
    throw error;
  }
}
