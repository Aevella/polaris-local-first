import type { StoredAssetMeta } from '../../infrastructure/assetStore';
import type { AssetReferenceOwner, AssetReferenceOwnersById } from '../assetGovernance';
import {
  type AssetDomainMetaRow,
  type AssetLocalDataObjectKind,
  type AssetLocalDataOwnerRef,
  type AssetObjectRow,
  type AssetObjectState,
  type LocalDataRef,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type LocalDataUnitOfWork,
  createCompleteLocalDataRow,
  createIncompleteLocalDataRow
} from './types';

export const ASSET_OBJECT_LEGACY_LIFECYCLE_STATES = [
  'archive',
  'recovering',
  'quarantine',
  'missing-body'
] as const satisfies readonly AssetObjectState[];

const ASSET_OBJECT_LEGACY_LIFECYCLE_STATE_SET = new Set<AssetObjectState>(
  ASSET_OBJECT_LEGACY_LIFECYCLE_STATES
);

/** True when the asset object row is a sealed legacy entry, not a live product asset. */
export function isLegacyLifecycleAssetState(state: AssetObjectState | undefined): boolean {
  return state !== undefined && ASSET_OBJECT_LEGACY_LIFECYCLE_STATE_SET.has(state);
}

/** True when the asset object row is a live, product-readable asset. */
export function isLiveProductAssetState(state: AssetObjectState | undefined): boolean {
  return state === undefined || state === 'active';
}

export type AssetBlobEntry = {
  id: string;
  storageKey?: string;
  bytes: number;
};

export type AssetLocalDataState = {
  meta: StoredAssetMeta[];
  binary: AssetBlobEntry[];
  preview: AssetBlobEntry[];
  ownersByAssetId: AssetReferenceOwnersById;
};

export type AssetLocalDataProjection = {
  domainMetaRow: ReturnType<typeof buildAssetDomainMetaLocalDataRow>;
  objectRows: Array<ReturnType<typeof buildAssetObjectLocalDataRow>>;
};

export type AssetObjectSeed = {
  id: string;
  storageKey: string;
  meta: StoredAssetMeta | null;
  binaryBytes: number;
  previewBytes: number;
  ownerRefs: AssetLocalDataOwnerRef[];
  hasBinary: boolean;
  hasPreview: boolean;
  previewOnly: boolean;
};

export function getAssetDomainMetaLocalDataRef(): LocalDataRef {
  return {
    domain: 'asset',
    kind: 'domainMeta',
    id: 'asset'
  };
}

export function getAssetObjectLocalDataRef(assetId: string): LocalDataRef {
  return {
    domain: 'asset',
    kind: 'asset',
    id: assetId
  };
}

function uniqueSortedIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0))).sort();
}

function toOwnerRefs(owners: AssetReferenceOwner[] | undefined): AssetLocalDataOwnerRef[] {
  const byKey = new Map<string, AssetLocalDataOwnerRef>();
  owners?.forEach((owner) => {
    const id = owner.id.trim();
    if (!id) return;
    byKey.set(`${owner.kind}:${id}`, {
      kind: owner.kind,
      id,
      label: owner.label.trim() || id
    });
  });
  return Array.from(byKey.values()).sort((left, right) => (
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
  ));
}

function classifyAssetKind(meta: StoredAssetMeta | null): AssetLocalDataObjectKind {
  if (meta?.kind === 'image' || meta?.kind === 'file') return meta.kind;
  return 'unknown';
}

function buildSeeds(state: AssetLocalDataState): AssetObjectSeed[] {
  const metaById = new Map(state.meta.map((entry) => [entry.id, entry]));
  const binaryById = new Map(state.binary.map((entry) => [entry.id, entry]));
  const previewById = new Map(state.preview.map((entry) => [entry.id, entry]));
  const ids = uniqueSortedIds([
    ...metaById.keys(),
    ...binaryById.keys(),
    ...previewById.keys()
  ]);

  return ids.map((id) => {
    const meta = metaById.get(id) ?? null;
    const hasBinary = binaryById.has(id);
    const hasPreview = previewById.has(id);
    return {
      id,
      storageKey: binaryById.get(id)?.storageKey
        ?? previewById.get(id)?.storageKey
        ?? id,
      meta,
      hasBinary,
      hasPreview,
      binaryBytes: binaryById.get(id)?.bytes ?? 0,
      previewBytes: previewById.get(id)?.bytes ?? 0,
      previewOnly: !meta && !hasBinary && hasPreview,
      ownerRefs: toOwnerRefs(state.ownersByAssetId.get(id))
    };
  });
}

