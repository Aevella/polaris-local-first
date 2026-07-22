import type { AssistantToolAction } from '../../engines/assistantToolProtocol';
import { findPreferredProjectFile, normalizeCodeCardFilePath } from '../../engines/roomProjects';
import type { RoomProjectTreeSnapshot } from '../../engines/roomProjects';
import { normalizeForMatch } from '../../engines/stringMatch';
import type { CodeCard, ProjectFile } from '../../types/domain';

export type CardTargetMatch =
  | { ok: true; card: CodeCard; note?: string }
  | { ok: false; error: string };

export type ProjectFileTargetMatch =
  | { ok: true; file: ProjectFile; note?: string }
  | { ok: false; error: string };

export function findCardByTarget(
  cards: CodeCard[],
  activeCardId: string | null,
  target?: string
): CardTargetMatch {
  if (!target || target === 'active') {
    const activeCard = cards.find((card) => card.id === activeCardId) ?? null;
    return activeCard ? { ok: true, card: activeCard } : { ok: false, error: '当前没有可用的活动房间。' };
  }

  const byId = cards.find((card) => card.id === target) ?? null;
  if (byId) return { ok: true, card: byId };

  const normalized = normalizeForMatch(target, { stripQuotes: true });
  const exact = cards.find((card) => normalizeForMatch(card.title, { stripQuotes: true }) === normalized) ?? null;
  if (exact) return { ok: true, card: exact };

  const fuzzyMatches = cards.filter((card) => {
    const title = normalizeForMatch(card.title, { stripQuotes: true });
    return title.includes(normalized) || normalized.includes(title);
  });

  if (fuzzyMatches.length === 1) {
    return { ok: true, card: fuzzyMatches[0] };
  }
  if (fuzzyMatches.length > 1) {
    return {
      ok: false,
      error: `“${target}”匹配到多个房间：${fuzzyMatches.slice(0, 3).map((card) => card.title).join('、')}。请说更具体一点。`
    };
  }

  return { ok: false, error: `没有找到名为“${target}”的房间。` };
}
export function findProjectFileByTarget(
  projectFiles: ProjectFile[],
  target: string | undefined,
  activeProjectId: string | null | undefined
): ProjectFileTargetMatch | null {
  void projectFiles;
  void activeProjectId;
  if (!target) return null;
  return {
    ok: false,
    error: buildFreeTextProjectTargetError()
  };
}

export function findProjectFileByProjectPath(
  projectFiles: ProjectFile[],
  projectScopes: Pick<RoomProjectTreeSnapshot, 'id' | 'title' | 'slug'>[],
  projectId?: string,
  filePath?: string,
  activeProjectId?: string | null
): ProjectFileTargetMatch | null {
  if (!filePath) return null;
  const normalizedFilePath = normalizeCodeCardFilePath(filePath);
  if (!normalizedFilePath) return null;

  const scopedProjectIds = new Set(projectFiles.map((file) => file.projectId).filter(Boolean));
  const resolveProjectScopeId = (value: string | undefined) => {
    const normalizedValue = value?.trim();
    if (!normalizedValue) {
      return activeProjectId?.trim() || undefined;
    }
    if (scopedProjectIds.has(normalizedValue)) {
      return normalizedValue;
    }

    const normalizedReference = normalizeForMatch(normalizedValue, { stripQuotes: true });
    const exactMatch = projectScopes.find((project) =>
      normalizeForMatch(project.id, { stripQuotes: true }) === normalizedReference
      || normalizeForMatch(project.slug, { stripQuotes: true }) === normalizedReference
      || normalizeForMatch(project.title, { stripQuotes: true }) === normalizedReference
    ) ?? null;
    return exactMatch?.id;
  };

  const normalizedProjectId = resolveProjectScopeId(projectId);
  if (!normalizedProjectId) {
    if (projectId?.trim()) {
      return {
        ok: false,
        error: `没有找到工作区“${projectId.trim()}”。如果你说的是当前工作区里的文件，直接传 filePath 就行。`
      };
    }
    return null;
  }

  const match = findPreferredProjectFile({
    projectFiles,
    projectId: normalizedProjectId,
    filePath: normalizedFilePath
  });
  if (match.file) {
    if (match.duplicateCount > 1 && !match.usedPreferredFile) {
      return {
        ok: false,
        error: buildDuplicateProjectFilePathError(normalizedProjectId, normalizedFilePath, match.duplicateCount)
      };
    }
    return {
      ok: true,
      file: match.file
    };
  }

  return {
    ok: false,
    error: `工作区 ${normalizedProjectId} 里没有找到 ${normalizedFilePath}。`
  };
}

export function formatResolvedTargetLabel(
  target: Extract<CardTargetMatch, { ok: true }> | Extract<ProjectFileTargetMatch, { ok: true }>,
  fallbackLabel: string
) {
  return target.note ? `${fallbackLabel}（${target.note}）` : fallbackLabel;
}

export function buildMissingProjectFileTargetError() {
  return '工作区文件动作需要明确 filePath；入口文件也传 filePath="index.html"，不要用 target=active。';
}

export function buildMissingProjectTargetError() {
  return '当前没有可用的工作区。请先由用户打开一个工作区对话；进入工作区后再修改工作区封面或文件。';
}

