import type { AppCustomization, SavedSkin } from '../../types/domain';
import { kvGet, kvSet } from '../../infrastructure/persistence';
import {
  captureCollaboratorThemeSession,
  cloneCollaboratorThemeSession,
  cloneRoomThemeState,
  resolvePersistableCollaboratorTheme
} from '../spaceStoreCollaboratorThemes';
import type { CollaboratorThemeSession, SpaceFrontstageState, SpaceThemeState } from '../spaceStoreTypes';
import { normalizeAppCustomization } from '../runtimeStoreCustomization';
import {
  commitSpaceRowChangesFromStateActivating,
  readSpaceStateFromLocalDataRepositoryIfActive
} from './localData';
import { runExclusiveSpacePersistenceCommit } from '../spacePersistenceCommitQueue';
import { resolveSavedSkinId } from '../spaceStoreTheme';
import {
  migratePersistedSpaceFrontstageState,
  serializePersistedSpaceFrontstageState,
  type PersistedSpaceFrontstageState
} from '../spaceStoreFrontstagePersistence';
export {
  type PersistedSpaceFrontstageState
} from '../spaceStoreFrontstagePersistence';
import {
  migratePersistedThemeState,
  serializePersistedThemeState,
  type PersistedThemeState
} from '../spaceStoreThemePersistence';
export {
  type PersistedThemeState
} from '../spaceStoreThemePersistence';

export const SPACE_THEME_STATE_KEY = 'space-theme-state-v1';

export type PersistedSpaceState = PersistedSpaceFrontstageState & {
  theme?: PersistedThemeState;
  customization?: SpaceThemeState['customization'];
  collaboratorThemes?: Record<string, PersistedCollaboratorThemeSession>;
};

export type PersistedSpaceThemeState = {
  theme?: PersistedThemeState;
  customization?: SpaceThemeState['customization'];
  collaboratorThemes?: Record<string, PersistedCollaboratorThemeSession>;
};
export type MigratedPersistedSpaceThemeState = Pick<SpaceThemeState, 'theme' | 'customization' | 'collaboratorThemes'>;
export type MigratedPersistedSpaceState =
  ReturnType<typeof migratePersistedSpaceFrontstageState>
  & MigratedPersistedSpaceThemeState;
type PersistableSpaceThemeState = Pick<
  SpaceFrontstageState & SpaceThemeState,
  'frontstageCollaboratorId' | 'theme' | 'customization' | 'collaboratorThemes'
> & {
  activeThemePreview?: SpaceThemeState['activeThemePreview'];
};
type PersistableSpaceLocalDataState = Pick<
  SpaceFrontstageState,
  'activeWorld' | 'collectionShelf' | 'frontstageCollaboratorId' | 'collectionProjectId' | 'editingCollaboratorId' | 'screenshotDebugOverlayEnabled' | 'appLanguage' | 'displayPreferences' | 'activeCardId'
> & PersistableSpaceThemeState;

export type PersistedCollaboratorThemeSession = {
  theme?: PersistedThemeState;
  customization?: Partial<AppCustomization> | null;
};

function serializePersistedCollaboratorThemes(
  state: PersistableSpaceThemeState
): Record<string, PersistedCollaboratorThemeSession> {
  const collaboratorThemes = { ...state.collaboratorThemes };
  if (state.frontstageCollaboratorId) {
    collaboratorThemes[state.frontstageCollaboratorId] = captureCollaboratorThemeSession(
      resolvePersistableCollaboratorTheme(state),
      state.customization
    );
  }

  return Object.fromEntries(
    Object.entries(collaboratorThemes).map(([collaboratorId, session]) => [
      collaboratorId,
      {
        theme: serializePersistedThemeState(cloneRoomThemeState(session.theme)),
        customization: normalizeAppCustomization(session.customization)
      }
    ])
  );
}

function cloneSavedSkin(savedSkin: SavedSkin): SavedSkin {
  return {
    ...savedSkin,
    cssVariables: { ...savedSkin.cssVariables },
    recipe: savedSkin.recipe ? { ...savedSkin.recipe } : undefined
  };
}

