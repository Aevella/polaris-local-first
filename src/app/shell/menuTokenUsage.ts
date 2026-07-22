import type { ChatMessage, ChatTokenUsage, Conversation } from '../../types/domain';
import type { RequestDebugEntry } from '../../engines/request/requestDebugRuntime';

export type MenuTokenUsageEntry = {
  id: string;
  conversationTitle: string;
  assistantName: string;
  providerName: string;
  model: string;
  timestamp: number;
  usage: ChatTokenUsage;
  cacheReportStatus: MenuCacheReportStatus;
};

export type MenuCacheReportStatus = 'reported' | 'not_reported' | 'no_usage';

export type MenuProviderUsageGroup = {
  id: string;
  providerName: string;
  modelNames: string[];
  assistantNames: string[];
  replyCount: number;
  latestTimestamp: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheMissInputTokens: number;
  cacheObservedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReportedReplyCount: number;
  cacheUnreportedReplyCount: number;
  cacheZeroReadReplyCount: number;
  reasoningTokens: number;
};

export type MenuModelUsageGroup = {
  id: string;
  model: string;
  assistantNames: string[];
  replyCount: number;
  latestTimestamp: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheMissInputTokens: number;
  cacheObservedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReportedReplyCount: number;
  cacheUnreportedReplyCount: number;
  cacheZeroReadReplyCount: number;
  reasoningTokens: number;
};

export type MenuRequestIntent = RequestDebugEntry['requestReceipt']['intentLanes'][number]['intent'];
export type MenuRequestJudgementStatus = 'same' | 'changed' | 'unknown';

export type MenuRequestIntentBreakdown = {
  intent: MenuRequestIntent;
  blockCount: number;
  estimatedTokens: number;
  deltaTokens: number | null;
};

export type MenuRequestCacheBreakpoint = {
  name: RequestDebugEntry['requestReceipt']['cache']['breakpoints'][number]['name'];
  eligible: boolean;
  estimatedTokens: number;
  deltaTokens: number | null;
  reason: RequestDebugEntry['requestReceipt']['cache']['breakpoints'][number]['reason'];
  fingerprint: string;
  fingerprintStatus: MenuRequestJudgementStatus;
};

export type MenuRequestCacheBlock = {
  id: string;
  label: string;
  intent: MenuRequestIntent;
  estimatedTokens: number;
  deltaTokens: number | null;
  fingerprint: string;
  fingerprintStatus: MenuRequestJudgementStatus;
};

export type MenuRequestShrinkPlan = Pick<
  RequestDebugEntry['requestReceipt']['shrinkPlan'][number],
  'planId' | 'overlapKey' | 'strategy' | 'confidence' | 'reason' | 'estimatedSavingsTokens' | 'affectedLanes' | 'affectedLabels'
> & {
  keepBlockLabels: string[];
  candidateDropBlockLabels: string[];
};

export type MenuRequestReceiptEntry = {
  requestId: string;
  phase: RequestDebugEntry['phase'];
  assistantName: string;
  providerName: string;
  modelId: string;
  timestamp: number;
  fingerprints: RequestDebugEntry['requestReceipt']['fingerprints'];
  cacheStatus: RequestDebugEntry['requestReceipt']['cache']['applicationStatus'];
  cacheEligibleBreakpoints: number;
  cacheBreakpoints: MenuRequestCacheBreakpoint[];
  cachePrefixBlocks: MenuRequestCacheBlock[];
  duplicateInfoCount: number;
  shrinkPlanCount: number;
  shrinkPlanSavingsTokens: number;
  shrinkPlans: MenuRequestShrinkPlan[];
  intentLanes: Array<{
    intent: MenuRequestIntent;
    blockCount: number;
    estimatedTokens: number;
    deltaTokens: number | null;
  }>;
  tokenUsage: ChatTokenUsage | null;
  cacheReportStatus: MenuCacheReportStatus;
  judgement: {
    stablePrompt: MenuRequestJudgementStatus;
    dynamicContext: MenuRequestJudgementStatus;
    toolCapabilities: MenuRequestJudgementStatus;
    changedDynamicIntents: Array<Exclude<MenuRequestIntent, 'identity' | 'tool_capability' | 'tooling_schema'>>;
    cacheReadRate: number | null;
    duplicateInfoDelta: number | null;
  };
};

