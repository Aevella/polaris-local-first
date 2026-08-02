import {
  createLocalDataRepository,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  type CommitPointerRow,
  type LocalDataActiveDataSourceRow,
  type LocalDataRepositoryOptions,
  type LocalDataDomain,
  type LocalDataReadStatus,
  type LocalDataRef,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type LocalDataUnitOfWork
} from '../engines/localData';
import { LOCAL_DATA_NAMESPACE } from '../engines/localData/types';
import {
  getStoreLocalDataBackend,
  listStoreLocalDataKeysWithPrefix,
  readStoreLocalDataValue
} from './storeLocalDataBackendHost';
import {
  fingerprintDiagnosticId,
  reportPersistenceError
} from '../infrastructure/persistenceDiagnostics';

type StoreLocalDataRepositoryOptions = Omit<LocalDataRepositoryOptions, 'backend'>;

export type LocalDataReadIntegrity = 'strict' | 'recover';

export type IsolatedLocalDataRow = {
  ref: LocalDataRef;
  status: Exclude<LocalDataReadStatus, 'complete' | 'deleted'>;
};

export function createStoreLocalDataRepository(options: StoreLocalDataRepositoryOptions = {}) {
  return createLocalDataRepository({
    ...options,
    backend: getStoreLocalDataBackend()
  });
}

export async function readActiveLocalDataSourceForDomain(domain: LocalDataDomain) {
  const row = await readStoreLocalDataValue<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
  if (!isLocalDataActiveDataSourceRow(row)) return null;
  if (row.activeDataSource !== 'repository') return null;
  const activePointer = row.domains[domain];
  if (!isCommitPointerRow(activePointer, domain)) return null;
  const committedPointer = await readStoreLocalDataValue<CommitPointerRow>(getLocalDataCommitPointerKey(domain));
  if (!commitPointersMatch(activePointer, committedPointer)) return null;
  if (!await hasCompleteDomainMetaRow(domain)) return null;
  return row;
}

export async function isLocalDataRepositoryDomainActive(domain: LocalDataDomain) {
  return (await readActiveLocalDataSourceForDomain(domain)) !== null;
}

export function localDataPayloadsMatch(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right);
}

export async function discoverLocalDataDomainRefs(domain: LocalDataDomain) {
  const refs = new Map<string, LocalDataRef>();
  for (const key of await listStoreLocalDataKeysWithPrefix(`${LOCAL_DATA_NAMESPACE}:row:${domain}:`)) {
    const ref = parseLocalDataRowKeyForDomain(key, domain);
    if (!ref) continue;
    refs.set(key, ref);
  }
  return Array.from(refs.values()).sort(compareLocalDataRefs);
}

export async function readLocalDataDomainRows(args: {
  domain: LocalDataDomain;
  integrity: LocalDataReadIntegrity;
  isRequiredRef: (ref: LocalDataRef) => boolean;
}) {
  const repository = createStoreLocalDataRepository();
  const rows: LocalDataStoredRow[] = [];
  const isolatedRows: IsolatedLocalDataRow[] = [];

  for (const ref of await discoverLocalDataDomainRefs(args.domain)) {
    const result = await repository.read(ref);
    if (result.status === 'complete' || result.status === 'deleted') {
      rows.push(result.row);
      continue;
    }

    if (args.integrity === 'strict' || args.isRequiredRef(ref)) {
      throw new Error(`${args.isRequiredRef(ref) ? 'Required' : 'Active'} ${args.domain} LocalData row ${ref.kind}:${ref.id} is ${result.status}.`);
    }

    isolatedRows.push({ ref, status: result.status });
    reportPersistenceError({
      label: '[store:persist:isolation]',
      store: args.domain,
      operation: 'read-isolated-row',
      domain: args.domain,
      stage: 'hydrate-row',
      integrity: 'degraded',
      rowCount: 1,
      fingerprint: fingerprintDiagnosticId(`${ref.kind}:${ref.id}`)
    }, new Error(`Optional ${args.domain} LocalData row was isolated after a ${result.status} read.`));
  }

  return { rows, isolatedRows };
}

