import { resolveConversationMcpServers } from '../../engines/conversationWindowSettings';
import { applyConversationRequestContext } from '../../engines/conversationContextSettings';
import { inferModelTier } from '../../engines/modelTier';
import { resolveProviderCapability } from '../../engines/provider-runtime';
import {
  filterCodeCardsForCollaboratorScope,
  filterImageCardsForCollaboratorScope,
  filterProjectFilesForCollaboratorScope
} from '../../engines/collectionOwnership';
import { isGroupConversation } from '../../engines/conversationOwnership';
import { buildRoomProjectTreeSnapshots } from '../../engines/roomProjects';
import { getRunCodeSandboxProfile } from '../../infrastructure/runCodeSandboxMode';
import { getNativePersonalDataToolAvailability } from '../../native/personalData';
import type {
  ChatAttachment,
  ChatMessage,
  CodeCard,
  CollectionShelf,
  Conversation,
  ConversationReasoningStrength,
  ConversationTaskState,
  ImageAssetCard,
  ImageGenerationSettings,
  ImageUnderstandingSettings,
  MemoryVectorRetrievalSettings,
  McpServerConfig,
  Persona,
  ProjectFile,
  ProviderProfile,
  RoomProject,
  ThemeFrame,
  ThemeToolMode,
  World,
  WorkspaceReferenceDoc
} from '../../types/domain';
import type { PolarisToolPromptPreferences } from '../../engines/assistantToolProtocol';
import { isPolarisToolPromptGroupEnabled } from '../../engines/tool-protocol/toolPromptPreferences';
import { retrieveRelevantCollectionCards } from './chatCollectionCardRetrieval';
import { findLatestUserCardReference, findLatestUserContinueCardReference } from './chatMessageCardReference';
import { buildThemeToolContext } from './chatThemeToolContext';
import { resolveRoomContextMode } from './roomContextMode';
import type { RuntimeFeedbackEvent } from '../../engines/runtime-feedback/runtimeFeedbackEvents';
import type { PendingWorkspaceProposalRecord } from '../../engines/workspaceBinding';
import { resolveConversationTaskMode } from '../../engines/conversationTask';
import { buildWorkContext } from '../../engines/workContext';

function buildAttachmentSnapshot(messages: ChatMessage[]) {
  const available = messages.flatMap((message) => message.attachments?.filter((attachment) => !attachment.clearedAt) ?? []);
  const latest = [...messages].reverse().find(
    (message) => message.role === 'user' && (message.attachments?.some((attachment) => !attachment.clearedAt) ?? false)
  )?.attachments?.filter((attachment) => !attachment.clearedAt) ?? [];
  const toItem = (attachment: ChatAttachment) => ({
    id: attachment.id,
    assetId: attachment.assetId,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType
  });

  return {
    latest: latest.map(toItem),
    available: available.slice(-8).map(toItem)
  };
}

function buildImageAssetSnapshot(imageCards: ImageAssetCard[]) {
  return {
    available: imageCards.slice(0, 12).map((card) => ({
      id: card.id,
      assetId: card.assetId,
      title: card.title,
      tags: card.tags,
      source: card.source,
      cssUrl: `url("polaris-asset://${card.assetId}")`
    }))
  };
}

function isImageGenerationAvailable(args: {
  settings?: ImageGenerationSettings;
  providers?: ProviderProfile[];
}) {
  const providerId = args.settings?.providerId?.trim();
  return args.settings?.enabled === true
    && Boolean(providerId)
    && (args.providers?.some((provider) => provider.id === providerId) ?? false);
}

function isMemorySearchAvailable(args: {
  collaborator?: Persona | null;
  memoryVectorRetrieval?: MemoryVectorRetrievalSettings;
}) {
  if (!args.collaborator) return false;
  return Boolean(args.collaborator)
    && (args.collaborator.memory?.crossConversationRecallEnabled !== false
      || args.memoryVectorRetrieval?.enabled === true);
}