export type MenuRequestTrendEntry = {
  laneId: string;
  assistantName: string;
  providerName: string;
  modelId: string;
  requestCount: number;
  latestTimestamp: number;
  stableChangedCount: number;
  dynamicChangedCount: number;
  toolChangedCount: number;
  averageCacheReadRate: number | null;
  duplicateInfoDeltaTotal: number;
  recentRequests: Array<{
    requestId: string;
    timestamp: number;
    fingerprints: Pick<
      RequestDebugEntry['requestReceipt']['fingerprints'],
      'stablePrompt' | 'dynamicContext' | 'toolCapabilities' | 'fullRequest'
    >;
    stablePrompt: MenuRequestJudgementStatus;
    dynamicContext: MenuRequestJudgementStatus;
    toolCapabilities: MenuRequestJudgementStatus;
    changedDynamicIntents: MenuRequestReceiptEntry['judgement']['changedDynamicIntents'];
    cacheReadRate: number | null;
    duplicateInfoDelta: number | null;
    duplicateInfoCount: number;
    shrinkPlanCount: number;
    shrinkPlanSavingsTokens: number;
    shrinkPlans: MenuRequestShrinkPlan[];
    cacheEligibleBreakpoints: number;
    cacheBreakpoints: MenuRequestCacheBreakpoint[];
    cachePrefixBlocks: MenuRequestCacheBlock[];
    tokenUsage: Pick<ChatTokenUsage, 'inputTokens' | 'cachedInputTokens' | 'cacheMissInputTokens' | 'cacheCreationInputTokens'> | null;
    cacheReportStatus: MenuCacheReportStatus;
    intentBreakdown: MenuRequestIntentBreakdown[];
  }>;
  latestIntentBreakdown: MenuRequestIntentBreakdown[];
  latestCacheBreakpoints: MenuRequestCacheBreakpoint[];
  latestCachePrefixBlocks: MenuRequestCacheBlock[];
};

export type MenuTokenUsageSummary = {
  replyCount: number;
  requestReceiptCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheMissInputTokens: number;
  cacheObservedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReportedReplyCount: number;
  cacheUnreportedReplyCount: number;
  cacheZeroReadReplyCount: number;
  reasoningTokens: number;
  cacheEligibleRequestCount: number;
  duplicateInfoGroupCount: number;
  shrinkPlanCount: number;
  shrinkPlanSavingsTokens: number;
  providerGroups: MenuProviderUsageGroup[];
  modelGroups: MenuModelUsageGroup[];
  recentEntries: MenuTokenUsageEntry[];
  recentRequestReceipts: MenuRequestReceiptEntry[];
  requestTrends: MenuRequestTrendEntry[];
};

export const EMPTY_MENU_TOKEN_USAGE_SUMMARY: MenuTokenUsageSummary = {
  replyCount: 0,
  requestReceiptCount: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheMissInputTokens: 0,
  cacheObservedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReportedReplyCount: 0,
  cacheUnreportedReplyCount: 0,
  cacheZeroReadReplyCount: 0,
  reasoningTokens: 0,
  cacheEligibleRequestCount: 0,
  duplicateInfoGroupCount: 0,
  shrinkPlanCount: 0,
  shrinkPlanSavingsTokens: 0,
  providerGroups: [],
  modelGroups: [],
  recentEntries: [],
  recentRequestReceipts: [],
  requestTrends: []
};

type MenuSafeRequestDebugEntry = Omit<RequestDebugEntry, 'requestReceipt' | 'responseSummary'> & {
  requestReceipt: RequestDebugEntry['requestReceipt'];
  responseSummary: RequestDebugEntry['responseSummary'];
};

