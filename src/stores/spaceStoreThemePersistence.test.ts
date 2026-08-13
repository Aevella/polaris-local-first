import { describe, expect, it } from 'vitest';
import { buildThemeFrameFromPresetId } from '../config/theme/themePresets';
import { createInitialThemeState } from './spaceStoreTheme';
import type { SpaceFrontstageState, SpaceThemeState } from './spaceStoreTypes';
import {
  migratePersistedSpaceState,
  serializePersistedSpaceLocalState,
  serializePersistedSpaceState,
  serializePersistedSpaceThemeState
} from './spaceStorePersistence';
import { SPACE_STORE_VERSION } from './storeExportPackage';
import { DEFAULT_APP_CUSTOMIZATION } from './runtimeStoreCustomization';
import { DEFAULT_DISPLAY_PREFERENCES } from './spaceStoreDisplayPreferences';

const LEGACY_POLARIS_DEFAULT_VARIABLES = {
  '--bg': 'linear-gradient(165deg, #fbf7f2 0%, #f5ede3 40%, #f0e6d8 100%)',
  '--surface': 'rgba(255, 252, 248, 0.72)',
  '--surface-solid': '#fffcf8',
  '--surface-deep': 'rgba(255, 252, 248, 0.9)',
  '--border': 'rgba(205, 185, 160, 0.25)',
  '--border-hover': 'rgba(205, 185, 160, 0.45)',
  '--text': '#3d3228',
  '--text-soft': '#8a7c6e',
  '--text-muted': '#b5a898',
  '--accent': '#c4956a',
  '--accent-soft': 'rgba(196, 149, 106, 0.12)',
  '--accent-glow': 'rgba(196, 149, 106, 0.06)',
  '--card-bg': 'linear-gradient(135deg, rgba(255,252,248,0.92) 0%, rgba(250,244,236,0.9) 100%)',
  '--shadow': '0 2px 20px rgba(160, 130, 100, 0.06), 0 0 0 1px rgba(205, 185, 160, 0.12)',
  '--shadow-hover': '0 8px 32px rgba(160, 130, 100, 0.1), 0 0 0 1px rgba(205, 185, 160, 0.2)',
  '--shadow-panel': '0 12px 28px rgba(160, 130, 100, 0.08)',
  '--chat-bg': 'linear-gradient(165deg, #f4f5fa 0%, #eceef6 40%, #e5e8f2 100%)',
  '--cool-bg': 'linear-gradient(165deg, #f4f5fa 0%, #eceef6 40%, #e5e8f2 100%)',
  '--cool-surface': 'rgba(248, 249, 253, 0.72)',
  '--cool-surface-solid': '#f8f9fd',
  '--cool-surface-deep': 'rgba(248, 249, 253, 0.9)',
  '--cool-border': 'rgba(170, 178, 205, 0.25)',
  '--cool-border-hover': 'rgba(170, 178, 205, 0.45)',
  '--cool-text': '#282d3d',
  '--cool-text-soft': '#6e7490',
  '--cool-text-muted': '#9ba1b8',
  '--cool-accent': '#7b8abf',
  '--cool-accent-soft': 'rgba(123, 138, 191, 0.12)',
  '--cool-accent-glow': 'rgba(123, 138, 191, 0.06)',
  '--bubble-user': 'linear-gradient(135deg, rgba(123,138,191,0.12) 0%, rgba(123,138,191,0.06) 100%)',
  '--bubble-ai': 'linear-gradient(135deg, rgba(248,249,253,0.9) 0%, rgba(243,245,252,0.9) 100%)'
};

