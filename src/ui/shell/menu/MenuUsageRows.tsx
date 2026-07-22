import type {
  MenuModelUsageGroup,
  MenuProviderUsageGroup,
  MenuCacheReportStatus,
  MenuRequestCacheBreakpoint,
  MenuRequestCacheBlock,
  MenuRequestJudgementStatus,
  MenuRequestReceiptEntry,
  MenuRequestShrinkPlan,
  MenuTokenUsageEntry
} from '../../../app/shell/menuTokenUsage';
import { useI18n, type I18nTranslator } from '../../../i18n';

export type UsageCopy = Pick<I18nTranslator, 'formatNumber' | 'language' | 't'>;

export function formatTokens(value: number | undefined, copy: UsageCopy) {
  if (!value || value <= 0) return copy.t('settings.usage.notRecorded');
  return copy.formatNumber(value);
}

export function formatReportedTokens(value: number | undefined, copy: UsageCopy) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return copy.t('settings.usage.notRecorded');
  return copy.formatNumber(value);
}

export function formatShrinkSavings(value: number, copy: UsageCopy) {
  return value > 0 ? copy.formatNumber(value) : '0';
}

export function formatSummaryNumber(value: number, copy: UsageCopy) {
  return copy.formatNumber(value);
}

export function formatRatio(value: number | null, copy: UsageCopy) {
  if (value === null) return copy.t('settings.usage.notRecorded');
  return `${Math.round(value * 100)}%`;
}

export function formatHash(value: string) {
  return value.slice(0, 8);
}

