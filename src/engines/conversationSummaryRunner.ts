import type { AssistantReply, RequestAssistantReplyParams } from './chat-api/chatApiTypes';
import { requestAssistantReply } from './chatApi';
import {
  type ConversationSummarySourceBatch,
  resolveConversationSummarySourceBatches
} from './conversationSummaryMemory';
import { createUid } from './id';
import type { AssistantRequestContext } from './request/requestContext';
import type {
  Conversation,
  ConversationSummaryModelSettings,
  Persona,
  PersonaConversationSummary,
  PersonaConversationSummarySuppression,
  PersonaConversationSummaryKind,
  ProviderProfile
} from '../types/domain';

export type ConversationSummaryRequestReply = (
  params: RequestAssistantReplyParams
) => Promise<AssistantReply>;

export type ConversationSummaryRunStatus =
  | 'disabled'
  | 'empty'
  | 'completed';

export type ConversationSummaryRunResult = {
  status: ConversationSummaryRunStatus;
  collaboratorId: string;
  providerId?: string;
  model?: string;
  batchCount: number;
  generatedCount: number;
  generatedAt: number;
  summaries: PersonaConversationSummary[];
};

export type ConversationSummaryRunProgressStage =
  | 'planning'
  | 'summarizing'
  | 'summarized'
  | 'disabled'
  | 'empty';

export type ConversationSummaryRunProgress = {
  stage: ConversationSummaryRunProgressStage;
  collaboratorId: string;
  providerId?: string;
  model?: string;
  totalBatches: number;
  completedBatches: number;
  generatedCount: number;
  sourceConversationCount: number;
  sourceMessageCount: number;
  sourceCharCount: number;
  currentBatchSequence?: number;
  currentBatchCharCount?: number;
};

export type RunConversationSummaryMemoryParams = {
  persona: Persona;
  conversations: Conversation[];
  settings: ConversationSummaryModelSettings;
  providers: ProviderProfile[];
  globalApi: ProviderProfile;
  existingSummaries?: PersonaConversationSummary[];
  suppressedSources?: PersonaConversationSummarySuppression[];
  requestReply?: ConversationSummaryRequestReply;
  now?: number;
  signal?: AbortSignal;
  yieldToForeground?: () => Promise<void>;
  onProgress?: (progress: ConversationSummaryRunProgress) => void;
  onBatchSummaries?: (summaries: PersonaConversationSummary[]) => void | Promise<void>;
};

type RawConversationSummaryModelOutput = {
  summaries?: unknown;
};

type RawConversationSummary = {
  kind?: unknown;
  title?: unknown;
  content?: unknown;
  expiresAt?: unknown;
};

const CONVERSATION_SUMMARY_SYSTEM_PROMPT = [
  '你是 Polaris 的跨对话记忆整理小模型。',
  '你的任务是把同一个协作者的历史对话整理成可长期回放给主模型的记忆草稿。',
  '只保留对未来对话有持续价值的信息：关系模式、偏好、反复出现的主题、仍未完成的上下文。',
  '不要逐句复述原文，不要把玩笑、自嘲、临时情绪写成稳定事实。',
  '不要写当前任务执行记录，也不要替用户或协作者新增没有来源支持的设定。',
  '只输出可读的中文记忆草稿，不要输出 JSON、Markdown 表格、messageId、conversationId 或解释。'
].join('\n');

const CONVERSATION_SUMMARY_MAX_RELATIONAL_PROFILES_PER_BATCH = 1;
const CONVERSATION_SUMMARY_MAX_RECENT_TOPICS_PER_BATCH = 4;
const CONVERSATION_SUMMARY_TARGET_CONTENT_CHARS = 300;
const CONVERSATION_SUMMARY_USER_SUBJECT_LABEL = '用户';
export const CONVERSATION_SUMMARY_BATCH_SOURCE_CHARS = 8_000;

