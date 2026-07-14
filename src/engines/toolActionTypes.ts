import type { CodeCard, CodeCardFileRole, RoomProject, World } from '../types/domain';
import type { StableThemeTargets } from './tool-protocol/assistantToolProtocolThemeTargets';

export type CodeCardToolPatch = Partial<
  Pick<CodeCard, 'kind' | 'title' | 'cardNote' | 'language' | 'code' | 'cardFaceCss' | 'tags'>
>;
export type CodeCardToolDraft = CodeCardToolPatch & { code: string };
export type ProjectFileToolDraft = {
  projectId: string;
  filePath: string;
  fileRole?: CodeCardFileRole;
  language?: string;
  code?: string;
  replaceContent?: boolean;
};
export type ProjectFileWriteDraft = {
  filePath: string;
  fileRole?: CodeCardFileRole;
  language?: string;
  code: string;
  replaceContent?: boolean;
};
export type RoomProjectToolDraft = Pick<RoomProject, 'title'> & {
  projectId: string;
  slug?: string;
  tags?: string[];
  coverNote?: string;
  coverStyle?: string;
};
export type RoomProjectToolPatch = Partial<
  Pick<RoomProject, 'title' | 'slug' | 'tags' | 'coverNote' | 'coverStyle'>
>;

export type PromoteCardToProjectDraft = {
  target?: 'active' | string;
  projectTitle?: string;
  filePath?: string;
  fileRole?: CodeCardFileRole;
};

export type DesktopCommandSequenceStepDraft = {
  label?: string;
  command: string;
  args?: string[];
  cwdPath?: string;
};

