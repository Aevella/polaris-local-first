import { createUid } from '../../engines/id';
import type { OpenAiToolHistoryMode } from '../../engines/provider-runtime/providerRuntimeOpenAiToolHistory';
import {
  isConversationTaskTerminal,
  resolveConversationTaskMode
} from '../../engines/conversationTask';
import { buildAssistantMessagePatch } from '../../engines/chatMessageNormalization';
import {
  buildProviderFailureRequestContent,
  normalizeProviderErrorMessage
} from '../../engines/providerErrorHandling';
import { requestCollaboratorReply } from '../../engines/request/requestPipeline';
import type { AssistantReply } from '../../engines/chatApi';
import type { AssistantRequestAudit } from '../../engines/request/requestAudit';
import { resolveMcpToolCatalog } from '../../engines/mcpRuntime';
import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolEnforcementScope } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ChatMessage } from '../../types/domain';
import { recordChatQaAudit } from './chatQaAuditRecorder';
import {
  resolveAssistantToolActions,
  resolveNativeToolCardActions
} from './chatAssistantToolRuntime';
import { isAbortError, throwIfAborted } from './chatAbortError';
import { resolveAssistantToolPreparationOutcome } from './chatToolOutcome';
import type { ToolActionRunOutcome } from './chatToolOutcome';
import {
  buildPreparationFailureRuntimeFeedbackEvent,
  buildPreparationFailureToolInvocation
} from './chatToolOutcome';
import type { ChatReplyStoreBindings, ChatUiReplyState } from './chatPorts';
import { parseAssistantReplyContent } from './chatReplyContent';
import { buildReplyToolContext, type ChatReplyRequestSnapshot } from './chatReplyContext';
import { buildChatMemoryEvidenceFromAudit } from './chatMemoryEvidence';
import { createStreamingSession } from './chatStreamingSession';
import { buildStoredToolCallRecords } from './chatToolCallRecords';
import { recordModelFlowTrace } from './modelFlowTraceRecorder';
import { resolveAvailablePolarisToolNames } from '../../engines/tool-protocol/toolRegistry';
import {
  applyConversationTaskModelUpdate,
  settleConversationTaskAfterStoppedAssistantTurn
} from './chatTaskSettlement';
import {
  commitAssistantToolEvidenceStage,
  commitRecoveredToolEvidenceStage,
  type TaskActivationEnforcement
} from './chatToolEvidenceStage';
import {
  buildLengthFollowupSystemMessage,
  buildToolPreparationRetrySystemMessage,
  buildTruncatedToolFollowupSystemMessage,
  shouldRequestLengthFollowup,
  relaxToolEnforcementForFollowup,
  resolveToolFollowupPlan
} from './chatToolFollowup';
import {
  appendInterruptedWorkspaceDraftFailure,
  executeInterruptedWorkspaceDraftActions,
  executeRecoverableTruncatedToolActions,
  hasInterruptedWorkspaceDraftShape
} from './chatReplyRecovery';
import { createMessage } from '../../engines/chatMessageFactory';
import { getDesktopLocalHostBridge } from '../../desktop/localHost';
import type { AssistantToolContext } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import {
  finishChatSendPerformanceTrace,
  recordChatSendPerformanceMark
} from './chatSendPerformanceTrace';
import {
  ChatReplyPersistenceError,
  persistChatReplyBoundary
} from './chatReplyPersistence';

type RequestReplyArgs = {
  ui: Pick<
    ChatUiReplyState,
    | 'abortControllerRef'
    | 'setSending'
    | 'setStreaming'
    | 'streamingLifecycleReleaseRef'
  >;
  chat: Pick<
    ChatReplyStoreBindings['chat'],
    | 'addMessage'
    | 'appendRuntimeFeedbackEvent'
    | 'findConversation'
    | 'insertMessageBefore'
    | 'findConversationMessage'
    | 'getConversationTask'
    | 'getConversationMessages'
    | 'replaceConversationMessages'
    | 'setConversationTask'
    | 'updateMessage'
    | 'persistToDb'
  >;
  executeToolActions: (
    conversationId: string,
    actions: ToolAction[],
    options?: {
      beforeMessageId?: string;
      toolCallIds?: string[];
      signal?: AbortSignal;
    }
  ) => Promise<ToolActionRunOutcome[]>;
  conversationId: string;
  writableConversation: WritableConversationBody;
  collaboratorId: string;
  messages: ChatMessage[];
  requestMessages?: ChatMessage[];
  requestSnapshot: ChatReplyRequestSnapshot;
  refreshRequestSnapshot?: () => ChatReplyRequestSnapshot;
  loadSemanticRecallConversations?: (conversationIds: string[]) => Promise<ChatReplyRequestSnapshot['conversations']>;
  preferredOpenAiToolHistoryMode?: OpenAiToolHistoryMode;
  continuation?: ChatReplyContinuationState;
};