function normalizeRequestDebugEntryForMenu(entry: RequestDebugEntry): MenuSafeRequestDebugEntry | null {
  const rawEntry = entry as RequestDebugEntry & {
    requestReceipt?: Partial<RequestDebugEntry['requestReceipt']> | null;
    responseSummary?: Partial<RequestDebugEntry['responseSummary']> | null;
  };
  const receipt = rawEntry.requestReceipt;
  const fingerprints = receipt?.fingerprints;
  if (!fingerprints || typeof fingerprints !== 'object') return null;

  const cache = receipt.cache;
  const responseSummary = rawEntry.responseSummary;

  return {
    ...entry,
    providerId: rawEntry.providerId,
    providerName: rawEntry.providerName,
    requestReceipt: {
      schemaVersion: 1,
      fingerprints: {
        stablePrompt: fingerprints.stablePrompt ?? '',
        dynamicContext: fingerprints.dynamicContext ?? '',
        toolCapabilities: fingerprints.toolCapabilities ?? '',
        conversationTail: fingerprints.conversationTail ?? '',
        fullRequest: fingerprints.fullRequest ?? ''
      },
      cache: {
        applicationStatus: cache?.applicationStatus ?? 'not_applied',
        sendsExplicitCacheControl: cache?.sendsExplicitCacheControl === true,
        breakpoints: Array.isArray(cache?.breakpoints) ? cache.breakpoints : []
      },
      blocks: Array.isArray(receipt.blocks) ? receipt.blocks : [],
      topographyEvidence: Array.isArray(receipt.topographyEvidence) ? receipt.topographyEvidence : [],
      topographyEvidenceOverlap: Array.isArray(receipt.topographyEvidenceOverlap) ? receipt.topographyEvidenceOverlap : [],
      duplicateInfo: Array.isArray(receipt.duplicateInfo) ? receipt.duplicateInfo : [],
      topographyOverlap: Array.isArray(receipt.topographyOverlap) ? receipt.topographyOverlap : [],
      shrinkPlan: Array.isArray(receipt.shrinkPlan) ? receipt.shrinkPlan : [],
      intentLanes: Array.isArray(receipt.intentLanes) ? receipt.intentLanes : []
    },
    responseSummary: {
      usedNativeToolCalls: responseSummary?.usedNativeToolCalls === true,
      nativeToolCallCount: responseSummary?.nativeToolCallCount ?? 0,
      tokenCount: typeof responseSummary?.tokenCount === 'number' ? responseSummary.tokenCount : null,
      tokenUsage: responseSummary?.tokenUsage ?? null,
      error: responseSummary?.error ?? null
    }
  };
}

function normalizeUsage(message: ChatMessage): ChatTokenUsage | null {
  const totalTokens = message.tokenUsage?.totalTokens ?? message.tokenCount;
  if (!totalTokens || totalTokens <= 0) return null;
  return {
    totalTokens,
    inputTokens: message.tokenUsage?.inputTokens,
    outputTokens: message.tokenUsage?.outputTokens,
    cachedInputTokens: message.tokenUsage?.cachedInputTokens,
    cacheMissInputTokens: message.tokenUsage?.cacheMissInputTokens,
    cacheCreationInputTokens: message.tokenUsage?.cacheCreationInputTokens,
    reasoningTokens: message.tokenUsage?.reasoningTokens
  };
}

function sumToken(value: number | undefined) {
  return value && value > 0 ? value : 0;
}

