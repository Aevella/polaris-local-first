type ResolveContainerScrollTopArgs = {
  currentScrollTop: number;
  targetTop: number;
  targetBottom: number;
  visibleTop: number;
  visibleBottom: number;
};

const FOCUS_VISIBILITY_MARGIN_PX = 12;

export function resolveContainerScrollTop({
  currentScrollTop,
  targetTop,
  targetBottom,
  visibleTop,
  visibleBottom
}: ResolveContainerScrollTopArgs) {
  const visibleHeight = visibleBottom - visibleTop;
  if (visibleHeight <= 0) return currentScrollTop;

  // An auto-growing editor cannot fit above the keyboard as a whole. Keep
  // it stable while it covers the viewport instead of alternating between
  // bottom alignment and top alignment on successive visibility passes.
  if (targetBottom - targetTop > visibleHeight) {
    if (targetTop > visibleTop) {
      return currentScrollTop + (targetTop - visibleTop);
    }
    if (targetBottom < visibleBottom) {
      return Math.max(0, currentScrollTop - (visibleBottom - targetBottom));
    }
    return currentScrollTop;
  }

  if (targetBottom > visibleBottom) {
    return currentScrollTop + (targetBottom - visibleBottom);
  }

  if (targetTop < visibleTop) {
    return Math.max(0, currentScrollTop - (visibleTop - targetTop));
  }

  return currentScrollTop;
}

function isTextEntryElement(node: Element | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return (
    node instanceof HTMLTextAreaElement
    || node instanceof HTMLSelectElement
    || (node instanceof HTMLInputElement && node.type !== 'button' && node.type !== 'checkbox' && node.type !== 'radio')
  );
}

function isScrollableElement(node: HTMLElement) {
  const style = window.getComputedStyle(node);
  const overflowY = style.overflowY;
  return (
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
    && node.scrollHeight > node.clientHeight + 1
  );
}

function findNearestScrollableAncestor(node: HTMLElement | null) {
  let current = node?.parentElement ?? null;
  while (current) {
    if (isScrollableElement(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function scrollChatTimelineToBottom() {
  const chatFlow = document.querySelector<HTMLElement>('.chat-flow');
  if (!chatFlow) return;
  const maxScrollTop = Math.max(0, chatFlow.scrollHeight - chatFlow.clientHeight);
  chatFlow.scrollTo({ top: maxScrollTop, behavior: 'auto' });
}

export function syncFocusedElementIntoKeyboardViewport(keyboardOffset: number) {
  if (typeof window === 'undefined' || keyboardOffset <= 0) return;

  const activeElement = document.activeElement;
  if (!isTextEntryElement(activeElement)) return;

  if (activeElement.closest('.chat-dock')) {
    scrollChatTimelineToBottom();
    return;
  }

  const scrollContainer = findNearestScrollableAncestor(activeElement);
  if (!scrollContainer) return;

  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = activeElement.getBoundingClientRect();
  const keyboardViewportBottom = window.innerHeight - keyboardOffset;
  const visibleTop = containerRect.top + FOCUS_VISIBILITY_MARGIN_PX;
  const visibleBottom = Math.max(
    visibleTop,
    Math.min(containerRect.bottom, keyboardViewportBottom) - FOCUS_VISIBILITY_MARGIN_PX
  );
  const nextScrollTop = resolveContainerScrollTop({
    currentScrollTop: scrollContainer.scrollTop,
    targetTop: targetRect.top,
    targetBottom: targetRect.bottom,
    visibleTop,
    visibleBottom
  });

  if (Math.abs(nextScrollTop - scrollContainer.scrollTop) <= 1) return;
  scrollContainer.scrollTo({ top: nextScrollTop, behavior: 'auto' });
}
