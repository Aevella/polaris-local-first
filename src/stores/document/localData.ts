import {
  buildDocumentObjectLocalDataRow,
  createCompleteLocalDataRow,
  documentObjectIncompleteReason,
  getDocumentDomainMetaLocalDataRef,
  getDocumentObjectLocalDataRef,
  LOCAL_DATA_SCHEMA_VERSION,
  toDocumentObjectId,
  type DocumentBodyRow,
  type DocumentDomainMetaRow,
  type DocumentLocalDataObjectKind,
  type DocumentObjectSeed,
  type LocalDataCommitMeta,
  type LocalDataReadResult,
  type LocalDataRef,
  type LocalDataUnitMutation
} from '../../engines/localData';
import { kvKeysWithPrefix } from '../../infrastructure/persistence';
import { fingerprintDiagnosticId, reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import { runExclusiveDocumentPersistenceCommit } from '../documentPersistenceCommitQueue';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  readLocalDataDomainRows
} from '../localDataStorePersistence';

const MISSING_ROW_REASON = 'Local data row is missing.';

export type DocumentRowChange =
  | { type: 'upsert'; seed: DocumentObjectSeed }
  | { type: 'delete'; kind: DocumentLocalDataObjectKind; id: string };

export type DocumentBodyReadResult =
  | { status: 'inactive' }
  | { status: 'complete'; content: string }
  | { status: 'incomplete'; reason: string }
  | { status: 'missing' };

export async function assertDocumentLocalDataStrictlyReadableIfActive() {
  if (!(await isLocalDataRepositoryDomainActive('document'))) return;
  await readLocalDataDomainRows({
    domain: 'document',
    integrity: 'strict',
    isRequiredRef: (ref) => ref.kind === 'domainMeta'
  });
}

/**
 * Read one document body from its row when the document domain is active. Returns
 * `inactive` when the domain is not active (the caller then uses its current body
 * storage), `missing` when the active document repository does not contain a live body
 * row, and `incomplete` when the row exists but its body is not loadable. Active
 * missing / deleted / incomplete rows are the document owner's truth and must surface
 * as missing body errors, never fall back to legacy KV or become empty bodies.
 */
export async function readDocumentBodyIfActive(
  kind: DocumentLocalDataObjectKind,
  id: string
): Promise<DocumentBodyReadResult> {
  if (!(await isLocalDataRepositoryDomainActive('document'))) return { status: 'inactive' };
  const repository = createStoreLocalDataRepository();
  const result = await repository.read<DocumentBodyRow>(getDocumentObjectLocalDataRef(kind, id));
  if (result.status === 'complete') return { status: 'complete', content: result.value.content };
  if (result.status === 'incomplete') {
    if (result.reason === MISSING_ROW_REASON) return { status: 'missing' };
    reportPersistenceError({
      label: '[store:persist:isolation]',
      store: 'document',
      operation: 'read-isolated-row',
      domain: 'document',
      stage: 'read-body',
      integrity: 'degraded',
      rowCount: 1,
      fingerprint: fingerprintDiagnosticId(`${kind}:${id}`)
    }, new Error('A document body row is incomplete and was isolated.'));
    return { status: 'incomplete', reason: result.reason };
  }
  return { status: 'missing' };
}

/**
 * List the ids of the existing (non-deleted) document body rows of one kind, for a
 * caller that has already confirmed the document domain is active and needs to
 * reconcile which body rows should be tombstoned.
 */
export async function listActiveDocumentBodyRowIds(kind: DocumentLocalDataObjectKind): Promise<string[]> {
  const repository = createStoreLocalDataRepository();
  const ids: string[] = [];
  for (const ref of await discoverLocalDataDomainRefs('document')) {
    if (ref.kind !== kind) continue;
    const result = await repository.read(ref);
    if (result.status === 'complete') {
      ids.push(ref.id);
      continue;
    }
    if (result.status === 'incomplete' && result.reason !== MISSING_ROW_REASON) {
      ids.push(ref.id);
    }
  }
  return ids;
}

/**
 * Write a set of single-document body changes (persona-memory / workspace-reference
 * doc body upserts and tombstones) together with the refreshed document domain meta
 * in one unit of work. A body that is missing or has incomplete chunks is written as
 * an incomplete row via the body-completeness contract — it never becomes an empty
 * loaded body. The domain meta is maintained incrementally from the previous meta and
 * the changed documents' prior rows, so refreshing it never re-reads the chunked body
 * content or scans every document.
 *
 * Returns false only when the document repository is inactive. A change set that
 * writes the same document twice is a caller error and throws.
 *
 * NOTE: the document domain is still not made active by default. When it is active, the
 * workspace-reference and persona-memory body persistence route through this writer;
 * otherwise those bodies stay in the legacy chunked-KV storage. Promoting the domain to
 * the live body owner (and migrating existing chunked bodies) is a separate decision.
 */