export type CanonicalToolAction =
  | {
      kind: 'applyThemeCoordinates';
      targets: StableThemeTargets;
      hue: number;
      hueCount: number;
      emotion: number;
      meaning: number;
      baseColor?: string;
      seed?: number;
      label?: string;
    }
  | {
      kind: 'applySurfaceTokens';
      targets: string[];
      surface: string;
      spell: string;
      hue?: number;
      saturation?: number;
      lightness?: number;
      opacity?: number;
      radius?: number;
      borderW?: number;
      blur?: number;
      shadowDepth?: number;
      texture?: string;
      gradientMode?: string;
      gradientAngle?: number;
      accentHue?: number;
      label?: string;
    }
  | {
      kind: 'patchRawCss';
      css: string;
      label?: string;
    }
  | {
      kind: 'readThemeCss';
      targetLabel?: string;
    }
  | {
      kind: 'editThemeCss';
      oldString: string;
      newString: string;
      layer?: 'custom' | 'generated';
      label?: string;
    }
  | {
      kind: 'appendThemeCss';
      css: string;
      layer?: 'custom' | 'generated';
      label?: string;
    }
  | {
      kind: 'insertThemeCss';
      anchorString: string;
      css: string;
      position?: 'before' | 'after';
      layer?: 'custom' | 'generated';
      label?: string;
    }
  | {
      kind: 'deleteThemeCss';
      oldString: string;
      layer?: 'custom' | 'generated';
      label?: string;
    }
  | {
      kind: 'replaceThemeCss';
      css: string;
      label?: string;
    }
  | {
      kind: 'inspectThemeRender';
      targetLabel?: string;
    }
  | {
      kind: 'applyPreset';
      presetId: string;
    }
  | {
      kind: 'createRoomProject';
      project: RoomProjectToolDraft;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'createCodeCard';
      card: CodeCardToolDraft;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'createProjectFile';
      file: ProjectFileToolDraft;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'writeMemory';
      memory: string[];
      targetLabel?: string;
    }
  | {
      kind: 'writeMemoryDoc';
      docId?: string;
      title: string;
      summary?: string;
      content: string;
      targetLabel?: string;
    }
  | {
      kind: 'readMemoryDoc';
      docId: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchMemory';
      query: string;
      mode?: 'auto' | 'summary' | 'source';
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'openMemorySource';
      sourceConversationId: string;
      sourceMessageIds?: string[];
      maxChars?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readPolarisKnowledge';
      topic?: string;
      targetLabel?: string;
    }
  | {
      kind: 'listEnvironmentNodes';
      parentNodeId?: string;
      depth?: number;
      targetLabel?: string;
    }
  | {
      kind: 'inspectEnvironmentNode';
      nodeId: string;
      detailLevel?: 'summary' | 'expanded';
      targetLabel?: string;
    }
  | {
      kind: 'searchEnvironmentNodes';
      query: string;
      scopeNodeId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchReadableContext';
      query: string;
      projectId?: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'startTask';
      capability?: 'theme' | 'room' | 'workspace' | 'desktop' | 'app' | 'code' | 'mcp' | 'general';
      title?: string;
      stage?: string;
      steps?: string[];
      targetLabel?: string;
    }
  | {
      kind: 'completeTask';
      stage?: string;
      summary?: string;
      targetLabel?: string;
    }
  | {
      kind: 'wait';
      seconds?: number;
      reason?: string;
      targetLabel?: string;
    }
  | {
      kind: 'createProactiveMessageRule';
      name?: string;
      prompt: string;
      schedule:
        | {
            kind: 'daily';
            time: string;
          }
        | {
            kind: 'interval';
            everyMinutes: number;
          };
      conversationMode?: 'follow-latest' | 'fixed';
      targetLabel?: string;
    }
  | {
      kind: 'listProactiveMessageRules';
      targetLabel?: string;
    }
  | {
      kind: 'updateProactiveMessageRule';
      ruleId: string;
      name?: string;
      prompt?: string;
      schedule?:
        | {
            kind: 'daily';
            time: string;
          }
        | {
            kind: 'interval';
            everyMinutes: number;
          };
      conversationMode?: 'follow-latest' | 'fixed';
      targetLabel?: string;
    }
  | {
      kind: 'deleteProactiveMessageRule';
      ruleId: string;
      targetLabel?: string;
    }
  | {
      kind: 'inspectAttachments';
      scope?: 'latest' | 'all';
      query?: string;
    }
  | {
      kind: 'webSearch';
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readWebPage';
      url: string;
      maxChars?: number;
      targetLabel?: string;
    }
  | {
      kind: 'listCalendars';
      targetLabel?: string;
    }
  | {
      kind: 'readCalendarEvents';
      startDate?: string;
      endDate?: string;
      query?: string;
      maxEvents?: number;
      targetLabel?: string;
    }
  | {
      kind: 'createCalendarEvent';
      title: string;
      startDate: string;
      endDate?: string;
      allDay?: boolean;
      location?: string;
      notes?: string;
      calendarId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'updateCalendarEvent';
      eventId: string;
      title?: string;
      startDate?: string;
      endDate?: string;
      allDay?: boolean;
      location?: string;
      notes?: string;
      targetLabel?: string;
    }
  | {
      kind: 'deleteCalendarEvent';
      eventId: string;
      targetLabel?: string;
    }
  | {
      kind: 'readAttachmentText';
      target?: string;
      maxChars?: number;
      targetLabel?: string;
    }
  | {
      kind: 'bundleAttachments';
      targets?: string[];
      archiveName?: string;
      targetLabel?: string;
    }
  | {
      kind: 'createQrCode';
      text: string;
      fileName?: string;
      targetLabel?: string;
    }
  | {
      kind: 'generateImage';
      prompt: string;
      title?: string;
      targetLabel?: string;
    }
  | {
      kind: 'sendImageAttachment';
      target?: string;
      title?: string;
      targetLabel?: string;
    }
  | {
      kind: 'inspectImageAsset';
      target?: string;
      targetLabel?: string;
    }
  | {
      kind: 'extractImagePalette';
      target?: string;
      targetLabel?: string;
    }
  | {
      kind: 'createImageVariant';
      target?: string;
      purpose?: 'background' | 'bubble-sticker' | 'avatar' | 'thumbnail';
      width?: number;
      height?: number;
      fit?: 'cover' | 'contain';
      blur?: number;
      dim?: number;
      format?: 'png' | 'jpeg' | 'webp';
      quality?: number;
      name?: string;
      targetLabel?: string;
    }
  | {
      kind: 'saveAttachmentToCollection';
      target?: string;
      title?: string;
      tags?: string[];
      openInCollection?: boolean;
      targetLabel?: string;
    }
  | {
      kind: 'saveAttachmentAsCodeCard';
      target?: string;
      title?: string;
      language?: string;
      tags?: string[];
      openInCollection?: boolean;
      targetLabel?: string;
    }
  | {
      kind: 'inspectArchiveEntries';
      target?: string;
      query?: string;
      targetLabel?: string;
    }
  | {
      kind: 'readArchiveEntryText';
      target?: string;
      entry?: string;
      maxChars?: number;
      targetLabel?: string;
    }
  | {
      kind: 'bundleArchiveEntries';
      target?: string;
      entries?: string[];
      prefixes?: string[];
      excludeEntries?: string[];
      excludePrefixes?: string[];
      archiveName?: string;
      targetLabel?: string;
    }
  | {
      kind: 'saveArchiveEntryAsCodeCard';
      target?: string;
      entry?: string;
      title?: string;
      language?: string;
      tags?: string[];
      openInCollection?: boolean;
      targetLabel?: string;
    }
  | {
      kind: 'runCode';
      code: string;
      targetLabel?: string;
    }
  | {
      kind: 'listDesktopWorkspaces';
      targetLabel?: string;
    }
  | {
      kind: 'listDesktopFiles';
      rootId?: string;
      path?: string;
      targetLabel?: string;
    }
  | {
      kind: 'readDesktopFile';
      rootId?: string;
      filePath: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchDesktopFiles';
      rootId?: string;
      path?: string;
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readDesktopFileContext';
      rootId?: string;
      filePath: string;
      query?: string;
      lineNumber?: number;
      before?: number;
      after?: number;
      occurrence?: number;
      targetLabel?: string;
    }
  | {
      kind: 'writeDesktopFile';
      rootId?: string;
      filePath: string;
      content: string;
      targetLabel?: string;
    }
  | {
      kind: 'editDesktopFileText';
      rootId?: string;
      filePath: string;
      oldString: string;
      newString: string;
      targetLabel?: string;
    }
  | {
      kind: 'replaceDesktopFileLines';
      rootId?: string;
      filePath: string;
      startLine: number;
      endLine?: number;
      code: string;
      targetLabel?: string;
    }
  | {
      kind: 'createDesktopDirectory';
      rootId?: string;
      path: string;
      targetLabel?: string;
    }
  | {
      kind: 'deleteDesktopPath';
      rootId?: string;
      path: string;
      targetLabel?: string;
    }
  | {
      kind: 'moveDesktopPath';
      rootId?: string;
      fromPath: string;
      toPath: string;
      targetLabel?: string;
    }
  | {
      kind: 'runDesktopCommand';
      rootId?: string;
      command: string;
      args?: string[];
      cwdPath?: string;
      targetLabel?: string;
    }
  | {
      kind: 'runDesktopCommandSequence';
      rootId?: string;
      steps: DesktopCommandSequenceStepDraft[];
      continueOnError?: boolean;
      targetLabel?: string;
    }
  | {
      kind: 'startDesktopCommand';
      rootId?: string;
      command: string;
      args?: string[];
      cwdPath?: string;
      targetLabel?: string;
    }
  | {
      kind: 'listDesktopCommandSessions';
      targetLabel?: string;
    }
  | {
      kind: 'stopDesktopCommand';
      sessionId: string;
      targetLabel?: string;
    }
  | {
      kind: 'syncDesktopWorkspaceFromDisk';
      projectId?: string;
      rootId?: string;
      allowOverwrite?: boolean;
      targetLabel?: string;
    }
  | {
      kind: 'syncDesktopWorkspaceToDisk';
      projectId?: string;
      rootId?: string;
      allowOverwrite?: boolean;
      targetLabel?: string;
    };

