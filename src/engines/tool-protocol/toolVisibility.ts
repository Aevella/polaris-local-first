import type { AssistantToolActionKind } from '../toolActionTypes';
import type {
  AssistantToolContext
} from './assistantToolProtocolTypes';
import { isPolarisRegistryToolGroupEnabled } from './toolAvailability';
import type { PolarisToolDefinition } from './toolRegistryShared';

export type ToolVisibilityUserContext =
  | 'chat-only'
  | 'in-room'
  | 'in-workspace'
  | 'pending-workspace-proposal';

export type ToolVisibilityTaskStage =
  | 'seed-bare'
  | 'seed-contexted'
  | 'active';

export type ToolVisibilityState = {
  userContext: ToolVisibilityUserContext;
  taskStage: ToolVisibilityTaskStage;
  themeMode: NonNullable<AssistantToolContext['themeToolMode']>;
  enabled: AssistantToolContext['enabledToolGroups'];
  toolEnforcementScope: AssistantToolContext['toolEnforcementScope'];
};

export type PolarisToolVisibilityContext = Partial<Pick<
  AssistantToolContext,
  | 'activeProject'
  | 'activeCard'
  | 'roomContextMode'
  | 'runtimeFeedback'
  | 'enabledToolGroups'
  | 'themeToolMode'
  | 'toolEnforcementScope'
  | 'taskMode'
  | 'imageGenerationAvailable'
  | 'memorySearchAvailable'
  | 'attachmentSnapshot'
  | 'imageAssetSnapshot'
  | 'desktopLocalHost'
  | 'personalData'
>> & {
  activeProjectId?: string | null;
};

function hasActiveWorkspace(context?: PolarisToolVisibilityContext) {
  return Boolean(context?.activeProject);
}

function resolveUserContext(context?: PolarisToolVisibilityContext): ToolVisibilityUserContext {
  if (hasActiveWorkspace(context)) return 'in-workspace';
  if (context?.runtimeFeedback?.pendingWorkspaceProposal) return 'pending-workspace-proposal';
  if (context?.activeCard || context?.roomContextMode === 'active') return 'in-room';
  return 'chat-only';
}

function resolveTaskStage(args: {
  context?: PolarisToolVisibilityContext;
  userContext: ToolVisibilityUserContext;
}): ToolVisibilityTaskStage {
  if ((args.context?.taskMode ?? 'active') === 'active') return 'active';
  return args.userContext === 'chat-only' ? 'seed-bare' : 'seed-contexted';
}

function isThemeActionKind(kind: AssistantToolActionKind) {
  return kind === 'applyThemeCoordinates'
    || kind === 'applySurfaceTokens'
    || kind === 'patchRawCss'
    || kind === 'readThemeCss'
    || kind === 'editThemeCss'
    || kind === 'appendThemeCss'
    || kind === 'insertThemeCss'
    || kind === 'deleteThemeCss'
    || kind === 'replaceThemeCss'
    || kind === 'inspectThemeRender'
    || kind === 'applyPreset';
}

function isModelWorkspaceBoundaryActionKind(kind: AssistantToolActionKind) {
  return kind === 'createRoomProject' || kind === 'promoteCardToProject';
}

function matchesThemeMode(tool: PolarisToolDefinition, state: ToolVisibilityState) {
  if (tool.group === 'theme-stable') return state.themeMode === 'stable';
  if (tool.group === 'theme-creative') return state.themeMode === 'creative';
  return true;
}

function isEnabledByPreferences(tool: PolarisToolDefinition, state: ToolVisibilityState) {
  if (tool.group === 'project' && state.userContext === 'in-workspace') {
    return state.toolEnforcementScope !== 'theme-only';
  }

  return isPolarisRegistryToolGroupEnabled(
    state.enabled,
    tool.group,
    state.toolEnforcementScope
  );
}

function hasAvailableAttachment(context?: PolarisToolVisibilityContext) {
  return (context?.attachmentSnapshot?.available.length ?? 0) > 0;
}

function hasAvailableArchiveAttachment(context?: PolarisToolVisibilityContext) {
  return (context?.attachmentSnapshot?.available ?? []).some((attachment) => {
    const mimeType = attachment.mimeType?.trim().toLowerCase() ?? '';
    const name = attachment.name.trim().toLowerCase();
    return mimeType.includes('zip') || name.endsWith('.zip');
  });
}

function hasAvailableDesktopLocalHost(context?: PolarisToolVisibilityContext) {
  const host = context?.desktopLocalHost;
  return Boolean(host?.available && host.trustedRoots.length > 0);
}

function hasAvailableImageGeneration(context?: PolarisToolVisibilityContext) {
  return context?.imageGenerationAvailable === true;
}

function hasAvailableMemorySearch(context?: PolarisToolVisibilityContext) {
  return context?.memorySearchAvailable === true;
}

function hasAvailablePersonalDataTool(tool: PolarisToolDefinition, context?: PolarisToolVisibilityContext) {
  if (tool.name === 'listCalendars' || tool.name === 'readCalendarEvents') {
    return context?.personalData?.calendarAvailable === true;
  }
  if (tool.name === 'createCalendarEvent') {
    return context?.personalData?.calendarWriteAvailable === true;
  }
  if (tool.name === 'updateCalendarEvent' || tool.name === 'deleteCalendarEvent') {
    return context?.personalData?.calendarAvailable === true
      && context.personalData.calendarWriteAvailable === true;
  }
  return true;
}