const WARM_ROOM_POLARIS_DEFAULT_VARIABLES = {
  '--bg': 'linear-gradient(165deg, #fbf7f2 0%, #f5ede3 40%, #f0e6d8 100%)',
  '--surface': 'rgba(255, 252, 248, 0.72)',
  '--surface-solid': '#fffcf8',
  '--surface-deep': 'rgba(255, 252, 248, 0.9)',
  '--border': 'rgba(205, 185, 160, 0.25)',
  '--border-hover': 'rgba(205, 185, 160, 0.45)',
  '--text': '#3d3228',
  '--text-soft': '#8a7c6e',
  '--text-muted': '#b5a898',
  '--accent': '#c4956a',
  '--accent-soft': 'rgba(196, 149, 106, 0.12)',
  '--accent-glow': 'rgba(196, 149, 106, 0.06)',
  '--card-bg': 'linear-gradient(135deg, rgba(255,252,248,0.92) 0%, rgba(250,244,236,0.9) 100%)',
  '--shadow': '0 2px 20px rgba(160, 130, 100, 0.06), 0 0 0 1px rgba(205, 185, 160, 0.12)',
  '--shadow-hover': '0 8px 32px rgba(160, 130, 100, 0.1), 0 0 0 1px rgba(205, 185, 160, 0.2)',
  '--shadow-panel': '0 12px 28px rgba(17, 17, 17, 0.08)',
  '--chat-bg': 'linear-gradient(168deg, #ffffff 0%, #f4f4f4 42%, #e9e9e9 100%)',
  '--cool-bg': 'linear-gradient(168deg, #ffffff 0%, #f4f4f4 42%, #e9e9e9 100%)',
  '--cool-surface': 'rgba(255, 255, 255, 0.74)',
  '--cool-surface-solid': '#ffffff',
  '--cool-surface-deep': 'rgba(245, 245, 245, 0.92)',
  '--cool-border': 'rgba(17, 17, 17, 0.08)',
  '--cool-border-hover': 'rgba(17, 17, 17, 0.22)',
  '--cool-text': '#1a1a1a',
  '--cool-text-soft': '#5d5d5d',
  '--cool-text-muted': '#999999',
  '--cool-accent': '#1a1a1a',
  '--cool-accent-soft': 'rgba(17, 17, 17, 0.08)',
  '--cool-accent-glow': 'rgba(17, 17, 17, 0.08)',
  '--bubble-user': 'linear-gradient(135deg, rgba(24, 24, 24, 0.12) 0%, rgba(24, 24, 24, 0.04) 100%)',
  '--bubble-ai': 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(241,241,241,0.94) 100%)'
};