export function formatTime(timestamp: number, copy: UsageCopy) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(copy.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function MetricTile({ label, value, detail, tone = 'normal' }: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'normal' | 'primary';
}) {
  const copy = useI18n();
  return (
    <div className={`usage-metric-tile ${tone === 'primary' ? 'primary' : ''}`}>
      <span>{label}</span>
      <strong>{typeof value === 'number' ? formatSummaryNumber(value, copy) : value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function resolveCacheReadDenominator(inputTokens: number, observedTokens: number) {
  return observedTokens > 0 ? observedTokens : inputTokens;
}

export function formatCacheReadRate(
  cachedTokens: number,
  inputTokens: number,
  observedTokens: number,
  cacheReadReported: boolean,
  copy: UsageCopy
) {
  const denominator = resolveCacheReadDenominator(inputTokens, observedTokens);
  if (!cacheReadReported || denominator <= 0) return copy.t('settings.usage.notRecorded');
  return `${Math.round((cachedTokens / denominator) * 100)}%`;
}

function resolveCacheReadBarWidth(cachedTokens: number, inputTokens: number, observedTokens: number) {
  const denominator = resolveCacheReadDenominator(inputTokens, observedTokens);
  if (denominator <= 0 || cachedTokens <= 0) return 0;
  return Math.min(100, Math.round((cachedTokens / denominator) * 100));
}

export function formatCacheReportStatus(status: MenuCacheReportStatus, copy: UsageCopy) {
  if (status === 'reported') return copy.t('settings.usage.cacheReported');
  if (status === 'not_reported') return copy.t('settings.usage.cacheUnreported');
  return copy.t('settings.usage.usageUnreported');
}

export function ModelUsageGroupRow({ group }: { group: MenuModelUsageGroup }) {
  const copy = useI18n();
  const { t, formatNumber } = copy;
  const cacheReadReported = group.cachedInputTokens > 0 || group.cacheZeroReadReplyCount > 0;
  const cacheRate = formatCacheReadRate(
    group.cachedInputTokens,
    group.inputTokens,
    group.cacheObservedInputTokens,
    cacheReadReported,
    copy
  );
  const cacheBarWidth = resolveCacheReadBarWidth(group.cachedInputTokens, group.inputTokens, group.cacheObservedInputTokens);
  const assistantLabel = group.assistantNames.length > 0 ? group.assistantNames.join(' / ') : t('settings.usage.unrecordedAssistant');

  return (
    <div className="usage-model-row">
      <div className="usage-model-head">
        <div>
          <strong>{group.model}</strong>
          <span>{assistantLabel} · {t('settings.usage.replyCount', { count: formatNumber(group.replyCount) })} · {formatTime(group.latestTimestamp, copy)}</span>
        </div>
        <div className="usage-model-total">
          <strong>{formatSummaryNumber(group.totalTokens, copy)}</strong>
          <span>{t('settings.usage.tokensLabel')}</span>
        </div>
      </div>
      <div className="usage-model-cache">
        <span>{t('settings.usage.cacheRead')} {cacheRate}</span>
        <i><b style={{ width: `${cacheBarWidth}%` }} /></i>
      </div>
      <div className="usage-model-grid">
        <span>{t('settings.usage.inputShort')} {formatTokens(group.inputTokens, copy)}</span>
        <span>{t('settings.usage.outputShort')} {formatTokens(group.outputTokens, copy)}</span>
        <span>{t('settings.usage.reportedShort')} {formatNumber(group.cacheReportedReplyCount)}/{formatNumber(group.replyCount)}</span>
        {group.cacheUnreportedReplyCount > 0 ? <span>{t('settings.usage.unreportedShort')} {formatNumber(group.cacheUnreportedReplyCount)}</span> : null}
        {group.cacheZeroReadReplyCount > 0 ? <span>{t('settings.usage.zeroReadShort')} {formatNumber(group.cacheZeroReadReplyCount)}</span> : null}
        <span>{t('settings.usage.cacheRead')} {cacheReadReported ? formatReportedTokens(group.cachedInputTokens, copy) : t('settings.usage.notRecorded')}</span>
        <span>{t('settings.usage.cacheMissShortLabel')} {formatTokens(group.cacheMissInputTokens, copy)}</span>
        <span>{t('settings.usage.cacheWriteShort')} {formatTokens(group.cacheCreationInputTokens, copy)}</span>
        {group.reasoningTokens > 0 ? <span>{t('settings.usage.reasoningShort')} {formatTokens(group.reasoningTokens, copy)}</span> : null}
      </div>
    </div>
  );
}

export function ProviderUsageGroupRow({ group }: { group: MenuProviderUsageGroup }) {
  const copy = useI18n();
  const { t, formatNumber } = copy;
  const cacheReadReported = group.cachedInputTokens > 0 || group.cacheZeroReadReplyCount > 0;
  const cacheRate = formatCacheReadRate(
    group.cachedInputTokens,
    group.inputTokens,
    group.cacheObservedInputTokens,
    cacheReadReported,
    copy
  );
  const cacheBarWidth = resolveCacheReadBarWidth(group.cachedInputTokens, group.inputTokens, group.cacheObservedInputTokens);
  const modelLabel = group.modelNames.length > 0 ? group.modelNames.join(' / ') : t('settings.usage.unrecordedModel');
  const assistantLabel = group.assistantNames.length > 0 ? group.assistantNames.join(' / ') : t('settings.usage.unrecordedAssistant');

  return (
    <div className="usage-model-row">
      <div className="usage-model-head">
        <div>
          <strong>{group.providerName}</strong>
          <span>{modelLabel} · {assistantLabel} · {t('settings.usage.replyCount', { count: formatNumber(group.replyCount) })} · {formatTime(group.latestTimestamp, copy)}</span>
        </div>
        <div className="usage-model-total">
          <strong>{formatSummaryNumber(group.totalTokens, copy)}</strong>
          <span>{t('settings.usage.tokensLabel')}</span>
        </div>
      </div>
      <div className="usage-model-cache">
        <span>{t('settings.usage.cacheRead')} {cacheRate}</span>
        <i><b style={{ width: `${cacheBarWidth}%` }} /></i>
      </div>
      <div className="usage-model-grid">
        <span>{t('settings.usage.inputShort')} {formatTokens(group.inputTokens, copy)}</span>
        <span>{t('settings.usage.outputShort')} {formatTokens(group.outputTokens, copy)}</span>
        <span>{t('settings.usage.reportedShort')} {formatNumber(group.cacheReportedReplyCount)}/{formatNumber(group.replyCount)}</span>
        {group.cacheUnreportedReplyCount > 0 ? <span>{t('settings.usage.unreportedShort')} {formatNumber(group.cacheUnreportedReplyCount)}</span> : null}
        {group.cacheZeroReadReplyCount > 0 ? <span>{t('settings.usage.zeroReadShort')} {formatNumber(group.cacheZeroReadReplyCount)}</span> : null}
        <span>{t('settings.usage.cacheRead')} {cacheReadReported ? formatReportedTokens(group.cachedInputTokens, copy) : t('settings.usage.notRecorded')}</span>
        <span>{t('settings.usage.cacheMissShortLabel')} {formatTokens(group.cacheMissInputTokens, copy)}</span>
        <span>{t('settings.usage.cacheWriteShort')} {formatTokens(group.cacheCreationInputTokens, copy)}</span>
        {group.reasoningTokens > 0 ? <span>{t('settings.usage.reasoningShort')} {formatTokens(group.reasoningTokens, copy)}</span> : null}
      </div>
    </div>
  );
}

export function formatIntent(intent: MenuRequestReceiptEntry['intentLanes'][number]['intent'], copy: UsageCopy) {
  if (intent === 'identity') return copy.t('settings.usage.intent.identity');
  if (intent === 'runtime_context') return copy.t('settings.usage.intent.runtime');
  if (intent === 'task_context') return copy.t('settings.usage.intent.task');
  if (intent === 'tool_capability') return copy.t('settings.usage.intent.tool');
  if (intent === 'app_context') return copy.t('settings.usage.intent.app');
  if (intent === 'conversation_history') return copy.t('settings.usage.intent.history');
  if (intent === 'memory') return copy.t('settings.usage.intent.memory');
  return copy.t('settings.usage.intent.schema');
}

function formatPhase(phase: MenuRequestReceiptEntry['phase'], copy: UsageCopy) {
  if (phase === 'completed') return copy.t('settings.usage.phase.completed');
  if (phase === 'failed') return copy.t('settings.usage.phase.failed');
  return copy.t('settings.usage.phase.prepared');
}

function formatCacheStatus(status: MenuRequestReceiptEntry['cacheStatus'], copy: UsageCopy) {
  if (status === 'explicit_anthropic_cache_control') return copy.t('settings.usage.cacheStatus.explicit');
  if (status === 'provider_automatic_or_unknown') return copy.t('settings.usage.cacheStatus.upstream');
  return copy.t('settings.usage.cacheStatus.uncategorized');
}

export function formatCacheBreakpointName(name: MenuRequestCacheBreakpoint['name'], copy: UsageCopy) {
  if (name === 'identity_prefix') return copy.t('settings.usage.breakpoint.identity');
  return copy.t('settings.usage.breakpoint.capability');
}

function formatCacheBreakpointReason(breakpoint: MenuRequestCacheBreakpoint, copy: UsageCopy) {
  if (breakpoint.eligible) return copy.t('settings.usage.breakpoint.cacheable');
  if (breakpoint.reason === 'below_min_tokens') return copy.t('settings.usage.breakpoint.belowMin');
  if (breakpoint.reason === 'no_parts') return copy.t('settings.usage.breakpoint.noParts');
  return copy.t('settings.usage.breakpoint.disabled');
}

function formatJudgement(value: MenuRequestJudgementStatus, copy: UsageCopy) {
  if (value === 'same') return copy.t('settings.usage.judgement.same');
  if (value === 'changed') return copy.t('settings.usage.judgement.changed');
  return copy.t('settings.usage.judgement.first');
}

export function judgementTone(value: MenuRequestJudgementStatus) {
  if (value === 'same') return 'same';
  if (value === 'changed') return 'changed';
  return 'unknown';
}

export function formatDuplicateDelta(value: number | null, copy: UsageCopy) {
  if (value === null) return copy.t('settings.usage.judgement.first');
  if (value === 0) return '0';
  return value > 0 ? `+${copy.formatNumber(value)}` : copy.formatNumber(value);
}

export function formatShrinkStrategy(strategy: MenuRequestShrinkPlan['strategy'], copy: UsageCopy) {
  if (strategy === 'exact_duplicate') return copy.t('settings.usage.shrinkStrategy.exactDuplicate');
  if (strategy === 'directory_pressure') return copy.t('settings.usage.shrinkStrategy.directoryPressure');
  return copy.t('settings.usage.shrinkStrategy.laneCompression');
}

export function formatShrinkConfidence(confidence: MenuRequestShrinkPlan['confidence'], copy: UsageCopy) {
  if (confidence === 'high') return copy.t('settings.usage.confidence.high');
  if (confidence === 'medium') return copy.t('settings.usage.confidence.medium');
  return copy.t('settings.usage.confidence.low');
}

export function formatDelta(value: number | null, copy: UsageCopy) {
  if (value === null) return copy.t('settings.usage.judgement.first');
  if (value === 0) return '0';
  return value > 0 ? `+${formatTokens(value, copy)}` : `-${formatTokens(Math.abs(value), copy)}`;
}

export function CacheBreakpointChips({ breakpoints }: { breakpoints: MenuRequestCacheBreakpoint[] }) {
  const copy = useI18n();
  if (breakpoints.length === 0) return null;

  return (
    <div className="usage-cache-breakpoints">
      {breakpoints.map((breakpoint) => (
        <span
          className={`usage-cache-breakpoint ${breakpoint.eligible ? 'eligible' : 'ineligible'} ${judgementTone(breakpoint.fingerprintStatus)}`}
          key={breakpoint.name}
        >
          <strong>{formatCacheBreakpointName(breakpoint.name, copy)}</strong>
          <small>{formatTokens(breakpoint.estimatedTokens, copy)} · {formatDelta(breakpoint.deltaTokens, copy)}</small>
          <em>{formatCacheBreakpointReason(breakpoint, copy)} · {formatHash(breakpoint.fingerprint)}</em>
        </span>
      ))}
    </div>
  );
}

export function CachePrefixBlockChips({ blocks }: { blocks: MenuRequestCacheBlock[] }) {
  const copy = useI18n();
  if (blocks.length === 0) return null;

  return (
    <div className="usage-cache-blocks">
      {blocks.map((block) => (
        <span className={`usage-cache-block ${judgementTone(block.fingerprintStatus)}`} key={block.id}>
          <strong>{block.label}</strong>
          <small>{formatIntent(block.intent, copy)} · {formatTokens(block.estimatedTokens, copy)} · {formatDelta(block.deltaTokens, copy)}</small>
          <em>{formatJudgement(block.fingerprintStatus, copy)} · {formatHash(block.fingerprint)}</em>
        </span>
      ))}
    </div>
  );
}

export function ShrinkPlanChips({ plans }: { plans: MenuRequestShrinkPlan[] }) {
  const copy = useI18n();
  const { t } = copy;
  if (plans.length === 0) return null;

  return (
    <div className="usage-shrink-plans">
      {plans.map((plan) => (
        <span className={`usage-shrink-plan ${plan.confidence}`} key={plan.planId}>
          <strong>{formatShrinkStrategy(plan.strategy, copy)} · {formatShrinkConfidence(plan.confidence, copy)}</strong>
          <small>{t('settings.usage.estimatedSavings', { tokens: formatShrinkSavings(plan.estimatedSavingsTokens, copy) })} · {plan.overlapKey}</small>
          <em>{t('settings.usage.keepCandidate', {
            keep: plan.keepBlockLabels.join(' / ') || t('settings.usage.notRecorded'),
            candidate: plan.candidateDropBlockLabels.join(' / ') || t('settings.usage.notRecorded')
          })}</em>
        </span>
      ))}
    </div>
  );
}

export function UsageEntryRow({ entry }: { entry: MenuTokenUsageEntry }) {
  const copy = useI18n();
  const { t } = copy;
  const detailParts = [
    entry.assistantName,
    entry.providerName,
    entry.model,
    formatTime(entry.timestamp, copy)
  ].filter(Boolean);

  return (
    <div className="usage-entry-row">
      <div className="usage-entry-head">
        <strong>{entry.conversationTitle}</strong>
        <span>{detailParts.join(' · ')}</span>
      </div>
      <div className="usage-entry-grid">
        <span>{t('settings.usage.totalShort')} {formatTokens(entry.usage.totalTokens, copy)}</span>
        <span>{t('settings.usage.inputShort')} {formatTokens(entry.usage.inputTokens, copy)}</span>
        <span>{t('settings.usage.outputShort')} {formatTokens(entry.usage.outputTokens, copy)}</span>
        <span>{formatCacheReportStatus(entry.cacheReportStatus, copy)}</span>
        <span>{t('settings.usage.cacheRead')} {entry.cacheReportStatus === 'reported' ? formatReportedTokens(entry.usage.cachedInputTokens, copy) : formatTokens(entry.usage.cachedInputTokens, copy)}</span>
        <span>{t('settings.usage.cacheWriteShort')} {formatTokens(entry.usage.cacheCreationInputTokens, copy)}</span>
        {entry.usage.reasoningTokens ? <span>{t('settings.usage.reasoningShort')} {formatTokens(entry.usage.reasoningTokens, copy)}</span> : null}
      </div>
    </div>
  );
}

export function RequestReceiptRow({ entry }: { entry: MenuRequestReceiptEntry }) {
  const copy = useI18n();
  const { t, formatNumber } = copy;
  const intentLanes = entry.intentLanes.filter((lane) => lane.blockCount > 0);
  const usageParts = entry.tokenUsage
    ? [
        entry.tokenUsage.inputTokens ? `${t('settings.usage.inputShort')} ${formatTokens(entry.tokenUsage.inputTokens, copy)}` : '',
        formatCacheReportStatus(entry.cacheReportStatus, copy),
        entry.cacheReportStatus === 'reported' ? `${t('settings.usage.cacheRead')} ${formatReportedTokens(entry.tokenUsage.cachedInputTokens, copy)}` : '',
        typeof entry.tokenUsage.cacheMissInputTokens === 'number' ? `${t('settings.usage.cacheMissShortLabel')} ${formatReportedTokens(entry.tokenUsage.cacheMissInputTokens, copy)}` : '',
        typeof entry.tokenUsage.cacheCreationInputTokens === 'number' ? `${t('settings.usage.cacheWriteShort')} ${formatReportedTokens(entry.tokenUsage.cacheCreationInputTokens, copy)}` : ''
      ].filter(Boolean)
    : [formatCacheReportStatus(entry.cacheReportStatus, copy)];
  const changedIntents = entry.judgement.changedDynamicIntents
    .map((intent) => formatIntent(intent, copy))
    .join(' / ');

  return (
    <div className="usage-entry-row usage-request-row">
      <div className="usage-request-head">
        <div className="usage-entry-head">
          <strong>{entry.requestId.slice(-8)}</strong>
          <span>{[entry.assistantName, entry.providerName, entry.modelId, formatTime(entry.timestamp, copy)].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="usage-request-badges">
          <span>{formatPhase(entry.phase, copy)}</span>
          <span>{formatCacheStatus(entry.cacheStatus, copy)}</span>
        </div>
      </div>
      <div className="usage-entry-grid usage-receipt-grid">
        <span>{t('settings.usage.fullRequestShort')} {formatHash(entry.fingerprints.fullRequest)}</span>
        <span>{t('settings.usage.stablePromptShort')} {formatHash(entry.fingerprints.stablePrompt)}</span>
        <span>{t('settings.usage.dynamicContextShort')} {formatHash(entry.fingerprints.dynamicContext)}</span>
        <span>{t('settings.usage.toolCapabilitiesShort')} {formatHash(entry.fingerprints.toolCapabilities)}</span>
        <span>{t('settings.usage.cacheCandidateShort')} {formatNumber(entry.cacheEligibleBreakpoints)}</span>
        <span>{t('settings.usage.duplicateShort')} {formatNumber(entry.duplicateInfoCount)}</span>
        <span>{t('settings.usage.shrinkShort')} {formatNumber(entry.shrinkPlanCount)} / {formatShrinkSavings(entry.shrinkPlanSavingsTokens, copy)}</span>
      </div>
      <div className="usage-judgement-row">
        <span className={judgementTone(entry.judgement.stablePrompt)}>{t('settings.usage.stablePromptShort')} {formatJudgement(entry.judgement.stablePrompt, copy)}</span>
        <span className={judgementTone(entry.judgement.toolCapabilities)}>{t('settings.usage.toolCapabilitiesShort')} {formatJudgement(entry.judgement.toolCapabilities, copy)}</span>
        <span className={judgementTone(entry.judgement.dynamicContext)}>{t('settings.usage.dynamicContextShort')} {formatJudgement(entry.judgement.dynamicContext, copy)}</span>
        <span>{t('settings.usage.cacheShort')} {entry.cacheReportStatus === 'reported' ? formatRatio(entry.judgement.cacheReadRate, copy) : formatCacheReportStatus(entry.cacheReportStatus, copy)}</span>
        <span>{t('settings.usage.duplicateShort')} {formatDuplicateDelta(entry.judgement.duplicateInfoDelta, copy)}</span>
      </div>
      <CacheBreakpointChips breakpoints={entry.cacheBreakpoints} />
      <CachePrefixBlockChips blocks={entry.cachePrefixBlocks} />
      <ShrinkPlanChips plans={entry.shrinkPlans} />
      {changedIntents ? <div className="usage-receipt-line">{t('settings.usage.changedDynamic')}：{changedIntents}</div> : null}
      {intentLanes.length > 0 ? (
        <div className="usage-intent-lanes">
          {intentLanes.map((lane) => (
            <span key={lane.intent}>
              {formatIntent(lane.intent, copy)}
              <strong>{formatNumber(lane.blockCount)}</strong>
              <small>{formatTokens(lane.estimatedTokens, copy)}</small>
            </span>
          ))}
        </div>
      ) : null}
      {usageParts.length > 0 ? <div className="usage-receipt-line">{usageParts.join(' · ')}</div> : null}
    </div>
  );
}
