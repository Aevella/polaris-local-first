import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { buildCardReference } from '../../../../app/collection/codeCollectionSource';
import { resolveAssistantStreamingChrome, type ChatMessageLifecycle } from '../../../../app/chat/chatStreamingDisplay';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import type { CodeCardActionMode, CodeCardMessageProgress } from '../../../../app/chat/chatDerivedState';
import type { AvatarDisplaySize, AvatarIconId, AvatarShape, ChatAttachment, ChatCardReference, ChatMessage, ChatMessageVoiceCache, CodeCard } from '../../../../types/domain';
import { PersonaAvatar } from '../../../collaborator/PersonaAvatar';
import { resolveChatAvatarSize } from '../../../collaborator/avatarDisplaySize';
import { Icon } from '../../../Icon';
import { runSelectionAction, runSuccessAction, selectionHaptic } from '../../../haptics';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import type { ChatEditingState } from '../context/ChatUiState';
import { resolveCodeCardActionCopy, resolveMessageRowRoleClass } from '../messageRowMeta';
import { useI18n } from '../../../../i18n';
import { buildMessageCycleAttrs, buildUserBubbleCycleAttrs } from '../userBubbleCycles';
import { MessageActions, type MessageTaskReceiptAction } from './MessageActions';
import { MessageCardReference } from './MessageCardReference';
import { MessageContent } from './MessageContent';
import { MessageEditInline } from './MessageEditInline';
import { MessageMeta } from './MessageMeta';
import { MessageGeneratedImages } from './MessageGeneratedImages';
import { MessageAudioAttachments } from '../../../media/MessageAudioAttachments';
import { isPlayableAudioAttachment } from '../../../../engines/attachmentMedia';
import { MessageToolEvent } from './MessageToolEvent';
import { isProjectedCodeToolName } from './projectedCodeTools';
import { buildAssistantSpeechText } from './messageSpeechText';
import {
  buildVisibleToolProductCardMessageIds,
  nextToolProductCardActivationBlockedUntil,
  shouldBlockToolProductCardActivation
} from './toolProductCards';

export type MessageLifecycleState = ChatMessageLifecycle;

export type MessageRowState = {
  editing: ChatEditingState;
  isFocused: boolean;
  lifecycle: MessageLifecycleState;
  isThinkingCollapsed: boolean;
  isCodeExpanded: boolean;
  canEdit: boolean;
  canEditAssistant: boolean;
  canRetry: boolean;
  codeCardActionMode: CodeCardActionMode;
  codeCardProgress: CodeCardMessageProgress | null;
  messageCycleIndex: number | null;
};

export type MessageRowActions = {
  removeEditingAttachment: (attachmentId: string) => void;
  updateEditingDraft: (value: string) => void;
  commitEdit: (message: ChatMessage) => Promise<void>;
  cancelEdit: () => void;
  toggleThinkingCollapsed: (messageId: string) => void;
  openThinkingSummary: (message: ChatMessage) => void;
  saveImageAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  toggleCodeExpanded: (messageId: string) => void;
  applyCustomCss: (css: string) => void;
  codeCardAction: (message: ChatMessage) => void;
  retry: (message: ChatMessage) => Promise<void>;
  editMessage: (message: ChatMessage) => void;
  deleteUserMessage: (message: ChatMessage) => void;
  editAssistantMessage: (message: ChatMessage, content: string) => void;
  cacheAssistantSpeech: (message: ChatMessage, voiceCache: ChatMessageVoiceCache) => void;
  forkFromMessage: (message: ChatMessage) => void;
  applyToolPreview: (message: ChatMessage) => void;
  saveToolPreview: (message: ChatMessage) => void;
  rollbackToolPreview: (message: ChatMessage) => void;
  openToolbox: () => void;
  openCodeCard: (cardId: string) => void;
  runCodeCard: (card: CodeCard) => void;
  setCommandStatus: (text: string, isError?: boolean) => void;
};

