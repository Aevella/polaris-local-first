import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web'
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => capacitorState.platform,
    isNativePlatform: () => capacitorState.nativePlatform
  }
}));

import { applyNativeShellBootstrap } from './nativeShellBootstrap';

function createRoot() {
  const properties = new Map<string, string>();
  return {
    dataset: {},
    style: {
      getPropertyValue: (name: string) => properties.get(name) ?? '',
      removeProperty: (name: string) => {
        properties.delete(name);
      },
      setProperty: (name: string, value: string) => {
        properties.set(name, value);
      }
    }
  } as unknown as HTMLElement;
}

describe('applyNativeShellBootstrap', () => {
  beforeEach(() => {
    capacitorState.nativePlatform = false;
    capacitorState.platform = 'web';
  });

  it('leaves web shell geometry untouched', () => {
    const root = createRoot();

    const applied = applyNativeShellBootstrap(root, { innerHeight: 812 });

    expect(applied).toBe(false);
    expect(root.dataset.polarisNative).toBeUndefined();
    expect(root.dataset.polarisPlatform).toBeUndefined();
    expect(root.dataset.nativeKeyboardOverlay).toBeUndefined();
    expect(root.style.getPropertyValue('--app-height')).toBe('');
  });

  it('primes native ios shell flags before React viewport effects run', () => {
    capacitorState.nativePlatform = true;
    capacitorState.platform = 'ios';
    const root = createRoot();

    const applied = applyNativeShellBootstrap(root, { innerHeight: 812 });

    expect(applied).toBe(true);
    expect(root.dataset.polarisNative).toBe('true');
    expect(root.dataset.polarisPlatform).toBe('ios');
    expect(root.dataset.nativeKeyboardOverlay).toBe('true');
    expect(root.style.getPropertyValue('--app-height')).toBe('812px');
  });

  it('uses the current ios window height when the device screen is larger', () => {
    capacitorState.nativePlatform = true;
    capacitorState.platform = 'ios';
    const root = createRoot();
    const splitViewWindow = { innerHeight: 520, screen: { height: 852 } };

    applyNativeShellBootstrap(root, splitViewWindow);

    expect(root.style.getPropertyValue('--app-height')).toBe('520px');
  });

  it('does not mark native keyboard overlay outside ios', () => {
    capacitorState.nativePlatform = true;
    capacitorState.platform = 'android';
    const root = createRoot();

    applyNativeShellBootstrap(root, { innerHeight: 744 });

    expect(root.dataset.polarisNative).toBe('true');
    expect(root.dataset.polarisPlatform).toBe('android');
    expect(root.dataset.nativeKeyboardOverlay).toBeUndefined();
    expect(root.style.getPropertyValue('--app-height')).toBe('744px');
  });
});
