import { useLayoutEffect, type RefObject } from 'react';

export function useAutosizingTextarea(
  textareaRef: RefObject<HTMLTextAreaElement>,
  value: string
) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Measure outside the document flow. Temporarily collapsing the live textarea
    // clamps its scroll container's scrollTop, even if we restore its height before paint.
    const style = window.getComputedStyle(textarea);
    const measure = document.createElement('textarea');
    for (const property of [
      'width', 'box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style',
      'font-stretch', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
      'text-indent', 'text-transform', 'white-space', 'word-break', 'overflow-wrap',
      'tab-size', 'direction', 'padding-top', 'padding-right', 'padding-bottom',
      'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
      'border-left-width', 'border-style'
    ]) {
      measure.style.setProperty(property, style.getPropertyValue(property));
    }
    Object.assign(measure.style, {
      position: 'fixed',
      top: '0',
      left: '-100000px',
      height: '0',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'hidden',
      visibility: 'hidden',
      pointerEvents: 'none',
      fieldSizing: 'fixed'
    });
    measure.tabIndex = -1;
    measure.setAttribute('aria-hidden', 'true');
    measure.wrap = textarea.wrap;
    measure.value = textarea.value || textarea.placeholder;
    document.body.appendChild(measure);
    try {
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const height = style.boxSizing === 'border-box'
        ? measure.scrollHeight + border
        : measure.scrollHeight - padding;
      textarea.style.height = `${height}px`;
    } finally {
      measure.remove();
    }
  }, [textareaRef, value]);
}
