import type { MutableRefObject } from 'react';
import type { PolarisToolPromptPreferences } from '../../engines/assistantToolProtocol';
import type { RuntimeFeedbackEvent } from '../../engines/runtime-feedback/runtimeFeedbackEvents';
import type { PendingWorkspaceProposalRecord } from '../../engines/workspaceBinding';
import type { RoomProjectPatch } from '../../engines/roomProjects';
import type { ChatStreamingPhase, ChatStreamingState } from './chatStreamingDisplay';
import type {
  AppCustomization,
  ChatAttachment,
  ChatCardReference,
  ChatMessage,
  CodeCard,
  CodeCardFileRole,
  CollectionShelf,
  Conversation,
  ConversationTaskState,
  ImageGenerationSettings,
  ImageUnderstandingSettings,
  ImageAssetCard,
  McpServerConfig,
  PolarisCompanionConnection,
  PolarisTriggerAction,
  PolarisTriggerRule,
  PolarisTriggerSchedule,
  PolarisTriggerTarget,
  Persona,
  ProjectFile,
  ProviderProfile,
  RoomProject,
  SavedSkin,
  ThemeFrame,
  ThemePatchLedgerEntry,
  ToolInvocation,
  ThemeToolMode,
  WebSearchConfig,
  WorkspaceReferenceDoc,
  WorkspaceViewReturnTarget,
  World
} from '../../types/domain';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ActiveThemePreview, AppReplyNotification, AppReplyNotificationInput } from '../../stores/spaceStoreTypes';

export type { ChatStreamingPhase, ChatStreamingState };

export type ChatEditingState = {
  messageId: string;
  draft: string;
  attachments: ChatAttachment[];
} | null;

export type ChatUiReplyState = {
  abortControllerRef: MutableRefObject<AbortController | null>;
  themeToolModeSwitchRef: MutableRefObject<{
    from: ThemeToolMode;
    to: ThemeToolMode;
    pendingTurns: number;
  } | null>;
  setSending: (value: boolean) => void;
  setStreaming: (
    value: ChatStreamingState | ((current: ChatStreamingState) => ChatStreamingState)
  ) => void;
  streamingLifecycleReleaseRef: MutableRefObject<number | null>;
  toolPromptPreferences: PolarisToolPromptPreferences;
  taskModeEnabled: boolean;
};

export type ChatUiGenerationControls = Pick<
  ChatUiReplyState,
  'abortControllerRef' | 'setSending' | 'setStreaming' | 'streamingLifecycleReleaseRef'
>;

export type ChatUiReplyControllerState = Omit<
  ChatUiReplyState,
  keyof ChatUiGenerationControls
> & {
  getConversationGenerationControls: (conversationId: string) => ChatUiGenerationControls;
};

export type ChatUiActionState = {
  sending: boolean;
  editing: ChatEditingState;
  confirm: (message: string) => boolean;
  setCommandStatus: (text: string, isError?: boolean) => void;
  triggerSubmitFlight: () => void;
  cancelEditingMessage: () => void;
};

export type ChatUiToolState = {
  setCommandStatus: (text: string, isError?: boolean) => void;
};

export type ChatConversationState = {
  id: string;
  title: string;
  collaboratorId: string | null;
  activeProjectId?: string | null;
  messages: ChatMessage[];
} | null;

export type ChatDerivedStatePort = {
  activeConversation: ChatConversationState;
  activeCollaboratorSourceId: string | null;
  persona: Persona | null;
  hasUnsupportedPendingImages: boolean;
  codeCardActionModeByMessageId: Record<string, 'hidden' | 'save' | 'open'>;
};