export async function commitDocumentRowChangesIfActive(args: {
  changes: DocumentRowChange[];
}): Promise<boolean> {
  return runExclusiveDocumentPersistenceCommit(async () => {
    if (!(await isLocalDataRepositoryDomainActive('document'))) return false;
    await commitDocumentRowChanges(args);
    return true;
  });
}

// Root prefixes of the document domain's two legacy chunked-KV body kinds. These cover every
// version: workspace `…-content-v1:` / `…-v2:` and persona-memory `…-content-v1` (monolithic)
// / `…-v2:` / `…-v3:` all begin with one of these roots.
const DOCUMENT_BODY_LEGACY_KV_PREFIX_ROOTS = [
  'workspace-reference-doc-content',
  'persona-memory-doc-content'
];

/**
 * Whether any legacy chunked-KV document body keys exist (either body kind). The document
 * domain self-activates from an ordinary save ONLY when none are present — a genuinely fresh
 * document domain. Activating while unloaded legacy bodies remain would strand them: the active
 * body read never falls back to chunked-KV, so a not-yet-loaded body would become unreadable.
 * Old bodies are migrated to document rows and promoted through the explicit import / migration
 * boundary instead, never by an in-place ordinary save.
 */
export async function hasLegacyDocumentBodyChunkedKvKeys(): Promise<boolean> {
  for (const prefix of DOCUMENT_BODY_LEGACY_KV_PREFIX_ROOTS) {
    if ((await kvKeysWithPrefix(prefix)).length > 0) return true;
  }
  return false;
}

/**
 * The first-write self-activation write path for document bodies. It writes the body rows even
 * when the document domain is not yet active, then activates the domain from its own committed
 * rows (`activateDomainsFromCommittedRows`, no migration validation report — the rows are the
 * product's own current truth). The whole decision runs inside the document persistence queue,
 * so two owners (collection workspace docs, persona memory docs) cannot race to activate.
 *
 * Returns true when this path handled the write (active already, or a fresh domain that
 * self-activated) so the caller skips the legacy chunked-KV storage. Returns false when the
 * domain is inactive AND legacy chunked-KV bodies still exist (not safe to self-activate),
 * leaving the caller to write chunked-KV as before.
 */
export async function commitDocumentRowChangesActivating(args: {
  changes: DocumentRowChange[];
}): Promise<boolean> {
  return runExclusiveDocumentPersistenceCommit(async () => {
    const alreadyActive = await isLocalDataRepositoryDomainActive('document');
    if (!alreadyActive && (await hasLegacyDocumentBodyChunkedKvKeys())) return false;
    // Nothing to commit: already-active is handled (no-op); a not-yet-active fresh domain has no
    // rows to activate from, so decline and let the caller's (empty) chunked-KV path run.
    if (args.changes.length === 0) return alreadyActive;
    const meta = await commitDocumentRowChanges(args);
    if (!alreadyActive) {
      const repository = createStoreLocalDataRepository();
      await repository.activateDomainsFromCommittedRows([meta]);
    }
    return true;
  });
}

type DocumentMetaContribution = {
  kind: DocumentLocalDataObjectKind;
  active: boolean;
  missingBody: boolean;
  incompleteChunk: boolean;
  charCount: number;
};

type MutableDocumentMeta = {
  objectCounts: Record<DocumentLocalDataObjectKind, number>;
  totalObjectCount: number;
  activeObjectCount: number;
  missingBodyCount: number;
  incompleteChunkCount: number;
  totalCharCount: number;
};

function emptyDocumentMeta(): MutableDocumentMeta {
  return {
    objectCounts: { 'persona-memory-doc': 0, 'workspace-reference-doc': 0, 'orphan-body': 0 },
    totalObjectCount: 0,
    activeObjectCount: 0,
    missingBodyCount: 0,
    incompleteChunkCount: 0,
    totalCharCount: 0
  };
}

function cloneDocumentMeta(previous: DocumentDomainMetaRow): MutableDocumentMeta {
  return {
    objectCounts: {
      'persona-memory-doc': previous.objectCounts['persona-memory-doc'],
      'workspace-reference-doc': previous.objectCounts['workspace-reference-doc'],
      'orphan-body': previous.objectCounts['orphan-body']
    },
    totalObjectCount: previous.totalObjectCount,
    activeObjectCount: previous.activeObjectCount,
    missingBodyCount: previous.missingBodyCount,
    incompleteChunkCount: previous.incompleteChunkCount,
    totalCharCount: previous.totalCharCount
  };
}

