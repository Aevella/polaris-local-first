import {
  buildPersonaObjectLocalDataRow,
  createCompleteLocalDataRow,
  getPersonaDomainMetaLocalDataRef,
  getPersonaObjectLocalDataRef,
  isLegacyLifecyclePersonaState,
  LOCAL_DATA_SCHEMA_VERSION,
  previewLocalDataStoreHydration,
  type LocalDataCompleteRow,
  type LocalDataCommitMeta,
  type LocalDataStoredRow,
  type LocalDataUnitMutation,
  type PersonaCollaboratorLegacyLifecycleState,
  type PersonaDomainMetaRow,
  type PersonaObjectRow
} from '../../engines/localData';
import { kvGet, kvSet } from '../../infrastructure/persistence';
import { reportPersistenceError } from '../../infrastructure/persistenceDiagnostics';
import type { Persona } from '../../types/domain';
import {
  createStoreLocalDataRepository,
  discoverLocalDataDomainRefs,
  isLocalDataRepositoryDomainActive,
  localDataPayloadsMatch,
  readLocalDataDomainRows,
  type LocalDataReadIntegrity
} from '../localDataStorePersistence';
import { runExclusivePersonaPersistenceCommit } from '../personaPersistenceCommitQueue';
import {
  clearStagedPersonaMemoryDocContent,
  stagePersonaMemoryDocContentFromPersonas,
  stripPersonaMemoryDocContent,
  writePersonaMemoryDocContentForPersonas
} from '../personaMemoryReferenceDocPersistence';

export type PersonaCollaboratorLifecycleEntry = {
  state: PersonaCollaboratorLegacyLifecycleState;
  reason: string | null;
};

export type PersonaLocalDataPayload = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds: string[];
  // Legacy collaborator lifecycle rows (archive / recovering / quarantine / missing-body),
  // surfaced as read-only historical markers. They are NEVER in `personas`, so an archive
  // persona can never become a live, product-active persona on hydrate. Write callers omit this
  // map so lifecycle rows stay outside the ordinary save path.
  legacyLifecycleByPersonaId?: Record<string, PersonaCollaboratorLifecycleEntry>;
};

export async function readPersonaStateFromLocalDataRepositoryIfActive(options: {
  integrity?: LocalDataReadIntegrity;
} = {}) {
  if (!(await isLocalDataRepositoryDomainActive('persona'))) return null;

  const rows = await readActivePersonaRows(options.integrity ?? 'recover');
  // Partition sealed legacy lifecycle collaborator rows out of the live hydration: only live
  // (active) rows feed the preview that reconstructs the product persona list, while archive /
  // recovering / quarantine / missing-body rows are surfaced as a separate lifecycle map.
  const legacyLifecycleByPersonaId: Record<string, PersonaCollaboratorLifecycleEntry> = {};
  const liveRows: LocalDataStoredRow[] = [];
  for (const row of rows) {
    if (row.state === 'complete') {
      const value = row.value as PersonaRowValue;
      if ('kind' in value && value.kind === 'collaborator' && isLegacyLifecyclePersonaState(value.state)) {
        legacyLifecycleByPersonaId[value.id] = {
          state: value.state as PersonaCollaboratorLegacyLifecycleState,
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
  })), ['persona']);
  const preview = report.previews[0];
  if (preview?.domain !== 'persona') {
    throw new Error('Active persona LocalData hydration preview is missing.');
  }
  if (preview.status !== 'hydrated' || !preview.state) {
    throw new Error(`Active persona LocalData hydration is ${preview.status}: ${preview.blockers.join(', ')}`);
  }

  stagePersonaMemoryDocContentFromPersonas(preview.state.personas);
  return {
    personas: stripPersonaMemoryDocContent(preview.state.personas),
    // The active-collaborator pointer is returned as the faithful stored fact — never
    // guessed back to "the first persona" here. The writer records it verbatim, so a
    // dangling value means the stored pointer genuinely no longer matches a live row, and
    // the export boundary wants that real pointer, not a substitute. The single legitimate
    // resolution happens once in `personaStore.hydrateFromDb`, AFTER default-persona
    // migration can remove the pointed-at persona (e.g. `coder`).
    activeCollaboratorId: preview.state.activeCollaboratorId,
    seededDefaultPersonaIds: preview.state.seededDefaultPersonaIds,
    legacyLifecycleByPersonaId
  } satisfies PersonaLocalDataPayload;
}