export type ChatSpaceFrontstagePort = {
  activeWorld: World;
  collectionShelf: CollectionShelf;
  frontstageCollaboratorId: string | null;
  focusedMessageTarget: { conversationId: string; messageId: string } | null;
  activeCardId: string | null;
  spotlightCardId: string | null;
  pendingProjectOpenId: string | null;
  pendingProjectOpenSource: WorkspaceViewReturnTarget;
  pendingCardReference: ChatCardReference | null;
  pendingAttachments: ChatAttachment[];
  replyNotifications: AppReplyNotification[];
  setWorld: (world: World) => void;
  setCollectionShelf: (shelf: CollectionShelf) => void;
  setFrontstageCollaboratorId: (collaboratorId: string | null) => void;
  setFocusedMessageTarget: (target: { conversationId: string; messageId: string } | null) => void;
  setActiveCard: (cardId: string | null) => void;
  spotlightCard: (cardId: string | null) => void;
  clearSpotlightCard: (cardId?: string | null) => void;
  setPendingProjectOpenId: (projectId: string | null) => void;
  setPendingProjectOpenSource: (source: WorkspaceViewReturnTarget) => void;
  setPendingCardReference: (reference: ChatCardReference | null) => void;
  clearPendingCardReference: () => void;
  addPendingAttachments: (attachments: ChatAttachment[]) => void;
  removePendingAttachment: (attachmentId: string) => void;
  clearPendingAttachments: () => void;
  enqueueReplyNotification: (notification: AppReplyNotificationInput) => void;
  dismissReplyNotification: (notificationId: string) => void;
  clearReplyNotifications: () => void;
};

export type ChatSpaceThemeSessionPort = {
  activeThemePreview: ActiveThemePreview;
  currentThemeFrame: ThemeFrame;
  getActiveThemePreview: () => ActiveThemePreview;
  getCurrentThemeFrame: () => ThemeFrame;
  customization: AppCustomization;
  themeToolMode: ThemeToolMode;
  selectedSurfaceCodes: string[];
  applyThemePatch: (generatedCssPatch?: string) => void;
  applyThemePreset: (presetId: string) => void;
  beginThemePreview: (
    previewId: string,
    conversationId: string,
    nextTheme: ThemeFrame,
    pending: string,
    patchLedgerEntry?: Omit<ThemePatchLedgerEntry, 'status' | 'createdAt' | 'updatedAt'>
  ) => { visibleThemeBeforeStart: ThemeFrame };
  commitThemePreview: (previewId: string) => boolean;
  rollbackThemePreview: (previewId: string) => boolean;
  saveCurrentSkin: (name: string) => SavedSkin | null;
  setThemeToolMode: (mode: ThemeToolMode) => void;
};

export type ChatActionStoreBindings = {
  chat: {
    conversations: Conversation[];
    activeConversationId: string | null;
    inputDraft: string;
    pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
    createConversation: (
      collaboratorId?: string | null,
      options?: {
        activeProjectId?: string | null;
      }
    ) => string;
    ensureConversationMessagesLoaded?: (conversationId: string) => Promise<Conversation | null>;
    ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
    addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
    updateMessage: (target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) => void;
    persistToDb?: () => Promise<void>;
    orphanConversation: (conversationId: string) => void;
    deleteConversation: (conversationId: string) => void;
    setInputDraft: (value: string) => void;
    replaceConversationMessages: (target: WritableConversationBody, messages: ChatMessage[]) => void;
    setConversationActiveProject: (conversationId: string, projectId: string | null) => void;
    upsertPendingWorkspaceProposal: (proposal: PendingWorkspaceProposalRecord) => void;
    removePendingWorkspaceProposal: (proposalId: string) => void;
    appendRuntimeFeedbackEvent: (conversationId: string, event: RuntimeFeedbackEvent) => void;
    getRuntimeFeedbackEvents: (conversationId: string) => RuntimeFeedbackEvent[];
    setActiveConversation: (conversationId: string) => void;
    readLatestState: () => {
      inputDraft: string;
      conversations: Conversation[];
      activeConversationId: string | null;
    };
  };
  persona: {
    activeCollaboratorId: string | null;
    personas: Persona[];
    setActiveCollaborator: (collaboratorId: string) => void;
    deleteCollaborator: (collaboratorId: string) => boolean;
    readLatestState: () => {
      activeCollaboratorId: string | null;
      personas: Persona[];
    };
  };
  space: Pick<ChatSpaceFrontstagePort, 'frontstageCollaboratorId' | 'setFrontstageCollaboratorId'> & {
    editingCollaboratorId: string | null;
    setEditingCollaboratorId: (collaboratorId: string | null) => void;
    pendingCardReference: ChatCardReference | null;
    pendingAttachments: ChatAttachment[];
    setPendingCardReference: (reference: ChatCardReference | null) => void;
    clearPendingCardReference: () => void;
    clearPendingAttachments: () => void;
    rollbackPreviewForConversationDeletion: (conversationId: string) => boolean;
    readLatestState: () => {
      frontstageCollaboratorId: string | null;
      pendingCardReference: ChatCardReference | null;
      pendingAttachments: ChatAttachment[];
    };
  };
  runtime: {
    companionConnections: PolarisCompanionConnection[];
    deleteCompanionConnection: (connectionId: string) => void;
  };
};

