import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_CUSTOMIZATION,
  mergeAppCustomizationPatch,
  normalizeAppCustomization
} from './runtimeStoreCustomization';

describe('normalizeAppCustomization', () => {
  it('falls back to the default cosmetic settings', () => {
    expect(normalizeAppCustomization()).toEqual(DEFAULT_APP_CUSTOMIZATION);
  });

  it('keeps an explicit disabled side switch while defaulting legacy state to enabled', () => {
    expect(normalizeAppCustomization({ showWorldSwitchHandle: false }).showWorldSwitchHandle).toBe(false);
    expect(normalizeAppCustomization({}).showWorldSwitchHandle).toBe(true);
  });

  it('clamps background controls into the supported range', () => {
    expect(normalizeAppCustomization({
      backgroundOpacity: 9,
      backgroundDim: -1,
      backgroundBlur: 99,
      starColor: '#FD9',
      starOpacity: 9,
      starGlow: -1,
      starScale: 9,
      starWarmth: 2,
      customFontAssetIds: [' asset-font ', '', 'asset-font', 'asset-serif'],
      customFontScopeAssignments: {
        global: 'asset-serif',
        titles: 'asset-font',
        chat: 'missing-font',
        cards: ' asset-serif '
      },
      backgroundFit: 'weird' as 'cover'
    })).toEqual({
      ...DEFAULT_APP_CUSTOMIZATION,
      starColor: '#ffdd99',
      starOpacity: 1,
      starGlow: 0,
      starScale: 1.18,
      starWarmth: 1,
      backgroundOpacity: 0.82,
      backgroundDim: 0,
      backgroundBlur: 28,
      customFontAssetIds: ['asset-font', 'asset-serif'],
      customFontScopeAssignments: {
        global: 'asset-serif',
        titles: 'asset-font',
        chat: null,
        cards: 'asset-serif'
      },
      backgroundFit: 'cover'
    });
  });
});

describe('mergeAppCustomizationPatch', () => {
  it('keeps existing cosmetic state while applying a focused patch', () => {
    expect(mergeAppCustomizationPatch(DEFAULT_APP_CUSTOMIZATION, {
      showChatAvatars: true,
      showWorldSwitchHandle: false,
      starColor: '#d6a4ff',
      starOpacity: 0.62,
      starGlow: 0.8,
      starScale: 1.12,
      starWarmth: 0.24,
      backgroundAssetId: 'asset-bg',
      backgroundFit: 'contain'
    })).toEqual({
      ...DEFAULT_APP_CUSTOMIZATION,
      showChatAvatars: true,
      showWorldSwitchHandle: false,
      starColor: '#d6a4ff',
      starOpacity: 0.62,
      starGlow: 0.8,
      starScale: 1.12,
      starWarmth: 0.24,
      backgroundAssetId: 'asset-bg',
      customFontAssetIds: [],
      customFontScopeAssignments: {
        global: null,
        titles: null,
        chat: null,
        cards: null
      },
      backgroundFit: 'contain'
    });
  });
});