export function pruneLocalDataUnitOfWorkToChangedRows(args: {
  unitOfWork: LocalDataUnitOfWork;
  currentRows: LocalDataStoredRow[];
  deletedAt: number;
  skipTombstoneKinds?: string[];
}) {
  const skipTombstoneKinds = new Set(args.skipTombstoneKinds ?? ['domainMeta']);
  const projectedRowKeys = new Set(args.unitOfWork.mutations.flatMap((mutation) => {
    if (mutation.type !== 'put' && mutation.type !== 'restore') return [];
    return [mutation.row.key];
  }));
  const currentRowsByKey = new Map(args.currentRows.map((row) => [row.key, row]));

  const nextMutations: LocalDataUnitMutation[] = [];
  for (const mutation of args.unitOfWork.mutations) {
    if (mutation.type !== 'put' && mutation.type !== 'restore') {
      nextMutations.push(mutation);
      continue;
    }
    const currentRow = currentRowsByKey.get(mutation.row.key);
    if (currentRow?.state === 'deleted' && mutation.type === 'put' && mutation.row.state === 'complete') {
      nextMutations.push({ type: 'restore', row: mutation.row });
      continue;
    }
    if (!currentRow || !localDataPayloadsMatch(currentRow, mutation.row)) nextMutations.push(mutation);
  }
  args.unitOfWork.mutations = nextMutations;

  for (const row of args.currentRows) {
    const ref = row.ref;
    if (skipTombstoneKinds.has(ref.kind)) continue;
    if (projectedRowKeys.has(row.key)) continue;
    if (row.state === 'deleted') continue;
    args.unitOfWork.mutations.push({
      type: 'tombstone',
      ref,
      version: args.unitOfWork.version,
      deletedAt: args.deletedAt
    });
  }

  return args.unitOfWork.mutations.length > 0;
}

function parseLocalDataRowKeyForDomain(key: string, domain: LocalDataDomain): LocalDataRef | null {
  const prefix = `${LOCAL_DATA_NAMESPACE}:row:${domain}:`;
  if (!key.startsWith(prefix)) return null;

  const rowId = key.slice(prefix.length);
  const kindSeparatorIndex = rowId.indexOf(':');
  if (kindSeparatorIndex <= 0) return null;

  const kind = rowId.slice(0, kindSeparatorIndex);
  const id = rowId.slice(kindSeparatorIndex + 1);
  if (!id) return null;

  return { domain, kind, id };
}

function compareLocalDataRefs(left: LocalDataRef, right: LocalDataRef) {
  const leftKey = `${left.kind}:${left.id}`;
  const rightKey = `${right.kind}:${right.id}`;
  return leftKey.localeCompare(rightKey);
}

function isLocalDataActiveDataSourceRow(value: unknown): value is LocalDataActiveDataSourceRow {
  if (!isObjectRecord(value)) return false;
  return value.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
    && value.key === getLocalDataActiveDataSourceKey()
    && value.activeDataSource === 'repository'
    && typeof value.updatedAt === 'number'
    && isObjectRecord(value.domains);
}

function isCommitPointerRow(value: unknown, domain: LocalDataDomain): value is CommitPointerRow {
  if (!isObjectRecord(value)) return false;
  return value.domain === domain
    && typeof value.version === 'number'
    && typeof value.committedAt === 'number'
    && typeof value.commitId === 'string'
    && value.commitId.trim().length > 0;
}

function commitPointersMatch(left: CommitPointerRow, right: unknown): right is CommitPointerRow {
  return isCommitPointerRow(right, left.domain)
    && right.version === left.version
    && right.committedAt === left.committedAt
    && right.commitId === left.commitId;
}

async function hasCompleteDomainMetaRow(domain: LocalDataDomain) {
  const ref: LocalDataRef = { domain, kind: 'domainMeta', id: domain };
  const row = await readStoreLocalDataValue<LocalDataStoredRow>(getLocalDataRowKey(ref));
  return isCompleteLocalDataRowForRef(row, ref);
}

function isCompleteLocalDataRowForRef(value: unknown, ref: LocalDataRef) {
  if (!isObjectRecord(value)) return false;
  const row = value as Partial<LocalDataStoredRow>;
  return row.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
    && row.key === getLocalDataRowKey(ref)
    && row.state === 'complete';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return value === undefined ? 'undefined' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
