import { useChatStore } from '../../../../stores/chatStore';
import { shouldSendOnComposerReturn } from '../../../../engines/conversationWindowSettings';
import { ImpactStyle } from '@capacitor/haptics';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveChatCardReference } from '../../../../app/collection/codeCollectionSource';
import { Icon } from '../../../Icon';
import { runImpactAction } from '../../../haptics';
import {
  useChatActions,
  useChatAttachments,
  useChatComposer,
  useChatPresentation,
  useChatUi
} from '../context/ChatContext';
import { ChatWorkspaceBanner } from './ChatWorkspaceBanner';
import { ComposerAttachments, ComposerQuickActions } from './ComposerAttachments';
import { ComposerCardReferenceStrip } from './ComposerCardReferenceStrip';
import { ComposerPreviewStrip } from './ComposerPreviewStrip';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';
import { useComposerFileIngest } from './useComposerFileIngest';
import { useI18n } from '../../../../i18n';

function resolveThemeReviveSpell(input: string): 'restore-default' | 'revive-last' | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;
  if (
    normalized === '//revive'
    || normalized === '//safe'
    || normalized === '复活polaris'
    || normalized === '救活polaris'
  ) {
    return 'revive-last';
  }
  if (
    normalized === '//default'
    || normalized === '//reset'
    || normalized === '恢复默认polaris'
    || normalized === '默认polaris'
  ) {
    return 'restore-default';
  }
  return null;
}