function hasReportedToken(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveCacheReportStatus(usage: ChatTokenUsage | null | undefined): MenuCacheReportStatus {
  if (!usage) return 'no_usage';
  return hasReportedToken(usage.cachedInputTokens)
    || hasReportedToken(usage.cacheMissInputTokens)
    || hasReportedToken(usage.cacheCreationInputTokens)
    ? 'reported'
    : 'not_reported';
}

function hasZeroCacheRead(usage: ChatTokenUsage | null | undefined) {
  return hasReportedToken(usage?.cachedInputTokens) && usage?.cachedInputTokens === 0;
}

function normalizeModelLabel(model: string) {
  return model.trim() || '未知模型';
}

function normalizeProviderLabel(providerName: string | undefined) {
  return providerName?.trim() || '未记录供应商';
}

function buildProviderUsageGroups(entries: MenuTokenUsageEntry[]): MenuProviderUsageGroup[] {
  const grouped = new Map<string, {
    providerName: string;
    modelNames: Set<string>;
    assistantNames: Set<string>;
    replyCount: number;
    latestTimestamp: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheMissInputTokens: number;
    cacheCreationInputTokens: number;
    cacheReportedReplyCount: number;
    cacheUnreportedReplyCount: number;
    cacheZeroReadReplyCount: number;
    reasoningTokens: number;
  }>();

  for (const entry of entries) {
    const providerName = normalizeProviderLabel(entry.providerName);
    const current = grouped.get(providerName) ?? {
      providerName,
      modelNames: new Set<string>(),
      assistantNames: new Set<string>(),
      replyCount: 0,
      latestTimestamp: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheMissInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReportedReplyCount: 0,
      cacheUnreportedReplyCount: 0,
      cacheZeroReadReplyCount: 0,
      reasoningTokens: 0
    };

    current.modelNames.add(normalizeModelLabel(entry.model));
    current.assistantNames.add(entry.assistantName);
    current.replyCount += 1;
    current.latestTimestamp = Math.max(current.latestTimestamp, entry.timestamp);
    current.totalTokens += sumToken(entry.usage.totalTokens);
    current.inputTokens += sumToken(entry.usage.inputTokens);
    current.outputTokens += sumToken(entry.usage.outputTokens);
    current.cachedInputTokens += sumToken(entry.usage.cachedInputTokens);
    current.cacheMissInputTokens += sumToken(entry.usage.cacheMissInputTokens);
    current.cacheCreationInputTokens += sumToken(entry.usage.cacheCreationInputTokens);
    if (entry.cacheReportStatus === 'reported') {
      current.cacheReportedReplyCount += 1;
    } else if (entry.cacheReportStatus === 'not_reported') {
      current.cacheUnreportedReplyCount += 1;
    }
    if (hasZeroCacheRead(entry.usage)) {
      current.cacheZeroReadReplyCount += 1;
    }
    current.reasoningTokens += sumToken(entry.usage.reasoningTokens);
    grouped.set(providerName, current);
  }

  return [...grouped.values()]
    .map((group) => ({
      id: group.providerName,
      providerName: group.providerName,
      modelNames: [...group.modelNames].sort((a, b) => a.localeCompare(b)),
      assistantNames: [...group.assistantNames].sort((a, b) => a.localeCompare(b)),
      replyCount: group.replyCount,
      latestTimestamp: group.latestTimestamp,
      totalTokens: group.totalTokens,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cachedInputTokens: group.cachedInputTokens,
      cacheMissInputTokens: group.cacheMissInputTokens,
      cacheObservedInputTokens: group.cachedInputTokens + group.cacheMissInputTokens,
      cacheCreationInputTokens: group.cacheCreationInputTokens,
      cacheReportedReplyCount: group.cacheReportedReplyCount,
      cacheUnreportedReplyCount: group.cacheUnreportedReplyCount,
      cacheZeroReadReplyCount: group.cacheZeroReadReplyCount,
      reasoningTokens: group.reasoningTokens
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.latestTimestamp - a.latestTimestamp)
    .slice(0, 8);
}

function buildModelUsageGroups(entries: MenuTokenUsageEntry[]): MenuModelUsageGroup[] {
  const grouped = new Map<string, {
    model: string;
    assistantNames: Set<string>;
    replyCount: number;
    latestTimestamp: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheMissInputTokens: number;
    cacheCreationInputTokens: number;
    cacheReportedReplyCount: number;
    cacheUnreportedReplyCount: number;
    cacheZeroReadReplyCount: number;
    reasoningTokens: number;
  }>();

  for (const entry of entries) {
    const model = normalizeModelLabel(entry.model);
    const current = grouped.get(model) ?? {
      model,
      assistantNames: new Set<string>(),
      replyCount: 0,
      latestTimestamp: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheMissInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReportedReplyCount: 0,
      cacheUnreportedReplyCount: 0,
      cacheZeroReadReplyCount: 0,
      reasoningTokens: 0
    };

    current.assistantNames.add(entry.assistantName);
    current.replyCount += 1;
    current.latestTimestamp = Math.max(current.latestTimestamp, entry.timestamp);
    current.totalTokens += sumToken(entry.usage.totalTokens);
    current.inputTokens += sumToken(entry.usage.inputTokens);
    current.outputTokens += sumToken(entry.usage.outputTokens);
    current.cachedInputTokens += sumToken(entry.usage.cachedInputTokens);
    current.cacheMissInputTokens += sumToken(entry.usage.cacheMissInputTokens);
    current.cacheCreationInputTokens += sumToken(entry.usage.cacheCreationInputTokens);
    if (entry.cacheReportStatus === 'reported') {
      current.cacheReportedReplyCount += 1;
    } else if (entry.cacheReportStatus === 'not_reported') {
      current.cacheUnreportedReplyCount += 1;
    }
    if (hasZeroCacheRead(entry.usage)) {
      current.cacheZeroReadReplyCount += 1;
    }
    current.reasoningTokens += sumToken(entry.usage.reasoningTokens);
    grouped.set(model, current);
  }

  return [...grouped.values()]
    .map((group) => ({
      id: group.model,
      model: group.model,
      assistantNames: [...group.assistantNames].sort((a, b) => a.localeCompare(b)),
      replyCount: group.replyCount,
      latestTimestamp: group.latestTimestamp,
      totalTokens: group.totalTokens,
      inputTokens: group.inputTokens,
      outputTokens: group.outputTokens,
      cachedInputTokens: group.cachedInputTokens,
      cacheMissInputTokens: group.cacheMissInputTokens,
      cacheObservedInputTokens: group.cachedInputTokens + group.cacheMissInputTokens,
      cacheCreationInputTokens: group.cacheCreationInputTokens,
      cacheReportedReplyCount: group.cacheReportedReplyCount,
      cacheUnreportedReplyCount: group.cacheUnreportedReplyCount,
      cacheZeroReadReplyCount: group.cacheZeroReadReplyCount,
      reasoningTokens: group.reasoningTokens
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.latestTimestamp - a.latestTimestamp)
    .slice(0, 8);
}

function dedupeRequestDebugEntries(entries: MenuSafeRequestDebugEntry[]) {
  const latestByRequestId = new Map<string, MenuSafeRequestDebugEntry>();

  for (const entry of entries) {
    const current = latestByRequestId.get(entry.requestId);
    if (!current || entry.at >= current.at) {
      latestByRequestId.set(entry.requestId, entry);
    }
  }

  return [...latestByRequestId.values()].sort((a, b) => b.at - a.at);
}

function compareFingerprint(current: string, previous: string | null | undefined) {
  if (!previous) return 'unknown' as const;
  return current === previous ? 'same' as const : 'changed' as const;
}

function laneFingerprintKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.intentLanes.map((lane) => [
    lane.intent,
    lane.fingerprints.join(',')
  ]));
}

function resolveChangedDynamicIntents(
  entry: MenuSafeRequestDebugEntry,
  previous: MenuSafeRequestDebugEntry | null
): MenuRequestReceiptEntry['judgement']['changedDynamicIntents'] {
  if (!previous) return [];
  const previousLaneFingerprints = laneFingerprintKey(previous);
  return entry.requestReceipt.intentLanes
    .filter((lane) => (
      lane.intent !== 'identity'
      && lane.intent !== 'tool_capability'
      && lane.intent !== 'tooling_schema'
      && lane.fingerprints.join(',') !== previousLaneFingerprints.get(lane.intent)
    ))
    .map((lane) => lane.intent as MenuRequestReceiptEntry['judgement']['changedDynamicIntents'][number]);
}

function laneTokenKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.intentLanes.map((lane) => [
    lane.intent,
    lane.estimatedTokens
  ]));
}

function breakpointFingerprintKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.cache.breakpoints.map((breakpoint) => [
    breakpoint.name,
    breakpoint.fingerprint
  ]));
}

function breakpointTokenKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.cache.breakpoints.map((breakpoint) => [
    breakpoint.name,
    breakpoint.estimatedTokens
  ]));
}

function blockFingerprintKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.blocks.map((block) => [
    block.id,
    block.fingerprint
  ]));
}

function blockTokenKey(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.blocks.map((block) => [
    block.id,
    block.estimatedTokens
  ]));
}

function compareTokenDelta(current: number, previousTokens: Map<string, number> | null, key: string) {
  if (!previousTokens?.has(key)) return null;
  return current - (previousTokens.get(key) ?? 0);
}

function buildCachePrefixBlocks(entry: MenuSafeRequestDebugEntry, previous: MenuSafeRequestDebugEntry | null): MenuRequestCacheBlock[] {
  const previousBlockFingerprints = previous ? blockFingerprintKey(previous) : null;
  const previousBlockTokens = previous ? blockTokenKey(previous) : null;

  return entry.requestReceipt.blocks
    .filter((block) => block.sentToProvider && block.cachePrefixEligible)
    .map((block) => ({
      id: block.id,
      label: block.label,
      intent: block.intent,
      estimatedTokens: block.estimatedTokens,
      deltaTokens: compareTokenDelta(block.estimatedTokens, previousBlockTokens, block.id),
      fingerprint: block.fingerprint,
      fingerprintStatus: compareFingerprint(
        block.fingerprint,
        previousBlockFingerprints?.get(block.id)
      )
    }));
}

