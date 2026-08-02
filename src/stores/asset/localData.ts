import {
  buildAssetDomainMetaLocalDataRow,
  buildAssetObjectLocalDataRow,
  getAssetObjectLocalDataRef,
  isLegacyLifecycleAssetState,
  LOCAL_DATA_SCHEMA_VERSION,
  type AssetLocalDataOwnerRef,
  type AssetObjectRow,
  type AssetObjectSeed,
  type LocalDataCommitMeta,
  type LocalDataUnitMutation
} from '../../engines/localData';
import type { AssetLocalDataState } from '../../engines/localData/assetRows';
import type { AssetReferenceOwner } from '../../engines/assetGovernance';
import type { StoredAssetMeta } from '../../infrastructure/assetStore';
import { runExclusiveAssetPersistenceCommit } from '../assetPersistenceCommitQueue';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive
} from '../localDataStorePersistence';

/**
 * The asset object-row write path. Unlike the other domains, asset has no store and no whole-state
 * snapshot writer for ordinary edits — assets are saved/deleted one at a time through the blob
 * stores (`saveAsset` / `deleteAsset`). When the asset domain is the active LocalData source, those
 * blob writes must ALSO keep the new-layer asset object rows consistent, otherwise a freshly saved
 * asset would be invisible to the row-based active read path. These writers are the row half of
 * that pairing; the caller (assetStore) writes the blobs in the same serialized mutation.
 *
 * Owner refs are NOT recomputed here (that is a cross-domain governance scan). A save preserves the
 * existing row's owner refs (a brand-new asset is genuinely orphan until something references it);
 * the orphan / active aggregate counts are refreshed lazily by the migration / governance pass, not
 * per-save. The product getters (`getAssetMeta` / `getAssetBlob` / `listAssetMeta`) never read owner
 * refs, so this drift is diagnostic-only and never loses data.
 */

function assetMetaFromRow(row: AssetObjectRow): StoredAssetMeta | null {
  if (!row.hasMeta) return null;
  if (row.kind !== 'image' && row.kind !== 'file') return null;
  if (typeof row.size !== 'number' || typeof row.createdAt !== 'number') return null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
    textContent: row.textContent
  };
}

function rowToSeed(row: AssetObjectRow): AssetObjectSeed {
  return {
    id: row.id,
    storageKey: row.storageKey ?? row.id,
    meta: assetMetaFromRow(row),
    hasBinary: row.hasBinary,
    hasPreview: row.hasPreview,
    binaryBytes: row.binaryBytes,
    previewBytes: row.previewBytes,
    previewOnly: !row.hasMeta && !row.hasBinary && row.hasPreview,
    ownerRefs: row.ownerRefs
  };
}

function ownerRefToReferenceOwner(ref: AssetLocalDataOwnerRef): AssetReferenceOwner {
  return { kind: ref.kind as AssetReferenceOwner['kind'], id: ref.id, label: ref.label };
}

/** Read the current asset object rows as seeds, keyed by id (complete and incomplete alike). */
async function readAssetSeeds(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<Map<string, AssetObjectSeed>> {
  const seeds = new Map<string, AssetObjectSeed>();
  for (const ref of await discoverLocalDataDomainRefs('asset')) {
    if (ref.kind !== 'asset') continue;
    const result = await repository.read<AssetObjectRow>(ref);
    if (result.status === 'complete') {
      // Sealed legacy lifecycle rows are not live assets: exclude them from the live seed set so a
      // per-asset write never rebuilds an archive row as a live (presence-incomplete) row and never
      // counts it toward the live domain-meta tally.
      if (isLegacyLifecycleAssetState(result.value.state)) continue;
      seeds.set(ref.id, rowToSeed(result.value));
    } else if (result.status === 'incomplete' && result.row?.meta) {
      seeds.set(ref.id, rowToSeed(result.row.meta as AssetObjectRow));
    }
  }
  return seeds;
}

function buildStateFromSeeds(seeds: Iterable<AssetObjectSeed>): AssetLocalDataState {
  const ownersByAssetId = new Map<string, AssetReferenceOwner[]>();
  const meta: StoredAssetMeta[] = [];
  const binary: AssetLocalDataState['binary'] = [];
  const preview: AssetLocalDataState['preview'] = [];
  for (const seed of seeds) {
    if (seed.meta) meta.push(seed.meta);
    if (seed.hasBinary) binary.push({ id: seed.id, storageKey: seed.storageKey, bytes: seed.binaryBytes });
    if (seed.hasPreview) preview.push({ id: seed.id, storageKey: seed.storageKey, bytes: seed.previewBytes });
    ownersByAssetId.set(seed.id, seed.ownerRefs.map(ownerRefToReferenceOwner));
  }
  return { meta, binary, preview, ownersByAssetId };
}

async function commitAssetSeedsWithChange(args: {
  changedId: string;
  upsertSeed: AssetObjectSeed | null;
}): Promise<LocalDataCommitMeta> {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const seeds = await readAssetSeeds(repository);

  if (args.upsertSeed) seeds.set(args.changedId, args.upsertSeed);
  else seeds.delete(args.changedId);

  const domainMetaRow = buildAssetDomainMetaLocalDataRow({
    state: buildStateFromSeeds(seeds.values()),
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: now
  });
  const changeMutation: LocalDataUnitMutation = args.upsertSeed
    ? { type: 'put', row: buildAssetObjectLocalDataRow({ seed: args.upsertSeed, version: LOCAL_DATA_SCHEMA_VERSION, updatedAt: now }) }
    : { type: 'tombstone', ref: getAssetObjectLocalDataRef(args.changedId), version: LOCAL_DATA_SCHEMA_VERSION, deletedAt: now };

  return await repository.commit({
    domain: 'asset',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [{ type: 'put', row: domainMetaRow }, changeMutation]
  });
}

/**
 * Build the upsert seed for a `saveAsset` write, preserving any existing row's owner refs (a save
 * never recomputes owner refs — that is a cross-domain governance scan; a brand-new asset is
 * genuinely orphan until something references it).
 */
async function readSavedAssetUpsertSeed(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  args: { meta: StoredAssetMeta; binaryBytes: number; hasPreview: boolean; previewBytes: number }
): Promise<AssetObjectSeed> {
  const existing = await repository.read<AssetObjectRow>(getAssetObjectLocalDataRef(args.meta.id));
  const existingOwnerRefs: AssetLocalDataOwnerRef[] =
    existing.status === 'complete' ? existing.value.ownerRefs
      : existing.status === 'incomplete' && existing.row?.meta ? (existing.row.meta as AssetObjectRow).ownerRefs
        : [];
  return {
    id: args.meta.id,
    storageKey: args.meta.id,
    meta: args.meta,
    hasBinary: true,
    hasPreview: args.hasPreview,
    binaryBytes: args.binaryBytes,
    previewBytes: args.hasPreview ? args.previewBytes : 0,
    previewOnly: false,
    ownerRefs: existingOwnerRefs
  };
}

/**
 * Upsert one asset's object row from a `saveAsset` write (meta present, binary present, preview
 * presence), preserving any existing owner refs. Returns false when the asset domain is inactive
 * (the legacy blob stores are then the only canonical source). Must be called from inside the
 * shared asset mutation lock, which the blob write already holds.
 */
export async function commitAssetRowUpsertIfActive(args: {
  meta: StoredAssetMeta;
  binaryBytes: number;
  hasPreview: boolean;
  previewBytes: number;
}): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('asset'))) return false;

  const repository = createStoreLocalDataRepository();
  const upsertSeed = await readSavedAssetUpsertSeed(repository, args);
  await commitAssetSeedsWithChange({ changedId: args.meta.id, upsertSeed });
  return true;
}

