import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment, ChatMessage } from '../../../../types/domain';
import type { ChatEditingState } from '../context/ChatUiState';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import { useI18n } from '../../../../i18n';

type MessageEditInlineProps = {
  editing: Exclude<ChatEditingState, null>;
  message: ChatMessage;
  onRemoveEditingAttachment: (attachmentId: string) => void;
  onUpdateEditingDraft: (value: string) => void;
  onCommitEdit: (message: ChatMessage, mode?: 'retry' | 'save-only') => Promise<void>;
  onCancelEdit: () => void;
};

export function MessageEditInline({
  editing,
  message,
  onRemoveEditingAttachment,
  onUpdateEditingDraft,
  onCommitEdit,
  onCancelEdit
}: MessageEditInlineProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const committingRef = useRef(false);
  const [committing, setCommitting] = useState(false);
  const commit = async (mode: 'retry' | 'save-only') => {
    if (committingRef.current) return;
    committingRef.current = true;
    setCommitting(true);
    try {
      await onCommitEdit(message, mode);
    } finally {
      committingRef.current = false;
      setCommitting(false);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    const shell = textarea?.closest('.app-shell');

    shell?.classList.add('app-shell--message-editing-text');

    return () => {
      shell?.classList.remove('app-shell--message-editing-text');
    };
  }, []);

  return (
    <div className="message-edit-panel">
      <ChatAttachmentStrip attachments={editing.attachments as ChatAttachment[]} tone="message" onRemove={committing ? undefined : onRemoveEditingAttachment} />
      <textarea
        ref={textareaRef}
        value={editing.draft}
        disabled={committing}
        onChange={(event) => onUpdateEditingDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void commit('retry');
          } else if (event.key === 'Escape' && !committingRef.current) {
            onCancelEdit();
          }
        }}
        rows={Math.max(3, editing.draft.split('\n').length)}
        className="message-edit-input"
        placeholder={t('chat.messageEdit.placeholder')}
      />
      <div className="message-edit-hint">{t('chat.messageEdit.hint')}</div>
      <div className="message-inline-actions user">
        <button type="button" className="btn-secondary compact" disabled={committing} onClick={onCancelEdit}>
          {t('chat.messageActions.cancel')}
        </button>
        <button type="button" className="btn-secondary compact" disabled={committing} onClick={() => void commit('save-only')}>
          {t('chat.messageEdit.saveOnly')}
        </button>
        <button type="button" className="btn-secondary compact active" disabled={committing} onClick={() => void commit('retry')}>
          {t('chat.messageEdit.saveAndRetry')}
        </button>
      </div>
    </div>
  );
}
