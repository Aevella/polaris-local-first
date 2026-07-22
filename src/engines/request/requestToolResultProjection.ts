import type { ToolInvocation, ToolInvocationKind } from '../../types/domain';
import { findPolarisToolManifestEntry } from '../tool-protocol/toolRegistry';
import type { PolarisToolResultReplayMode } from '../tool-protocol/toolRegistryShared';

const DETAIL_EXCERPT_CHARS = 1_800;
const ERROR_EXCERPT_CHARS = 1_200;

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactLongText(text: string, maxChars: number) {
  const normalized = text.trim();
  if (normalized.length <= maxChars) {
    return {
      text: normalized,
      omittedChars: 0
    };
  }

  const headChars = Math.ceil(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const head = normalized.slice(0, headChars).trimEnd();
  const tail = normalized.slice(-tailChars).trimStart();
  return {
    text: `${head}\n\n[中间已省略 ${normalized.length - head.length - tail.length} 字工具细节]\n\n${tail}`,
    omittedChars: normalized.length - head.length - tail.length
  };
}

function resolveKind(value: unknown): ToolInvocationKind | undefined {
  return typeof value === 'string' ? value as ToolInvocationKind : undefined;
}

function resolveToolResultReplayMode(kind: ToolInvocationKind | undefined): PolarisToolResultReplayMode | null {
  if (!kind) return null;
  return findPolarisToolManifestEntry(kind)?.resultReplayMode ?? null;
}

function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && !value.trim()) return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function slimProjectFileReadsForRequest(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const slimmed = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return undefined;
      if (record.kind === 'search') {
        const { matches: _matches, ...rest } = record;
        return rest;
      }
      if (record.kind === 'directory') {
        const { files: _files, ...rest } = record;
        return rest;
      }
      return record;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return slimmed.length ? slimmed : undefined;
}

function projectDetailFields(args: {
  target: Record<string, unknown>;
  kind: ToolInvocationKind | undefined;
  detailText: string | undefined;
  error: string | undefined;
}) {
  const { target, kind, detailText, error } = args;
  if (detailText) {
    const replayMode = resolveToolResultReplayMode(kind);
    if (replayMode === 'full-detail') {
      target.detailText = detailText;
    } else if (replayMode === 'detail-excerpt') {
      const compacted = compactLongText(detailText, DETAIL_EXCERPT_CHARS);
      target.detailExcerpt = compacted.text;
      if (compacted.omittedChars > 0) {
        target.detailOmittedChars = compacted.omittedChars;
      }
    } else {
      target.detailOmitted = true;
      target.detailReason = 'execution detail is not replayed by default';
    }
  }

  if (error) {
    const compacted = compactLongText(error, ERROR_EXCERPT_CHARS);
    target.error = compacted.text;
    if (compacted.omittedChars > 0) {
      target.errorOmittedChars = compacted.omittedChars;
    }
  }
}

