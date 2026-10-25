import { Capacitor } from '@capacitor/core';
import { formatAttachmentSize } from '../../../engines/attachmentFormat';
import type { ChatAttachment } from '../../../types/domain';
import { useAssetObjectUrl } from '../../useAssetObjectUrl';
import { useI18n, type I18nTranslator } from '../../../i18n';
import { downloadChatAttachment, useNearViewportAssetLoading } from '../../media/chatAttachmentMedia';

type ChatAttachmentStripProps = {
  attachments: ChatAttachment[] | undefined;
  tone: 'pending' | 'message';
  onRemove?: (attachmentId: string) => void;
  onSaveImage?: (attachment: ChatAttachment) => void;
};

type AttachmentChipProps = {
  attachment: ChatAttachment;
  tone: 'pending' | 'message';
  onRemove?: (attachmentId: string) => void;
  onSaveImage?: (attachment: ChatAttachment) => void;
};

const FILE_PREVIEW_MAX_CHARS = 180;

export function canOpenImagePreviewLink() {
  return !Capacitor.isNativePlatform();
}

function resolveFileSecondaryText(attachment: ChatAttachment, t: I18nTranslator['t']) {
  const sizeLabel = formatAttachmentSize(attachment.size);
  if (attachment.clearedAt) return t('chat.attachment.cleared', { size: sizeLabel });
  const previewSource = attachment.textContent?.slice(0, FILE_PREVIEW_MAX_CHARS);
  const previewText = previewSource?.replace(/\s+/g, ' ').trim();
  if (!previewText) return sizeLabel;
  return `${sizeLabel} · ${previewText}${attachment.textContent && attachment.textContent.length > FILE_PREVIEW_MAX_CHARS ? '...' : ''}`;
}

function AttachmentChip({
  attachment,
  tone,
  onRemove,
  onSaveImage
}: AttachmentChipProps) {
  const { t } = useI18n();
  const { ref, shouldLoad } = useNearViewportAssetLoading();
  const imageAssetId = attachment.kind === 'image' && shouldLoad && !attachment.clearedAt ? attachment.assetId : undefined;
  const assetUrl = useAssetObjectUrl(imageAssetId, true);
  const imageSecondaryText = attachment.clearedAt
    ? t('chat.attachment.cleared', { size: formatAttachmentSize(attachment.size) })
    : formatAttachmentSize(attachment.size);
  const canOpenImagePreview = canOpenImagePreviewLink();

  const renderFileChip = (
    <>
      <div className="attachment-file-icon">{attachment.mimeType.includes('zip') ? 'ZIP' : t('chat.attachment.documentIcon')}</div>
      <div className="attachment-copy">
        <strong>{attachment.name}</strong>
        <span>{resolveFileSecondaryText(attachment, t)}</span>
      </div>
    </>
  );
  const renderImagePlaceholder = (
    <>
      <div className="attachment-file-icon">{t('chat.attachment.imageIcon')}</div>
      <div className="attachment-copy">
        <strong>{tone === 'message' ? t('chat.attachment.image') : attachment.name}</strong>
        <span>{imageSecondaryText}</span>
      </div>
    </>
  );

  return (
    <div ref={ref} key={attachment.id} className={`attachment-chip ${attachment.kind} ${tone}${attachment.clearedAt ? ' cleared' : ''}`}>
      {attachment.kind === 'image' && assetUrl ? (
        canOpenImagePreview ? (
          <a
            href={assetUrl}
            target="_blank"
            rel="noreferrer"
            className="attachment-preview-link"
            aria-label={t('chat.attachment.openAria', { name: attachment.name })}
            title={attachment.name}
          >
            <img src={assetUrl} alt={attachment.name} className="attachment-thumb" />
            <div className="attachment-copy">
              <strong>{tone === 'message' ? t('chat.attachment.image') : attachment.name}</strong>
              <span>{imageSecondaryText}</span>
            </div>
          </a>
        ) : (
          <div className="attachment-preview-link attachment-preview-static" title={attachment.name}>
            <img src={assetUrl} alt={attachment.name} className="attachment-thumb" />
            <div className="attachment-copy">
              <strong>{tone === 'message' ? t('chat.attachment.image') : attachment.name}</strong>
              <span>{imageSecondaryText}</span>
            </div>
          </div>
        )
      ) : attachment.kind === 'image' ? (
        renderImagePlaceholder
      ) : attachment.assetId && !attachment.clearedAt ? (
        <button
          type="button"
          className="attachment-preview-link"
          aria-label={t('chat.attachment.downloadAria', { name: attachment.name })}
          title={attachment.name}
          onClick={() => { void downloadChatAttachment(attachment); }}
        >
          {renderFileChip}
        </button>
      ) : (
        renderFileChip
      )}
      {onRemove && (
        <button
          type="button"
          className="attachment-remove-btn"
          onClick={() => onRemove(attachment.id)}
          aria-label={t('chat.attachment.removeAria', { name: attachment.name })}
        >
          ✕
        </button>
      )}
      {!onRemove && onSaveImage && attachment.kind === 'image' && !attachment.clearedAt ? (
        <button
          type="button"
          className="attachment-save-btn"
          onClick={() => onSaveImage(attachment)}
          aria-label={t('chat.attachment.saveAria', { name: attachment.name })}
        >
          {t('chat.attachment.save')}
        </button>
      ) : null}
    </div>
  );
}

export function ChatAttachmentStrip({
  attachments,
  tone,
  onRemove,
  onSaveImage
}: ChatAttachmentStripProps) {
  if (!attachments?.length) return null;

  return (
    <div className={`attachment-strip ${tone}`}>
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          tone={tone}
          onRemove={onRemove}
          onSaveImage={onSaveImage}
        />
      ))}
    </div>
  );
}