/**
 * Upsert one asset's object row from an ordinary `saveAsset` write WITH first-write self-activation.
 * Unlike `commitAssetRowUpsertIfActive`, this does NOT require the asset domain to be active already:
 * on a genuinely fresh asset domain it writes the asset object row + domain meta directly and then
 * activates the asset domain from its OWN committed rows via `activateDomainsFromCommittedRows` (no
 * migration validation report — these rows are the product's own current truth, written directly, not
 * a migrated source to reconcile). Ordinary saves are therefore the first write that makes the asset
 * domain active.
 *
 * `hadPreexistingLegacyEntries` is captured by the caller BEFORE it wrote this save's own blob/meta,
 * so this save's own entries never count as preexisting legacy data. When the domain is inactive AND
 * legacy blob entries still exist, self-activation would strand them (the active meta read never
 * falls back to the legacy `asset-meta` store), so this declines and returns false: the caller's blob
 * writes stand alone on the legacy stores, exactly as before, until the explicit import or migration
 * boundary promotes them. The binary/preview blobs remain the byte truth either way — only the
 * meta + presence directory move into rows.
 *
 * Must be called from inside the shared asset mutation lock, which the blob write already holds.
 */
export async function commitAssetRowUpsertActivating(args: {
  meta: StoredAssetMeta;
  binaryBytes: number;
  hasPreview: boolean;
  previewBytes: number;
  hadPreexistingLegacyEntries: boolean;
}): Promise<boolean> {
  const alreadyActive = await isLocalDataRepositoryDomainActive('asset');
  if (!alreadyActive && args.hadPreexistingLegacyEntries) return false;

  const repository = createStoreLocalDataRepository();
  const upsertSeed = await readSavedAssetUpsertSeed(repository, args);
  const commitMeta = await commitAssetSeedsWithChange({ changedId: args.meta.id, upsertSeed });
  if (!alreadyActive) {
    await repository.activateDomainsFromCommittedRows([commitMeta]);
  }
  return true;
}

/**
 * Tombstone one asset's object row from an explicit `deleteAsset`. Returns false when the asset
 * domain is inactive. Deletion is EXPLICIT only — the row layer never tombstones an asset because
 * its blob/meta merely went absent; only a `deleteAsset` call removes it.
 */
export async function commitAssetRowDeleteIfActive(assetId: string): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('asset'))) return false;
  await commitAssetSeedsWithChange({ changedId: assetId, upsertSeed: null });
  return true;
}

/**
 * Reconcile one asset's row after its preview blob was deleted (an orphan preview-cache sweep or a
 * redundant-preview sweep). When the asset still has meta or binary, the row keeps them with its
 * preview fields cleared; a preview-only asset (no meta, no binary) is now empty and is tombstoned.
 * Returns false when the asset domain is inactive. Keeps the active row layer consistent with the
 * blob stores after a governance cleanup, instead of leaving a row that still claims a preview.
 */
export async function commitAssetRowPreviewClearedIfActive(assetId: string): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('asset'))) return false;
  const repository = createStoreLocalDataRepository();
  const existing = await repository.read<AssetObjectRow>(getAssetObjectLocalDataRef(assetId));
  let seed: AssetObjectSeed | null = null;
  if (existing.status === 'complete') seed = rowToSeed(existing.value);
  else if (existing.status === 'incomplete' && existing.row?.meta) seed = rowToSeed(existing.row.meta as AssetObjectRow);
  if (!seed || !seed.hasPreview) return true;

  const cleared: AssetObjectSeed = { ...seed, hasPreview: false, previewBytes: 0, previewOnly: false };
  await commitAssetSeedsWithChange({
    changedId: assetId,
    upsertSeed: !cleared.meta && !cleared.hasBinary ? null : cleared
  });
  return true;
}
