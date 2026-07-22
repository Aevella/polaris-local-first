import { getDesktopLocalHostBridge } from '../../desktop/localHost';
import { normalizeCodeCardFilePath } from '../../engines/roomProjects';
import type { ToolContext } from '../../engines/toolExecutorTypes';
import { buildDesktopWorkspaceFileSyncMap, buildDesktopWorkspaceManifestContent, createDesktopWorkspaceFileSyncEntry, DESKTOP_WORKSPACE_MANIFEST_PATH, inferDesktopWorkspaceFileLanguage, planDesktopWorkspaceDiskImport, planDesktopWorkspaceDiskWrite } from '../desktop/desktopWorkspaceBinding';
import { inferManualProjectFileRole } from '../collection/projectWorkspaceCreation';
import type { ToolActionCollectionState } from './chatToolActionTypes';

function formatDesktopSyncIssueBlock(kind: 'conflict' | 'overwrite', paths: string[]) {
  if (!paths.length) return '';
  const title = kind === 'conflict' ? '两边都改过' : '将覆盖同路径文件';
  const preview = paths.slice(0, 8).map((path) => `- ${path}`).join('\n');
  return paths.length > 8
    ? `${title}：\n${preview}\n- 还有 ${paths.length - 8} 个文件`
    : `${title}：\n${preview}`;
}
function buildDesktopSyncBlockedError(directionLabel: string, issues: Array<{ path: string; kind: 'conflict' | 'overwrite' }>) {
  const conflicts = issues.filter((issue) => issue.kind === 'conflict').map((issue) => issue.path);
  const overwrites = issues.filter((issue) => issue.kind === 'overwrite').map((issue) => issue.path);
  return [
    `${directionLabel}会覆盖真实工作区内容，已先停下。`,
    formatDesktopSyncIssueBlock('conflict', conflicts),
    formatDesktopSyncIssueBlock('overwrite', overwrites),
    '需要继续时，先向用户说明这些文件会被覆盖；用户明确同意后再用 allowOverwrite=true 重试。'
  ].filter(Boolean).join('\n\n');
}

function resolveDesktopSyncProject(args: {
  collection: ToolActionCollectionState;
  activeProjectId: string | null;
  projectId?: string;
}) {
  const resolvedProjectId = args.projectId?.trim() || args.activeProjectId;
  if (!resolvedProjectId) return { ok: false as const, error: '当前没有活动工作区，不能同步桌面工作区。' };
  const project = args.collection.readLatestState().roomProjects.find((entry) => entry.id === resolvedProjectId) ?? null;
  if (!project) return { ok: false as const, error: `没有找到工作区：${resolvedProjectId}` };
  if (!project.desktopBinding) return { ok: false as const, error: `工作区“${project.title}”没有绑定 Mac 本机文件夹。` };
  return { ok: true as const, project };
}

function assertDesktopSyncRoot(projectRootId: string, requestedRootId?: string) {
  const rootId = requestedRootId?.trim();
  if (rootId && rootId !== projectRootId) {
    return { ok: false as const, error: `rootId 与当前工作区绑定不一致：${rootId} !== ${projectRootId}` };
  }
  return { ok: true as const };
}

