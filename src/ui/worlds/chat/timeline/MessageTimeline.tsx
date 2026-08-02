import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { resolveChatGenerationActive, resolveChatMessageLifecycle, type ChatMessageLifecycle } from '../../../../app/chat/chatStreamingDisplay';
import { resolveChatCardReference } from '../../../../app/collection/codeCollectionSource';
import { resolveCodeCardPresentation } from '../../../../app/collection/codeCardPresentation';
import { buildCodeCardPreview, inferCodeLanguage } from '../../../../engines/codeCardEngine';
import type { ChatMessage, CodeCard, ConversationTaskState, Persona } from '../../../../types/domain';
import { resolveConversationTaskMode } from '../../../../engines/conversationTask';
import { buildConversationTaskWorkbench } from '../../../../engines/conversationTaskWorkbench';
import {
  useChatActions,
  useChatComposer,
  useChatPresentation,
  useChatStablePayload,
  useChatUi
} from '../context/ChatContext';
import { useI18n } from '../../../../i18n';
import { MessageRow, type MessageRowActions, type MessageRowState } from '../message/MessageRow';
import { useAssetObjectUrl } from '../../../useAssetObjectUrl';
import { JumpToLatest } from './JumpToLatest';
import { JumpToTop } from './JumpToTop';
import { appendEnteringMessageIds } from './messageTimelineEntering';
import { buildTimelineRenderItems } from './messageTimelineItems';
import { buildTimelineTaskReceipts } from './messageTimelineTaskReceipts';
import { TaskRuntimeCard, type TaskRuntimeExecutionSegment } from './TaskRuntimeCard';
import { TaskRuntimeDock } from './TaskRuntimeDock';
import { resolveTimelineWindow } from './messageTimelineWindow';
import { useTimelineScroll } from './TimelineScroll';
import { Icon } from '../../../Icon';
import { CodeRunFullscreen } from '../../../collection/workshop/CodeRunFullscreen';
import { TextReadingFullscreen } from '../../../collection/workshop/TextReadingFullscreen';

type MessageTimelineProps = {
  isWorldSettled: boolean;
};

type TimelineViewport = {
  scrollTop: number;
  viewportHeight: number;
};

function getLatestUserMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && !message.toolInvocation) {
      return message.id;
    }
  }
  return null;
}

function resolveEmptyConversationSignature(persona: Persona | null, fallbackAssistantName: string, fallbackPurpose: string) {
  const name = persona?.name.trim() || fallbackAssistantName.trim() || 'Polaris';
  const purpose = persona?.purpose.trim() || persona?.description.trim() || fallbackPurpose;
  return { name, purpose };
}

type ChatCodeCardPreview = {
  cardId: string;
  title: string;
  srcDoc: string | null;
  code: string;
  language: string;
  presentation: 'code' | 'text';
} | null;

