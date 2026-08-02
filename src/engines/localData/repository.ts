import {
  LOCAL_DATA_SCHEMA_VERSION,
  type CommitPointerRow,
  type LocalDataActiveDataSourceRow,
  type LocalDataBackend,
  type LocalDataBackendMutation,
  type LocalDataCommitMeta,
  type LocalDataDeletedRow,
  type LocalDataMigrationValidationReport,
  type LocalDataReadResult,
  type LocalDataRef,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type LocalDataUnitOfWork,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  getLocalDataRowKey
} from './types';
import {
  LocalDataMigrationValidationError,
  assertValidMigrationPromotionReport
} from './migrationValidation';

export type UntrustedPersistenceReason = 'backend-error' | 'timeout' | 'verify-failed';

export class UntrustedPersistenceError extends Error {
  readonly reason: UntrustedPersistenceReason;
  readonly causeError: unknown;

  constructor(message: string, reason: UntrustedPersistenceReason, causeError?: unknown) {
    super(message);
    this.name = 'UntrustedPersistenceError';
    this.reason = reason;
    this.causeError = causeError;
  }
}

export class LocalDataContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDataContractError';
  }
}

export type LocalDataRepository = {
  read<T>(ref: LocalDataRef): Promise<LocalDataReadResult<T>>;
  commit(unitOfWork: LocalDataUnitOfWork): Promise<LocalDataCommitMeta>;
  commitAndPromoteActiveDataSource(
    unitOfWork: LocalDataUnitOfWork,
    buildValidationReport: (
      meta: LocalDataCommitMeta,
      mutations: LocalDataBackendMutation[]
    ) => LocalDataMigrationValidationReport | Promise<LocalDataMigrationValidationReport>
  ): Promise<{
    commitMeta: LocalDataCommitMeta;
    validationReport: LocalDataMigrationValidationReport;
    activeDataSource: LocalDataActiveDataSourceRow;
  }>;
  promoteActiveDataSource(
    meta: LocalDataCommitMeta,
    validationReport: LocalDataMigrationValidationReport
  ): Promise<LocalDataActiveDataSourceRow>;
  promoteActiveDataSources(
    promotions: Array<{
      meta: LocalDataCommitMeta;
      validationReport: LocalDataMigrationValidationReport;
    }>
  ): Promise<LocalDataActiveDataSourceRow>;
  activateDomainsFromCommittedRows(
    metas: LocalDataCommitMeta[]
  ): Promise<LocalDataActiveDataSourceRow>;
};

export type LocalDataRepositoryOptions = {
  backend: LocalDataBackend;
  now?: () => number;
  createCommitId?: (unitOfWork: LocalDataUnitOfWork, committedAt: number) => string;
  onStageCleanupError?: (error: unknown, meta: LocalDataCommitMeta) => void;
};