function buildBlockLabelMap(entry: MenuSafeRequestDebugEntry) {
  return new Map(entry.requestReceipt.blocks.map((block) => [block.id, block.label]));
}

function buildShrinkPlans(entry: MenuSafeRequestDebugEntry): MenuRequestShrinkPlan[] {
  const blockLabels = buildBlockLabelMap(entry);
  return entry.requestReceipt.shrinkPlan.map((plan) => ({
    planId: plan.planId,
    overlapKey: plan.overlapKey,
    strategy: plan.strategy,
    confidence: plan.confidence,
    reason: plan.reason,
    estimatedSavingsTokens: plan.estimatedSavingsTokens,
    affectedLanes: plan.affectedLanes,
    affectedLabels: plan.affectedLabels,
    keepBlockLabels: plan.keepBlockIds.map((id) => blockLabels.get(id) ?? id),
    candidateDropBlockLabels: plan.candidateDropBlockIds.map((id) => blockLabels.get(id) ?? id)
  }));
}

function resolveCacheReadRate(usage: ChatTokenUsage | null | undefined) {
  if (resolveCacheReportStatus(usage) !== 'reported') return null;
  const cachedInputTokens = usage?.cachedInputTokens ?? 0;
  const cacheMissInputTokens = usage?.cacheMissInputTokens ?? 0;
  const observedInputTokens = cachedInputTokens + cacheMissInputTokens;
  if (observedInputTokens > 0) {
    return cachedInputTokens / observedInputTokens;
  }

  const inputTokens = usage?.inputTokens ?? 0;
  if (inputTokens <= 0) return null;
  return cachedInputTokens / inputTokens;
}

function buildRequestReceiptEntries(entries: RequestDebugEntry[]): MenuRequestReceiptEntry[] {
  const safeEntries = entries.flatMap((entry) => {
    const normalized = normalizeRequestDebugEntryForMenu(entry);
    return normalized ? [normalized] : [];
  });
  const chronologicalEntries = [...dedupeRequestDebugEntries(safeEntries)].sort((a, b) => a.at - b.at);
  const previousByLane = new Map<string, MenuSafeRequestDebugEntry>();
  const requestEntries = chronologicalEntries.map((entry) => {
    const providerName = normalizeProviderLabel(entry.providerName);
    const laneKey = `${providerName}:${entry.assistantName}:${entry.modelId}`;
    const previous = previousByLane.get(laneKey) ?? null;
    previousByLane.set(laneKey, entry);
    const tokenUsage = entry.responseSummary.tokenUsage ?? null;
    const cacheReportStatus = resolveCacheReportStatus(tokenUsage);
    const previousLaneTokens = previous ? laneTokenKey(previous) : null;
    const previousBreakpointFingerprints = previous ? breakpointFingerprintKey(previous) : null;
    const previousBreakpointTokens = previous ? breakpointTokenKey(previous) : null;
    const shrinkPlans = buildShrinkPlans(entry);
    const shrinkPlanSavingsTokens = shrinkPlans.reduce((total, plan) => total + plan.estimatedSavingsTokens, 0);

    return {
      requestId: entry.requestId,
      phase: entry.phase,
      assistantName: entry.assistantName,
      providerName,
      modelId: entry.modelId,
      timestamp: entry.at,
      fingerprints: entry.requestReceipt.fingerprints,
      cacheStatus: entry.requestReceipt.cache.applicationStatus,
      cacheEligibleBreakpoints: entry.requestReceipt.cache.breakpoints.filter((breakpoint) => breakpoint.eligible).length,
      cacheBreakpoints: entry.requestReceipt.cache.breakpoints.map((breakpoint) => ({
        name: breakpoint.name,
        eligible: breakpoint.eligible,
        estimatedTokens: breakpoint.estimatedTokens,
        deltaTokens: compareTokenDelta(breakpoint.estimatedTokens, previousBreakpointTokens, breakpoint.name),
        reason: breakpoint.reason,
        fingerprint: breakpoint.fingerprint,
        fingerprintStatus: compareFingerprint(
          breakpoint.fingerprint,
          previousBreakpointFingerprints?.get(breakpoint.name)
        )
      })),
      cachePrefixBlocks: buildCachePrefixBlocks(entry, previous),
      duplicateInfoCount: entry.requestReceipt.duplicateInfo.length,
      shrinkPlanCount: shrinkPlans.length,
      shrinkPlanSavingsTokens,
      shrinkPlans,
      intentLanes: entry.requestReceipt.intentLanes.map((lane) => ({
        intent: lane.intent,
        blockCount: lane.blockCount,
        estimatedTokens: lane.estimatedTokens,
        deltaTokens: previousLaneTokens ? lane.estimatedTokens - (previousLaneTokens.get(lane.intent) ?? 0) : null
      })),
      tokenUsage,
      cacheReportStatus,
      judgement: {
        stablePrompt: compareFingerprint(
          entry.requestReceipt.fingerprints.stablePrompt,
          previous?.requestReceipt.fingerprints.stablePrompt
        ),
        dynamicContext: compareFingerprint(
          entry.requestReceipt.fingerprints.dynamicContext,
          previous?.requestReceipt.fingerprints.dynamicContext
        ),
        toolCapabilities: compareFingerprint(
          entry.requestReceipt.fingerprints.toolCapabilities,
          previous?.requestReceipt.fingerprints.toolCapabilities
        ),
        changedDynamicIntents: resolveChangedDynamicIntents(entry, previous),
        cacheReadRate: resolveCacheReadRate(tokenUsage),
        duplicateInfoDelta: previous
          ? entry.requestReceipt.duplicateInfo.length - previous.requestReceipt.duplicateInfo.length
          : null
      }
    };
  });

  return requestEntries.sort((a, b) => b.timestamp - a.timestamp);
}