type ChatReplyContinuationState = {
  toolExchangeDepth: number;
  seenToolExchangeFingerprints: readonly string[];
  lengthRecoveryDepth: number;
  preparationRetryDepth: number;
  taskActivationEnforcement: TaskActivationEnforcement | null;
};

const INITIAL_CHAT_REPLY_CONTINUATION_STATE: ChatReplyContinuationState = {
  toolExchangeDepth: 0,
  seenToolExchangeFingerprints: [],
  lengthRecoveryDepth: 0,
  preparationRetryDepth: 0,
  taskActivationEnforcement: null
};

export type ChatReplyRunResult = {
  status: 'completed' | 'aborted' | 'failed';
};

export type RequestReplyChatPort = RequestReplyArgs['chat'];

class ChatReplyContinuation {
  constructor(readonly next: RequestReplyArgs) {}
}

async function readDesktopLocalHostPromptState(): Promise<AssistantToolContext['desktopLocalHost']> {
  const bridge = getDesktopLocalHostBridge();
  if (!bridge) return undefined;
  try {
    const state = await bridge.getState();
    return {
      available: state.available,
      platform: state.platform,
      permissionMode: state.permissionMode,
      trustedRoots: state.trustedRoots.map((root) => ({
        id: root.id,
        label: root.label,
        path: root.path,
        lastUsedAt: root.lastUsedAt
      }))
    };
  } catch {
    return undefined;
  }
}

function stripUnpairedNativeToolCallsForFollowup(message: ChatMessage, assistantMessageId: string) {
  if (message.id !== assistantMessageId || message.role !== 'assistant' || !message.nativeToolCalls?.length) {
    return message;
  }

  const { nativeToolCalls: _nativeToolCalls, ...messageWithoutNativeToolCalls } = message;
  return messageWithoutNativeToolCalls;
}

function buildLengthFollowupRequestMessages(
  messages: ChatMessage[],
  options: {
    followupMessage?: ChatMessage;
    unpairedAssistantMessageId?: string;
  } = {}
) {
  const unpairedAssistantMessageId = options.unpairedAssistantMessageId;
  const followupMessages = unpairedAssistantMessageId
    ? messages.map((message) =>
        stripUnpairedNativeToolCallsForFollowup(message, unpairedAssistantMessageId)
      )
    : messages;
  return [...followupMessages, options.followupMessage ?? buildLengthFollowupSystemMessage()];
}

function buildToolPreparationRetryRequestMessages(
  messages: ChatMessage[],
  assistantMessageId: string,
  followupMessage: ChatMessage
) {
  return [
    ...messages.map((message) => stripUnpairedNativeToolCallsForFollowup(message, assistantMessageId)),
    followupMessage
  ];
}

function buildTaskActivationFollowupSystemMessage() {
  return createMessage(
    'system',
    [
      '你刚刚已经把这件事正式立成任务了。',
      '继续这个任务：该真正动手就动手，该用工具就用工具，让下一小段工作真的落下去。'
    ].join(' ')
  );
}

function appendPartialStreamNotice(
  chat: Pick<ChatReplyStoreBindings['chat'], 'addMessage'>,
  writableConversation: WritableConversationBody
) {
  chat.addMessage(
    writableConversation,
    createMessage(
      'system',
      '流式连接提前结束，已保留已收到的部分回复。这不是手动打断。'
    )
  );
}

function applyTaskActivationEnforcement<T extends {
  toolEnforcementMode?: 'normal' | 'force';
  toolEnforcementScope?: AssistantToolEnforcementScope;
}>(
  toolContext: T,
  enforcement?: TaskActivationEnforcement | null
): T {
  if (!enforcement) return toolContext;
  return {
    ...toolContext,
    toolEnforcementMode: enforcement.mode,
    toolEnforcementScope: enforcement.scope
  };
}

function settleConversationTaskAfterAssistantTurn(args: {
  chat: Pick<ChatReplyStoreBindings['chat'], 'getConversationTask' | 'setConversationTask'>;
  conversationId: string;
  assistantMessageId: string;
  updatedAt?: number;
}) {
  const currentTask = args.chat.getConversationTask(args.conversationId);
  if (!currentTask) return;

  if (resolveConversationTaskMode(currentTask) !== 'active') {
    args.chat.setConversationTask(args.conversationId, null);
    return;
  }

  args.chat.setConversationTask(
    args.conversationId,
    settleConversationTaskAfterStoppedAssistantTurn({
      currentTask,
      workspaceSessionStage: null,
      assistantMessageId: args.assistantMessageId,
      updatedAt: args.updatedAt ?? Date.now()
    })
  );
}

