import { readRuntimePerformanceEntries } from '../developer/runtime-performance/runtimePerformanceLog';
import { readClientErrorLog } from '../../infrastructure/clientErrorLog';
import { readAppRuntimeLogEntries } from '../../infrastructure/appRuntimeLog';
import { readStreamDebugEntries } from '../../engines/chat-api/chatApiStreamDebug';
import { readRequestDebugEntries } from '../../engines/request/requestDebugRuntime';
import { readModelFlowTraceEntries } from '../chat/modelFlowTraceRuntime';

export type LocalRuntimeLogEntry = {
  id: string;
  at: number;
  source: string;
  title: string;
  detail: string;
};

function phaseLabel(phase: 'prepared' | 'completed' | 'failed') {
  switch (phase) {
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    case 'prepared':
    default:
      return '准备';
  }
}

function shortText(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function compactParts(parts: Array<string | null | undefined | false>) {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' · ');
}

function summarizeEndpoint(value: unknown) {
  const endpoint = safeString(value);
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return endpoint.length > 80 ? `${endpoint.slice(0, 77)}...` : endpoint;
  }
}

function formatTokenUsage(usage: ReturnType<typeof readRequestDebugEntries>[number]['responseSummary']['tokenUsage']) {
  if (!usage) return null;
  return compactParts([
    usage.inputTokens ? `in ${usage.inputTokens}` : null,
    usage.outputTokens ? `out ${usage.outputTokens}` : null,
    usage.cachedInputTokens ? `cached ${usage.cachedInputTokens}` : null,
    usage.cacheMissInputTokens ? `miss ${usage.cacheMissInputTokens}` : null,
    usage.cacheCreationInputTokens ? `write ${usage.cacheCreationInputTokens}` : null,
    usage.reasoningTokens ? `think ${usage.reasoningTokens}` : null
  ]) || 'usage reported';
}

function streamTitle(phase: ReturnType<typeof readStreamDebugEntries>[number]['phase']) {
  switch (phase) {
    case 'request-path':
      return '请求路径';
    case 'silent-retry':
      return '静默重试';
    case 'fetch-stream-start':
      return 'fetch 开始';
    case 'fetch-stream-first-chunk':
      return 'fetch 首块';
    case 'fetch-stream-finish':
      return 'fetch 结束';
    case 'native-stream-start':
      return '原生请求开始';
    case 'native-stream-headers':
      return '原生响应头';
    case 'native-stream-first-chunk':
      return '原生首块';
    case 'native-stream-finish':
      return '原生请求结束';
    case 'native-stream-error':
      return '原生请求错误';
  }
}

function streamDetail(entry: ReturnType<typeof readStreamDebugEntries>[number]) {
  const meta = entry.meta ?? {};
  switch (entry.phase) {
    case 'request-path': {
      const path = safeString(meta.path) ?? 'unknown path';
      const provider = safeString(meta.provider);
      const requestStream = safeBoolean(meta.requestStream);
      const relay = safeBoolean(meta.relay);
      const attempt = safeNumber(meta.attempt);
      const idleTimeoutMs = safeNumber(meta.idleTimeoutMs);
      return compactParts([
        provider,
        path,
        requestStream === null ? null : requestStream ? 'stream=true' : 'stream=false',
        relay === null ? null : relay ? 'relay' : 'direct',
        attempt ? `attempt ${attempt}` : null,
        idleTimeoutMs ? `idle ${Math.round(idleTimeoutMs / 1000)}s` : null,
        summarizeEndpoint(meta.endpoint) ? `to ${summarizeEndpoint(meta.endpoint)}` : null,
        summarizeEndpoint(meta.upstreamEndpoint) ? `upstream ${summarizeEndpoint(meta.upstreamEndpoint)}` : null,
        safeString(meta.platform) ?? safeString(meta.nativePlatform)
      ]);
    }
    case 'silent-retry':
      return compactParts([
        safeString(meta.provider),
        safeString(meta.model),
        safeNumber(meta.attempt) ? `attempt ${safeNumber(meta.attempt)}` : null,
        safeString(meta.reason) ? `reason ${shortText(safeString(meta.reason) ?? '')}` : null
      ]);
    case 'fetch-stream-start':
    case 'native-stream-headers':
      return compactParts([
        safeString(meta.contentType) ?? 'unknown content-type',
        safeBoolean(meta.eventStream) === true ? 'event-stream' : 'non-event-stream'
      ]);
    case 'fetch-stream-first-chunk':
    case 'native-stream-first-chunk':
      return compactParts([
        safeString(meta.source),
        safeNumber(meta.elapsedMs) !== null ? `${safeNumber(meta.elapsedMs)} ms` : null,
        safeNumber(meta.chunkLength) !== null ? `${safeNumber(meta.chunkLength)} chars` : null
      ]);
    case 'fetch-stream-finish':
    case 'native-stream-finish':
      return compactParts([
        safeNumber(meta.status) !== null ? `status ${safeNumber(meta.status)}` : null,
        safeBoolean(meta.firstChunkSeen) === true ? '首块已见' : '首块未见',
        safeNumber(meta.elapsedMs) !== null ? `${safeNumber(meta.elapsedMs)} ms` : null,
        safeNumber(meta.totalLength) !== null ? `${safeNumber(meta.totalLength)} chars` : null
      ]);
    case 'native-stream-error':
      return compactParts([
        safeNumber(meta.status) !== null ? `status ${safeNumber(meta.status)}` : null,
        safeNumber(meta.elapsedMs) !== null ? `${safeNumber(meta.elapsedMs)} ms` : null
      ]);
    case 'native-stream-start':
      return compactParts([
        safeBoolean(meta.eventStream) === true ? 'event-stream' : null,
        summarizeEndpoint(meta.endpoint) ? `to ${summarizeEndpoint(meta.endpoint)}` : null
      ]) || 'native provider request started';
  }
}