export function buildFreeTextProjectTargetError() {
  return '工作区文件动作不再支持 target；请直接传当前工作区里的 filePath，例如 index.html 或 script.js。';
}

export function buildDuplicateProjectFilePathError(projectId: string, filePath: string, duplicateCount: number) {
  return `工作区 ${projectId} 里有 ${duplicateCount} 个 ${filePath}，不能猜要写哪一个。请先整理重复文件后再继续。`;
}

export function buildProjectBoundaryError(actionProjectId: string | undefined, activeProjectId: string | null | undefined) {
  if (!activeProjectId) {
    return '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。';
  }
  const requestedProjectId = actionProjectId?.trim();
  if (requestedProjectId && requestedProjectId !== activeProjectId) {
    return `这条对话已绑定工作区 ${activeProjectId}，不能写到 ${requestedProjectId}。需要切换工作区时，请由用户从目标工作区打开对话。`;
  }
  return null;
}
export function resolveProjectActionBoundaryId(action: AssistantToolAction) {
  switch (action.kind) {
    case 'createProjectFile':
      return action.file.projectId;
    case 'writeProjectFiles':
    case 'patchRoomProject':
      return action.projectId;
    case 'listProjectFiles':
    case 'searchProjectFiles':
    case 'readWorkspacePreviewState':
    case 'listWorkspaceReferences':
    case 'searchWorkspaceReferences':
    case 'readWorkspaceReference':
    case 'promoteWorkspaceReferenceToProjectFile':
    case 'pinProjectFileAsReference':
    case 'checkProjectPreview':
    case 'inspectProjectRuntime':
      return action.projectId;
    case 'appendProjectFile':
    case 'insertProjectFile':
    case 'replaceProjectFileLines':
    case 'editProjectFileText':
    case 'deleteProjectFile':
    case 'readProjectFile':
    case 'readProjectFileContext':
      return action.projectId;
    case 'searchReadableContext':
      return action.projectId;
    default:
      return undefined;
  }
}

export function isModelWorkspaceAction(action: AssistantToolAction) {
  return action.kind === 'createProjectFile'
    || action.kind === 'writeProjectFiles'
    || action.kind === 'patchRoomProject'
    || action.kind === 'listProjectFiles'
    || action.kind === 'searchProjectFiles'
    || action.kind === 'readWorkspacePreviewState'
    || action.kind === 'listWorkspaceReferences'
    || action.kind === 'searchWorkspaceReferences'
    || action.kind === 'readWorkspaceReference'
    || action.kind === 'promoteWorkspaceReferenceToProjectFile'
    || action.kind === 'pinProjectFileAsReference'
    || action.kind === 'searchReadableContext'
    || action.kind === 'checkProjectPreview'
    || action.kind === 'inspectProjectRuntime'
    || action.kind === 'appendProjectFile'
    || action.kind === 'insertProjectFile'
    || action.kind === 'replaceProjectFileLines'
    || action.kind === 'editProjectFileText'
    || action.kind === 'deleteProjectFile'
    || action.kind === 'readProjectFile'
    || action.kind === 'readProjectFileContext';
}

export function findDuplicateWriteTargetError(args: {
  action: AssistantToolAction;
  projectFiles: ProjectFile[];
  activeProjectId?: string | null;
}) {
  const findDuplicateCount = (projectId: string, filePath: string) =>
    args.projectFiles.filter((file) =>
      file.projectId === projectId
      && normalizeCodeCardFilePath(file.filePath) === filePath
    ).length;

  if (args.action.kind === 'createProjectFile') {
    const projectId = args.action.file.projectId?.trim() || args.activeProjectId?.trim();
    const filePath = normalizeCodeCardFilePath(args.action.file.filePath);
    if (!projectId || !filePath) return null;
    const duplicateCount = findDuplicateCount(projectId, filePath);
    return duplicateCount > 1 ? buildDuplicateProjectFilePathError(projectId, filePath, duplicateCount) : null;
  }

  if (args.action.kind === 'promoteWorkspaceReferenceToProjectFile') {
    const projectId = args.action.projectId?.trim() || args.activeProjectId?.trim();
    const filePath = normalizeCodeCardFilePath(args.action.filePath);
    if (!projectId || !filePath) return null;
    const duplicateCount = findDuplicateCount(projectId, filePath);
    return duplicateCount > 1 ? buildDuplicateProjectFilePathError(projectId, filePath, duplicateCount) : null;
  }

  if (args.action.kind !== 'writeProjectFiles') return null;

  const projectId = args.activeProjectId?.trim();
  if (!projectId) return null;

  const seenFilePaths = new Set<string>();
  for (const file of args.action.files) {
    const normalizedFilePath = normalizeCodeCardFilePath(file.filePath);
    if (!normalizedFilePath) continue;
    if (seenFilePaths.has(normalizedFilePath)) {
      return `这次写入里重复出现 ${normalizedFilePath}，不能猜哪一份是最终内容。请把同一路径合成一次写入。`;
    }
    seenFilePaths.add(normalizedFilePath);

    const duplicateCount = findDuplicateCount(projectId, normalizedFilePath);
    if (duplicateCount > 1) {
      return buildDuplicateProjectFilePathError(projectId, normalizedFilePath, duplicateCount);
    }
  }

  return null;
}