/**
 * The normal persona save path. One serialized save path owns calling both owners:
 * the persona memory document bodies (document rows when active, else legacy chunked
 * KV) and the persona collaborator directory rows. The persona row writer does not
 * re-acquire this queue. When the persona repository is inactive, the collaborator
 * directory falls back to the legacy whole-state KV store.
 */
export async function writePersonaState(payload: PersonaLocalDataPayload) {
  try {
    await runExclusivePersonaPersistenceCommit(async () => {
      await writePersonaMemoryDocContentForPersonas(payload.personas);
      if (!(await commitPersonaRowChangesFromStateActivating(payload))) {
        await kvSet('persona-state-v2', {
          personas: stripPersonaMemoryDocContent(payload.personas),
          activeCollaboratorId: payload.activeCollaboratorId,
          seededDefaultPersonaIds: payload.seededDefaultPersonaIds
        });
      }
      clearStagedPersonaMemoryDocContent();
    });
  } catch (e) {
    reportPersistenceError({ label: '[store:persist]', store: 'persona', operation: 'write' }, e);
    throw e;
  }
}

async function hasPreexistingLegacyPersonaState(): Promise<boolean> {
  return (await kvGet<unknown>('persona-state-v2')) !== null;
}

async function readActivePersonaRows(integrity: LocalDataReadIntegrity) {
  return (await readLocalDataDomainRows({
    domain: 'persona',
    integrity,
    isRequiredRef: (ref) => ref.kind === 'domainMeta'
  })).rows;
}

type PersonaRowValue =
  | PersonaDomainMetaRow
  | PersonaObjectRow;

/**
 * A single collaborator change the row writer owns. The persona's memory document
 * bodies are NOT in scope here — they are a separate fact owned by the document
 * domain. The collaborator directory row carries the persona with its memory document
 * content stripped; the body is persisted in the same save path through
 * `writePersonaMemoryDocContentForPersonas`.
 */
export type PersonaRowChange =
  | { type: 'upsert'; value: Persona }
  | { type: 'delete'; id: string };

type PersonaCollaboratorRowFacts = {
  /** Ids of live (product-active) collaborator rows. */
  liveIds: Set<string>;
  /** Ids of sealed legacy lifecycle collaborator rows (archive / recovering / quarantine / missing-body). */
  lifecycleIds: Set<string>;
};

/**
 * Read the existing collaborator object rows, partitioned into live product rows and sealed
 * legacy lifecycle rows, so a single collaborator write can refresh the domain-meta counts
 * truthfully without rebuilding the whole-persona snapshot — and so the writer never treats a
 * sealed archive row as a live persona.
 */
async function collectPersonaCollaboratorRowFacts(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<PersonaCollaboratorRowFacts> {
  const liveIds = new Set<string>();
  const lifecycleIds = new Set<string>();
  for (const ref of await discoverLocalDataDomainRefs('persona')) {
    if (ref.kind !== 'collaborator') continue;
    const result = await repository.read<PersonaObjectRow>(ref);
    if (result.status !== 'complete') continue;
    if (isLegacyLifecyclePersonaState(result.value.state)) {
      lifecycleIds.add(ref.id);
    } else {
      liveIds.add(ref.id);
    }
  }
  return { liveIds, lifecycleIds };
}

async function readPersonaDomainMetaValue(
  repository: ReturnType<typeof createStoreLocalDataRepository>
): Promise<PersonaDomainMetaRow | null> {
  const result = await repository.read<PersonaDomainMetaRow>(getPersonaDomainMetaLocalDataRef());
  return result.status === 'complete' ? result.value : null;
}

function uniqueSortedPersonaIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0))).sort();
}

