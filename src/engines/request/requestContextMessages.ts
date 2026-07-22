import type { ToolInvocation, ToolInvocationKind } from '../../types/domain';
import type { RequestMessage } from './requestMessage';
import { THEME_TOOL_INVOCATION_KINDS } from '../../types/toolInvocationKinds';
import { projectToolInvocationForRequest } from './requestToolResultProjection';
import { isTerminalToolInvocationStatus } from '../toolLedger';

const REQUEST_CONTEXT_THEME_TOOL_KINDS = new Set<ToolInvocationKind>(THEME_TOOL_INVOCATION_KINDS);

function isRequestContextTerminalToolInvocation(
  toolInvocation: ToolInvocation | null | undefined
): toolInvocation is ToolInvocation {
  return Boolean(
    toolInvocation
    && isTerminalToolInvocationStatus(toolInvocation.status)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatLineRange(value: unknown) {
  const record = asRecord(value);
  const start = record?.start;
  const end = record?.end;
  return typeof start === 'number' && typeof end === 'number' ? `${start}-${end}` : null;
}

function formatProjectFileFacts(value: unknown) {
  const files = asArray(value)
    .map(asRecord)
    .filter((file): file is Record<string, unknown> => Boolean(file));
  if (files.length === 0) return '';

  return [
    '文件事实：',
    ...files.map((file) => {
      const entry = file.isEntry === true ? '入口' : '文件';
      const role = typeof file.fileRole === 'string' ? ` · role=${file.fileRole}` : '';
      return `${entry} · ${String(file.filePath ?? file.fileId ?? 'unknown')} · ${String(file.language ?? 'text')}${role} · ${String(file.totalLines ?? '?')} 行 · ${String(file.totalChars ?? '?')} 字`;
    })
  ].join('\n');
}

function formatProjectFileReads(value: unknown) {
  const reads = asArray(value)
    .map(asRecord)
    .filter((read): read is Record<string, unknown> => Boolean(read));
  if (reads.length === 0) return '';

  const lines = reads.map((read) => {
    switch (read.kind) {
      case 'directory':
        return `目录：工作区 ${String(read.projectId ?? 'unknown')} · ${String(read.totalFiles ?? 0)} 个文件`;
      case 'file': {
        const file = asRecord(read.file);
        return `全文：${String(file?.filePath ?? read.fileId ?? 'unknown')} · ${String(file?.totalLines ?? '?')} 行 · ${String(file?.totalChars ?? '?')} 字`;
      }
      case 'context':
        return `上下文：${String(read.filePath ?? 'unknown')} · ${String(read.startLine ?? '?')}-${String(read.endLine ?? '?')} / ${String(read.totalLines ?? '?')} 行${typeof read.totalMatches === 'number' ? ` · query 命中 ${read.totalMatches} 处` : ''}`;
      case 'search':
        return `搜索：${String(read.query ?? '')} · 总命中 ${String(read.totalMatches ?? 0)} 处 · 返回 ${String(read.returnedMatches ?? 0)} 处`;
      default:
        return '';
    }
  }).filter(Boolean);

  return lines.length ? ['读取证据：', ...lines].join('\n') : '';
}

function formatWorkspaceReferenceDocs(value: unknown) {
  const docs = asArray(value)
    .map(asRecord)
    .filter((doc): doc is Record<string, unknown> => Boolean(doc));
  if (docs.length === 0) return '';

  return [
    '参考资料事实：',
    ...docs.map((doc) =>
      `${String(doc.title ?? doc.docId ?? 'unknown')} · docId=${String(doc.docId ?? 'unknown')} · ${String(doc.totalChars ?? '?')} 字`
    )
  ].join('\n');
}

function formatWorkspaceReferenceReads(value: unknown) {
  const reads = asArray(value)
    .map(asRecord)
    .filter((read): read is Record<string, unknown> => Boolean(read));
  if (reads.length === 0) return '';

  const lines = reads.map((read) => {
    switch (read.kind) {
      case 'directory':
        return `参考目录：工作区 ${String(read.projectId ?? 'unknown')} · ${String(read.totalDocs ?? 0)} 份资料`;
      case 'doc': {
        const doc = asRecord(read.doc);
        return `参考全文：${String(doc?.title ?? doc?.docId ?? 'unknown')} · ${String(doc?.totalChars ?? '?')} 字`;
      }
      case 'search':
        return `参考搜索：${String(read.query ?? '')} · 总命中 ${String(read.totalMatches ?? 0)} 份 · 返回 ${String(read.returnedMatches ?? 0)} 份`;
      default:
        return '';
    }
  }).filter(Boolean);

  return lines.length ? ['参考读取证据：', ...lines].join('\n') : '';
}

function formatReadableContextCandidates(value: unknown) {
  const candidates = asArray(value)
    .map(asRecord)
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  if (candidates.length === 0) return '';

  return [
    '可读候选：',
    ...candidates.map((candidate) =>
      `${String(candidate.source ?? 'unknown')} · ${String(candidate.title ?? candidate.id ?? 'unknown')} · 下一步 ${String(candidate.readTool ?? 'read')}`
    )
  ].join('\n');
}

function formatMcpResultEvidence(value: unknown) {
  const result = asRecord(value);
  if (!result) return '';

  return [
    'MCP 结果证据：',
    `工具：${String(result.serverName ?? 'unknown')} / ${String(result.toolName ?? 'unknown')}`,
    result.schemaName ? `schema：${String(result.schemaName)}` : '',
    result.argumentsObject !== undefined ? `参数：${JSON.stringify(result.argumentsObject)}` : '',
    result.isError === true ? 'isError=true' : '',
    result.structuredContent !== undefined
      ? ['structuredContent：', JSON.stringify(result.structuredContent)].join('\n')
      : ''
  ].filter(Boolean).join('\n');
}

function formatProjectFileEffects(value: unknown) {
  const effects = asArray(value)
    .map(asRecord)
    .filter((effect): effect is Record<string, unknown> => Boolean(effect));
  if (effects.length === 0) return '';

  return [
    '变更证据：',
    ...effects.map((effect) => {
      const changedLines = formatLineRange(effect.changedLines);
      const summary = [
        `${String(effect.filePath ?? effect.fileId ?? 'unknown')} · ${String(effect.operation ?? 'changed')}`,
        typeof effect.beforeLines === 'number' || typeof effect.afterLines === 'number'
          ? `${String(effect.beforeLines ?? '?')}→${String(effect.afterLines ?? '?')} 行`
          : '',
        changedLines ? `范围 ${changedLines}` : '',
        typeof effect.insertedChars === 'number' ? `新增 ${effect.insertedChars} 字` : '',
        typeof effect.removedChars === 'number' && effect.removedChars > 0 ? `删除 ${effect.removedChars} 字` : '',
        typeof effect.matchCount === 'number' ? `命中 ${effect.matchCount} 处` : '',
        typeof effect.afterExcerptStartLine === 'number' && typeof effect.afterExcerptEndLine === 'number'
          ? `后文 ${effect.afterExcerptStartLine}-${effect.afterExcerptEndLine}`
          : ''
      ].filter(Boolean).join(' · ');
      return typeof effect.afterExcerpt === 'string' && effect.afterExcerpt
        ? `${summary}\n${effect.afterExcerpt}`
        : summary;
    })
  ].join('\n');
}

function formatProjectDiagnostics(value: unknown) {
  const diagnostics = asArray(value)
    .map(asRecord)
    .filter((diagnostic): diagnostic is Record<string, unknown> => Boolean(diagnostic));
  if (diagnostics.length === 0) return '';

  return [
    '诊断证据：',
    ...diagnostics.map((diagnostic) => {
      const parts = [
        String(diagnostic.tool ?? 'diagnostic'),
        `runnable=${String(diagnostic.runnable ?? false)}`,
        diagnostic.reason ? `reason=${String(diagnostic.reason)}` : '',
        diagnostic.entryFilePath ? `入口 ${String(diagnostic.entryFilePath)}` : '',
        typeof diagnostic.errorsCount === 'number' ? `error ${diagnostic.errorsCount}` : '',
        typeof diagnostic.warningsCount === 'number' ? `warning ${diagnostic.warningsCount}` : '',
        typeof diagnostic.bodyEmpty === 'boolean' ? `bodyEmpty=${diagnostic.bodyEmpty}` : '',
        diagnostic.firstErrorMessage
          ? `firstError=${[
              diagnostic.firstErrorFilePath ? String(diagnostic.firstErrorFilePath) : '',
              typeof diagnostic.firstErrorLineNumber === 'number' ? String(diagnostic.firstErrorLineNumber) : ''
            ].filter(Boolean).join(':')}${diagnostic.firstErrorFilePath || typeof diagnostic.firstErrorLineNumber === 'number' ? ' ' : ''}${String(diagnostic.firstErrorMessage)}`
          : ''
      ].filter(Boolean);
      return parts.join(' · ');
    })
  ].join('\n');
}

export function shouldKeepMessageInRequestContext(message: RequestMessage) {
  return (
    !message.toolInvocation
    || isRequestContextTerminalToolInvocation(message.toolInvocation)
  );
}

export function buildRequestContextToolContent(toolInvocation: ToolInvocation) {
  const payload = projectToolInvocationForRequest(toolInvocation);
  const lines = [
    `[工具结果：${toolInvocation.title}]`,
    `状态：${toolInvocation.status}`,
    payload.summary ? `摘要：${String(payload.summary).trim()}` : '',
    payload.detailText ? ['详情：', String(payload.detailText).trim()].join('\n') : '',
    payload.detailExcerpt ? ['详情摘录：', String(payload.detailExcerpt).trim()].join('\n') : '',
    formatProjectFileFacts(payload.projectFiles),
    formatProjectFileReads(payload.projectFileReads),
    formatWorkspaceReferenceDocs(payload.workspaceReferenceDocs),
    formatWorkspaceReferenceReads(payload.workspaceReferenceDocReads),
    formatReadableContextCandidates(payload.readableContextCandidates),
    formatMcpResultEvidence(payload.mcpResult),
    formatProjectFileEffects(payload.projectFileEffects),
    formatProjectDiagnostics(payload.projectDiagnostics),
    payload.detailOmitted ? '详情：已省略原始执行细节，避免把日志或代码碎片继续回放给模型。' : '',
    payload.error ? ['错误摘录：', String(payload.error).trim()].join('\n') : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function buildRequestContextThemeToolContent(toolInvocation: ToolInvocation) {
  return [
    `[工具结果：${toolInvocation.title}]`,
    `状态：${toolInvocation.status}`,
    `摘要：${toolInvocation.summary.trim()}`,
    toolInvocation.themeIntentLabel?.trim() ? `意图：${toolInvocation.themeIntentLabel.trim()}` : '',
    toolInvocation.themeScope ? `范围：${toolInvocation.themeScope}` : '',
    toolInvocation.themeSurfaceLabels?.length ? `区域：${toolInvocation.themeSurfaceLabels.join('、')}` : '',
    toolInvocation.previewId ? `预览：${toolInvocation.previewId}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function materializeRequestContextMessage(message: RequestMessage): RequestMessage {
  const toolInvocation = message.toolInvocation;

  if (toolInvocation && REQUEST_CONTEXT_THEME_TOOL_KINDS.has(toolInvocation.kind)) {
    const nextContent = buildRequestContextThemeToolContent(toolInvocation);
    if (nextContent === message.content) {
      return message;
    }

    return {
      ...message,
      content: nextContent
    };
  }

  if (!isRequestContextTerminalToolInvocation(toolInvocation)) {
    return message;
  }

  const nextContent = buildRequestContextToolContent(toolInvocation);
  if (!nextContent || nextContent === message.content) {
    return message;
  }

  return {
    ...message,
    content: nextContent
  };
}

export function normalizeRequestContextMessageOrder(messages: RequestMessage[]) {
  const deferredToolMessagesByOriginId = new Map<string, RequestMessage[]>();
  const deferredToolMessageIds = new Set<string>();

  messages.forEach((message) => {
    const originMessageId = message.toolInvocation?.originMessageId?.trim();
    if (!originMessageId) return;
    deferredToolMessageIds.add(message.id);
    const bucket = deferredToolMessagesByOriginId.get(originMessageId) ?? [];
    bucket.push(message);
    deferredToolMessagesByOriginId.set(originMessageId, bucket);
  });

  const ordered: RequestMessage[] = [];
  const emittedDeferredToolMessageIds = new Set<string>();

  messages.forEach((message) => {
    if (deferredToolMessageIds.has(message.id)) {
      return;
    }

    ordered.push(message);

    const deferredToolMessages = deferredToolMessagesByOriginId.get(message.id) ?? [];
    deferredToolMessages.forEach((deferredMessage) => {
      ordered.push(deferredMessage);
      emittedDeferredToolMessageIds.add(deferredMessage.id);
    });
  });

  messages.forEach((message) => {
    if (!deferredToolMessageIds.has(message.id) || emittedDeferredToolMessageIds.has(message.id)) {
      return;
    }
    ordered.push(message);
  });

  return ordered;
}