export function projectToolResultPayloadForRequest(
  payload: Record<string, unknown>,
  overrides?: {
    toolName?: string;
    kind?: string;
  }
) {
  const kind = resolveKind(payload.kind ?? overrides?.kind);
  const projected: Record<string, unknown> = {};

  assignIfPresent(projected, 'toolName', overrides?.toolName ?? payload.toolName);
  assignIfPresent(projected, 'status', payload.status);
  assignIfPresent(projected, 'sourceMessageId', payload.sourceMessageId);
  assignIfPresent(projected, 'isError', payload.isError);
  assignIfPresent(projected, 'kind', overrides?.kind ?? payload.kind);
  assignIfPresent(projected, 'title', payload.title);
  assignIfPresent(projected, 'summary', payload.summary);
  assignIfPresent(projected, 'scope', payload.scope);
  assignIfPresent(projected, 'surfaces', payload.surfaces);
  assignIfPresent(projected, 'intent', payload.intent);
  assignIfPresent(projected, 'previewId', payload.previewId);
  assignIfPresent(projected, 'presetId', payload.presetId);
  assignIfPresent(projected, 'world', payload.world);
  assignIfPresent(projected, 'cardId', payload.cardId);
  assignIfPresent(projected, 'projectFileId', payload.projectFileId);
  assignIfPresent(projected, 'projectFileIds', payload.projectFileIds);
  assignIfPresent(projected, 'projectFilePaths', payload.projectFilePaths);
  assignIfPresent(projected, 'projectFiles', payload.projectFiles);
  assignIfPresent(projected, 'projectFileReads', slimProjectFileReadsForRequest(payload.projectFileReads));
  assignIfPresent(projected, 'projectFileEffects', payload.projectFileEffects);
  assignIfPresent(projected, 'workspaceReferenceDocId', payload.workspaceReferenceDocId);
  assignIfPresent(projected, 'workspaceReferenceDocTitle', payload.workspaceReferenceDocTitle);
  assignIfPresent(projected, 'workspaceReferenceDocs', payload.workspaceReferenceDocs);
  assignIfPresent(projected, 'workspaceReferenceDocReads', payload.workspaceReferenceDocReads);
  assignIfPresent(projected, 'readableContextCandidates', payload.readableContextCandidates);
  assignIfPresent(projected, 'projectDiagnostics', payload.projectDiagnostics);
  assignIfPresent(projected, 'imageCardId', payload.imageCardId);
  assignIfPresent(projected, 'memoryItems', payload.memoryItems);
  assignIfPresent(projected, 'memoryDocId', payload.memoryDocId);
  assignIfPresent(projected, 'memoryDocTitle', payload.memoryDocTitle);
  assignIfPresent(projected, 'memoryDocCreated', payload.memoryDocCreated);
  assignIfPresent(projected, 'webSearch', payload.webSearch);
  assignIfPresent(projected, 'webPageRead', payload.webPageRead);
  assignIfPresent(projected, 'mcpResult', payload.mcpResult);
  assignIfPresent(projected, 'targetLabel', payload.targetLabel);

  projectDetailFields({
    target: projected,
    kind,
    detailText: cleanString(payload.detailText),
    error: cleanString(payload.error)
  });

  return projected;
}

export function projectToolInvocationForRequest(toolInvocation: ToolInvocation) {
  return projectToolResultPayloadForRequest({
    kind: toolInvocation.kind,
    status: toolInvocation.status,
    title: toolInvocation.title,
    summary: toolInvocation.summary,
    detailText: toolInvocation.detailText,
    scope: toolInvocation.themeScope,
    surfaces: toolInvocation.themeSurfaceLabels,
    intent: toolInvocation.themeIntentLabel,
    previewId: toolInvocation.previewId,
    presetId: toolInvocation.presetId,
    world: toolInvocation.world,
    cardId: toolInvocation.cardId,
    projectFileId: toolInvocation.projectFileId,
    projectFileIds: toolInvocation.projectFileIds,
    projectFilePaths: toolInvocation.projectFilePaths,
    projectFiles: toolInvocation.projectFiles,
    projectFileReads: toolInvocation.projectFileReads,
    projectFileEffects: toolInvocation.projectFileEffects,
    workspaceReferenceDocId: toolInvocation.workspaceReferenceDocId,
    workspaceReferenceDocTitle: toolInvocation.workspaceReferenceDocTitle,
    workspaceReferenceDocs: toolInvocation.workspaceReferenceDocs,
    workspaceReferenceDocReads: toolInvocation.workspaceReferenceDocReads,
    readableContextCandidates: toolInvocation.readableContextCandidates,
    projectDiagnostics: toolInvocation.projectDiagnostics,
    imageCardId: toolInvocation.imageCardId,
    memoryItems: toolInvocation.memoryItems,
    memoryDocId: toolInvocation.memoryDocId,
    memoryDocTitle: toolInvocation.memoryDocTitle,
    webSearch: toolInvocation.webSearch,
    webPageRead: toolInvocation.webPageRead,
    mcpResult: toolInvocation.mcpResult,
    targetLabel: toolInvocation.targetLabel,
    error: toolInvocation.error
  });
}
