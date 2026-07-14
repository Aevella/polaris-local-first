import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web',
  plugins: new Set<string>()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.nativePlatform,
    getPlatform: () => capacitorState.platform,
    isPluginAvailable: (name: string) => capacitorState.plugins.has(name)
  },
  registerPlugin: vi.fn(() => ({
    getStatus: vi.fn(),
    requestCalendarAccess: vi.fn(),
    listCalendars: vi.fn(),
    readCalendarEvents: vi.fn(),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn()
  }))
}));

describe('personalData native bridge availability', () => {
  beforeEach(() => {
    capacitorState.nativePlatform = false;
    capacitorState.platform = 'web';
    capacitorState.plugins = new Set<string>();
  });

  it('keeps web builds unavailable even when the plugin name is present', async () => {
    capacitorState.plugins = new Set(['PersonalData']);
    const { canUseNativePersonalData, getCachedNativePersonalDataStatus } = await import('./personalData');

    expect(canUseNativePersonalData()).toBe(false);
    expect(getCachedNativePersonalDataStatus()).toMatchObject({
      platform: 'web',
      calendar: { available: false, permission: 'unavailable' }
    });
  });

  it('allows registered iOS and Android native PersonalData plugins', async () => {
    const { canUseNativePersonalData, getCachedNativePersonalDataStatus } = await import('./personalData');

    capacitorState.nativePlatform = true;
    capacitorState.plugins = new Set(['PersonalData']);
    capacitorState.platform = 'ios';
    expect(canUseNativePersonalData()).toBe(true);
    expect(getCachedNativePersonalDataStatus()).toMatchObject({
      platform: 'ios',
      calendar: { available: true, permission: 'notDetermined' }
    });

    capacitorState.platform = 'android';
    expect(canUseNativePersonalData()).toBe(true);
    expect(getCachedNativePersonalDataStatus()).toMatchObject({
      platform: 'android',
      calendar: { available: true, permission: 'notDetermined' }
    });
  });

  it('does not expose unsupported native platforms', async () => {
    capacitorState.nativePlatform = true;
    capacitorState.platform = 'electron';
    capacitorState.plugins = new Set(['PersonalData']);
    const { canUseNativePersonalData } = await import('./personalData');

    expect(canUseNativePersonalData()).toBe(false);
  });
});
