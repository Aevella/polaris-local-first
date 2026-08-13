import { useEffect, useRef } from 'react';
import type { ChatAttachment, ChatMessage } from '../../../../types/domain';
import type { ChatEditingState } from '../context/ChatUiState';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import { useI18n } from '../../../../i18n';

type MessageEditInlineProps = {
  editing: Exclude<ChatEditingState, null>;
  message: ChatMessage;
  onRemoveEditingAttachment: (attachmentId: string) => void;
  onUpdateEditingDraft: (value: string) => void;
  onCommitEdit: (message: ChatMessage) => Promise<void>;
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
      <ChatAttachmentStrip attachments={editing.attachments as ChatAttachment[]} tone="message" onRemove={onRemoveEditingAttachment} />
      <textarea
        ref={textareaRef}
        value={editing.draft}
        onChange={(event) => onUpdateEditingDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            void onCommitEdit(message);
          } else if (event.key === 'Escape') {
            onCancelEdit();
          }
        }}
        rows={Math.max(3, editing.draft.split('\n').length)}
        className="message-edit-input"
        placeholder={t('chat.messageEdit.placeholder')}
      />
      <div className="message-edit-hint">{t('chat.messageEdit.hint')}</div>
      <div className="message-inline-actions user">
        <button type="button" className="btn-secondary compact" onClick={onCancelEdit}>
          {t('chat.messageActions.cancel')}
        </button>
        <button type="button" className="btn-secondary compact active" onClick={() => void onCommitEdit(message)}>
          {t('chat.messageEdit.saveAndRetry')}
        </button>
      </div>
    </div>
  );
}