type MessageRowProps = {
  message: ChatMessage;
  resolvedCardReference?: ChatCardReference | null;
  fallbackAssistantName: string;
  assistantAvatarUrl: string | null;
  assistantAvatarIconId: AvatarIconId | null;
  assistantAvatarShape: AvatarShape;
  assistantAvatarSize: AvatarDisplaySize;
  assistantSigilSeed: string | null;
  showChatAvatars: boolean;
  showThinking: boolean;
  state: MessageRowState;
  actions: MessageRowActions;
  userAvatarUrl: string | null;
  userAvatarIconId: AvatarIconId | null;
  userAvatarShape: AvatarShape;
  userAvatarSize: AvatarDisplaySize;
  toolMessages?: ChatMessage[];
  codeCardsById: Record<string, CodeCard>;
  userBubbleIndex?: number;
  isAssistantContinuation?: boolean;
  isTerminalAssistantInUserTurn?: boolean;
  taskReceiptAction?: MessageTaskReceiptAction | null;
};

function MessageRowComponent({
  message,
  resolvedCardReference,
  fallbackAssistantName,
  assistantAvatarUrl,
  assistantAvatarIconId,
  assistantAvatarShape,
  assistantAvatarSize,
  assistantSigilSeed,
  showChatAvatars,
  showThinking,
  state,
  actions,
  userAvatarUrl,
  userAvatarIconId,
  userAvatarShape,
  userAvatarSize,
  toolMessages = [],
  codeCardsById,
  userBubbleIndex,
  isAssistantContinuation = false,
  isTerminalAssistantInUserTurn = true,
  taskReceiptAction = null
}: MessageRowProps) {
  const { t } = useI18n();
  const isToolEvent = Boolean(message.toolInvocation);
  const isAssistantReply = message.role === 'assistant' && !isToolEvent;
  const isUserMessage = message.role === 'user' && !isToolEvent;
  const isPlainSystemMessage = message.role === 'system' && !isToolEvent;
  const sandboxToolInvocation = toolMessages.find((toolMessage) => toolMessage.toolInvocation?.kind === 'runCode')?.toolInvocation ?? null;
  const hasProjectedCodeToolEvent = toolMessages.some((toolMessage) => {
    const tool = toolMessage.toolInvocation;
    return Boolean(tool && isProjectedCodeToolName(tool.kind));
  });
  const isStreamingLike = state.lifecycle === 'streaming-stage' || state.lifecycle === 'streaming-live';
  const streamingChrome = resolveAssistantStreamingChrome({
    message,
    lifecycle: state.lifecycle,
    showThinking
  });
  const showStreamingPrelude = streamingChrome.showPrelude;
  const showStreamingHint = streamingChrome.showHint;
  const showStreamingLive = streamingChrome.showLiveHint;
  const collapseThinkingProjection =
    state.isThinkingCollapsed
    || toolMessages.length > 0
    || Boolean(taskReceiptAction)
    || !isTerminalAssistantInUserTurn;
  const shouldShowMeta = showThinking || showChatAvatars;
  const showAssistantMeta =
    shouldShowMeta
    && (!isAssistantContinuation || (showThinking && Boolean(message.thinkingText)))
    && !showChatAvatars;
  const showAssistantChatIdentity = showChatAvatars && !isAssistantContinuation;
  const assistantAvatarPx = resolveChatAvatarSize(assistantAvatarSize);
  const userAvatarPx = resolveChatAvatarSize(userAvatarSize);
  const [userActionMenuOpen, setUserActionMenuOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const bubbleFrameRef = useRef<HTMLDivElement>(null);
  const toolProductCardActivationBlockedUntilRef = useRef(0);
  const { label: codeCardActionLabel, progressLabel: codeCardProgressLabel } = resolveCodeCardActionCopy(
    state.codeCardActionMode,
    state.codeCardProgress,
    t
  );
  const resolvedCodeCard = resolvedCardReference ? codeCardsById[resolvedCardReference.id] ?? null : null;
  const visibleToolProductCardMessageIds = useMemo(
    () => buildVisibleToolProductCardMessageIds(toolMessages),
    [toolMessages]
  );
  const speechContent = useMemo(
    () => (isAssistantReply ? buildAssistantSpeechText(message.content) : ''),
    [isAssistantReply, message.content]
  );
  const currentInteractionTimeMs = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  );
  const markToolReceiptInteraction = () => {
    toolProductCardActivationBlockedUntilRef.current = nextToolProductCardActivationBlockedUntil(
      currentInteractionTimeMs()
    );
  };
  const isToolProductCardActivationBlocked = () => shouldBlockToolProductCardActivation(
    toolProductCardActivationBlockedUntilRef.current,
    currentInteractionTimeMs()
  );
  const runToolProductCardAction = (action: () => void) => {
    if (isToolProductCardActivationBlocked()) return;
    action();
  };
  const renderToolProductCard = (toolMessage: ChatMessage) => {
    // 生成的图片也是成品：大图挂在回执下面，而不是缩在附件 chip 里
    const tool = toolMessage.toolInvocation;
    const generatedImages = tool && tool.status !== 'failed' && tool.status !== 'running'
      ? (toolMessage.attachments ?? []).filter((attachment) => attachment.kind === 'image')
      : [];
    const generatedAudio = tool && tool.status !== 'failed' && tool.status !== 'running'
      ? (toolMessage.attachments ?? []).filter(isPlayableAudioAttachment)
      : [];
    const imagesNode = generatedImages.length > 0 ? (
      <MessageGeneratedImages
        attachments={generatedImages}
        onSave={(attachment) => actions.saveImageAttachment(toolMessage, attachment)}
      />
    ) : null;
    const audioNode = generatedAudio.length > 0 ? (
      <MessageAudioAttachments attachments={generatedAudio} />
    ) : null;

    const cardNode = (() => {
      if (toolMessages.length > 0 && !visibleToolProductCardMessageIds.has(toolMessage.id)) return null;
      const cardId = tool?.cardId;
      if (!cardId || tool?.status === 'failed') return null;
      const card = codeCardsById[cardId] ?? null;
      if (!card) return null;

      return (
        <MessageCardReference
          reference={buildCardReference(card, 'continue')}
          card={card}
          tone="created"
          onOpen={() => runToolProductCardAction(() => actions.openCodeCard(card.id))}
          onRun={() => runToolProductCardAction(() => actions.runCodeCard(card))}
        />
      );
    })();

    if (!imagesNode && !audioNode && !cardNode) return null;
    return (
      <>
        {imagesNode}
        {audioNode}
        {cardNode}
      </>
    );
  };
  const messageActions = isAssistantReply && !state.editing ? (
    <MessageActions
      canCopyAssistant={message.role === 'assistant' && !message.toolInvocation && !isStreamingLike && isTerminalAssistantInUserTurn && Boolean(message.content.trim())}
      canOpenThinkingSummary={showThinking && showChatAvatars && Boolean(message.thinkingText)}
      memoryEvidence={message.memoryEvidence ?? null}
      canRetryAssistant={state.canRetry}
      canEditAssistant={state.canEditAssistant}
      canForkAssistant={state.canEditAssistant}
      taskReceiptAction={taskReceiptAction}
      codeCardActionLabel={codeCardActionLabel}
      codeCardActionMode={state.codeCardActionMode}
      codeCardProgressLabel={codeCardProgressLabel}
      isThinkingActive={isStreamingLike}
      messageContent={message.content}
      speechContent={speechContent}
      speechCache={message.voiceCache ?? null}
      role={message.role === 'assistant' ? 'assistant' : 'user'}
      onSetCommandStatus={actions.setCommandStatus}
      onCodeCardAction={() => actions.codeCardAction(message)}
      onOpenThinkingSummary={() => actions.openThinkingSummary(message)}
      onRetryLatestAssistant={() => void actions.retry(message)}
      onEditAssistant={(content) => actions.editAssistantMessage(message, content)}
      onSpeechCacheReady={(voiceCache) => actions.cacheAssistantSpeech(message, voiceCache)}
      onForkAssistant={() => actions.forkFromMessage(message)}
    />
  ) : null;
  useEffect(() => {
    if (!userActionMenuOpen) return;

    const handlePointerDownOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleFrameRef.current?.contains(target)) return;
      setUserActionMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
  }, [userActionMenuOpen]);

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const openUserActionMenu = () => {
    if (!isUserMessage || state.editing || !state.canEdit) return;
    void selectionHaptic();
    setUserActionMenuOpen(true);
  };

  const copyUserMessage = async () => {
    if (!message.content.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(message.content));
    setUserActionMenuOpen(false);
  };

  const editUserMessage = () => {
    runSelectionAction(() => {
      setUserActionMenuOpen(false);
      actions.editMessage(message);
    }, { settle: 'none' });
  };

  const deleteUserMessage = () => {
    runSelectionAction(() => {
      setUserActionMenuOpen(false);
      actions.deleteUserMessage(message);
    }, { settle: 'none' });
  };

  const handleBubblePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isUserMessage || state.editing || !state.canEdit) return;
    if (event.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      openUserActionMenu();
    }, 360);
  };

  const handleBubbleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!isUserMessage || state.editing || !state.canEdit) return;
    event.preventDefault();
    openUserActionMenu();
  };

  const messageBubble = (
    <div
      ref={bubbleFrameRef}
      className={`bubble-frame ${message.role === 'assistant' ? 'assistant' : 'user'} ${state.editing ? 'editing' : ''} ${state.lifecycle} ${showStreamingPrelude ? 'streaming-prelude' : ''} ${userActionMenuOpen ? 'action-menu-open' : ''}`}
      onContextMenu={handleBubbleContextMenu}
      onPointerDown={handleBubblePointerDown}
      onPointerUp={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onPointerMove={clearLongPressTimer}
    >
      <div
        className={`bubble ${message.role === 'assistant' ? 'assistant' : 'user'} ${state.editing ? 'editing' : ''}`}
      >
        {state.editing ? (
          <MessageEditInline
            message={message}
            editing={state.editing}
            onRemoveEditingAttachment={actions.removeEditingAttachment}
            onUpdateEditingDraft={actions.updateEditingDraft}
            onCommitEdit={actions.commitEdit}
            onCancelEdit={actions.cancelEdit}
          />
        ) : (
          <>
            <ChatAttachmentStrip
              attachments={message.attachments}
              tone="message"
              onSaveImage={(attachment) => actions.saveImageAttachment(message, attachment)}
            />
            {resolvedCardReference ? (
              <MessageCardReference
                reference={resolvedCardReference}
                card={resolvedCodeCard}
                onOpen={resolvedCodeCard ? () => actions.openCodeCard(resolvedCodeCard.id) : undefined}
                onRun={resolvedCodeCard ? () => actions.runCodeCard(resolvedCodeCard) : undefined}
              />
            ) : null}
            {showStreamingPrelude ? (
              <>
                <div className="assistant-stage-live" aria-label={t('chat.messageRow.generatingAria')}>
                  <span className="assistant-stage-live-icon" aria-hidden="true">
                    <Icon name="polarisStar" size={16} color="polarisDeepSpace" />
                  </span>
                </div>
                {showStreamingHint ? <div className="assistant-streaming-hint" aria-hidden="true">{t('chat.messageRow.streamingHint')}<span className="assistant-streaming-dots"><span /><span /><span /></span><span className="assistant-streaming-caret" /></div> : null}
              </>
            ) : (
              <>
                <MessageContent
                  message={message}
                  codeCardActionMode={state.codeCardActionMode}
                  isCodeExpanded={state.isCodeExpanded}
                  sandboxToolInvocation={sandboxToolInvocation}
                  hasProjectedCodeToolEvent={hasProjectedCodeToolEvent}
                  hasResolvedToolEvent={toolMessages.length > 0}
                  collapseThinkingProjection={collapseThinkingProjection}
                  showThinking={showThinking}
                  preferInlineCode={showStreamingLive}
                  smoothStreamingText={showStreamingLive}
                  onToggleCodeExpanded={() => actions.toggleCodeExpanded(message.id)}
                  onApplyCustomCss={actions.applyCustomCss}
                />
                {showStreamingHint ? <div className="assistant-streaming-hint" aria-hidden="true">{t('chat.messageRow.streamingHint')}<span className="assistant-streaming-dots"><span /><span /><span /></span><span className="assistant-streaming-caret" /></div> : null}
              </>
            )}
          </>
        )}
      </div>
      {isUserMessage && !state.editing && state.canEdit && userActionMenuOpen ? (
        <div className="user-bubble-action-menu" role="menu" aria-label={t('chat.messageActions.userMenuAria')}>
          <button type="button" className="user-bubble-action-btn" role="menuitem" onClick={() => { void copyUserMessage(); }}>
            <Icon name="copy" size={14} />
            <span>{t('chat.messageActions.copy')}</span>
          </button>
          <button type="button" className="user-bubble-action-btn" role="menuitem" onClick={editUserMessage}>
            <Icon name="edit" size={14} />
            <span>{t('chat.messageActions.editAndRetry')}</span>
          </button>
          <button type="button" className="user-bubble-action-btn danger" role="menuitem" onClick={deleteUserMessage}>
            <Icon name="trash" size={14} />
            <span>{t('chat.messageActions.delete')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`msg-row ${resolveMessageRowRoleClass(message, isToolEvent)} ${state.isFocused ? 'focused' : ''}`}
      data-message-id={message.id}
      data-row-state={state.lifecycle}
      {...buildUserBubbleCycleAttrs(userBubbleIndex)}
      {...buildMessageCycleAttrs(state.messageCycleIndex)}
    >
      {isToolEvent ? (
        <div className="tool-product-stack">
          <MessageToolEvent
            message={message}
            onSaveImageAttachment={actions.saveImageAttachment}
            onApplyToolPreview={actions.applyToolPreview}
            onSaveToolPreview={actions.saveToolPreview}
            onRollbackToolPreview={actions.rollbackToolPreview}
            onOpenToolbox={actions.openToolbox}
            onInteractionBoundary={markToolReceiptInteraction}
          />
          {renderToolProductCard(message)}
        </div>
      ) : isPlainSystemMessage ? (
        <div className="system-inline-note">{message.content}</div>
      ) : isAssistantReply ? (
        <div className={`message-turn assistant ${showChatAvatars ? 'with-avatar' : ''}`}>
          <div className="message-turn-body assistant">
            {showChatAvatars ? (
              <div
                className={`message-avatar-slot assistant ${isAssistantContinuation ? 'empty' : ''}`}
                style={{ width: assistantAvatarPx, minWidth: assistantAvatarPx }}
              >
                {!isAssistantContinuation ? (
                  <PersonaAvatar
                    role="assistant"
                    seed={assistantSigilSeed}
                    imageUrl={assistantAvatarUrl}
                    iconId={assistantAvatarIconId}
                    shape={assistantAvatarShape}
                    size={assistantAvatarPx}
                    className="message-avatar"
                  />
                ) : null}
              </div>
            ) : null}
            <div className="message-turn-stack assistant">
              {showAssistantChatIdentity ? (
                <MessageMeta
                  message={message}
                  fallbackAssistantName={fallbackAssistantName}
                  isThinkingActive={isStreamingLike}
                  onOpenThinkingSummary={actions.openThinkingSummary}
                  showDetails={false}
                  showThinking={showThinking}
                />
              ) : null}
              {showAssistantMeta ? (
                <MessageMeta
                  message={message}
                  fallbackAssistantName={fallbackAssistantName}
                  isThinkingActive={isStreamingLike}
                  onOpenThinkingSummary={actions.openThinkingSummary}
                  showIdentity={!isAssistantContinuation}
                  showThinking={showThinking}
                />
              ) : null}
              {messageBubble}
              {toolMessages.length > 0 ? (
                <div className="assistant-leading-tool-list">
                  {toolMessages.map((toolMessage) => (
                    <div key={toolMessage.id} className="tool-product-stack">
                      <MessageToolEvent
                        message={toolMessage}
                        onSaveImageAttachment={actions.saveImageAttachment}
                        onApplyToolPreview={actions.applyToolPreview}
                        onSaveToolPreview={actions.saveToolPreview}
                        onRollbackToolPreview={actions.rollbackToolPreview}
                        onOpenToolbox={actions.openToolbox}
                        onInteractionBoundary={markToolReceiptInteraction}
                      />
                      {renderToolProductCard(toolMessage)}
                    </div>
                  ))}
                </div>
              ) : null}
              {messageActions}
            </div>
          </div>
        </div>
      ) : (
        <div className={`message-turn user ${showChatAvatars ? 'with-avatar' : ''}`}>
          <div className="message-turn-body user">
            <div className="message-turn-stack user">
              {messageBubble}
              {messageActions}
            </div>
            {showChatAvatars ? (
              <div className="message-avatar-slot user">
                <PersonaAvatar
                  role="user"
                  seed={assistantSigilSeed}
                  imageUrl={userAvatarUrl}
                  iconId={userAvatarIconId}
                  shape={userAvatarShape}
                  size={userAvatarPx}
                  className="message-avatar"
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function areMessageRowPropsEqual(previous: MessageRowProps, next: MessageRowProps) {
  return (
    previous.message === next.message
    && previous.fallbackAssistantName === next.fallbackAssistantName
    && previous.assistantAvatarUrl === next.assistantAvatarUrl
    && previous.assistantAvatarIconId === next.assistantAvatarIconId
    && previous.assistantAvatarShape === next.assistantAvatarShape
    && previous.assistantAvatarSize === next.assistantAvatarSize
    && previous.assistantSigilSeed === next.assistantSigilSeed
    && previous.showChatAvatars === next.showChatAvatars
    && previous.showThinking === next.showThinking
    && previous.userAvatarUrl === next.userAvatarUrl
    && previous.userAvatarIconId === next.userAvatarIconId
    && previous.userAvatarShape === next.userAvatarShape
    && previous.userAvatarSize === next.userAvatarSize
    && previous.toolMessages === next.toolMessages
    && previous.codeCardsById === next.codeCardsById
    && previous.userBubbleIndex === next.userBubbleIndex
    && previous.isAssistantContinuation === next.isAssistantContinuation
    && previous.isTerminalAssistantInUserTurn === next.isTerminalAssistantInUserTurn
    && previous.taskReceiptAction === next.taskReceiptAction
    && previous.message.memoryEvidence === next.message.memoryEvidence
    && previous.state.editing === next.state.editing
    && previous.state.isFocused === next.state.isFocused
    && previous.state.lifecycle === next.state.lifecycle
    && previous.state.isThinkingCollapsed === next.state.isThinkingCollapsed
    && previous.state.isCodeExpanded === next.state.isCodeExpanded
    && previous.state.canEdit === next.state.canEdit
    && previous.state.canEditAssistant === next.state.canEditAssistant
    && previous.state.canRetry === next.state.canRetry
    && previous.state.codeCardActionMode === next.state.codeCardActionMode
    && previous.state.codeCardProgress === next.state.codeCardProgress
    && previous.state.messageCycleIndex === next.state.messageCycleIndex
  );
}

export const MessageRow = memo(MessageRowComponent, areMessageRowPropsEqual);