export type ChatReplyStoreBindings = {
  chat: {
    conversations: Conversation[];
    pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
    findConversation: (
      conversationId: string
    ) => {
      id: string;
      title: string;
      collaboratorId: string | null;
      activeProjectId?: string | null;
      toolLedger?: import('../../types/domain').ToolLedgerEntry[];
    } | undefined;
    ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
    addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
    insertMessageBefore: (target: WritableConversationBody, beforeMessageId: string, message: ChatMessage) => void;
    insertMessageAfter: (target: WritableConversationBody, afterMessageId: string, message: ChatMessage) => void;
    findConversationMessage: (conversationId: string, messageId: string) => ChatMessage | undefined;
    getConversationMessages: (conversationId: string) => ChatMessage[];
    ensureConversationMessagesLoaded?: (conversationId: string) => Promise<Conversation | null>;
    replaceConversationMessages: (target: WritableConversationBody, messages: ChatMessage[]) => void;
    updateMessage: (target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) => void;
    persistToDb?: () => Promise<void>;
    appendRuntimeFeedbackEvent: (conversationId: string, event: RuntimeFeedbackEvent) => void;
    getRuntimeFeedbackEvents: (conversationId: string) => RuntimeFeedbackEvent[];
    getConversationTask: (conversationId: string) => ConversationTaskState | null;
    ensureConversationTask: (
      conversationId: string,
      messages: ChatMessage[],
      options?: { mode?: import('../../types/domain').ConversationTaskMode }
    ) => ConversationTaskState | null;
    setConversationTask: (conversationId: string, task: ConversationTaskState | null) => void;
    readLatestState: () => {
      conversations: Conversation[];
      pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
    };
  };
  persona: {
    personas: Persona[];
    readLatestState: () => {
      personas: Persona[];
    };
  };
  collection: {
    cards: CodeCard[];
    imageCards: ImageAssetCard[];
    projectFiles: ProjectFile[];
    workspaceReferenceDocs?: WorkspaceReferenceDoc[];
    roomProjects: RoomProject[];
    readLatestState: () => {
      cards: CodeCard[];
      imageCards: ImageAssetCard[];
      projectFiles: ProjectFile[];
      workspaceReferenceDocs?: WorkspaceReferenceDoc[];
      roomProjects: RoomProject[];
    };
  };
  runtime: {
    api: ProviderProfile;
    providers: ProviderProfile[];
    memoryVectorRetrieval: import('../../types/domain').MemoryVectorRetrievalSettings;
    imageGeneration: ImageGenerationSettings;
    imageUnderstanding: ImageUnderstandingSettings;
    mcpServers: McpServerConfig[];
    mcpToolTimeoutSeconds: number;
    toolPromptPreferences: PolarisToolPromptPreferences;
    taskModeEnabled: boolean;
    readLatestState: () => {
      api: ProviderProfile;
      providers: ProviderProfile[];
      memoryVectorRetrieval: import('../../types/domain').MemoryVectorRetrievalSettings;
      imageGeneration: ImageGenerationSettings;
      imageUnderstanding: ImageUnderstandingSettings;
      mcpServers: McpServerConfig[];
      mcpToolTimeoutSeconds: number;
      toolPromptPreferences: PolarisToolPromptPreferences;
      taskModeEnabled: boolean;
    };
  };
  space:
    & Pick<ChatSpaceFrontstagePort, 'activeWorld' | 'collectionShelf' | 'focusedMessageTarget' | 'activeCardId'>
    & Pick<ChatSpaceThemeSessionPort, 'activeThemePreview' | 'currentThemeFrame' | 'customization' | 'themeToolMode' | 'selectedSurfaceCodes'>
    & {
      readLatestState: () => {
        activeWorld: World;
        collectionShelf: CollectionShelf;
        activeCardId: string | null;
        activeThemePreview: ActiveThemePreview;
        currentThemeFrame: ThemeFrame;
        customization: AppCustomization;
        themeToolMode: ThemeToolMode;
        selectedSurfaceCodes: string[];
      };
    };
};

