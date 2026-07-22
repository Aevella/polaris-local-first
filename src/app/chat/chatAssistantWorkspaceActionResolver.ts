import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolAction } from '../../engines/assistantToolProtocol';
import type { ProjectFile } from '../../types/domain';
import type { RoomProjectTreeSnapshot } from '../../engines/roomProjects';
import { buildMissingProjectFileTargetError, buildMissingProjectTargetError, findProjectFileByProjectPath, findProjectFileByTarget, formatResolvedTargetLabel } from './chatAssistantTargetResolution';

export function resolveAssistantWorkspaceAction(args: { action: AssistantToolAction; projectFiles: ProjectFile[]; projectScopes: Pick<RoomProjectTreeSnapshot, 'id' | 'title' | 'slug'>[]; activeProjectId?: string | null }): { resolved: ToolAction[]; errors: string[] } | null {
  const { action, projectFiles, projectScopes, activeProjectId } = args;
  const resolved: ToolAction[] = [];
  const errors: string[] = [];
  switch (action.kind) {
      case 'appendProjectFile': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'appendProjectFile',
            fileId: targetFile.file.id,
            code: action.code,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'insertProjectFile': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'insertProjectFile',
            fileId: targetFile.file.id,
            beforeString: action.beforeString,
            afterString: action.beforeString || action.lineNumber ? undefined : action.afterString,
            lineNumber: action.lineNumber,
            linePosition: action.linePosition,
            code: action.code,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'replaceProjectFileLines': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'replaceProjectFileLines',
            fileId: targetFile.file.id,
            startLine: action.startLine,
            endLine: action.endLine,
            code: action.code,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'writeProjectFiles': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'writeProjectFiles',
          projectId,
          files: action.files.map((file) => ({
            ...file,
            projectId,
            replaceContent: file.replaceContent ?? true
          })),
          targetLabel: action.targetLabel,
          openInCollection: action.openInCollection ?? false
        });
        break;
      }
      case 'patchRoomProject': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectTargetError());
          break;
        }
        resolved.push({
          kind: 'patchRoomProject',
          projectId,
          patch: action.patch,
          targetLabel: action.targetLabel,
          openInCollection: action.openInCollection ?? true
        });
        break;
      }
      case 'listProjectFiles':
      case 'listWorkspaceReferences':
      case 'checkProjectPreview': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: action.kind,
          projectId,
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'searchWorkspaceReferences': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'searchWorkspaceReferences',
          projectId,
          query: action.query,
          maxResults: action.maxResults,
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'readWorkspaceReference': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'readWorkspaceReference',
          projectId,
          docId: action.docId,
          title: action.title,
          targetLabel: action.targetLabel || action.title || action.docId
        });
        break;
      }
      case 'promoteWorkspaceReferenceToProjectFile': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'promoteWorkspaceReferenceToProjectFile',
          projectId,
          docId: action.docId,
          title: action.title,
          filePath: action.filePath,
          fileRole: action.fileRole,
          language: action.language,
          replaceContent: action.replaceContent ?? true,
          targetLabel: action.targetLabel || action.title || action.docId || action.filePath,
          openInCollection: action.openInCollection ?? false
        });
        break;
      }
      case 'pinProjectFileAsReference': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'pinProjectFileAsReference',
            fileId: targetFile.file.id,
            projectId: targetFile.file.projectId,
            title: action.title,
            summary: action.summary,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || action.title || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'inspectProjectRuntime': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'inspectProjectRuntime',
          projectId,
          settleMs: action.settleMs,
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'searchProjectFiles': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'searchProjectFiles',
          projectId,
          query: action.query,
          maxResults: action.maxResults,
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'readWorkspacePreviewState': {
        const projectId = activeProjectId?.trim() || '';
        if (!projectId) {
          errors.push(buildMissingProjectFileTargetError());
          break;
        }
        resolved.push({
          kind: 'readWorkspacePreviewState',
          projectId,
          targetLabel: action.targetLabel
        });
        break;
      }
      case 'editProjectFileText': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'editProjectFileText',
            fileId: targetFile.file.id,
            oldString: action.oldString,
            newString: action.newString,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'deleteProjectFile': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'deleteProjectFile',
            fileId: targetFile.file.id,
            targetLabel: formatResolvedTargetLabel(
              targetFile,
              action.targetLabel || targetFile.file.filePath
            ),
            openInCollection: action.openInCollection ?? false
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'readProjectFile': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'readProjectFile',
            fileId: targetFile.file.id,
            targetLabel: action.targetLabel || targetFile.file.filePath
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
      case 'readProjectFileContext': {
        const targetFile = findProjectFileByProjectPath(
          projectFiles,
          projectScopes,
          action.projectId,
          action.filePath,
          activeProjectId
        )
          ?? findProjectFileByTarget(projectFiles, action.target, activeProjectId);
        if (targetFile?.ok) {
          resolved.push({
            kind: 'readProjectFileContext',
            fileId: targetFile.file.id,
            query: action.query,
            lineNumber: action.lineNumber,
            before: action.before,
            after: action.after,
            occurrence: action.occurrence,
            targetLabel: action.targetLabel || targetFile.file.filePath
          });
          break;
        }
        errors.push(targetFile && !targetFile.ok ? targetFile.error : buildMissingProjectFileTargetError());
        break;
      }
    default:
      return null;
  }
  return { resolved, errors };
}
