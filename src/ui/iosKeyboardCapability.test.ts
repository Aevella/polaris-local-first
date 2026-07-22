import { describe, expect, it } from 'vitest';
import { canUseIosNativeKeyboard } from './iosKeyboardCapability';

function createRuntime({
  native,
  platform,
  keyboardAvailable
}: {
  native: boolean;
  platform: string;
  keyboardAvailable: boolean;
}) {
  return {
    getPlatform: () => platform,
    isNativePlatform: () => native,
    isPluginAvailable: (name: string) => name === 'Keyboard' && keyboardAvailable
  };
}

describe('canUseIosNativeKeyboard', () => {
  it('uses the native keyboard bridge only when iOS registered it', () => {
    expect(canUseIosNativeKeyboard(createRuntime({
      native: true,
      platform: 'ios',
      keyboardAvailable: true
    }))).toBe(true);
  });

  it('falls back when the iOS binary did not register the keyboard plugin', () => {
    expect(canUseIosNativeKeyboard(createRuntime({
      native: true,
      platform: 'ios',
      keyboardAvailable: false
    }))).toBe(false);
  });

  it('does not expose the iOS keyboard bridge on other runtimes', () => {
    expect(canUseIosNativeKeyboard(createRuntime({
      native: true,
      platform: 'android',
      keyboardAvailable: true
    }))).toBe(false);
    expect(canUseIosNativeKeyboard(createRuntime({
      native: false,
      platform: 'web',
      keyboardAvailable: true
    }))).toBe(false);
  });
});
