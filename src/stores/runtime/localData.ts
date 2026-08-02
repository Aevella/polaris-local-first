import {
  buildRuntimeObjectLocalDataRow,
  buildRuntimeObjectSeeds,
  createCompleteLocalDataRow,
  getRuntimeDomainMetaLocalDataRef,
  getRuntimeObjectLocalDataRef,
  isLegacyLifecycleRuntimeState,
  LOCAL_DATA_SCHEMA_VERSION,
  previewLocalDataStoreHydration,
  toRuntimeObjectId,
  type LocalDataCommitMeta,
  type LocalDataCompleteRow,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type RuntimeDomainMetaRow,
  type RuntimeLocalDataObjectKind,
  type RuntimeObjectLegacyLifecycleState,
  type RuntimeObjectRow,
  type RuntimeObjectSeed,
  type RuntimeObjectState
} from '../../engines/localData';
import type { RuntimePayload } from './index';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  localDataPayloadsMatch,
  readLocalDataDomainRows,
  type LocalDataReadIntegrity
} from '../localDataStorePersistence';
import { runExclusiveRuntimePersistenceCommit } from '../runtimePersistenceCommitQueue';

export type RuntimeObjectLifecycleEntry = {
  kind: RuntimeLocalDataObjectKind;
  id: string;
  state: RuntimeObjectLegacyLifecycleState;
  reason: string | null;
};

/** Historical lifecycle map keyed by object id (`kind:id`). */
export type RuntimeLegacyLifecycleMap = Record<string, RuntimeObjectLifecycleEntry>;

export type RuntimeRepositoryReadResult = {
  payload: RuntimePayload;
  legacyLifecycleByObjectId: RuntimeLegacyLifecycleMap;
};

