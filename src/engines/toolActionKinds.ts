import type {
  AssistantResolvableCodeCardActionKind,
  AssistantMcpToolAction,
  AssistantToolAction,
  AssistantToolActionKind,
  CanonicalToolAction,
  CanonicalToolActionKind
} from './toolActionTypes';

export const CANONICAL_TOOL_ACTION_KINDS = [
  'applyThemeCoordinates',
  'applySurfaceTokens',
  'patchRawCss',
  'readThemeCss',
  'editThemeCss',
  'appendThemeCss',
  'insertThemeCss',
  'deleteThemeCss',
  'replaceThemeCss',
  'inspectThemeRender',
  'applyPreset',
  'createRoomProject',
  'createCodeCard',
  'createProjectFile',
  'writeMemory',
  'writeMemoryDoc',
  'readMemoryDoc',
  'searchMemory',
  'openMemorySource',
  'readPolarisKnowledge',
  'listEnvironmentNodes',
  'inspectEnvironmentNode',
  'searchEnvironmentNodes',
  'searchReadableContext',
  'startTask',
  'completeTask',
  'wait',
  'inspectAttachments',
  'webSearch',
  'readWebPage',
  'listCalendars',
  'readCalendarEvents',
  'createCalendarEvent',
  'updateCalendarEvent',
  'deleteCalendarEvent',
  'readAttachmentText',
  'bundleAttachments',
  'createQrCode',
  'generateImage',
  'sendImageAttachment',
  'inspectImageAsset',
  'extractImagePalette',
  'createImageVariant',
  'saveAttachmentToCollection',
  'saveAttachmentAsCodeCard',
  'inspectArchiveEntries',
  'readArchiveEntryText',
  'bundleArchiveEntries',
  'saveArchiveEntryAsCodeCard',
  'runCode',
  'listDesktopWorkspaces',
  'listDesktopFiles',
  'readDesktopFile',
  'searchDesktopFiles',
  'readDesktopFileContext',
  'writeDesktopFile',
  'editDesktopFileText',
  'replaceDesktopFileLines',
  'createDesktopDirectory',
  'deleteDesktopPath',
  'moveDesktopPath',
  'runDesktopCommand',
  'runDesktopCommandSequence',
  'startDesktopCommand',
  'listDesktopCommandSessions',
  'stopDesktopCommand'
] as const satisfies readonly CanonicalToolActionKind[];

export const ASSISTANT_RESOLVABLE_CODE_CARD_ACTION_KINDS = [
  'listCodeCards',
  'patchCodeCard',
  'appendCodeCard',
  'appendProjectFile',
  'insertProjectFile',
  'replaceProjectFileLines',
  'writeProjectFiles',
  'patchRoomProject',
  'listProjectFiles',
  'searchProjectFiles',
  'readWorkspacePreviewState',
  'listWorkspaceReferences',
  'searchWorkspaceReferences',
  'readWorkspaceReference',
  'promoteWorkspaceReferenceToProjectFile',
  'pinProjectFileAsReference',
  'checkProjectPreview',
  'inspectProjectRuntime',
  'editCodeCardText',
  'editProjectFileText',
  'deleteProjectFile',
  'readCodeCard',
  'readProjectFile',
  'readProjectFileContext',
  'promoteCardToProject'
] as const satisfies readonly AssistantResolvableCodeCardActionKind[];

const ASSISTANT_RESOLVABLE_CODE_CARD_ACTION_KIND_SET = new Set<string>(ASSISTANT_RESOLVABLE_CODE_CARD_ACTION_KINDS);

export function isAssistantResolvableCodeCardActionKind(
  kind: AssistantToolActionKind
): kind is AssistantResolvableCodeCardActionKind {
  return ASSISTANT_RESOLVABLE_CODE_CARD_ACTION_KIND_SET.has(kind);
}

export function isDirectAssistantToolAction(action: AssistantToolAction): action is CanonicalToolAction | AssistantMcpToolAction {
  return !isAssistantResolvableCodeCardActionKind(action.kind);
}

export function assertNeverToolAction(value: never, label: string): never {
  throw new Error(`Unhandled ${label}: ${JSON.stringify(value)}`);
}
