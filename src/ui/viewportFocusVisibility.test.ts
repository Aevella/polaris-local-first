import { describe, expect, it } from 'vitest';
import { resolveContainerScrollTop } from './viewportFocusVisibility';

describe('resolveContainerScrollTop', () => {
  it('keeps the scroll position when keyboard geometry leaves no visible area', () => {
    expect(resolveContainerScrollTop({
      currentScrollTop: 300, targetTop: 500, targetBottom: 700,
      visibleTop: 140, visibleBottom: 140
    })).toBe(300);
  });

  it('reveals the nearest edge of an oversized editor above the viewport and then stays put', () => {
    const next = resolveContainerScrollTop({
      currentScrollTop: 900, targetTop: -600, targetBottom: 200,
      visibleTop: 140, visibleBottom: 440
    });
    expect(next).toBe(660);
    expect(resolveContainerScrollTop({
      currentScrollTop: next, targetTop: -360, targetBottom: 440,
      visibleTop: 140, visibleBottom: 440
    })).toBe(next);
  });

  it('keeps an oversized editor stable when it already spans the visible area', () => {
    expect(resolveContainerScrollTop({
      currentScrollTop: 300, targetTop: 80, targetBottom: 880,
      visibleTop: 140, visibleBottom: 440
    })).toBe(300);
  });

  it('moves an oversized editor into view once and remains stable on repeated keyboard passes', () => {
    let scrollTop = 100;
    const targetInitialTop = 500;
    const positions: number[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      const targetTop = targetInitialTop - (scrollTop - 100);
      scrollTop = resolveContainerScrollTop({
        currentScrollTop: scrollTop, targetTop, targetBottom: targetTop + 800,
        visibleTop: 140, visibleBottom: 440
      });
      positions.push(scrollTop);
    }
    expect(positions).toEqual([460, 460, 460, 460]);
  });

  it('keeps scroll position when target is already fully visible', () => {
    expect(resolveContainerScrollTop({
      currentScrollTop: 120,
      targetTop: 180,
      targetBottom: 220,
      visibleTop: 140,
      visibleBottom: 260
    })).toBe(120);
  });

  it('scrolls downward when the target falls under the keyboard-clipped bottom edge', () => {
    expect(resolveContainerScrollTop({
      currentScrollTop: 120,
      targetTop: 260,
      targetBottom: 312,
      visibleTop: 140,
      visibleBottom: 248
    })).toBe(184);
  });

  it('scrolls upward when the target sits above the visible top edge', () => {
    expect(resolveContainerScrollTop({
      currentScrollTop: 120,
      targetTop: 96,
      targetBottom: 132,
      visibleTop: 140,
      visibleBottom: 280
    })).toBe(76);
  });
});
