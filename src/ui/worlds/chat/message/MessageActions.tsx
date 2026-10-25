import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CodeCardActionMode } from '../../../../app/chat/chatDerivedState';
import { readMessageSpeechCacheBlob, saveMessageSpeechCache } from '../../../../app/chat/messageSpeechCache';
import { requestGeneratedSpeech } from '../../../../engines/voiceGenerationClient';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import { canUseNativeSystemBackupFiles, exportFileViaSystemFiles } from '../../../../native/systemBackupFiles';
import { useRuntimeStore } from '../../../../stores/runtimeStore';
import type { ChatMemoryEvidence, ChatMessageVoiceCache, ConversationTaskStatus } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { runSelectionAction, runSuccessAction } from '../../../haptics';
import { useI18n } from '../../../../i18n';
import { MessageMemoryEvidence } from './MessageMemoryEvidence';

async function exportSpeechBlob(blob: Blob, fileName: string) {
  if (canUseNativeSystemBackupFiles()) {
    return await exportFileViaSystemFiles(blob, fileName);
  }

  if (typeof File !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    const shareData: ShareData = { files: [file], title: fileName };
    if (typeof navigator.canShare !== 'function' || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return true;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export type MessageTaskReceiptAction = {
  status: ConversationTaskStatus;
  expanded: boolean;
  onToggle: () => void;
};

type MessageActionsProps = {
  onSetContextStart?: () => void;
  canCopyAssistant: boolean;
  canEditAssistant: boolean;
  canForkAssistant: boolean;
  canRetryAssistant: boolean;
  retryAssistantLabel?: string;
  canOpenThinkingSummary: boolean;
  memoryEvidence?: ChatMemoryEvidence | null;
  taskReceiptAction?: MessageTaskReceiptAction | null;
  codeCardActionLabel: string;
  codeCardActionMode: CodeCardActionMode;
  codeCardProgressLabel: string | null;
  isThinkingActive: boolean;
  messageContent: string;
  speechContent: string;
  speechCache?: ChatMessageVoiceCache | null;
  role: 'assistant' | 'user';
  onSetCommandStatus: (text: string, isError?: boolean) => void;
  onCodeCardAction: () => void;
  onEditAssistant: (content: string) => void;
  onSpeechCacheReady: (voiceCache: ChatMessageVoiceCache) => void;
  onForkAssistant: () => void;
  onOpenThinkingSummary: () => void;
  onRetryLatestAssistant: () => void;
};

export function MessageActions({
  onSetContextStart,
  canCopyAssistant,
  canEditAssistant,
  canForkAssistant,
  canRetryAssistant,
  retryAssistantLabel,
  canOpenThinkingSummary,
  memoryEvidence = null,
  taskReceiptAction = null,
  codeCardActionLabel,
  codeCardActionMode,
  codeCardProgressLabel,
  isThinkingActive,
  messageContent,
  speechContent,
  speechCache = null,
  role,
  onSetCommandStatus,
  onCodeCardAction,
  onEditAssistant,
  onSpeechCacheReady,
  onForkAssistant,
  onOpenThinkingSummary,
  onRetryLatestAssistant
}: MessageActionsProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [nativeSpeechAvailable, setNativeSpeechAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  const [assistantSheetOpen, setAssistantSheetOpen] = useState(false);
  const [assistantSheetMode, setAssistantSheetMode] = useState<'menu' | 'edit' | 'memory'>('menu');
  const [assistantDraft, setAssistantDraft] = useState(messageContent);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceGeneration = useRuntimeStore((state) => state.voiceGeneration);
  const showCodeCardAction = codeCardActionMode !== 'hidden';
  const hasMemoryEvidence = role === 'assistant' && Boolean(memoryEvidence?.items.length);
  const hasSpeechCache = role === 'assistant' && Boolean(speechCache?.assetId);
  const hasAssistantMore = role === 'assistant' && (canEditAssistant || canForkAssistant || canRetryAssistant || onSetContextStart || hasMemoryEvidence || hasSpeechCache);
  const speakableContent = speechContent.trim();
  const canUseConfiguredSpeech = voiceGeneration.enabled && Boolean(voiceGeneration.baseUrl?.trim() && voiceGeneration.apiKey?.trim());
  const canSpeakAssistant = role === 'assistant' && Boolean(speakableContent) && (hasSpeechCache || canUseConfiguredSpeech || nativeSpeechAvailable);
  const resolvedRetryAssistantLabel = retryAssistantLabel ?? t('chat.messageActions.retry');

  useEffect(() => {
    if (!assistantSheetOpen) {
      setAssistantDraft(messageContent);
      setAssistantSheetMode('menu');
    }
  }, [assistantSheetOpen, messageContent]);

  useEffect(() => {
    if (!assistantSheetOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistantSheetOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [assistantSheetOpen]);

  useEffect(() => {
    setNativeSpeechAvailable(typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
  }, []);

  useEffect(() => () => {
    stopSpeechPlayback();
  }, []);

  if (!canCopyAssistant && !canSpeakAssistant && !hasAssistantMore && !showCodeCardAction && !canOpenThinkingSummary && !taskReceiptAction) {
    return null;
  }

  const copyMessage = async () => {
    if (!messageContent.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(messageContent));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  function stopSpeechPlayback() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    const currentAudio = audioRef.current;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      audioRef.current = null;
    }
    const currentUrl = audioUrlRef.current;
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      audioUrlRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setSpeaking(false);
    setSpeechLoading(false);
  }

  const playNativeSpeech = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const playConfiguredSpeech = async (text: string) => {
    if (!voiceGeneration.baseUrl?.trim() || !voiceGeneration.apiKey?.trim()) {
      onSetCommandStatus(t('chat.messageActions.chooseVoiceProvider'), true);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSpeechLoading(true);
    try {
      const result = await requestGeneratedSpeech({
        settings: voiceGeneration,
        text,
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      try {
        const voiceCache = await saveMessageSpeechCache({
          text,
          settings: voiceGeneration,
          result
        });
        if (!controller.signal.aborted) {
          onSpeechCacheReady(voiceCache);
        }
      } catch {
        onSetCommandStatus(t('chat.messageActions.speechCacheSaveFailed'), true);
      }
      if (!controller.signal.aborted) {
        await playAudioBlob(result.blob);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : t('chat.messageActions.speechGenerationFailed');
      onSetCommandStatus(message, true);
      stopSpeechPlayback();
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setSpeechLoading(false);
    }
  };

  const playAudioBlob = async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audioUrlRef.current = url;
    audio.onended = () => {
      if (audioRef.current !== audio) return;
      stopSpeechPlayback();
    };
    audio.onerror = () => {
      if (audioRef.current !== audio) return;
      onSetCommandStatus(t('chat.messageActions.audioPlaybackFailed'), true);
      stopSpeechPlayback();
    };
    setSpeaking(true);
    await audio.play();
  };

  const playCachedSpeech = async (cache: ChatMessageVoiceCache) => {
    setSpeechLoading(true);
    try {
      const blob = await readMessageSpeechCacheBlob(cache);
      await playAudioBlob(blob);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.messageActions.speechCacheMissing');
      onSetCommandStatus(message, true);
      stopSpeechPlayback();
    } finally {
      setSpeechLoading(false);
    }
  };

  const downloadCachedSpeech = async (cache: ChatMessageVoiceCache) => {
    try {
      const blob = await readMessageSpeechCacheBlob(cache);
      const exported = await exportSpeechBlob(blob, cache.name || 'Polaris-voice.mp3');
      if (exported) onSetCommandStatus(t('chat.messageActions.speechCacheExported'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.messageActions.speechCacheMissing');
      onSetCommandStatus(message, true);
    }
  };

  const toggleSpeech = () => {
    if (!canSpeakAssistant || speechLoading) return;
    const text = speakableContent;
    if (!text) return;
    if (speaking) {
      stopSpeechPlayback();
      return;
    }
    stopSpeechPlayback();
    if (speechCache?.assetId) {
      void playCachedSpeech(speechCache);
      return;
    }
    if (voiceGeneration.enabled) {
      void playConfiguredSpeech(text);
      return;
    }
    playNativeSpeech(text);
  };

  const closeAssistantSheet = () => {
    setAssistantSheetOpen(false);
  };

  const saveAssistantDraft = () => {
    if (!assistantDraft.trim()) return;
    onEditAssistant(assistantDraft);
    closeAssistantSheet();
  };
  const assistantSheet = assistantSheetOpen && typeof document !== 'undefined' ? createPortal(
    <>
      <button
        type="button"
        className="assistant-message-sheet-dismiss"
        aria-label={t('chat.messageActions.closeAssistantActions')}
        onClick={closeAssistantSheet}
      />
      <div className="assistant-message-action-sheet" role="dialog" aria-modal="true" aria-label={assistantSheetMode === 'edit' ? t('chat.messageActions.editAssistant') : t('chat.messageActions.assistantActions')}>
        <div className="assistant-message-action-handle" aria-hidden="true" />
        {assistantSheetMode === 'menu' ? (
          <div className="assistant-message-action-menu">
            {hasMemoryEvidence && memoryEvidence ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    setAssistantSheetMode('memory');
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="memoryMap" size={18} />
                <span>{t('chat.messageActions.memorySources')}</span>
              </button>
            ) : null}
            {speechCache?.assetId ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    void downloadCachedSpeech(speechCache);
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="download" size={18} />
                <span>{t('chat.messageActions.exportSpeechCache')}</span>
              </button>
            ) : null}
            {canEditAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    setAssistantDraft(messageContent);
                    setAssistantSheetMode('edit');
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="edit" size={18} />
                <span>{t('chat.messageActions.edit')}</span>
              </button>
            ) : null}
            {onSetContextStart && <button type="button" className="assistant-message-action-btn" onClick={() => { onSetContextStart(); closeAssistantSheet(); }}>
              <Icon name="chevron" size={18} /><span>{t('chat.messageActions.contextStart')}</span>
            </button>}
            {canForkAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    onForkAssistant();
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="branch" size={18} />
                <span>{t('chat.messageActions.forkFromHere')}</span>
              </button>
            ) : null}
            {canRetryAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    onRetryLatestAssistant();
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="refresh" size={18} />
                <span>{resolvedRetryAssistantLabel}</span>
              </button>
            ) : null}
          </div>
        ) : assistantSheetMode === 'memory' && memoryEvidence ? (
          <div className="assistant-message-memory">
            <div className="assistant-message-memory-title">
              <button
                type="button"
                className="assistant-message-memory-back"
                onClick={() => setAssistantSheetMode('menu')}
                aria-label={t('chat.messageActions.backToActions')}
              >
                <Icon name="chevron" size={16} />
              </button>
              <span>{t('chat.messageActions.memorySources')}</span>
            </div>
            <MessageMemoryEvidence
              evidence={memoryEvidence}
              expanded
              onToggle={() => {}}
              showTrigger={false}
            />
          </div>
        ) : (
          <div className="assistant-message-edit">
            <div className="assistant-message-edit-title">{t('chat.messageActions.editAssistant')}</div>
            <textarea
              className="assistant-message-edit-input"
              value={assistantDraft}
              onChange={(event) => setAssistantDraft(event.target.value)}
              rows={8}
              autoFocus
            />
            <div className="assistant-message-edit-actions">
              <button type="button" className="assistant-message-edit-btn secondary" onClick={() => setAssistantSheetMode('menu')}>{t('chat.messageActions.cancel')}</button>
              <button type="button" className="assistant-message-edit-btn primary" onClick={saveAssistantDraft} disabled={!assistantDraft.trim()}>{t('chat.messageActions.confirmEdit')}</button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className={`message-inline-actions ${role}`}>
      {canCopyAssistant && (
        <button type="button" className={`micro-action-btn ${copied ? 'active' : ''}`} onClick={() => { void copyMessage(); }} aria-label={copied ? t('chat.messageActions.copied') : t('chat.messageActions.copyAssistant')} title={copied ? t('chat.messageActions.copied') : t('chat.messageActions.copyAssistant')}>
          <Icon name="copy" size={14} />
        </button>
      )}
      {canSpeakAssistant ? (
        <button
          type="button"
          className={`micro-action-btn ${speaking ? 'active' : ''}`}
          onClick={(event) => {
            runSelectionAction(toggleSpeech, { element: event.currentTarget });
          }}
          aria-label={speechLoading ? t('chat.messageActions.generatingSpeech') : speaking ? t('chat.messageActions.stopReading') : t('chat.messageActions.readAssistant')}
          title={speechLoading ? t('chat.messageActions.generatingSpeech') : speaking ? t('chat.messageActions.stopReading') : t('chat.messageActions.read')}
          aria-pressed={speaking || speechLoading}
        >
          <Icon name={speaking || speechLoading ? 'pause' : 'voice'} size={14} />
        </button>
      ) : null}
      {taskReceiptAction ? (
        <button
          type="button"
          className={`micro-action-btn task-receipt ${taskReceiptAction.status} ${taskReceiptAction.expanded ? 'active' : ''}`}
          onClick={(event) => {
            runSelectionAction(taskReceiptAction.onToggle, { element: event.currentTarget });
          }}
          aria-label={taskReceiptAction.expanded ? t('chat.messageActions.collapseTask') : t('chat.messageActions.viewTask')}
          title={taskReceiptAction.expanded ? t('chat.messageActions.collapseTaskTitle') : t('chat.messageActions.viewTaskTitle')}
          aria-expanded={taskReceiptAction.expanded}
        >
          <Icon name={taskReceiptAction.status === 'completed' ? 'check' : 'task'} size={14} />
        </button>
      ) : null}
      {canOpenThinkingSummary && (
        <button
          type="button"
          className={`micro-action-btn ${isThinkingActive ? 'active' : ''}`}
          onClick={(event) => {
            runSelectionAction(onOpenThinkingSummary, { element: event.currentTarget });
          }}
          aria-label={isThinkingActive ? t('chat.messageActions.openThinkingActive') : t('chat.messageActions.openThinking')}
          title={isThinkingActive ? t('chat.messageActions.thinkingTitleActive') : t('chat.messageActions.thinkingTitle')}
        >
          <Icon name="polarisStar" size={14} color="polarisDeepSpace" />
        </button>
      )}
      {showCodeCardAction && (
        <>
          <button
            type="button"
            className={`micro-action-btn ${codeCardActionMode === 'open' ? 'active' : ''}`}
            onClick={(event) => {
              runSelectionAction(onCodeCardAction, { element: event.currentTarget });
            }}
            aria-label={codeCardActionLabel}
            title={codeCardActionLabel}
          >
            <Icon name="code" size={14} />
          </button>
          {codeCardProgressLabel && <span className="message-inline-progress">{codeCardProgressLabel}</span>}
        </>
      )}
      {hasAssistantMore ? (
        <>
          <button
            type="button"
            className={`micro-action-btn ${assistantSheetOpen ? 'active' : ''}`}
            onClick={(event) => {
              runSelectionAction(() => {
                setAssistantSheetOpen(true);
                setAssistantSheetMode('menu');
              }, { element: event.currentTarget });
            }}
            aria-label={t('chat.messageActions.moreAssistantActions')}
            title={t('chat.messageActions.more')}
            aria-expanded={assistantSheetOpen}
          >
            <Icon name="more" size={15} />
          </button>
          {assistantSheet}
        </>
      ) : null}
    </div>
  );
}
