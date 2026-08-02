import type {
  CodeCard,
  ImageAssetCard,
  ProjectFile,
  RoomProject,
  WorkspaceReferenceDoc
} from '../../types/domain';
import {
  buildCollectionObjectLocalDataRow,
  createCompleteLocalDataRow,
  getCollectionDomainMetaLocalDataRef,
  getCollectionObjectLocalDataRef,
  isLegacyLifecycleCollectionState,
  LOCAL_DATA_SCHEMA_VERSION,
  previewLocalDataStoreHydration,
  toCollectionObjectId,
  type CollectionDomainMetaRow,
  type CollectionLocalDataObjectKind,
  type CollectionObjectLegacyLifecycleState,
  type CollectionObjectRow,
  type LocalDataStoredRow,
  type LocalDataUnitMutation
} from '../../engines/localData';
import type { PersistedCollectionState } from './index';
import { runExclusiveCollectionPersistenceCommit } from '../collectionPersistenceCommitQueue';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  localDataPayloadsMatch,
  readLocalDataDomainRows,
  type LocalDataReadIntegrity
} from '../localDataStorePersistence';
import {
  stageWorkspaceReferenceDocContentFromDocs,
  stripWorkspaceReferenceDocContent
} from '../workspaceReferenceDocContentPersistence';

export type CollectionObjectLifecycleEntry = {
  kind: CollectionLocalDataObjectKind;
  id: string;
  state: CollectionObjectLegacyLifecycleState;
  reason: string | null;
};

/** Historical lifecycle map keyed by object id (`kind:id`). */
export type CollectionLegacyLifecycleMap = Record<string, CollectionObjectLifecycleEntry>;

export async function readCollectionStateFromLocalDataRepositoryIfActive(options: {
  integrity?: LocalDataReadIntegrity;
} = {}) {
  if (!(await isLocalDataRepositoryDomainActive('collection'))) return null;

  const rows = await readActiveCollectionRows(options.integrity ?? 'recover');
  // Partition sealed legacy lifecycle object rows out of the live hydration: only live rows feed
  // the preview that reconstructs the product collection, while archive / recovering / quarantine
  // / missing-body rows are surfaced as a separate lifecycle map (never as live objects).
  const legacyLifecycleByObjectId: CollectionLegacyLifecycleMap = {};
  const liveRows: LocalDataStoredRow[] = [];
  for (const row of rows) {
    if (row.state === 'complete') {
      const value = row.value as CollectionRowValue;
      if ('kind' in value && isCollectionObjectKind(value.kind) && isLegacyLifecycleCollectionState(value.state)) {
        legacyLifecycleByObjectId[toCollectionObjectId(value.kind, value.id)] = {
          kind: value.kind,
          id: value.id,
          state: value.state as CollectionObjectLegacyLifecycleState,
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
  })), ['collection']);
  const preview = report.previews[0];
  if (preview?.domain !== 'collection') {
    throw new Error('Active collection LocalData hydration preview is missing.');
  }
  if (preview.status !== 'hydrated' || !preview.state) {
    throw new Error(`Active collection LocalData hydration is ${preview.status}: ${preview.blockers.join(', ')}`);
  }

  stageWorkspaceReferenceDocContentFromDocs(preview.state.workspaceReferenceDocs);
  return {
    cards: preview.state.cards,
    imageCards: preview.state.imageCards,
    roomProjects: preview.state.roomProjects,
    projectFiles: preview.state.projectFiles,
    workspaceReferenceDocs: stripWorkspaceReferenceDocContent(preview.state.workspaceReferenceDocs),
    deletedBundledCardIds: preview.state.deletedBundledCardIds ?? [],
    legacyLifecycleByObjectId
  } satisfies PersistedCollectionState;
}

async function readActiveCollectionRows(integrity: LocalDataReadIntegrity) {
  return (await readLocalDataDomainRows({
    domain: 'collection',
    integrity,
    isRequiredRef: (ref) => ref.kind === 'domainMeta'
  })).rows;
}

type CollectionRowValue =
  | CollectionDomainMetaRow
  | CollectionObjectRow<CollectionLocalDataObjectKind>;

/**
 * The collection objects the row writer owns. `workspace-doc` is the workspace
 * reference doc's DIRECTORY row only (title, summary, owning project, entry file
 * relations) — its body is a separate fact owned by the document domain. Writing the
 * directory row here is therefore a complete fact, not a half-write, as long as the
 * persist route also runs the body persistence in the same save path. That pairing is
 * the route's responsibility; this writer only owns the directory object rows.
 */