function countChanged(entries: MenuRequestReceiptEntry[], key: 'stablePrompt' | 'dynamicContext' | 'toolCapabilities') {
  return entries.filter((entry) => entry.judgement[key] === 'changed').length;
}

function averageCacheReadRate(entries: MenuRequestReceiptEntry[]) {
  const rates = entries
    .map((entry) => entry.judgement.cacheReadRate)
    .filter((rate): rate is number => typeof rate === 'number');
  if (!rates.length) return null;
  return rates.reduce((total, rate) => total + rate, 0) / rates.length;
}

function buildRequestTrends(entries: MenuRequestReceiptEntry[]): MenuRequestTrendEntry[] {
  const grouped = new Map<string, MenuRequestReceiptEntry[]>();

  for (const entry of entries) {
    const laneId = `${entry.providerName}:${entry.assistantName}:${entry.modelId}`;
    grouped.set(laneId, [...(grouped.get(laneId) ?? []), entry]);
  }

  return [...grouped.entries()]
    .map(([laneId, laneEntries]) => {
      const chronologicalEntries = [...laneEntries].sort((a, b) => a.timestamp - b.timestamp);
      const latest = chronologicalEntries[chronologicalEntries.length - 1]!;
      return {
        laneId,
        assistantName: latest.assistantName,
        providerName: latest.providerName,
        modelId: latest.modelId,
        requestCount: chronologicalEntries.length,
        latestTimestamp: latest.timestamp,
        stableChangedCount: countChanged(chronologicalEntries, 'stablePrompt'),
        dynamicChangedCount: countChanged(chronologicalEntries, 'dynamicContext'),
        toolChangedCount: countChanged(chronologicalEntries, 'toolCapabilities'),
        averageCacheReadRate: averageCacheReadRate(chronologicalEntries),
        duplicateInfoDeltaTotal: chronologicalEntries.reduce(
          (total, entry) => total + (entry.judgement.duplicateInfoDelta ?? 0),
          0
        ),
        recentRequests: chronologicalEntries.slice(-6).map((entry) => ({
          requestId: entry.requestId,
          timestamp: entry.timestamp,
          fingerprints: {
            stablePrompt: entry.fingerprints.stablePrompt,
            dynamicContext: entry.fingerprints.dynamicContext,
            toolCapabilities: entry.fingerprints.toolCapabilities,
            fullRequest: entry.fingerprints.fullRequest
          },
          stablePrompt: entry.judgement.stablePrompt,
          dynamicContext: entry.judgement.dynamicContext,
          toolCapabilities: entry.judgement.toolCapabilities,
          changedDynamicIntents: entry.judgement.changedDynamicIntents,
          cacheReadRate: entry.judgement.cacheReadRate,
          duplicateInfoDelta: entry.judgement.duplicateInfoDelta,
          duplicateInfoCount: entry.duplicateInfoCount,
          shrinkPlanCount: entry.shrinkPlanCount,
          shrinkPlanSavingsTokens: entry.shrinkPlanSavingsTokens,
          shrinkPlans: entry.shrinkPlans,
          cacheEligibleBreakpoints: entry.cacheEligibleBreakpoints,
          cacheBreakpoints: entry.cacheBreakpoints,
          cachePrefixBlocks: entry.cachePrefixBlocks,
          tokenUsage: entry.tokenUsage ? {
            inputTokens: entry.tokenUsage.inputTokens,
            cachedInputTokens: entry.tokenUsage.cachedInputTokens,
            cacheMissInputTokens: entry.tokenUsage.cacheMissInputTokens,
            cacheCreationInputTokens: entry.tokenUsage.cacheCreationInputTokens
          } : null,
          cacheReportStatus: entry.cacheReportStatus,
          intentBreakdown: entry.intentLanes
        })),
        latestIntentBreakdown: latest.intentLanes,
        latestCacheBreakpoints: latest.cacheBreakpoints,
        latestCachePrefixBlocks: latest.cachePrefixBlocks
      };
    })
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
    .slice(0, 6);
}

