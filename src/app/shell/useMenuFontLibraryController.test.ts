import { describe, expect, it } from 'vitest';
import type { AppCustomization } from '../../types/domain';
import {
  addImportedCustomFont,
  assignCustomFontScope,
  isAcceptedFontFile,
  removeCustomFont,
  resolveFontAssetMimeType
} from './useMenuFontLibraryController';

const baseCustomization: AppCustomization = {
  showChatAvatars: false,
  showWorldSwitchHandle: true,
  starColor: null,
  starOpacity: 0.98,
  starGlow: 0.46,
  starScale: 1,
  starWarmth: 0.54,
  backgroundAssetId: null,
  customFontAssetIds: ['font-a'],
  customFontScopeAssignments: {
    global: null,
    titles: 'font-a',
    chat: null,
    cards: 'font-a'
  },
  backgroundOpacity: 0.46,
  backgroundDim: 0.24,
  backgroundBlur: 10,
  backgroundFit: 'cover'
};

describe('menu font library model', () => {
  it('accepts known font extensions and font mime types', () => {
    expect(isAcceptedFontFile('serif.woff2', '')).toBe(true);
    expect(isAcceptedFontFile('display.bin', 'font/otf')).toBe(true);
    expect(isAcceptedFontFile('display.bin', 'application/x-font-ttf')).toBe(true);
    expect(isAcceptedFontFile('notes.txt', 'text/plain')).toBe(false);
  });

  it('derives a font mime type when the browser omits one', () => {
    expect(resolveFontAssetMimeType('serif.otf', '')).toBe('font/otf');
    expect(resolveFontAssetMimeType('serif.ttf', '')).toBe('font/ttf');
    expect(resolveFontAssetMimeType('serif.woff2', '')).toBe('font/woff2');
    expect(resolveFontAssetMimeType('serif.woff2', 'font/custom')).toBe('font/custom');
  });

  it('assigns the first imported font globally without overwriting an existing global choice', () => {
    expect(addImportedCustomFont(baseCustomization, 'font-b')).toEqual({
      customFontAssetIds: ['font-a', 'font-b'],
      customFontScopeAssignments: {
        global: 'font-b',
        titles: 'font-a',
        chat: null,
        cards: 'font-a'
      }
    });

    expect(addImportedCustomFont({
      ...baseCustomization,
      customFontScopeAssignments: {
        ...baseCustomization.customFontScopeAssignments,
        global: 'font-a'
      }
    }, 'font-b')).toEqual({
      customFontAssetIds: ['font-a', 'font-b'],
      customFontScopeAssignments: {
        global: 'font-a',
        titles: 'font-a',
        chat: null,
        cards: 'font-a'
      }
    });
  });

  it('adds newly assigned font ids while preserving existing font ids', () => {
    expect(assignCustomFontScope(baseCustomization, 'chat', 'font-b')).toEqual({
      customFontAssetIds: ['font-a', 'font-b'],
      customFontScopeAssignments: {
        global: null,
        titles: 'font-a',
        chat: 'font-b',
        cards: 'font-a'
      }
    });

    expect(assignCustomFontScope(baseCustomization, 'cards', null)).toEqual({
      customFontAssetIds: ['font-a'],
      customFontScopeAssignments: {
        global: null,
        titles: 'font-a',
        chat: null,
        cards: null
      }
    });
  });

  it('removes a font id and clears every scope that used it', () => {
    expect(removeCustomFont(baseCustomization, 'font-a')).toEqual({
      customFontAssetIds: [],
      customFontScopeAssignments: {
        global: null,
        titles: null,
        chat: null,
        cards: null
      }
    });
  });
});