function resolveSummarySubjectName(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function resolveSummaryProvider(args: {
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

function buildConversationSummaryUserPrompt(persona: Persona, batch: ConversationSummarySourceBatch) {
  const userName = CONVERSATION_SUMMARY_USER_SUBJECT_LABEL;
  const collaboratorName = resolveSummarySubjectName(persona.name, '协作者');
  return [
    `名字表：${userName} = 历史来源中 role:user 的说话人；${collaboratorName} = 历史来源中 role:assistant 的说话人。`,
    `批次：${batch.sequence}`,
    `来源对话数：${batch.sourceConversationIds.length}`,
    `来源消息数：${batch.sourceMessageIds.length}`,
    '',
    '整理步骤：',
    `1. 先做对象确认：把每段来源里的“我/你/他/她/用户/助手/协作者”等称呼还原成名字表里的“${userName}”或“${collaboratorName}”。这一步是理解前提，不要单独输出。`,
    '2. 再基于已经确认的对象关系整理长期关系和近期主题。',
    '',
    '输出格式使用这两个小标题；没有内容的小标题可以省略：',
    '长期关系：',
    '- 稳定关系模式、表达偏好、协作者以后应该持续知道的事。',
    '',
    '近期主题：',
    '- 近期仍可能继续的主题、任务线索、创作线索。',
    '',
    '系统会负责补充 kind、来源 ID、时间和落库结构；你只负责写值得记住的内容。',
    '',
    '人称硬边界：',
    `- 总结必须使用名字表里的明确名字：“${userName}”、“${collaboratorName}”、“双方”。`,
    '- 不要用“我/你/他/她/用户/助手/协作者”指代关系主体；源对话里的第一人称和第二人称必须先还原成明确对象。',
    '- 如果无法确定某句话的指代对象，宁可省略，不要猜。',
    '',
    '数量与长度边界：',
    `- 每批最多输出 ${CONVERSATION_SUMMARY_MAX_RELATIONAL_PROFILES_PER_BATCH} 条长期关系和 ${CONVERSATION_SUMMARY_MAX_RECENT_TOPICS_PER_BATCH} 条近期主题。`,
    `- 每条 content 目标控制在 ${CONVERSATION_SUMMARY_TARGET_CONTENT_CHARS} 个中文字符以内；宁可合并相近内容，不要拆成很多碎片。`,
    '- 不要把候选编号、messageId、timestamp、score、工具日志、代码块、粘贴原文当成总结内容。',
    '',
    '历史对话来源：',
    batch.text
  ].join('\n');
}

export function buildConversationSummaryRequestContext(
  persona: Persona,
  batch: ConversationSummarySourceBatch
): AssistantRequestContext {
  return {
    memorySlots: {
      session: [],
      profile: [],
      pin: []
    },
    attachmentSlots: {
      enabled: false,
      pending: []
    },
    segments: [
      {
        kind: 'system',
        messages: [{
          role: 'system',
          content: CONVERSATION_SUMMARY_SYSTEM_PROMPT
        }]
      },
      {
        kind: 'conversation',
        messages: [{
          role: 'user',
          content: buildConversationSummaryUserPrompt(persona, batch)
        }]
      }
    ],
    toolChoice: 'none'
  };
}

function extractJsonObjectText(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]) {
    const candidate = fencedJson[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function isSummaryKind(value: unknown): value is PersonaConversationSummaryKind {
  return value === 'relational_profile' || value === 'recent_topic';
}

function normalizeTitle(rawTitle: unknown, kind: PersonaConversationSummaryKind) {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title) return title;
  return kind === 'relational_profile' ? '关系与表达模式' : '近期主题';
}

function normalizeExpiresAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

export function parseConversationSummaryModelOutput(text: string): RawConversationSummary[] {
  const jsonSummaries = parseConversationSummaryJsonOutput(text);
  if (jsonSummaries) return jsonSummaries;
  return parseConversationSummaryDraftOutput(text);
}

function parseConversationSummaryJsonOutput(text: string): RawConversationSummary[] | null {
  const candidate = extractJsonObjectText(text);
  const trimmed = text.trim();
  const looksJsonLike = candidate.trim().startsWith('{') || trimmed.startsWith('```');
  if (!looksJsonLike) return null;

  try {
    const parsed = JSON.parse(candidate) as RawConversationSummaryModelOutput;
    return Array.isArray(parsed.summaries)
      ? parsed.summaries.filter((item): item is RawConversationSummary => (
          typeof item === 'object' && item !== null
        ))
      : [];
  } catch {
    return [];
  }
}

function stripDraftFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function cleanDraftLine(line: string) {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)、]\s*/, '')
    .trim();
}

