import { useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTION_FRONTSTAGE_SURFACES } from '../../frontstage/frontstageSurfaceRegistry';
import {
  ensureRoomState,
  flushRoomState,
  getCachedRoomState,
  subscribeRoomState,
  updateRoomState
} from '../../../engines/roomStatePersistence';
import { injectRoomPreviewBridge } from '../../../engines/roomPreviewBridge';
import { useI18n } from '../../../i18n';

const PREVIEW_IFRAME_MOUNT_DELAY_MS = 160;

type CodePreviewStageSurfaceProps = {
  cardId?: string | null;
  roomId?: string | null;
  title: string;
  frameTitle: string;
  srcDoc: string | null;
  code: string;
  className?: string;
};

export function CodePreviewStageSurface({
  cardId,
  roomId,
  title,
  frameTitle,
  srcDoc,
  code,
  className
}: CodePreviewStageSurfaceProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const persistenceRoomId = roomId ?? cardId ?? null;
  const [readySrcDoc, setReadySrcDoc] = useState<string | null>(null);

  useEffect(() => {
    if (!srcDoc) {
      setReadySrcDoc(null);
      return;
    }

    let cancelled = false;
    let frameId = 0;
    setReadySrcDoc(null);
    const timerId = window.setTimeout(() => {
      frameId = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setReadySrcDoc(srcDoc);
        }
      });
    }, PREVIEW_IFRAME_MOUNT_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [srcDoc]);

  const cachedInitialRoomState = useMemo(
    () => (persistenceRoomId && readySrcDoc ? getCachedRoomState(persistenceRoomId) : {}),
    [persistenceRoomId, readySrcDoc]
  );

  const bridgedSrcDoc = useMemo(
    () => (readySrcDoc && persistenceRoomId
      ? injectRoomPreviewBridge(readySrcDoc, persistenceRoomId, cachedInitialRoomState)
      : readySrcDoc),
    [cachedInitialRoomState, persistenceRoomId, readySrcDoc]
  );

  useEffect(() => {
    if (!persistenceRoomId || !bridgedSrcDoc) return;

    let savingFromFrame = false;
    let frameRevision = 0;

    const postHydrate = (state: unknown) => {
      iframeRef.current?.contentWindow?.postMessage({
        source: 'polaris-room-host',
        type: 'hydrate',
        roomId: persistenceRoomId,
        revision: frameRevision,
        state
      }, '*');
    };

    const unsubscribe = subscribeRoomState(persistenceRoomId, (state) => {
      if (!savingFromFrame) postHydrate(state);
    });

    void ensureRoomState(persistenceRoomId).then(() => {
      postHydrate(getCachedRoomState(persistenceRoomId));
    });

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        type?: string;
        roomId?: string;
        state?: unknown;
        flush?: boolean;
        revision?: number;
      } | null;
      if (!data || data.source !== 'polaris-room-bridge' || data.roomId !== persistenceRoomId) return;

      if (data.type === 'ready') {
        postHydrate(getCachedRoomState(persistenceRoomId));
        return;
      }

      if (data.type === 'save') {
        frameRevision = data.revision ?? 0;
        savingFromFrame = true;
        try {
          updateRoomState(persistenceRoomId, data.state);
        } finally {
          savingFromFrame = false;
        }
        if (data.flush === true) {
          void flushRoomState(persistenceRoomId);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      unsubscribe();
      window.removeEventListener('message', handleMessage);
      void flushRoomState(persistenceRoomId);
    };
  }, [bridgedSrcDoc, persistenceRoomId]);

  return (
    <div
      className={['code-preview-stage', className].filter(Boolean).join(' ')}
      data-surface={COLLECTION_FRONTSTAGE_SURFACES.previewStage}
    >
      {bridgedSrcDoc ? (
        <iframe
          ref={iframeRef}
          className="code-preview-stage-frame"
          title={frameTitle || `${title} preview`}
          srcDoc={bridgedSrcDoc}
          sandbox="allow-scripts"
        />
      ) : srcDoc ? (
        <div className="code-preview-stage-loading">{t('collection.workshop.previewLoading')}</div>
      ) : (
        <pre className="code-preview-stage-fallback">{code}</pre>
      )}
    </div>
  );
}