function TimelineMeasuredRow({
  messageId,
  onMeasure,
  children
}: {
  messageId: string;
  onMeasure: (messageId: string, height: number) => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const measure = () => {
      onMeasure(messageId, row.getBoundingClientRect().height);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [messageId, onMeasure]);

  return (
    <div ref={rowRef} className="chat-flow-window-row">
      {children}
    </div>
  );
}

export function MessageTimeline({ isWorldSettled }: MessageTimelineProps) {
  const { t } = useI18n();
  const ENTERING_LIFECYCLE_MS = 240;
  const stablePayload = useChatStablePayload();
  const presentation = useChatPresentation();
  const composer = useChatComposer();
  const ui = useChatUi();
  const actions = useChatActions();
  const messages = stablePayload.messages;
  const [codeCardPreview, setCodeCardPreview] = useState<ChatCodeCardPreview>(null);
  const rowHeightsRef = useRef<Record<string, number>>({});
  const viewportRafRef = useRef<number | null>(null);
  const [rowMetricsVersion, setRowMetricsVersion] = useState(0);
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({
    scrollTop: 0,
    viewportHeight: 0
  });
  const assistantAvatarUrl = useAssetObjectUrl(stablePayload.persona?.assistantAvatarAssetId ?? undefined, true);
  const userAvatarUrl = useAssetObjectUrl(stablePayload.persona?.userAvatarAssetId ?? undefined, true);
  const conversationId = stablePayload.conversation?.id ?? null;
  const currentTask = (() => {
    const task = stablePayload.conversation?.task ?? null;
    if (!task) return null;
    return resolveConversationTaskMode(task) === 'active' ? task : null;
  })();
  const currentTaskEvidence = useMemo(() => {
    if (!currentTask) {
      return [] as TaskRuntimeExecutionSegment[];
    }
    return buildConversationTaskWorkbench({
      currentTask,
      messages
    }).executionSegments as TaskRuntimeExecutionSegment[];
  }, [currentTask, messages]);
  const isGenerationActive = resolveChatGenerationActive({
    sending: ui.sending,
    streaming: ui.streaming
  });
  const { containerRef, handleScroll, followMode, jumpToLatest, jumpToTop, showJumpToLatest, showJumpToTop } = useTimelineScroll({
    conversationId,
    messages,
    isGenerationActive,
    isActiveWorld: presentation.isActiveWorld,
    isWorldSettled
  });
  const measureTimelineViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setTimelineViewport((current) => {
      const next = {
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight
      };
      return (
        Math.abs(current.scrollTop - next.scrollTop) < 1
        && Math.abs(current.viewportHeight - next.viewportHeight) < 1
      )
        ? current
        : next;
    });
  }, [containerRef]);
  const queueTimelineViewportMeasure = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (viewportRafRef.current !== null) return;
    viewportRafRef.current = window.requestAnimationFrame(() => {
      viewportRafRef.current = null;
      measureTimelineViewport();
    });
  }, [measureTimelineViewport]);
  const handleTimelineScroll = useCallback(() => {
    handleScroll();
    queueTimelineViewportMeasure();
  }, [handleScroll, queueTimelineViewportMeasure]);
  const handleRowMeasure = useCallback((messageId: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const previousHeight = rowHeightsRef.current[messageId];
    if (previousHeight !== undefined && Math.abs(previousHeight - height) < 1) return;
    rowHeightsRef.current = {
      ...rowHeightsRef.current,
      [messageId]: height
    };
    setRowMetricsVersion((version) => version + 1);
  }, []);
  const latestMessageId = messages[messages.length - 1]?.id ?? null;
  const latestUserMessageId = getLatestUserMessageId(messages);
  const [enteringMessageIds, setEnteringMessageIds] = useState<string[]>([]);
  const previousConversationIdRef = useRef<string | null>(conversationId);
  const previousLatestMessageIdRef = useRef<string | null>(latestMessageId);
  const previousLatestUserMessageIdRef = useRef<string | null>(latestUserMessageId);
  const previousTaskIdRef = useRef<string | null>(currentTask?.id ?? null);
  const previousTaskStatusRef = useRef<string | null>(currentTask?.status ?? null);
  const taskCompletionTimeoutRef = useRef<number | null>(null);
  const hasSettledConversationRef = useRef(false);
  const enteringTimeoutsRef = useRef<Map<string, number>>(new Map());
  const [isTaskDockCollapsed, setIsTaskDockCollapsed] = useState(true);
  const [taskDockJustArmed, setTaskDockJustArmed] = useState(false);
  const [taskJustCompleted, setTaskJustCompleted] = useState(false);
  const [expandedTaskReceiptMessageId, setExpandedTaskReceiptMessageId] = useState<string | null>(null);
  const taskReceiptsByMessageId = useMemo(
    () => buildTimelineTaskReceipts(currentTask, currentTaskEvidence),
    [currentTask, currentTaskEvidence]
  );
  const taskToolsEnabled = composer.toolPromptPreferences.task;
  const shouldShowTaskDock = taskToolsEnabled && (Boolean(currentTask) || Boolean(composer.taskModeEnabled));
  const emptyConversationSignature = resolveEmptyConversationSignature(
    stablePayload.persona,
    presentation.fallbackAssistantName,
    t('chat.timeline.emptyPurposeFallback')
  );
  const bodyUnavailable = presentation.activeConversationBodyStatus?.state === 'failed'
    || presentation.activeConversationBodyStatus?.state === 'missing';
  const codeCardsById = useMemo(
    () => Object.fromEntries(composer.availableCards.map((card) => [card.id, card])) as Record<string, CodeCard>,
    [composer.availableCards]
  );

  const runCodeCard = useCallback((card: CodeCard) => {
    const language = inferCodeLanguage(card.code, card.language);
    const cardPresentation = resolveCodeCardPresentation({
      kind: card.kind,
      language
    });
    setCodeCardPreview({
      cardId: card.id,
      title: card.title,
      srcDoc: cardPresentation === 'code' ? buildCodeCardPreview(language, card.code) : null,
      code: card.code,
      language,
      presentation: cardPresentation
    });
  }, []);

  const clearEnteringTimeout = (messageId: string) => {
    const timeoutId = enteringTimeoutsRef.current.get(messageId);
    if (timeoutId === undefined) return;
    window.clearTimeout(timeoutId);
    enteringTimeoutsRef.current.delete(messageId);
  };

  const clearAllEnteringTimeouts = () => {
    enteringTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    enteringTimeoutsRef.current.clear();
  };

  const queueEnteringMessages = (messageIds: Array<string | null | undefined>) => {
    const nextIds = messageIds.filter((id): id is string => Boolean(id));
    if (nextIds.length === 0) return;

    setEnteringMessageIds((currentIds) => appendEnteringMessageIds(currentIds, nextIds));
    nextIds.forEach((messageId) => {
      clearEnteringTimeout(messageId);
      const timeoutId = window.setTimeout(() => {
        enteringTimeoutsRef.current.delete(messageId);
        setEnteringMessageIds((currentIds) => currentIds.filter((id) => id !== messageId));
      }, ENTERING_LIFECYCLE_MS);
      enteringTimeoutsRef.current.set(messageId, timeoutId);
    });
  };

  useEffect(() => () => {
    clearAllEnteringTimeouts();
    if (viewportRafRef.current !== null) {
      window.cancelAnimationFrame(viewportRafRef.current);
      viewportRafRef.current = null;
    }
    if (taskCompletionTimeoutRef.current !== null) {
      window.clearTimeout(taskCompletionTimeoutRef.current);
      taskCompletionTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const nextTaskId = currentTask?.id ?? null;
    const nextTaskStatus = currentTask?.status ?? null;
    const previousTaskId = previousTaskIdRef.current;
    const previousTaskStatus = previousTaskStatusRef.current;

    if (!nextTaskId) {
      previousTaskIdRef.current = null;
      previousTaskStatusRef.current = null;
      setExpandedTaskReceiptMessageId(null);
      setTaskJustCompleted(false);
      if (taskCompletionTimeoutRef.current !== null) {
        window.clearTimeout(taskCompletionTimeoutRef.current);
        taskCompletionTimeoutRef.current = null;
      }
      return;
    }

    if (previousTaskId !== nextTaskId) {
      setIsTaskDockCollapsed(true);
      setExpandedTaskReceiptMessageId(null);
      setTaskJustCompleted(false);
    }

    if (previousTaskStatus !== 'completed' && nextTaskStatus === 'completed') {
      setIsTaskDockCollapsed(true);
      setTaskJustCompleted(true);
      if (taskCompletionTimeoutRef.current !== null) {
        window.clearTimeout(taskCompletionTimeoutRef.current);
      }
      taskCompletionTimeoutRef.current = window.setTimeout(() => {
        taskCompletionTimeoutRef.current = null;
        setTaskJustCompleted(false);
      }, 1400);
    }

    previousTaskIdRef.current = nextTaskId;
    previousTaskStatusRef.current = nextTaskStatus;
  }, [currentTask]);

  useEffect(() => {
    if (!composer.taskModeEnabled) {
      setTaskDockJustArmed(false);
      if (!currentTask) {
        setIsTaskDockCollapsed(true);
      }
      return;
    }
    if (currentTask) {
      setTaskDockJustArmed(false);
      return;
    }
    setIsTaskDockCollapsed(true);
    setTaskDockJustArmed(true);
    const timeoutId = window.setTimeout(() => {
      setTaskDockJustArmed(false);
    }, 1400);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [composer.taskModeEnabled, currentTask]);

  useEffect(() => {
    if (!expandedTaskReceiptMessageId || taskReceiptsByMessageId.has(expandedTaskReceiptMessageId)) return;
    setExpandedTaskReceiptMessageId(null);
  }, [expandedTaskReceiptMessageId, taskReceiptsByMessageId]);

  useLayoutEffect(() => {
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId;
      previousLatestMessageIdRef.current = latestMessageId;
      previousLatestUserMessageIdRef.current = latestUserMessageId;
      hasSettledConversationRef.current = false;
      setIsTaskDockCollapsed(true);
      clearAllEnteringTimeouts();
      setEnteringMessageIds([]);
      return;
    }

    if (!presentation.isActiveWorld || !isWorldSettled) {
      previousLatestMessageIdRef.current = latestMessageId;
      previousLatestUserMessageIdRef.current = latestUserMessageId;
      clearAllEnteringTimeouts();
      setEnteringMessageIds([]);
      return;
    }

    if (!hasSettledConversationRef.current) {
      hasSettledConversationRef.current = true;
      previousLatestMessageIdRef.current = latestMessageId;
      previousLatestUserMessageIdRef.current = latestUserMessageId;
      clearAllEnteringTimeouts();
      setEnteringMessageIds([]);
      return;
    }

    if (
      latestUserMessageId
      && previousLatestUserMessageIdRef.current !== latestUserMessageId
    ) {
      queueEnteringMessages([latestUserMessageId]);
    } else if (latestMessageId && previousLatestMessageIdRef.current !== latestMessageId) {
      queueEnteringMessages([latestMessageId]);
    } else if (!latestMessageId) {
      clearAllEnteringTimeouts();
      setEnteringMessageIds([]);
    }

    previousLatestMessageIdRef.current = latestMessageId;
    previousLatestUserMessageIdRef.current = latestUserMessageId;
  }, [conversationId, latestMessageId, latestUserMessageId, isWorldSettled, presentation.isActiveWorld]);
  useLayoutEffect(() => {
    measureTimelineViewport();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measureTimelineViewport();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [conversationId, containerRef, measureTimelineViewport, messages.length]);
  const collapsedThinkingIds = useMemo(
    () => new Set(ui.collapsedThinkingMessageIds),
    [ui.collapsedThinkingMessageIds]
  );
  const expandedCodeIds = useMemo(
    () => new Set(ui.expandedCodeMessageIds),
    [ui.expandedCodeMessageIds]
  );
  const renderItems = useMemo(() => buildTimelineRenderItems(messages), [messages]);
  const timelineWindow = useMemo(
    () => resolveTimelineWindow(renderItems, followMode, ui.focusedMessageId, {
      ...timelineViewport,
      rowHeights: rowHeightsRef.current,
      anchorMessageId: followMode === 'reply-stage' ? latestUserMessageId : null
    }),
    [renderItems, followMode, ui.focusedMessageId, timelineViewport, rowMetricsVersion, latestUserMessageId]
  );
  const rowActions = useMemo<MessageRowActions>(() => ({
    removeEditingAttachment: actions.removeEditingAttachment,
    updateEditingDraft: actions.updateEditingDraft,
    commitEdit: actions.commitEdit,
    cancelEdit: actions.cancelEdit,
    toggleThinkingCollapsed: actions.toggleThinkingCollapsed,
    openThinkingSummary: actions.openThinkingSummary,
    saveImageAttachment: actions.saveImageAttachment,
    toggleCodeExpanded: actions.toggleCodeExpanded,
    applyCustomCss: actions.applyCustomCss,
    codeCardAction: actions.codeCardAction,
    retry: actions.retry,
    editMessage: actions.editMessage,
    editAssistantMessage: actions.editAssistantMessage,
    cacheAssistantSpeech: actions.cacheAssistantSpeech,
    forkFromMessage: actions.forkFromMessage,
    applyToolPreview: actions.applyToolPreview,
    saveToolPreview: actions.saveToolPreview,
    rollbackToolPreview: actions.rollbackToolPreview,
    openToolbox: actions.openToolbox,
    openCodeCard: actions.openCodeCard,
    runCodeCard,
    setCommandStatus: actions.setCommandStatus
  }), [
    actions.applyCustomCss,
    actions.applyToolPreview,
    actions.cancelEdit,
    actions.codeCardAction,
    actions.commitEdit,
    actions.cacheAssistantSpeech,
    actions.editAssistantMessage,
    actions.editMessage,
    actions.forkFromMessage,
    actions.openCodeCard,
    actions.openToolbox,
    actions.openThinkingSummary,
    actions.setCommandStatus,
    actions.removeEditingAttachment,
    actions.retry,
    actions.rollbackToolPreview,
    actions.saveToolPreview,
    actions.saveImageAttachment,
    actions.toggleCodeExpanded,
    actions.toggleThinkingCollapsed,
    actions.updateEditingDraft,
    runCodeCard
  ]);

  return (
    <div className="chat-flow-shell">
      <div
        className={`chat-flow follow-${followMode} ${isGenerationActive ? 'generation-active' : 'generation-settled'}`}
        ref={containerRef}
        onScroll={handleTimelineScroll}
      >
        {!presentation.startupReady ? (
          <div className="chat-empty-state empty-state-floating">
            <span className="empty-state-icon" aria-hidden="true">✦</span>
            <p className="empty-state-title">{t('chat.timeline.loadingConversation')}</p>
          </div>
        ) : null}
        {bodyUnavailable ? (
          <div className="chat-empty-state empty-state-floating" role="status">
            <span className="empty-state-icon" aria-hidden="true">!</span>
            <p className="empty-state-title">{t('chat.timeline.bodyUnavailableTitle')}</p>
            <p className="empty-state-hint">{t('chat.timeline.bodyUnavailableHint')}</p>
          </div>
        ) : null}
        {ui.showEmptyState && !bodyUnavailable ? (
          <div className="chat-empty-state empty-state-floating">
            <span className="empty-state-icon chat-empty-state-polaris" aria-hidden="true">
              <Icon name="polaris" size={20} />
            </span>
            <p className="empty-state-title">{emptyConversationSignature.name}</p>
            <p className="empty-state-hint">{emptyConversationSignature.purpose}</p>
          </div>
        ) : null}
        {timelineWindow.topSpacerHeight > 0 ? (
          <div className="chat-flow-spacer" aria-hidden="true" style={{ height: `${timelineWindow.topSpacerHeight}px` }} />
        ) : null}
        {timelineWindow.visibleItems.map(({ message, toolMessages, messageCycleIndex, userBubbleIndex, isAssistantContinuation, isTerminalAssistantInUserTurn }) => {
          const taskReceipt = taskReceiptsByMessageId.get(message.id) ?? null;
          const lifecycle: ChatMessageLifecycle = resolveChatMessageLifecycle({
            messageId: message.id,
            streaming: ui.streaming,
            enteringMessageIds
          });
          const canUseAssistantMore =
            message.role === 'assistant'
            && !message.toolInvocation
            && isTerminalAssistantInUserTurn
            && !ui.sending
            && Boolean(message.content.trim());

          const rowState: MessageRowState = {
            editing: ui.editing?.messageId === message.id ? ui.editing : null,
            isFocused: ui.focusedMessageId === message.id,
            lifecycle,
            isThinkingCollapsed: collapsedThinkingIds.has(message.id),
            isCodeExpanded: expandedCodeIds.has(message.id),
            canEdit: message.role === 'user' && !message.toolInvocation && !ui.sending,
            canEditAssistant: canUseAssistantMore,
            canRetry: canUseAssistantMore,
            codeCardActionMode: ui.codeCardActionModeByMessageId[message.id] ?? 'hidden',
            codeCardProgress: ui.codeCardProgressByMessageId[message.id] ?? null,
            messageCycleIndex
          };

          return (
            <TimelineMeasuredRow key={message.id} messageId={message.id} onMeasure={handleRowMeasure}>
              <MessageRow
                message={message}
                resolvedCardReference={resolveChatCardReference(message.cardReference, composer.availableCards)}
                fallbackAssistantName={presentation.fallbackAssistantName}
                assistantAvatarUrl={assistantAvatarUrl}
                assistantAvatarIconId={stablePayload.persona?.assistantAvatarIconId ?? null}
                assistantAvatarShape={stablePayload.persona?.assistantAvatarShape ?? 'rounded'}
                assistantAvatarSize={stablePayload.persona?.assistantAvatarSize ?? 'medium'}
                assistantSigilSeed={presentation.activeCollaboratorId}
                showChatAvatars={presentation.showChatAvatars}
                showThinking={ui.showThinking}
                state={rowState}
                actions={rowActions}
                userAvatarUrl={userAvatarUrl}
                userAvatarIconId={stablePayload.persona?.userAvatarIconId ?? null}
                userAvatarShape={stablePayload.persona?.userAvatarShape ?? 'circle'}
                userAvatarSize={stablePayload.persona?.userAvatarSize ?? 'medium'}
                toolMessages={toolMessages}
                codeCardsById={codeCardsById}
                userBubbleIndex={userBubbleIndex}
                isAssistantContinuation={isAssistantContinuation}
                isTerminalAssistantInUserTurn={isTerminalAssistantInUserTurn}
                taskReceiptAction={taskReceipt ? {
                  status: taskReceipt.task.status,
                  expanded: expandedTaskReceiptMessageId === message.id,
                  onToggle: () => setExpandedTaskReceiptMessageId((currentId) => (
                    currentId === message.id ? null : message.id
                  ))
                } : null}
              />
              {taskReceipt && expandedTaskReceiptMessageId === message.id ? (
                <div className="message-task-receipt-panel">
                  <TaskRuntimeCard
                    task={taskReceipt.task}
                    executionSegments={taskReceipt.executionSegments}
                    onCollapse={() => setExpandedTaskReceiptMessageId(null)}
                  />
                </div>
              ) : null}
            </TimelineMeasuredRow>
          );
        })}
        {timelineWindow.bottomSpacerHeight > 0 ? (
          <div className="chat-flow-spacer" aria-hidden="true" style={{ height: `${timelineWindow.bottomSpacerHeight}px` }} />
        ) : null}
        {ui.showLiveThinking ? (
          <div className="thinking-live">{t('chat.timeline.thinkingLive')}<span>.</span><span>.</span><span>.</span></div>
        ) : null}
      </div>
      {shouldShowTaskDock ? (
        <TaskRuntimeDock
          task={currentTask}
          taskModeEnabled={composer.taskModeEnabled}
          executionSegments={currentTaskEvidence}
          collapsed={isTaskDockCollapsed}
          justArmed={taskDockJustArmed}
          justCompleted={taskJustCompleted}
          showJumpToLatest={showJumpToLatest}
          showJumpToTop={showJumpToTop}
          onToggleCollapsed={() => setIsTaskDockCollapsed((current) => !current)}
          onJumpToLatest={jumpToLatest}
          onJumpToTop={jumpToTop}
        />
      ) : showJumpToTop || showJumpToLatest ? (
        <div className="chat-floating-controls">
          <div className="chat-floating-controls-stack">
            {showJumpToTop ? <JumpToTop onClick={jumpToTop} /> : null}
            {showJumpToLatest ? <JumpToLatest onClick={jumpToLatest} /> : null}
          </div>
        </div>
      ) : null}
      {codeCardPreview && codeCardPreview.presentation === 'code' ? (
        <CodeRunFullscreen
          cardId={codeCardPreview.cardId}
          title={codeCardPreview.title}
          srcDoc={codeCardPreview.srcDoc}
          code={codeCardPreview.code}
          onClose={() => setCodeCardPreview(null)}
        />
      ) : null}
      {codeCardPreview && codeCardPreview.presentation === 'text' ? (
        <TextReadingFullscreen
          title={codeCardPreview.title}
          language={codeCardPreview.language}
          content={codeCardPreview.code}
          onClose={() => setCodeCardPreview(null)}
        />
      ) : null}
    </div>
  );
}