export function ChatComposer() {
  const { t } = useI18n();
  const presentation = useChatPresentation();
  const composer = useChatComposer();
  const ui = useChatUi();
  const attachments = useChatAttachments();
  const actions = useChatActions();
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeConversationId = presentation.activeConversationId;
  const returnKeyBehavior = useChatStore(state => state.conversations.find(item => item.id === activeConversationId)?.windowPreferences?.composerReturnKeyBehavior ?? 'automatic');
  const [localDraft, setLocalDraft] = useState(composer.inputDraft);
  const localDraftRef = useRef(composer.inputDraft);
  const draftConversationIdRef = useRef(activeConversationId);
  const syncedDraftRef = useRef(composer.inputDraft);
  const syncedDraftConversationIdRef = useRef(activeConversationId);
  const resizeFrameRef = useRef<number | null>(null);
  const actionsRef = useRef(actions);
  const handleAddAttachments = useComposerFileIngest();
  const resolvedPendingCardReference = useMemo(
    () => resolveChatCardReference(composer.pendingCardReference, composer.availableCards),
    [composer.availableCards, composer.pendingCardReference]
  );

  actionsRef.current = actions;

  const writeDraftToStore = (value: string, conversationId: string | null) => {
    if (
      syncedDraftConversationIdRef.current === conversationId
      && syncedDraftRef.current === value
    ) {
      return;
    }
    if (conversationId) {
      actionsRef.current.setConversationDraft(conversationId, value);
    } else {
      actionsRef.current.setInputDraft(value);
    }
    syncedDraftConversationIdRef.current = conversationId;
    syncedDraftRef.current = value;
  };

  const flushDraftToStore = () => {
    writeDraftToStore(localDraftRef.current, draftConversationIdRef.current);
  };

  const updateLocalDraft = (value: string) => {
    localDraftRef.current = value;
    // Live keystrokes stay local; draft persistence flushes at interaction boundaries.
    setLocalDraft(value);
  };

  useEffect(() => () => {
    flushDraftToStore();
  }, [activeConversationId]);

  useEffect(() => {
    const flushOnPageHide = () => flushDraftToStore();
    const flushOnVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') flushDraftToStore();
    };
    window.addEventListener('pagehide', flushOnPageHide);
    document.addEventListener('visibilitychange', flushOnVisibilityHidden);
    return () => {
      window.removeEventListener('pagehide', flushOnPageHide);
      document.removeEventListener('visibilitychange', flushOnVisibilityHidden);
    };
  }, []);

  useEffect(() => {
    draftConversationIdRef.current = activeConversationId;
    syncedDraftConversationIdRef.current = activeConversationId;
    syncedDraftRef.current = composer.inputDraft;
    localDraftRef.current = composer.inputDraft;
    setLocalDraft((current) => (current === composer.inputDraft ? current : composer.inputDraft));
  }, [activeConversationId, composer.inputDraft]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });
    return () => {
      if (resizeFrameRef.current === null) return;
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    };
  }, [localDraft]);

  const interactionLocked = presentation.interactionLocked;
  const hasUnsupportedPendingImages = presentation.hasUnsupportedPendingImages;
  const visibleStatus = ui.commandStatus;
  const slashCommandQuery = useMemo(() => {
    if (ui.sending) return null;
    const trimmedStart = localDraft.trimStart();
    if (!trimmedStart.startsWith('/') || trimmedStart.startsWith('//') || trimmedStart.includes('\n')) return null;
    return trimmedStart.slice(1).split(/\s+/)[0].toLowerCase();
  }, [localDraft, ui.sending]);
  const hasSlashCommandDraft = slashCommandQuery !== null && attachments.pending.length === 0 && !resolvedPendingCardReference;
  const tryCastThemeReviveSpell = () => {
    if (attachments.pending.length > 0) return false;
    if (composer.pendingCardReference) return false;
    const spell = resolveThemeReviveSpell(localDraft);
    if (!spell) return false;
    if (spell === 'revive-last') {
      actions.reviveTheme();
    } else {
      actions.restoreDefaultTheme();
    }
    updateLocalDraft('');
    writeDraftToStore('', draftConversationIdRef.current);
    return true;
  };
  const handleComposerPaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const files = event.clipboardData?.files;
    if (!files?.length) return;
    event.preventDefault();
    await handleAddAttachments(files);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || interactionLocked || hasUnsupportedPendingImages) return;
    const prefersTouchInput =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
    if (!shouldSendOnComposerReturn({ behavior: returnKeyBehavior, touch: prefersTouchInput, shift: event.shiftKey, composing: event.nativeEvent.isComposing })) return;
    if (tryCastThemeReviveSpell()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    flushDraftToStore();
    void actions.submit();
  };
  const handleSubmitPress = () => {
    if (ui.sending) {
      actions.stopGeneration();
      return;
    }
    if (tryCastThemeReviveSpell()) return;
    flushDraftToStore();
    void actions.submit();
  };
  const handleComposerInputEngage = () => {
    if (!attachmentPickerOpen) return;
    setAttachmentPickerOpen(false);
  };
  const handleComposerBlankDismiss = (target: EventTarget | null) => {
    if (!attachmentPickerOpen || !(target instanceof HTMLElement)) return;
    const interactiveTarget = target.closest(
      'button, textarea, input, .chat-box-shell, .active-preview-strip, .chat-workspace-banner, .composer-card-reference-strip, .attachment-warning'
    );
    if (interactiveTarget) return;
    setAttachmentPickerOpen(false);
  };
  const handlePickSlashCommand = (insertText: string) => {
    updateLocalDraft(insertText);
    writeDraftToStore(insertText, draftConversationIdRef.current);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertText.length, insertText.length);
    });
  };

  return (
    <>
      {attachmentPickerOpen ? (
        <button
          type="button"
          tabIndex={-1}
          className="composer-picker-dismiss-layer"
          aria-label={t('chat.composer.dismissAttachments')}
          onPointerDown={(event) => {
            event.preventDefault();
            setAttachmentPickerOpen(false);
          }}
          onClick={() => setAttachmentPickerOpen(false)}
        />
      ) : null}
      <div
        className={`chat-composer ${attachmentPickerOpen ? 'picker-open' : ''} ${composer.dragActive ? 'drag-active' : ''}`}
        onPointerDownCapture={(event) => handleComposerBlankDismiss(event.target)}
        onClickCapture={(event) => handleComposerBlankDismiss(event.target)}
        onPaste={(event) => { void handleComposerPaste(event); }}
      >
        <ChatWorkspaceBanner />
        {ui.activePreviewMessage ? (
          <ComposerPreviewStrip
            message={ui.activePreviewMessage}
            onApply={actions.applyToolPreview}
            onSave={actions.saveToolPreview}
            onRollback={actions.rollbackToolPreview}
          />
        ) : null}
        <ComposerAttachments
          pickerOpen={attachmentPickerOpen}
          interactionLocked={interactionLocked}
          pendingAttachmentsCount={attachments.pending.length}
          hasUnsupportedPendingImages={hasUnsupportedPendingImages}
          taskToolsEnabled={composer.toolPromptPreferences.task}
          taskModeEnabled={composer.taskModeEnabled}
          reasoningStrength={composer.reasoningStrength}
          pendingAttachments={attachments.pending}
          pendingCardReference={resolvedPendingCardReference}
          availableCards={composer.availableCards}
          onAddAttachments={handleAddAttachments}
          onRemoveAttachment={attachments.remove}
          onToggleTaskModeEnabled={actions.setTaskModeEnabled}
          onSetReasoningStrength={actions.setConversationReasoningStrength}
          onOpenToolbox={actions.openToolbox}
          onSetPickerOpen={setAttachmentPickerOpen}
          onSetPendingCardReference={actions.setPendingCardReference}
        />
        {resolvedPendingCardReference ? (
          <ComposerCardReferenceStrip
            reference={resolvedPendingCardReference}
            onRemove={() => actions.setPendingCardReference(null)}
          />
        ) : null}
        {visibleStatus ? (
          <p className={`command-status ${visibleStatus.isError ? 'error' : ''}`}>
            {visibleStatus.text}
          </p>
        ) : null}
        <SlashCommandSuggestions
          query={slashCommandQuery}
          onPick={handlePickSlashCommand}
        />
        <div className="chat-submit-anchor">
          {ui.submitFlight ? (
            <div key={ui.submitFlight.id} className="chat-submit-flight" aria-hidden="true">
              <span className="chat-submit-flight-orbit">
                <Icon name="send" size={13} />
              </span>
              <span className="chat-submit-flight-trail" />
            </div>
          ) : null}
          <div className="chat-box-shell chat-box">
            <div className="chat-box-main">
              <ComposerQuickActions
                pickerOpen={attachmentPickerOpen}
                interactionLocked={interactionLocked}
                onSetPickerOpen={setAttachmentPickerOpen}
              />
              <textarea
                ref={textareaRef}
                rows={1}
                value={localDraft}
                onChange={(event) => updateLocalDraft(event.target.value)}
                onPointerDown={handleComposerInputEngage}
                onFocus={handleComposerInputEngage}
                onBlur={flushDraftToStore}
                onKeyDown={handleKeyDown}
                disabled={interactionLocked}
                placeholder={`to ${presentation.assistantName}`}
              />
              <button
                type="button"
                className={`send-btn ${
                  ui.sending
                  || localDraft.trim()
                  || attachments.pending.length > 0
                  || resolvedPendingCardReference
                    ? 'has-content'
                    : ''
                }`}
                disabled={hasUnsupportedPendingImages || interactionLocked}
                aria-label={ui.sending ? t('chat.composer.stopGeneration') : hasSlashCommandDraft ? t('chat.composer.executeCommand') : t('chat.composer.sendMessage')}
                onClick={(event) => {
                  runImpactAction(handleSubmitPress, {
                    element: event.currentTarget,
                    style: ui.sending ? ImpactStyle.Medium : ImpactStyle.Light
                  });
                }}
              >
                <Icon name={ui.sending ? 'x' : hasSlashCommandDraft ? 'check' : 'send'} size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