export async function readRuntimePayloadFromLocalDataRepositoryIfActive(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<RuntimeRepositoryReadResult | null> {
  if (!(await isLocalDataRepositoryDomainActive('runtime'))) return null;

  const rows = await readActiveRuntimeRows(options.integrity ?? 'recover');
  // Partition sealed legacy lifecycle object rows out of the live hydration: only live rows feed
  // the preview that reconstructs the product runtime payload, while archive / recovering /
  // quarantine / missing-body rows are surfaced as a separate lifecycle map.
  const legacyLifecycleByObjectId: RuntimeLegacyLifecycleMap = {};
  const liveRows: LocalDataStoredRow[] = [];
  for (const row of rows) {
    if (row.state === 'complete') {
      const value = row.value as RuntimeRowValue;
      if ('kind' in value && isRuntimeObjectKind(value.kind) && isLegacyLifecycleRuntimeState(value.state)) {
        legacyLifecycleByObjectId[toRuntimeObjectId(value.kind, value.id)] = {
          kind: value.kind,
          id: value.id,
          state: value.state as RuntimeObjectLegacyLifecycleState,
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
  })), ['runtime']);
  const preview = report.previews[0];
  if (preview?.domain !== 'runtime') {
    throw new Error('Active runtime LocalData hydration preview is missing.');
  }
  if (preview.status !== 'hydrated' || !preview.state) {
    throw new Error(`Active runtime LocalData hydration is ${preview.status}: ${preview.blockers.join(', ')}`);
  }

  return { payload: preview.state satisfies RuntimePayload, legacyLifecycleByObjectId };
}

async function readActiveRuntimeRows(integrity: LocalDataReadIntegrity) {
  return (await readLocalDataDomainRows({
    domain: 'runtime',
    integrity,
    isRequiredRef: (ref) => ref.kind === 'domainMeta' || ref.kind === 'settings'
  })).rows;
}

type RuntimeRowValue =
  | RuntimeDomainMetaRow
  | RuntimeObjectRow<RuntimeLocalDataObjectKind>;

/**
 * The runtime objects the row writer owns: the settings singleton plus the provider /
 * mcp-server / companion-connection / trigger-rule rows. The active-provider pointer is a
 * domain-meta field, not an object-row flag.
 */
export type RuntimeRowChange =
  | ({ type: 'upsert' } & RuntimeObjectSeed)
  | { type: 'delete'; kind: RuntimeLocalDataObjectKind; id: string };

const RUNTIME_OBJECT_KINDS: RuntimeLocalDataObjectKind[] = [
  'settings',
  'provider',
  'mcp-server',
  'companion-connection',
  'trigger-rule'
];

type RuntimeObjectIdSets = Record<RuntimeLocalDataObjectKind, Set<string>>;

function emptyRuntimeObjectIdSets(): RuntimeObjectIdSets {
  return {
    settings: new Set(),
    provider: new Set(),
    'mcp-server': new Set(),
    'companion-connection': new Set(),
    'trigger-rule': new Set()
  };
}

function isRuntimeObjectKind(kind: string): kind is RuntimeLocalDataObjectKind {
  return (RUNTIME_OBJECT_KINDS as string[]).includes(kind);
}

type RuntimeObjectRowFacts = {
  /** Live (product-active) object ids, grouped by kind. */
  liveIdSets: RuntimeObjectIdSets;
  /** Count of sealed legacy lifecycle object rows. */
  lifecycleCount: number;
};

async function collectRuntimeObjectRowFacts(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<RuntimeObjectRowFacts> {
  const liveIdSets = emptyRuntimeObjectIdSets();
  let lifecycleCount = 0;
  for (const ref of await discoverLocalDataDomainRefs('runtime')) {
    if (!isRuntimeObjectKind(ref.kind)) continue;
    const result = await repository.read<RuntimeObjectRow>(ref);
    if (result.status !== 'complete') continue;
    if (isLegacyLifecycleRuntimeState(result.value.state)) {
      lifecycleCount += 1;
    } else {
      liveIdSets[ref.kind].add(ref.id);
    }
  }
  return { liveIdSets, lifecycleCount };
}

async function readRuntimeDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<RuntimeDomainMetaRow | null> {
  const result = await repository.read<RuntimeDomainMetaRow>(getRuntimeDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}

function buildRefreshedRuntimeDomainMetaRow(args: {
  activeProviderId: string | null;
  idSets: RuntimeObjectIdSets;
  lifecycleCount: number;
  updatedAt: number;
}) {
  // `objectCounts` and `activeObjectCount` track LIVE objects only; sealed legacy lifecycle rows
  // are never product-active and only add to the total.
  const objectCounts: RuntimeDomainMetaRow['objectCounts'] = {
    settings: args.idSets.settings.size,
    provider: args.idSets.provider.size,
    'mcp-server': args.idSets['mcp-server'].size,
    'companion-connection': args.idSets['companion-connection'].size,
    'trigger-rule': args.idSets['trigger-rule'].size
  };
  const liveObjectCount = Object.values(objectCounts).reduce((sum, count) => sum + count, 0);
  const value: RuntimeDomainMetaRow = {
    id: 'runtime',
    activeProviderId: args.activeProviderId,
    activeObjectCount: liveObjectCount,
    totalObjectCount: liveObjectCount + args.lifecycleCount,
    objectCounts,
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getRuntimeDomainMetaLocalDataRef(),
    value,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: args.updatedAt
  });
}

/**
 * Write a set of single-object runtime changes (settings / provider / mcp-server /
 * companion-connection / trigger-rule upserts and tombstones) together with the refreshed
 * domain meta in one unit of work, instead of rebuilding and diffing the whole-runtime
 * snapshot.
 *
 * The domain-meta `activeProviderId` IS an owned product pointer (it is hydrated back into
 * the store and lives only on the meta, not on a provider row), so it is recorded verbatim
 * from the caller's truth — no "first provider" guess.
 *
 * Returns false only when the runtime repository is inactive (the caller then uses the
 * legacy whole-payload KV store). A change set that writes the same object twice is a
 * caller error and throws, rather than being silently skipped.
 */
export async function commitRuntimeRowChangesIfActive(args: {
  changes: RuntimeRowChange[];
  activeProviderId: string | null;
}): Promise<boolean> {
  return runExclusiveRuntimePersistenceCommit(async () => {
    if (!(await isLocalDataRepositoryDomainActive('runtime'))) return false;
    await commitRuntimeRowChanges(args);
    return true;
  });
}

async function commitRuntimeRowChanges(args: {
  changes: RuntimeRowChange[];
  activeProviderId: string | null;
}): Promise<LocalDataCommitMeta> {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const facts = await collectRuntimeObjectRowFacts(repository);
  const idSets = facts.liveIdSets;
  const objectMutations: LocalDataUnitMutation[] = [];
  const touchedObjectIds = new Set<string>();

  for (const change of args.changes) {
    const objectId = change.type === 'delete'
      ? toRuntimeObjectId(change.kind, change.id)
      : toRuntimeObjectId(change.kind, change.value.id);
    if (touchedObjectIds.has(objectId)) {
      throw new Error(`Runtime row change set writes the same object twice: ${objectId}`);
    }
    touchedObjectIds.add(objectId);

    if (change.type === 'upsert') {
      objectMutations.push({
        type: 'put',
        row: buildRuntimeObjectLocalDataRow({
          kind: change.kind,
          value: change.value,
          version: LOCAL_DATA_SCHEMA_VERSION,
          updatedAt: now
        })
      });
      idSets[change.kind].add(change.value.id);
      continue;
    }

    idSets[change.kind].delete(change.id);
    objectMutations.push({
      type: 'tombstone',
      ref: getRuntimeObjectLocalDataRef(change.kind, change.id),
      version: LOCAL_DATA_SCHEMA_VERSION,
      deletedAt: now
    });
  }

  const domainMetaRow = buildRefreshedRuntimeDomainMetaRow({
    activeProviderId: args.activeProviderId,
    idSets,
    lifecycleCount: facts.lifecycleCount,
    updatedAt: now
  });

  return await repository.commit({
    domain: 'runtime',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [
      { type: 'put', row: domainMetaRow },
      ...objectMutations
    ]
  });
}

/**
 * Strip the synthetic write-time `updatedAt` from a runtime object row before comparison.
 * The settings / provider / mcp-server rows have no natural per-edit timestamp — the
 * builder stamps them with the commit wall-clock — so that stamp is not content and the
 * value diff excludes it. The row wrapper's `updatedAt` is always synthetic; the inner
 * value's `updatedAt` is synthetic ONLY for the settings row (the builder injects now
 * there), while for the other kinds the inner value carries genuine content (a trigger
 * rule's own `updatedAt`, a companion connection's snapshot timestamp), so it is left
 * untouched and still drives change detection.
 */
function normalizeRuntimeRowForDiff(
  row: LocalDataCompleteRow<RuntimeObjectRow<RuntimeLocalDataObjectKind>>
): unknown {
  const objectRow = row.value;
  const innerValue = objectRow.kind === 'settings'
    ? { ...(objectRow.value as Record<string, unknown>), updatedAt: 0 }
    : objectRow.value;
  return {
    ...row,
    updatedAt: 0,
    value: { ...objectRow, updatedAt: 0, value: innerValue }
  };
}

/**
 * Derive the set of runtime object-row changes that turns the current persisted rows into
 * `payload`, by value-diffing each candidate row against the existing row (ignoring the
 * synthetic write-time stamp). Unchanged objects produce no change; a removed provider /
 * mcp-server / companion-connection / trigger-rule produces a tombstone. The settings
 * singleton is always present, so it is only ever upserted, never tombstoned.
 */
async function buildRuntimeRowChangesFromState(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  payload: RuntimePayload
): Promise<RuntimeRowChange[]> {
  const existingRows = new Map<string, LocalDataCompleteRow<RuntimeObjectRow<RuntimeLocalDataObjectKind>>>();
  for (const ref of await discoverLocalDataDomainRefs('runtime')) {
    if (!isRuntimeObjectKind(ref.kind)) continue;
    const result = await repository.read<RuntimeObjectRow<RuntimeLocalDataObjectKind>>(ref);
    if (result.status !== 'complete') continue;
    // Sealed legacy lifecycle rows are out of scope for the live value-diff: absence from the live
    // payload must not tombstone them. They are retained historical evidence, not ordinary
    // product runtime objects.
    if (isLegacyLifecycleRuntimeState(result.value.state)) continue;
    existingRows.set(toRuntimeObjectId(ref.kind, ref.id), result.row);
  }

  const changes: RuntimeRowChange[] = [];
  const presentObjectIds = new Set<string>();
  for (const seed of buildRuntimeObjectSeeds(payload, Date.now())) {
    const candidateRow = buildRuntimeObjectLocalDataRow({
      kind: seed.kind,
      value: seed.value,
      version: LOCAL_DATA_SCHEMA_VERSION,
      updatedAt: Date.now()
    });
    const objectId = candidateRow.value.objectId;
    presentObjectIds.add(objectId);
    const existingRow = existingRows.get(objectId);
    if (!existingRow || !localDataPayloadsMatch(
      normalizeRuntimeRowForDiff(existingRow),
      normalizeRuntimeRowForDiff(candidateRow)
    )) {
      changes.push({ type: 'upsert', ...seed });
    }
  }
  for (const [, row] of existingRows) {
    if (presentObjectIds.has(row.value.objectId)) continue;
    changes.push({ type: 'delete', kind: row.value.kind, id: row.value.id });
  }
  return changes;
}

/**
 * Commit the value-diff of the whole runtime payload through the object-row writer, when
 * the runtime repository is active. This is the normal runtime write path. It does NOT
 * acquire the runtime persistence queue: the caller (persistToDb) holds it. The
 * active-provider pointer is a domain-meta field (not an object row), so an empty object
 * change set still commits when the pointer changed, otherwise that update is lost.
 * Returns false when the runtime repository is inactive, leaving the caller to use the
 * legacy whole-payload KV store.
 */
export async function commitRuntimeRowChangesFromStateIfActive(
  payload: RuntimePayload
): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('runtime'))) return false;
  const repository = createStoreLocalDataRepository();
  const changes = await buildRuntimeRowChangesFromState(repository, payload);
  const previousMeta = await readRuntimeDomainMetaValue(repository);
  const activeProviderChanged = (previousMeta?.activeProviderId ?? null) !== payload.activeProviderId;
  if (changes.length > 0 || activeProviderChanged) {
    await commitRuntimeRowChanges({ changes, activeProviderId: payload.activeProviderId });
  }
  return true;
}