function performanceTitle(kind: ReturnType<typeof readRuntimePerformanceEntries>[number]['kind']) {
  switch (kind) {
    case 'heavy-surface':
      return '重界面';
    case 'world-switch':
      return '世界切换';
    case 'theme-sync':
      return '主题同步';
    case 'performance-scenario':
      return '性能体检';
  }
}

function performanceDetail(entry: ReturnType<typeof readRuntimePerformanceEntries>[number]) {
  switch (entry.kind) {
    case 'heavy-surface':
      return `${entry.surface} · ${entry.phase}${typeof entry.elapsedMs === 'number' ? ` · ${Math.round(entry.elapsedMs)} ms` : ''}`;
    case 'world-switch':
      return `${entry.fromWorld} → ${entry.toWorld} · ${entry.stage} · ${Math.round(entry.elapsedMs)} ms`;
    case 'theme-sync':
      return `${entry.varsChanged} 个变量 · ${entry.rewrittenLayers.join('/') || '无重写层'}`;
    case 'performance-scenario':
      return `${entry.dom.totalNodeCount} nodes · avg ${Math.round(entry.frameSample.averageFps)} fps`;
  }
}

export function readLocalRuntimeLogEntries(limit = 20): LocalRuntimeLogEntry[] {
  const appEntries = readAppRuntimeLogEntries().map((entry) => ({
    id: entry.id,
    at: entry.at,
    source: '应用',
    title: entry.title,
    detail: entry.detail
  }));

  const requestEntries = readRequestDebugEntries().map((entry) => ({
    id: `request-${entry.requestId}-${entry.phase}`,
    at: entry.at,
    source: '请求',
    title: `模型请求${phaseLabel(entry.phase)}`,
    detail: compactParts([
      entry.assistantName,
      entry.providerName ?? entry.modelId,
      `prep ${Math.round(entry.timings.totalPreparationMs)} ms`,
      `preflight ${entry.inspector.totals.preflightStatus}`,
      `tools ${entry.tooling.toolCount}`,
      entry.responseSummary.nativeToolCallCount ? `tool calls ${entry.responseSummary.nativeToolCallCount}` : null,
      entry.responseSummary.finishReason ? `finish ${entry.responseSummary.finishReason}` : null,
      entry.responseSummary.transportIncomplete ? 'stream incomplete' : null,
      formatTokenUsage(entry.responseSummary.tokenUsage),
      entry.responseSummary.error ? `error ${shortText(entry.responseSummary.error)}` : null
    ])
  }));

  const streamEntries = readStreamDebugEntries().map((entry, index) => ({
    id: `stream-${entry.at}-${index}`,
    at: entry.at,
    source: '流式',
    title: streamTitle(entry.phase),
    detail: streamDetail(entry)
  }));

  const modelFlowEntries = readModelFlowTraceEntries().map((entry) => ({
    id: `model-flow-${entry.at}-${entry.requestId ?? entry.assistantMessageId ?? entry.phase}`,
    at: entry.at,
    source: '模型流程',
    title: `${entry.verdict.toUpperCase()} · ${entry.phase}`,
    detail: compactParts([
      entry.assistantName,
      entry.modelId,
      entry.response.finishReason ? `finish ${entry.response.finishReason}` : null,
      entry.response.transportIncomplete === true ? 'stream incomplete' : null,
      entry.response.tokenUsage ? formatTokenUsage(entry.response.tokenUsage) : null,
      entry.response.nativeToolCallCount ? `tool calls ${entry.response.nativeToolCallCount}` : null,
      entry.response.toolDraftBlockCount ? `草稿 ${entry.response.toolDraftBlockCount}` : null,
      `plan ${entry.toolPlan.preparationStatus}`,
      entry.toolPlan.resolvedActionKinds.length ? `actions ${entry.toolPlan.resolvedActionKinds.join('/')}` : null,
      entry.toolExecution.length ? `exec ${entry.toolExecution.length}` : null,
      entry.toolResultProjection.length ? `projection ${entry.toolResultProjection.length}` : null,
      entry.reasons[0] ? shortText(entry.reasons[0]) : null
    ])
  }));

  const performanceEntries = readRuntimePerformanceEntries().map((entry, index) => ({
    id: `performance-${entry.at}-${index}`,
    at: entry.at,
    source: '性能',
    title: performanceTitle(entry.kind),
    detail: performanceDetail(entry)
  }));

  const errorEntries = readClientErrorLog().map((entry) => ({
    id: entry.id,
    at: Date.parse(entry.at) || 0,
    source: '错误',
    title: `客户端错误 · ${entry.source}`,
    detail: shortText(entry.message)
  }));

  return [...appEntries, ...requestEntries, ...streamEntries, ...modelFlowEntries, ...performanceEntries, ...errorEntries]
    .filter((entry) => Number.isFinite(entry.at) && entry.at > 0)
    .sort((left, right) => right.at - left.at)
    .slice(0, limit);
}
