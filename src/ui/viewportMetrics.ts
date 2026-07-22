export const KEYBOARD_OPEN_THRESHOLD = 56;
export const IOS_NATIVE_KEYBOARD_ANIMATION_DURATION_MS = 250;
export const IOS_NATIVE_KEYBOARD_ANIMATION_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)';

export type NativeKeyboardSnapshot = {
  height: number;
  visible: boolean;
};

export type ViewportMetrics = {
  appHeight: number;
  innerHeight: number;
  keyboardOffset: number;
  keyboardBridgeOffset: number;
  measuredKeyboardOffset: number;
  nativeKeyboardHeight: number;
  viewportHeight: number;
  viewportTop: number;
};

type ViewportMetricInput = {
  innerHeight: number;
  nativeKeyboard?: NativeKeyboardSnapshot;
  preferNativeOverlay?: boolean;
  viewportHeight: number;
  viewportTop: number;
};

export function calculateViewportMetrics({
  innerHeight,
  nativeKeyboard,
  preferNativeOverlay = false,
  viewportHeight,
  viewportTop
}: ViewportMetricInput) : ViewportMetrics {
  const measuredKeyboardOffset = Math.max(0, innerHeight - viewportHeight - viewportTop);
  const nativeKeyboardHeight = Math.max(0, nativeKeyboard?.height ?? 0);

  if (preferNativeOverlay) {
    const keyboardOffset = nativeKeyboard?.visible ? nativeKeyboardHeight : 0;

    return {
      appHeight: innerHeight,
      innerHeight,
      keyboardBridgeOffset: keyboardOffset,
      keyboardOffset,
      measuredKeyboardOffset,
      nativeKeyboardHeight,
      viewportHeight,
      viewportTop
    };
  }

  const keyboardOffset = nativeKeyboard
    ? (nativeKeyboard.visible ? Math.max(measuredKeyboardOffset, nativeKeyboardHeight) : 0)
    : measuredKeyboardOffset;
  const keyboardBridgeOffset = keyboardOffset - measuredKeyboardOffset;

  return {
    appHeight: viewportHeight,
    innerHeight,
    keyboardBridgeOffset,
    keyboardOffset,
    measuredKeyboardOffset,
    nativeKeyboardHeight,
    viewportHeight,
    viewportTop
  };
}

export function resolveViewportMetrics(
  nativeKeyboard?: NativeKeyboardSnapshot,
  preferNativeOverlay = false
) : ViewportMetrics {
  const viewport = window.visualViewport;
  const innerHeight = window.innerHeight;
  const viewportHeight = viewport?.height ?? innerHeight;
  const viewportTop = viewport?.offsetTop ?? 0;

  return calculateViewportMetrics({
    innerHeight,
    nativeKeyboard,
    preferNativeOverlay,
    viewportHeight,
    viewportTop
  });
}

export function isViewportKeyboardOpen(metrics = resolveViewportMetrics()) {
  return Math.max(metrics.measuredKeyboardOffset, metrics.keyboardOffset) > KEYBOARD_OPEN_THRESHOLD;
}
