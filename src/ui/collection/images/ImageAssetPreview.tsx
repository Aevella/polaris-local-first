import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { publishImageAssetShare } from '../../../app/collection/imageAssetShare';
import { isGenericImageTitle } from '../../../engines/imageAssetNaming';
import { useI18n, type I18nTranslator } from '../../../i18n';
import { writeTextToClipboard } from '../../../infrastructure/clipboard';
import type { ImageAssetCard } from '../../../types/domain';
import { runSuccessAction, triggerSuccessActionHaptic } from '../../haptics';
import { Icon } from '../../Icon';
import { useAssetMeta, useAssetObjectUrl } from '../../useAssetObjectUrl';
import { scanQrCodeFromImage, type QrCodeScanResult } from './scanQrCodeFromImage';

type ImageAssetPreviewProps = {
  cards: ImageAssetCard[];
  activeIndex: number;
  onChangeCard: (nextIndex: number) => void;
  onClose: () => void;
  onSharePublished: (cardId: string, patch: Pick<ImageAssetCard, 'publicShareId' | 'publicShareUrl' | 'publicSharedAt'>) => void;
};

const PREVIEW_CLOSE_MS = 220;
const SWIPE_THRESHOLD = 56;
const SWIPE_THRESHOLD_RATIO = 0.16;
const QR_LONG_PRESS_MS = 720;
const QR_LONG_PRESS_MOVE_THRESHOLD = 14;
const DRAG_START_THRESHOLD = 10;
const EDGE_DRAG_DAMPING = 0.28;

type Translate = I18nTranslator['t'];

type QrRecognitionState =
  | { status: 'idle' }
  | ({ status: 'success'; copied: boolean } & QrCodeScanResult)
  | { status: 'scanning' };

type PreviewPointerState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  dragging: boolean;
};

function PreviewSlide({
  card,
  slideStyle,
  fallbackImageLabel
}: {
  card: ImageAssetCard | null;
  slideStyle: CSSProperties;
  fallbackImageLabel: string;
}) {
  const imageUrl = useAssetObjectUrl(card?.assetId);
  const assetMeta = useAssetMeta(card?.assetId);
  const label = card?.title || assetMeta?.name || fallbackImageLabel;

  return (
    <div
      className={`asset-preview-slide ${card ? 'has-image' : 'placeholder'}`}
      style={slideStyle}
      aria-hidden={card ? undefined : true}
    >
      {card && imageUrl ? (
        <img
          src={imageUrl}
          alt={label}
          className="asset-preview-image"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        />
      ) : null}
    </div>
  );
}

function buildAssetReference(assetId: string) {
  return `polaris-asset://${assetId}`;
}

function buildPublicAssetShareText(card: ImageAssetCard, publicUrl: string, t: Translate) {
  const shareName = resolvePublicAssetShareName(card, t);
  const sourceLabel = t('collection.image.previewShareSourceLabel');
  return [
    t('collection.image.previewShareTitle'),
    t('collection.image.previewShareSource', { source: sourceLabel }),
    shareName ? t('collection.image.previewShareName', { name: shareName }) : null,
    t('collection.image.previewShareLink', { url: publicUrl })
  ].filter(Boolean).join('\n');
}

function formatShortAssetId(assetId: string) {
  return assetId.replace(/^asset-/, '').slice(0, 8) || assetId.slice(0, 8);
}

function resolvePublicAssetShareName(card: ImageAssetCard, t: Translate) {
  const title = card.title.trim();
  if (title && !isGenericImageTitle(title)) return title;
  return t('collection.image.previewShareFallbackName', { assetId: formatShortAssetId(card.assetId) });
}

async function copyTextToClipboard(text: string) {
  await writeTextToClipboard(text);
}

