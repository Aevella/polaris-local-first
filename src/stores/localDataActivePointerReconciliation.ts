import {
  buildChatMigrationValidationReportFromRows,
  buildLocalDataCensusReport,
  buildLocalDataStoreHydrationValidationReports,
  getLocalDataActiveDataSourceKey,
  getLocalDataCommitPointerKey,
  isLegacyLifecycleCatalogState,
  LOCAL_DATA_NAMESPACE,
  LOCAL_DATA_SCHEMA_VERSION,
  type ChatDomainMetaRow,
  type CommitPointerRow,
  type ConversationCatalogRow,
  type ConversationRecordRow,
  type LocalDataActiveDataSourceRow,
  type LocalDataDomain,
  type LocalDataMigrationValidationReport,
  type LocalDataReadResult,
  type LocalDataRef
} from '../engines/localData';
import {
  fingerprintDiagnosticId,
  reportPersistenceError,
  type PersistenceDiagnosticContext
} from '../infrastructure/persistenceDiagnostics';
import { createStoreLocalDataRepository } from './localDataStorePersistence';
import {
  getStoreLocalDataBackend,
  readStoreLocalDataEntriesWithPrefix
} from './storeLocalDataBackendHost';

const LOCAL_DATA_DOMAINS = [
  'chat',
  'collection',
  'persona',
  'runtime',
  'space',
  'asset',
  'document'
] satisfies LocalDataDomain[];

export type LegacyActivePointerReconciliationFailure = {
  domain: LocalDataDomain | null;
  stage: 'active-row-read' | 'pointer-read' | 'strict-hydration' | 'promotion';
  rowCount: number;
};

export type LegacyActivePointerReconciliationResult = {
  status: 'unchanged' | 'reconciled' | 'degraded';
  reconciledDomains: LocalDataDomain[];
  unchangedDomains: LocalDataDomain[];
  failures: LegacyActivePointerReconciliationFailure[];
};

type ReconciliationDiagnosticReporter = (
  context: PersistenceDiagnosticContext,
  error: unknown
) => void;

/**
 * Repairs the metadata drift produced by older public clean builds: those builds could leave an
 * already-active domain pointing at commit A after an ordinary save atomically committed rows and
 * commit pointer B. This never copies content and never activates a domain missing from the old
 * active row. It strictly hydrates the current installed-backend rows first, then uses the
 * repository's validated promotion boundary to advance only that existing active pointer.
 */