export function summarizeMenuTokenUsage(
  conversations: Conversation[],
  requestDebugEntries: RequestDebugEntry[] = []
): MenuTokenUsageSummary {
  const entries = conversations.flatMap((conversation) =>
    conversation.messages.flatMap((message) => {
      if (message.role !== 'assistant' || message.toolInvocation) return [];
      const usage = normalizeUsage(message);
      if (!usage) return [];
      return [{
        id: `${conversation.id}:${message.id}`,
        conversationTitle: conversation.title,
        assistantName: message.assistantName ?? 'Assistant',
        providerName: normalizeProviderLabel(message.providerName),
        model: message.model ?? '',
        timestamp: message.timestamp,
        usage,
        cacheReportStatus: resolveCacheReportStatus(usage)
      }];
    })
  );
  const requestReceiptEntries = buildRequestReceiptEntries(requestDebugEntries);
  const requestTrends = buildRequestTrends(requestReceiptEntries);
  const cachedInputTokens = entries.reduce((total, entry) => total + sumToken(entry.usage.cachedInputTokens), 0);
  const cacheMissInputTokens = entries.reduce((total, entry) => total + sumToken(entry.usage.cacheMissInputTokens), 0);
  const cacheReportedReplyCount = entries.filter((entry) => entry.cacheReportStatus === 'reported').length;
  const cacheUnreportedReplyCount = entries.filter((entry) => entry.cacheReportStatus === 'not_reported').length;

  return {
    replyCount: entries.length,
    requestReceiptCount: requestReceiptEntries.length,
    totalTokens: entries.reduce((total, entry) => total + sumToken(entry.usage.totalTokens), 0),
    inputTokens: entries.reduce((total, entry) => total + sumToken(entry.usage.inputTokens), 0),
    outputTokens: entries.reduce((total, entry) => total + sumToken(entry.usage.outputTokens), 0),
    cachedInputTokens,
    cacheMissInputTokens,
    cacheObservedInputTokens: cachedInputTokens + cacheMissInputTokens,
    cacheCreationInputTokens: entries.reduce((total, entry) => total + sumToken(entry.usage.cacheCreationInputTokens), 0),
    cacheReportedReplyCount,
    cacheUnreportedReplyCount,
    cacheZeroReadReplyCount: entries.filter((entry) => hasZeroCacheRead(entry.usage)).length,
    reasoningTokens: entries.reduce((total, entry) => total + sumToken(entry.usage.reasoningTokens), 0),
    cacheEligibleRequestCount: requestReceiptEntries.filter((entry) => entry.cacheEligibleBreakpoints > 0).length,
    duplicateInfoGroupCount: requestReceiptEntries.reduce((total, entry) => total + entry.duplicateInfoCount, 0),
    shrinkPlanCount: requestReceiptEntries.reduce((total, entry) => total + entry.shrinkPlanCount, 0),
    shrinkPlanSavingsTokens: requestReceiptEntries.reduce((total, entry) => total + entry.shrinkPlanSavingsTokens, 0),
    providerGroups: buildProviderUsageGroups(entries),
    modelGroups: buildModelUsageGroups(entries),
    recentEntries: entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12),
    recentRequestReceipts: requestReceiptEntries.slice(0, 12),
    requestTrends
  };
}