function toAssetObjectRow(seed: AssetObjectSeed, updatedAt: number): AssetObjectRow {
  return {
    id: seed.id,
    objectId: `asset:${seed.id}`,
    storageKey: seed.storageKey,
    kind: classifyAssetKind(seed.meta),
    name: seed.meta?.name ?? seed.id,
    mimeType: seed.meta?.mimeType ?? 'application/octet-stream',
    size: seed.meta?.size ?? null,
    createdAt: seed.meta?.createdAt ?? null,
    textContent: seed.meta?.textContent,
    hasMeta: Boolean(seed.meta),
    hasBinary: seed.hasBinary,
    hasPreview: seed.hasPreview,
    binaryBytes: seed.binaryBytes,
    previewBytes: seed.previewBytes,
    ownerRefs: seed.ownerRefs,
    ownerCount: seed.ownerRefs.length,
    orphan: seed.ownerRefs.length === 0,
    updatedAt: seed.meta?.createdAt ?? updatedAt
  };
}

function resolveIncompleteReason(seed: AssetObjectSeed) {
  if (seed.previewOnly) return 'preview-only';
  if (!seed.meta) return 'missing-meta';
  if (!seed.hasBinary) return 'missing-binary';
  return null;
}

function missingKeysFor(seed: AssetObjectSeed) {
  const missingKeys: string[] = [];
  if (!seed.meta) missingKeys.push(`asset-meta:${seed.id}`);
  if (!seed.hasBinary) missingKeys.push(`asset-binary:${seed.id}`);
  return missingKeys;
}

export function buildAssetObjectLocalDataRow(args: {
  seed: AssetObjectSeed;
  version: number;
  updatedAt: number;
}) {
  const value = toAssetObjectRow(args.seed, args.updatedAt);
  const incompleteReason = resolveIncompleteReason(args.seed);
  if (incompleteReason) {
    return createIncompleteLocalDataRow({
      ref: getAssetObjectLocalDataRef(args.seed.id),
      version: args.version,
      updatedAt: args.updatedAt,
      reason: incompleteReason,
      missingKeys: missingKeysFor(args.seed),
      meta: value
    });
  }

  return createCompleteLocalDataRow({
    ref: getAssetObjectLocalDataRef(args.seed.id),
    value,
    version: args.version,
    updatedAt: value.updatedAt
  });
}

export function buildAssetDomainMetaLocalDataRow(args: {
  state: AssetLocalDataState;
  version: number;
  updatedAt: number;
}) {
  const seeds = buildSeeds(args.state);
  const objectCounts: AssetDomainMetaRow['objectCounts'] = {
    image: seeds.filter((seed) => seed.meta?.kind === 'image').length,
    file: seeds.filter((seed) => seed.meta?.kind === 'file').length,
    unknown: seeds.filter((seed) => !seed.meta).length
  };
  const value: AssetDomainMetaRow = {
    id: 'asset',
    activeObjectCount: seeds.filter((seed) => seed.meta && seed.hasBinary && seed.ownerRefs.length > 0).length,
    totalObjectCount: seeds.length,
    objectCounts,
    orphanObjectCount: seeds.filter((seed) => seed.meta && seed.hasBinary && seed.ownerRefs.length === 0).length,
    missingMetaCount: seeds.filter((seed) => !seed.meta).length,
    missingBinaryCount: seeds.filter((seed) => seed.meta && !seed.hasBinary).length,
    previewOnlyCount: seeds.filter((seed) => seed.previewOnly).length,
    totalBinaryBytes: seeds.reduce((sum, seed) => sum + seed.binaryBytes, 0),
    totalPreviewBytes: seeds.reduce((sum, seed) => sum + seed.previewBytes, 0),
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getAssetDomainMetaLocalDataRef(),
    value,
    version: args.version,
    updatedAt: args.updatedAt
  });
}

export function buildAssetLocalDataProjection(args: {
  state: AssetLocalDataState;
  version: number;
  updatedAt: number;
}): AssetLocalDataProjection {
  return {
    domainMetaRow: buildAssetDomainMetaLocalDataRow(args),
    objectRows: buildSeeds(args.state).map((seed) => buildAssetObjectLocalDataRow({
      seed,
      version: args.version,
      updatedAt: args.updatedAt
    }))
  };
}

export function buildAssetLocalDataUnitOfWork(args: {
  id?: string;
  state: AssetLocalDataState;
  version: number;
  updatedAt: number;
}): LocalDataUnitOfWork {
  const projection = buildAssetLocalDataProjection(args);
  const objectMutations: LocalDataUnitMutation[] = projection.objectRows.map((row) => ({ type: 'put', row }));

  return {
    id: args.id,
    domain: 'asset',
    version: args.version,
    mutations: [
      { type: 'put', row: projection.domainMetaRow },
      ...objectMutations
    ]
  };
}
