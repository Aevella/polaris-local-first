import { useEffect, useState } from 'react';
import { formatAttachmentSize } from '../../engines/attachmentFormat';
import { isPlayableAudioAttachment } from '../../engines/attachmentMedia';
import type { ChatAttachment } from '../../types/domain';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import { useAssetObjectUrl } from '../useAssetObjectUrl';
import { downloadChatAttachment, useNearViewportAssetLoading } from './chatAttachmentMedia';

type MessageAudioAttachmentsProps = {
  attachments: ChatAttachment[];
};

type MessageAudioCardSurfaceProps = {
  attachment: ChatAttachment;
  assetUrl: string | null;
  loading: boolean;
  playbackFailed: boolean;
  onPlaybackError: () => void;
  onDownload?: () => void;
};

export function MessageAudioCardSurface({
  attachment,
  assetUrl,
  loading,
  playbackFailed,
  onPlaybackError,
  onDownload
}: MessageAudioCardSurfaceProps) {
  const { t } = useI18n();
  const cleared = Boolean(attachment.clearedAt);
  const sizeLabel = formatAttachmentSize(attachment.size);

  return (
    <figure className={`message-audio-card${cleared ? ' is-cleared' : ''}${playbackFailed ? ' is-failed' : ''}`}>
      <div className="message-audio-head">
        <span className="message-audio-icon" aria-hidden="true">
          <Icon name="voice" size={17} />
        </span>
        <span className="message-audio-title">
          <strong title={attachment.name}>{attachment.name}</strong>
          <span>{cleared ? t('chat.attachment.cleared', { size: sizeLabel }) : `${t('chat.audio.label')} · ${sizeLabel}`}</span>
        </span>
        {!cleared && onDownload ? (
          <button
            type="button"
            className="message-audio-download"
            onClick={onDownload}
            aria-label={t('chat.attachment.downloadAria', { name: attachment.name })}
            title={t('chat.attachment.downloadAria', { name: attachment.name })}
          >
            <Icon name="download" size={15} />
          </button>
        ) : null}
      </div>

      {cleared ? (
        <div className="message-audio-unavailable">{t('chat.audio.cleared')}</div>
      ) : playbackFailed ? (
        <div className="message-audio-unavailable">{t('chat.audio.playbackFailed')}</div>
      ) : assetUrl ? (
        <audio
          className="message-audio-player"
          controls
          controlsList="nodownload"
          preload="metadata"
          src={assetUrl}
          aria-label={t('chat.audio.playAria', { name: attachment.name })}
          onError={onPlaybackError}
        />
      ) : loading ? (
        <div className="message-audio-loading" aria-label={t('chat.audio.loading')}>
          <span /><span /><span /><span /><span />
        </div>
      ) : (
        <div className="message-audio-unavailable">{t('chat.audio.playbackFailed')}</div>
      )}
    </figure>
  );
}

function MessageAudioCard({ attachment }: { attachment: ChatAttachment }) {
  const { ref, shouldLoad } = useNearViewportAssetLoading();
  const cleared = Boolean(attachment.clearedAt);
  const assetUrl = useAssetObjectUrl(shouldLoad && !cleared ? attachment.assetId : undefined);
  const [playbackFailed, setPlaybackFailed] = useState(false);

  useEffect(() => {
    setPlaybackFailed(false);
  }, [assetUrl]);

  return (
    <div ref={ref}>
      <MessageAudioCardSurface
        attachment={attachment}
        assetUrl={assetUrl}
        loading={!assetUrl}
        playbackFailed={playbackFailed}
        onPlaybackError={() => setPlaybackFailed(true)}
        onDownload={cleared ? undefined : () => { void downloadChatAttachment(attachment); }}
      />
    </div>
  );
}

export function MessageAudioAttachments({ attachments }: MessageAudioAttachmentsProps) {
  const audioAttachments = attachments.filter(isPlayableAudioAttachment);
  if (audioAttachments.length === 0) return null;

  return (
    <div className="message-audio-stack">
      {audioAttachments.map((attachment) => (
        <MessageAudioCard key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}