export type ChatToolStoreBindings = {
  chat: {
    conversations: Conversation[];
    pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
    ensureConversationWritable: (conversationId: string) => Promise<WritableConversationBody | null>;
    addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
    insertMessageBefore: (target: WritableConversationBody, beforeMessageId: string, message: ChatMessage) => void;
    insertMessageAfter: (target: WritableConversationBody, afterMessageId: string, message: ChatMessage) => void;
    createConversation: (
      collaboratorId?: string | null,
      options?: {
        activeProjectId?: string | null;
      }
    ) => string;
    findConversation: (
      conversationId: string
    ) => { id: string; kind?: 'direct' | 'group'; collaboratorId: string | null; activeProjectId?: string | null } | undefined;
    getConversationWritable: (conversationId: string) => WritableConversationBody | null;
    getConversationMessages: (conversationId: string) => ChatMessage[];
    ensureConversationMessagesLoaded?: (conversationId: string) => Promise<Conversation | null>;
    updateMessage: (target: WritableConversationBody, messageId: string, patch: Partial<ChatMessage>) => void;
    setConversationActiveProject: (conversationId: string, projectId: string | null) => void;
    upsertPendingWorkspaceProposal: (proposal: PendingWorkspaceProposalRecord) => void;
    removePendingWorkspaceProposal: (proposalId: string) => void;
    appendRuntimeFeedbackEvent: (conversationId: string, event: RuntimeFeedbackEvent) => void;
    getRuntimeFeedbackEvents: (conversationId: string) => RuntimeFeedbackEvent[];
    getConversationTask: (conversationId: string) => ConversationTaskState | null;
    setConversationTask: (conversationId: string, task: ConversationTaskState | null) => void;
    readLatestState?: () => {
      conversations: Conversation[];
      pendingWorkspaceProposals: PendingWorkspaceProposalRecord[];
    };
  };
  persona: {
    activeCollaboratorId: string | null;
    personas: Persona[];
    findCollaborator: (collaboratorId: string) => Persona | undefined;
    updateCollaborator: (collaboratorId: string, patch: Partial<Persona>) => void;
  };
  collection: {
    cards: CodeCard[];
    imageCards: ImageAssetCard[];
    projectFiles: ProjectFile[];
    workspaceReferenceDocs?: WorkspaceReferenceDoc[];
    roomProjects: RoomProject[];
    readLatestState: () => {
      cards: CodeCard[];
      imageCards: ImageAssetCard[];
      projectFiles: ProjectFile[];
      workspaceReferenceDocs?: WorkspaceReferenceDoc[];
      roomProjects: RoomProject[];
    };
    createCard: (seed?: Partial<CodeCard>) => string;
    createProjectFile: (seed: Partial<ProjectFile> & Pick<ProjectFile, 'projectId' | 'filePath'>) => string | null;
    createWorkspaceReferenceDoc?: (
      seed: Partial<WorkspaceReferenceDoc> & Pick<WorkspaceReferenceDoc, 'projectId' | 'title'>
    ) => string | null;
    deleteWorkspaceReferenceDoc?: (docId: string) => void;
    createProject: (seed?: Partial<RoomProject>) => string;
    updateProject: (projectId: string, patch: RoomProjectPatch) => void;
    promoteCardToProject: (args: {
      cardId: string;
      projectTitle?: string;
      filePath?: string;
      fileRole?: CodeCardFileRole;
    }) => { projectId: string; fileId: string } | null;
    saveCardFromChat: (input: {
      title?: string;
      cardNote?: string;
      language?: string;
      code: string;
      cardFaceCss?: string;
      tags?: string[];
      ownerCollaboratorId?: string;
      conversationId: string;
      messageId: string;
      blockIndex: number;
      blockTitle?: string;
    }) => { cardId: string; created: boolean; title: string } | null;
    saveImageCardFromChat: (input: {
      assetId: string;
      title?: string;
      tags?: string[];
      ownerCollaboratorId?: string;
      imageName: string;
      conversationId: string;
      messageId: string;
      attachmentId: string;
    }) => { cardId: string; created: boolean; title: string } | null;
    updateCard: (cardId: string, patch: Partial<CodeCard>) => void;
    updateProjectFile: (
      fileId: string,
      patch: Partial<Pick<ProjectFile, 'fileRole' | 'language' | 'content' | 'ownerCollaboratorId' | 'source'>>
    ) => void;
    deleteProjectFile: (fileId: string) => void;
  };
  runtime: {
    api: ProviderProfile;
    providers: ProviderProfile[];
    imageGeneration: ImageGenerationSettings;
    imageUnderstanding: ImageUnderstandingSettings;
    search: WebSearchConfig;
    mcpServers: McpServerConfig[];
    mcpToolTimeoutSeconds: number;
    readLatestState?: () => {
      api: ProviderProfile;
      providers: ProviderProfile[];
      imageGeneration: ImageGenerationSettings;
      imageUnderstanding: ImageUnderstandingSettings;
      search: WebSearchConfig;
      mcpServers: McpServerConfig[];
      mcpToolTimeoutSeconds: number;
      triggerRules: PolarisTriggerRule[];
    };
    getTriggerRules: () => PolarisTriggerRule[];
    setTaskModeEnabled: (enabled: boolean) => void;
    createTriggerRule: (seed: {
      name?: string;
      schedule: PolarisTriggerSchedule;
      target: PolarisTriggerTarget;
      action: PolarisTriggerAction;
    }) => string;
    updateTriggerRule: (ruleId: string, patch: Partial<PolarisTriggerRule>) => void;
    deleteTriggerRule: (ruleId: string) => void;
  };
  space:
    & Pick<
      ChatSpaceFrontstagePort,
      | 'activeWorld'
      | 'activeCardId'
      | 'collectionShelf'
      | 'frontstageCollaboratorId'
      | 'setCollectionShelf'
      | 'setWorld'
      | 'setActiveCard'
      | 'spotlightCard'
    >
    & Pick<
      ChatSpaceThemeSessionPort,
      | 'activeThemePreview'
      | 'applyThemePatch'
      | 'applyThemePreset'
      | 'beginThemePreview'
      | 'commitThemePreview'
      | 'currentThemeFrame'
      | 'getActiveThemePreview'
      | 'getCurrentThemeFrame'
      | 'rollbackThemePreview'
      | 'saveCurrentSkin'
      | 'setThemeToolMode'
      | 'themeToolMode'
    >;
};

