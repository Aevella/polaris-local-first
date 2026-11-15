import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export async function openMcpOAuthAuthorizationUrl(url: string) {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  globalThis.location.assign(url);
}