export async function reconcileLegacyActiveLocalDataPointers(options: {
  now?: () => number;
  reportDegraded?: ReconciliationDiagnosticReporter;
} = {}): Promise<LegacyActivePointerReconciliationResult> {
  const backend = getStoreLocalDataBackend();
  const repository = createStoreLocalDataRepository({ now: options.now });
  const reportDegraded = options.reportDegraded ?? reportPersistenceError;
  let activeRow: unknown;
  try {
    activeRow = await backend.read<unknown>(getLocalDataActiveDataSourceKey());
  } catch {
    const failure = { domain: null, stage: 'active-row-read' as const, rowCount: 0 };
    reportReconciliationFailure(reportDegraded, failure);
    return {
      status: 'degraded',
      reconciledDomains: [],
      unchangedDomains: [],
      failures: [failure]
    };
  }
  if (!isActiveDataSourceRow(activeRow)) return emptyResult();

  const reconciledDomains: LocalDataDomain[] = [];
  const unchangedDomains: LocalDataDomain[] = [];
  const failures: LegacyActivePointerReconciliationFailure[] = [];

  for (const domain of LOCAL_DATA_DOMAINS) {
    const activePointer = activeRow.domains[domain];
    if (!isCommitPointer(activePointer, domain)) continue;

    let latestPointer: unknown;
    try {
      latestPointer = await backend.read<unknown>(getLocalDataCommitPointerKey(domain));
    } catch {
      const failure = { domain, stage: 'pointer-read' as const, rowCount: 0 };
      failures.push(failure);
      reportReconciliationFailure(reportDegraded, failure);
      continue;
    }
    if (!isCommitPointer(latestPointer, domain)) {
      const failure = { domain, stage: 'pointer-read' as const, rowCount: 0 };
      failures.push(failure);
      reportReconciliationFailure(reportDegraded, failure);
      continue;
    }
    if (commitPointersMatch(activePointer, latestPointer)) {
      unchangedDomains.push(domain);
      continue;
    }

    let validationReport: LocalDataMigrationValidationReport;
    let rowCount = 0;
    try {
      const entries = await readStoreLocalDataEntriesWithPrefix(`${LOCAL_DATA_NAMESPACE}:`);
      rowCount = entries.filter((entry) => (
        entry.key.startsWith(`${LOCAL_DATA_NAMESPACE}:row:${domain}:`)
      )).length;
      const strictRead = await strictReadDomainRows(domain, entries);
      validationReport = domain === 'chat'
        ? buildStrictChatValidationReport(latestPointer, strictRead.reads, options.now?.() ?? Date.now())
        : buildStrictStoreValidationReport(domain, latestPointer, entries, options.now?.() ?? Date.now());
    } catch {
      const failure = { domain, stage: 'strict-hydration' as const, rowCount };
      failures.push(failure);
      reportReconciliationFailure(reportDegraded, failure);
      continue;
    }

    try {
      await repository.promoteActiveDataSource(latestPointer, validationReport);
      reconciledDomains.push(domain);
    } catch {
      const failure = { domain, stage: 'promotion' as const, rowCount };
      failures.push(failure);
      reportReconciliationFailure(reportDegraded, failure);
    }
  }

  return {
    status: failures.length > 0
      ? 'degraded'
      : reconciledDomains.length > 0
        ? 'reconciled'
        : 'unchanged',
    reconciledDomains,
    unchangedDomains,
    failures
  };
}

function emptyResult(): LegacyActivePointerReconciliationResult {
  return {
    status: 'unchanged',
    reconciledDomains: [],
    unchangedDomains: [],
    failures: []
  };
}

async function strictReadDomainRows(
  domain: LocalDataDomain,
  entries: Array<{ key: string; value: unknown }>
) {
  const repository = createStoreLocalDataRepository();
  const prefix = `${LOCAL_DATA_NAMESPACE}:row:${domain}:`;
  const domainEntries = entries.filter((entry) => entry.key.startsWith(prefix));
  const reads = new Map<string, LocalDataReadResult>();

  for (const entry of domainEntries) {
    const ref = parseDomainRowKey(entry.key, domain);
    if (!ref) throw new Error('Malformed LocalData row key.');
    const read = await repository.read(ref);
    if (read.status !== 'complete' && read.status !== 'deleted') {
      throw new Error('Current LocalData row is not complete.');
    }
    reads.set(`${ref.kind}:${ref.id}`, read);
  }

  const metaRead = reads.get(`domainMeta:${domain}`);
  if (metaRead?.status !== 'complete') {
    throw new Error('Current LocalData domain metadata is not complete.');
  }
  return { reads };
}

function buildStrictStoreValidationReport(
  domain: Exclude<LocalDataDomain, 'chat'>,
  pointer: CommitPointerRow,
  entries: Array<{ key: string; value: unknown }>,
  validatedAt: number
) {
  const census = buildLocalDataCensusReport({
    kv: entries,
    assetMeta: [],
    assetBinaryKeys: [],
    assetPreviewKeys: [],
    localStorage: []
  });
  const report = buildLocalDataStoreHydrationValidationReports({
    kv: entries,
    censusDomains: census.domains,
    domains: [domain],
    validatedAt
  }).validationReports[domain];
  if (!report || report.commitId !== pointer.commitId) {
    throw new Error('Current LocalData hydration validation did not produce a matching report.');
  }
  return report;
}

