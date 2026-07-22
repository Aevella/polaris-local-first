import { describe, expect, it } from 'vitest';
import { calculateViewportMetrics, isViewportKeyboardOpen } from './viewportMetrics';

describe('calculateViewportMetrics', () => {
  it('uses measured viewport offset when no native keyboard snapshot exists', () => {
    const metrics = calculateViewportMetrics({
      innerHeight: 844,
      viewportHeight: 540,
      viewportTop: 0
    });

    expect(metrics.keyboardOffset).toBe(304);
    expect(metrics.measuredKeyboardOffset).toBe(304);
    expect(metrics.keyboardBridgeOffset).toBe(0);
    expect(metrics.nativeKeyboardHeight).toBe(0);
  });

  it('bridges upward immediately from native keyboard height before viewport catches up', () => {
    const metrics = calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 320, visible: true },
      viewportHeight: 844,
      viewportTop: 0
    });

    expect(metrics.keyboardOffset).toBe(320);
    expect(metrics.measuredKeyboardOffset).toBe(0);
    expect(metrics.keyboardBridgeOffset).toBe(320);
  });

  it('keeps iOS native overlay geometry fixed while lifting only by native keyboard height', () => {
    const metrics = calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 320, visible: true },
      preferNativeOverlay: true,
      viewportHeight: 544,
      viewportTop: 0
    });

    expect(metrics.appHeight).toBe(844);
    expect(metrics.keyboardOffset).toBe(320);
    expect(metrics.measuredKeyboardOffset).toBe(300);
    expect(metrics.keyboardBridgeOffset).toBe(320);
  });

  it('bridges downward while keyboard is hiding and viewport is still compressed', () => {
    const metrics = calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 0, visible: false },
      viewportHeight: 544,
      viewportTop: 0
    });

    expect(metrics.keyboardOffset).toBe(0);
    expect(metrics.measuredKeyboardOffset).toBe(300);
    expect(metrics.keyboardBridgeOffset).toBe(-300);
  });
});

describe('isViewportKeyboardOpen', () => {
  it('treats native keyboard intent as open before viewport resize lands', () => {
    expect(isViewportKeyboardOpen(calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 320, visible: true },
      viewportHeight: 844,
      viewportTop: 0
    }))).toBe(true);
  });

  it('keeps the keyboard marked open while the viewport is still settling during hide', () => {
    expect(isViewportKeyboardOpen(calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 0, visible: false },
      viewportHeight: 544,
      viewportTop: 0
    }))).toBe(true);
  });

  it('stays closed when both viewport and native state are settled', () => {
    expect(isViewportKeyboardOpen(calculateViewportMetrics({
      innerHeight: 844,
      nativeKeyboard: { height: 0, visible: false },
      viewportHeight: 844,
      viewportTop: 0
    }))).toBe(false);
  });
});
