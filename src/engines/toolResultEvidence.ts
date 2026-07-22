import type { ToolInvocation } from '../types/domain';

/**
 * Owns the lossless structured evidence written to the conversation tool ledger.
 * Provider replay may compact this payload, but no other layer should rebuild a
 * second hand-maintained ToolInvocation field list.
 */
export function buildToolResultEvidence(toolInvocation: ToolInvocation) {
  return {
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
    codeWriteDetails: toolInvocation.codeWriteDetails,
    projectDiagnostics: toolInvocation.projectDiagnostics,
    projectPreviewRunnable: toolInvocation.projectPreviewRunnable,
    imageCardId: toolInvocation.imageCardId,
    memoryItems: toolInvocation.memoryItems,
    memoryDocId: toolInvocation.memoryDocId,
    memoryDocTitle: toolInvocation.memoryDocTitle,
    memoryDocSummary: toolInvocation.memoryDocSummary,
    memoryDocContent: toolInvocation.memoryDocContent,
    codeSaveCount: toolInvocation.codeSaveCount,
    codeSaveTotal: toolInvocation.codeSaveTotal,
    webSearch: toolInvocation.webSearch,
    webPageRead: toolInvocation.webPageRead,
    mcpResult: toolInvocation.mcpResult,
    targetLabel: toolInvocation.targetLabel,
    error: toolInvocation.error
  };
}