export function buildDesktopToolExecutionContext(args: {
  collection: ToolActionCollectionState;
  activeProjectId: string | null;
}): Pick<ToolContext, 'syncDesktopWorkspaceFromDisk' | 'syncDesktopWorkspaceToDisk' | 'desktopLocalHost'> {
  const { collection, activeProjectId } = args;
  return {
    syncDesktopWorkspaceFromDisk: async ({ projectId, rootId, allowOverwrite }) => {
      const bridge = getDesktopLocalHostBridge();
      if (!bridge) return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能同步本机工作区。' };
      const resolvedProject = resolveDesktopSyncProject({ collection, activeProjectId, projectId });
      if (!resolvedProject.ok) return resolvedProject;
      const project = resolvedProject.project;
      const rootCheck = assertDesktopSyncRoot(project.desktopBinding!.rootId, rootId);
      if (!rootCheck.ok) return rootCheck;

      const diskSnapshot = await bridge.readWorkspaceFiles({ rootId: project.desktopBinding!.rootId });
      const projectFilesBeforeSync = collection.readLatestState().projectFiles.filter((file) => file.projectId === project.id);
      const plan = planDesktopWorkspaceDiskImport({
        diskFiles: diskSnapshot.files,
        projectFiles: projectFilesBeforeSync,
        fileSync: project.desktopBinding!.fileSync
      });
      if (plan.issues.length > 0 && !allowOverwrite) {
        return { ok: false, error: buildDesktopSyncBlockedError('从电脑读入', plan.issues) };
      }

      const syncedAt = Date.now();
      let entryFileId = project.entryFileId;
      for (const file of diskSnapshot.files) {
        const filePath = normalizeCodeCardFilePath(file.relativePath);
        if (!filePath) continue;
        const language = inferDesktopWorkspaceFileLanguage(filePath, file.content);
        const fileRole = inferManualProjectFileRole(filePath, language);
        const currentFile = collection.readLatestState().projectFiles.find((candidate) =>
          candidate.projectId === project.id
          && normalizeCodeCardFilePath(candidate.filePath) === filePath
        );
        const fileId = currentFile
          ? currentFile.id
          : collection.createProjectFile({
              projectId: project.id,
              filePath,
              fileRole,
              language,
              content: file.content,
              ownerCollaboratorId: project.ownerCollaboratorId,
              source: 'manual'
            });
        if (!fileId) continue;
        if (currentFile && (
          currentFile.content !== file.content
          || currentFile.language !== language
          || currentFile.fileRole !== fileRole
        )) {
          collection.updateProjectFile(currentFile.id, {
            content: file.content,
            language,
            fileRole,
            source: 'manual'
          });
        }
        if (filePath === project.desktopBinding!.entryFilePath) {
          entryFileId = fileId;
        }
      }

      const projectFileByPath = new Map(
        collection.readLatestState().projectFiles
          .filter((file) => file.projectId === project.id)
          .flatMap((file) => {
            const path = normalizeCodeCardFilePath(file.filePath);
            return path ? [[path, file] as const] : [];
          })
      );
      const fileSyncEntries = diskSnapshot.files.flatMap((file) => {
        const path = normalizeCodeCardFilePath(file.relativePath);
        const projectFile = path ? projectFileByPath.get(path) : null;
        const entry = projectFile ? createDesktopWorkspaceFileSyncEntry({
          relativePath: file.relativePath,
          diskContent: file.content,
          polarisContent: projectFile.content,
          diskUpdatedAt: file.updatedAt,
          polarisUpdatedAt: projectFile.updatedAt,
          syncedAt
        }) : null;
        return entry ? [entry] : [];
      });
      collection.updateProject(project.id, {
        entryFileId,
        desktopBinding: {
          ...project.desktopBinding!,
          syncedAt,
          fileSync: {
            ...(project.desktopBinding!.fileSync ?? {}),
            ...buildDesktopWorkspaceFileSyncMap(fileSyncEntries)
          }
        }
      });
      return {
        ok: true,
        summary: `已从电脑读入工作区 · ${project.title}`,
        detailText: [
          `rootId=${project.desktopBinding!.rootId}`,
          `changedFiles=${plan.changedFiles.length}`,
          `overwriteWarnings=${plan.issues.length}`,
          plan.changedFiles.length ? plan.changedFiles.map((path) => `- ${path}`).join('\n') : '没有文件变化。'
        ].join('\n')
      };
    },
    syncDesktopWorkspaceToDisk: async ({ projectId, rootId, allowOverwrite }) => {
      const bridge = getDesktopLocalHostBridge();
      if (!bridge) return { ok: false, error: '当前不是官网 Mac 桌面宿主，不能同步本机工作区。' };
      const resolvedProject = resolveDesktopSyncProject({ collection, activeProjectId, projectId });
      if (!resolvedProject.ok) return resolvedProject;
      const project = resolvedProject.project;
      const rootCheck = assertDesktopSyncRoot(project.desktopBinding!.rootId, rootId);
      if (!rootCheck.ok) return rootCheck;

      const diskSnapshot = await bridge.readWorkspaceFiles({ rootId: project.desktopBinding!.rootId });
      const projectFiles = collection.readLatestState().projectFiles.filter((file) => file.projectId === project.id);
      const plan = planDesktopWorkspaceDiskWrite({
        diskFiles: diskSnapshot.files,
        projectFiles,
        fileSync: project.desktopBinding!.fileSync
      });
      if (plan.issues.length > 0 && !allowOverwrite) {
        return { ok: false, error: buildDesktopSyncBlockedError('送到电脑', plan.issues) };
      }

      const files = projectFiles.flatMap((file) => {
        const relativePath = normalizeCodeCardFilePath(file.filePath);
        return relativePath && relativePath !== DESKTOP_WORKSPACE_MANIFEST_PATH && !relativePath.startsWith('.polaris/')
          ? [{ relativePath, content: file.content }]
          : [];
      });
      const syncedAt = Date.now();
      const result = await bridge.writeWorkspaceFiles({
        rootId: project.desktopBinding!.rootId,
        files: [
          ...files,
          {
            relativePath: DESKTOP_WORKSPACE_MANIFEST_PATH,
            content: buildDesktopWorkspaceManifestContent({
              projectId: project.id,
              title: project.title,
              entryFilePath: project.desktopBinding!.entryFilePath,
              updatedAt: syncedAt
            })
          }
        ]
      });
      const projectFileByPath = new Map(
        projectFiles.flatMap((file) => {
          const path = normalizeCodeCardFilePath(file.filePath);
          return path ? [[path, file] as const] : [];
        })
      );
      const fileSyncEntries = result.writtenFiles.flatMap((file) => {
        if (file.relativePath === DESKTOP_WORKSPACE_MANIFEST_PATH || file.relativePath.startsWith('.polaris/')) return [];
        const projectFile = projectFileByPath.get(file.relativePath);
        const entry = projectFile ? createDesktopWorkspaceFileSyncEntry({
          relativePath: file.relativePath,
          diskContent: projectFile.content,
          polarisContent: projectFile.content,
          diskUpdatedAt: syncedAt,
          polarisUpdatedAt: projectFile.updatedAt,
          syncedAt
        }) : null;
        return entry ? [entry] : [];
      });
      collection.updateProject(project.id, {
        desktopBinding: {
          ...project.desktopBinding!,
          syncedAt,
          fileSync: {
            ...(project.desktopBinding!.fileSync ?? {}),
            ...buildDesktopWorkspaceFileSyncMap(fileSyncEntries)
          }
        }
      });
      return {
        ok: true,
        summary: `已送到电脑工作区 · ${project.title}`,
        detailText: [
          `rootId=${project.desktopBinding!.rootId}`,
          `writtenFiles=${Math.max(0, result.writtenFiles.length - 1)}`,
          `overwriteWarnings=${plan.issues.length}`,
          plan.changedFiles.length ? plan.changedFiles.map((path) => `- ${path}`).join('\n') : '没有文件变化。'
        ].join('\n')
      };
    },
    desktopLocalHost: getDesktopLocalHostBridge() ?? undefined,
  };
}