export type CollectionObjectUpsert =
  | { kind: 'card'; value: CodeCard }
  | { kind: 'image-card'; value: ImageAssetCard }
  | { kind: 'project'; value: RoomProject }
  | { kind: 'project-file'; value: ProjectFile }
  | { kind: 'workspace-doc'; value: WorkspaceReferenceDoc };

export type CollectionRowChange =
  | ({ type: 'upsert' } & CollectionObjectUpsert)
  | { type: 'delete'; kind: CollectionLocalDataObjectKind; id: string };

const COLLECTION_OBJECT_KINDS: CollectionLocalDataObjectKind[] = [
  'card',
  'image-card',
  'project',
  'project-file',
  'workspace-doc'
];

type CollectionObjectIdSets = Record<CollectionLocalDataObjectKind, Set<string>>;

function emptyCollectionObjectIdSets(): CollectionObjectIdSets {
  return {
    card: new Set(),
    'image-card': new Set(),
    project: new Set(),
    'project-file': new Set(),
    'workspace-doc': new Set()
  };
}

function isCollectionObjectKind(kind: string): kind is CollectionLocalDataObjectKind {
  return (COLLECTION_OBJECT_KINDS as string[]).includes(kind);
}

type CollectionObjectRowFacts = {
  /** Live (product-active) object ids, grouped by kind. */
  liveIdSets: CollectionObjectIdSets;
  /** Count of sealed legacy lifecycle object rows across all kinds. */
  lifecycleCount: number;
};

/**
 * Read the existing collection object rows, partitioned into live product rows (grouped by
 * kind) and sealed legacy lifecycle rows, so a single-object write can refresh the domain-meta
 * counts truthfully without rebuilding the whole-collection snapshot — and so the writer never
 * treats a sealed archive row as a live object.
 */
async function collectCollectionObjectRowFacts(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<CollectionObjectRowFacts> {
  const liveIdSets = emptyCollectionObjectIdSets();
  let lifecycleCount = 0;
  for (const ref of await discoverLocalDataDomainRefs('collection')) {
    if (!isCollectionObjectKind(ref.kind)) continue;
    const result = await repository.read<CollectionObjectRow>(ref);
    if (result.status !== 'complete') continue;
    if (isLegacyLifecycleCollectionState(result.value.state)) {
      lifecycleCount += 1;
    } else {
      liveIdSets[ref.kind].add(ref.id);
    }
  }
  return { liveIdSets, lifecycleCount };
}

async function readCollectionDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<CollectionDomainMetaRow | null> {
  const result = await repository.read<CollectionDomainMetaRow>(getCollectionDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}

function uniqueSortedCollectionIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0))).sort();
}

function buildRefreshedCollectionDomainMetaRow(args: {
  activeProjectId: string | null;
  idSets: CollectionObjectIdSets;
  lifecycleCount: number;
  deletedBundledCardIds: string[] | undefined;
  previousDeletedBundledCardIds: string[] | undefined;
  updatedAt: number;
}) {
  // `objectCounts` and `activeObjectCount` track LIVE objects only (what the preview
  // reconstructs); sealed legacy lifecycle rows are never product-active and only add to the
  // total.
  const objectCounts: CollectionDomainMetaRow['objectCounts'] = {
    card: args.idSets.card.size,
    'image-card': args.idSets['image-card'].size,
    project: args.idSets.project.size,
    'project-file': args.idSets['project-file'].size,
    'workspace-doc': args.idSets['workspace-doc'].size
  };
  const liveObjectCount = Object.values(objectCounts).reduce((sum, count) => sum + count, 0);
  const value: CollectionDomainMetaRow = {
    id: 'collection',
    activeProjectId: args.activeProjectId,
    activeObjectCount: liveObjectCount,
    totalObjectCount: liveObjectCount + args.lifecycleCount,
    objectCounts,
    deletedBundledCardIds: uniqueSortedCollectionIds(
      args.deletedBundledCardIds ?? args.previousDeletedBundledCardIds ?? []
    ),
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getCollectionDomainMetaLocalDataRef(),
    value,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: args.updatedAt
  });
}

/**
 * Write a set of single-object collection changes (card, image card, project,
 * project file upserts and tombstones) together with the refreshed domain meta in
 * one unit of work, instead of rebuilding and diffing the whole-collection
 * snapshot.
 *
 * The domain-meta `activeProjectId` is a legacy/health-only field — collection has
 * no product-owned "current project" (the real current workspace lives on the chat
 * `conversation.activeProjectId`). So this writer never owns or guesses it: it keeps
 * the previous pointer when that project still survives the batch, and otherwise
 * writes null. It does not pick "the first project" and does not throw on a deleted
 * active project.
 *
 * Returns false only when the collection repository is inactive (the caller then
 * uses the snapshot/legacy write path). A change set that writes the same object
 * twice is a caller error and throws, rather than being silently skipped.
 */