function hasWorkspacePreviewStateAccess(context?: PolarisToolVisibilityContext) {
  return context?.activeProject?.previewStateAccess?.assistantReadEnabled === true;
}

function isOldMemorySearchTool(tool: PolarisToolDefinition) {
  return tool.name === 'searchMemory' || tool.name === 'openMemorySource';
}

export function resolveToolVisibilityState(
  context?: PolarisToolVisibilityContext
): ToolVisibilityState {
  const userContext = resolveUserContext(context);
  return {
    userContext,
    taskStage: resolveTaskStage({ context, userContext }),
    themeMode: context?.themeToolMode ?? 'stable',
    enabled: context?.enabledToolGroups,
    toolEnforcementScope: context?.toolEnforcementScope
  };
}

function resolveContentToolScene(state: ToolVisibilityState) {
  return state.userContext === 'in-workspace' ? 'workspace' : 'room';
}

function isRoomContentTool(tool: PolarisToolDefinition) {
  return tool.group === 'card' && tool.name !== 'runCode';
}

export function isPolarisNativeToolVisible(
  tool: PolarisToolDefinition,
  context?: PolarisToolVisibilityContext
) {
  const visibilityState = resolveToolVisibilityState(context);
  if (tool.name === 'startTask' && visibilityState.taskStage === 'active') {
    return false;
  }
  if (tool.name === 'completeTask' && visibilityState.taskStage !== 'active') {
    return false;
  }

  const contentToolScene = resolveContentToolScene(visibilityState);
  const sceneMatches =
    isRoomContentTool(tool)
      ? contentToolScene === 'room'
      : tool.group === 'project'
        ? contentToolScene === 'workspace'
        : tool.group === 'cross-boundary'
          ? false
          : true;

  if (!matchesThemeMode(tool, visibilityState)) return false;
  if (!sceneMatches) return false;
  if (tool.group === 'attachment' && tool.name !== 'sendImageAttachment' && !hasAvailableAttachment(context)) {
    return false;
  }
  if (tool.group === 'archive' && !hasAvailableArchiveAttachment(context)) {
    return false;
  }
  if (tool.group === 'desktop' && !hasAvailableDesktopLocalHost(context)) {
    return false;
  }
  if (tool.name === 'generateImage' && !hasAvailableImageGeneration(context)) {
    return false;
  }
  if (isOldMemorySearchTool(tool) && !hasAvailableMemorySearch(context)) {
    return false;
  }
  if (tool.group === 'personalData' && !hasAvailablePersonalDataTool(tool, context)) {
    return false;
  }
  if (tool.name === 'readWorkspacePreviewState' && !hasWorkspacePreviewStateAccess(context)) {
    return false;
  }
  if ((tool.group === 'theme-stable' || tool.group === 'theme-creative') && visibilityState.userContext === 'in-workspace') {
    return false;
  }

  return isEnabledByPreferences(tool, visibilityState);
}

export function isParsedAssistantActionVisible(args: {
  actionKind: AssistantToolActionKind;
  tool?: PolarisToolDefinition;
  context?: Pick<
    PolarisToolVisibilityContext,
    'activeProject' | 'activeProjectId' | 'enabledToolGroups' | 'themeToolMode' | 'toolEnforcementScope'
    | 'desktopLocalHost' | 'imageGenerationAvailable' | 'memorySearchAvailable' | 'attachmentSnapshot'
    | 'imageAssetSnapshot' | 'personalData'
  >;
}) {
  const { actionKind, tool, context } = args;
  const visibilityState = resolveToolVisibilityState(context);
  if (actionKind === 'startTask') {
    return context?.toolEnforcementScope !== 'theme-only'
      && isPolarisRegistryToolGroupEnabled(context?.enabledToolGroups, 'task', context?.toolEnforcementScope);
  }
  if (!tool) return false;
  if (isModelWorkspaceBoundaryActionKind(actionKind)) return false;
  if ((context?.activeProject || context?.activeProjectId) && isThemeActionKind(actionKind)) return false;
  if (tool.group === 'project') {
    return context?.toolEnforcementScope !== 'theme-only'
      && Boolean(context?.activeProject || context?.activeProjectId);
  }
  if (tool.group === 'desktop') {
    return matchesThemeMode(tool, visibilityState)
      && isEnabledByPreferences(tool, visibilityState)
      && hasAvailableDesktopLocalHost(context);
  }
  if (tool.name === 'generateImage' && !hasAvailableImageGeneration(context)) {
    return false;
  }
  if (isOldMemorySearchTool(tool) && !hasAvailableMemorySearch(context)) {
    return false;
  }
  if (tool.group === 'personalData' && !hasAvailablePersonalDataTool(tool, context)) {
    return false;
  }
  if (tool.name === 'readWorkspacePreviewState' && !hasWorkspacePreviewStateAccess(context)) {
    return false;
  }
  return matchesThemeMode(tool, visibilityState) && isEnabledByPreferences(tool, visibilityState);
}
