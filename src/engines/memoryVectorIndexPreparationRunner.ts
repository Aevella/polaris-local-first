import type { AssistantReply, RequestAssistantReplyParams } from './chat-api/chatApiTypes';
import { requestAssistantReply } from './chatApi';
import {
  classifyMemoryVectorEmbeddingError,
  requestMemoryVectorEmbeddings,
  type MemoryVectorEmbeddingRequest
} from './memoryVectorEmbeddingClient';
import {
  buildMemorySemanticPreparationRequestContext,
  normalizeMemorySemanticPreparations,
  parseMemorySemanticPreparationModelOutput,
  prepareRawMemorySemanticChunks,
  type MemorySemanticPreparedChunk
} from './memorySemanticPreparation';
import {
  buildConversationSemanticChunks,
  type MemoryRetrievalChunk,
  type MemoryRetrievalConversation
} from './memoryRetrievalIndex';
import {
  isMemoryVectorIndexEntry,
  memoryVectorIndexEntryHasEmbeddingForModel,
  readMemoryVectorIndexEntryRows,
  writeMemoryVectorIndexEntryBatch,
  type MemoryVectorIndexEntry,
  type MemoryVectorIndexEmbedding,
  type MemoryVectorIndexMetadata,
  type MemoryVectorIndexModelIdentity
} from './memoryVectorIndexStorage';
import type { ConversationSummaryModelSettings, ProviderProfile } from '../types/domain';

export type MemoryVectorIndexPreparationRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<AssistantReply>;

export type MemoryVectorIndexEmbeddingRequest = (
  params: MemoryVectorEmbeddingRequest
) => Promise<number[][]>;

export type MemoryVectorIndexPreparationStatus =
  | 'disabled'
  | 'empty'
  | 'completed';

export type MemoryVectorIndexPreparationProgress = {
  processedChunkCount: number;
  totalChunkCount: number;
};

export type MemoryVectorIndexPreparationResult = {
  status: MemoryVectorIndexPreparationStatus;
  collaboratorId: string;
  providerId?: string;
  model?: string;
  totalChunkCount: number;
  preparedChunkCount: number;
  embeddedChunkCount: number;
  /** Chunks the embedding provider kept rejecting in this run; they stay unembedded and are retried next run. */
  skippedChunkCount: number;
  /** Provider wording for the last rejection, for the settings surface. */
  skipReason: string | null;
  generatedAt: number;
  metadata: MemoryVectorIndexMetadata | null;
};

export type RunMemoryVectorIndexPreparationParams = {
  collaboratorId: string;
  conversations: MemoryRetrievalConversation[];
  settings: ConversationSummaryModelSettings;
  providers: ProviderProfile[];
  globalApi: ProviderProfile;
  vectorApi: ProviderProfile | null;
  vectorModel: MemoryVectorIndexModelIdentity | null;
  requestReply?: MemoryVectorIndexPreparationRequestReply;
  requestEmbeddings?: MemoryVectorIndexEmbeddingRequest;
  now?: number;
  signal?: AbortSignal;
  yieldToForeground?: () => Promise<void>;
  onProgress?: (progress: MemoryVectorIndexPreparationProgress) => void | Promise<void>;
};

type SemanticPreparationBatch = {
  sequence: number;
  chunks: ReturnType<typeof buildConversationSemanticChunks>;
};

type EmbeddingRequestBatch = {
  sequence: number;
  chunks: MemorySemanticPreparedChunk[];
};

export const MEMORY_VECTOR_SEMANTIC_PREPARATION_SOURCE_CHARS = 8_000;
export const MEMORY_VECTOR_EMBEDDING_BATCH_TARGET_INPUT_CHARS = 8_000;
export const MEMORY_VECTOR_EMBEDDING_BATCH_MAX_INPUTS = 10;
export const MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS = 7_200;
export const MEMORY_VECTOR_EMBEDDING_INPUT_MIN_CHARS = 800;
export const MEMORY_VECTOR_EMBEDDING_INPUT_SHRINK_RATIO = 0.6;

