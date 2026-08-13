import type { AssistantReplyProgress } from '../../engines/chatApi';
import { buildAssistantMessagePatch } from '../../engines/chatMessageNormalization';
import type { McpResolvedToolDefinition } from '../../engines/mcpRuntime';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ModelTier, ThemeToolMode } from '../../types/domain';
import type { ChatReplyStoreBindings, ChatUiReplyState } from './chatPorts';
import { parseAssistantReplyContent, startAssistantPlaceholder } from './chatReplyContent';
import { createMessage } from '../../engines/chatMessageFactory';
import { createUid } from '../../engines/id';
import { splitAssistantReplySegments } from '../../engines/assistantReplySegments';

type StreamingSessionArgs = {
  ui: Pick<
    ChatUiReplyState,
    'abortControllerRef' | 'setStreaming' | 'setSending' | 'streamingLifecycleReleaseRef'
  >;
  chat: Pick<ChatReplyStoreBindings['chat'], 'addMessage' | 'updateMessage'> & Partial<Pick<
    ChatReplyStoreBindings['chat'],
    'insertMessageBefore' | 'getConversationMessages' | 'replaceConversationMessages'
  >>;
  conversationId: string;
  writableConversation: WritableConversationBody;
  placeholderId: string;
  assistantName: string;
  speakerCollaboratorId?: string;
  providerId?: string;
  providerName?: string;
  modelTier: ModelTier;
  themeToolMode: ThemeToolMode;
  ignoredUnknownNativeToolNames?: string[];
  hasWorkspaceContext?: boolean;
  activeProjectId?: string | null;
  allowCreativeCssRecovery?: boolean;
  mcpTools?: McpResolvedToolDefinition[];
  segmentedRepliesEnabled?: boolean;
  onFirstProgressFlushed?: () => void;
};

const STREAMING_HEAVY_CONTENT_LENGTH = 2000;
const STREAMING_VERY_HEAVY_CONTENT_LENGTH = 8000;
const STREAMING_HEAVY_FLUSH_INTERVAL_MS = 80;
const STREAMING_VERY_HEAVY_FLUSH_INTERVAL_MS = 140;

function hasStreamingCodeShape(progress: AssistantReplyProgress) {
  return progress.content.includes('```')
    || (progress.nativeToolCalls?.some((toolCall) => toolCall.argumentsText.includes('"code"')) ?? false);
}

function resolveStreamingFlushIntervalMs(progress: AssistantReplyProgress) {
  if (progress.content.length >= STREAMING_VERY_HEAVY_CONTENT_LENGTH) {
    return STREAMING_VERY_HEAVY_FLUSH_INTERVAL_MS;
  }
  if (progress.content.length >= STREAMING_HEAVY_CONTENT_LENGTH || hasStreamingCodeShape(progress)) {
    return STREAMING_HEAVY_FLUSH_INTERVAL_MS;
  }
  return 0;
}

