import { createUid } from '../engines/id';
import {
  ASSET_IMPORT_STAGE_STORE,
  ASSET_BINARY_STORE,
  ASSET_META_STORE,
  ASSET_PREVIEW_STORE,
  dbStoreDelete,
  dbStoreEntries,
  dbStoreEntrySizes,
  dbStoreGet,
  dbStoreKeys,
  dbStoreSet,
  type PersistedDbEntry,
  type PersistedDbEntrySize
} from './persistence';
import type { ChatAttachment } from '../types/domain';
import {
  commitAssetRowDeleteIfActive,
  commitAssetRowPreviewClearedIfActive,
  commitAssetRowUpsertActivating,
  commitAssetRowUpsertIfActive
} from '../stores/assetLocalDataPersistence';
import { runExclusiveAssetPersistenceCommit } from '../stores/assetPersistenceCommitQueue';
import {
  readActiveLocalDataSourceForDomain,
  readLocalDataDomainRows,
  type LocalDataReadIntegrity
} from '../stores/localDataStorePersistence';
import {
  readStoreLocalDataValue
} from '../stores/storeLocalDataBackendHost';
import {
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  isLegacyLifecycleAssetState,
  LOCAL_DATA_SCHEMA_VERSION,
  type AssetObjectRow,
  type CommitPointerRow,
  type LocalDataActiveDataSourceRow,
  type LocalDataCompleteRow,
  type LocalDataIncompleteRow,
  type LocalDataStoredRow
} from '../engines/localData';

export type AssetKind = 'image' | 'file';

export type StoredAssetMeta = {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  textContent?: string;
};

export type AssetSnapshotEntry = StoredAssetMeta & {
  dataUrl: string;
  previewDataUrl?: string;
};

export type AssetExportEntry = {
  meta: StoredAssetMeta;
  blob: Blob;
  previewBlob: Blob | null;
};

export type StagedAssetImportEntry = AssetExportEntry & {
  storageKey: string;
};

type DurableAssetImportStage = {
  schemaVersion: 1;
  stageId: string;
  assetCommitId: string;
  createdAt: number;
  entries: Array<{
    assetId: string;
    storageKey: string;
    binaryBytes: number;
    hasPreview: boolean;
    previewBytes: number;
  }>;
  obsoleteStorageKeys: string[];
};

export type AssetImportStage = {
  stageId: string;
  assetCommitId: string;
  entries: StagedAssetImportEntry[];
};

const PENDING_ASSET_IMPORT_STAGE_KEY = 'pending';
const ASSET_IMPORT_STORAGE_KEY_PREFIX = 'asset-import-stage:';

export function runExclusiveAssetMutation<T>(operation: () => Promise<T>): Promise<T> {
  // The blob write path shares the asset persistence queue with row maintenance, so blob facts
  // and active asset rows cannot interleave into a mismatched state.
  return runExclusiveAssetPersistenceCommit(operation);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取资产失败'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return await response.blob();
}