function applyDocumentMetaContribution(meta: MutableDocumentMeta, contribution: DocumentMetaContribution, sign: 1 | -1) {
  meta.objectCounts[contribution.kind] += sign;
  meta.totalObjectCount += sign;
  if (contribution.active) meta.activeObjectCount += sign;
  if (contribution.missingBody) meta.missingBodyCount += sign;
  if (contribution.incompleteChunk) meta.incompleteChunkCount += sign;
  meta.totalCharCount += sign * contribution.charCount;
}

function documentSeedContribution(seed: DocumentObjectSeed): DocumentMetaContribution {
  const reason = documentObjectIncompleteReason(seed);
  return {
    kind: seed.kind,
    active: reason === null && seed.kind !== 'orphan-body',
    missingBody: reason === 'missing-body',
    incompleteChunk: reason === 'missing-chunk',
    charCount: reason === null ? seed.body.content?.length ?? 0 : 0
  };
}

function existingDocumentContribution(
  kind: DocumentLocalDataObjectKind,
  result: LocalDataReadResult<DocumentBodyRow>
): DocumentMetaContribution | null {
  if (result.status === 'complete') {
    return {
      kind,
      active: kind !== 'orphan-body',
      missingBody: false,
      incompleteChunk: false,
      charCount: result.value.actualCharCount
    };
  }
  if (result.status === 'incomplete') {
    if (result.reason === MISSING_ROW_REASON) return null;
    return {
      kind,
      active: false,
      missingBody: result.reason === 'missing-body',
      incompleteChunk: result.reason === 'missing-chunk',
      charCount: 0
    };
  }
  // deleted / unloaded / timedOut: nothing currently contributes to the counts.
  return null;
}

async function readDocumentDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<DocumentDomainMetaRow | null> {
  const result = await repository.read<DocumentDomainMetaRow>(getDocumentDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}

async function commitDocumentRowChanges(args: { changes: DocumentRowChange[] }): Promise<LocalDataCommitMeta> {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const previousMeta = await readDocumentDomainMetaValue(repository);
  const meta = previousMeta ? cloneDocumentMeta(previousMeta) : emptyDocumentMeta();
  const mutations: LocalDataUnitMutation[] = [];
  const touchedObjectIds = new Set<string>();

  for (const change of args.changes) {
    const kind = change.type === 'delete' ? change.kind : change.seed.kind;
    const id = change.type === 'delete' ? change.id : change.seed.id;
    const objectId = toDocumentObjectId(kind, id);
    if (touchedObjectIds.has(objectId)) {
      throw new Error(`Document row change set writes the same document twice: ${objectId}`);
    }
    touchedObjectIds.add(objectId);

    const ref: LocalDataRef = getDocumentObjectLocalDataRef(kind, id);
    const existing = await repository.read<DocumentBodyRow>(ref);
    const oldContribution = existingDocumentContribution(kind, existing);
    if (oldContribution) applyDocumentMetaContribution(meta, oldContribution, -1);

    if (change.type === 'upsert') {
      mutations.push({
        type: 'put',
        row: buildDocumentObjectLocalDataRow({
          seed: change.seed,
          version: LOCAL_DATA_SCHEMA_VERSION,
          updatedAt: now
        })
      });
      applyDocumentMetaContribution(meta, documentSeedContribution(change.seed), 1);
      continue;
    }

    mutations.push({
      type: 'tombstone',
      ref,
      version: LOCAL_DATA_SCHEMA_VERSION,
      deletedAt: now
    });
  }

  const domainMetaValue: DocumentDomainMetaRow = {
    id: 'document',
    activeObjectCount: meta.activeObjectCount,
    totalObjectCount: meta.totalObjectCount,
    objectCounts: meta.objectCounts,
    missingBodyCount: meta.missingBodyCount,
    incompleteChunkCount: meta.incompleteChunkCount,
    orphanBodyCount: meta.objectCounts['orphan-body'],
    totalCharCount: meta.totalCharCount,
    updatedAt: now
  };

  return await repository.commit({
    domain: 'document',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [
      {
        type: 'put',
        row: createCompleteLocalDataRow({
          ref: getDocumentDomainMetaLocalDataRef(),
          value: domainMetaValue,
          version: LOCAL_DATA_SCHEMA_VERSION,
          updatedAt: now
        })
      },
      ...mutations
    ]
  });
}
