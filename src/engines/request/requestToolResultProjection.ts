import type { ToolInvocation, ToolInvocationKind } from '../../types/domain';
import { findPolarisToolManifestEntry } from '../tool-protocol/toolRegistry';
import type { PolarisToolResultReplayMode } from '../tool-protocol/toolRegistryShared';
import { buildToolResultEvidence } from '../toolResultEvidence';

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

// 证据对象与 detailText 承载同一份内容；发给模型的投影只保留 detailText 一份，
// 证据侧压缩到标识/计数字段，避免同一段正文在 tool_result 里出现两遍。
function slimMcpResultForRequest(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  const slim: Record<string, unknown> = {};
  assignIfPresent(slim, 'serverId', record.serverId);
  assignIfPresent(slim, 'serverName', record.serverName);
  assignIfPresent(slim, 'toolName', record.toolName);
  assignIfPresent(slim, 'schemaName', record.schemaName);
  if (record.isError !== undefined) slim.isError = record.isError;
  return Object.keys(slim).length ? slim : undefined;
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
  assignIfPresent(projected, 'mcpResult', slimMcpResultForRequest(payload.mcpResult));
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
  return projectToolResultPayloadForRequest(buildToolResultEvidence(toolInvocation));
}
