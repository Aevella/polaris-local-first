import type { AppAppearancePreference, AppDisplayPreferences } from '../types/domain';

export const FONT_SCALE_MIN = 0.9;
export const FONT_SCALE_MAX = 1.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const DEFAULT_DISPLAY_PREFERENCES: AppDisplayPreferences = {
  appearance: 'system',
  hapticsEnabled: false,
  fontScale: 1
};

export function normalizeAppearancePreference(value: unknown): AppAppearancePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_DISPLAY_PREFERENCES.appearance;
}

export function normalizeDisplayPreferences(
  preferences?: unknown
): AppDisplayPreferences {
  const source = preferences && typeof preferences === 'object'
    ? preferences as Partial<AppDisplayPreferences>
    : {};

  return {
    appearance: normalizeAppearancePreference(source.appearance),
    hapticsEnabled:
      typeof source.hapticsEnabled === 'boolean'
        ? source.hapticsEnabled
        : DEFAULT_DISPLAY_PREFERENCES.hapticsEnabled,
    fontScale:
      typeof source.fontScale === 'number'
        ? clamp(source.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX)
        : DEFAULT_DISPLAY_PREFERENCES.fontScale
  };
}

export function mergeDisplayPreferencesPatch(
  preferences: AppDisplayPreferences,
  patch: Partial<AppDisplayPreferences>
): AppDisplayPreferences {
  return normalizeDisplayPreferences({
    ...preferences,
    ...patch
  });
}