function isTimeoutLikeError(error: unknown) {
  if (error instanceof UntrustedPersistenceError) return error.reason === 'timeout';
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`.toLowerCase();
  return text.includes('timeout') || text.includes('timed out') || text.includes('超时');
}

function toUntrustedPersistenceError(error: unknown, operation: string) {
  if (error instanceof UntrustedPersistenceError) return error;
  const reason: UntrustedPersistenceReason = isTimeoutLikeError(error) ? 'timeout' : 'backend-error';
  return new UntrustedPersistenceError(`${operation} returned untrusted persistence state.`, reason, error);
}

function createDeletedRow(ref: LocalDataRef, version: number, deletedAt: number): LocalDataDeletedRow {
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataRowKey(ref),
    ref,
    version,
    updatedAt: deletedAt,
    state: 'deleted',
    deletedAt
  };
}

function createCommitPointer(meta: LocalDataCommitMeta): CommitPointerRow {
  return {
    domain: meta.domain,
    version: meta.version,
    committedAt: meta.committedAt,
    commitId: meta.commitId
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLocalDataRef(value: unknown): value is LocalDataRef {
  if (!isObjectRecord(value)) return false;
  return typeof value.domain === 'string'
    && typeof value.kind === 'string'
    && typeof value.id === 'string';
}

function refsMatch(left: LocalDataRef, right: LocalDataRef) {
  return left.domain === right.domain
    && left.kind === right.kind
    && left.id === right.id;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLocalDataActiveDataSourceRow(value: unknown): value is LocalDataActiveDataSourceRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<LocalDataActiveDataSourceRow>;
  return row.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
    && row.key === getLocalDataActiveDataSourceKey()
    && row.activeDataSource === 'repository'
    && typeof row.updatedAt === 'number'
    && typeof row.domains === 'object'
    && row.domains !== null;
}

function isCommitPointerRow(value: unknown, meta: LocalDataCommitMeta): value is CommitPointerRow {
  if (!isObjectRecord(value)) return false;
  return value.domain === meta.domain
    && value.version === meta.version
    && value.committedAt === meta.committedAt
    && value.commitId === meta.commitId;
}

function assertMatchingDomainCommitPointer(value: unknown, meta: LocalDataCommitMeta) {
  if (!isCommitPointerRow(value, meta)) {
    throw new UntrustedPersistenceError(
      `Local data commit pointer does not match promoted commit: ${meta.domain}/${meta.commitId}`,
      'verify-failed'
    );
  }
}

function commitPointersMatch(left: unknown, right: unknown, domain: LocalDataCommitMeta['domain']) {
  if (!isObjectRecord(left) || !isObjectRecord(right)) return false;
  return left.domain === domain
    && right.domain === domain
    && left.version === right.version
    && left.committedAt === right.committedAt
    && left.commitId === right.commitId;
}

function createActiveDataSourceRowForPromotions(
  promotions: LocalDataCommitMeta[],
  previousRow: LocalDataActiveDataSourceRow | null,
  updatedAt: number
): LocalDataActiveDataSourceRow {
  const activeMeta = promotions[promotions.length - 1];
  if (!activeMeta) {
    throw new LocalDataContractError('Local data active source promotion requires at least one domain.');
  }
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    key: getLocalDataActiveDataSourceKey(),
    activeDataSource: 'repository',
    activeCommitId: activeMeta.commitId,
    stagingCommitId: null,
    updatedAt,
    domains: promotions.reduce<LocalDataActiveDataSourceRow['domains']>((domains, meta) => ({
      ...domains,
      [meta.domain]: createCommitPointer(meta)
    }), {
      ...(previousRow?.domains ?? {})
    })
  };
}

function validateLocalDataStoredRow(row: LocalDataStoredRow) {
  if (row.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION) {
    throw new LocalDataContractError(`Local data row has unsupported schema version: ${row.key}`);
  }

  const expectedKey = getLocalDataRowKey(row.ref);
  if (row.key !== expectedKey) {
    throw new LocalDataContractError(`Local data row key does not match its ref: ${row.key}`);
  }
}

function validatePersistedRowForRead<T>(
  ref: LocalDataRef,
  value: unknown
): { row: LocalDataStoredRow<T>; reason: null } | { row: null; reason: string } {
  if (value === null) {
    return { row: null, reason: 'Local data row is missing.' };
  }
  if (!isObjectRecord(value)) {
    return { row: null, reason: 'Local data row is invalid.' };
  }

  if (!isLocalDataRef(value.ref) || !refsMatch(value.ref, ref)) {
    return { row: null, reason: 'Local data row ref does not match requested ref.' };
  }
  if (value.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION) {
    return { row: null, reason: 'Local data row has unsupported schema version.' };
  }
  if (value.key !== getLocalDataRowKey(ref)) {
    return { row: null, reason: 'Local data row key does not match requested ref.' };
  }
  if (typeof value.version !== 'number' || typeof value.updatedAt !== 'number') {
    return { row: null, reason: 'Local data row is invalid.' };
  }

  if (value.state === 'complete') {
    if (!Object.prototype.hasOwnProperty.call(value, 'value')) {
      return { row: null, reason: 'Local data complete row is missing value.' };
    }
    return { row: value as LocalDataStoredRow<T>, reason: null };
  }
  if (value.state === 'unloaded') {
    if (value.meta !== undefined && !isObjectRecord(value.meta)) {
      return { row: null, reason: 'Local data unloaded row meta is invalid.' };
    }
    return { row: value as LocalDataStoredRow<T>, reason: null };
  }
  if (value.state === 'incomplete') {
    if (typeof value.reason !== 'string') {
      return { row: null, reason: 'Local data incomplete row reason is invalid.' };
    }
    if (value.missingKeys !== undefined && !isStringArray(value.missingKeys)) {
      return { row: null, reason: 'Local data incomplete row missing keys are invalid.' };
    }
    if (value.meta !== undefined && !isObjectRecord(value.meta)) {
      return { row: null, reason: 'Local data incomplete row meta is invalid.' };
    }
    return { row: value as LocalDataStoredRow<T>, reason: null };
  }
  if (value.state === 'timedOut') {
    if (typeof value.reason !== 'string') {
      return { row: null, reason: 'Local data timed-out row reason is invalid.' };
    }
    return { row: value as LocalDataStoredRow<T>, reason: null };
  }
  if (value.state === 'deleted') {
    if (typeof value.deletedAt !== 'number') {
      return { row: null, reason: 'Local data deleted row timestamp is invalid.' };
    }
    return { row: value as LocalDataStoredRow<T>, reason: null };
  }

  return { row: null, reason: 'Local data row state is invalid.' };
}

function validateLocalDataUnitOfWork(unitOfWork: LocalDataUnitOfWork) {
  const mutationKeys = new Set<string>();

  for (const mutation of unitOfWork.mutations) {
    const ref = mutation.type === 'put' || mutation.type === 'restore' ? mutation.row.ref : mutation.ref;
    const mutationKey = mutation.type === 'put' || mutation.type === 'restore'
      ? mutation.row.key
      : getLocalDataRowKey(mutation.ref);
    if (ref.domain !== unitOfWork.domain) {
      throw new LocalDataContractError(
        `Local data mutation domain ${ref.domain} does not match unit domain ${unitOfWork.domain}.`
      );
    }
    if (mutationKeys.has(mutationKey)) {
      throw new LocalDataContractError(`Local data unit writes the same row key more than once: ${mutationKey}`);
    }
    mutationKeys.add(mutationKey);
    if (mutation.type === 'put' || mutation.type === 'restore') {
      validateLocalDataStoredRow(mutation.row);
    }
  }
}

function getRowCompletenessRank(row: LocalDataStoredRow) {
  if (row.state === 'complete') return 3;
  if (row.state === 'incomplete' || row.state === 'timedOut') return 2;
  return 1;
}

async function validateLocalDataUnitOfWorkDoesNotOverwriteProtectedRows(
  backend: LocalDataBackend,
  unitOfWork: LocalDataUnitOfWork
) {
  for (const mutation of unitOfWork.mutations) {
    if (mutation.type !== 'put' && mutation.type !== 'restore') continue;
    const incomingRank = getRowCompletenessRank(mutation.row);

    const existingValue = await backend.read<unknown>(mutation.row.key);
    const existingValidation = validatePersistedRowForRead(mutation.row.ref, existingValue);
    const existingRow = existingValidation.row;
    if (!existingRow) {
      if (mutation.type === 'restore') {
        throw new LocalDataContractError(
          `Local data restore requires an existing deleted row: ${mutation.row.key}`
        );
      }
      continue;
    }

    if (existingRow.state === 'deleted') {
      if (mutation.type !== 'restore') {
        throw new LocalDataContractError(
          `Local data deleted row cannot be overwritten without restore: ${mutation.row.key}`
        );
      }
      continue;
    }

    if (mutation.type === 'restore') {
      throw new LocalDataContractError(
        `Local data restore can only replace a deleted row: ${mutation.row.key}`
      );
    }

    if (existingRow.state === 'complete' && mutation.row.state === 'complete') {
      if (
        mutation.row.version < existingRow.version
        || (
          mutation.row.version === existingRow.version
          && mutation.row.updatedAt < existingRow.updatedAt
        )
      ) {
        throw new LocalDataContractError(
          `Local data complete row is older than existing complete row: ${mutation.row.key}`
        );
      }
    }

    if (incomingRank >= 3) continue;

    const existingRank = getRowCompletenessRank(existingRow);
    if (existingRank > incomingRank) {
      throw new LocalDataContractError(
        `Local data row downgrade is not allowed: ${mutation.row.key}`
      );
    }
  }
}

function buildRowMutation(mutation: LocalDataUnitMutation, committedAt: number): LocalDataBackendMutation {
  if (mutation.type === 'put' || mutation.type === 'restore') {
    return {
      type: 'set',
      key: mutation.row.key,
      value: mutation.row
    };
  }

  const tombstone = createDeletedRow(mutation.ref, mutation.version, mutation.deletedAt ?? committedAt);
  return {
    type: 'set',
    key: tombstone.key,
    value: tombstone
  };
}

export function buildLocalDataCommitMutations(
  unitOfWork: LocalDataUnitOfWork,
  meta: LocalDataCommitMeta
): LocalDataBackendMutation[] {
  validateLocalDataUnitOfWork(unitOfWork);
  return [
    ...unitOfWork.mutations.map((mutation) => buildRowMutation(mutation, meta.committedAt)),
    {
      type: 'set',
      key: getLocalDataCommitPointerKey(unitOfWork.domain),
      value: createCommitPointer(meta)
    }
  ];
}

function buildActiveDataSourcePromotionMutation(row: LocalDataActiveDataSourceRow): LocalDataBackendMutation {
  return {
    type: 'set',
    key: row.key,
    value: row
  };
}

function rowToReadResult<T>(ref: LocalDataRef, row: LocalDataStoredRow<T> | null): LocalDataReadResult<T> {
  if (!row) {
    return {
      status: 'incomplete',
      ref,
      reason: 'Local data row is missing.',
      missingKeys: [getLocalDataRowKey(ref)]
    };
  }

  if (row.state === 'complete') {
    return { status: 'complete', ref, value: row.value, row };
  }
  if (row.state === 'unloaded') {
    return { status: 'unloaded', ref, row };
  }
  if (row.state === 'incomplete') {
    return {
      status: 'incomplete',
      ref,
      reason: row.reason,
      missingKeys: row.missingKeys ?? [],
      row
    };
  }
  if (row.state === 'timedOut') {
    return {
      status: 'timedOut',
      ref,
      reason: row.reason,
      row
    };
  }
  return {
    status: 'deleted',
    ref,
    deletedAt: row.deletedAt,
    row
  };
}

function invalidRowToReadResult<T>(ref: LocalDataRef, reason: string): LocalDataReadResult<T> {
  return {
    status: 'incomplete',
    ref,
    reason,
    missingKeys: [getLocalDataRowKey(ref)]
  };
}

export function createLocalDataRepository(options: LocalDataRepositoryOptions): LocalDataRepository {
  const now = options.now ?? (() => Date.now());
  const createCommitId = options.createCommitId ?? ((unitOfWork, committedAt) => {
    return `${unitOfWork.domain}:${unitOfWork.version}:${committedAt}`;
  });

  const createCommitMeta = (unitOfWork: LocalDataUnitOfWork): LocalDataCommitMeta => {
    const committedAt = now();
    return {
      commitId: unitOfWork.id ?? createCommitId(unitOfWork, committedAt),
      domain: unitOfWork.domain,
      version: unitOfWork.version,
      committedAt
    };
  };

  const commitMutations = async (mutations: LocalDataBackendMutation[], meta: LocalDataCommitMeta) => {
    if (options.backend.mode === 'transactional') {
      await options.backend.commitAtomic(mutations, meta);
      return;
    }

    const stageId = `${meta.commitId}:stage`;
    await options.backend.stageCommit(stageId, mutations, meta);
    try {
      const verified = await options.backend.verifyCommit(stageId, mutations, meta);
      if (!verified) {
        throw new UntrustedPersistenceError(
          `Staged local data commit failed verification: ${meta.commitId}`,
          'verify-failed'
        );
      }
      await options.backend.publishCommit(stageId, mutations, meta);
    } finally {
      try {
        await options.backend.clearStage?.(stageId);
      } catch (cleanupError) {
        options.onStageCleanupError?.(cleanupError, meta);
      }
    }
  };

  const buildActiveAdvanceForAlreadyActiveDomain = async (meta: LocalDataCommitMeta) => {
    const previousValue = await options.backend.read<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
    if (!isLocalDataActiveDataSourceRow(previousValue)) return null;
    const activePointer = previousValue.domains[meta.domain];
    const committedPointer = await options.backend.read<CommitPointerRow>(getLocalDataCommitPointerKey(meta.domain));
    if (!commitPointersMatch(activePointer, committedPointer, meta.domain)) return null;
    return createActiveDataSourceRowForPromotions([meta], previousValue, meta.committedAt);
  };

  return {
    async read<T>(ref: LocalDataRef): Promise<LocalDataReadResult<T>> {
      try {
        const persistedValue = await options.backend.read<unknown>(getLocalDataRowKey(ref));
        const validation = validatePersistedRowForRead<T>(ref, persistedValue);
        if (!validation.row) return invalidRowToReadResult(ref, validation.reason);
        return rowToReadResult(ref, validation.row);
      } catch (error) {
        throw toUntrustedPersistenceError(error, `Read ${ref.domain}/${ref.kind}/${ref.id}`);
      }
    },

    async commit(unitOfWork: LocalDataUnitOfWork): Promise<LocalDataCommitMeta> {
      const meta = createCommitMeta(unitOfWork);
      const mutations = buildLocalDataCommitMutations(unitOfWork, meta);

      try {
        await validateLocalDataUnitOfWorkDoesNotOverwriteProtectedRows(options.backend, unitOfWork);
        const activeAdvance = await buildActiveAdvanceForAlreadyActiveDomain(meta);
        await commitMutations(activeAdvance
          ? [...mutations, buildActiveDataSourcePromotionMutation(activeAdvance)]
          : mutations, meta);
        return meta;
      } catch (error) {
        if (error instanceof LocalDataContractError) throw error;
        throw toUntrustedPersistenceError(error, `Commit ${unitOfWork.domain}/${meta.commitId}`);
      }
    },

    async commitAndPromoteActiveDataSource(
      unitOfWork,
      buildValidationReport
    ) {
      const meta = createCommitMeta(unitOfWork);
      const commitMutationsForUnit = buildLocalDataCommitMutations(unitOfWork, meta);

      try {
        await validateLocalDataUnitOfWorkDoesNotOverwriteProtectedRows(options.backend, unitOfWork);
        const validationReport = await buildValidationReport(meta, commitMutationsForUnit);
        assertValidMigrationPromotionReport(meta, validationReport);

        const previousValue = await options.backend.read<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
        const previousRow = isLocalDataActiveDataSourceRow(previousValue) ? previousValue : null;
        const activeDataSource = createActiveDataSourceRowForPromotions([meta], previousRow, meta.committedAt);

        await commitMutations([
          ...commitMutationsForUnit,
          buildActiveDataSourcePromotionMutation(activeDataSource)
        ], meta);

        return { commitMeta: meta, validationReport, activeDataSource };
      } catch (error) {
        if (error instanceof LocalDataContractError) throw error;
        if (error instanceof LocalDataMigrationValidationError) {
          throw new UntrustedPersistenceError(error.message, 'verify-failed', error);
        }
        throw toUntrustedPersistenceError(error, `Commit and promote ${unitOfWork.domain}/${meta.commitId}`);
      }
    },

    async promoteActiveDataSource(
      meta: LocalDataCommitMeta,
      validationReport: LocalDataMigrationValidationReport
    ): Promise<LocalDataActiveDataSourceRow> {
      return await this.promoteActiveDataSources([{ meta, validationReport }]);
    },

    async promoteActiveDataSources(
      promotions
    ): Promise<LocalDataActiveDataSourceRow> {
      try {
        if (!promotions.length) {
          throw new LocalDataContractError('Local data active source promotion requires at least one domain.');
        }
        for (const promotion of promotions) {
          assertValidMigrationPromotionReport(promotion.meta, promotion.validationReport);
          const pointer = await options.backend.read<unknown>(getLocalDataCommitPointerKey(promotion.meta.domain));
          assertMatchingDomainCommitPointer(pointer, promotion.meta);
        }
        const previousValue = await options.backend.read<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
        const previousRow = isLocalDataActiveDataSourceRow(previousValue) ? previousValue : null;
        const metas = promotions.map((promotion) => promotion.meta);
        const activeMeta = metas[metas.length - 1];
        if (!activeMeta) {
          throw new LocalDataContractError('Local data active source promotion requires at least one domain.');
        }
        const row = createActiveDataSourceRowForPromotions(metas, previousRow, now());
        await commitMutations([buildActiveDataSourcePromotionMutation(row)], activeMeta);
        return row;
      } catch (error) {
        if (error instanceof LocalDataMigrationValidationError) {
          throw new UntrustedPersistenceError(error.message, 'verify-failed', error);
        }
        const label = promotions.map((promotion) => `${promotion.meta.domain}/${promotion.meta.commitId}`).join(',');
        throw toUntrustedPersistenceError(error, `Promote active data sources ${label}`);
      }
    },

    async activateDomainsFromCommittedRows(
      metas
    ): Promise<LocalDataActiveDataSourceRow> {
      // First-write self-activation: stamp the active-data-source row for domains whose rows
      // were written DIRECTLY by an ordinary product save (not migrated from a legacy source).
      // There is no migration to reconcile, so this deliberately does NOT require a migration
      // validation report. The guarantee is structural instead: each meta must match the
      // domain's committed commit pointer (so it names a real, latest committed unit of work),
      // and the read-side active check (readActiveLocalDataSourceForDomain) independently
      // re-verifies the domain meta is complete. This must NEVER be used to make a MIGRATED
      // domain active — that path stays on promoteActiveDataSources with its validation report.
      try {
        if (!metas.length) {
          throw new LocalDataContractError('Local data active source activation requires at least one domain.');
        }
        for (const meta of metas) {
          const pointer = await options.backend.read<unknown>(getLocalDataCommitPointerKey(meta.domain));
          assertMatchingDomainCommitPointer(pointer, meta);
        }
        const previousValue = await options.backend.read<LocalDataActiveDataSourceRow>(getLocalDataActiveDataSourceKey());
        const previousRow = isLocalDataActiveDataSourceRow(previousValue) ? previousValue : null;
        const activeMeta = metas[metas.length - 1];
        if (!activeMeta) {
          throw new LocalDataContractError('Local data active source activation requires at least one domain.');
        }
        const row = createActiveDataSourceRowForPromotions(metas, previousRow, now());
        await commitMutations([buildActiveDataSourcePromotionMutation(row)], activeMeta);
        return row;
      } catch (error) {
        const label = metas.map((meta) => `${meta.domain}/${meta.commitId}`).join(',');
        throw toUntrustedPersistenceError(error, `Activate domains from committed rows ${label}`);
      }
    }
  };
}