export async function commitCollectionRowChangesIfActive(args: {
  changes: CollectionRowChange[];
  deletedBundledCardIds?: string[];
}): Promise<boolean> {
  return runExclusiveCollectionPersistenceCommit(async () => {
    if (!(await isLocalDataRepositoryDomainActive('collection'))) return false;
    await commitCollectionRowChanges(args);
    return true;
  });
}

async function commitCollectionRowChanges(args: {
  changes: CollectionRowChange[];
  deletedBundledCardIds?: string[];
}) {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const facts = await collectCollectionObjectRowFacts(repository);
  const idSets = facts.liveIdSets;
  const objectMutations: LocalDataUnitMutation[] = [];
  const touchedObjectIds = new Set<string>();

  for (const change of args.changes) {
    const objectId = change.type === 'delete' ? change.id : change.value.id;
    const dedupeKey = toCollectionObjectId(change.kind, objectId);
    if (touchedObjectIds.has(dedupeKey)) {
      throw new Error(`Collection row change set writes the same object twice: ${dedupeKey}`);
    }
    touchedObjectIds.add(dedupeKey);

    if (change.type === 'upsert') {
      objectMutations.push({
        type: 'put',
        row: buildCollectionObjectLocalDataRow({
          kind: change.kind,
          value: change.value,
          version: LOCAL_DATA_SCHEMA_VERSION
        })
      });
      idSets[change.kind].add(objectId);
      continue;
    }

    idSets[change.kind].delete(objectId);
    objectMutations.push({
      type: 'tombstone',
      ref: getCollectionObjectLocalDataRef(change.kind, objectId),
      version: LOCAL_DATA_SCHEMA_VERSION,
      deletedAt: now
    });
  }

  const previousMeta = await readCollectionDomainMetaValue(repository);
  // Keep the previous legacy/health active-project pointer only while it survives
  // this batch; once its project is tombstoned, the honest value is null (not the
  // first project, and not an error).
  const previousActiveProjectId = previousMeta?.activeProjectId ?? null;
  const activeProjectId = previousActiveProjectId !== null && idSets.project.has(previousActiveProjectId)
    ? previousActiveProjectId
    : null;
  const domainMetaRow = buildRefreshedCollectionDomainMetaRow({
    activeProjectId,
    idSets,
    lifecycleCount: facts.lifecycleCount,
    deletedBundledCardIds: args.deletedBundledCardIds,
    previousDeletedBundledCardIds: previousMeta?.deletedBundledCardIds,
    updatedAt: now
  });

  return await repository.commit({
    domain: 'collection',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [
      { type: 'put', row: domainMetaRow },
      ...objectMutations
    ]
  });
}

type CollectionStateObjectSeed =
  | { kind: 'card'; value: CodeCard }
  | { kind: 'image-card'; value: ImageAssetCard }
  | { kind: 'project'; value: RoomProject }
  | { kind: 'project-file'; value: ProjectFile }
  | { kind: 'workspace-doc'; value: WorkspaceReferenceDoc };

function collectionStateObjectSeeds(state: PersistedCollectionState): CollectionStateObjectSeed[] {
  return [
    ...state.cards.map((value) => ({ kind: 'card' as const, value })),
    ...state.imageCards.map((value) => ({ kind: 'image-card' as const, value })),
    ...state.roomProjects.map((value) => ({ kind: 'project' as const, value })),
    ...state.projectFiles.map((value) => ({ kind: 'project-file' as const, value })),
    ...state.workspaceReferenceDocs.map((value) => ({ kind: 'workspace-doc' as const, value }))
  ];
}

/**
 * Derive the set of collection object-row changes that turns the current persisted
 * rows into `state`, by value-diffing each candidate row against the existing row.
 * This is the sanctioned change detection for collection: its `roomProjects` are a
 * derived reconciliation (new references on most edits), so a hand-maintained dirty
 * set is not a trustworthy boundary — a value-diff of the built row against the stored
 * row is. Unchanged objects produce no change, removed objects produce a tombstone.
 */
