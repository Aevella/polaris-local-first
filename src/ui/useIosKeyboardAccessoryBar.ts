import { useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { canUseIosNativeKeyboard } from './iosKeyboardCapability';

export function useIosKeyboardAccessoryBar() {
  useEffect(() => {
    if (!canUseIosNativeKeyboard()) return;
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);
  }, []);
}
