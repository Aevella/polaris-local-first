import { useEffect, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import type { ChatAttachment, ChatMessage, ToolInvocation } from '../../../../types/domain';
import { useI18n } from '../../../../i18n';
import { Icon } from '../../../Icon';
import { runSuccessAction } from '../../../haptics';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import { toolIconName } from '../chatToolIcons';
import { compactToolEventSummary, toolEventCopy, toolStatusLabel } from '../chatToolLabels';
import { MessageCodeBlockView } from './MessageCodeBlockView';
import { buildToolWriteDetailBlocks, formatLineDelta } from './toolWriteDetails';
import { isPlayableAudioAttachment } from '../../../../engines/attachmentMedia';

type MessageToolEventProps = {
  message: ChatMessage;
  onSaveImageAttachment: (message: ChatMessage, attachment: ChatAttachment) => void;
  onApplyToolPreview: (message: ChatMessage) => void;
  onSaveToolPreview: (message: ChatMessage) => void;
  onRollbackToolPreview: (message: ChatMessage) => void;
  onOpenToolbox: () => void;
  onInteractionBoundary?: () => void;
};

export function shouldAutoExpandToolEvent(tool: ToolInvocation): boolean {
  return tool.status === 'preview' || tool.status === 'failed';
}

export function buildThemeCssDetailPreview(cssText: string, lineLimit = 6) {
  const lines = cssText.trim().split('\n');
  const truncated = lines.length > lineLimit;
  return {
    preview: `${lines.slice(0, lineLimit).join('\n')}${truncated ? '\n...' : ''}`,
    truncated
  };
}

export function MessageToolEvent({
  message,
  onSaveImageAttachment,
  onApplyToolPreview,
  onSaveToolPreview,
  onRollbackToolPreview,
  onOpenToolbox,
  onInteractionBoundary
}: MessageToolEventProps) {
  const { t } = useI18n();
  const tool = message.toolInvocation;
  if (!tool) return null;

  const canApply = tool.status === 'preview';
  const canRollback = tool.status === 'preview';
  const memoryItems = tool.kind === 'writeMemory' ? tool.memoryItems ?? [] : [];
  const memoryDocTitle = tool.kind === 'writeMemoryDoc' ? tool.memoryDocTitle?.trim() : undefined;
  const memoryDocSummary = tool.kind === 'writeMemoryDoc' ? tool.memoryDocSummary?.trim() : undefined;
  const isSandboxTool = tool.kind === 'runCode';
  const themeSurfaceLabels =
    tool.kind === 'applyThemeCoordinates'
    || tool.kind === 'applySurfaceTokens'
    || tool.kind === 'patchRawCss'
    || tool.kind === 'appendThemeCss'
    || tool.kind === 'insertThemeCss'
    || tool.kind === 'deleteThemeCss'
    || tool.kind === 'applyPreset'
      ? tool.themeSurfaceLabels ?? []
      : [];
  const canSaveThemePreview = canApply && (
    tool.kind === 'applyThemeCoordinates'
    || tool.kind === 'applySurfaceTokens'
    || tool.kind === 'patchRawCss'
    || tool.kind === 'appendThemeCss'
    || tool.kind === 'insertThemeCss'
    || tool.kind === 'deleteThemeCss'
    || tool.kind === 'applyPreset'
    || tool.kind === 'editThemeCss'
    || tool.kind === 'replaceThemeCss'
  );
  const detailCopy = toolEventCopy(tool, t);
  const writeDetails = buildToolWriteDetailBlocks(tool);
  const hasWriteDetails = writeDetails.length > 0;
  const isThemeCssDetail = (
    tool.kind === 'patchRawCss'
    || tool.kind === 'appendThemeCss'
    || tool.kind === 'insertThemeCss'
    || tool.kind === 'deleteThemeCss'
  ) && Boolean(tool.detailText?.trim());
  const compactSummary = compactToolEventSummary(tool, t);
  const expandedSummary =
    isSandboxTool && tool.status === 'running'
      ? t('chat.toolEvent.sandboxRunningSummary')
      : tool.summary;
  const expandedTitle =
    tool.status === 'executed' && compactSummary.trim()
      ? compactSummary
      : isSandboxTool
        ? t('chat.toolEvent.sandboxTitle')
        : tool.title;
  const [expanded, setExpanded] = useState(() => shouldAutoExpandToolEvent(tool));
  const [appearing, setAppearing] = useState(true);
  const [detailCopied, setDetailCopied] = useState(false);
  const [copiedWriteDetailKey, setCopiedWriteDetailKey] = useState<string | null>(null);

  const normalizeCopy = (value: string) => value.replace(/\s+/g, ' ').trim();
  const navigationOnlyCopy = [
    t('chat.toolEvent.navigation.workspace'),
    t('chat.toolEvent.navigation.room')
  ].includes(normalizeCopy(detailCopy));
  const shouldShowDetail =
    Boolean(detailCopy.trim())
    && !navigationOnlyCopy
    && !hasWriteDetails
    && normalizeCopy(detailCopy) !== normalizeCopy(expandedSummary);
  const canCopyDetail =
    Boolean(detailCopy.trim())
    && !navigationOnlyCopy
    && !hasWriteDetails
    && isThemeCssDetail;
  const shouldShowExpandedSummary =
    Boolean(expandedSummary.trim())
    && normalizeCopy(expandedSummary) !== normalizeCopy(expandedTitle);
  const canOpenToolbox = tool.status === 'failed' && /当前没有“[^”]+”能力。/.test(detailCopy);
  // 图片和音频成果交给回执下方的富媒体成品卡，回执里只留普通文件附件
  const fileAttachments = (message.attachments ?? []).filter(
    (attachment) => attachment.kind !== 'image' && !isPlayableAudioAttachment(attachment)
  );
  const hasExpandedBody =
    themeSurfaceLabels.length > 0
    || hasWriteDetails
    || shouldShowDetail
    || memoryItems.length > 0
    || Boolean(memoryDocTitle || memoryDocSummary)
    || fileAttachments.length > 0;
  const hasExpandedActions = canApply || canRollback || canCopyDetail || canOpenToolbox;

  const copyToolDetail = async () => {
    const payload = detailCopy;
    if (!payload.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(payload));
    setDetailCopied(true);
    window.setTimeout(() => {
      setDetailCopied(false);
    }, 1400);
  };

  const copyWriteDetail = async (index: number, code: string) => {
    if (!code.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(code));
    const key = `${tool.id}-${index}`;
    setCopiedWriteDetailKey(key);
    window.setTimeout(() => {
      setCopiedWriteDetailKey((current) => (current === key ? null : current));
    }, 1400);
  };

  const markInteractionBoundary = () => {
    onInteractionBoundary?.();
  };

  const containPointerInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    markInteractionBoundary();
  };

  const containClickInteraction = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  useEffect(() => {
    setExpanded(shouldAutoExpandToolEvent(tool));
  }, [tool.id, tool.kind, tool.status]);

  useEffect(() => {
    setAppearing(true);
    const frameId = window.requestAnimationFrame(() => {
      setAppearing(false);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [tool.id]);

  return (
    <div
      className={`tool-event ${tool.status} ${expanded ? 'expanded' : 'collapsed'} ${isSandboxTool ? 'tool-event--sandbox' : ''} ${appearing ? 'appearing' : ''}`}
      onPointerDownCapture={containPointerInteraction}
      onClick={containClickInteraction}
    >
      <div className="tool-event-compact">
        <div className={`tool-event-icon ${tool.status}`}>
          <Icon name={toolIconName(tool)} size={15} />
        </div>
        <div className="tool-event-compact-copy">
          {expanded ? (
            <>
              <div className="tool-event-title-row">
                <strong>{expandedTitle}</strong>
                <span className={`tool-event-status ${tool.status}`}>{toolStatusLabel(tool.status, t)}</span>
              </div>
              {shouldShowExpandedSummary ? <div className="tool-event-summary">{expandedSummary}</div> : null}
            </>
          ) : (
            <div className="tool-event-summary tool-event-summary-inline">
              {tool.status === 'running' ? (
                <span className="tool-event-live-summary">
                  <span>{compactSummary}</span>
                  <span className="tool-event-live-dots" aria-hidden="true"><span /><span /><span /></span>
                </span>
              ) : (
                compactSummary
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="tool-event-toggle"
          aria-label={expanded ? t('chat.toolEvent.collapseAria') : t('chat.toolEvent.expandAria')}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          <Icon name={expanded ? 'chevronDown' : 'chevron'} size={15} />
        </button>
      </div>

      {expanded ? (
        <>
          {hasExpandedBody ? (
            <div className="tool-event-expanded">
              <div className="tool-event-copy">
                {themeSurfaceLabels.length > 0 ? (
                  <div className="tool-event-surface-summary">
                    <span className="tool-event-surface-label">{t('chat.toolEvent.surfaceHit')}</span>
                    <div className="tool-event-chip-row">
                      {themeSurfaceLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {hasWriteDetails ? (
                  <div className="tool-event-write-detail">
                    <div className="tool-event-write-rows">
                      {writeDetails.map((detail, index) => (
                        <div key={`${tool.id}-write-row-${index}`} className="tool-event-write-row">
                          <span className="tool-event-write-label">{detail.label}</span>
                          <span className="tool-event-write-delta">
                            <span className="added">+{detail.addedLines}</span>
                            <span className="removed">-{detail.removedLines}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="message-code-sandbox-band tool-event-write-sandbox-band" aria-label={t('chat.toolEvent.writeBandAria')}>
                      <div className="message-code-sandbox-scroll">
                        {writeDetails.map((detail, index) => {
                          const key = `${tool.id}-${index}`;
                          return (
                            <section key={`${tool.id}-write-detail-${index}`} className="message-code-sandbox-block">
                              <div className="message-code-sandbox-block-head">
                                <div className="message-code-sandbox-block-copy">
                                  <span>{detail.language ?? 'code'} · {formatLineDelta(detail)}</span>
                                  <strong>{detail.label}</strong>
                                </div>
                                <div className="message-code-sandbox-block-actions">
                                  <button
                                    type="button"
                                    className={`message-code-card-copy ${copiedWriteDetailKey === key ? 'copied' : ''}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void copyWriteDetail(index, detail.code);
                                    }}
                                    aria-label={copiedWriteDetailKey === key ? t('chat.toolEvent.codeCopied') : t('chat.toolEvent.copyCode')}
                                    title={copiedWriteDetailKey === key ? t('chat.toolEvent.codeCopied') : t('chat.toolEvent.copyCode')}
                                  >
                                    <Icon name="copy" size={13} />
                                  </button>
                                </div>
                              </div>
                              <MessageCodeBlockView
                                code={detail.code}
                                language={detail.language}
                                className="message-code-sandbox-pre"
                              />
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
                {shouldShowDetail ? (
                  isThemeCssDetail ? (
                    <div className="tool-event-css-detail">
                      <span>{t('chat.toolEvent.cssPreview')}</span>
                      <pre>{buildThemeCssDetailPreview(detailCopy).preview}</pre>
                    </div>
                  ) : (
                    <div className="tool-event-detail">{detailCopy}</div>
                  )
                ) : null}
                {memoryItems.length > 0 ? (
                  <div className="tool-event-memory-list">
                    {memoryItems.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                ) : null}
                {(memoryDocTitle || memoryDocSummary) && !shouldShowDetail ? (
                  <div className="tool-event-memory-list">
                    {memoryDocTitle ? <span>{memoryDocTitle}</span> : null}
                    {memoryDocSummary ? <span>{memoryDocSummary}</span> : null}
                  </div>
                ) : null}
                <ChatAttachmentStrip
                  attachments={fileAttachments}
                  tone="message"
                  onSaveImage={(attachment) => onSaveImageAttachment(message, attachment)}
                />
              </div>
            </div>
          ) : null}

          {hasExpandedActions ? (
            <div className="tool-event-actions">
              {canCopyDetail ? (
                <button
                  type="button"
                  className={`tool-btn compact ${detailCopied ? 'primary' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyToolDetail();
                  }}
                >
                  {detailCopied ? t('chat.toolEvent.cssCopied') : t('chat.toolEvent.copyCss')}
                </button>
              ) : null}
              {canApply ? (
                <button
                  type="button"
                  className="tool-btn compact primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onApplyToolPreview(message);
                  }}
                >
                  {t('chat.toolEvent.apply')}
                </button>
              ) : null}
              {canSaveThemePreview ? (
                <button
                  type="button"
                  className="tool-btn compact"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSaveToolPreview(message);
                  }}
                >
                  {t('chat.toolEvent.saveTheme')}
                </button>
              ) : null}
              {canRollback ? (
                <button
                  type="button"
                  className="tool-btn compact"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRollbackToolPreview(message);
                  }}
                >
                  {t('chat.toolEvent.cancel')}
                </button>
              ) : null}
              {canOpenToolbox ? (
                <button
                  type="button"
                  className="tool-btn compact primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenToolbox();
                  }}
                >
                  {t('chat.toolEvent.openToolbox')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
