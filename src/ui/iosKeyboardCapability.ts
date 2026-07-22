import { Capacitor } from '@capacitor/core';

type IosKeyboardRuntime = Pick<
  typeof Capacitor,
  'getPlatform' | 'isNativePlatform' | 'isPluginAvailable'
>;

export function canUseIosNativeKeyboard(runtime: IosKeyboardRuntime = Capacitor) {
  return runtime.isNativePlatform()
    && runtime.getPlatform() === 'ios'
    && runtime.isPluginAvailable('Keyboard');
}