export async function getActiveAssetStorageKey(assetId: string): Promise<string> {
  if (!await isAssetLocalDataDomainActive()) return assetId;
  const persisted = await readStoreLocalDataValue<LocalDataStoredRow<AssetObjectRow>>(
    getLocalDataRowKey({ domain: 'asset', kind: 'asset', id: assetId })
  );
  const row = assetPayloadFromLocalDataRow(persisted);
  return row?.storageKey ?? assetId;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isCommitPointerRow(value: unknown, domain: 'asset'): value is CommitPointerRow {
  if (!isObjectRecord(value)) return false;
  return value.domain === domain
    && typeof value.version === 'number'
    && typeof value.committedAt === 'number'
    && typeof value.commitId === 'string'
    && value.commitId.trim().length > 0;
}

function isLocalDataActiveAssetRow(value: unknown): value is LocalDataActiveDataSourceRow {
  if (!isObjectRecord(value) || !isObjectRecord(value.domains)) return false;
  return value.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
    && value.key === getLocalDataActiveDataSourceKey()
    && value.activeDataSource === 'repository'
    && typeof value.updatedAt === 'number'
    && isCommitPointerRow(value.domains.asset, 'asset');
}

async function isAssetLocalDataDomainActive() {
  return await readActiveLocalDataSourceForDomain('asset') !== null;
}

function assetPayloadFromLocalDataRow(value: unknown): AssetObjectRow | null {
  if (!isObjectRecord(value) || !isObjectRecord(value.ref)) return null;
  if (value.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION) return null;
  if (value.ref.domain !== 'asset' || value.ref.kind !== 'asset' || typeof value.ref.id !== 'string') return null;

  const row = value as Partial<LocalDataCompleteRow<AssetObjectRow> | LocalDataIncompleteRow>;
  // Historical lifecycle rows (archive / recovering / quarantine / missing-body) are not live
  // assets. They are filtered out of EVERY active read here so an old marker can never be read back
  // as live — the exact old-fallback leak this domain retires. Product reads stay row-directory-
  // first over live rows only.
  if (row.state === 'complete' && isObjectRecord(row.value)) {
    const objectRow = row.value as AssetObjectRow;
    return isLegacyLifecycleAssetState(objectRow.state) ? null : objectRow;
  }
  if (row.state === 'incomplete' && isObjectRecord(row.meta)) return row.meta as AssetObjectRow;
  return null;
}

function assetMetaFromLocalDataRow(row: AssetObjectRow): StoredAssetMeta | null {
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

async function listActiveAssetRowsFromLocalData(
  integrity: LocalDataReadIntegrity = 'recover'
): Promise<AssetObjectRow[] | null> {
  if (!await isAssetLocalDataDomainActive()) return null;
  const { rows } = await readLocalDataDomainRows({
    domain: 'asset',
    integrity,
    isRequiredRef: (ref) => ref.kind === 'domainMeta'
  });
  return rows.flatMap((value) => {
    if (value.ref.kind !== 'asset') return [];
    const row = assetPayloadFromLocalDataRow(value);
    return row ? [row] : [];
  });
}

export async function listActiveAssetMetaEntries(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedDbEntry<StoredAssetMeta>[]> {
  const rows = await listActiveAssetRowsFromLocalData(options.integrity);
  if (rows) {
    return rows.flatMap((row) => {
      const meta = assetMetaFromLocalDataRow(row);
      return meta ? [{ key: row.id, value: meta }] : [];
    });
  }
  return await dbStoreEntries<StoredAssetMeta>(ASSET_META_STORE);
}

export async function listActiveAssetBinaryEntries(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedDbEntry<Blob>[]> {
  const rows = await listActiveAssetRowsFromLocalData(options.integrity);
  if (rows) {
    const entries = await Promise.all(rows
      .filter((row) => row.hasBinary)
      .map(async (row): Promise<PersistedDbEntry<Blob> | null> => {
        const blob = await dbStoreGet<Blob>(ASSET_BINARY_STORE, row.storageKey ?? row.id);
        return blob ? { key: row.id, value: blob } : null;
      }));
    return entries.flatMap((entry) => entry ? [entry] : []);
  }
  return await dbStoreEntries<Blob>(ASSET_BINARY_STORE);
}

export async function listActiveAssetPreviewEntries(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<PersistedDbEntry<Blob>[]> {
  const rows = await listActiveAssetRowsFromLocalData(options.integrity);
  if (rows) {
    const entries = await Promise.all(rows
      .filter((row) => row.hasPreview)
      .map(async (row): Promise<PersistedDbEntry<Blob> | null> => {
        const blob = await dbStoreGet<Blob>(ASSET_PREVIEW_STORE, row.storageKey ?? row.id);
        return blob ? { key: row.id, value: blob } : null;
      }));
    return entries.flatMap((entry) => entry ? [entry] : []);
  }
  return await dbStoreEntries<Blob>(ASSET_PREVIEW_STORE);
}

export async function listActiveAssetBinaryEntrySizes(): Promise<PersistedDbEntrySize[]> {
  const rows = await listActiveAssetRowsFromLocalData();
  if (rows) {
    return rows.flatMap((row) => row.hasBinary ? [{ key: row.id, size: row.binaryBytes }] : []);
  }
  return await dbStoreEntrySizes(ASSET_BINARY_STORE);
}

export async function listActiveAssetPreviewEntrySizes(): Promise<PersistedDbEntrySize[]> {
  const rows = await listActiveAssetRowsFromLocalData();
  if (rows) {
    return rows.flatMap((row) => row.hasPreview ? [{ key: row.id, size: row.previewBytes }] : []);
  }
  return await dbStoreEntrySizes(ASSET_PREVIEW_STORE);
}

export async function listActiveAssetBinaryKeys(): Promise<string[]> {
  return (await listActiveAssetBinaryEntrySizes()).map((entry) => entry.key);
}

export async function listActiveAssetPreviewKeys(): Promise<string[]> {
  return (await listActiveAssetPreviewEntrySizes()).map((entry) => entry.key);
}

/**
 * Whether any legacy asset blob-store entries already exist (meta, binary, or preview). An ordinary
 * `saveAsset` self-activates the asset domain ONLY when all three are empty — a genuinely fresh asset
 * domain. Activating while legacy blob entries remain would strand them: the active meta read never
 * falls back to the legacy `asset-meta` store, so an old asset would become unreadable. Old assets
 * are promoted through explicit import or migration boundaries instead, never by an in-place
 * ordinary save.
 *
 * MUST be evaluated BEFORE the current save writes its own blob/meta, otherwise this save's own
 * freshly written entries would be misread as preexisting legacy data.
 */
async function hasPreexistingLegacyAssetStoreEntries(): Promise<boolean> {
  for (const store of [ASSET_META_STORE, ASSET_BINARY_STORE, ASSET_PREVIEW_STORE]) {
    if ((await dbStoreKeys(store)).length > 0) return true;
  }
  return false;
}

async function saveAssetUnlocked(params: {
  id?: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt?: number;
  textContent?: string;
  previewBlob?: Blob | null;
  selfActivate?: boolean;
}): Promise<StoredAssetMeta> {
  const id = params.id ?? createUid('asset');
  const meta: StoredAssetMeta = {
    id,
    kind: params.kind,
    name: params.name,
    mimeType: params.mimeType,
    size: params.blob.size,
    createdAt: params.createdAt ?? Date.now(),
    textContent: params.textContent?.trim() ? params.textContent : undefined
  };

  // First-write self-activation eligibility MUST be decided before this save writes its own blob/meta,
  // otherwise the legacy-emptiness probe would see this save's own freshly written entries. Only the
  // ordinary save path opts in (`selfActivate`); import / replace boundaries never self-activate.
  const alreadyActive = params.selfActivate
    ? await isAssetLocalDataDomainActive()
    : false;
  const hadPreexistingLegacyEntries = params.selfActivate && !alreadyActive
    ? await hasPreexistingLegacyAssetStoreEntries()
    : true;
  const shouldWriteLegacyMeta = !params.selfActivate || (!alreadyActive && hadPreexistingLegacyEntries);

  await dbStoreSet(ASSET_BINARY_STORE, id, params.blob);
  const previewBytes = params.previewBlob?.size ?? 0;
  if (params.previewBlob) {
    await dbStoreSet(ASSET_PREVIEW_STORE, id, params.previewBlob);
  } else {
    await dbStoreDelete(ASSET_PREVIEW_STORE, id);
  }
  if (shouldWriteLegacyMeta) {
    await dbStoreSet(ASSET_META_STORE, id, meta);
  }

  // Keep the asset object row consistent with the blob stores in the same serialized mutation —
  // otherwise a freshly saved asset would be invisible to the row-based active read path. The ordinary
  // save path also self-activates a fresh asset domain from its own committed rows; the import /
  // replace path stays strictly if-active (a no-op when inactive, legacy stores canonical).
  const rowArgs = {
    meta,
    binaryBytes: params.blob.size,
    hasPreview: Boolean(params.previewBlob),
    previewBytes
  };
  if (params.selfActivate) {
    await commitAssetRowUpsertActivating({ ...rowArgs, hadPreexistingLegacyEntries });
  } else {
    await commitAssetRowUpsertIfActive(rowArgs);
  }

  return meta;
}

export async function saveAsset(
  params: Omit<Parameters<typeof saveAssetUnlocked>[0], 'selfActivate'>
): Promise<StoredAssetMeta> {
  return await runExclusiveAssetMutation(() => saveAssetUnlocked({ ...params, selfActivate: true }));
}

export async function createAttachmentFromAsset(params: {
  id?: string;
  assetId: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
}): Promise<ChatAttachment> {
  return {
    id: params.id ?? createUid('attachment'),
    assetId: params.assetId,
    kind: params.kind,
    name: params.name,
    mimeType: params.mimeType,
    size: params.size,
    textContent: params.textContent?.trim() ? params.textContent : undefined
  };
}

export async function createStoredAttachment(params: {
  id?: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt?: number;
  textContent?: string;
  previewBlob?: Blob | null;
}): Promise<ChatAttachment> {
  const meta = await saveAsset(params);
  return await createAttachmentFromAsset({
    id: params.id,
    assetId: meta.id,
    kind: meta.kind,
    name: meta.name,
    mimeType: meta.mimeType,
    size: meta.size,
    textContent: meta.textContent
  });
}

export async function createStoredAttachmentFromDataUrl(params: {
  id?: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  dataUrl: string;
  createdAt?: number;
  textContent?: string;
  previewDataUrl?: string;
}): Promise<ChatAttachment> {
  const [blob, previewBlob] = await Promise.all([
    dataUrlToBlob(params.dataUrl),
    params.previewDataUrl ? dataUrlToBlob(params.previewDataUrl) : Promise.resolve(null)
  ]);

  return await createStoredAttachment({
    id: params.id,
    kind: params.kind,
    name: params.name,
    mimeType: params.mimeType,
    blob,
    createdAt: params.createdAt,
    textContent: params.textContent,
    previewBlob
  });
}

export async function getAssetMeta(assetId: string): Promise<StoredAssetMeta | null> {
  const rows = await listActiveAssetRowsFromLocalData();
  if (rows) {
    // Active asset row source: the row directory is the only truth. An id with no row reads as
    // null — never fall back to the legacy `asset-meta` store, otherwise an old asset that is NOT
    // in the new directory would be read back as live (the exact leak this domain retires).
    const row = rows.find((entry) => entry.id === assetId);
    return row ? assetMetaFromLocalDataRow(row) : null;
  }
  return await dbStoreGet<StoredAssetMeta>(ASSET_META_STORE, assetId);
}

export async function listAssetMeta(options: {
  integrity?: LocalDataReadIntegrity;
} = {}): Promise<StoredAssetMeta[]> {
  const entries = await listActiveAssetMetaEntries(options);
  return entries.map((entry) => entry.value);
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  return await dbStoreGet<Blob>(ASSET_BINARY_STORE, await getActiveAssetStorageKey(assetId));
}

export async function getAssetPreviewBlob(assetId: string): Promise<Blob | null> {
  return await dbStoreGet<Blob>(ASSET_PREVIEW_STORE, await getActiveAssetStorageKey(assetId));
}

export async function getAssetDataUrl(assetId: string): Promise<string | null> {
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;
  return await blobToDataUrl(blob);
}

export async function getAssetPreviewUrl(assetId: string): Promise<string | null> {
  const previewBlob = await getAssetPreviewBlob(assetId);
  if (previewBlob) {
    return await blobToDataUrl(previewBlob);
  }
  return await getAssetDataUrl(assetId);
}

async function deleteAssetUnlocked(assetId: string): Promise<void> {
  await deleteAssetStorageEntries(await getActiveAssetStorageKey(assetId));
  // Explicit delete: tombstone the active asset row too (never by absence — only this call removes
  // the row). A no-op when the asset domain is inactive.
  await commitAssetRowDeleteIfActive(assetId);
}

async function deleteAssetStorageEntries(storageKey: string): Promise<void> {
  await Promise.all([
    dbStoreDelete(ASSET_BINARY_STORE, storageKey),
    dbStoreDelete(ASSET_META_STORE, storageKey),
    dbStoreDelete(ASSET_PREVIEW_STORE, storageKey)
  ]);
}

export async function deleteActiveAssetStorageEntries(assetId: string): Promise<void> {
  await deleteAssetStorageEntries(await getActiveAssetStorageKey(assetId));
  // Explicit governance delete: tombstone the active asset row too, so the row layer never claims
  // an asset whose blob/meta have been cleared. A no-op when the asset domain is inactive.
  await commitAssetRowDeleteIfActive(assetId);
}

export async function deleteActiveAssetPreviewEntry(assetId: string): Promise<void> {
  await dbStoreDelete(ASSET_PREVIEW_STORE, await getActiveAssetStorageKey(assetId));
  // Keep the active asset row consistent: clear its preview fields, or tombstone a now-empty
  // preview-only asset. A no-op when the asset domain is inactive.
  await commitAssetRowPreviewClearedIfActive(assetId);
}

export async function deleteAsset(assetId: string): Promise<void> {
  await runExclusiveAssetMutation(() => deleteAssetUnlocked(assetId));
}

export async function exportAssetSnapshot(): Promise<AssetSnapshotEntry[]> {
  const [metaEntries, binaryEntries, previewEntries] = await Promise.all([
    listActiveAssetMetaEntries(),
    listActiveAssetBinaryEntries(),
    listActiveAssetPreviewEntries()
  ]);
  const binaryById = new Map(binaryEntries.map((entry) => [entry.key, entry.value]));
  const previewById = new Map(previewEntries.map((entry) => [entry.key, entry.value]));

  return await Promise.all(
    metaEntries.map(async ({ key, value }) => {
      const blob = binaryById.get(key);
      if (!blob) {
        throw new Error(`资产 ${key} 缺少二进制内容`);
      }

      const previewBlob = previewById.get(key) ?? null;
      return {
        ...value,
        dataUrl: await blobToDataUrl(blob),
        previewDataUrl: previewBlob ? await blobToDataUrl(previewBlob) : undefined
      };
    })
  );
}

export async function exportAssetEntries(): Promise<AssetExportEntry[]> {
  const [metaEntries, binaryEntries, previewEntries] = await Promise.all([
    listActiveAssetMetaEntries({ integrity: 'strict' }),
    listActiveAssetBinaryEntries({ integrity: 'strict' }),
    listActiveAssetPreviewEntries({ integrity: 'strict' })
  ]);
  const binaryById = new Map(binaryEntries.map((entry) => [entry.key, entry.value]));
  const previewById = new Map(previewEntries.map((entry) => [entry.key, entry.value]));

  return metaEntries.map(({ key, value }) => {
    const blob = binaryById.get(key);
    if (!blob) {
      throw new Error(`资产 ${key} 缺少二进制内容`);
    }

    return {
      meta: value,
      blob,
      previewBlob: previewById.get(key) ?? null
    };
  });
}

async function replaceAssetSnapshotUnlocked(snapshot: AssetSnapshotEntry[]): Promise<void> {
  const entries = await Promise.all(snapshot.map(async (entry): Promise<AssetExportEntry> => {
    const [blob, previewBlob] = await Promise.all([
      dataUrlToBlob(entry.dataUrl),
      entry.previewDataUrl ? dataUrlToBlob(entry.previewDataUrl) : Promise.resolve(null)
    ]);
    return {
      meta: {
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        mimeType: entry.mimeType,
        size: blob.size,
        createdAt: entry.createdAt,
        textContent: entry.textContent
      },
      blob,
      previewBlob
    };
  }));

  await replaceAssetEntriesUnlocked(entries);
}

export async function replaceAssetSnapshot(snapshot: AssetSnapshotEntry[]): Promise<void> {
  await runExclusiveAssetMutation(() => replaceAssetSnapshotUnlocked(snapshot));
}

async function replaceAssetEntriesUnlocked(
  entries: AssetExportEntry[],
  options: { onProgress?: (current: number, total: number) => void } = {}
): Promise<void> {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    await saveAssetUnlocked({
      id: entry.meta.id,
      kind: entry.meta.kind,
      name: entry.meta.name,
      mimeType: entry.meta.mimeType,
      blob: entry.blob,
      createdAt: entry.meta.createdAt,
      textContent: entry.meta.textContent,
      previewBlob: entry.previewBlob
    });
    options.onProgress?.(index + 1, entries.length);
  }
}

export async function replaceAssetEntries(
  entries: AssetExportEntry[],
  options: { onProgress?: (current: number, total: number) => void } = {}
): Promise<void> {
  await runExclusiveAssetMutation(() => replaceAssetEntriesUnlocked(entries, options));
}

export async function stageAssetImportEntries(
  entries: AssetExportEntry[],
  options: {
    assetCommitId: string;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<AssetImportStage> {
  await recoverPendingAssetImportStage();
  return await runExclusiveAssetMutation(async () => {
    const stageId = createUid('asset-import');
    const stagedEntries = entries.map((entry): StagedAssetImportEntry => ({
      ...entry,
      storageKey: `${ASSET_IMPORT_STORAGE_KEY_PREFIX}${stageId}:${entry.meta.id}`
    }));
    const manifest: DurableAssetImportStage = {
      schemaVersion: 1,
      stageId,
      assetCommitId: options.assetCommitId,
      createdAt: Date.now(),
      entries: stagedEntries.map((entry) => ({
        assetId: entry.meta.id,
        storageKey: entry.storageKey,
        binaryBytes: entry.blob.size,
        hasPreview: Boolean(entry.previewBlob),
        previewBytes: entry.previewBlob?.size ?? 0
      })),
      obsoleteStorageKeys: await listCurrentAssetStorageKeys()
    };

    // The durable manifest lands before the first staged byte. A process death after this point
    // leaves enough persisted evidence for startup to abandon or finish the stage without memory.
    await dbStoreSet(ASSET_IMPORT_STAGE_STORE, PENDING_ASSET_IMPORT_STAGE_KEY, manifest);

    for (let index = 0; index < stagedEntries.length; index += 1) {
      const entry = stagedEntries[index]!;
      await dbStoreSet(ASSET_BINARY_STORE, entry.storageKey, entry.blob);
      if (entry.previewBlob) await dbStoreSet(ASSET_PREVIEW_STORE, entry.storageKey, entry.previewBlob);

      const [writtenBlob, writtenPreview] = await Promise.all([
        dbStoreGet<Blob>(ASSET_BINARY_STORE, entry.storageKey),
        entry.previewBlob
          ? dbStoreGet<Blob>(ASSET_PREVIEW_STORE, entry.storageKey)
          : Promise.resolve(null)
      ]);
      if (
        !writtenBlob
        || writtenBlob.size !== entry.blob.size
        || (entry.previewBlob && (!writtenPreview || writtenPreview.size !== entry.previewBlob.size))
      ) {
        throw new Error(`Asset staging verification failed: ${entry.meta.id}`);
      }
      options.onProgress?.(index + 1, stagedEntries.length);
    }

    return { stageId, assetCommitId: options.assetCommitId, entries: stagedEntries };
  });
}

async function listCurrentAssetStorageKeys() {
  const rows = await listActiveAssetRowsFromLocalData();
  if (rows) {
    return Array.from(new Set(rows.map((row) => row.storageKey ?? row.id))).sort();
  }
  const keys = await Promise.all([
    dbStoreKeys(ASSET_BINARY_STORE),
    dbStoreKeys(ASSET_META_STORE),
    dbStoreKeys(ASSET_PREVIEW_STORE)
  ]);
  return Array.from(new Set(keys.flat().filter((key) => !key.startsWith(ASSET_IMPORT_STORAGE_KEY_PREFIX)))).sort();
}

function isDurableAssetImportStage(value: unknown): value is DurableAssetImportStage {
  if (!isObjectRecord(value) || value.schemaVersion !== 1) return false;
  if (
    typeof value.stageId !== 'string'
    || typeof value.assetCommitId !== 'string'
    || typeof value.createdAt !== 'number'
    || !Array.isArray(value.entries)
    || !Array.isArray(value.obsoleteStorageKeys)
  ) return false;
  return value.entries.every((entry) => (
    isObjectRecord(entry)
    && typeof entry.assetId === 'string'
    && typeof entry.storageKey === 'string'
    && entry.storageKey.startsWith(`${ASSET_IMPORT_STORAGE_KEY_PREFIX}${value.stageId}:`)
    && typeof entry.binaryBytes === 'number'
    && Number.isFinite(entry.binaryBytes)
    && entry.binaryBytes >= 0
    && typeof entry.hasPreview === 'boolean'
    && typeof entry.previewBytes === 'number'
    && Number.isFinite(entry.previewBytes)
    && entry.previewBytes >= 0
    && (entry.hasPreview || entry.previewBytes === 0)
  )) && value.obsoleteStorageKeys.every((key) => typeof key === 'string');
}

async function isAssetImportStagePublished(stage: DurableAssetImportStage) {
  const [active, pointer] = await Promise.all([
    readActiveLocalDataSourceForDomain('asset'),
    readStoreLocalDataValue<CommitPointerRow>(getLocalDataCommitPointerKey('asset'))
  ]);
  const activePointer = isLocalDataActiveAssetRow(active) ? active.domains.asset : null;
  if (
    !activePointer
    || !isCommitPointerRow(pointer, 'asset')
    || activePointer.commitId !== stage.assetCommitId
    || pointer.commitId !== stage.assetCommitId
    || activePointer.version !== pointer.version
    || activePointer.committedAt !== pointer.committedAt
  ) return false;

  for (const entry of stage.entries) {
    const persisted = await readStoreLocalDataValue<LocalDataStoredRow<AssetObjectRow>>(
      getLocalDataRowKey({ domain: 'asset', kind: 'asset', id: entry.assetId })
    );
    const row = assetPayloadFromLocalDataRow(persisted);
    if (
      !row
      || (row.storageKey ?? row.id) !== entry.storageKey
      || row.binaryBytes !== entry.binaryBytes
      || row.previewBytes !== entry.previewBytes
      || row.hasPreview !== entry.hasPreview
    ) {
      throw new Error(`Published asset import row does not match its durable stage: ${entry.assetId}`);
    }
    const [blob, preview] = await Promise.all([
      dbStoreGet<Blob>(ASSET_BINARY_STORE, entry.storageKey),
      entry.hasPreview
        ? dbStoreGet<Blob>(ASSET_PREVIEW_STORE, entry.storageKey)
        : Promise.resolve(null)
    ]);
    if (
      !blob
      || blob.size !== entry.binaryBytes
      || (entry.hasPreview && (!preview || preview.size !== entry.previewBytes))
    ) {
      throw new Error(`Published asset import bytes do not match their durable stage: ${entry.assetId}`);
    }
  }
  return true;
}

export async function recoverPendingAssetImportStage(): Promise<'none' | 'abandoned' | 'published'> {
  return await runExclusiveAssetMutation(async () => {
    const persisted = await dbStoreGet<unknown>(ASSET_IMPORT_STAGE_STORE, PENDING_ASSET_IMPORT_STAGE_KEY);
    if (persisted === null) return 'none';
    if (!isDurableAssetImportStage(persisted)) {
      throw new Error('Pending asset import stage manifest is invalid.');
    }

    const published = await isAssetImportStagePublished(persisted);
    const storageKeysToDelete = published
      ? persisted.obsoleteStorageKeys.filter((key) => !persisted.entries.some((entry) => entry.storageKey === key))
      : persisted.entries.map((entry) => entry.storageKey);
    for (const storageKey of storageKeysToDelete) {
      await deleteAssetStorageEntries(storageKey);
    }
    await dbStoreDelete(ASSET_IMPORT_STAGE_STORE, PENDING_ASSET_IMPORT_STAGE_KEY);
    return published ? 'published' : 'abandoned';
  });
}
