import type {
  ThemeRecipeMeta,
  ThemeToolPatchMode,
  ThemeSurfaceId,
  ThemeToolScope,
  ThemeVariables,
  ToolInvocationKind
} from '../types/domain';
import type { ToolAction } from './toolExecutorTypes';
import { describeMemoryToolAction } from './toolExecutorDescribeMemory';
import { describeProactiveMessageToolAction } from './toolExecutorDescribeProactiveMessage';
import { describeTaskToolAction } from './toolExecutorDescribeTask';
import { describeToolInvocationToolAction } from './toolExecutorDescribeToolInvocation';
import { describeDesktopToolAction } from './toolExecutorDescribeDesktop';
import { describeKnowledgeEnvironmentToolAction } from './toolExecutorDescribeKnowledgeEnvironment';
import { describeAttachmentsToolAction } from './toolExecutorDescribeAttachments';
import { describeWorkspaceToolAction } from './toolExecutorDescribeWorkspace';
import { describeThemeCssToolAction } from './toolExecutorDescribeThemeCss';

function assertNever(value: never): never {
  throw new Error(`Unhandled tool action: ${JSON.stringify(value)}`);
}

export function isPreviewableToolAction(action: ToolAction): boolean {
  return (
    action.kind === 'applyThemeCoordinates'
    || action.kind === 'applySurfaceTokens'
    || action.kind === 'patchRawCss'
    || action.kind === 'editThemeCss'
    || action.kind === 'appendThemeCss'
    || action.kind === 'insertThemeCss'
    || action.kind === 'deleteThemeCss'
    || action.kind === 'replaceThemeCss'
    || action.kind === 'applyPreset'
  );
}

export function getToolActionVariables(_action: ToolAction): ThemeVariables | null {
  return null;
}


export type ToolActionDescription = {
  kind: ToolInvocationKind;
  title: string;
  summary: string;
  themeScope?: ThemeToolScope;
  themeSurfaceIds?: ThemeSurfaceId[];
  themeSurfaceLabels?: string[];
  themePatchMode?: ThemeToolPatchMode;
  themeTransactionReason?: string;
  themeIntentLabel?: string;
  themeRecipe?: ThemeRecipeMeta;
  targetLabel?: string;
  memoryItems?: string[];
};

export function describeToolAction(action: ToolAction): ToolActionDescription {
  switch (action.kind) {
    case 'applyThemeCoordinates':
    case 'applySurfaceTokens':
    case 'patchRawCss':
    case 'readThemeCss':
      return describeThemeCssToolAction(action);
    case 'readPolarisKnowledge':
    case 'listEnvironmentNodes':
    case 'inspectEnvironmentNode':
    case 'searchEnvironmentNodes':
      return describeKnowledgeEnvironmentToolAction(action);
    case 'editThemeCss':
    case 'appendThemeCss':
    case 'insertThemeCss':
    case 'deleteThemeCss':
    case 'replaceThemeCss':
    case 'inspectThemeRender':
    case 'applyPreset':
      return describeThemeCssToolAction(action);
    case 'switchWorld':
    case 'createRoomProject':
    case 'createCodeCard':
    case 'createProjectFile':
    case 'patchRoomProject':
    case 'writeProjectFiles':
    case 'listProjectFiles':
    case 'searchProjectFiles':
    case 'readWorkspacePreviewState':
    case 'listWorkspaceReferences':
    case 'searchWorkspaceReferences':
    case 'readWorkspaceReference':
    case 'promoteWorkspaceReferenceToProjectFile':
    case 'pinProjectFileAsReference':
    case 'searchReadableContext':
    case 'checkProjectPreview':
    case 'inspectProjectRuntime':
    case 'promoteCardToProject':
    case 'patchCodeCard':
    case 'appendCodeCard':
    case 'appendProjectFile':
    case 'insertProjectFile':
    case 'replaceProjectFileLines':
    case 'editCodeCardText':
    case 'editProjectFileText':
      return describeWorkspaceToolAction(action);
    case 'editDesktopFileText':
    case 'searchDesktopFiles':
    case 'readDesktopFileContext':
    case 'replaceDesktopFileLines':
      return describeDesktopToolAction(action);
    case 'deleteProjectFile':
    case 'listCodeCards':
    case 'readCodeCard':
    case 'readProjectFile':
    case 'readProjectFileContext':
      return describeWorkspaceToolAction(action);
    case 'writeMemory':
    case 'writeMemoryDoc':
    case 'readMemoryDoc':
    case 'searchMemory':
    case 'openMemorySource':
      return describeMemoryToolAction(action);
    case 'startTask':
    case 'completeTask':
    case 'wait':
      return describeTaskToolAction(action);
    case 'createProactiveMessageRule':
    case 'listProactiveMessageRules':
    case 'updateProactiveMessageRule':
    case 'deleteProactiveMessageRule':
      return describeProactiveMessageToolAction(action);
    case 'inspectAttachments':
    case 'webSearch':
    case 'readWebPage':
    case 'listCalendars':
    case 'readCalendarEvents':
    case 'createCalendarEvent':
    case 'updateCalendarEvent':
    case 'deleteCalendarEvent':
    case 'readAttachmentText':
    case 'bundleAttachments':
    case 'createQrCode':
    case 'generateImage':
    case 'sendImageAttachment':
    case 'inspectImageAsset':
    case 'extractImagePalette':
    case 'createImageVariant':
    case 'saveAttachmentToCollection':
    case 'saveAttachmentAsCodeCard':
    case 'inspectArchiveEntries':
    case 'readArchiveEntryText':
    case 'bundleArchiveEntries':
    case 'saveArchiveEntryAsCodeCard':
    case 'runCode':
      return describeAttachmentsToolAction(action);
    case 'listDesktopWorkspaces':
    case 'listDesktopFiles':
    case 'readDesktopFile':
    case 'writeDesktopFile':
    case 'createDesktopDirectory':
    case 'deleteDesktopPath':
    case 'moveDesktopPath':
    case 'runDesktopCommand':
    case 'runDesktopCommandSequence':
    case 'startDesktopCommand':
    case 'listDesktopCommandSessions':
    case 'stopDesktopCommand':
    case 'syncDesktopWorkspaceFromDisk':
    case 'syncDesktopWorkspaceToDisk':
      return describeDesktopToolAction(action);
    case 'invokeCodeCardTool':
    case 'invokeMcpTool':
      return describeToolInvocationToolAction(action);
    default:
      return assertNever(action);
  }
}
