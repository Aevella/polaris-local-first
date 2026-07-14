import type {
  ChatAttachment,
  CodeCard,
  CodeCardFileRole,
  CollectionShelf,
  ModelTier,
  McpToolResultEvidence,
  PersonaMemoryReferenceDoc,
  PolarisTriggerRule,
  ProjectFile,
  ProjectDiagnosticEvidence,
  ProjectFileEffect,
  ProjectFileFact,
  ProjectFileReadEvidence,
  ReadableContextCandidate,
  RoomProject,
  ThemeFrame,
  World,
  WorkspaceReferenceDoc,
  WorkspaceReferenceDocFact,
  WorkspaceReferenceDocReadEvidence,
  WebPageReadEvidence,
  WebSearchEvidence
} from '../types/domain';
export type { CodeCardToolPatch, RoomProjectToolPatch, ToolAction } from './toolActionTypes';
import type {
  BundleArchiveEntriesResult,
  BundleAttachmentsResult,
  CreateQrCodeResult,
  InspectArchiveEntriesResult,
  InspectAttachmentsResult,
  ReadArchiveEntryTextResult,
  ReadAttachmentTextResult,
  ReadWebPageResult,
  SendImageAttachmentResult,
  ToolAttachmentRef
} from './attachmentToolExecutor';
import type { GenerateImageAttachmentResult } from './generatedImageTool';
import type { CodeSandboxResult } from './codeSandbox';
import type {
  DesktopLocalCommandSequenceResult,
  DesktopLocalCommandSequenceStep,
  DesktopLocalCommandSession,
  DesktopLocalCommandResult,
  DesktopLocalDirectoryCreateResult,
  DesktopLocalDirectoryListing,
  DesktopLocalHostState,
  DesktopLocalPathDeleteResult,
  DesktopLocalPathMoveResult,
  DesktopLocalReadResult,
  DesktopLocalWorkspaceReadResult,
  DesktopLocalWorkspaceWriteFile,
  DesktopLocalWorkspaceWriteResult,
  DesktopLocalWriteResult
} from '../desktop/localHost';
import type {
  CreateImageVariantOptions,
  CreateImageVariantResult,
  ExtractImagePaletteResult,
  InspectImageAssetResult
} from './imageAssetTools';
import type { ToolResult } from './toolResult';
import type { WebSearchResult } from './webSearchTool';
import type { CodeCardToolPatch, CodeCardToolDraft, ProjectFileToolDraft, RoomProjectToolPatch, ToolAction } from './toolActionTypes';
import type {
  NativeCalendarsResult,
  NativeCalendarEventsResult,
  NativeCalendarEventDelete,
  NativeCalendarEventDraft,
  NativeCalendarEventPatch,
  NativeCalendarMutationResult,
  NativeCalendarQuery
} from '../native/personalData';
import type { EnvironmentDirectoryAction } from './environmentDirectory';

export type SaveAttachmentToCollectionResult = ToolResult<{
  cardId: string;
  created: boolean;
  title: string;
}>;

export type SaveAttachmentAsCodeCardResult = ToolResult<{
  cardId: string;
  created: boolean;
  title: string;
}>;

export type InvokeMcpToolResult = ToolResult<{
  detailText: string;
  attachments?: ChatAttachment[];
  isError?: boolean;
  structuredContent?: unknown;
}>;

export type ThemeRenderInspectionResult = ToolResult<{
  detailText: string;
}>;