export type AssistantResolvableCodeCardAction =
  | {
      kind: 'listCodeCards';
      targetLabel?: string;
    }
  | {
      kind: 'patchCodeCard';
      target?: 'active' | string;
      targetLabel?: string;
      patch: CodeCardToolPatch;
      openInCollection?: boolean;
    }
  | {
      kind: 'appendCodeCard';
      target?: 'active' | string;
      targetLabel?: string;
      code: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'appendProjectFile';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
      code: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'insertProjectFile';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
      beforeString?: string;
      afterString?: string;
      lineNumber?: number;
      linePosition?: 'before' | 'after';
      code: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'replaceProjectFileLines';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
      startLine: number;
      endLine?: number;
      code: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'writeProjectFiles';
      projectId?: string;
      targetLabel?: string;
      files: ProjectFileWriteDraft[];
      openInCollection?: boolean;
    }
  | {
      kind: 'patchRoomProject';
      projectId?: string;
      targetLabel?: string;
      patch: RoomProjectToolPatch;
      openInCollection?: boolean;
    }
  | {
      kind: 'listProjectFiles';
      projectId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchProjectFiles';
      projectId?: string;
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readWorkspacePreviewState';
      projectId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'listWorkspaceReferences';
      projectId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchWorkspaceReferences';
      projectId?: string;
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readWorkspaceReference';
      projectId?: string;
      docId?: string;
      title?: string;
      targetLabel?: string;
    }
  | {
      kind: 'promoteWorkspaceReferenceToProjectFile';
      projectId?: string;
      docId?: string;
      title?: string;
      filePath: string;
      fileRole?: CodeCardFileRole;
      language?: string;
      replaceContent?: boolean;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'pinProjectFileAsReference';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      title?: string;
      summary?: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'checkProjectPreview';
      projectId?: string;
      targetLabel?: string;
    }
  | {
      kind: 'inspectProjectRuntime';
      projectId?: string;
      settleMs?: number;
      targetLabel?: string;
    }
  | {
      kind: 'editCodeCardText';
      target?: 'active' | string;
      targetLabel?: string;
      oldString: string;
      newString: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'editProjectFileText';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
      oldString: string;
      newString: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'deleteProjectFile';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'readCodeCard';
      target?: 'active' | string;
      targetLabel?: string;
    }
  | {
      kind: 'readProjectFile';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      targetLabel?: string;
    }
  | {
      kind: 'readProjectFileContext';
      target?: 'active' | string;
      projectId?: string;
      filePath?: string;
      query?: string;
      lineNumber?: number;
      before?: number;
      after?: number;
      occurrence?: number;
      targetLabel?: string;
    }
  | {
      kind: 'promoteCardToProject';
      target?: 'active' | string;
      targetLabel?: string;
      projectTitle?: string;
      filePath?: string;
      fileRole?: CodeCardFileRole;
      openInCollection?: boolean;
    };