function resolvePreparationProvider(args: {
  providers: ProviderProfile[];
  globalApi: ProviderProfile;
  settings: ConversationSummaryModelSettings;
}) {
  const providerId = args.settings.providerId?.trim();
  const selected = providerId
    ? args.providers.find((provider) => provider.id === providerId) ?? args.globalApi
    : args.globalApi;
  const modelOverride = args.settings.modelOverride?.trim();
  return modelOverride ? { ...selected, model: modelOverride } : selected;
}

function normalizeSourceCharTarget(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 50_000;
  return Math.floor(value);
}

function resolveVectorPreparationSourceTarget(value: number | undefined) {
  const normalized = normalizeSourceCharTarget(value);
  return Math.min(normalized, MEMORY_VECTOR_SEMANTIC_PREPARATION_SOURCE_CHARS);
}

function chunkSourceLength(chunk: ReturnType<typeof buildConversationSemanticChunks>[number]) {
  return Math.max(1, chunk.exactText.length);
}

function embeddingInputLength(chunk: MemorySemanticPreparedChunk) {
  return Math.max(1, chunk.semanticText.length);
}

function embeddingErrorReason(error: unknown) {
  if (error && typeof error === 'object' && 'reason' in error && typeof (error as { reason: unknown }).reason === 'string') {
    return (error as { reason: string }).reason;
  }
  return error instanceof Error ? error.message : String(error);
}

function truncateEmbeddingInput(text: string, budgetChars: number) {
  return text.length <= budgetChars ? text : text.slice(0, budgetChars).trim();
}

/**
 * Shrinks the per-input character budget after a provider rejected an input of
 * `rejectedLength` characters. Returns null when the budget cannot shrink any
 * further, which means the input should be skipped instead of retried.
 */
export function shrinkEmbeddingInputBudget(rejectedLength: number, currentBudget: number) {
  const next = Math.max(
    MEMORY_VECTOR_EMBEDDING_INPUT_MIN_CHARS,
    Math.floor(Math.min(rejectedLength, currentBudget) * MEMORY_VECTOR_EMBEDDING_INPUT_SHRINK_RATIO)
  );
  return next < rejectedLength && next < currentBudget ? next : null;
}

function splitTextForEmbeddingInput(text: string, targetChars = MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS) {
  const normalizedTarget = typeof targetChars === 'number' && Number.isFinite(targetChars) && targetChars > 0
    ? Math.floor(targetChars)
    : MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= normalizedTarget) return trimmed ? [trimmed] : [];

  const parts: string[] = [];
  let offset = 0;

  while (offset < trimmed.length) {
    const hardEnd = Math.min(trimmed.length, offset + normalizedTarget);
    let end = hardEnd;
    if (hardEnd < trimmed.length) {
      const window = trimmed.slice(offset, hardEnd);
      const boundaryIndexes = [
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' ')
      ];
      const bestBoundary = Math.max(...boundaryIndexes);
      if (bestBoundary >= Math.floor(normalizedTarget * 0.55)) {
        end = offset + bestBoundary + 1;
      }
    }

    const part = trimmed.slice(offset, end).trim();
    if (part) parts.push(part);
    offset = end;
  }

  return parts;
}

function buildSemanticTextForVectorPart(chunk: MemoryRetrievalChunk, exactText: string) {
  const withTitle = [chunk.conversationTitle, exactText].filter(Boolean).join('\n');
  return withTitle.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS ? withTitle : exactText;
}

function splitMemoryVectorSourceChunk(chunk: MemoryRetrievalChunk): MemoryRetrievalChunk[] {
  if (chunk.semanticText.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS) return [chunk];

  const exactTextTarget = Math.max(
    1,
    MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS - chunk.conversationTitle.length - 1
  );
  const exactTextParts = splitTextForEmbeddingInput(chunk.exactText, exactTextTarget);
  if (exactTextParts.length <= 1) {
    const exactText = exactTextParts[0] ?? chunk.exactText.slice(0, MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS).trim();
    return [{
      ...chunk,
      exactText,
      semanticText: buildSemanticTextForVectorPart(chunk, exactText)
    }];
  }

  return exactTextParts.map((exactText, index) => ({
    ...chunk,
    id: `${chunk.id}:part-${index + 1}-of-${exactTextParts.length}`,
    title: `${chunk.title} · ${index + 1}/${exactTextParts.length}`,
    exactText,
    semanticText: buildSemanticTextForVectorPart(chunk, exactText)
  }));
}