function personaIdListsMatch(left: string[] | undefined, right: string[] | undefined) {
  const leftIds = uniqueSortedPersonaIds(left ?? []);
  const rightIds = uniqueSortedPersonaIds(right ?? []);
  if (leftIds.length !== rightIds.length) return false;
  return leftIds.every((id, index) => id === rightIds[index]);
}

function buildRefreshedPersonaDomainMetaRow(args: {
  activeCollaboratorId: string | null;
  liveIds: Set<string>;
  lifecycleCount: number;
  seededDefaultPersonaIds: string[];
  updatedAt: number;
}) {
  // Sealed legacy lifecycle rows count toward the total but are never product-active, so the
  // active count tracks only live collaborator rows.
  const value: PersonaDomainMetaRow = {
    id: 'persona',
    activeCollaboratorId: args.activeCollaboratorId,
    activeObjectCount: args.liveIds.size,
    totalObjectCount: args.liveIds.size + args.lifecycleCount,
    seededDefaultPersonaIds: uniqueSortedPersonaIds(args.seededDefaultPersonaIds),
    updatedAt: args.updatedAt
  };

  return createCompleteLocalDataRow({
    ref: getPersonaDomainMetaLocalDataRef(),
    value,
    version: LOCAL_DATA_SCHEMA_VERSION,
    updatedAt: args.updatedAt
  });
}

/**
 * Write a set of single-collaborator changes (collaborator upserts and tombstones)
 * together with the refreshed domain meta in one unit of work, instead of rebuilding
 * and diffing the whole-persona snapshot.
 *
 * Unlike the collection writer's legacy `activeProjectId`, the persona domain-meta
 * `activeCollaboratorId` IS an owned product pointer (it is hydrated back into the
 * store). It is recorded verbatim from the caller's truth — the store guarantees a
 * valid active collaborator through its actions, so the writer does not re-resolve or
 * guess a "first persona" on the write side. The read path
 * (`readPersonaStateFromLocalDataRepositoryIfActive`) likewise returns the stored pointer
 * verbatim; the only resolution is the single one in `personaStore.hydrateFromDb`, which
 * must run AFTER default-persona migration can drop the pointed-at persona.
 *
 * Returns false only when the persona repository is inactive (the caller then uses the
 * legacy whole-state KV store). A change set that writes the same collaborator twice is
 * a caller error and throws, rather than being silently skipped.
 */
