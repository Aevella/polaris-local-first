import { hydrateConversationAssets, omitUnselectedRequestImageBytes, understandConversationImages, type RequestImageUnderstandingResult } from './requestImagePreparation';
import type { ConversationWindowPreferences } from '../../types/domain';
import type { AssistantToolContext } from '../assistantToolProtocol';
import {
  resolveProviderImageUnderstandingSettings,
  type ImageUnderstandingRequestReply
} from '../imageUnderstandingClient';
import { MEMORY_RELEASE_GATES } from '../../config/memoryReleaseGates';
import { createUid } from '../id';
import { buildRequestContextPlan } from './requestContextPlan';
import type { AssistantRequestAudit } from './requestAudit';
import { assembleAssistantContext, type AssistantRequestContext } from './requestContext';
import { resolveRequestCachePlan } from './requestCachePlan';
import { buildRequestContextReceipt } from './requestContextReceipt';
import { resolveRequestBudgetPlan, resolveRequestBudgetUsage, resolveRequestHistoryBudget } from './requestBudget';
import { resolveRequestMemoryPlan } from './requestMemoryPlan';
import {
  DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_CHARS,
  DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_RECENT_TOPICS,
  DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_RELATIONAL_PROFILES,
  DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_TOTAL,
  DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_TOKENS,
  resolveRequestConversationSummaryPlan
} from './requestConversationSummaryPlan';
import {
  DEFAULT_SEMANTIC_RECALL_REQUEST_MAX_CANDIDATES,
  resolveRequestSemanticRecallPlan,
  resolveSemanticRecallConfig,
  resolveSemanticRecallContextCandidates
} from './requestSemanticRecallPlan';
import {
  resolveRequestSemanticVectorCandidates,
  type RequestSemanticVectorEmbeddingClient
} from './requestSemanticVectorRecall';
import { buildAssistantPromptParts } from './requestPromptLayers';
import { selectPromptPartsForBudget } from './requestTruncation';
import { buildTemplateContext } from '../templateEngine';
import { resolvePersonaPromptForRuntimeSpec } from '../promptCompiler';
import {
  resolveProviderCapability,
  resolveCanonicalProviderCapabilities,
  resolveProviderRuntimeContextTokenBudget,
  type CanonicalProviderCapabilitySet
} from '../provider-runtime';
import type {
  ChatMessage,
  Conversation,
  ConversationTaskState,
  ImageUnderstandingSettings,
  MemoryVectorRetrievalSettings,
  Persona,
  ProviderProfile,
  ToolLedgerEntry
} from '../../types/domain';
import { prepareConversationMessages } from './requestConversationPreparation';
import {
  buildRequestAudit,
  buildRequestTooling
} from './requestPreparationAudit';
import type { RequestMessage } from './requestMessage';

const DEFAULT_CONTEXT_MESSAGE_LIMIT = Number.MAX_SAFE_INTEGER;
const UNBOUNDED_CONTEXT_TOKEN_BUDGET = Number.MAX_SAFE_INTEGER;
function parseContextLimit(input: string | undefined): number {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_CONTEXT_MESSAGE_LIMIT;

  const limit = Number(trimmed);
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_CONTEXT_MESSAGE_LIMIT;
  }

  return Math.floor(limit);
}

export function resolvePreparedAdvancedSettings(params: {
  advanced: Persona['advanced'] | undefined;
  toolContext?: AssistantToolContext;
}) {
  return params.advanced;
}

type ProviderRuntimePromptBudget = Pick<
  CanonicalProviderCapabilitySet['budgets'],
  'recommendedPromptTokens' | 'promptBudgetPolicy'
>;

export function resolveContextTokenBudget(providerBudgets: ProviderRuntimePromptBudget): number {
  return resolveProviderRuntimeContextTokenBudget(providerBudgets, UNBOUNDED_CONTEXT_TOKEN_BUDGET);
}