export type ChatReplyRequestSnapshot = {
  api: ProviderProfile;
  providers?: ProviderProfile[];
  globalApi?: ProviderProfile;
  memoryVectorRetrieval?: MemoryVectorRetrievalSettings;
  imageGeneration?: ImageGenerationSettings;
  imageUnderstanding?: ImageUnderstandingSettings;
  activeWorld: World;
  collectionShelf: CollectionShelf;
  chatAvatarLayoutEnabled: boolean;
  themeToolMode: ThemeToolMode;
  enabledToolGroups: PolarisToolPromptPreferences;
  taskModeEnabled: boolean;
  mcpServers: McpServerConfig[];
  mcpToolTimeoutSeconds: number;
  themePreviewActive: boolean;
  currentThemeFrame: ThemeFrame;
  recentThemeToolModeSwitch?: {
    from: ThemeToolMode;
    to: ThemeToolMode;
  };
  selectedSurfaceCodes: string[];
  collectionCards: CodeCard[];
  imageCards: ImageAssetCard[];
  projectFiles: ProjectFile[];
  workspaceReferenceDocs?: WorkspaceReferenceDoc[];
  roomProjects: RoomProject[];
  activeCardId: string | null;
  activeProjectId: string | null;
  currentTask?: ConversationTaskState | null;
  pendingWorkspaceProposal: PendingWorkspaceProposalRecord | null;
  runtimeFeedbackEvents: RuntimeFeedbackEvent[];
  conversations: Conversation[];
  semanticRecallEnabled?: boolean;
  semanticRecallConversations?: Conversation[];
  personas: Persona[];
  currentCollaboratorId: string | null;
  activeConversationTitle?: string;
  requestContext?: Conversation['requestContext'];
  windowPreferences?: Conversation['windowPreferences'];
  reasoningStrength?: ConversationReasoningStrength;
  activeCollaborator: Persona | null;
};

export type ChatReplyRequestSnapshotSource = Omit<
  ChatReplyRequestSnapshot,
  | 'activeProjectId'
  | 'reasoningStrength'
  | 'requestContext'
  | 'windowPreferences'
> & {
  activeCollaborator: Persona | null;
};

export function createChatReplyRequestSnapshot(args: {
  source: ChatReplyRequestSnapshotSource;
  activeConversation: {
    id: string;
    title: string;
    activeProjectId?: string | null;
    reasoningStrength?: ConversationReasoningStrength;
  } | null;
}) {
  const { source, activeConversation } = args;
  // 群聊请求的卡片/图片由调用方按"本群产出"圈定；这里若再按当前发言成员过滤，
  // 成员就看不见彼此的群卡片了（群里要求可以查看、编辑彼此的卡）。
  const activeConversationRecord = activeConversation
    ? source.conversations.find((conversation) => conversation.id === activeConversation.id) ?? null
    : null;
  const groupScoped = activeConversationRecord ? isGroupConversation(activeConversationRecord) : false;
  const rawActiveProjectId = activeConversation?.activeProjectId ?? null;
  const activeProjectId = rawActiveProjectId && source.roomProjects.some((project) => project.id === rawActiveProjectId)
    ? rawActiveProjectId
    : null;
  const pendingWorkspaceProposal = source.pendingWorkspaceProposal
    && (!activeConversation || source.pendingWorkspaceProposal.conversationId === activeConversation.id)
    ? source.pendingWorkspaceProposal
    : null;
  return {
    api: source.api,
    providers: source.providers,
    globalApi: source.globalApi,
    memoryVectorRetrieval: source.memoryVectorRetrieval,
    imageGeneration: source.imageGeneration,
    imageUnderstanding: source.imageUnderstanding,
    activeWorld: source.activeWorld,
    collectionShelf: source.collectionShelf,
    chatAvatarLayoutEnabled: source.chatAvatarLayoutEnabled,
    themeToolMode: source.themeToolMode,
    enabledToolGroups: source.enabledToolGroups,
    taskModeEnabled: source.taskModeEnabled,
    mcpServers: resolveConversationMcpServers(source.mcpServers, activeConversationRecord?.windowPreferences?.mcpScope),
    mcpToolTimeoutSeconds: source.mcpToolTimeoutSeconds,
    themePreviewActive: source.themePreviewActive,
    currentThemeFrame: source.currentThemeFrame,
    recentThemeToolModeSwitch: source.recentThemeToolModeSwitch,
    selectedSurfaceCodes: source.selectedSurfaceCodes,
    collectionCards: groupScoped
      ? source.collectionCards
      : filterCodeCardsForCollaboratorScope(
          source.collectionCards,
          source.conversations,
          source.currentCollaboratorId
        ),
    imageCards: groupScoped
      ? source.imageCards
      : filterImageCardsForCollaboratorScope(
          source.imageCards,
          source.conversations,
          source.currentCollaboratorId
        ),
    projectFiles: filterProjectFilesForCollaboratorScope(
      source.projectFiles,
      source.currentCollaboratorId,
      activeProjectId
    ),
    workspaceReferenceDocs: (source.workspaceReferenceDocs ?? [])
      .filter((doc) =>
        !source.currentCollaboratorId
        || !doc.ownerCollaboratorId
        || doc.ownerCollaboratorId === source.currentCollaboratorId
      ),
    roomProjects: source.roomProjects,
    activeCardId: source.activeCardId,
    activeProjectId,
    currentTask: source.currentTask ?? null,
    pendingWorkspaceProposal,
    runtimeFeedbackEvents: source.runtimeFeedbackEvents,
    conversations: source.conversations,
    semanticRecallEnabled: source.semanticRecallEnabled,
    semanticRecallConversations: source.semanticRecallConversations,
    personas: source.personas,
    currentCollaboratorId: source.currentCollaboratorId,
    activeConversationTitle: source.activeConversationTitle ?? activeConversation?.title,
    requestContext: activeConversationRecord?.requestContext,
    windowPreferences: activeConversationRecord?.windowPreferences,
    reasoningStrength: activeConversation?.reasoningStrength ?? 'automatic',
    activeCollaborator: source.activeCollaborator
  } satisfies ChatReplyRequestSnapshot;
}

