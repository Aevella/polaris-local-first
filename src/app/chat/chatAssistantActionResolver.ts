import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolAction } from '../../engines/assistantToolProtocol';
import type { AssistantToolContext, AssistantToolEnforcementScope, PolarisToolPromptGroup, PolarisToolPromptPreferences } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import { POLARIS_TOOL_PROMPT_GROUP_LABELS } from '../../engines/tool-protocol/toolPromptPreferences';
import type { CodeCard, ProjectFile, ThemeToolMode } from '../../types/domain';
import type { RoomProjectTreeSnapshot } from '../../engines/roomProjects';
import { resolveAssistantActionAccess } from '../../engines/tool-protocol/toolActionAccess';
import { isDirectAssistantToolAction } from '../../engines/toolActionKinds';
import { resolveAssistantCardAction } from './chatAssistantCardActionResolver';
import { buildProjectBoundaryError, findDuplicateWriteTargetError, isModelWorkspaceAction, resolveProjectActionBoundaryId } from './chatAssistantTargetResolution';
import { resolveAssistantWorkspaceAction } from './chatAssistantWorkspaceActionResolver';

function unavailableToolActionError(group: PolarisToolPromptGroup) {
  return `当前没有“${POLARIS_TOOL_PROMPT_GROUP_LABELS[group]}”能力。`;
}
type ResolveAssistantToolActionsArgs = {
  actions: AssistantToolAction[];
  cards: CodeCard[];
  projectFiles?: ProjectFile[];
  projectScopes?: Pick<RoomProjectTreeSnapshot, 'id' | 'title' | 'slug'>[];
  activeCardId: string | null;
  activeProjectId?: string | null;
  enabledToolGroups?: PolarisToolPromptPreferences;
  toolEnforcementScope?: AssistantToolEnforcementScope;
  themeToolMode?: ThemeToolMode;
  availableToolNames?: ReadonlySet<string>;
  desktopLocalHost?: AssistantToolContext['desktopLocalHost'];
  imageGenerationAvailable?: boolean;
  memorySearchAvailable?: boolean;
  attachmentSnapshot?: AssistantToolContext['attachmentSnapshot'];
  imageAssetSnapshot?: AssistantToolContext['imageAssetSnapshot'];
  personalData?: AssistantToolContext['personalData'];
};

export function resolveAssistantToolActions({
  actions,
  cards,
  projectFiles = [],
  projectScopes = [],
  activeCardId,
  activeProjectId,
  enabledToolGroups,
  toolEnforcementScope,
  themeToolMode,
  availableToolNames,
  desktopLocalHost,
  imageGenerationAvailable,
  memorySearchAvailable,
  attachmentSnapshot,
  imageAssetSnapshot,
  personalData
}: ResolveAssistantToolActionsArgs): {
  resolved: ToolAction[];
  errors: string[];
} {
  const resolved: ToolAction[] = [];
  const errors: string[] = [];

  for (const action of actions) {
    if (action.kind === 'createRoomProject' || action.kind === 'promoteCardToProject') {
      errors.push('工作区边界由用户决定。请让用户先新建、进入或切换工作区；模型不能直接创建、升格或切换工作区。');
      continue;
    }

    const workspaceBoundaryError = isModelWorkspaceAction(action)
      ? buildProjectBoundaryError(resolveProjectActionBoundaryId(action), activeProjectId)
      : null;
    if (workspaceBoundaryError) {
      errors.push(workspaceBoundaryError);
      continue;
    }

    if (action.kind === 'invokeMcpTool') {
      const isVisibleMcpTool =
        action.schemaName
          ? availableToolNames ? availableToolNames.has(action.schemaName) : true
          : true;
      if (toolEnforcementScope === 'theme-only' || !isVisibleMcpTool) {
        errors.push('当前没有“MCP”能力。');
        continue;
      }
      resolved.push(action);
      continue;
    }

    const access = resolveAssistantActionAccess(action, {
      activeProjectId,
      enabledToolGroups,
      toolEnforcementScope,
      themeToolMode,
      availableToolNames,
      desktopLocalHost,
      imageGenerationAvailable,
      memorySearchAvailable,
      attachmentSnapshot,
      imageAssetSnapshot,
      personalData
    });
    if (!access.visible) {
      if (access.promptGroup === 'theme' && activeProjectId) {
        errors.push('当前是工作区对话，界面换肤工具不会在这里执行。要写 CSS，请写入当前工作区的样式文件；要改 Polaris 外观，请离开工作区后再打开换肤工具。');
        continue;
      }
      errors.push(unavailableToolActionError(access.promptGroup));
      continue;
    }

    if (isModelWorkspaceAction(action)) {
      const duplicateWriteTargetError = findDuplicateWriteTargetError({
        action,
        projectFiles,
        activeProjectId
      });
      if (duplicateWriteTargetError) {
        errors.push(duplicateWriteTargetError);
        continue;
      }
    }

    if (isDirectAssistantToolAction(action)) {
      resolved.push(action);
      continue;
    }

    const collectionResolution = resolveAssistantCardAction({ action, cards, activeCardId })
      ?? resolveAssistantWorkspaceAction({ action, projectFiles, projectScopes, activeProjectId });
    if (!collectionResolution) {
      throw new Error(`Unhandled assistant collection action: ${action.kind}`);
    }
    resolved.push(...collectionResolution.resolved);
    errors.push(...collectionResolution.errors);
  }

  return { resolved, errors };
}