function buildStrictChatValidationReport(
  pointer: CommitPointerRow,
  reads: Map<string, LocalDataReadResult>,
  validatedAt: number
) {
  const domainMeta = reads.get('domainMeta:chat') as LocalDataReadResult<ChatDomainMetaRow> | undefined;
  if (!domainMeta) throw new Error('Current chat domain metadata is missing.');

  const allCatalogReads = Array.from(reads.entries())
    .filter(([key, read]) => key.startsWith('conversationCatalog:') && read.status === 'complete')
    .map(([, read]) => read as LocalDataReadResult<ConversationCatalogRow>);
  const catalogById = new Map(allCatalogReads.map((read) => [read.ref.id, read]));
  const catalogReads = allCatalogReads.filter((read) => (
    read.status === 'complete' && !isLegacyLifecycleCatalogState(read.value.state)
  ));
  const recordIds = new Set(Array.from(reads.entries())
    .filter(([key, read]) => key.startsWith('conversationRecord:') && read.status === 'complete')
    .map(([key]) => key.slice('conversationRecord:'.length))
    .filter((id) => {
      const catalog = catalogById.get(id);
      if (!catalog || catalog.status !== 'complete') {
        throw new Error('Current chat record has no complete catalog row.');
      }
      return !isLegacyLifecycleCatalogState(catalog.value.state);
    }));
  const activeCatalogIds = catalogReads
    .filter((read) => read.status === 'complete' && read.value.state === 'active')
    .map((read) => read.ref.id);

  if (
    recordIds.size !== activeCatalogIds.length
    || activeCatalogIds.some((id) => !recordIds.has(id))
  ) {
    throw new Error('Current chat catalog and record rows are not coherent.');
  }

  return buildChatMigrationValidationReportFromRows({
    pointer,
    domainMeta,
    legacyBaselineConversationIds: catalogReads.map((read) => read.ref.id),
    legacyActiveConversationIds: activeCatalogIds,
    rows: catalogReads.map((catalog) => ({
      id: catalog.ref.id,
      catalog,
      ...(catalog.status === 'complete' && catalog.value.state === 'active'
        ? {
            record: reads.get(`conversationRecord:${catalog.ref.id}`) as LocalDataReadResult<ConversationRecordRow>
          }
        : {})
    })),
    validatedAt
  });
}

function parseDomainRowKey(key: string, domain: LocalDataDomain): LocalDataRef | null {
  const prefix = `${LOCAL_DATA_NAMESPACE}:row:${domain}:`;
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  const separator = suffix.indexOf(':');
  if (separator <= 0 || separator === suffix.length - 1) return null;
  return { domain, kind: suffix.slice(0, separator), id: suffix.slice(separator + 1) };
}

function isActiveDataSourceRow(value: unknown): value is LocalDataActiveDataSourceRow {
  if (!isObjectRecord(value)) return false;
  return value.schemaVersion === LOCAL_DATA_SCHEMA_VERSION
    && value.key === getLocalDataActiveDataSourceKey()
    && value.activeDataSource === 'repository'
    && typeof value.updatedAt === 'number'
    && isObjectRecord(value.domains);
}

function isCommitPointer(value: unknown, domain: LocalDataDomain): value is CommitPointerRow {
  if (!isObjectRecord(value)) return false;
  return value.domain === domain
    && typeof value.version === 'number'
    && typeof value.committedAt === 'number'
    && typeof value.commitId === 'string'
    && value.commitId.trim().length > 0;
}

function commitPointersMatch(left: CommitPointerRow, right: CommitPointerRow) {
  return left.domain === right.domain
    && left.version === right.version
    && left.committedAt === right.committedAt
    && left.commitId === right.commitId;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reportReconciliationFailure(
  report: ReconciliationDiagnosticReporter,
  failure: LegacyActivePointerReconciliationFailure
) {
  report({
    label: '[store:persist:reconcile]',
    store: 'startup',
    operation: 'reconcile-legacy-active-pointer',
    ...(failure.domain ? { domain: failure.domain } : {}),
    stage: failure.stage,
    integrity: 'degraded',
    rowCount: failure.rowCount,
    fingerprint: fingerprintDiagnosticId(`${failure.domain ?? 'active-row'}:${failure.stage}`)
  }, new Error(`Legacy active pointer reconciliation was not trusted at ${failure.stage}.`));
}