describe('migratePersistedSpaceState', () => {
  it('uses a new space store version for split theme persistence', () => {
    expect(SPACE_STORE_VERSION).toBe(19);
  });

  it('fills missing theme patch ledger when migrating old same-key payloads', () => {
    const result = migratePersistedSpaceState({
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.patchLedger).toEqual([]);
  });

  it('normalizes old space payloads whose theme sessions predate saved skin and patch arrays', () => {
    const result = migratePersistedSpaceState({
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: 'ghost-skin',
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: ''
      },
      collaboratorThemes: {
        pharos: {
          theme: {
            activePresetId: 'paper-butter',
            activeSavedSkinId: 'ghost-skin',
            cssVariables: {},
            presetCSS: '',
            customCSS: '.app-shell { --accent: hotpink; }',
            generatedCSS: ''
          },
          customization: null
        }
      }
    });

    expect(result.theme?.savedSkins).toEqual([]);
    expect(result.theme?.skinHistory).toEqual([]);
    expect(result.theme?.patchLedger).toEqual([]);
    expect(result.theme?.activeSavedSkinId).toBeNull();
    expect(result.collaboratorThemes?.pharos?.theme?.savedSkins).toEqual([]);
    expect(result.collaboratorThemes?.pharos?.theme?.skinHistory).toEqual([]);
    expect(result.collaboratorThemes?.pharos?.theme?.patchLedger).toEqual([]);
    expect(result.collaboratorThemes?.pharos?.theme?.activeSavedSkinId).toBeNull();
    expect(result.collaboratorThemes?.pharos?.theme?.customCSS).toContain('hotpink');
  });

  it('serializes older hydrated theme objects without a patch ledger', () => {
    const oldHydratedTheme = {
      ...createInitialThemeState(),
      patchLedger: undefined
    };

    expect(() => serializePersistedSpaceState({
      activeWorld: 'collection',
      collectionShelf: 'dialogue',
      frontstageCollaboratorId: null,
      collectionProjectId: null,
      editingCollaboratorId: null,
      screenshotDebugOverlayEnabled: false,
      appLanguage: 'zh-CN',
      displayPreferences: DEFAULT_DISPLAY_PREFERENCES,
      activeCardId: null,
      theme: oldHydratedTheme as unknown as ReturnType<typeof createInitialThemeState>,
      customization: {
        ...DEFAULT_APP_CUSTOMIZATION,
        showChatAvatars: true,
        backgroundAssetId: null,
        customFontAssetIds: [],
        customFontScopeAssignments: {
          global: null,
          titles: null,
          chat: null,
          cards: null
        },
        backgroundOpacity: 0.6,
        backgroundDim: 0.28,
        backgroundBlur: 12,
        backgroundFit: 'cover'
      },
      collaboratorThemes: {}
    })).not.toThrow();
  });

  it('resets pure paper default back to the current default preset', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');

    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'paper-butter',
        activeSavedSkinId: null,
        cssVariables: paperFrame.cssVariables,
        presetCSS: paperFrame.presetCSS,
        customCSS: '',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.presetCSS).toBe('');
  });

  it('preserves theme tool posture while resetting old pure defaults', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');

    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'paper-butter',
        activeSavedSkinId: null,
        cssVariables: paperFrame.cssVariables,
        presetCSS: paperFrame.presetCSS,
        customCSS: '',
        generatedCSS: '',
        toolMode: 'creative',
        selectedSurfaceCodes: ['03'],
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.toolMode).toBe('creative');
    expect(result.theme?.selectedSurfaceCodes).toEqual(['03']);
  });

  it('resets pure legacy polaris default back to the current default preset', () => {
    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: LEGACY_POLARIS_DEFAULT_VARIABLES,
        presetCSS: '',
        customCSS: '',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.cssVariables?.['--cool-accent']).toBe('#1a1a1a');
    expect(result.theme?.cssVariables?.['--chat-bg']).toContain('#ffffff');
  });

  it('resets warm-room polaris default back to the current default preset', () => {
    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: WARM_ROOM_POLARIS_DEFAULT_VARIABLES,
        presetCSS: '',
        customCSS: '',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.cssVariables?.['--warm-accent']).toBe('#1a1a1a');
    expect(result.theme?.cssVariables?.['--warm-bg']).toContain('#ffffff');
  });

  it('keeps customized paper theme untouched', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');

    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'paper-butter',
        activeSavedSkinId: null,
        cssVariables: paperFrame.cssVariables,
        presetCSS: paperFrame.presetCSS,
        customCSS: '.app-shell { --accent: hotpink; }',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('paper-butter');
    expect(result.theme?.customCSS).toContain('hotpink');
  });

  it('keeps customized legacy polaris default untouched', () => {
    const result = migratePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      currentCollaboratorId: null,
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: LEGACY_POLARIS_DEFAULT_VARIABLES,
        presetCSS: '',
        customCSS: '.app-shell { --cool-accent: hotpink; }',
        generatedCSS: '',
        savedSkins: [],
        skinHistory: []
      }
    });

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.customCSS).toContain('hotpink');
    expect(result.theme?.cssVariables?.['--cool-accent']).toBe('#7b8abf');
  });

  it('migrates collaborator-owned theme sessions separately', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');

    const result = migratePersistedSpaceState({
      collaboratorThemes: {
        pharos: {
          theme: {
            activePresetId: 'paper-butter',
            activeSavedSkinId: null,
            cssVariables: paperFrame.cssVariables,
            presetCSS: paperFrame.presetCSS,
            customCSS: '.app-shell { --accent: hotpink; }',
            generatedCSS: '',
            savedSkins: [],
            skinHistory: []
          },
          customization: {
            backgroundAssetId: 'asset-pharos',
            backgroundOpacity: 0.5
          }
        }
      }
    });

    expect(result.collaboratorThemes?.pharos?.theme?.activePresetId).toBe('paper-butter');
    expect(result.collaboratorThemes?.pharos?.theme?.customCSS).toContain('hotpink');
    expect(result.collaboratorThemes?.pharos?.customization?.backgroundAssetId).toBe('asset-pharos');
  });

  it('keeps theme patch ledger records across migration', () => {
    const result = migratePersistedSpaceState({
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        savedSkins: [],
        skinHistory: [],
        patchLedger: [{
          id: 'theme-patch-1',
          previewId: 'preview-1',
          conversationId: 'conv-1',
          kind: 'appendThemeCss',
          label: '整页 · 吐司气泡',
          summary: '追加气泡 CSS',
          status: 'applied',
          layer: 'generated',
          scope: 'chat',
          surfaceLabels: ['用户气泡'],
          patchMode: 'merge',
          detailText: '.bubble.user { border-radius: 999px; }',
          createdAt: 1,
          updatedAt: 2
        }]
      }
    });

    expect(result.theme?.patchLedger).toEqual([expect.objectContaining({
      id: 'theme-patch-1',
      status: 'applied',
      layer: 'generated',
      scope: 'chat',
      detailText: '.bubble.user { border-radius: 999px; }'
    })]);
  });

  it('lifts saved skins out of collaborator sessions into the shared library', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');

    const result = migratePersistedSpaceState({
      theme: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: 'shared-paper',
        savedSkins: [],
        skinHistory: []
      },
      collaboratorThemes: {
        pharos: {
          theme: {
            activePresetId: 'paper-butter',
            activeSavedSkinId: 'shared-paper',
            cssVariables: paperFrame.cssVariables,
            presetCSS: paperFrame.presetCSS,
            customCSS: '',
            generatedCSS: '',
            savedSkins: [{
              id: 'shared-paper',
              name: 'Shared paper',
              sourcePresetId: 'paper-butter',
              cssVariables: paperFrame.cssVariables,
              presetCSS: paperFrame.presetCSS,
              customCSS: '',
              generatedCSS: '',
              createdAt: 1,
              updatedAt: 2
            }],
            skinHistory: []
          }
        }
      }
    });

    expect(result.theme?.savedSkins?.map((savedSkin) => savedSkin.id)).toEqual(['shared-paper']);
    expect(result.theme?.activeSavedSkinId).toBe('shared-paper');
    expect(result.collaboratorThemes?.pharos?.theme?.savedSkins).toEqual([]);
    expect(result.collaboratorThemes?.pharos?.theme?.activeSavedSkinId).toBe('shared-paper');
  });

  it('serializes the visible theme back into the current collaborator session', () => {
    const paperFrame = buildThemeFrameFromPresetId('paper-butter');
    const savedSkin = {
      id: 'shared-paper',
      name: 'Shared paper',
      sourcePresetId: 'paper-butter',
      cssVariables: paperFrame.cssVariables,
      presetCSS: paperFrame.presetCSS,
      customCSS: '',
      generatedCSS: '',
      createdAt: 1,
      updatedAt: 2
    };
    const theme = {
      ...createInitialThemeState(),
      ...paperFrame,
      activeSavedSkinId: 'shared-paper',
      customCSS: '.app-shell { --accent: hotpink; }',
      savedSkins: [savedSkin]
    };

    const result = serializePersistedSpaceState({
      activeWorld: 'chat',
      collectionShelf: 'code',
      frontstageCollaboratorId: 'pharos',
      collectionProjectId: null,
      editingCollaboratorId: 'pharos',
      screenshotDebugOverlayEnabled: false,
      appLanguage: 'zh-CN',
      displayPreferences: DEFAULT_DISPLAY_PREFERENCES,
      activeCardId: null,
      theme,
      customization: {
        ...DEFAULT_APP_CUSTOMIZATION,
        showChatAvatars: false,
        showWorldSwitchHandle: false,
        backgroundAssetId: 'asset-current',
        customFontAssetIds: [],
        customFontScopeAssignments: {
          global: null,
          titles: null,
          chat: null,
          cards: null
        },
        backgroundOpacity: 0.5,
        backgroundDim: 0.2,
        backgroundBlur: 8,
        backgroundFit: 'cover'
      },
      collaboratorThemes: {}
    });

    expect(result.theme?.savedSkins?.map((item) => item.id)).toEqual(['shared-paper']);
    expect(result.collaboratorThemes?.pharos?.theme?.activePresetId).toBe('paper-butter');
    expect(result.collaboratorThemes?.pharos?.theme?.activeSavedSkinId).toBe('shared-paper');
    expect(result.collaboratorThemes?.pharos?.theme?.savedSkins).toEqual([]);
    expect(result.collaboratorThemes?.pharos?.theme?.customCSS).toContain('hotpink');
    expect(result.collaboratorThemes?.pharos?.customization?.backgroundAssetId).toBe('asset-current');
    expect(result.customization?.showWorldSwitchHandle).toBe(false);
    expect(result.collaboratorThemes?.pharos?.customization?.showWorldSwitchHandle).toBe(false);
  });

  it('serializes the committed theme while a preview is active', () => {
    const committedFrame = buildThemeFrameFromPresetId('polaris-default');
    const previewFrame = buildThemeFrameFromPresetId('paper-butter');
    const state: Pick<
      SpaceFrontstageState & SpaceThemeState,
      'activeWorld' | 'collectionShelf' | 'frontstageCollaboratorId' | 'collectionProjectId' | 'editingCollaboratorId' | 'screenshotDebugOverlayEnabled' | 'appLanguage' | 'displayPreferences' | 'activeCardId' | 'activeThemePreview' | 'theme' | 'customization' | 'collaboratorThemes'
    > = {
      activeWorld: 'chat',
      collectionShelf: 'code',
      frontstageCollaboratorId: 'pharos',
      collectionProjectId: null,
      editingCollaboratorId: 'pharos',
      screenshotDebugOverlayEnabled: false,
      appLanguage: 'zh-CN',
      displayPreferences: DEFAULT_DISPLAY_PREFERENCES,
      activeCardId: null,
      activeThemePreview: {
        id: 'preview-1',
        conversationId: 'conv-1',
        before: committedFrame,
        pending: '试穿纸页主题'
      },
      theme: {
        ...createInitialThemeState(),
        ...previewFrame,
        customCSS: '.app-shell { --accent: hotpink; }'
      },
      customization: {
        ...DEFAULT_APP_CUSTOMIZATION,
        showChatAvatars: false,
        backgroundAssetId: 'asset-current',
        customFontAssetIds: [],
        customFontScopeAssignments: {
          global: null,
          titles: null,
          chat: null,
          cards: null
        },
        backgroundOpacity: 0.5,
        backgroundDim: 0.2,
        backgroundBlur: 8,
        backgroundFit: 'cover'
      },
      collaboratorThemes: {}
    };

    const result = serializePersistedSpaceThemeState(state);

    expect(result.theme?.activePresetId).toBe('polaris-default');
    expect(result.theme?.customCSS).toBe('');
    expect(result.collaboratorThemes?.pharos?.theme?.activePresetId).toBe('polaris-default');
    expect(result.collaboratorThemes?.pharos?.theme?.customCSS).toBe('');
    expect(serializePersistedSpaceState(state).theme?.activePresetId).toBe('polaris-default');
  });

  it('keeps localStorage serialization to small frontstage fields only', () => {
    const state: Pick<
      SpaceFrontstageState & SpaceThemeState,
      'activeWorld' | 'collectionShelf' | 'frontstageCollaboratorId' | 'collectionProjectId' | 'editingCollaboratorId' | 'screenshotDebugOverlayEnabled' | 'appLanguage' | 'displayPreferences' | 'activeCardId' | 'theme' | 'customization' | 'collaboratorThemes'
    > = {
      activeWorld: 'chat',
      collectionShelf: 'code',
      frontstageCollaboratorId: 'pharos',
      collectionProjectId: 'project-1',
      editingCollaboratorId: 'pharos',
      screenshotDebugOverlayEnabled: true,
      appLanguage: 'en-US',
      displayPreferences: {
        appearance: 'system',
        hapticsEnabled: false,
        fontScale: 1.12
      },
      activeCardId: 'card-1',
      theme: createInitialThemeState(),
      customization: {
        ...DEFAULT_APP_CUSTOMIZATION,
        showChatAvatars: false,
        backgroundAssetId: 'asset-current',
        customFontAssetIds: [],
        customFontScopeAssignments: {
          global: null,
          titles: null,
          chat: null,
          cards: null
        },
        backgroundOpacity: 0.5,
        backgroundDim: 0.2,
        backgroundBlur: 8,
        backgroundFit: 'cover'
      },
      collaboratorThemes: {}
    };

    expect(serializePersistedSpaceLocalState(state)).toEqual({
      frontstageSchemaVersion: 6,
      activeWorld: 'chat',
      collectionShelf: 'code',
      frontstageCollaboratorId: 'pharos',
      collectionProjectId: 'project-1',
      editingCollaboratorId: 'pharos',
      screenshotDebugOverlayEnabled: true,
      appLanguage: 'en-US',
      displayPreferences: {
        appearance: 'system',
        hapticsEnabled: false,
        fontScale: 1.12
      },
      activeCardId: 'card-1'
    });
    expect(serializePersistedSpaceThemeState(state).theme).toBeTruthy();
  });

});