export type ResolvedTargetedToolAction =
  | {
      kind: 'listCodeCards';
      targetLabel?: string;
    }
  | {
      kind: 'patchCodeCard';
      cardId: string;
      patch: CodeCardToolPatch;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'appendCodeCard';
      cardId: string;
      code: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'appendProjectFile';
      fileId: string;
      code: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'insertProjectFile';
      fileId: string;
      beforeString?: string;
      afterString?: string;
      lineNumber?: number;
      linePosition?: 'before' | 'after';
      code: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'replaceProjectFileLines';
      fileId: string;
      startLine: number;
      endLine?: number;
      code: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'writeProjectFiles';
      projectId: string;
      targetLabel?: string;
      files: Array<ProjectFileWriteDraft & { projectId: string }>;
      openInCollection?: boolean;
    }
  | {
      kind: 'patchRoomProject';
      projectId: string;
      patch: RoomProjectToolPatch;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'listProjectFiles';
      projectId: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchProjectFiles';
      projectId: string;
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readWorkspacePreviewState';
      projectId: string;
      targetLabel?: string;
    }
  | {
      kind: 'listWorkspaceReferences';
      projectId: string;
      targetLabel?: string;
    }
  | {
      kind: 'searchWorkspaceReferences';
      projectId: string;
      query: string;
      maxResults?: number;
      targetLabel?: string;
    }
  | {
      kind: 'readWorkspaceReference';
      projectId: string;
      docId?: string;
      title?: string;
      targetLabel?: string;
    }
  | {
      kind: 'promoteWorkspaceReferenceToProjectFile';
      projectId: string;
      docId?: string;
      title?: string;
      filePath: string;
      fileRole?: CodeCardFileRole;
      language?: string;
      replaceContent?: boolean;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'pinProjectFileAsReference';
      fileId: string;
      projectId: string;
      title?: string;
      summary?: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'checkProjectPreview';
      projectId: string;
      targetLabel?: string;
    }
  | {
      kind: 'inspectProjectRuntime';
      projectId: string;
      settleMs?: number;
      targetLabel?: string;
    }
  | {
      kind: 'editCodeCardText';
      cardId: string;
      oldString: string;
      newString: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'editProjectFileText';
      fileId: string;
      oldString: string;
      newString: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'deleteProjectFile';
      fileId: string;
      targetLabel?: string;
      openInCollection?: boolean;
    }
  | {
      kind: 'readCodeCard';
      cardId: string;
      targetLabel?: string;
    }
  | {
      kind: 'readProjectFile';
      fileId: string;
      targetLabel?: string;
    }
  | {
      kind: 'readProjectFileContext';
      fileId: string;
      query?: string;
      lineNumber?: number;
      before?: number;
      after?: number;
      occurrence?: number;
      targetLabel?: string;
    }
  | {
      kind: 'promoteCardToProject';
      cardId: string;
      targetLabel?: string;
      projectTitle?: string;
      filePath?: string;
      fileRole?: CodeCardFileRole;
      openInCollection?: boolean;
    };

export type AssistantMcpToolAction = {
  kind: 'invokeMcpTool';
  serverId: string;
  serverName: string;
  schemaName?: string;
  toolName: string;
  argumentsObject: Record<string, unknown>;
  targetLabel?: string;
};

export type InternalToolAction =
  | {
      kind: 'invokeCodeCardTool';
      cardId: string;
      toolName: string;
      input?: string;
      args?: Record<string, unknown>;
      targetLabel?: string;
    }
  | AssistantMcpToolAction;

export type AssistantToolAction = CanonicalToolAction | AssistantResolvableCodeCardAction | AssistantMcpToolAction;

export type ToolAction =
  | CanonicalToolAction
  | ResolvedTargetedToolAction
  | InternalToolAction
  | {
      kind: 'switchWorld';
      world: World;
    };

export type CanonicalToolActionKind = CanonicalToolAction['kind'];
export type AssistantResolvableCodeCardActionKind = AssistantResolvableCodeCardAction['kind'];
export type ResolvedTargetedToolActionKind = ResolvedTargetedToolAction['kind'];
export type AssistantToolActionKind = AssistantToolAction['kind'];
export type ToolActionKind = ToolAction['kind'];