export function ImageAssetPreview({
  cards,
  activeIndex,
  onChangeCard,
  onClose,
  onSharePublished
}: ImageAssetPreviewProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>('opening');
  const [displayIndex, setDisplayIndex] = useState(activeIndex);
  const [trackOffsetPx, setTrackOffsetPx] = useState(0);
  const [trackAnimating, setTrackAnimating] = useState(false);
  const [qrRecognition, setQrRecognition] = useState<QrRecognitionState>({ status: 'idle' });
  const [assetReferenceCopied, setAssetReferenceCopied] = useState(false);
  const [assetShareCopied, setAssetShareCopied] = useState(false);
  const [assetShareStatus, setAssetShareStatus] = useState<'idle' | 'publishing' | 'copyReady' | 'copying' | 'error'>('idle');
  const stageRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressCloseRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);
  const qrScanNonceRef = useRef(0);
  const pointerStateRef = useRef<PreviewPointerState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    dragging: false
  });

  const displayCard = cards[displayIndex];
  const displayImageUrl = useAssetObjectUrl(displayCard?.assetId);
  const panelOpen = qrRecognition.status === 'success';
  const fallbackImageLabel = t('collection.image.fallbackImage');

  useEffect(() => {
    setAssetReferenceCopied(false);
    setAssetShareCopied(false);
    setAssetShareStatus('idle');
  }, [displayCard.assetId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      setPhase('open');
    });
    return () => {
      window.cancelAnimationFrame(frame);
      body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (trackAnimating || pointerStateRef.current.dragging) return;
    if (activeIndex === displayIndex) return;
    setDisplayIndex(activeIndex);
    setTrackOffsetPx(0);
  }, [activeIndex, displayIndex, trackAnimating]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (panelOpen) {
          dismissQrPanel();
          return;
        }
        requestClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        settleToIndex(displayIndex - 1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        settleToIndex(displayIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [displayIndex, panelOpen]);

  useEffect(() => {
    setQrRecognition({ status: 'idle' });
    setAssetReferenceCopied(false);
    longPressTriggeredRef.current = false;
    qrScanNonceRef.current += 1;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, [displayCard?.id]);

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }
  }, []);

  if (typeof document === 'undefined' || !displayCard) return null;

  const requestClose = () => {
    if (phase === 'closing') return;
    setPhase('closing');
    window.setTimeout(() => {
      onClose();
    }, PREVIEW_CLOSE_MS);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const getStageWidth = () => {
    const measuredWidth = stageRef.current?.clientWidth ?? 0;
    if (measuredWidth > 0) return measuredWidth;
    if (typeof window !== 'undefined' && window.innerWidth > 0) return window.innerWidth;
    return 390;
  };

  const resetPointerState = () => {
    pointerStateRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0,
      dragging: false
    };
  };

  const dismissQrPanel = () => {
    setQrRecognition({ status: 'idle' });
  };

  const recognizeQrCodeSilently = async () => {
    if (!displayImageUrl) return;
    suppressCloseRef.current = true;
    clearLongPressTimer();
    longPressTriggeredRef.current = true;
    setQrRecognition({ status: 'scanning' });
    const nonce = qrScanNonceRef.current + 1;
    qrScanNonceRef.current = nonce;

    try {
      const result = await scanQrCodeFromImage(displayImageUrl, {
        loadFailed: t('collection.image.qrLoadFailed'),
        unsupportedEnvironment: t('collection.image.qrUnsupportedEnvironment'),
        invalidSize: t('collection.image.qrInvalidSize'),
        unsupportedDevice: t('collection.image.qrUnsupportedDevice'),
        notFound: t('collection.image.qrNotFound')
      });
      if (qrScanNonceRef.current !== nonce) return;
      setQrRecognition({
        status: 'success',
        copied: false,
        ...result
      });
      triggerSuccessActionHaptic();
    } catch {
      if (qrScanNonceRef.current !== nonce) return;
      setQrRecognition({ status: 'idle' });
    }
  };

  const copyQrText = async () => {
    if (qrRecognition.status !== 'success') return;
    try {
      await runSuccessAction(() => copyTextToClipboard(qrRecognition.text));
      setQrRecognition({ ...qrRecognition, copied: true });
    } catch {
      setQrRecognition({ ...qrRecognition, copied: false });
    }
  };

  const openQrUrl = () => {
    if (qrRecognition.status !== 'success' || !qrRecognition.openUrl) return;
    window.open(qrRecognition.openUrl, '_blank', 'noopener,noreferrer');
  };

  const assetReference = buildAssetReference(displayCard.assetId);
  const assetShortId = formatShortAssetId(displayCard.assetId);

  const copyAssetReference = async () => {
    try {
      await runSuccessAction(() => copyTextToClipboard(assetReference));
      setAssetReferenceCopied(true);
      setAssetShareCopied(false);
    } catch {
      setAssetReferenceCopied(false);
    }
  };

  const copyAssetShareReference = async () => {
    let publishedUrl = displayCard.publicShareUrl;

    try {
      setAssetShareCopied(false);
      setAssetShareStatus(displayCard.publicShareUrl ? 'copying' : 'publishing');
      const published = displayCard.publicShareUrl
        ? {
            shareId: displayCard.publicShareId ?? '',
            url: displayCard.publicShareUrl
          }
        : await publishImageAssetShare(displayCard);
      publishedUrl = published.url;
      if (!displayCard.publicShareUrl) {
        onSharePublished(displayCard.id, {
          publicShareId: published.shareId,
          publicShareUrl: published.url,
          publicSharedAt: Date.now()
        });
      }
      await runSuccessAction(() => copyTextToClipboard(buildPublicAssetShareText(displayCard, published.url, t)));
      setAssetShareCopied(true);
      setAssetReferenceCopied(false);
      setAssetShareStatus('idle');
    } catch {
      setAssetShareCopied(false);
      setAssetShareStatus(publishedUrl ? 'copyReady' : 'error');
    }
  };

  const assetShareButtonLabel = assetShareStatus === 'publishing'
    ? t('collection.image.previewShareGenerating')
    : assetShareStatus === 'copying'
      ? t('collection.image.previewShareCopying')
    : assetShareCopied
      ? t('collection.image.previewCopied')
      : assetShareStatus === 'copyReady'
        ? t('collection.image.previewShareCopyLink')
        : assetShareStatus === 'error'
        ? t('collection.image.previewShareRetry')
        : t('collection.image.previewShareOut');

  const stopUtilityPanelPointer = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const settleToIndex = (nextIndex: number) => {
    if (trackAnimating) return;
    if (nextIndex < 0 || nextIndex >= cards.length || nextIndex === displayIndex) return;
    suppressCloseRef.current = true;
    setQrRecognition({ status: 'idle' });
    const stageWidth = getStageWidth();
    pendingIndexRef.current = nextIndex;
    setTrackAnimating(true);
    setTrackOffsetPx(nextIndex > displayIndex ? -stageWidth : stageWidth);
  };

  const handleStageClick = () => {
    if (suppressCloseRef.current) {
      suppressCloseRef.current = false;
      return;
    }
    if (panelOpen) {
      dismissQrPanel();
      return;
    }
    requestClose();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (trackAnimating) return;
    pointerStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      deltaY: 0,
      dragging: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (event.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      void recognizeQrCodeSilently();
    }, QR_LONG_PRESS_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerState = pointerStateRef.current;
    if (pointerState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - pointerState.startX;
    const deltaY = event.clientY - pointerState.startY;
    pointerState.deltaX = deltaX;
    pointerState.deltaY = deltaY;

    if (Math.abs(deltaX) > QR_LONG_PRESS_MOVE_THRESHOLD || Math.abs(deltaY) > QR_LONG_PRESS_MOVE_THRESHOLD) {
      clearLongPressTimer();
    }

    if (!pointerState.dragging) {
      if (Math.abs(deltaX) < DRAG_START_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      pointerState.dragging = true;
      suppressCloseRef.current = true;
      setQrRecognition({ status: 'idle' });
      setTrackAnimating(false);
    }

    event.preventDefault();
    const canMovePrev = displayIndex > 0;
    const canMoveNext = displayIndex < cards.length - 1;
    let nextOffset = deltaX;
    if ((deltaX > 0 && !canMovePrev) || (deltaX < 0 && !canMoveNext)) {
      nextOffset *= EDGE_DRAG_DAMPING;
    }
    setTrackOffsetPx(nextOffset);
  };

  const handlePointerRelease = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerState = pointerStateRef.current;
    if (pointerState.pointerId !== event.pointerId) return;
    clearLongPressTimer();

    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      resetPointerState();
      suppressCloseRef.current = true;
      return;
    }

    if (!pointerState.dragging) {
      resetPointerState();
      return;
    }

    event.preventDefault();
    suppressCloseRef.current = true;

    const stageWidth = getStageWidth();
    const commitThreshold = Math.max(SWIPE_THRESHOLD, stageWidth * SWIPE_THRESHOLD_RATIO);
    const deltaX = pointerState.deltaX;
    const canMovePrev = displayIndex > 0;
    const canMoveNext = displayIndex < cards.length - 1;

    let nextIndex = displayIndex;
    let targetOffset = 0;
    if (Math.abs(deltaX) >= commitThreshold) {
      if (deltaX < 0 && canMoveNext) {
        nextIndex = displayIndex + 1;
        targetOffset = -stageWidth;
      } else if (deltaX > 0 && canMovePrev) {
        nextIndex = displayIndex - 1;
        targetOffset = stageWidth;
      }
    }

    pendingIndexRef.current = nextIndex !== displayIndex ? nextIndex : null;
    setTrackAnimating(true);
    setTrackOffsetPx(targetOffset);
    resetPointerState();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStateRef.current.pointerId !== event.pointerId) return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    if (pointerStateRef.current.dragging) {
      suppressCloseRef.current = true;
      pendingIndexRef.current = null;
      setTrackAnimating(true);
      setTrackOffsetPx(0);
    }
    resetPointerState();
  };

  const previousCard = displayIndex > 0 ? cards[displayIndex - 1] ?? null : null;
  const nextCard = displayIndex < cards.length - 1 ? cards[displayIndex + 1] ?? null : null;
  const stageClassName = [
    'asset-preview-stage',
    trackAnimating ? 'is-animating' : '',
    pointerStateRef.current.dragging ? 'is-dragging' : '',
    panelOpen ? 'has-utility-panel' : ''
  ].filter(Boolean).join(' ');

  const buildSlideStyle = (slot: -1 | 0 | 1): CSSProperties => ({
    transform: `translate3d(calc(${slot * 100}% + ${trackOffsetPx}px), 0, 0)`
  });

  return createPortal(
    <div
      className={`asset-preview-overlay ${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('collection.image.previewDialogAria')}
      onClick={handleStageClick}
    >
      <div
        ref={stageRef}
        className={stageClassName}
        onClick={(event) => {
          event.stopPropagation();
          handleStageClick();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.closest('.asset-preview-image')) {
            clearLongPressTimer();
            longPressTriggeredRef.current = false;
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
        onTransitionEnd={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !target.classList.contains('asset-preview-slide')) return;
          if (!trackAnimating) return;
          const nextIndex = pendingIndexRef.current;
          pendingIndexRef.current = null;
          setTrackAnimating(false);
          if (nextIndex === null) {
            setTrackOffsetPx(0);
            return;
          }
          setDisplayIndex(nextIndex);
          setTrackOffsetPx(0);
          onChangeCard(nextIndex);
        }}
      >
        <PreviewSlide
          key={previousCard?.id ?? `preview-empty-previous-${displayIndex}`}
          card={previousCard}
          slideStyle={buildSlideStyle(-1)}
          fallbackImageLabel={fallbackImageLabel}
        />
        <PreviewSlide
          key={displayCard.id}
          card={displayCard}
          slideStyle={buildSlideStyle(0)}
          fallbackImageLabel={fallbackImageLabel}
        />
        <PreviewSlide
          key={nextCard?.id ?? `preview-empty-next-${displayIndex}`}
          card={nextCard}
          slideStyle={buildSlideStyle(1)}
          fallbackImageLabel={fallbackImageLabel}
        />
        <div
          className="asset-preview-reference-panel"
          onPointerDown={stopUtilityPanelPointer}
          onPointerMove={stopUtilityPanelPointer}
          onPointerUp={stopUtilityPanelPointer}
          onPointerCancel={stopUtilityPanelPointer}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <span className="asset-preview-reference-kicker">
            {t('collection.image.previewReferenceKicker', { assetId: assetShortId })}
          </span>
          <code title={assetReference}>{assetReference}</code>
          <div className="asset-preview-reference-actions">
            <button
              type="button"
              className={`asset-preview-reference-copy ${assetReferenceCopied ? 'is-copied' : ''}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void copyAssetReference();
              }}
              aria-label={t('collection.image.previewCopyInternalAria')}
            >
              <Icon name={assetReferenceCopied ? 'check' : 'copy'} size={13} />
              <span>{assetReferenceCopied ? t('collection.image.previewCopied') : t('collection.image.previewCopy')}</span>
            </button>
            <button
              type="button"
              className={`asset-preview-reference-copy ${assetShareCopied ? 'is-copied' : ''}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void copyAssetShareReference();
              }}
              disabled={assetShareStatus === 'publishing' || assetShareStatus === 'copying'}
              aria-label={t('collection.image.previewCopyShareAria')}
            >
              <Icon
                name={assetShareCopied ? 'check' : assetShareStatus === 'publishing' || assetShareStatus === 'copying' ? 'refresh' : 'send'}
                size={13}
              />
              <span>{assetShareButtonLabel}</span>
            </button>
          </div>
        </div>
        {qrRecognition.status === 'success' ? (
          <div
            className="asset-preview-action-sheet"
            onPointerDown={stopUtilityPanelPointer}
            onPointerMove={stopUtilityPanelPointer}
            onPointerUp={stopUtilityPanelPointer}
            onPointerCancel={stopUtilityPanelPointer}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <strong>{t('collection.image.previewQrTitle')}</strong>
            <div className="asset-preview-qr-result success">
              <p>{qrRecognition.text}</p>
              <div className="asset-preview-qr-actions">
                <button type="button" className="asset-preview-qr-btn primary" onClick={() => { void copyQrText(); }}>
                  {qrRecognition.copied ? t('collection.image.previewCopied') : t('collection.image.previewQrCopyContent')}
                </button>
                {qrRecognition.openUrl ? (
                  <button type="button" className="asset-preview-qr-btn" onClick={openQrUrl}>
                    {t('collection.image.previewQrOpenLink')}
                  </button>
                ) : null}
                <button type="button" className="asset-preview-qr-btn" onClick={dismissQrPanel}>
                  {t('collection.image.previewQrCollapse')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