export function resolveMemoryVectorSourceChunks(chunks: MemoryRetrievalChunk[]) {
  return chunks.flatMap(splitMemoryVectorSourceChunk);
}

export function resolveMemorySemanticPreparationBatches(args: {
  chunks: ReturnType<typeof buildConversationSemanticChunks>;
  targetSourceChars?: number;
}): SemanticPreparationBatch[] {
  const targetSourceChars = normalizeSourceCharTarget(args.targetSourceChars);
  const batches: SemanticPreparationBatch[] = [];
  let currentChunks: ReturnType<typeof buildConversationSemanticChunks> = [];
  let currentSourceChars = 0;

  const flush = () => {
    if (!currentChunks.length) return;
    batches.push({
      sequence: batches.length + 1,
      chunks: currentChunks
    });
    currentChunks = [];
    currentSourceChars = 0;
  };

  for (const chunk of args.chunks) {
    const nextSourceChars = currentSourceChars + chunkSourceLength(chunk);
    if (currentChunks.length > 0 && nextSourceChars > targetSourceChars) {
      flush();
    }
    currentChunks.push(chunk);
    currentSourceChars += chunkSourceLength(chunk);
  }

  flush();
  return batches;
}

export function resolveMemoryVectorEmbeddingBatches(args: {
  chunks: MemorySemanticPreparedChunk[];
  targetInputChars?: number;
  maxInputs?: number;
}): EmbeddingRequestBatch[] {
  const targetInputChars = typeof args.targetInputChars === 'number'
    && Number.isFinite(args.targetInputChars)
    && args.targetInputChars > 0
    ? Math.floor(args.targetInputChars)
    : MEMORY_VECTOR_EMBEDDING_BATCH_TARGET_INPUT_CHARS;
  const maxInputs = typeof args.maxInputs === 'number'
    && Number.isFinite(args.maxInputs)
    && args.maxInputs > 0
    ? Math.floor(args.maxInputs)
    : MEMORY_VECTOR_EMBEDDING_BATCH_MAX_INPUTS;
  const batches: EmbeddingRequestBatch[] = [];
  let currentChunks: MemorySemanticPreparedChunk[] = [];
  let currentInputChars = 0;

  const flush = () => {
    if (!currentChunks.length) return;
    batches.push({
      sequence: batches.length + 1,
      chunks: currentChunks
    });
    currentChunks = [];
    currentInputChars = 0;
  };

  for (const chunk of args.chunks) {
    const nextInputChars = currentInputChars + embeddingInputLength(chunk);
    if (
      currentChunks.length > 0
      && (currentChunks.length >= maxInputs || nextInputChars > targetInputChars)
    ) {
      flush();
    }
    currentChunks.push(chunk);
    currentInputChars += embeddingInputLength(chunk);
  }

  flush();
  return batches;
}

async function defaultYieldToForeground() {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('向量索引整理已取消。');
  }
}

function prepareFallbackRawBatch(args: {
  chunks: SemanticPreparationBatch['chunks'];
  now: number;
}) {
  return prepareRawMemorySemanticChunks({
    chunks: args.chunks,
    now: args.now
  });
}

function constrainPreparedChunksForEmbedding(args: {
  preparedChunks: MemorySemanticPreparedChunk[];
  sourceChunks: SemanticPreparationBatch['chunks'];
  now: number;
}) {
  const rawChunksBySourceChunkId = new Map(
    prepareFallbackRawBatch({ chunks: args.sourceChunks, now: args.now })
      .map((chunk) => [chunk.sourceChunkId, chunk])
  );

  return args.preparedChunks.map((chunk) => {
    if (chunk.semanticText.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS) return chunk;
    const rawChunk = rawChunksBySourceChunkId.get(chunk.sourceChunkId);
    if (rawChunk && rawChunk.semanticText.length <= MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS) {
      return rawChunk;
    }
    return {
      ...chunk,
      summary: chunk.summary.slice(0, MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS).trim(),
      semanticText: chunk.semanticText.slice(0, MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS).trim()
    };
  });
}

