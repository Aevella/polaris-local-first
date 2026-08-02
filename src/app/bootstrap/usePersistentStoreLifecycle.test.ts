import { describe, expect, it, vi } from 'vitest';
import {
  createLifecyclePersistenceFlush,
  createPersistScheduler,
  flushPersistSchedulerIfHydrated,
  shouldPersistChatState,
  shouldPersistCollectionState,
  shouldPersistPersonaState,
  shouldPersistRuntimeState,
  shouldFlushSpaceThemeStateImmediately,
  shouldPersistSpaceState,
  shouldPersistSpaceThemeState
} from './persistentStoreFlush';
import {
  hydrateStartupStores,
  hydrateSpaceThemeState
} from './persistentStoreHydration';
import type { SpaceThemeHydrationState } from './persistentStoreHydration';

describe('persistent store lifecycle guards', () => {
  it('flushes the latest state even when no debounce is pending', async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => {});
    const scheduler = createPersistScheduler(persist);

    await scheduler.flush();
    scheduler.schedule();
    await scheduler.flush();
    vi.runOnlyPendingTimers();

    expect(persist).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('reports scheduled persistence failures instead of leaking unhandled rejections', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const error = new Error('IndexedDB write failed');
    const persist = vi.fn(async () => {
      throw error;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scheduler = createPersistScheduler(persist);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(180);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[store:persist]', error);
    scheduler.cleanup();

    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries a failed scheduled write until persistence recovers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const error = new Error('IndexedDB write failed once');
    const persist = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scheduler = createPersistScheduler(persist);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(180);
    expect(persist).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('[store:persist]', error);

    scheduler.cleanup();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('backs off repeated scheduled persistence retries after consecutive failures', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const persist = vi.fn(async () => {
      throw new Error('IndexedDB still unavailable');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scheduler = createPersistScheduler(persist);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(180);
    expect(persist).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(persist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5999);
    expect(persist).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(3);

    scheduler.cleanup();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('serializes overlapping persistence writes and reruns once for the latest pending state', async () => {
    const releases: Array<() => void> = [];
    const persist = vi.fn(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    const scheduler = createPersistScheduler(persist);

    const firstFlush = scheduler.flush();
    const secondFlush = scheduler.flush();

    expect(persist).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    releases.shift()?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('does not lifecycle-flush a store before hydration has completed', async () => {
    const flush = vi.fn(async () => {});

    await flushPersistSchedulerIfHydrated({ hydrated: false }, { flush });
    expect(flush).not.toHaveBeenCalled();

    await flushPersistSchedulerIfHydrated({ hydrated: true }, { flush });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('applies the space theme before marking startup theme ready', async () => {
    const persistedTheme = {
      themeState: {
        theme: { activePresetId: 'paper-butter' },
        customization: { backgroundAssetId: 'asset-1' },
        collaboratorThemes: {}
      }
    } as unknown as SpaceThemeHydrationState;
    const events: string[] = [];
    const writeThemeState = vi.fn(async () => {
      events.push('write');
    });

    const hydrated = await hydrateSpaceThemeState({
      readThemeState: async () => persistedTheme,
      writeThemeState,
      setSpaceState: (state) => {
        expect(state).toMatchObject({
          theme: { activePresetId: 'paper-butter' }
        });
        events.push('set-theme');
      },
      setThemeHydrated: (value) => {
        if (value) events.push('hydrated');
      },
      markThemeReady: () => {
        events.push('ready');
      }
    });

    expect(hydrated).toBe(true);
    expect(writeThemeState).not.toHaveBeenCalled();
    expect(events).toEqual(['set-theme', 'hydrated', 'ready']);
  });

  it('keeps theme persistence locked when startup theme hydration fails', async () => {
    const error = new Error('theme db unavailable');
    const reportError = vi.fn();
    const setThemeHydrated = vi.fn();
    const markThemeReady = vi.fn();

    const hydrated = await hydrateSpaceThemeState({
      readThemeState: async () => {
        throw error;
      },
      setThemeHydrated,
      markThemeReady,
      reportError
    });

    expect(hydrated).toBe(false);
    expect(setThemeHydrated).not.toHaveBeenCalled();
    expect(markThemeReady).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it('keeps startup store hydration moving when one store fails', async () => {
    const chatError = new Error('chat db unavailable');
    const reportError = vi.fn();

    const result = await hydrateStartupStores({
      hydrateChat: async () => {
        throw chatError;
      },
      hydratePersona: async () => true,
      hydrateRuntime: async () => false,
      hydrateCollection: async () => ['card-1'],
      reportError
    });

    expect(result).toEqual({
      shouldPersistPersonaAfterHydration: true,
      shouldPersistRuntimeAfterHydration: false
    });
    expect(reportError).toHaveBeenCalledWith('chat', chatError);
  });

  it('does not write chat defaults just because hydration completed', () => {
    expect(shouldPersistChatState(
      { hydrated: true, conversationPersistVersion: 0 },
      { hydrated: false, conversationPersistVersion: 0 }
    )).toBe(false);
  });

  it('writes chat after its store-owned persistence version changes', () => {
    expect(shouldPersistChatState(
      { hydrated: true, conversationPersistVersion: 2 },
      { hydrated: true, conversationPersistVersion: 1 }
    )).toBe(true);
  });

  it('does not write collection defaults just because hydration completed', () => {
    const cards: unknown[] = [];
    const projectFiles: unknown[] = [];
    const roomProjects: unknown[] = [];
    const imageCards: unknown[] = [];

    expect(shouldPersistCollectionState(
      { hydrated: true, cards, projectFiles, roomProjects, imageCards },
      { hydrated: false, cards, projectFiles, roomProjects, imageCards }
    )).toBe(false);
  });

  it('writes collection after a settled hydrated state changes', () => {
    const projectFiles: unknown[] = [];
    const roomProjects: unknown[] = [];
    const imageCards: unknown[] = [];

    expect(shouldPersistCollectionState(
      { hydrated: true, cards: [{}], projectFiles, roomProjects, imageCards },
      { hydrated: true, cards: [], projectFiles, roomProjects, imageCards }
    )).toBe(true);
  });

  it('writes collection after workspace project state changes', () => {
    const cards: unknown[] = [];
    const imageCards: unknown[] = [];

    expect(shouldPersistCollectionState(
      {
        hydrated: true,
        cards,
        projectFiles: [{ id: 'file-1' }],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards
      },
      {
        hydrated: true,
        cards,
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards
      }
    )).toBe(true);

    expect(shouldPersistCollectionState(
      {
        hydrated: true,
        cards,
        projectFiles: [],
        workspaceReferenceDocs: [{ id: 'doc-1' }],
        roomProjects: [],
        imageCards
      },
      {
        hydrated: true,
        cards,
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards
      }
    )).toBe(true);

    expect(shouldPersistCollectionState(
      {
        hydrated: true,
        cards,
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [{ id: 'project-1' }],
        imageCards
      },
      {
        hydrated: true,
        cards,
        projectFiles: [],
        workspaceReferenceDocs: [],
        roomProjects: [],
        imageCards
      }
    )).toBe(true);
  });

  it('writes space theme when the theme payload changes', () => {
    const theme = {};
    const customization = {};
    const collaboratorThemes = {};

    expect(shouldPersistSpaceThemeState(
      { activeThemePreview: null, theme, customization, collaboratorThemes },
      { activeThemePreview: null, theme, customization, collaboratorThemes }
    )).toBe(false);
    expect(shouldPersistSpaceThemeState(
      { activeThemePreview: null, theme: {}, customization, collaboratorThemes },
      { activeThemePreview: null, theme, customization, collaboratorThemes }
    )).toBe(true);
  });

  it('writes space state when persisted frontstage fields change', () => {
    const theme = {};
    const customization = {};
    const collaboratorThemes = {};
    const base = {
      activeThemePreview: null,
      theme,
      customization,
      collaboratorThemes,
      activeWorld: 'collection',
      collectionShelf: 'code',
      frontstageCollaboratorId: null,
      collectionProjectId: null,
      editingCollaboratorId: null,
      screenshotDebugOverlayEnabled: false,
      displayPreferences: { hapticsEnabled: true, fontScale: 1 },
      activeCardId: null
    };

    expect(shouldPersistSpaceState(base, base)).toBe(false);
    expect(shouldPersistSpaceState(
      { ...base, activeCardId: 'card-1' },
      base
    )).toBe(true);
  });

  it('flushes space theme immediately when an active preview settles', () => {
    const theme = {};
    const customization = {};
    const collaboratorThemes = {};

    expect(shouldFlushSpaceThemeStateImmediately(
      { activeThemePreview: null, theme: {}, customization, collaboratorThemes },
      { activeThemePreview: { id: 'preview-1' }, theme, customization, collaboratorThemes }
    )).toBe(true);
    expect(shouldFlushSpaceThemeStateImmediately(
      { activeThemePreview: { id: 'preview-1' }, theme: {}, customization, collaboratorThemes },
      { activeThemePreview: null, theme, customization, collaboratorThemes }
    )).toBe(false);
  });

  it('coalesces overlapping lifecycle flush requests into one pending write', async () => {
    let releaseFlush!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => {
      releaseFlush = resolve;
    }));
    const lifecycleFlush = createLifecyclePersistenceFlush([flush]);

    const first = lifecycleFlush();
    const second = lifecycleFlush();

    expect(first).toBe(second);
    expect(flush).toHaveBeenCalledTimes(1);

    releaseFlush();
    await first;

    const third = lifecycleFlush();
    releaseFlush();
    await third;
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('does not write persona or runtime defaults just because hydration completed', () => {
    const personas: unknown[] = [];
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const conversationSummaryModel = {};
    const memoryVectorRetrieval = {};
    const imageGeneration = {};
    const imageUnderstanding = {};
    const voiceGeneration = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistPersonaState(
      { hydrated: true, personas, activeCollaboratorId: 'pharos', seededDefaultPersonaIds: [] },
      { hydrated: false, personas, activeCollaboratorId: 'pharos', seededDefaultPersonaIds: [] }
    )).toBe(false);
    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: false,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(false);
  });

  it('writes runtime after conversation summary settings change', () => {
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const memoryVectorRetrieval = {};
    const imageGeneration = {};
    const imageUnderstanding = {};
    const voiceGeneration = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel: { enabled: true, autoUpdateEnabled: true },
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel: { enabled: true, autoUpdateEnabled: false },
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(true);
  });

  it('writes runtime after memory vector retrieval settings change', () => {
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const conversationSummaryModel = {};
    const imageGeneration = {};
    const imageUnderstanding = {};
    const voiceGeneration = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval: { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'embed-a' },
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval: { enabled: false, baseUrl: '', model: '' },
        imageGeneration,
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(true);
  });

  it('writes runtime after image generation settings change', () => {
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const conversationSummaryModel = {};
    const memoryVectorRetrieval = {};
    const imageUnderstanding = {};
    const voiceGeneration = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration: { enabled: true, providerId: 'image-provider' },
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration: { enabled: false, providerId: '' },
        imageUnderstanding,
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(true);
  });

  it('writes runtime after image understanding settings change', () => {
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const conversationSummaryModel = {};
    const memoryVectorRetrieval = {};
    const imageGeneration = {};
    const voiceGeneration = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding: { enabled: true, providerId: 'vision-provider' },
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding: { enabled: false, providerId: '' },
        voiceGeneration,
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(true);
  });

  it('writes runtime after voice generation settings change', () => {
    const providers: unknown[] = [];
    const webdav = {};
    const search = {};
    const conversationSummaryModel = {};
    const memoryVectorRetrieval = {};
    const imageGeneration = {};
    const imageUnderstanding = {};
    const toolPromptPreferences = {};
    const mcpServers: unknown[] = [];
    const companionHost = {};
    const companionConnections: unknown[] = [];
    const triggerRules: unknown[] = [];

    expect(shouldPersistRuntimeState(
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration: { enabled: true, providerId: 'voice-provider' },
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      },
      {
        hydrated: true,
        activeProviderId: 'polaris-public',
        providers,
        webdav,
        search,
        conversationSummaryModel,
        memoryVectorRetrieval,
        imageGeneration,
        imageUnderstanding,
        voiceGeneration: { enabled: false, providerId: '' },
        toolPromptPreferences,
        taskModeEnabled: true,
        mcpServers,
        mcpToolTimeoutSeconds: 30,
        companionHost,
        companionConnections,
        triggerRules
      }
    )).toBe(true);
  });
});
