import { useEffect, useRef, useState } from 'react';
import { getAssetBlob } from '../../infrastructure/assetStore';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import type { ChatAttachment } from '../../types/domain';

export function useNearViewportAssetLoading() {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || shouldLoad) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, {
      root: null,
      rootMargin: '600px 0px'
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return { ref, shouldLoad };
}

export async function downloadChatAttachment(attachment: ChatAttachment) {
  if (!attachment.assetId || attachment.clearedAt) return;
  let objectUrl: string | null = null;
  try {
    const blob = await getAssetBlob(attachment.assetId);
    if (!blob) return;
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = attachment.name;
    anchor.rel = 'noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    reportPersistenceError({ label: '[asset:download]', store: 'asset', operation: 'read-download' }, error);
  } finally {
    if (objectUrl) {
      const urlToRevoke = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 0);
    }
  }
}