export type ToolContext = {
  applyThemePatch: (generatedCssPatch?: string) => void;
  readCurrentThemeFrame?: () => ThemeFrame;
  inspectThemeRender?: () => ThemeRenderInspectionResult;
  allowUnsafeThemeCss?: boolean;
  modelTier?: ModelTier;
  applyThemePreset: (presetId: string) => void;
  setWorld: (world: World) => void;
  setCollectionShelf: (shelf: CollectionShelf) => void;
  createRoomProject: (project: Partial<RoomProject>) => string | null;
  readRoomProject: (projectId: string) => RoomProject | null;
  patchRoomProject: (projectId: string, patch: RoomProjectToolPatch) => boolean;
  listProjectFiles: (projectId: string) => ProjectFile[];
  listCodeCards: () => CodeCard[];
  createCodeCard: (card: CodeCardToolDraft) => string | null;
  createProjectFile: (file: ProjectFileToolDraft & { code: string }) => string | null;
  promoteCardToProject: (args: {
    cardId: string;
    projectTitle?: string;
    filePath?: string;
    fileRole?: CodeCardFileRole;
  }) => { projectId: string; fileId: string } | null;
  patchCodeCard: (cardId: string, patch: CodeCardToolPatch) => boolean;
  patchProjectFile: (
    fileId: string,
    patch: Partial<Pick<ProjectFile, 'fileRole' | 'language' | 'content' | 'ownerCollaboratorId' | 'source'>>
  ) => boolean;
  deleteProjectFile: (fileId: string) => boolean;
  selectCodeCard: (cardId: string) => void;
  spotlightCodeCard: (cardId: string | null) => void;
  readCodeCard: (cardId: string) => CodeCard | null;
  readProjectFile: (fileId: string) => ProjectFile | null;
  listWorkspaceReferenceDocs?: (projectId: string) => WorkspaceReferenceDoc[];
  readWorkspaceReferenceDoc?: (docId: string) => WorkspaceReferenceDoc | null;
  readWorkspaceReferenceDocContent?: (doc: WorkspaceReferenceDoc) => Promise<string>;
  createWorkspaceReferenceDoc?: (
    doc: Partial<WorkspaceReferenceDoc> & Pick<WorkspaceReferenceDoc, 'projectId' | 'title'>
  ) => string | null;
  deleteWorkspaceReferenceDoc?: (docId: string) => boolean;
  listCollaboratorMemoryDocs?: () => PersonaMemoryReferenceDoc[];
  appendCollaboratorMemories: (items: string[]) => boolean;
  writeCollaboratorMemoryDoc: (doc: {
    docId?: string;
    title: string;
    summary?: string;
    content: string;
  }) => { ok: true; docId: string; title: string; created: boolean } | { ok: false; error: string };
  readCollaboratorMemoryDoc: (docId: string) => Promise<PersonaMemoryReferenceDoc | null>;
  searchCollaboratorMemory?: (
    query: string,
    mode?: 'auto' | 'summary' | 'source',
    maxResults?: number
  ) => ToolExecutionResult;
  openMemorySource?: (
    sourceConversationId: string,
    sourceMessageIds?: string[],
    maxChars?: number
  ) => ToolExecutionResult;
  readPolarisKnowledge: (topic?: string) => ToolResult<{
    summary: string;
    detailText: string;
  }>;
  readEnvironmentDirectory?: (action: EnvironmentDirectoryAction) => Promise<ToolResult<{
    summary: string;
    detailText: string;
  }>>;
  createProactiveMessageRule: (
    action: Extract<ToolAction, { kind: 'createProactiveMessageRule' }>
  ) => ToolResult<{
    summary: string;
    detailText: string;
    triggerRuleId: string;
  }>;
  listProactiveMessageRules: (
    action: Extract<ToolAction, { kind: 'listProactiveMessageRules' }>
  ) => ToolResult<{
    summary: string;
    detailText: string;
    triggerRules: PolarisTriggerRule[];
  }>;
  updateProactiveMessageRule: (
    action: Extract<ToolAction, { kind: 'updateProactiveMessageRule' }>
  ) => ToolResult<{
    summary: string;
    detailText: string;
    triggerRuleId: string;
  }>;
  deleteProactiveMessageRule: (
    action: Extract<ToolAction, { kind: 'deleteProactiveMessageRule' }>
  ) => ToolResult<{
    summary: string;
    detailText: string;
    triggerRuleId: string;
  }>;
  inspectAttachments: (scope?: 'latest' | 'all', query?: string) => InspectAttachmentsResult;
  webSearch: (query: string, maxResults?: number) => Promise<WebSearchResult>;
  readWebPage: (url: string, maxChars?: number) => Promise<ReadWebPageResult>;
  listCalendars: () => Promise<NativeCalendarsResult>;
  readCalendarEvents: (query: NativeCalendarQuery) => Promise<NativeCalendarEventsResult>;
  createCalendarEvent: (draft: NativeCalendarEventDraft) => Promise<NativeCalendarMutationResult>;
  updateCalendarEvent: (patch: NativeCalendarEventPatch) => Promise<NativeCalendarMutationResult>;
  deleteCalendarEvent: (event: NativeCalendarEventDelete) => Promise<NativeCalendarMutationResult>;
  inspectArchiveEntries: (target?: string, query?: string) => Promise<InspectArchiveEntriesResult>;
  readAttachmentText: (target?: string, maxChars?: number) => ReadAttachmentTextResult;
  readArchiveEntryText: (
    target?: string,
    entry?: string,
    maxChars?: number
  ) => Promise<ReadArchiveEntryTextResult>;
  bundleArchiveEntries: (
    target?: string,
    entries?: string[],
    prefixes?: string[],
    excludeEntries?: string[],
    excludePrefixes?: string[],
    archiveName?: string
  ) => Promise<BundleArchiveEntriesResult>;
  bundleAttachments: (targets?: string[], archiveName?: string) => Promise<BundleAttachmentsResult>;
  createQrCode: (text: string, fileName?: string) => Promise<CreateQrCodeResult>;
  generateImage: (prompt: string, title?: string) => Promise<GenerateImageAttachmentResult>;
  sendImageAttachment: (target?: string, title?: string) => Promise<SendImageAttachmentResult>;
  inspectImageAsset: (target?: string) => Promise<InspectImageAssetResult>;
  extractImagePalette: (target?: string) => Promise<ExtractImagePaletteResult>;
  createImageVariant: (target?: string, options?: CreateImageVariantOptions) => Promise<CreateImageVariantResult>;
  saveAttachmentToCollection: (
    target?: string,
    title?: string,
    tags?: string[],
    openInCollection?: boolean
  ) => SaveAttachmentToCollectionResult;
  saveAttachmentAsCodeCard: (
    target?: string,
    title?: string,
    language?: string,
    tags?: string[],
    openInCollection?: boolean
  ) => SaveAttachmentAsCodeCardResult;
  saveArchiveEntryAsCodeCard: (
    target?: string,
    entry?: string,
    title?: string,
    language?: string,
    tags?: string[],
    openInCollection?: boolean
  ) => Promise<SaveAttachmentAsCodeCardResult>;
  runCode: (code: string) => Promise<CodeSandboxResult>;
  activeProjectId?: string | null;
  syncDesktopWorkspaceFromDisk?: (input: {
    projectId?: string;
    rootId?: string;
    allowOverwrite?: boolean;
  }) => Promise<ToolExecutionResult>;
  syncDesktopWorkspaceToDisk?: (input: {
    projectId?: string;
    rootId?: string;
    allowOverwrite?: boolean;
  }) => Promise<ToolExecutionResult>;
  desktopLocalHost?: {
    getState: () => Promise<DesktopLocalHostState>;
    listDirectory: (input: { rootId: string; relativePath?: string }) => Promise<DesktopLocalDirectoryListing>;
    readWorkspaceFiles: (input: { rootId: string }) => Promise<DesktopLocalWorkspaceReadResult>;
    writeWorkspaceFiles: (input: { rootId: string; files: DesktopLocalWorkspaceWriteFile[] }) => Promise<DesktopLocalWorkspaceWriteResult>;
    readFile: (input: { rootId: string; relativePath: string }) => Promise<DesktopLocalReadResult>;
    writeFile: (input: { rootId: string; relativePath: string; content: string }) => Promise<DesktopLocalWriteResult>;
    createDirectory?: (input: { rootId: string; relativePath: string }) => Promise<DesktopLocalDirectoryCreateResult>;
    deletePath?: (input: { rootId: string; relativePath: string }) => Promise<DesktopLocalPathDeleteResult>;
    movePath?: (input: { rootId: string; fromRelativePath: string; toRelativePath: string }) => Promise<DesktopLocalPathMoveResult>;
    runCommand: (input: { rootId: string; command: string; args?: string[]; cwdRelativePath?: string }) => Promise<DesktopLocalCommandResult>;
    runCommandSequence?: (input: { rootId: string; steps: DesktopLocalCommandSequenceStep[]; continueOnError?: boolean }) => Promise<DesktopLocalCommandSequenceResult>;
    startCommand?: (input: { rootId: string; command: string; args?: string[]; cwdRelativePath?: string }) => Promise<DesktopLocalCommandSession>;
    stopCommand?: (input: { sessionId: string }) => Promise<DesktopLocalCommandSession>;
    listCommandSessions?: () => Promise<DesktopLocalCommandSession[]>;
  };
  invokeMcpTool: (
    serverId: string,
    toolName: string,
    argumentsObject: Record<string, unknown>
  ) => Promise<InvokeMcpToolResult>;
  readCodeCardState: (cardId: string) => Promise<Record<string, unknown>>;
  writeCodeCardState: (cardId: string, state: Record<string, unknown>) => void;
};

