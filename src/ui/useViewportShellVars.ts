import { useEffect, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import {
  IOS_NATIVE_KEYBOARD_ANIMATION_DURATION_MS,
  IOS_NATIVE_KEYBOARD_ANIMATION_EASING,
  isViewportKeyboardOpen,
  resolveViewportMetrics,
  type NativeKeyboardSnapshot
} from './viewportMetrics';
import { syncFocusedElementIntoKeyboardViewport } from './viewportFocusVisibility';
import { canUseIosNativeKeyboard } from './iosKeyboardCapability';

type ViewportDebugState = {
  activeTag: string;
  enabled: boolean;
  innerHeight: number;
  keyboardOffset: number;
  scrollY: number;
  viewportHeight: number;
  viewportTop: number;
};

function roundViewportValue(value: number) {
  return `${Math.round(value)}px`;
}

function readWindowScrollY() {
  return Math.max(
    window.scrollY,
    window.pageYOffset,
    document.documentElement.scrollTop,
    document.body.scrollTop
  );
}

function shouldViewportDriveAppHeight() {
  return Capacitor.isNativePlatform();
}

export function useViewportShellVars() {
  const [debugState, setDebugState] = useState<ViewportDebugState>({
    activeTag: 'none',
    enabled: false,
    innerHeight: 0,
    keyboardOffset: 0,
    scrollY: 0,
    viewportHeight: 0,
    viewportTop: 0
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    const debugEnabled = new URLSearchParams(window.location.search).get('debugViewport') === '1';
    const isNativePlatform = Capacitor.isNativePlatform();
    const usesNativeKeyboardMotion = canUseIosNativeKeyboard();
    const drivesAppHeight = shouldViewportDriveAppHeight();
    const resetsDocumentScrollAfterKeyboardClose = !drivesAppHeight;
    let previousKeyboardOpen = false;
    let pendingKeyboardCloseReset = 0;
    let nativeKeyboardSnapshot: NativeKeyboardSnapshot | undefined;
    let latestKeyboardOffset = 0;
    const keyboardListenerHandles: Array<Promise<PluginListenerHandle | null>> = [];
    const pendingFocusVisibilityTimeoutIds: number[] = [];
    const clearPendingFocusVisibilityPasses = () => {
      pendingFocusVisibilityTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pendingFocusVisibilityTimeoutIds.length = 0;
    };
    const scheduleFocusVisibilityPass = (keyboardOffset: number) => {
      if (!usesNativeKeyboardMotion || keyboardOffset <= 0) return;
      clearPendingFocusVisibilityPasses();
      [0, 32, 96, 180].forEach((delay) => {
        pendingFocusVisibilityTimeoutIds.push(window.setTimeout(() => {
          syncFocusedElementIntoKeyboardViewport(keyboardOffset);
        }, delay));
      });
    };
    const applyViewportVars = () => {
      const metrics = resolveViewportMetrics(nativeKeyboardSnapshot, usesNativeKeyboardMotion);
      const keyboardOpen = isViewportKeyboardOpen(metrics);
      latestKeyboardOffset = metrics.keyboardOffset;

      if (drivesAppHeight) {
        root.style.setProperty('--app-height', roundViewportValue(metrics.appHeight));
      } else {
        root.style.removeProperty('--app-height');
      }
      root.style.setProperty('--viewport-height', roundViewportValue(metrics.viewportHeight));
      root.style.setProperty('--viewport-offset-top', roundViewportValue(metrics.viewportTop));
      root.style.setProperty('--keyboard-offset', roundViewportValue(metrics.keyboardOffset));
      root.style.setProperty('--keyboard-bridge-offset', roundViewportValue(metrics.keyboardBridgeOffset));
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
      setDebugState({
        activeTag: document.activeElement?.tagName?.toLowerCase() ?? 'none',
        enabled: debugEnabled,
        innerHeight: Math.round(metrics.innerHeight),
        keyboardOffset: Math.round(metrics.keyboardOffset),
        scrollY: Math.round(window.scrollY),
        viewportHeight: Math.round(metrics.viewportHeight),
        viewportTop: Math.round(metrics.viewportTop)
      });

      if (resetsDocumentScrollAfterKeyboardClose && previousKeyboardOpen && !keyboardOpen) {
        window.cancelAnimationFrame(pendingKeyboardCloseReset);
        pendingKeyboardCloseReset = window.requestAnimationFrame(() => {
          if (readWindowScrollY() <= 0) return;
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        });
      }
      if (keyboardOpen) {
        scheduleFocusVisibilityPass(metrics.keyboardOffset);
      } else {
        clearPendingFocusVisibilityPasses();
      }

      previousKeyboardOpen = keyboardOpen;
    };

    if (isNativePlatform) {
      root.dataset.polarisNative = 'true';
      root.dataset.polarisPlatform = Capacitor.getPlatform();
    } else {
      delete root.dataset.polarisNative;
      delete root.dataset.polarisPlatform;
    }

    if (usesNativeKeyboardMotion) {
      root.dataset.nativeKeyboardOverlay = 'true';
      void Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => undefined);
      void Keyboard.setScroll({ isDisabled: true }).catch(() => undefined);
      root.style.setProperty('--keyboard-animation-duration', `${IOS_NATIVE_KEYBOARD_ANIMATION_DURATION_MS}ms`);
      root.style.setProperty('--keyboard-animation-ease', IOS_NATIVE_KEYBOARD_ANIMATION_EASING);
      keyboardListenerHandles.push(
        Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
          nativeKeyboardSnapshot = { height: keyboardHeight, visible: true };
          applyViewportVars();
        }).catch(() => null)
      );
      keyboardListenerHandles.push(
        Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
          nativeKeyboardSnapshot = { height: keyboardHeight, visible: true };
          applyViewportVars();
        }).catch(() => null)
      );
      keyboardListenerHandles.push(
        Keyboard.addListener('keyboardWillHide', () => {
          nativeKeyboardSnapshot = { height: 0, visible: false };
          applyViewportVars();
        }).catch(() => null)
      );
      keyboardListenerHandles.push(
        Keyboard.addListener('keyboardDidHide', () => {
          nativeKeyboardSnapshot = { height: 0, visible: false };
          applyViewportVars();
        }).catch(() => null)
      );
    }

    applyViewportVars();

    const viewport = window.visualViewport;
    const handleWindowResize = () => applyViewportVars();
    const handleOrientationChange = () => applyViewportVars();
    const handleViewportResize = () => applyViewportVars();
    const handleViewportScroll = () => {
      if (!drivesAppHeight) return;
      applyViewportVars();
    };
    const handleFocusIn = () => {
      if (!usesNativeKeyboardMotion || latestKeyboardOffset <= 0) return;
      scheduleFocusVisibilityPass(latestKeyboardOffset);
    };

    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    document.addEventListener('focusin', handleFocusIn, true);
    viewport?.addEventListener('resize', handleViewportResize);
    viewport?.addEventListener('scroll', handleViewportScroll);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('focusin', handleFocusIn, true);
      viewport?.removeEventListener('resize', handleViewportResize);
      viewport?.removeEventListener('scroll', handleViewportScroll);
      window.cancelAnimationFrame(pendingKeyboardCloseReset);
      clearPendingFocusVisibilityPasses();
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--viewport-height');
      root.style.removeProperty('--viewport-offset-top');
      root.style.removeProperty('--keyboard-offset');
      root.style.removeProperty('--keyboard-bridge-offset');
      root.style.removeProperty('--keyboard-animation-duration');
      root.style.removeProperty('--keyboard-animation-ease');
      delete root.dataset.keyboardOpen;
      delete root.dataset.polarisNative;
      delete root.dataset.polarisPlatform;
      delete root.dataset.nativeKeyboardOverlay;
      if (usesNativeKeyboardMotion) {
        void Keyboard.setScroll({ isDisabled: false }).catch(() => undefined);
        void Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined);
      }
      void Promise.allSettled(keyboardListenerHandles).then((handles) => {
        handles.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            void result.value.remove().catch(() => undefined);
          }
        });
      });
    };
  }, []);

  return debugState;
}