export type ChatToolDerivedState = Pick<ChatDerivedStatePort, 'activeConversation' | 'activeCollaboratorSourceId' | 'codeCardActionModeByMessageId'>;

export type ToolActionLocalState = ChatUiToolState;

export type ToolActionChatState = ChatToolStoreBindings['chat'];

export type ToolActionCollectionState = ChatToolStoreBindings['collection'];

export type ToolActionSpaceState = ChatToolStoreBindings['space'];

export type MemoryActions = {
  appendCollaboratorMemories: (items: string[], conversationId?: string | null) => boolean;
  writeCollaboratorMemoryDoc: (doc: {
    docId?: string;
    title: string;
    summary?: string;
    content: string;
  }, conversationId?: string | null) => { ok: true; docId: string; title: string; created: boolean } | { ok: false; error: string };
  readCollaboratorMemoryDoc: (docId: string, conversationId?: string | null) => Promise<Persona['memory']['referenceDocs'][number] | null>;
  listCollaboratorMemoryDocs?: (conversationId?: string | null) => Persona['memory']['referenceDocs'];
  searchCollaboratorMemory?: (
    query: string,
    mode?: 'auto' | 'summary' | 'source',
    maxResults?: number,
    conversationId?: string | null
  ) => { ok: true; summary?: string; detailText?: string } | { ok: false; error: string };
  openMemorySource?: (
    sourceConversationId: string,
    sourceMessageIds?: string[],
    maxChars?: number,
    conversationId?: string | null
  ) => { ok: true; summary?: string; detailText?: string } | { ok: false; error: string };
  maybeHandleWriteMemoryAction: (
    target: WritableConversationBody,
    action: import('../../engines/toolExecutor').ToolAction,
    options?: {
      beforeMessageId?: string;
      sourceToolCallId?: string;
    }
  ) => boolean;
  applyMemoryPreview: (target: WritableConversationBody, message: ChatMessage) => boolean;
  rollbackMemoryPreview: (target: WritableConversationBody, message: ChatMessage) => boolean;
};

export type AddRuntimeToolMessage = (
  target: WritableConversationBody,
  toolInvocation: ToolInvocation,
  attachments?: ChatMessage['attachments'],
  options?: { beforeMessageId?: string }
) => void;