async function buildCollectionRowChangesFromState(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  state: PersistedCollectionState
): Promise<CollectionRowChange[]> {
  const existingRows = new Map<string, LocalDataStoredRow>();
  for (const ref of await discoverLocalDataDomainRefs('collection')) {
    if (!isCollectionObjectKind(ref.kind)) continue;
    const result = await repository.read<CollectionObjectRow>(ref);
    if (result.status !== 'complete') continue;
    // Sealed legacy lifecycle rows are out of scope for the live value-diff: they are not in the
    // live collection state and must NOT be tombstoned by their absence from it; these rows are
    // retained historical evidence, not ordinary product objects.
    if (isLegacyLifecycleCollectionState(result.value.state)) continue;
    existingRows.set(toCollectionObjectId(ref.kind, ref.id), result.row);
  }

  const changes: CollectionRowChange[] = [];
  const presentObjectIds = new Set<string>();
  for (const seed of collectionStateObjectSeeds(state)) {
    const objectId = toCollectionObjectId(seed.kind, seed.value.id);
    presentObjectIds.add(objectId);
    const candidateRow = buildCollectionObjectLocalDataRow({
      kind: seed.kind,
      value: seed.value,
      version: LOCAL_DATA_SCHEMA_VERSION
    });
    const existingRow = existingRows.get(objectId);
    if (!existingRow || !localDataPayloadsMatch(existingRow, candidateRow)) {
      changes.push({ type: 'upsert', ...seed });
    }
  }
  for (const [objectId, row] of existingRows) {
    if (presentObjectIds.has(objectId)) continue;
    if (!isCollectionObjectKind(row.ref.kind)) continue;
    changes.push({ type: 'delete', kind: row.ref.kind, id: row.ref.id });
  }
  return changes;
}

/**
 * Commit the value-diff of the whole collection state through the object-row writer,
 * when the collection repository is active. This is the normal collection write path.
 * It does NOT acquire the collection persistence queue: the caller (writeCollectionState)
 * holds it so that the workspace reference doc bodies and these directory rows are
 * written in the same serialized save path. Returns false when the collection
 * repository is inactive, leaving the caller to use the legacy whole-state KV store.
 */
export async function commitCollectionRowChangesFromStateIfActive(
  state: PersistedCollectionState
): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('collection'))) return false;
  const repository = createStoreLocalDataRepository();
  const changes = await buildCollectionRowChangesFromState(repository, state);
  // `deletedBundledCardIds` lives on the collection domain meta, not on an object row,
  // so an empty object change set does not mean the commit is a no-op: commit when the
  // domain-meta deleted-bundled-card set also changed, otherwise that update is lost.
  const previousMeta = await readCollectionDomainMetaValue(repository);
  const deletedBundledCardIdsChanged = !collectionIdListsMatch(
    previousMeta?.deletedBundledCardIds,
    state.deletedBundledCardIds
  );
  if (changes.length > 0 || deletedBundledCardIdsChanged) {
    await commitCollectionRowChanges({ changes, deletedBundledCardIds: state.deletedBundledCardIds });
  }
  return true;
}

/**
 * Commit the whole collection directory state and self-activate the collection domain when a
 * normal collection save first creates rows. This owns only collection directory rows; workspace
 * reference document bodies remain governed by the document-domain writer that the outer save
 * path calls first. Old collection KV is not a normal fallback in Polaris; it is import /
 * migration evidence only.
 */
export async function commitCollectionRowChangesFromStateActivating(
  state: PersistedCollectionState
): Promise<boolean> {
  const alreadyActive = await isLocalDataRepositoryDomainActive('collection');

  const repository = createStoreLocalDataRepository();
  const changes = await buildCollectionRowChangesFromState(repository, state);
  const previousMeta = await readCollectionDomainMetaValue(repository);
  const deletedBundledCardIdsChanged = !collectionIdListsMatch(
    previousMeta?.deletedBundledCardIds,
    state.deletedBundledCardIds
  );

  if (changes.length === 0 && !deletedBundledCardIdsChanged && alreadyActive) {
    return true;
  }

  const meta = await commitCollectionRowChanges({
    changes,
    deletedBundledCardIds: state.deletedBundledCardIds
  });
  if (!alreadyActive) {
    await repository.activateDomainsFromCommittedRows([meta]);
  }
  return true;
}

function collectionIdListsMatch(left: string[] | undefined, right: string[] | undefined) {
  const leftIds = uniqueSortedCollectionIds(left ?? []);
  const rightIds = uniqueSortedCollectionIds(right ?? []);
  if (leftIds.length !== rightIds.length) return false;
  return leftIds.every((id, index) => id === rightIds[index]);
}
