import {
  buildSpaceObjectLocalDataRow,
  buildSpaceObjectSeeds,
  createCompleteLocalDataRow,
  getSpaceDomainMetaLocalDataRef,
  getSpaceObjectLocalDataRef,
  isLegacyLifecycleSpaceState,
  LOCAL_DATA_SCHEMA_VERSION,
  previewLocalDataStoreHydration,
  toSpaceObjectId,
  type LocalDataCommitMeta,
  type LocalDataCompleteRow,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type SpaceDomainMetaRow,
  type SpaceLocalDataObjectKind,
  type SpaceLocalDataState,
  type SpaceObjectLegacyLifecycleState,
  type SpaceObjectRow,
  type SpaceObjectSeed,
  type SpaceObjectState
} from '../../engines/localData';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  localDataPayloadsMatch,
  readLocalDataDomainRows,
  type LocalDataReadIntegrity
} from '../localDataStorePersistence';
import { runExclusiveSpacePersistenceCommit } from '../spacePersistenceCommitQueue';

export type SpaceObjectLifecycleEntry = {
  kind: SpaceLocalDataObjectKind;
  id: string;
  state: SpaceObjectLegacyLifecycleState;
  reason: string | null;
};

/** Historical lifecycle map keyed by object id (`kind:id`). */
export type SpaceLegacyLifecycleMap = Record<string, SpaceObjectLifecycleEntry>;

export type SpaceRepositoryReadResult = {
  state: SpaceLocalDataState;
  legacyLifecycleByObjectId: SpaceLegacyLifecycleMap;
};