function resolveDraftHeadingKind(line: string): PersonaConversationSummaryKind | null {
  const normalized = cleanDraftLine(line).replace(/[：:]\s*$/, '');
  if (!normalized || normalized.length > 12) return null;
  if (/(长期|关系|画像|稳定|偏好|表达模式)/.test(normalized)) return 'relational_profile';
  if (/(近期|当前|主题|任务|线索|继续|创作)/.test(normalized)) return 'recent_topic';
  return null;
}

function splitHeadingInlineContent(line: string) {
  const match = cleanDraftLine(line).match(/^([^：:]{2,12})[：:]\s*(.+)$/);
  if (!match) return null;
  const kind = resolveDraftHeadingKind(match[1] ?? '');
  const content = (match[2] ?? '').trim();
  return kind && content ? { kind, content } : null;
}

function titleFromContent(content: string, kind: PersonaConversationSummaryKind) {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) return normalizeTitle('', kind);
  const clipped = cleaned.length > 18 ? `${cleaned.slice(0, 18)}…` : cleaned;
  return clipped.replace(/[。！？；;,.，、：:]+$/g, '') || normalizeTitle('', kind);
}

function parseConversationSummaryDraftOutput(text: string): RawConversationSummary[] {
  const normalized = stripDraftFence(text);
  if (!normalized) return [];

  const summaries: RawConversationSummary[] = [];
  let currentKind: PersonaConversationSummaryKind = 'recent_topic';
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    currentLines = [];
    if (!content) return;
    summaries.push({
      kind: currentKind,
      title: titleFromContent(content, currentKind),
      content
    });
  };

  for (const rawLine of normalized.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flush();
      continue;
    }

    const headingKind = resolveDraftHeadingKind(trimmed);
    if (headingKind) {
      flush();
      currentKind = headingKind;
      continue;
    }

    const inlineHeading = splitHeadingInlineContent(trimmed);
    if (inlineHeading) {
      flush();
      currentKind = inlineHeading.kind;
      currentLines.push(inlineHeading.content);
      continue;
    }

    const isBullet = /^\s*(?:[-*•]|\d+[.)、])\s+/.test(rawLine);
    if (isBullet) {
      flush();
    }
    currentLines.push(cleanDraftLine(rawLine));
  }

  flush();
  return summaries;
}

function normalizeModelSummaries(args: {
  rawSummaries: RawConversationSummary[];
  batch: ConversationSummarySourceBatch;
  persona: Persona;
  now: number;
}): PersonaConversationSummary[] {
  const counts: Record<PersonaConversationSummaryKind, number> = {
    relational_profile: 0,
    recent_topic: 0
  };

  return args.rawSummaries.flatMap((raw, index) => {
    if (!isSummaryKind(raw.kind)) return [];
    const limit = raw.kind === 'relational_profile'
      ? CONVERSATION_SUMMARY_MAX_RELATIONAL_PROFILES_PER_BATCH
      : CONVERSATION_SUMMARY_MAX_RECENT_TOPICS_PER_BATCH;
    if (counts[raw.kind] >= limit) return [];

    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) return [];
    const expiresAt = normalizeExpiresAt(raw.expiresAt);
    counts[raw.kind] += 1;

    return [{
      id: createUid('conversation-summary'),
      kind: raw.kind,
      title: normalizeTitle(raw.title, raw.kind),
      content,
      sequence: args.batch.sequence * 100 + index,
      sourceConversationIds: args.batch.sourceConversationIds,
      sourceMessageIds: args.batch.sourceMessageIds,
      sourceCharCount: args.batch.sourceCharCount,
      subjectCollaboratorId: args.persona.id,
      subjectCollaboratorName: resolveSummarySubjectName(args.persona.name, '协作者'),
      userLabel: CONVERSATION_SUMMARY_USER_SUBJECT_LABEL,
      generator: 'small_model',
      generatedAt: args.now,
      updatedAt: args.now,
      ...(expiresAt ? { expiresAt } : {})
    }];
  });
}