function buildConversationContext(args: {
  messages: ChatMessage[];
  persona: Persona | null | undefined;
  historyMaxTokens: number;
  messageLimit: number;
  historyMode: AssistantRequestAudit['contextPlan']['historyMode'];
}) {
  const conversationBuildStartedAt = runtimeNow();
  const preparedMessages = prepareConversationMessages(args.messages, args.persona);
  const conversationBuildMs = runtimeNow() - conversationBuildStartedAt;
  const contextPlanStartedAt = runtimeNow();
  const { conversation, contextPlan, historyDecision } = buildRequestContextPlan({
    messages: preparedMessages.messages,
    messagesPrepared: preparedMessages.transforms.orderNormalized,
    historyMaxTokens: args.historyMaxTokens,
    messageLimit: args.messageLimit,
    historyMode: args.historyMode
  });

  return {
    conversation,
    contextPlan,
    historyDecision,
    conversationBuildMs,
    contextPlanMs: runtimeNow() - contextPlanStartedAt
  };
}

function runtimeNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function latestUserRecallQuery(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';
}

async function resolveVectorCandidatesForRequest(params: {
  persona: Persona | null | undefined;
  providers?: ProviderProfile[];
  globalApi?: ProviderProfile;
  memoryVectorRetrieval?: MemoryVectorRetrievalSettings;
  messages: ChatMessage[];
  activeConversationId?: string | null;
  catalogConversationIds: string[];
  maxResults: number;
  signal?: AbortSignal;
  requestEmbeddings?: RequestSemanticVectorEmbeddingClient;
}) {
  try {
    return await resolveRequestSemanticVectorCandidates({
      persona: params.persona,
      providers: params.providers,
      globalApi: params.globalApi,
      memoryVectorRetrieval: params.memoryVectorRetrieval,
      queryText: latestUserRecallQuery(params.messages),
      activeConversationId: params.activeConversationId,
      catalogConversationIds: params.catalogConversationIds,
      maxResults: params.maxResults,
      signal: params.signal,
      requestEmbeddings: params.requestEmbeddings
    });
  } catch (error) {
    if (params.signal?.aborted) throw error;
    console.warn('[request] Vector semantic recall skipped.', error);
    return [];
  }
}

function mergeSemanticRecallConversations(
  conversations: Conversation[] | undefined,
  loadedConversations: Conversation[]
) {
  if (!loadedConversations.length) return conversations;
  const loadedById = new Map(loadedConversations.map((conversation) => [conversation.id, conversation]));
  const merged = (conversations ?? []).map((conversation) => loadedById.get(conversation.id) ?? conversation);
  const existingIds = new Set(merged.map((conversation) => conversation.id));
  for (const conversation of loadedConversations) {
    if (!existingIds.has(conversation.id)) merged.push(conversation);
  }
  return merged;
}

async function hydrateSemanticRecallVectorSources(params: {
  conversations: Conversation[] | undefined;
  vectorCandidates: Awaited<ReturnType<typeof resolveVectorCandidatesForRequest>>;
  loadConversations?: (conversationIds: string[]) => Promise<Conversation[]>;
  signal?: AbortSignal;
}) {
  if (!params.conversations?.length || !params.loadConversations || params.vectorCandidates.length === 0) {
    return params.conversations;
  }
  const loadedIds = new Set(
    params.conversations
      .filter((conversation) => conversation.messages.length > 0)
      .map((conversation) => conversation.id)
  );
  const sourceConversationIds = Array.from(new Set(params.vectorCandidates
    .map((candidate) => candidate.sourceConversationId)
    .filter((conversationId): conversationId is string => Boolean(conversationId?.trim()))
    .filter((conversationId) => !loadedIds.has(conversationId))));
  if (sourceConversationIds.length === 0) return params.conversations;

  try {
    const loadedConversations = await params.loadConversations(sourceConversationIds);
    return mergeSemanticRecallConversations(params.conversations, loadedConversations);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    console.warn('[request] Semantic recall vector source bodies skipped.', error);
    return params.conversations;
  }
}