export async function readSpaceStateFromLocalDataRepositoryIfActive(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<SpaceRepositoryReadResult | null> {
  if (!(await isLocalDataRepositoryDomainActive('space'))) return null;

  const rows = await readActiveSpaceRows(options.integrity ?? 'recover');
  // Partition sealed legacy lifecycle object rows (collaborator-theme / skin) out of the live
  // hydration: only live rows feed the preview that reconstructs the product space state, while
  // archive / recovering / quarantine / missing-body rows are surfaced as a separate lifecycle map.
  const legacyLifecycleByObjectId: SpaceLegacyLifecycleMap = {};
  const liveRows: LocalDataStoredRow[] = [];
  for (const row of rows) {
    if (row.state === 'complete') {
      const value = row.value as SpaceRowValue;
      if ('kind' in value && isSpaceVariableKind(value.kind) && isLegacyLifecycleSpaceState(value.state)) {
        legacyLifecycleByObjectId[toSpaceObjectId(value.kind, value.id)] = {
          kind: value.kind,
          id: value.id,
          state: value.state as SpaceObjectLegacyLifecycleState,
          reason: value.lifecycleReason ?? null
        };
        continue;
      }
    }
    liveRows.push(row);
  }

  const report = previewLocalDataStoreHydration(liveRows.map((row) => ({
    key: row.key,
    value: row
  })), ['space']);
  const preview = report.previews[0];
  if (preview?.domain !== 'space') {
    throw new Error('Active space LocalData hydration preview is missing.');
  }
  if (preview.status !== 'hydrated' || !preview.state) {
    throw new Error(`Active space LocalData hydration is ${preview.status}: ${preview.blockers.join(', ')}`);
  }

  return { state: preview.state, legacyLifecycleByObjectId };
}

async function readActiveSpaceRows(integrity: LocalDataReadIntegrity) {
  return (await readLocalDataDomainRows({
    domain: 'space',
    integrity,
    isRequiredRef: (ref) => (
      ref.kind === 'domainMeta'
      || ref.kind === 'frontstage'
      || ref.kind === 'theme'
      || ref.kind === 'customization'
    )
  })).rows;
}

type SpaceRowValue =
  | SpaceDomainMetaRow
  | SpaceObjectRow<SpaceLocalDataObjectKind>;

function toPersistableSpaceLocalDataState(state: SpaceLocalDataState): SpaceLocalDataState {
  return {
    activeWorld: state.activeWorld,
    collectionShelf: state.collectionShelf,
    frontstageCollaboratorId: state.frontstageCollaboratorId,
    collectionProjectId: state.collectionProjectId,
    editingCollaboratorId: state.editingCollaboratorId,
    screenshotDebugOverlayEnabled: state.screenshotDebugOverlayEnabled,
    appLanguage: state.appLanguage,
    displayPreferences: state.displayPreferences,
    activeCardId: state.activeCardId,
    theme: state.theme,
    customization: state.customization,
    collaboratorThemes: state.collaboratorThemes
  };
}

/**
 * The space objects the row writer owns: the three singletons (frontstage / theme /
 * customization), the per-collaborator theme rows, and the saved-skin `skin:{id}` rows. The
 * theme row keeps an empty `savedSkins` and records the ordered skin ids in `savedSkinOrder`;
 * each skin lives in its own row, reassembled on hydration in that order.
 */
export type SpaceRowChange =
  | ({ type: 'upsert' } & SpaceObjectSeed)
  | { type: 'delete'; kind: SpaceLocalDataObjectKind; id: string };

// The space object kinds whose row count varies (the singletons are always 1). Both feed
// the domain-meta counts, so a single-object write can refresh them without rebuilding the
// whole-space snapshot.
type SpaceVariableObjectKind = 'collaborator-theme' | 'skin';
type SpaceVariableIdSets = Record<SpaceVariableObjectKind, Set<string>>;

function emptySpaceVariableIdSets(): SpaceVariableIdSets {
  return { 'collaborator-theme': new Set(), skin: new Set() };
}

function isSpaceVariableKind(kind: string): kind is SpaceVariableObjectKind {
  return kind === 'collaborator-theme' || kind === 'skin';
}

type SpaceVariableRowFacts = {
  /** Live (product-active) variable object ids, grouped by kind. */
  liveIdSets: SpaceVariableIdSets;
  /** Count of sealed legacy lifecycle variable rows. */
  lifecycleCount: number;
};

async function collectSpaceVariableRowFacts(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<SpaceVariableRowFacts> {
  const liveIdSets = emptySpaceVariableIdSets();
  let lifecycleCount = 0;
  for (const ref of await discoverLocalDataDomainRefs('space')) {
    if (!isSpaceVariableKind(ref.kind)) continue;
    const result = await repository.read<SpaceObjectRow<SpaceLocalDataObjectKind>>(ref);
    if (result.status !== 'complete') continue;
    if (isLegacyLifecycleSpaceState(result.value.state)) {
      lifecycleCount += 1;
    } else {
      liveIdSets[ref.kind].add(ref.id);
    }
  }
  return { liveIdSets, lifecycleCount };
}

function buildRefreshedSpaceDomainMetaRow(args: {
  frontstageCollaboratorId: string | null;
  collectionProjectId: string | null;
  variableIdSets: SpaceVariableIdSets;
  lifecycleCount: number;
  updatedAt: number;
}) {
  // Space always carries exactly one of each singleton; only the collaborator-theme and skin
  // counts vary. `objectCounts` and `activeObjectCount` track LIVE objects only; sealed legacy
  // lifecycle rows are never product-active and only add to the total.
  const objectCounts: SpaceDomainMetaRow['objectCounts'] = {
    frontstage: 1,
    theme: 1,
    customization: 1,
    'collaborator-theme': args.variableIdSets['collaborator-theme'].size,
    skin: args.variableIdSets.skin.size
  };
  const liveObjectCount = Object.values(objectCounts).reduce((sum, count) => sum + count, 0);
  const value: SpaceDomainMetaRow = {
    id: 'space',
    frontstageCollaboratorId: args.frontstageCollaboratorId,
    collectionProjectId: args.collectionProjectId,
    activeObjectCount: liveObjectCount,
    totalObjectCount: liveObjectCount + args.lifecycleCount,
    objectCounts,
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getSpaceDomainMetaLocalDataRef(),
    value,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: args.updatedAt
  });
}

/**
 * Write a set of single-object space changes (frontstage / theme / customization /
 * collaborator-theme upserts and collaborator-theme tombstones) together with the
 * refreshed domain meta in one unit of work, instead of rebuilding and diffing the
 * whole-space snapshot.
 *
 * The domain-meta `frontstageCollaboratorId` and `collectionProjectId` ARE owned product
 * pointers — they also live on the frontstage row and are hydrated back into the store —
 * so they are recorded verbatim from the caller's truth, not preserved-or-guessed.
 *
 * Returns false only when the space repository is inactive (the caller then uses the
 * legacy whole-state KV store). A change set that writes the same object twice is a
 * caller error and throws, rather than being silently skipped.
 */
export async function commitSpaceRowChangesIfActive(args: {
  changes: SpaceRowChange[];
  frontstageCollaboratorId: string | null;
  collectionProjectId: string | null;
}): Promise<boolean> {
  return runExclusiveSpacePersistenceCommit(async () => {
    if (!(await isLocalDataRepositoryDomainActive('space'))) return false;
    await commitSpaceRowChanges(args);
    return true;
  });
}

async function commitSpaceRowChanges(args: {
  changes: SpaceRowChange[];
  frontstageCollaboratorId: string | null;
  collectionProjectId: string | null;
}): Promise<LocalDataCommitMeta> {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const facts = await collectSpaceVariableRowFacts(repository);
  const variableIdSets = facts.liveIdSets;
  const objectMutations: LocalDataUnitMutation[] = [];
  const touchedObjectIds = new Set<string>();

  for (const change of args.changes) {
    const objectId = change.type === 'delete'
      ? toSpaceObjectId(change.kind, change.id)
      : toSpaceObjectId(change.kind, change.value.id);
    if (touchedObjectIds.has(objectId)) {
      throw new Error(`Space row change set writes the same object twice: ${objectId}`);
    }
    touchedObjectIds.add(objectId);

    if (change.type === 'upsert') {
      objectMutations.push({
        type: 'put',
        row: buildSpaceObjectLocalDataRow({
          kind: change.kind,
          value: change.value,
          version: LOCAL_DATA_SCHEMA_VERSION,
          updatedAt: now
        })
      });
      if (isSpaceVariableKind(change.kind)) variableIdSets[change.kind].add(change.value.id);
      continue;
    }

    if (isSpaceVariableKind(change.kind)) variableIdSets[change.kind].delete(change.id);
    objectMutations.push({
      type: 'tombstone',
      ref: getSpaceObjectLocalDataRef(change.kind, change.id),
      version: LOCAL_DATA_SCHEMA_VERSION,
      deletedAt: now
    });
  }

  const domainMetaRow = buildRefreshedSpaceDomainMetaRow({
    frontstageCollaboratorId: args.frontstageCollaboratorId,
    collectionProjectId: args.collectionProjectId,
    variableIdSets,
    lifecycleCount: facts.lifecycleCount,
    updatedAt: now
  });

  return await repository.commit({
    domain: 'space',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [
      { type: 'put', row: domainMetaRow },
      ...objectMutations
    ]
  });
}

/**
 * Strip the synthetic write-time `updatedAt` from a space object row before comparison.
 * Unlike collection cards (which carry their own content `updatedAt`) or persona
 * collaborators (whose `updatedAt` is derived from the persona version), the space
 * singletons have no natural per-edit timestamp: the builder stamps them with the commit
 * wall-clock at three levels (the stored row, the object row, and the inner value). That
 * stamp is not content, so the value diff excludes it and compares only the owned content
 * — including the genuine nested timestamps inside a theme's saved skins / ledger, which
 * are left untouched.
 */
function normalizeSpaceRowForDiff(row: LocalDataCompleteRow<SpaceObjectRow<SpaceLocalDataObjectKind>>): unknown {
  const innerValue = row.value.value as Record<string, unknown>;
  return {
    ...row,
    updatedAt: 0,
    value: {
      ...row.value,
      updatedAt: 0,
      value: { ...innerValue, updatedAt: 0 }
    }
  };
}

/**
 * Derive the set of space object-row changes that turns the current persisted rows into
 * `state`, by value-diffing each candidate row against the existing row (ignoring the
 * synthetic write-time stamp). Unchanged objects produce no change; a removed
 * collaborator-theme produces a tombstone. The frontstage / theme / customization
 * singletons are always present in `state`, so they are only ever upserted, never
 * tombstoned.
 */
async function buildSpaceRowChangesFromState(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  state: SpaceLocalDataState
): Promise<SpaceRowChange[]> {
  const existingRows = new Map<string, LocalDataCompleteRow<SpaceObjectRow<SpaceLocalDataObjectKind>>>();
  for (const ref of await discoverLocalDataDomainRefs('space')) {
    if (ref.kind === 'domainMeta') continue;
    const result = await repository.read<SpaceObjectRow<SpaceLocalDataObjectKind>>(ref);
    if (result.status !== 'complete') continue;
    // Sealed legacy lifecycle rows are out of scope for the live value-diff: absence from the live
    // state must not tombstone them. They are retained historical evidence, not ordinary product
    // space objects.
    if (isLegacyLifecycleSpaceState(result.value.state)) continue;
    existingRows.set(toSpaceObjectId(ref.kind as SpaceLocalDataObjectKind, ref.id), result.row);
  }

  const changes: SpaceRowChange[] = [];
  const presentObjectIds = new Set<string>();
  for (const seed of buildSpaceObjectSeeds(state, Date.now())) {
    const objectId = toSpaceObjectId(seed.kind, seed.value.id);
    presentObjectIds.add(objectId);
    const candidateRow = buildSpaceObjectLocalDataRow({
      kind: seed.kind,
      value: seed.value,
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: Date.now()
    });
    const existingRow = existingRows.get(objectId);
    if (!existingRow || !localDataPayloadsMatch(
      normalizeSpaceRowForDiff(existingRow),
      normalizeSpaceRowForDiff(candidateRow)
    )) {
      changes.push({ type: 'upsert', ...seed });
    }
  }
  for (const [objectId, row] of existingRows) {
    if (presentObjectIds.has(objectId)) continue;
    changes.push({ type: 'delete', kind: row.value.kind, id: row.value.id });
  }
  return changes;
}

/**
 * Commit the value-diff of the whole space state through the object-row writer, when the
 * space repository is active. This is the normal space write path. It does NOT acquire the
 * space persistence queue: the caller (writePersistedSpaceThemeState) holds it. Returns
 * false when the space repository is inactive, leaving the caller to use the legacy
 * whole-state KV store.
 */
export async function commitSpaceRowChangesFromStateIfActive(
  rawState: SpaceLocalDataState
): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('space'))) return false;
  const repository = createStoreLocalDataRepository();
  const state = toPersistableSpaceLocalDataState(rawState);
  const changes = await buildSpaceRowChangesFromState(repository, state);
  if (changes.length > 0) {
    await commitSpaceRowChanges({
      changes,
      frontstageCollaboratorId: state.frontstageCollaboratorId,
      collectionProjectId: state.collectionProjectId
    });
  }
  return true;
}