async function requestReplyRound({
  ui,
  chat,
  executeToolActions,
  conversationId,
  writableConversation,
  collaboratorId,
  messages,
  requestMessages = messages,
  requestSnapshot,
  refreshRequestSnapshot,
  loadSemanticRecallConversations,
  preferredOpenAiToolHistoryMode,
  continuation = INITIAL_CHAT_REPLY_CONTINUATION_STATE
}: RequestReplyArgs): Promise<ChatReplyRunResult> {
  const {
    toolExchangeDepth,
    seenToolExchangeFingerprints,
    lengthRecoveryDepth,
    preparationRetryDepth,
    taskActivationEnforcement
  } = continuation;
  await persistChatReplyBoundary(chat.persistToDb, 'before-request');
  recordChatSendPerformanceMark(conversationId, '聊天发送 · 用户消息已安全落盘');
  const activeRequestSnapshot = refreshRequestSnapshot?.() ?? requestSnapshot;
  const {
    collaboratorForReply,
    assistantName,
    modelTier,
    effectiveActiveCardId,
    toolContext
  } = buildReplyToolContext({
    snapshot: activeRequestSnapshot,
    collaboratorId,
    messages
  });
  const effectiveToolContext = applyTaskActivationEnforcement(
    relaxToolEnforcementForFollowup(toolContext, toolExchangeDepth),
    taskActivationEnforcement
  );
  recordChatSendPerformanceMark(conversationId, '聊天发送 · 工具上下文就绪', {
    messageCount: messages.length,
    extra: [
      `visible tools ${resolveAvailablePolarisToolNames(effectiveToolContext).size}`,
      `mcp servers ${effectiveToolContext.mcpServers?.length ?? 0}`
    ]
  });
  const desktopLocalHost = await readDesktopLocalHostPromptState();
  const effectiveToolContextWithDesktop = desktopLocalHost
    ? { ...effectiveToolContext, desktopLocalHost }
    : effectiveToolContext;
  const mcpToolCatalog = await resolveMcpToolCatalog({
    servers: effectiveToolContextWithDesktop.mcpServers,
    timeoutSeconds: effectiveToolContextWithDesktop.mcpToolTimeoutSeconds
  });
  recordChatSendPerformanceMark(conversationId, '聊天发送 · 外部工具目录就绪', {
    extra: [
      desktopLocalHost ? 'desktop bridge yes' : 'desktop bridge no',
      `mcp tools ${mcpToolCatalog.tools?.length ?? 0}`,
      mcpToolCatalog.errors?.length ? `mcp errors ${mcpToolCatalog.errors.length}` : null
    ]
  });
  const toolContextWithMcp = {
    ...effectiveToolContextWithDesktop,
    mcpTools: mcpToolCatalog.tools,
    mcpCatalogErrors: mcpToolCatalog.errors
  };
  const availableToolNames = resolveAvailablePolarisToolNames(toolContextWithMcp);
  const ignoredUnknownNativeToolNames = Array.from(availableToolNames);
  const placeholderId = createUid('assistant');
  const streaming = createStreamingSession({
    ui,
    chat,
    conversationId,
    writableConversation,
    placeholderId,
    assistantName,
    speakerCollaboratorId: collaboratorId,
    providerId: activeRequestSnapshot.api.id,
    providerName: activeRequestSnapshot.api.name,
    modelTier,
    themeToolMode: toolContextWithMcp.themeToolMode ?? 'stable',
    ignoredUnknownNativeToolNames,
    hasWorkspaceContext: Boolean(activeRequestSnapshot.activeProjectId),
    activeProjectId: activeRequestSnapshot.activeProjectId,
    allowCreativeCssRecovery: toolContextWithMcp.toolEnforcementScope === 'theme-only',
    mcpTools: toolContextWithMcp.mcpTools,
    onFirstProgressFlushed: () => {
      recordChatSendPerformanceMark(conversationId, '聊天发送 · 首个回复已渲染');
    }
  });
  let preserveStreamingLifecycle = false;
  let activatedTaskThisTurn = false;
  let latestTaskState = activeRequestSnapshot.currentTask ?? null;
  let nextTaskActivationEnforcement: TaskActivationEnforcement | null = null;
  let requestAudit: AssistantRequestAudit | null = null;

  streaming.start();
  recordChatSendPerformanceMark(conversationId, '聊天发送 · 占位消息已显示');

  try {
    const reply = await requestCollaboratorReply({
      api: activeRequestSnapshot.api,
      providers: activeRequestSnapshot.providers,
      globalApi: activeRequestSnapshot.globalApi,
      memoryVectorRetrieval: activeRequestSnapshot.memoryVectorRetrieval,
      imageUnderstanding: activeRequestSnapshot.imageUnderstanding,
      persona: collaboratorForReply,
      personas: activeRequestSnapshot.personas,
      semanticRecallEnabled: activeRequestSnapshot.semanticRecallEnabled,
      messages: requestMessages,
      semanticRecallConversations: activeRequestSnapshot.semanticRecallConversations ?? activeRequestSnapshot.conversations,
      loadSemanticRecallConversations,
      activeConversationId: conversationId,
      toolLedger: chat.findConversation(conversationId)?.toolLedger,
      toolContext: toolContextWithMcp,
      currentTask: activeRequestSnapshot.currentTask,
      preferredOpenAiToolHistoryMode,
      signal: streaming.controller.signal,
      onProgress: streaming.queueProgress,
      onAudit: (audit) => {
        requestAudit = audit;
      },
      onImageUnderstandingResults: (results) => {
        const patchesByMessageId = new Map<string, Map<string, string>>();
        results.forEach((result) => {
          const patches = patchesByMessageId.get(result.messageId) ?? new Map<string, string>();
          patches.set(result.attachmentId, result.textContent);
          patchesByMessageId.set(result.messageId, patches);
        });
        patchesByMessageId.forEach((patches, messageId) => {
          const message = chat.findConversationMessage(conversationId, messageId);
          if (!message?.attachments?.length) return;
          chat.updateMessage(writableConversation, messageId, {
            attachments: message.attachments.map((attachment) => {
              const textContent = patches.get(attachment.id);
              return textContent ? { ...attachment, textContent } : attachment;
            })
          });
        });
      }
    });
    recordChatSendPerformanceMark(conversationId, '聊天发送 · 模型返回完成', {
      extra: [
        `chars ${reply.content.length}`,
        reply.transportIncomplete ? 'stream incomplete' : null,
        reply.nativeToolCalls?.length ? `native tools ${reply.nativeToolCalls.length}` : null
      ]
    });
    throwIfAborted(streaming.controller.signal);
    streaming.commitQueuedProgress();
    throwIfAborted(streaming.controller.signal);

    const latestPlaceholder = chat.findConversationMessage(conversationId, placeholderId);
    const finalContent = reply.content.trim() ? reply.content : latestPlaceholder?.content ?? reply.content;
    const { parsed, visibleContent, isToolOnlyTurn, taskUpdate } = parseAssistantReplyContent(
      finalContent,
      modelTier,
      toolContextWithMcp.themeToolMode ?? 'stable',
      'final',
      reply.nativeToolCalls ?? [],
      ignoredUnknownNativeToolNames,
      {
        hasWorkspaceContext: Boolean(activeRequestSnapshot.activeProjectId),
        activeProjectId: activeRequestSnapshot.activeProjectId,
        allowCreativeCssRecovery: toolContextWithMcp.toolEnforcementScope === 'theme-only',
        mcpTools: toolContextWithMcp.mcpTools
      }
    );
    const resolved = parsed.actions.length > 0
      ? (() => {
          const parsedActionResolution = resolveAssistantToolActions({
            actions: parsed.actions,
            cards: toolContextWithMcp.visibleCards,
            projectFiles: toolContextWithMcp.visibleProjectFiles,
            projectScopes: toolContextWithMcp.visibleProjects,
            activeCardId: effectiveActiveCardId,
            activeProjectId: activeRequestSnapshot.activeProjectId,
            themeToolMode: toolContextWithMcp.themeToolMode,
            enabledToolGroups: toolContextWithMcp.enabledToolGroups,
            toolEnforcementScope: toolContextWithMcp.toolEnforcementScope,
            availableToolNames,
            desktopLocalHost: toolContextWithMcp.desktopLocalHost,
            imageGenerationAvailable: toolContextWithMcp.imageGenerationAvailable,
            memorySearchAvailable: toolContextWithMcp.memorySearchAvailable,
            attachmentSnapshot: toolContextWithMcp.attachmentSnapshot,
            imageAssetSnapshot: toolContextWithMcp.imageAssetSnapshot,
            personalData: toolContextWithMcp.personalData
          });
          const nativeToolCardResolution = resolveNativeToolCardActions({
            toolCalls: reply.nativeToolCalls ?? [],
            cards: toolContextWithMcp.visibleCards,
            enabledToolGroups: toolContextWithMcp.enabledToolGroups,
            toolEnforcementScope: toolContextWithMcp.toolEnforcementScope,
            availableToolNames
          });
          return {
            resolved: [
              ...parsedActionResolution.resolved,
              ...nativeToolCardResolution.resolved
            ],
            errors: [
              ...parsedActionResolution.errors,
              ...nativeToolCardResolution.errors
            ]
          };
        })()
      : (() => {
          const nativeToolCardResolution = resolveNativeToolCardActions({
            toolCalls: reply.nativeToolCalls ?? [],
            cards: toolContextWithMcp.visibleCards,
            enabledToolGroups: toolContextWithMcp.enabledToolGroups,
            toolEnforcementScope: toolContextWithMcp.toolEnforcementScope,
            availableToolNames
          });
          return {
            resolved: [...nativeToolCardResolution.resolved],
            errors: [...nativeToolCardResolution.errors]
          };
        })();
    const toolOutcome = resolveAssistantToolPreparationOutcome({
      reply,
      parsed,
      resolvedActions: resolved.resolved,
      resolutionErrors: resolved.errors,
      expectsToolAction: false
    });
    const storedToolCalls = buildStoredToolCallRecords({
      assistantMessageId: placeholderId,
      content: finalContent,
      actions: parsed.actions,
      nativeToolCalls: reply.nativeToolCalls ?? []
    });

    chat.updateMessage(writableConversation, placeholderId, buildAssistantMessagePatch({
      messageId: placeholderId,
      assistantName,
      speakerCollaboratorId: collaboratorId,
      providerId: activeRequestSnapshot.api.id,
      providerName: activeRequestSnapshot.api.name,
      visibleContent,
      reply,
      nativeToolCalls: storedToolCalls,
      memoryEvidence: buildChatMemoryEvidenceFromAudit(requestAudit)
    }));
    recordChatSendPerformanceMark(conversationId, '聊天发送 · 最终消息已提交', {
      extra: [
        `visible chars ${visibleContent.length}`,
        `tool actions ${parsed.actions.length}`,
        storedToolCalls?.length ? `tool calls ${storedToolCalls.length}` : null
      ]
    });
    const currentTask = chat.getConversationTask(conversationId);
    if (currentTask && taskUpdate) {
      const nextTask = applyConversationTaskModelUpdate({
        currentTask,
        update: {
          ...taskUpdate,
          id: currentTask.id
        },
        updatedAt: Date.now(),
        assistantMessageId: placeholderId
      });
      activatedTaskThisTurn =
        resolveConversationTaskMode(currentTask) === 'seed'
        && resolveConversationTaskMode(nextTask) === 'active'
        && !isConversationTaskTerminal(nextTask.status);
      latestTaskState = nextTask;
      chat.setConversationTask(conversationId, nextTask);
    }
    throwIfAborted(streaming.controller.signal);

    if (toolOutcome.status !== 'ready') {
      if (shouldRequestLengthFollowup({
        reply,
        isTruncatedToolOutput: toolOutcome.truncated === true,
        depth: lengthRecoveryDepth
      })) {
        const recoveryOutcomes = await executeRecoverableTruncatedToolActions({
          executeToolActions,
          conversationId,
          placeholderId,
          toolOutcome,
          reply,
          cards: toolContextWithMcp.visibleCards,
          projectFiles: toolContextWithMcp.visibleProjectFiles,
          projectScopes: toolContextWithMcp.visibleProjects,
          activeCardId: effectiveActiveCardId,
          activeProjectId: activeRequestSnapshot.activeProjectId,
          enabledToolGroups: toolContextWithMcp.enabledToolGroups,
          toolEnforcementScope: toolContextWithMcp.toolEnforcementScope,
          themeToolMode: toolContextWithMcp.themeToolMode,
          availableToolNames,
          existingProjectIds: activeRequestSnapshot.roomProjects.map((project) => project.id),
          signal: streaming.controller.signal
        });
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: buildLengthFollowupRequestMessages(latestMessages, {
            followupMessage: buildTruncatedToolFollowupSystemMessage(),
            unpairedAssistantMessageId: placeholderId
          }),
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          continuation: {
            ...continuation,
            lengthRecoveryDepth: lengthRecoveryDepth + 1
          }
        });
      }

      if (preparationRetryDepth < 1) {
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: buildToolPreparationRetryRequestMessages(
            latestMessages,
            placeholderId,
            buildToolPreparationRetrySystemMessage(toolOutcome)
          ),
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          preferredOpenAiToolHistoryMode,
          continuation: {
            ...continuation,
            preparationRetryDepth: preparationRetryDepth + 1,
            taskActivationEnforcement: nextTaskActivationEnforcement
          }
        });
      }

      recordChatQaAudit({
        phase: 'tooling_blocked',
        toolPreparationStatus: toolOutcome.status,
        conversationId,
        collaboratorId,
        assistantName,
        messages,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions
      });
      recordModelFlowTrace({
        phase: 'tooling_blocked',
        toolPreparationStatus: toolOutcome.status,
        conversationId,
        collaboratorId,
        assistantName,
        assistantMessageId: placeholderId,
        messages,
        audit: requestAudit,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions,
        toolLedger: chat.findConversation(conversationId)?.toolLedger
      });
      const runtimeFeedbackEvent = buildPreparationFailureRuntimeFeedbackEvent(toolOutcome);
      if (runtimeFeedbackEvent) {
        chat.appendRuntimeFeedbackEvent(conversationId, runtimeFeedbackEvent);
      }
      const failureToolInvocation = buildPreparationFailureToolInvocation(toolOutcome);
      if (failureToolInvocation) {
        chat.addMessage(writableConversation, {
          ...createMessage('system', failureToolInvocation.summary, undefined, 'tool-runtime', failureToolInvocation.id),
          model: 'local-tool',
          toolInvocation: failureToolInvocation
        });
      }
      settleConversationTaskAfterAssistantTurn({
        chat,
        conversationId,
        assistantMessageId: placeholderId,
        updatedAt: Date.now()
      });
      streaming.scheduleLifecycleRelease(320);
      preserveStreamingLifecycle = true;
      finishChatSendPerformanceTrace(conversationId, 'failed', {
        extra: [`tool preparation ${toolOutcome.status}`]
      });
      return { status: 'failed' };
    }

    if (toolOutcome.resolvedActions.length > 0) {
      throwIfAborted(streaming.controller.signal);
      const outcomes = await executeToolActions(conversationId, toolOutcome.resolvedActions, {
        beforeMessageId: placeholderId,
        toolCallIds: storedToolCalls?.map((toolCall) => toolCall.id).filter(Boolean) as string[] | undefined,
        signal: streaming.controller.signal
      });
      throwIfAborted(streaming.controller.signal);
      recordChatQaAudit({
        phase: 'completed',
        toolPreparationStatus: 'ready',
        conversationId,
        collaboratorId,
        assistantName,
        messages,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions,
        outcomes
      });
      recordModelFlowTrace({
        phase: 'completed',
        toolPreparationStatus: 'ready',
        conversationId,
        collaboratorId,
        assistantName,
        assistantMessageId: placeholderId,
        messages,
        audit: requestAudit,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions,
        outcomes,
        toolLedger: chat.findConversation(conversationId)?.toolLedger
      });
      const evidenceStage = commitAssistantToolEvidenceStage({
        chat,
        conversationId,
        assistantMessageId: placeholderId,
        actions: toolOutcome.resolvedActions,
        outcomes,
        activatedTaskThisTurn
      });
      activatedTaskThisTurn = evidenceStage.activatedTaskThisTurn;
      latestTaskState = evidenceStage.latestTaskState ?? latestTaskState;
      nextTaskActivationEnforcement = evidenceStage.nextTaskActivationEnforcement;

      const taskAfterToolSettlement = chat.getConversationTask(conversationId);
      if (activatedTaskThisTurn && taskAfterToolSettlement && !isConversationTaskTerminal(taskAfterToolSettlement.status)) {
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: [...latestMessages, buildTaskActivationFollowupSystemMessage()],
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          preferredOpenAiToolHistoryMode,
          continuation: {
            ...continuation,
            taskActivationEnforcement: nextTaskActivationEnforcement
          }
        });
      }

      const followupPlan = resolveToolFollowupPlan({
        outcomes,
        seenExchangeFingerprints: seenToolExchangeFingerprints,
        assistantToolOnlyTurn: isToolOnlyTurn
      });
      if (followupPlan) {
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: latestMessages,
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          preferredOpenAiToolHistoryMode,
          continuation: {
            ...continuation,
            toolExchangeDepth: toolExchangeDepth + 1,
            seenToolExchangeFingerprints: [
              ...seenToolExchangeFingerprints,
              followupPlan.exchangeFingerprint
            ]
          }
        });
      }
    } else {
      recordChatQaAudit({
        phase: 'completed',
        toolPreparationStatus: 'ready',
        conversationId,
        collaboratorId,
        assistantName,
        messages,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions
      });
      recordModelFlowTrace({
        phase: 'completed',
        toolPreparationStatus: 'ready',
        conversationId,
        collaboratorId,
        assistantName,
        assistantMessageId: placeholderId,
        messages,
        audit: requestAudit,
        visibleReply: visibleContent,
        reply,
        preparationOutcome: toolOutcome,
        resolvedActions: toolOutcome.resolvedActions,
        toolLedger: chat.findConversation(conversationId)?.toolLedger
      });

      if (activatedTaskThisTurn && latestTaskState && !isConversationTaskTerminal(latestTaskState.status)) {
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: [...latestMessages, buildTaskActivationFollowupSystemMessage()],
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          preferredOpenAiToolHistoryMode,
          continuation: {
            ...continuation,
            taskActivationEnforcement: nextTaskActivationEnforcement
          }
        });
      }
    }

    // Length followup applies regardless of whether tool actions were present.
    // A truncated tool call with half-written code needs continuation just as
    // much as a truncated plain-text reply.
    if (shouldRequestLengthFollowup({
      reply,
      depth: lengthRecoveryDepth
    })) {
      throwIfAborted(streaming.controller.signal);
      const latestMessages = chat.getConversationMessages(conversationId);
      throw new ChatReplyContinuation({
        ui,
        chat,
        executeToolActions,
        conversationId,
        writableConversation,
        collaboratorId,
        messages: latestMessages,
        requestMessages: buildLengthFollowupRequestMessages(latestMessages),
        requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
        refreshRequestSnapshot,
        loadSemanticRecallConversations,
        continuation: {
          ...continuation,
          lengthRecoveryDepth: lengthRecoveryDepth + 1
        }
      });
    }

    if (reply.transportIncomplete) {
      appendPartialStreamNotice(chat, writableConversation);
    }

    settleConversationTaskAfterAssistantTurn({
      chat,
      conversationId,
      assistantMessageId: placeholderId,
      updatedAt: Date.now()
    });

    streaming.scheduleLifecycleRelease(320);
    preserveStreamingLifecycle = true;
    finishChatSendPerformanceTrace(conversationId, 'completed');
    return { status: 'completed' };
  } catch (error) {
    if (error instanceof ChatReplyContinuation) {
      throw error;
    }
    streaming.commitQueuedProgress();
    if (error instanceof ChatReplyPersistenceError) {
      throw error;
    }
    console.error('[requestReply] catch block hit', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      conversationId,
      placeholderId,
      toolExchangeDepth,
      lengthRecoveryDepth
    });

    if (isAbortError(error)) {
      const latestPlaceholder = chat.findConversationMessage(conversationId, placeholderId);

      if (!latestPlaceholder?.content.trim() && !latestPlaceholder?.thinkingText?.trim()) {
        chat.replaceConversationMessages(writableConversation, messages);
      } else {
        streaming.scheduleLifecycleRelease(220);
        preserveStreamingLifecycle = true;
      }
      recordChatQaAudit({
        phase: 'aborted',
        toolPreparationStatus: 'aborted',
        conversationId,
        collaboratorId,
        assistantName,
        messages,
        visibleReply: latestPlaceholder?.content ?? '',
        reply: {
          content: latestPlaceholder?.content ?? '',
          model: latestPlaceholder?.model,
          tokenCount: latestPlaceholder?.tokenCount
        }
      });
      recordModelFlowTrace({
        phase: 'aborted',
        toolPreparationStatus: 'aborted',
        conversationId,
        collaboratorId,
        assistantName,
        assistantMessageId: placeholderId,
        messages,
        audit: requestAudit,
        visibleReply: latestPlaceholder?.content ?? '',
        reply: {
          content: latestPlaceholder?.content ?? '',
          model: latestPlaceholder?.model,
          tokenCount: latestPlaceholder?.tokenCount,
          tokenUsage: latestPlaceholder?.tokenUsage,
          thinkingText: latestPlaceholder?.thinkingText,
          nativeToolCalls: latestPlaceholder?.nativeToolCalls
        },
        toolLedger: chat.findConversation(conversationId)?.toolLedger
      });
      finishChatSendPerformanceTrace(conversationId, 'aborted');
      return { status: 'aborted' };
    }

    const text = error instanceof Error ? error.message : '请求失败';
    const normalized = normalizeProviderErrorMessage(text);
    const latestPlaceholder = chat.findConversationMessage(conversationId, placeholderId);

    if (latestPlaceholder?.content.trim() || latestPlaceholder?.thinkingText?.trim()) {
      const latestProgress = streaming.getLatestProgress();
      const hasWorkspaceDraftShape = hasInterruptedWorkspaceDraftShape({
        activeProjectId: activeRequestSnapshot.activeProjectId,
        placeholder: latestPlaceholder,
        partialReply: latestProgress
      });
      let recoveredInterruptedWorkspaceDraft = false;
      let recoveryOutcomes: ToolActionRunOutcome[] = [];
      let recoveryFailure: unknown;

      if (latestPlaceholder.content.trim() || (latestPlaceholder.nativeToolCalls?.length ?? 0) > 0) {
        try {
          recoveryOutcomes = await executeInterruptedWorkspaceDraftActions({
            executeToolActions,
            conversationId,
            placeholderId,
            placeholder: latestPlaceholder,
            partialReply: latestProgress,
            modelTier,
            ignoredUnknownNativeToolNames,
            allowCreativeCssRecovery: toolContextWithMcp.toolEnforcementScope === 'theme-only',
            cards: toolContextWithMcp.visibleCards,
            projectFiles: toolContextWithMcp.visibleProjectFiles,
            projectScopes: toolContextWithMcp.visibleProjects,
            activeCardId: effectiveActiveCardId,
            activeProjectId: activeRequestSnapshot.activeProjectId,
            enabledToolGroups: toolContextWithMcp.enabledToolGroups,
            toolEnforcementScope: toolContextWithMcp.toolEnforcementScope,
            themeToolMode: toolContextWithMcp.themeToolMode,
            availableToolNames,
            mcpTools: toolContextWithMcp.mcpTools,
            existingProjectIds: activeRequestSnapshot.roomProjects.map((project) => project.id),
            signal: streaming.controller.signal
          });
          if (recoveryOutcomes.length > 0) {
            recoveredInterruptedWorkspaceDraft = true;
            commitRecoveredToolEvidenceStage({
              chat,
              conversationId,
              assistantMessageId: placeholderId,
              outcomes: recoveryOutcomes
            });
          }
        } catch (recoveryError) {
          if (isAbortError(recoveryError)) throw recoveryError;
          recoveryFailure = recoveryError;
          console.warn('[requestReply] interrupted workspace draft recovery failed', recoveryError);
        }
      }
      if (hasWorkspaceDraftShape && !recoveredInterruptedWorkspaceDraft) {
        appendInterruptedWorkspaceDraftFailure(chat, writableConversation, recoveryFailure);
      }
      appendPartialStreamNotice(chat, writableConversation);
      const recoveryFollowupPlan = recoveredInterruptedWorkspaceDraft
        ? resolveToolFollowupPlan({
            outcomes: recoveryOutcomes,
            seenExchangeFingerprints: seenToolExchangeFingerprints,
            assistantToolOnlyTurn: false
          })
        : null;
      if (recoveryFollowupPlan) {
        throwIfAborted(streaming.controller.signal);
        const latestMessages = chat.getConversationMessages(conversationId);
        throw new ChatReplyContinuation({
          ui,
          chat,
          executeToolActions,
          conversationId,
          writableConversation,
          collaboratorId,
          messages: latestMessages,
          requestMessages: latestMessages,
          requestSnapshot: refreshRequestSnapshot?.() ?? activeRequestSnapshot,
          refreshRequestSnapshot,
          loadSemanticRecallConversations,
          continuation: {
            ...continuation,
            toolExchangeDepth: toolExchangeDepth + 1,
            seenToolExchangeFingerprints: [
              ...seenToolExchangeFingerprints,
              recoveryFollowupPlan.exchangeFingerprint
            ]
          }
        });
      }
      streaming.scheduleLifecycleRelease(320);
      preserveStreamingLifecycle = true;
      finishChatSendPerformanceTrace(conversationId, 'failed', {
        extra: ['partial reply kept']
      });
      return { status: 'failed' };
    }

    const failureMessage = normalized.hintMessage && normalized.hintMessage !== normalized.rawMessage
      ? `${normalized.rawMessage}\n\n提示：${normalized.hintMessage}`
      : normalized.rawMessage;
    recordChatQaAudit({
      phase: 'request_failed',
      toolPreparationStatus: 'request_failed',
      conversationId,
      collaboratorId,
      assistantName,
      messages,
      visibleReply: failureMessage
    });
    recordModelFlowTrace({
      phase: 'request_failed',
      toolPreparationStatus: 'request_failed',
      conversationId,
      collaboratorId,
      assistantName,
      assistantMessageId: placeholderId,
      messages,
      audit: requestAudit,
      visibleReply: failureMessage,
      toolLedger: chat.findConversation(conversationId)?.toolLedger
    });
    chat.updateMessage(writableConversation, placeholderId, {
      content: failureMessage,
      assistantName,
      speakerCollaboratorId: collaboratorId,
      requestRole: 'system',
      requestContent: buildProviderFailureRequestContent(text)
    });
    finishChatSendPerformanceTrace(conversationId, 'failed', {
      extra: ['request failed']
    });
    return { status: 'failed' };
  } finally {
    try {
      await persistChatReplyBoundary(chat.persistToDb, 'after-reply');
      recordChatSendPerformanceMark(conversationId, '聊天发送 · 回复结果已安全落盘');
    } finally {
      streaming.finish(preserveStreamingLifecycle);
    }
  }
}

export async function requestReply(args: RequestReplyArgs): Promise<ChatReplyRunResult> {
  let nextArgs = args;
  while (true) {
    try {
      return await requestReplyRound(nextArgs);
    } catch (error) {
      if (!(error instanceof ChatReplyContinuation)) {
        throw error;
      }
      nextArgs = error.next;
    }
  }
}