/**
 * The normal runtime save path with first-write self-activation. Unlike
 * `commitRuntimeRowChangesFromStateIfActive`, this does NOT require the runtime domain to be
 * active already: on a fresh install it writes the LocalData runtime rows directly and then
 * activates the runtime domain from its OWN committed rows via
 * `activateDomainsFromCommittedRows` (no migration validation report — these rows are the
 * product's own current truth, written directly, not a migrated source to reconcile). Ordinary
 * runtime saves therefore never write the legacy `runtime-providers-v2` store. It does NOT
 * acquire the runtime persistence queue: the caller (`persistToDb`) holds it, and both the row
 * commit and the activation run inside that one serialized save.
 */
export async function commitRuntimeRowChangesFromStateActivating(
  payload: RuntimePayload
): Promise<void> {
  const repository = createStoreLocalDataRepository();
  const alreadyActive = await isLocalDataRepositoryDomainActive('runtime');
  const changes = await buildRuntimeRowChangesFromState(repository, payload);
  const previousMeta = await readRuntimeDomainMetaValue(repository);
  const activeProviderChanged = (previousMeta?.activeProviderId ?? null) !== payload.activeProviderId;
  // Already active: behave like the value-diff writer — commit only on a real change. Not yet
  // active: always commit so the rows + domain meta + commit pointer exist, then self-activate
  // from that exact commit (the first ordinary save is what makes the runtime domain active).
  if (changes.length === 0 && !activeProviderChanged && alreadyActive) return;
  const meta = await commitRuntimeRowChanges({ changes, activeProviderId: payload.activeProviderId });
  if (!alreadyActive) {
    await repository.activateDomainsFromCommittedRows([meta]);
  }
}