export function createStreamingSession(args: StreamingSessionArgs) {
  const {
    ui,
    chat,
    conversationId,
    writableConversation,
    placeholderId,
    assistantName,
    speakerCollaboratorId,
    providerId,
    providerName,
    modelTier,
    themeToolMode,
    ignoredUnknownNativeToolNames = [],
    hasWorkspaceContext = false,
    activeProjectId = null,
    allowCreativeCssRecovery = false,
    mcpTools = [],
    segmentedRepliesEnabled = false,
    onFirstProgressFlushed
  } = args;
  const controller = new AbortController();
  const replyStartedAt = Date.now();
  let latestProgress: AssistantReplyProgress | null = null;
  let latestSeenProgress: AssistantReplyProgress | null = null;
  let progressFrameId: number | null = null;
  let progressTimerId: number | null = null;
  let lastProgressFlushAt = 0;
  let hasReceivedFirstProgress = false;
  let prefixSegmentIds: string[] = [];

  const removeUnusedPrefixSegments = (keepCount: number) => {
    if (prefixSegmentIds.length <= keepCount) return;
    if (!chat.getConversationMessages || !chat.replaceConversationMessages) {
      throw new Error('分段回复缺少消息重排能力。');
    }
    const removedIds = new Set(prefixSegmentIds.slice(keepCount));
    chat.replaceConversationMessages(
      writableConversation,
      chat.getConversationMessages(conversationId).filter((message) => !removedIds.has(message.id))
    );
    prefixSegmentIds = prefixSegmentIds.slice(0, keepCount);
  };

  const syncSegmentedReply = (
    visibleContent: string,
    patch: ReturnType<typeof buildAssistantMessagePatch>
  ) => {
    const segments = segmentedRepliesEnabled
      ? splitAssistantReplySegments(visibleContent)
      : [visibleContent];
    const prefixCount = Math.max(0, segments.length - 1);
    removeUnusedPrefixSegments(prefixCount);

    while (prefixSegmentIds.length < prefixCount) {
      if (!chat.insertMessageBefore) {
        throw new Error('分段回复缺少消息插入能力。');
      }
      const segmentIndex = prefixSegmentIds.length;
      const segmentId = createUid('assistant');
      prefixSegmentIds.push(segmentId);
      chat.insertMessageBefore(writableConversation, placeholderId, {
        ...createMessage('assistant', segments[segmentIndex] ?? '', undefined, 'assistant-reply', segmentId),
        assistantName,
        speakerCollaboratorId,
        providerId,
        providerName,
        timestamp: replyStartedAt + segmentIndex,
        assistantReplyId: placeholderId,
        assistantReplySegmentIndex: segmentIndex
      });
    }

    if (segments.length <= 1) {
      chat.updateMessage(writableConversation, placeholderId, {
        ...patch,
        content: segments[0] ?? '',
        timestamp: replyStartedAt,
        assistantReplyId: undefined,
        assistantReplySegmentIndex: undefined
      });
      return;
    }

    prefixSegmentIds.forEach((segmentId, segmentIndex) => {
      chat.updateMessage(writableConversation, segmentId, {
        content: segments[segmentIndex] ?? '',
        assistantName,
        speakerCollaboratorId,
        providerId,
        providerName,
        model: patch.model,
        timestamp: replyStartedAt + segmentIndex,
        assistantReplyId: placeholderId,
        assistantReplySegmentIndex: segmentIndex
      });
    });
    chat.updateMessage(writableConversation, placeholderId, {
      ...patch,
      content: segments[segments.length - 1] ?? '',
      timestamp: replyStartedAt + segments.length - 1,
      assistantReplyId: placeholderId,
      assistantReplySegmentIndex: segments.length - 1
    });
  };

  const clearScheduledLifecycleRelease = () => {
    if (ui.streamingLifecycleReleaseRef.current === null) return;
    window.clearTimeout(ui.streamingLifecycleReleaseRef.current);
    ui.streamingLifecycleReleaseRef.current = null;
  };

  const setStreamingPhase = (phase: 'live' | 'settling') => {
    ui.setStreaming((current) =>
      current?.messageId === placeholderId && current.phase !== phase ? { ...current, phase } : current
    );
  };

  const flushProgress = () => {
    progressFrameId = null;
    lastProgressFlushAt = Date.now();
    if (!latestProgress) return;
    latestSeenProgress = latestProgress;

    const { visibleContent } = parseAssistantReplyContent(
      latestProgress.content,
      modelTier,
      themeToolMode,
      'streaming',
      latestProgress.nativeToolCalls ?? [],
      ignoredUnknownNativeToolNames,
      { hasWorkspaceContext, activeProjectId, allowCreativeCssRecovery, mcpTools }
    );
    syncSegmentedReply(visibleContent, buildAssistantMessagePatch({
      messageId: placeholderId,
      assistantName,
      speakerCollaboratorId,
      providerId,
      providerName,
      visibleContent,
      reply: latestProgress
    }));
    if (!hasReceivedFirstProgress) {
      hasReceivedFirstProgress = true;
      setStreamingPhase('live');
      onFirstProgressFlushed?.();
    }
    latestProgress = null;
  };

  const scheduleProgressFrame = () => {
    if (progressFrameId !== null) return;
    progressFrameId = window.requestAnimationFrame(flushProgress);
  };

  const queueProgress = (partialReply: AssistantReplyProgress) => {
    latestSeenProgress = partialReply;
    latestProgress = partialReply;
    if (progressFrameId !== null || progressTimerId !== null) return;

    const intervalMs = resolveStreamingFlushIntervalMs(partialReply);
    const elapsedMs = lastProgressFlushAt ? Date.now() - lastProgressFlushAt : intervalMs;
    const delayMs = Math.max(0, intervalMs - elapsedMs);
    if (delayMs <= 16) {
      scheduleProgressFrame();
      return;
    }

    progressTimerId = window.setTimeout(() => {
      progressTimerId = null;
      scheduleProgressFrame();
    }, delayMs);
  };

  const commitQueuedProgress = () => {
    if (progressTimerId !== null) {
      window.clearTimeout(progressTimerId);
      progressTimerId = null;
    }
    if (progressFrameId !== null) {
      window.cancelAnimationFrame(progressFrameId);
    }
    flushProgress();
  };

  const scheduleLifecycleRelease = (delayMs: number) => {
    clearScheduledLifecycleRelease();
    setStreamingPhase('settling');
    ui.streamingLifecycleReleaseRef.current = window.setTimeout(() => {
      ui.setStreaming((current) =>
        current?.messageId === placeholderId ? null : current
      );
      ui.streamingLifecycleReleaseRef.current = null;
    }, delayMs);
  };

  const start = () => {
    ui.abortControllerRef.current = controller;
    startAssistantPlaceholder({
      writableConversation,
      placeholderId,
      assistantName,
      speakerCollaboratorId,
      addMessage: chat.addMessage,
      setStreamingMessageId: (messageId) => ui.setStreaming({ messageId, phase: 'stage' })
    });
    ui.setSending(true);
  };

  const finish = (preserveLifecycle = false) => {
    if (progressTimerId !== null) {
      window.clearTimeout(progressTimerId);
      progressTimerId = null;
    }
    if (progressFrameId !== null) {
      window.cancelAnimationFrame(progressFrameId);
    }
    if (ui.abortControllerRef.current === controller) {
      ui.abortControllerRef.current = null;
    }
    if (!preserveLifecycle) {
      clearScheduledLifecycleRelease();
      ui.setStreaming((current) => (current?.messageId === placeholderId ? null : current));
    }
    ui.setSending(false);
  };

  return {
    controller,
    queueProgress,
    commitQueuedProgress,
    getLatestProgress: () => latestProgress ?? latestSeenProgress,
    commitFinalReply: (
      visibleContent: string,
      patch: ReturnType<typeof buildAssistantMessagePatch>
    ) => syncSegmentedReply(visibleContent, patch),
    scheduleLifecycleRelease,
    start,
    finish
  };
}