function resolveSummarySourceTarget(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return CONVERSATION_SUMMARY_BATCH_SOURCE_CHARS;
  }
  return Math.min(Math.floor(value), CONVERSATION_SUMMARY_BATCH_SOURCE_CHARS);
}

function sourceMessageKey(sourceMessageIds: string[]) {
  return sourceMessageIds.join('\u001f');
}

function existingSmallModelSummariesByBatch(
  summaries: PersonaConversationSummary[] | undefined,
  batches: ConversationSummarySourceBatch[]
) {
  const batchKeys = new Set(batches.map((batch) => sourceMessageKey(batch.sourceMessageIds)));
  const byKey = new Map<string, PersonaConversationSummary[]>();

  (summaries ?? []).forEach((summary) => {
    if (summary.generator !== 'small_model') return;
    const key = sourceMessageKey(summary.sourceMessageIds);
    if (!batchKeys.has(key)) return;
    byKey.set(key, [...(byKey.get(key) ?? []), summary]);
  });

  return byKey;
}

function suppressedSourceKeysByBatch(
  suppressions: PersonaConversationSummarySuppression[] | undefined,
  batches: ConversationSummarySourceBatch[]
) {
  const batchKeys = new Set(batches.map((batch) => sourceMessageKey(batch.sourceMessageIds)));
  return new Set(
    (suppressions ?? [])
      .map((suppression) => sourceMessageKey(suppression.sourceMessageIds))
      .filter((key) => batchKeys.has(key))
  );
}

async function defaultYieldToForeground() {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('跨对话总结整理已取消。');
  }
}

function summarizeSourceBatches(batches: ConversationSummarySourceBatch[]) {
  return {
    sourceConversationCount: new Set(batches.flatMap((batch) => batch.sourceConversationIds)).size,
    sourceMessageCount: new Set(batches.flatMap((batch) => batch.sourceMessageIds)).size,
    sourceCharCount: batches.reduce((total, batch) => total + batch.sourceCharCount, 0)
  };
}

function emitSummaryProgress(
  params: RunConversationSummaryMemoryParams,
  progress: ConversationSummaryRunProgress
) {
  params.onProgress?.(progress);
}

