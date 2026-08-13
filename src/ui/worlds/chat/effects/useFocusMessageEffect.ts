import { useLayoutEffect } from 'react';
import type { ChatMessage } from '../../../../types/domain';

const FOCUS_VISIBILITY_PADDING = 28;

export function useFocusMessageEffect(args: {
  focusedMessageId: string | null;
  messageBodyReady: boolean;
  visibleMessages: ChatMessage[];
  setFocusedMessageTarget: (value: { conversationId: string; messageId: string } | null) => void;
}) {
  const {
    focusedMessageId,
    messageBodyReady,
    visibleMessages,
    setFocusedMessageTarget
  } = args;

  useLayoutEffect(() => {
    if (!focusedMessageId) return;
    // Search can open a conversation whose body still lives in LocalData.
    // Preserve the target until hydration finishes instead of clearing it
    // against the temporary empty message array.
    if (!messageBodyReady) return;
    if (!visibleMessages.some((message) => message.id === focusedMessageId)) {
      setFocusedMessageTarget(null);
      return;
    }

    let firstFrameId = 0;
    let settleFrameId = 0;

    const ensureMessageVisible = () => {
      const container = document.querySelector<HTMLElement>('.chat-flow');
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((row) => row.dataset.messageId === focusedMessageId) ?? null;
      if (!container || !target) {
        return false;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visibleTop = containerRect.top + FOCUS_VISIBILITY_PADDING;
      const visibleBottom = containerRect.bottom - FOCUS_VISIBILITY_PADDING;
      const alreadyVisible = targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom;

      if (!alreadyVisible) {
        target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
      return true;
    };

    firstFrameId = window.requestAnimationFrame(() => {
      ensureMessageVisible();
      // Virtual rows publish their measured heights on an animation frame.
      // Correct once more after that measurement render before releasing the
      // focus target, so search lands on the real row rather than its estimate.
      settleFrameId = window.requestAnimationFrame(() => {
        ensureMessageVisible();
        setFocusedMessageTarget(null);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(settleFrameId);
    };
  }, [focusedMessageId, messageBodyReady, setFocusedMessageTarget, visibleMessages]);
}