function mergeSavedSkinLibrary(...sources: SavedSkin[][]) {
  const byId = new Map<string, SavedSkin>();
  for (const source of sources) {
    for (const savedSkin of source) {
      if (byId.has(savedSkin.id)) continue;
      byId.set(savedSkin.id, cloneSavedSkin(savedSkin));
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

function stripCollaboratorSavedSkinLibraries(
  collaboratorThemes: Record<string, CollaboratorThemeSession>,
  sharedSavedSkins: SavedSkin[]
): Record<string, CollaboratorThemeSession> {
  return Object.fromEntries(
    Object.entries(collaboratorThemes).map(([collaboratorId, session]) => [
      collaboratorId,
      cloneCollaboratorThemeSession({
        theme: {
          ...session.theme,
          activeSavedSkinId: resolveSavedSkinId(sharedSavedSkins, session.theme.activeSavedSkinId),
          savedSkins: []
        },
        customization: session.customization
      })
    ])
  );
}

function migratePersistedCollaboratorThemes(
  collaboratorThemes: unknown
): Record<string, CollaboratorThemeSession> {
  if (!collaboratorThemes || typeof collaboratorThemes !== 'object' || Array.isArray(collaboratorThemes)) {
    return {};
  }

  const sessions: Record<string, CollaboratorThemeSession> = {};
  for (const [collaboratorId, rawSession] of Object.entries(collaboratorThemes)) {
    if (!collaboratorId.trim() || !rawSession || typeof rawSession !== 'object' || Array.isArray(rawSession)) {
      continue;
    }
    const session = rawSession as PersistedCollaboratorThemeSession;
    sessions[collaboratorId] = cloneCollaboratorThemeSession({
      theme: migratePersistedThemeState(session.theme),
      customization: normalizeAppCustomization(session.customization)
    });
  }
  return sessions;
}

export function serializePersistedSpaceState(
  state: Pick<
    SpaceFrontstageState,
    'activeWorld' | 'collectionShelf' | 'frontstageCollaboratorId' | 'collectionProjectId' | 'editingCollaboratorId' | 'screenshotDebugOverlayEnabled' | 'appLanguage' | 'displayPreferences' | 'activeCardId'
  > & PersistableSpaceThemeState
): PersistedSpaceState {
  return {
    ...serializePersistedSpaceFrontstageState(state),
    theme: serializePersistedThemeState(resolvePersistableCollaboratorTheme(state)),
    customization: normalizeAppCustomization(state.customization),
    collaboratorThemes: serializePersistedCollaboratorThemes(state)
  };
}

export function serializePersistedSpaceLocalState(
  state: Pick<
    SpaceFrontstageState,
    'activeWorld' | 'collectionShelf' | 'frontstageCollaboratorId' | 'collectionProjectId' | 'editingCollaboratorId' | 'screenshotDebugOverlayEnabled' | 'appLanguage' | 'displayPreferences' | 'activeCardId'
  >
): PersistedSpaceFrontstageState {
  return serializePersistedSpaceFrontstageState(state);
}

export function serializePersistedSpaceThemeState(
  state: PersistableSpaceThemeState
): PersistedSpaceThemeState {
  return {
    theme: serializePersistedThemeState(resolvePersistableCollaboratorTheme(state)),
    customization: normalizeAppCustomization(state.customization),
    collaboratorThemes: serializePersistedCollaboratorThemes(state)
  };
}

export function migratePersistedSpaceThemeState(persistedState: unknown): MigratedPersistedSpaceThemeState {
  const state =
    typeof persistedState === 'object' && persistedState !== null
      ? (persistedState as PersistedSpaceThemeState)
      : {};
  const theme = migratePersistedThemeState(state.theme);
  const collaboratorThemes = migratePersistedCollaboratorThemes(state.collaboratorThemes);
  const liftedSavedSkins = Object.values(collaboratorThemes).flatMap((session) => session.theme.savedSkins);
  const sharedSavedSkins = mergeSavedSkinLibrary(theme.savedSkins, liftedSavedSkins);
  const activeSavedSkinId =
    theme.activeSavedSkinId
    ?? (
      state.theme
      && typeof state.theme === 'object'
      && !Array.isArray(state.theme)
      && typeof state.theme.activeSavedSkinId === 'string'
        ? state.theme.activeSavedSkinId
        : null
    );

  return {
    theme: {
      ...theme,
      activeSavedSkinId: resolveSavedSkinId(sharedSavedSkins, activeSavedSkinId),
      savedSkins: sharedSavedSkins
    },
    customization: normalizeAppCustomization(state.customization),
    collaboratorThemes: stripCollaboratorSavedSkinLibraries(collaboratorThemes, sharedSavedSkins)
  };
}

export function migratePersistedSpaceState(persistedState: unknown): MigratedPersistedSpaceState {
  const state =
    typeof persistedState === 'object' && persistedState !== null
      ? (persistedState as PersistedSpaceState)
      : {};

  return {
    ...migratePersistedSpaceFrontstageState(state),
    ...migratePersistedSpaceThemeState(state)
  };
}

export type PersistedSpaceThemeReadResult = {
  themeState: MigratedPersistedSpaceThemeState;
};

export async function readPersistedSpaceThemeState(options: {
  integrity?: 'strict' | 'recover';
} = {}): Promise<PersistedSpaceThemeReadResult | null> {
  const repositoryRead = await readSpaceStateFromLocalDataRepositoryIfActive(options);
  if (repositoryRead) {
    return {
      themeState: migratePersistedSpaceState(repositoryRead.state)
    };
  }

  const payload = await kvGet<PersistedSpaceThemeState>(SPACE_THEME_STATE_KEY);
  if (payload) return { themeState: migratePersistedSpaceThemeState(payload) };

  return null;
}

export async function writePersistedSpaceThemeState(
  state: PersistableSpaceThemeState
) {
  // One serialized save path. A full space state writes LocalData space rows and, on the
  // first write, self-activates the space domain from its own committed rows; ordinary space
  // saves never write the legacy `space-theme-state-v1` store. A partial (theme-only) state is
  // never a repository state (the real store state is always full), so that defensive branch
  // still uses the legacy KV store; it is not an ordinary product save path.
  await runExclusiveSpacePersistenceCommit(async () => {
    if (isPersistableSpaceLocalDataState(state)) {
      const migrated = migratePersistedSpaceState(serializePersistedSpaceState(state));
      await commitSpaceRowChangesFromStateActivating(migrated);
      return;
    }

    await kvSet(SPACE_THEME_STATE_KEY, serializePersistedSpaceThemeState(state));
  });
}

function isPersistableSpaceLocalDataState(state: PersistableSpaceThemeState): state is PersistableSpaceLocalDataState {
  const candidate = state as Partial<PersistableSpaceLocalDataState>;
  return typeof candidate.activeWorld === 'string'
    && typeof candidate.collectionShelf === 'string'
    && Object.prototype.hasOwnProperty.call(candidate, 'collectionProjectId')
    && Object.prototype.hasOwnProperty.call(candidate, 'editingCollaboratorId')
    && typeof candidate.screenshotDebugOverlayEnabled === 'boolean'
    && typeof candidate.appLanguage === 'string'
    && typeof candidate.displayPreferences === 'object'
    && candidate.displayPreferences !== null
    && Object.prototype.hasOwnProperty.call(candidate, 'activeCardId');
}