export async function commitPersonaRowChangesIfActive(args: {
  changes: PersonaRowChange[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds: string[];
}): Promise<boolean> {
  return runExclusivePersonaPersistenceCommit(async () => {
    if (!(await isLocalDataRepositoryDomainActive('persona'))) return false;
    await commitPersonaRowChanges(args);
    return true;
  });
}

async function commitPersonaRowChanges(args: {
  changes: PersonaRowChange[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds: string[];
}): Promise<LocalDataCommitMeta> {
  const now = Date.now();
  const repository = createStoreLocalDataRepository();
  const facts = await collectPersonaCollaboratorRowFacts(repository);
  const liveIds = facts.liveIds;
  const objectMutations: LocalDataUnitMutation[] = [];
  const touchedIds = new Set<string>();

  for (const change of args.changes) {
    const id = change.type === 'delete' ? change.id : change.value.id;
    if (touchedIds.has(id)) {
      throw new Error(`Persona row change set writes the same collaborator twice: ${id}`);
    }
    touchedIds.add(id);

    if (change.type === 'upsert') {
      // The collaborator row never carries the memory document body — that is the
      // document domain's fact. Strip it at the writer itself so the primitive enforces
      // its own contract for any caller (a direct targeted upsert with a loaded-body
      // persona), not only on the value-diff save path that strips upstream.
      const [directoryValue] = stripPersonaMemoryDocContent([change.value]);
      objectMutations.push({
        type: 'put',
        row: buildPersonaObjectLocalDataRow({
          value: directoryValue,
          activeCollaboratorId: args.activeCollaboratorId,
          version: LOCAL_DATA_SCHEMA_VERSION
        })
      });
      liveIds.add(id);
      continue;
    }

    liveIds.delete(id);
    objectMutations.push({
      type: 'tombstone',
      ref: getPersonaObjectLocalDataRef(id),
      version: LOCAL_DATA_SCHEMA_VERSION,
      deletedAt: now
    });
  }

  const domainMetaRow = buildRefreshedPersonaDomainMetaRow({
    activeCollaboratorId: args.activeCollaboratorId,
    liveIds,
    lifecycleCount: facts.lifecycleIds.size,
    seededDefaultPersonaIds: args.seededDefaultPersonaIds,
    updatedAt: now
  });

  return await repository.commit({
    domain: 'persona',
    version: LOCAL_DATA_SCHEMA_VERSION,
    mutations: [
      { type: 'put', row: domainMetaRow },
      ...objectMutations
    ]
  });
}

/**
 * Rebuild the comparison baseline for a stored collaborator row by stripping its memory
 * document body, exactly as the writer strips before persisting. A freshly migrated row
 * can carry an inline body (the migration restores it for self-contained hydration),
 * while the save path writes body-stripped directory rows — the body owner is the
 * document domain. Normalizing the stored row to its body-stripped projection makes the
 * value-diff compare the OWNED directory facts only, so an unchanged directory whose
 * body merely lives inline is a no-op, and a body-content change is reflected only
 * through the directory's `charCount`. The existing row's own active flag is preserved
 * so an active-pointer flip is still detected.
 */
function normalizeStoredCollaboratorRow(row: LocalDataCompleteRow<PersonaObjectRow>) {
  const stored = row.value;
  const [strippedPersona] = stripPersonaMemoryDocContent([stored.value]);
  return buildPersonaObjectLocalDataRow({
    value: strippedPersona,
    activeCollaboratorId: stored.active ? stored.value.id : null,
    version: LOCAL_DATA_SCHEMA_VERSION
  });
}

/**
 * Derive the set of collaborator row changes that turns the current persisted rows
 * into `personas`, by value-diffing each candidate row against the body-stripped
 * projection of the existing row. The collaborator row carries the persona with its
 * memory document content stripped (the body owner is the document domain), and its
 * `updatedAt` is content-derived, so an unchanged directory produces a byte-identical
 * row and no change. Removed collaborators produce a tombstone.
 */
async function buildPersonaRowChangesFromState(
  repository: ReturnType<typeof createStoreLocalDataRepository>,
  personas: Persona[],
  activeCollaboratorId: string | null
): Promise<PersonaRowChange[]> {
  const existingRows = new Map<string, LocalDataCompleteRow<PersonaObjectRow>>();
  for (const ref of await discoverLocalDataDomainRefs('persona')) {
    if (ref.kind !== 'collaborator') continue;
    const result = await repository.read<PersonaObjectRow>(ref);
    if (result.status !== 'complete') continue;
    // Sealed legacy lifecycle rows are out of scope for the live value-diff: they are not in
    // the live persona list and must NOT be tombstoned by their absence from it; these rows are
    // retained historical evidence, not ordinary product personas.
    if (isLegacyLifecyclePersonaState(result.value.state)) continue;
    existingRows.set(ref.id, result.row);
  }

  const changes: PersonaRowChange[] = [];
  const presentIds = new Set<string>();
  for (const value of personas) {
    presentIds.add(value.id);
    const candidateRow = buildPersonaObjectLocalDataRow({
      value,
      activeCollaboratorId,
      version: LOCAL_DATA_SCHEMA_VERSION
    });
    const existingRow = existingRows.get(value.id);
    if (!existingRow || !localDataPayloadsMatch(normalizeStoredCollaboratorRow(existingRow), candidateRow)) {
      changes.push({ type: 'upsert', value });
    }
  }
  for (const [id] of existingRows) {
    if (presentIds.has(id)) continue;
    changes.push({ type: 'delete', id });
  }
  return changes;
}

/**
 * Commit the value-diff of the whole persona state through the collaborator row writer,
 * when the persona repository is active. This is the normal persona write path. It does
 * NOT acquire the persona persistence queue: the caller (writePersonaState) holds it so
 * that the persona memory document bodies and these directory rows are written in the
 * same serialized save path. Returns false when the persona repository is inactive,
 * leaving the caller to use the legacy whole-state KV store.
 */
export async function commitPersonaRowChangesFromStateIfActive(
  payload: PersonaLocalDataPayload
): Promise<boolean> {
  if (!(await isLocalDataRepositoryDomainActive('persona'))) return false;
  const repository = createStoreLocalDataRepository();
  const personas = stripPersonaMemoryDocContent(payload.personas);
  const activeCollaboratorId = payload.activeCollaboratorId;
  const changes = await buildPersonaRowChangesFromState(repository, personas, activeCollaboratorId);
  // `activeCollaboratorId` and `seededDefaultPersonaIds` live on the persona domain
  // meta, not on a collaborator object row, so an empty object change set does not mean
  // the commit is a no-op: commit when either meta pointer/field changed, otherwise that
  // update is lost.
  const previousMeta = await readPersonaDomainMetaValue(repository);
  const metaChanged =
    (previousMeta?.activeCollaboratorId ?? null) !== activeCollaboratorId
    || !personaIdListsMatch(previousMeta?.seededDefaultPersonaIds, payload.seededDefaultPersonaIds);
  if (changes.length > 0 || metaChanged) {
    await commitPersonaRowChanges({
      changes,
      activeCollaboratorId,
      seededDefaultPersonaIds: payload.seededDefaultPersonaIds
    });
  }
  return true;
}

/**
 * The normal persona directory save path with first-write self-activation. Unlike
 * `commitPersonaRowChangesFromStateIfActive`, this does NOT require the persona domain to be active
 * already: on a fresh install it writes the LocalData persona rows directly and activates the persona
 * domain from its OWN committed rows via `activateDomainsFromCommittedRows`. If an old
 * `persona-state-v2` directory already exists while the domain is inactive, the caller must keep using
 * that legacy directory until an explicit import or migration boundary moves it.
 */
export async function commitPersonaRowChangesFromStateActivating(
  payload: PersonaLocalDataPayload
): Promise<boolean> {
  const alreadyActive = await isLocalDataRepositoryDomainActive('persona');
  if (!alreadyActive && await hasPreexistingLegacyPersonaState()) return false;

  const repository = createStoreLocalDataRepository();
  const personas = stripPersonaMemoryDocContent(payload.personas);
  const activeCollaboratorId = payload.activeCollaboratorId;
  const changes = await buildPersonaRowChangesFromState(repository, personas, activeCollaboratorId);
  const previousMeta = await readPersonaDomainMetaValue(repository);
  const metaChanged =
    (previousMeta?.activeCollaboratorId ?? null) !== activeCollaboratorId
    || !personaIdListsMatch(previousMeta?.seededDefaultPersonaIds, payload.seededDefaultPersonaIds);

  if (changes.length === 0 && !metaChanged && alreadyActive) return true;
  const meta = await commitPersonaRowChanges({
    changes,
    activeCollaboratorId,
    seededDefaultPersonaIds: payload.seededDefaultPersonaIds
  });
  if (!alreadyActive) {
    await repository.activateDomainsFromCommittedRows([meta]);
  }
  return true;
}