export async function prepareCollaboratorReplyRequest(params: {
  api: ProviderProfile;
  providers?: ProviderProfile[];
  globalApi?: ProviderProfile;
  memoryVectorRetrieval?: MemoryVectorRetrievalSettings;
  imageUnderstanding?: ImageUnderstandingSettings;
  historicalImagePolicy?: ConversationWindowPreferences['historicalImagePolicy'];
  persona: Persona | null | undefined;
  personas?: Persona[];
  messages: ChatMessage[];
  semanticRecallEnabled?: boolean;
  semanticRecallConversations?: Conversation[];
  loadSemanticRecallConversations?: (conversationIds: string[]) => Promise<Conversation[]>;
  activeConversationId?: string | null;
  toolLedger?: ToolLedgerEntry[];
  toolContext?: AssistantToolContext;
  currentTask?: ConversationTaskState | null;
  nickname?: string;
  signal?: AbortSignal;
  requestVectorEmbeddings?: RequestSemanticVectorEmbeddingClient;
  requestImageUnderstanding?: ImageUnderstandingRequestReply;
}): Promise<{
  assistantName: string;
  modelId: string;
  context: AssistantRequestContext;
  advanced: Persona['advanced'] | undefined;
  audit: AssistantRequestAudit;
  conversation: RequestMessage[];
  imageUnderstandingResults: RequestImageUnderstandingResult[];
}> {
  const { api, persona, personas, messages, toolLedger, toolContext, currentTask, nickname } = params;
  const startedAt = runtimeNow();
  const requestId = createUid('request');
  const preparedAdvanced = resolvePreparedAdvancedSettings({
    advanced: persona?.advanced,
    toolContext
  });
  const providerCapability = resolveProviderCapability(api, preparedAdvanced);
  const modelId = providerCapability.provider.model;
  const supportsImageInput = providerCapability.input.images !== 'none';
  const imageUnderstanding = !supportsImageInput
    ? await understandConversationImages({
        messages,
        historicalImagePolicy: params.historicalImagePolicy,
        settings: resolveProviderImageUnderstandingSettings({
          api
        }),
        providers: params.providers,
        globalApi: params.globalApi ?? api,
        signal: params.signal,
        requestImageUnderstanding: params.requestImageUnderstanding
      })
    : {
        messages,
        results: []
      };
  const requestSourceMessages = imageUnderstanding.messages;
  const assistantName = persona?.name || 'Assistant';
  const templateContext = buildTemplateContext({
    modelId,
    modelName: modelId,
    assistantName,
    nickname: nickname ?? persona?.userName
  });
  let stepStartedAt = runtimeNow();
  const personaPrompt = await resolvePersonaPromptForRuntimeSpec(persona);
  const personaPromptMs = runtimeNow() - stepStartedAt;
  const providerCapabilities = resolveCanonicalProviderCapabilities(api, preparedAdvanced);
  const toolProtocolMode = providerCapabilities.tools.promptProtocol;
  stepStartedAt = runtimeNow();
  const promptParts = buildAssistantPromptParts({
    personaPrompt: personaPrompt.prompt,
    personaPromptSource: personaPrompt.source,
    templateContext,
    regexTriggers: preparedAdvanced?.regexTriggers,
    includeRuntimeClockContext: persona?.systemTimeContextEnabled === true,
    promptInjections: providerCapability.promptInjections,
    toolContext,
    currentTask,
    toolProtocolMode,
    messages: requestSourceMessages
  });
  const promptPartsMs = runtimeNow() - stepStartedAt;
  const messageLimit = parseContextLimit(preparedAdvanced?.contextMessageLimit);
  const tokenBudget = resolveContextTokenBudget(providerCapabilities.budgets);
  const budgetPlan = resolveRequestBudgetPlan({
    messageLimit,
    totalPromptTokens: tokenBudget
  });
  stepStartedAt = runtimeNow();
  const { selectedPromptParts, promptPartDecisions } = selectPromptPartsForBudget({
    promptParts,
    plan: budgetPlan
  });
  const truncationMs = runtimeNow() - stepStartedAt;
  stepStartedAt = runtimeNow();
  const memoryPlan = resolveRequestMemoryPlan({
    memory: persona?.memory,
    inheritedMemorySources: persona
      ? (personas ?? [])
          .filter((candidate) => candidate.id !== persona.id)
          .map((candidate) => ({ id: candidate.id, memory: candidate.memory }))
      : [],
    maxTokens: budgetPlan.buckets.memory.maxTokens
  });
  const memoryPlanMs = runtimeNow() - stepStartedAt;
  const semanticRecallEnabled =
    params.semanticRecallEnabled !== false
    && persona?.memory.crossConversationRecallEnabled !== false;
  const semanticRecallConfig = resolveSemanticRecallConfig(persona?.memory.semanticRecall);
  const semanticVectorCandidates = semanticRecallEnabled && MEMORY_RELEASE_GATES.enableVectorRequestRecall && params.semanticRecallConversations
    ? await resolveVectorCandidatesForRequest({
        persona,
        providers: params.providers,
        globalApi: params.globalApi,
        memoryVectorRetrieval: params.memoryVectorRetrieval,
        messages: requestSourceMessages,
        activeConversationId: params.activeConversationId ?? null,
        catalogConversationIds: params.semanticRecallConversations.map((conversation) => conversation.id),
        maxResults: semanticRecallConfig.recentTailConversationCount,
        signal: params.signal,
        requestEmbeddings: params.requestVectorEmbeddings
      })
    : [];
  const conversationSummaryPlan = resolveRequestConversationSummaryPlan({
    enabled: semanticRecallEnabled && MEMORY_RELEASE_GATES.enableConversationSummaryRequestLane,
    summaries: persona?.memory.conversationSummaries,
    maxTokens: DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_TOKENS,
    maxChars: DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_CHARS,
    maxTotalSummaries: DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_TOTAL,
    maxRelationalProfiles: DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_RELATIONAL_PROFILES,
    maxRecentTopics: DEFAULT_CONVERSATION_SUMMARY_REQUEST_MAX_RECENT_TOPICS
  });
  const semanticRecallConversations = await hydrateSemanticRecallVectorSources({
    conversations: params.semanticRecallConversations,
    vectorCandidates: semanticVectorCandidates,
    loadConversations: params.loadSemanticRecallConversations,
    signal: params.signal
  });
  const semanticRecallPlan = resolveRequestSemanticRecallPlan(semanticRecallConversations
    ? {
        enabled: semanticRecallEnabled,
        messages: requestSourceMessages,
        conversations: semanticRecallConversations,
        activeConversationId: params.activeConversationId ?? null,
        currentCollaboratorId: persona?.id ?? null,
        maxTokens: null,
        maxCandidates: DEFAULT_SEMANTIC_RECALL_REQUEST_MAX_CANDIDATES,
        config: semanticRecallConfig,
        vectorCandidates: semanticVectorCandidates
      }
    : undefined);
  const semanticRecallCandidates = resolveSemanticRecallContextCandidates({
    plan: semanticRecallPlan,
    conversations: semanticRecallConversations
  });
  const historyMaxTokens = resolveRequestHistoryBudget({
    plan: budgetPlan,
    promptParts: selectedPromptParts,
    memoryPlan
  });
  const {
    conversation,
    contextPlan,
    historyDecision,
    conversationBuildMs,
    contextPlanMs
  } = buildConversationContext({
    messages: requestSourceMessages,
    persona,
    historyMaxTokens,
    messageLimit,
    historyMode: toolContext?.activeProject ? 'workspace' : 'conversation'
  });
  stepStartedAt = runtimeNow();
  const { toolRequest, tooling } = buildRequestTooling(toolContext, providerCapabilities);
  const toolRequestMs = runtimeNow() - stepStartedAt;
  const canReadMemoryDocs = Boolean(toolRequest.tools?.some((tool) => tool.function.name === 'readMemoryDoc'));
  const canReadWorkspaceReferenceDocs = Boolean(toolRequest.tools?.some((tool) =>
    tool.function.name === 'readWorkspaceReference'
    || tool.function.name === 'searchWorkspaceReferences'
    || tool.function.name === 'listWorkspaceReferences'
    || tool.function.name === 'searchReadableContext'
  ));
  stepStartedAt = runtimeNow();
  const cachePlan = resolveRequestCachePlan({
    promptParts: selectedPromptParts,
    providerCacheMode: providerCapabilities.cache.mode,
    providerSendsTopLevelCacheControl: providerCapability.cache.sendsTopLevelCacheControl,
    providerAutomaticMessageHistoryCache: providerCapability.cache.automaticMessageHistoryCache,
    modelId
  });
  const cachePlanMs = runtimeNow() - stepStartedAt;
  stepStartedAt = runtimeNow();
  const imagePolicyConversation = omitUnselectedRequestImageBytes(conversation, params.historicalImagePolicy);
  const runtimeConversation = supportsImageInput
    ? await hydrateConversationAssets(imagePolicyConversation, params.historicalImagePolicy)
    : imagePolicyConversation;
  const assetHydrationMs = runtimeNow() - stepStartedAt;
  stepStartedAt = runtimeNow();
  const context = assembleAssistantContext({
    systemPromptParts: selectedPromptParts.map((part) => ({
      name: part.name,
      layer: part.layer,
      content: part.content
    })),
    messages: runtimeConversation,
    messagesPrepared: true,
    toolLedger,
    memoryLines: memoryPlan.selectedLines,
    conversationSummaries: conversationSummaryPlan.selectedSummaries,
    semanticRecallCandidates,
    memoryReferenceDocs: canReadMemoryDocs ? persona?.memory.referenceDocs ?? [] : [],
    workspaceReferenceDocs: canReadWorkspaceReferenceDocs
      ? toolContext?.visibleWorkspaceReferenceDocs?.filter((doc) =>
          !toolContext.activeProject?.id || doc.projectId === toolContext.activeProject.id
        ) ?? []
      : [],
    historySummaries: contextPlan.summaries.map((summary) => summary.content),
    allowImages: supportsImageInput,
    toolContext,
    tools: toolRequest.tools,
    toolChoice: toolRequest.toolChoice,
    cachePlan
  });
  const contextAssemblyMs = runtimeNow() - stepStartedAt;
  stepStartedAt = runtimeNow();
  const budgetUsage = resolveRequestBudgetUsage({
    plan: budgetPlan,
    promptParts: selectedPromptParts,
    memoryPlan,
    conversation,
    context,
    toolContext
  });
  const budgetUsageMs = runtimeNow() - stepStartedAt;
  const requestReceipt = buildRequestContextReceipt({
    selectedPromptParts,
    context,
    contextPlan,
    memoryPlan,
    conversationSummaryPlan,
    semanticRecallPlan,
    cachePlan,
    tooling
  });
  const totalPreparationMs = runtimeNow() - startedAt;

  return {
    assistantName,
    modelId,
    context,
    advanced: preparedAdvanced,
    conversation: runtimeConversation,
    imageUnderstandingResults: imageUnderstanding.results,
    audit: buildRequestAudit({
      requestId,
      assistantName,
      providerId: api.id,
      providerName: api.name,
      modelId,
      persona,
      personaPromptSource: personaPrompt.source,
      messageLimit,
      tokenBudget,
      budgetPlan,
      budgetUsage,
      memoryPlan,
      conversationSummaryPlan,
      semanticRecallPlan,
      semanticRecallContextCandidates: semanticRecallCandidates,
      cachePlan,
      contextPlan,
      sourceMessages: requestSourceMessages,
      conversation,
      promptParts,
      truncation: {
        promptParts: promptPartDecisions,
        history: historyDecision
      },
      tooling,
      requestReceipt,
      context,
      timings: {
        personaPromptMs: Math.round(personaPromptMs),
        promptPartsMs: Math.round(promptPartsMs),
        truncationMs: Math.round(truncationMs),
        memoryPlanMs: Math.round(memoryPlanMs),
        conversationBuildMs: Math.round(conversationBuildMs),
        contextPlanMs: Math.round(contextPlanMs),
        toolRequestMs: Math.round(toolRequestMs),
        cachePlanMs: Math.round(cachePlanMs),
        assetHydrationMs: Math.round(assetHydrationMs),
        contextAssemblyMs: Math.round(contextAssemblyMs),
        budgetUsageMs: Math.round(budgetUsageMs),
        totalPreparationMs: Math.round(totalPreparationMs)
      }
    })
  };
}