export function buildReplyToolContext(args: {
  snapshot: ChatReplyRequestSnapshot;
  collaboratorId: string;
  messages: ChatMessage[];
}) {
  const { snapshot, collaboratorId, messages } = args;
  const visibleCards = snapshot.collectionCards;
  const visibleImageCards = snapshot.imageCards ?? [];
  const visibleProjectFiles = snapshot.projectFiles;
  const visibleWorkspaceReferenceDocs = snapshot.workspaceReferenceDocs ?? [];
  const latestUserCardReference = findLatestUserCardReference(messages);
  const continueCardReference = findLatestUserContinueCardReference(messages);
  const effectiveActiveCardId = latestUserCardReference?.id ?? snapshot.activeCardId;
  const activeCard = visibleCards.find((card) => card.id === effectiveActiveCardId) ?? null;
  const activeCardReferenceMode: 'continue' | 'reference' | 'ambient' | undefined =
    latestUserCardReference?.mode ?? (activeCard ? 'ambient' : undefined);
  const visibleProjects = buildRoomProjectTreeSnapshots(
    snapshot.roomProjects,
    visibleProjectFiles,
    { includeProjectIds: snapshot.activeProjectId ? [snapshot.activeProjectId] : [] }
  );
  const activeProject = snapshot.activeProjectId
    ? visibleProjects.find((project) => project.id === snapshot.activeProjectId) ?? null
    : null;
  let collaboratorForReply =
    applyConversationRequestContext(
      snapshot.personas.find((persona) => persona.id === collaboratorId) ?? snapshot.activeCollaborator,
      snapshot.requestContext
    );
  if (collaboratorForReply && snapshot.windowPreferences?.modelBinding?.providerId === snapshot.api.id) {
    collaboratorForReply = { ...collaboratorForReply, advanced: { ...collaboratorForReply.advanced, providerId: snapshot.api.id, modelOverride: snapshot.api.model } };
  }
  const assistantName = collaboratorForReply?.name || snapshot.activeCollaborator?.name || 'Assistant';
  const providerCapability = resolveProviderCapability(snapshot.api);
  const modelId = providerCapability.provider.model;
  const modelTier = inferModelTier({
    modelId,
    isMirrorAggregator: providerCapability.route.isMirrorAggregator
  });
  const themeToolContext = buildThemeToolContext({
    messages,
    activeWorld: snapshot.activeWorld,
    collectionShelf: snapshot.collectionShelf,
    themeToolMode: snapshot.themeToolMode,
    enabledToolGroups: snapshot.enabledToolGroups,
    themePreviewActive: snapshot.themePreviewActive,
    selectedSurfaceCodes: snapshot.selectedSurfaceCodes,
    currentThemeFrame: snapshot.currentThemeFrame,
    recentThemeToolModeSwitch: snapshot.recentThemeToolModeSwitch,
    modelTier,
    chatAvatarLayoutEnabled: snapshot.chatAvatarLayoutEnabled
  });
  const retrievedCards = retrieveRelevantCollectionCards({
    cards: snapshot.collectionCards,
    conversations: snapshot.conversations,
    personas: snapshot.personas,
    activeCardId: effectiveActiveCardId,
    messages
  });
  const shouldForceRoomAction =
    Boolean(continueCardReference)
    && themeToolContext.toolContext.toolEnforcementScope !== 'theme-only';
  const runtimeFeedback = {
    pendingWorkspaceProposal: snapshot.pendingWorkspaceProposal,
    events: snapshot.runtimeFeedbackEvents
  };
  const taskToolsEnabled = isPolarisToolPromptGroupEnabled(snapshot.enabledToolGroups, 'task');
  const imageGenerationAvailable = isImageGenerationAvailable({
    settings: snapshot.imageGeneration,
    providers: snapshot.providers
  });
  const memorySearchAvailable = isMemorySearchAvailable({
    collaborator: collaboratorForReply,
    memoryVectorRetrieval: snapshot.memoryVectorRetrieval
  });
  const personalDataAvailability = getNativePersonalDataToolAvailability();
  const workContext = buildWorkContext({
    currentTask: snapshot.currentTask,
    messages,
    activeProject,
    visibleProjects,
    runtimeFeedback
  });

  return {
    collaboratorForReply,
    assistantName,
    modelTier,
    effectiveActiveCardId,
    toolContext: {
      activeCard,
      activeCardReferenceMode,
      roomContextMode: resolveRoomContextMode({
        activeWorld: snapshot.activeWorld,
        collectionShelf: snapshot.collectionShelf,
        hasActiveCard: Boolean(activeCard)
      }),
      visibleCards,
      visibleProjectFiles,
      visibleWorkspaceReferenceDocs,
      activeProject,
      visibleProjects,
      workContext,
      retrievedCards,
      uiSnapshot: {
        activeWorld: snapshot.activeWorld,
        collectionShelf: snapshot.collectionShelf,
        activeConversationTitle: snapshot.activeConversationTitle,
        activeCollaboratorName: collaboratorForReply?.name || snapshot.activeCollaborator?.name,
        chatAvatarLayoutEnabled: snapshot.chatAvatarLayoutEnabled,
        selectorHints: themeToolContext.selectorHints
      },
      attachmentSnapshot: buildAttachmentSnapshot(messages),
      imageAssetSnapshot: buildImageAssetSnapshot(visibleImageCards),
      imageGenerationAvailable,
      memorySearchAvailable,
      personalData: {
        calendarAvailable: personalDataAvailability.calendarAvailable,
        calendarWriteAvailable: personalDataAvailability.calendarWriteAvailable,
        calendarPermission: personalDataAvailability.status.calendar.permission,
        platform: personalDataAvailability.status.platform
      },
      mcpServers: snapshot.mcpServers,
      mcpToolTimeoutSeconds: snapshot.mcpToolTimeoutSeconds,
      runCodeSandboxProfile: getRunCodeSandboxProfile(),
      taskMode: taskToolsEnabled ? resolveConversationTaskMode(snapshot.currentTask) : 'seed',
      ...themeToolContext.toolContext,
      runtimeFeedback,
      toolEnforcementMode: (
        shouldForceRoomAction ? 'force' : themeToolContext.toolContext.toolEnforcementMode
      ) as 'normal' | 'force',
      toolEnforcementScope: shouldForceRoomAction ? undefined : themeToolContext.toolContext.toolEnforcementScope
    }
  };
}