export async function runConversationSummaryMemory(
  params: RunConversationSummaryMemoryParams
): Promise<ConversationSummaryRunResult> {
  const now = params.now ?? Date.now();
  const yieldToForeground = params.yieldToForeground ?? defaultYieldToForeground;
  if (params.settings.enabled !== true) {
    emitSummaryProgress(params, {
      stage: 'disabled',
      collaboratorId: params.persona.id,
      totalBatches: 0,
      completedBatches: 0,
      generatedCount: 0,
      sourceConversationCount: 0,
      sourceMessageCount: 0,
      sourceCharCount: 0
    });
    return {
      status: 'disabled',
      collaboratorId: params.persona.id,
      batchCount: 0,
      generatedCount: 0,
      generatedAt: now,
      summaries: []
    };
  }

  const allBatches = resolveConversationSummarySourceBatches({
    conversations: params.conversations,
    currentCollaboratorId: params.persona.id,
    currentCollaboratorName: resolveSummarySubjectName(params.persona.name, '协作者'),
    userLabel: CONVERSATION_SUMMARY_USER_SUBJECT_LABEL,
    targetSourceChars: resolveSummarySourceTarget(params.settings.targetSourceChars)
  });
  const skipProcessedSources = params.settings.skipProcessedSources !== false;
  const suppressedSourceKeys = skipProcessedSources
    ? suppressedSourceKeysByBatch(params.suppressedSources, allBatches)
    : new Set<string>();
  const batches = suppressedSourceKeys.size > 0
    ? allBatches.filter((batch) => !suppressedSourceKeys.has(sourceMessageKey(batch.sourceMessageIds)))
    : allBatches;
  const api = resolveSummaryProvider({
    providers: params.providers,
    globalApi: params.globalApi,
    settings: params.settings
  });
  const sourceSummary = summarizeSourceBatches(batches);

  if (!batches.length) {
    emitSummaryProgress(params, {
      stage: 'empty',
      collaboratorId: params.persona.id,
      providerId: api.id,
      model: api.model,
      totalBatches: 0,
      completedBatches: 0,
      generatedCount: 0,
      ...sourceSummary
    });
    return {
      status: 'empty',
      collaboratorId: params.persona.id,
      providerId: api.id,
      model: api.model,
      batchCount: 0,
      generatedCount: 0,
      generatedAt: now,
      summaries: []
    };
  }

  const requestReply = params.requestReply ?? requestAssistantReply;
  const existingSummariesByBatch = skipProcessedSources
    ? existingSmallModelSummariesByBatch(params.existingSummaries, batches)
    : new Map<string, PersonaConversationSummary[]>();
  const summaries: PersonaConversationSummary[] = Array.from(existingSummariesByBatch.values()).flat();
  let completedBatches = existingSummariesByBatch.size;
  emitSummaryProgress(params, {
    stage: 'planning',
    collaboratorId: params.persona.id,
    providerId: api.id,
    model: api.model,
    totalBatches: batches.length,
    completedBatches,
    generatedCount: summaries.length,
    ...sourceSummary
  });

  for (const batch of batches) {
    assertNotAborted(params.signal);
    const batchKey = sourceMessageKey(batch.sourceMessageIds);
    if (existingSummariesByBatch.has(batchKey)) {
      emitSummaryProgress(params, {
        stage: 'summarizing',
        collaboratorId: params.persona.id,
        providerId: api.id,
        model: api.model,
        totalBatches: batches.length,
        completedBatches,
        generatedCount: summaries.length,
        currentBatchSequence: batch.sequence,
        currentBatchCharCount: batch.sourceCharCount,
        ...sourceSummary
      });
      continue;
    }

    await yieldToForeground();
    emitSummaryProgress(params, {
      stage: 'summarizing',
      collaboratorId: params.persona.id,
      providerId: api.id,
      model: api.model,
      totalBatches: batches.length,
      completedBatches,
      generatedCount: summaries.length,
      currentBatchSequence: batch.sequence,
      currentBatchCharCount: batch.sourceCharCount,
      ...sourceSummary
    });
    const reply = await requestReply({
      api,
      context: buildConversationSummaryRequestContext(params.persona, batch),
      advanced: {
        providerId: api.id,
        modelOverride: api.model,
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
    let batchSummaries: PersonaConversationSummary[] = [];
    try {
      batchSummaries = normalizeModelSummaries({
        rawSummaries: parseConversationSummaryModelOutput(reply.content),
        batch,
        persona: params.persona,
        now
      });
      summaries.push(...batchSummaries);
      if (batchSummaries.length > 0) {
        await params.onBatchSummaries?.(batchSummaries);
      }
    } catch {
      // Malformed organizer output should not make progress look stuck.
    }
    completedBatches += 1;
    emitSummaryProgress(params, {
      stage: 'summarizing',
      collaboratorId: params.persona.id,
      providerId: api.id,
      model: api.model,
      totalBatches: batches.length,
      completedBatches,
      generatedCount: summaries.length,
      currentBatchSequence: batch.sequence,
      currentBatchCharCount: batch.sourceCharCount,
      ...sourceSummary
    });
  }

  emitSummaryProgress(params, {
    stage: 'summarized',
    collaboratorId: params.persona.id,
    providerId: api.id,
    model: api.model,
    totalBatches: batches.length,
    completedBatches: batches.length,
    generatedCount: summaries.length,
    ...sourceSummary
  });

  return {
    status: 'completed',
    collaboratorId: params.persona.id,
    providerId: api.id,
    model: api.model,
    batchCount: batches.length,
    generatedCount: summaries.length,
    generatedAt: now,
    summaries
  };
}