/**
 * The normal space save path with first-write self-activation. Unlike
 * `commitSpaceRowChangesFromStateIfActive`, this does NOT require the space domain to be active
 * already: on a fresh install it writes the LocalData space rows directly and then activates
 * the space domain from its OWN committed rows via `activateDomainsFromCommittedRows` (no
 * migration validation report — these rows are the product's own current truth, written
 * directly, not a migrated source to reconcile). Ordinary space saves therefore never write the
 * legacy `space-theme-state-v1` store. It does NOT acquire the space persistence queue: the
 * caller (`writePersistedSpaceThemeState`) holds it, and both the row commit and the activation
 * run inside that one serialized save.
 */
export async function commitSpaceRowChangesFromStateActivating(
  rawState: SpaceLocalDataState
): Promise<void> {
  const repository = createStoreLocalDataRepository();
  const alreadyActive = await isLocalDataRepositoryDomainActive('space');
  const state = toPersistableSpaceLocalDataState(rawState);
  const changes = await buildSpaceRowChangesFromState(repository, state);
  // Already active: behave like the value-diff writer — commit only on a real change. Not yet
  // active: always commit so the rows + domain meta + commit pointer exist, then self-activate
  // from that exact commit (the first ordinary save is what makes the space domain active).
  if (changes.length === 0 && alreadyActive) return;
  const meta = await commitSpaceRowChanges({
    changes,
    frontstageCollaboratorId: state.frontstageCollaboratorId,
    collectionProjectId: state.collectionProjectId
  });
  if (!alreadyActive) {
    await repository.activateDomainsFromCommittedRows([meta]);
  }
}

async function readSpaceDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<SpaceDomainMetaRow | null> {
  const result = await repository.read<SpaceDomainMetaRow>(getSpaceDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}