function storedEntryToPreparedChunk(entry: MemoryVectorIndexEntry): MemorySemanticPreparedChunk {
  return {
    id: `memory-semantic-preparation:${entry.sourceChunkId}`,
    sourceChunkId: entry.sourceChunkId,
    kind: entry.kind,
    collaboratorId: entry.collaboratorId,
    conversationId: entry.conversationId,
    conversationTitle: entry.conversationTitle,
    sourceMessageIds: entry.sourceMessageIds,
    sourceRefs: entry.sourceRefs,
    title: entry.title,
    keywords: entry.keywords,
    summary: entry.summary,
    semanticText: entry.semanticText,
    sourceCharCount: entry.sourceCharCount,
    generator: entry.generator,
    generatedAt: entry.generatedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

export async function runMemoryVectorIndexPreparation(
  params: RunMemoryVectorIndexPreparationParams
): Promise<MemoryVectorIndexPreparationResult> {
  const now = params.now ?? Date.now();
  const yieldToForeground = params.yieldToForeground ?? defaultYieldToForeground;

  const chunks = resolveMemoryVectorSourceChunks(
    buildConversationSemanticChunks({
      conversations: params.conversations,
      currentCollaboratorId: params.collaboratorId
    })
  );
  const totalChunkCount = chunks.length;

  if (!chunks.length) {
    await params.onProgress?.({ processedChunkCount: 0, totalChunkCount });
    await yieldToForeground();
    return {
      status: 'empty',
      collaboratorId: params.collaboratorId,
      totalChunkCount,
      preparedChunkCount: 0,
      embeddedChunkCount: 0,
      skippedChunkCount: 0,
      skipReason: null,
      generatedAt: now,
      metadata: null
    };
  }

  const organizerApi = params.settings.enabled === true
    ? resolvePreparationProvider({
        providers: params.providers,
        globalApi: params.globalApi,
        settings: params.settings
      })
    : null;
  const requestReply = params.requestReply ?? requestAssistantReply;
  const requestEmbeddings = params.requestEmbeddings ?? requestMemoryVectorEmbeddings;
  const allSourceChunkIds = chunks.map((chunk) => chunk.id);
  const sourceChunkIdSet = new Set(allSourceChunkIds);
  const existingRows = await readMemoryVectorIndexEntryRows(params.collaboratorId);
  const staleEntryKeys: string[] = [];
  const existingEntries = existingRows.flatMap((row) => {
    if (isMemoryVectorIndexEntry(row.value) && sourceChunkIdSet.has(row.value.sourceChunkId)) {
      return [row.value];
    }
    staleEntryKeys.push(row.key);
    return [];
  });
  const existingEntriesBySourceChunkId = new Map(
    existingEntries
      .filter((entry) => sourceChunkIdSet.has(entry.sourceChunkId))
      .map((entry) => [entry.sourceChunkId, entry])
  );
  const completedSourceChunkIds = new Set(
    existingEntries
      .filter((entry) =>
        sourceChunkIdSet.has(entry.sourceChunkId)
        && memoryVectorIndexEntryHasEmbeddingForModel(entry, params.vectorModel)
      )
      .map((entry) => entry.sourceChunkId)
  );
  const processedSourceChunkIds = new Set(completedSourceChunkIds);
  let processedChunkCount = processedSourceChunkIds.size;
  await params.onProgress?.({ processedChunkCount, totalChunkCount });
  await yieldToForeground();

  const pendingPreparedChunks = Array.from(existingEntriesBySourceChunkId.values())
    .filter((entry) => !completedSourceChunkIds.has(entry.sourceChunkId))
    .map(storedEntryToPreparedChunk);
  const pendingPreparedSourceChunkIds = new Set(pendingPreparedChunks.map((chunk) => chunk.sourceChunkId));
  const chunksNeedingPreparation = chunks.filter((chunk) =>
    !completedSourceChunkIds.has(chunk.id)
    && !pendingPreparedSourceChunkIds.has(chunk.id)
  );
  const batches = resolveMemorySemanticPreparationBatches({
    chunks: chunksNeedingPreparation,
    targetSourceChars: resolveVectorPreparationSourceTarget(params.settings.targetSourceChars)
  });

  const persistPreparedChunks = async (nextPreparedChunks: MemorySemanticPreparedChunk[]) => {
    if (!nextPreparedChunks.length) return null;
    return await writeMemoryVectorIndexEntryBatch({
      collaboratorId: params.collaboratorId,
      preparedChunks: nextPreparedChunks,
      model: params.vectorModel,
      entryCount: allSourceChunkIds.length,
      embeddedCount: completedSourceChunkIds.size,
      now
    });
  };

  // Per-run character budget for one embedding input. It starts at the shared
  // target and shrinks the first time a provider rejects an input, so later
  // chunks stop hitting the same wall instead of failing one by one.
  let embeddingInputBudget = MEMORY_VECTOR_EMBEDDING_INPUT_TARGET_CHARS;
  const skippedSourceChunkIds = new Set<string>();
  let lastSkipReason: string | null = null;

  const embedPreparedChunks = async (nextPreparedChunks: MemorySemanticPreparedChunk[]) => {
    const vectorApi = params.vectorApi;
    const vectorModel = params.vectorModel;
    if (!vectorApi || !vectorModel || !nextPreparedChunks.length) return null;

    let latestMetadata: MemoryVectorIndexMetadata | null = null;
    const requestEmbeddingBatch = async (chunks: MemorySemanticPreparedChunk[]) => {
      const vectors = await requestEmbeddings({
        api: vectorApi,
        model: vectorModel.model,
        dimensions: vectorModel.dimensions,
        inputs: chunks.map((chunk) => truncateEmbeddingInput(chunk.semanticText, embeddingInputBudget)),
        signal: params.signal
      });
      const embeddingsBySourceChunkId = new Map<string, MemoryVectorIndexEmbedding>();
      chunks.forEach((chunk, index) => {
        const vector = vectors[index];
        if (!vector) return;
        embeddingsBySourceChunkId.set(chunk.sourceChunkId, {
          ...vectorModel,
          vector,
          embeddedAt: now
        });
      });
      return embeddingsBySourceChunkId;
    };
    const rethrowUnlessRecoverable = (error: unknown) => {
      const kind = classifyMemoryVectorEmbeddingError(error);
      if (kind === 'aborted' || kind === 'route') throw error;
      return kind;
    };
    const embedSingleChunk = async (chunk: MemorySemanticPreparedChunk) => {
      // Retry with a shrinking budget until the provider accepts the input or
      // the budget cannot shrink any further; only then give up on this chunk.
      for (;;) {
        assertNotAborted(params.signal);
        try {
          return await requestEmbeddingBatch([chunk]);
        } catch (error) {
          rethrowUnlessRecoverable(error);
          const sentLength = truncateEmbeddingInput(chunk.semanticText, embeddingInputBudget).length;
          const nextBudget = shrinkEmbeddingInputBudget(sentLength, embeddingInputBudget);
          if (nextBudget === null) {
            skippedSourceChunkIds.add(chunk.sourceChunkId);
            lastSkipReason = embeddingErrorReason(error);
            return new Map<string, MemoryVectorIndexEmbedding>();
          }
          embeddingInputBudget = nextBudget;
        }
      }
    };
    const embeddingBatches = resolveMemoryVectorEmbeddingBatches({
      chunks: nextPreparedChunks.filter((chunk) => chunk.semanticText.trim().length > 0)
    });
    const emptyChunks = nextPreparedChunks.filter((chunk) => chunk.semanticText.trim().length === 0);
    emptyChunks.forEach((chunk) => processedSourceChunkIds.add(chunk.sourceChunkId));
    for (const embeddingBatch of embeddingBatches) {
      assertNotAborted(params.signal);
      await yieldToForeground();
      let batchEmbeddingsBySourceChunkId: Map<string, MemoryVectorIndexEmbedding>;
      try {
        batchEmbeddingsBySourceChunkId = await requestEmbeddingBatch(embeddingBatch.chunks);
      } catch (error) {
        rethrowUnlessRecoverable(error);
        batchEmbeddingsBySourceChunkId = new Map();
        for (const chunk of embeddingBatch.chunks) {
          const chunkEmbedding = await embedSingleChunk(chunk);
          chunkEmbedding.forEach((embedding, sourceChunkId) => {
            batchEmbeddingsBySourceChunkId.set(sourceChunkId, embedding);
          });
        }
      }
      embeddingBatch.chunks.forEach((chunk) => {
        processedSourceChunkIds.add(chunk.sourceChunkId);
        if (batchEmbeddingsBySourceChunkId.has(chunk.sourceChunkId)) {
          completedSourceChunkIds.add(chunk.sourceChunkId);
        }
      });
      latestMetadata = await writeMemoryVectorIndexEntryBatch({
        collaboratorId: params.collaboratorId,
        preparedChunks: embeddingBatch.chunks,
        model: vectorModel,
        embeddingsBySourceChunkId: batchEmbeddingsBySourceChunkId,
        entryCount: allSourceChunkIds.length,
        embeddedCount: completedSourceChunkIds.size,
        now
      });
      processedChunkCount = processedSourceChunkIds.size;
      await params.onProgress?.({ processedChunkCount, totalChunkCount });
      await yieldToForeground();
    }
    return latestMetadata;
  };

  let latestMetadata = await writeMemoryVectorIndexEntryBatch({
    collaboratorId: params.collaboratorId,
    preparedChunks: [],
    model: params.vectorModel,
    staleKeys: staleEntryKeys,
    entryCount: allSourceChunkIds.length,
    embeddedCount: completedSourceChunkIds.size,
    now
  });

  if (pendingPreparedChunks.length) {
    latestMetadata = await embedPreparedChunks(pendingPreparedChunks) ?? latestMetadata;
  }

  let organizerFailedForRun = false;
  for (const batch of batches) {
    assertNotAborted(params.signal);
    await yieldToForeground();

    let preparedBatch: MemorySemanticPreparedChunk[];
    if (organizerApi && !organizerFailedForRun) {
      try {
        const reply = await requestReply({
          api: organizerApi,
          context: buildMemorySemanticPreparationRequestContext(batch.chunks),
          advanced: {
            providerId: organizerApi.id,
            modelOverride: organizerApi.model,
            temperature: '0.2',
            topP: '',
            maxTokens: '',
            thinkingBudget: '',
            contextMessageLimit: '',
            showThinking: false,
            streaming: false,
            customHeaders: '',
            customBody: '',
            regexRules: '',
            regexTriggers: '',
            snippets: []
          },
          signal: params.signal
        });
        preparedBatch = normalizeMemorySemanticPreparations({
          rawPreparations: parseMemorySemanticPreparationModelOutput(reply.content),
          chunks: batch.chunks,
          now
        });
        if (preparedBatch.length === 0) {
          preparedBatch = prepareFallbackRawBatch({ chunks: batch.chunks, now });
        }
      } catch (error) {
        if (params.signal?.aborted) {
          throw error;
        }
        organizerFailedForRun = true;
        preparedBatch = prepareFallbackRawBatch({ chunks: batch.chunks, now });
      }
    } else {
      preparedBatch = prepareFallbackRawBatch({ chunks: batch.chunks, now });
    }
    preparedBatch = constrainPreparedChunksForEmbedding({
      preparedChunks: preparedBatch,
      sourceChunks: batch.chunks,
      now
    });
    latestMetadata = await persistPreparedChunks(preparedBatch) ?? latestMetadata;
    if (params.vectorApi && params.vectorModel) {
      latestMetadata = await embedPreparedChunks(preparedBatch) ?? latestMetadata;
    } else {
      processedChunkCount += batch.chunks.length;
      batch.chunks.forEach((chunk) => {
        processedSourceChunkIds.add(chunk.id);
      });
      await params.onProgress?.({ processedChunkCount, totalChunkCount });
    }
    if (processedChunkCount > totalChunkCount) {
      processedChunkCount = totalChunkCount;
      await params.onProgress?.({ processedChunkCount, totalChunkCount });
    }
  }

  await yieldToForeground();
  const metadata: MemoryVectorIndexMetadata = {
    ...latestMetadata,
    entryCount: totalChunkCount,
    embeddedCount: latestMetadata.embeddedCount,
    updatedAt: now
  };

  return {
    status: 'completed',
    collaboratorId: params.collaboratorId,
    providerId: organizerApi?.id,
    model: organizerApi?.model,
    totalChunkCount,
    preparedChunkCount: metadata.entryCount,
    embeddedChunkCount: metadata.embeddedCount,
    skippedChunkCount: skippedSourceChunkIds.size,
    skipReason: lastSkipReason,
    generatedAt: now,
    metadata
  };
}