export type ToolExecutionResult = ToolResult<{
  summary?: string;
  detailText?: string;
  attachments?: ChatAttachment[];
  attachmentRefs?: ToolAttachmentRef[];
  roomProjectId?: string;
  cardId?: string;
  projectFileId?: string;
  projectFileIds?: string[];
  projectFilePaths?: string[];
  projectFiles?: ProjectFileFact[];
  projectFileReads?: ProjectFileReadEvidence[];
  projectFileEffects?: ProjectFileEffect[];
  workspaceReferenceDocId?: string;
  workspaceReferenceDocTitle?: string;
  workspaceReferenceDocs?: WorkspaceReferenceDocFact[];
  workspaceReferenceDocReads?: WorkspaceReferenceDocReadEvidence[];
  readableContextCandidates?: ReadableContextCandidate[];
  projectDiagnostics?: ProjectDiagnosticEvidence[];
  projectPreviewRunnable?: boolean;
  imageCardId?: string;
  memoryCount?: number;
  memoryDocId?: string;
  memoryDocTitle?: string;
  memoryDocCreated?: boolean;
  triggerRuleId?: string;
  triggerRules?: PolarisTriggerRule[];
  webSearch?: WebSearchEvidence;
  webPageRead?: WebPageReadEvidence;
  mcpResult?: McpToolResultEvidence;
}>;

export type LocalToolCommand =
  | { kind: 'retryLatestAssistant'; instruction?: string }
  | { kind: 'undoLatestTurn' }
  | { kind: 'forkConversation' }
  | { kind: 'toggleConversationPin' }
  | { kind: 'renameConversation'; title: string }
  | { kind: 'exportConversation'; format: 'markdown' | 'json' }
  | { kind: 'switchPersona'; name: string }
  | { kind: 'switchProvider'; query: string }
  | { kind: 'setActiveModel'; model: string }
  | { kind: 'bindWorkspace'; projectName: string }
  | { kind: 'saveLatestCodeCard' }
  | { kind: 'saveLatestNote'; note?: string }
  | { kind: 'startTask'; goal: string }
  | { kind: 'showContext' }
  | { kind: 'showLastDebug' }
  | { kind: 'runLongWorkflowQa' }
  | { kind: 'runEnvironmentContractQa' }
  | { kind: 'showEnvironmentContractQaReport' }
  | { kind: 'rememberNote'; note: string }
  | { kind: 'openProviderSettings' }
  | { kind: 'exitWorkspace' }
  ;

export type ToolCommandResult = ToolResult<{ action: ToolAction } | { command: LocalToolCommand }> | null;
