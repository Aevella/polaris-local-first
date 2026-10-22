import type { Persona, PersonaMemoryReferenceDoc } from '../types/domain';
import { kvApplyMutations, kvGet, kvKeysWithPrefix, type PersistedKvEntry } from '../infrastructure/persistence';
import type { DocumentObjectSeed } from '../engines/localData';
import {
  commitDocumentRowChangesActivating,
  hasLegacyDocumentBodyChunkedKvKeys,
  listActiveDocumentBodyRowIds,
  readDocumentBodyIfActive,
  type DocumentRowChange
} from './documentLocalDataPersistence';
import { isLocalDataRepositoryDomainActive } from './localDataStorePersistence';
import {
  assertReferenceDocBodyMatchesDirectory,
  contentMatchesReferenceDocDirectory,
  declaredReferenceDocBodyCharCount,
  expectsUnloadedReferenceDocBody,
  hasLoadedReferenceDocBody,
  wouldEraseUnloadedReferenceDocBody
} from './referenceDocBodyState';

export const PERSONA_MEMORY_DOC_CONTENT_KEY = 'persona-memory-doc-content-v1';
export const PERSONA_MEMORY_DOC_CONTENT_PREFIX = 'persona-memory-doc-content-v2:';
export const PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX = 'persona-memory-doc-content-v3:';

export type PersonaMemoryDocContentPayload = {
  version: 1;
  docs: Record<string, string>;
};

const PERSONA_MEMORY_DOC_CONTENT_CHUNK_CHARS = 64 * 1024;
const stagedDocContent = new Map<string, string>();

// Explicit body-deletion signals, drained by the active-document body writer. A persona/doc
// merely ABSENT from a write is never a delete (see the body writer); only an explicit
// signal staged here tombstones a body row whose owner is not present in the write. This
// mirrors the staged-content lifecycle: actions stage, the write drains, and the write path
// clears via `clearStagedPersonaMemoryDocContent`.
const stagedDeletedPersonaIds = new Set<string>();
const stagedDeletedDocBodyKeys = new Set<string>();

export function docContentKey(personaId: string, docId: string) {
  return `${encodeURIComponent(personaId)}:${encodeURIComponent(docId)}`;
}

/**
 * Decode the owning persona id from a persona-memory document body row id. A row id is
 * `docContentKey(personaId, docId)` — each part percent-encoded and joined by a literal
 * `:`, so the persona id is everything before the FIRST `:` decoded (an encoded `:` inside
 * a part is `%3A` and never the separator). This is the join key the sealing/recovery
 * boundary uses to decide which persona owns a body row, so a persona write can tell an
 * explicit per-persona doc removal from the mere absence of a persona it never wrote.
 * Returns null when the id is not a valid composite key.
 */
export function personaIdFromDocContentKey(rowId: string): string | null {
  const separatorIndex = rowId.indexOf(':');
  if (separatorIndex < 0) return null;
  try {
    return decodeURIComponent(rowId.slice(0, separatorIndex));
  } catch {
    return null;
  }
}

function docContentEntryKey(key: string) {
  return `${PERSONA_MEMORY_DOC_CONTENT_PREFIX}${key}`;
}

function docContentChunkEntryPrefix(key: string) {
  return `${PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX}${key}:`;
}

function docContentChunkEntryKey(key: string, index: number) {
  return `${docContentChunkEntryPrefix(key)}${index}`;
}

function isPersonaMemoryDocContentEntryKey(key: string) {
  return key.startsWith(PERSONA_MEMORY_DOC_CONTENT_PREFIX);
}

function isPersonaMemoryDocContentChunkEntryKey(key: string) {
  return key.startsWith(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX);
}

function parseDocContentChunkEntryKey(key: string) {
  if (!isPersonaMemoryDocContentChunkEntryKey(key)) return null;
  const body = key.slice(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX.length);
  const separatorIndex = body.lastIndexOf(':');
  if (separatorIndex < 0) return null;
  const docKey = body.slice(0, separatorIndex);
  const index = Number(body.slice(separatorIndex + 1));
  if (!docKey || !Number.isInteger(index) || index < 0) return null;
  return { docKey, index };
}

function serializeDocContentEntries(key: string, content: string): PersistedKvEntry[] {
  if (content.length <= PERSONA_MEMORY_DOC_CONTENT_CHUNK_CHARS) {
    return [{
      key: docContentEntryKey(key),
      value: content
    }];
  }

  const entries: PersistedKvEntry[] = [];
  for (let offset = 0, index = 0; offset < content.length; offset += PERSONA_MEMORY_DOC_CONTENT_CHUNK_CHARS, index += 1) {
    entries.push({
      key: docContentChunkEntryKey(key, index),
      value: content.slice(offset, offset + PERSONA_MEMORY_DOC_CONTENT_CHUNK_CHARS)
    });
  }
  return entries;
}

function assertCompleteChunkEntries(
  docKey: string,
  entries: Array<{ key: string; index: number }>
) {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]?.index !== index) {
      throw new Error(`Persona memory document content chunk is missing: ${docKey}`);
    }
  }
}

async function readCompleteChunkedContent(
  docKey: string,
  entries: Array<{ key: string; index: number }>
) {
  const sortedEntries = entries.sort((left, right) => left.index - right.index);
  assertCompleteChunkEntries(docKey, sortedEntries);
  const chunks = await Promise.all(sortedEntries.map((entry) => kvGet<string>(entry.key)));
  if (chunks.some((chunk) => typeof chunk !== 'string')) {
    throw new Error(`Persona memory document content chunk is missing: ${docKey}`);
  }
  return chunks.join('');
}

function stripDocContent(doc: PersonaMemoryReferenceDoc): PersonaMemoryReferenceDoc {
  return {
    ...doc,
    content: '',
    charCount: declaredReferenceDocBodyCharCount(doc),
    contentLoaded: false
  };
}

export function wouldEraseUnloadedPersonaMemoryDocContent(doc: PersonaMemoryReferenceDoc, content: string) {
  return wouldEraseUnloadedReferenceDocBody(doc, content);
}

export function hasUnloadedPersonaMemoryDocBody(doc: PersonaMemoryReferenceDoc) {
  return doc.contentLoaded !== true
    && doc.content.length === 0
    && (declaredReferenceDocBodyCharCount(doc) > 0 || doc.source !== 'user');
}

export function stagePersonaMemoryDocContent(personaId: string, docId: string, content: string) {
  stagedDocContent.set(docContentKey(personaId, docId), content);
}

/**
 * Stage the explicit deletion of a whole persona's memory doc bodies. The persona is now
 * absent from the live list (e.g. `deleteCollaborator`), so the body writer cannot infer
 * the deletion from the write's persona scope; this records the intent so its owned body
 * rows are tombstoned through the explicit channel rather than left as orphans — and so no
 * other absent persona is tombstoned by accident.
 */
export function stagePersonaMemoryDocDeletionForPersona(personaId: string) {
  stagedDeletedPersonaIds.add(personaId);
}

/** Stage the explicit deletion of a single persona memory doc body by id. */
export function stagePersonaMemoryDocDeletionForDoc(personaId: string, docId: string) {
  stagedDeletedDocBodyKeys.add(docContentKey(personaId, docId));
}

export function clearStagedPersonaMemoryDocContent() {
  stagedDocContent.clear();
  stagedDeletedPersonaIds.clear();
  stagedDeletedDocBodyKeys.clear();
}

export function stagePersonaMemoryDocContentFromPersonas(personas: Persona[]) {
  for (const persona of personas) {
    for (const doc of persona.memory.referenceDocs) {
      if (hasLoadedReferenceDocBody(doc)) {
        stagePersonaMemoryDocContent(persona.id, doc.id, doc.content);
      }
    }
  }
}

export function buildPersonaMemoryDocContentPayload(
  personas: Persona[],
  existingPayload: PersonaMemoryDocContentPayload | null = null
): PersonaMemoryDocContentPayload {
  const docs: Record<string, string> = {};

  for (const persona of personas) {
    for (const doc of persona.memory.referenceDocs) {
      const key = docContentKey(persona.id, doc.id);
      const rawStagedContent = stagedDocContent.get(key);
      const stagedContent = rawStagedContent !== undefined
        && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
          ? rawStagedContent
          : undefined;
      const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
      const existingPayloadContent = existingPayload?.docs?.[key];
      const existingContent = expectsUnloadedReferenceDocBody(doc)
        && typeof existingPayloadContent === 'string'
        && existingPayloadContent.length >= declaredReferenceDocBodyCharCount(doc)
          ? existingPayloadContent
          : undefined;
      const content = stagedContent ?? inlineContent ?? existingContent;
      if (content !== undefined) {
        docs[key] = content;
      }
    }
  }

  return {
    version: 1,
    docs
  };
}

export function serializePersonaMemoryDocContentEntries(
  payload: PersonaMemoryDocContentPayload | null
): PersistedKvEntry[] {
  if (!payload) return [];
  return Object.entries(payload.docs).flatMap(([key, value]) => serializeDocContentEntries(key, value));
}

export function stripPersonaMemoryDocContent(personas: Persona[]): Persona[] {
  return personas.map((persona) => ({
    ...persona,
    memory: {
      ...persona.memory,
      referenceDocs: persona.memory.referenceDocs.map(stripDocContent)
    }
  }));
}

function readDocContent(
  payload: PersonaMemoryDocContentPayload | null,
  personaId: string,
  doc: PersonaMemoryReferenceDoc
) {
  const persistedContent = payload?.docs?.[docContentKey(personaId, doc.id)];
  return typeof persistedContent === 'string' ? persistedContent : doc.content;
}

function restorePersonaMemoryReferenceDocContent(
  payload: PersonaMemoryDocContentPayload | null,
  personaId: string,
  doc: PersonaMemoryReferenceDoc
) {
  const key = docContentKey(personaId, doc.id);
  const persistedContent = payload?.docs?.[key];
  if (typeof persistedContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      persistedContent,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return {
      ...doc,
      content: persistedContent,
      charCount: persistedContent.length,
      contentLoaded: true
    } satisfies PersonaMemoryReferenceDoc;
  }
  if (hasLoadedReferenceDocBody(doc)) {
    return {
      ...doc,
      charCount: doc.content.length,
      contentLoaded: true
    } satisfies PersonaMemoryReferenceDoc;
  }
  return doc;
}

export function restorePersonaMemoryDocContent(
  personas: Persona[],
  payload: PersonaMemoryDocContentPayload | null
): Persona[] {
  return personas.map((persona) => ({
    ...persona,
    memory: {
      ...persona.memory,
      referenceDocs: persona.memory.referenceDocs.map((doc) => (
        restorePersonaMemoryReferenceDocContent(payload, persona.id, doc)
      ))
    }
  }));
}

export async function readPersonaMemoryDocContentPayload() {
  const [contentKeys, chunkEntryKeys, legacyPayload] = await Promise.all([
    kvKeysWithPrefix(PERSONA_MEMORY_DOC_CONTENT_PREFIX),
    kvKeysWithPrefix(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX),
    kvGet<PersonaMemoryDocContentPayload>(PERSONA_MEMORY_DOC_CONTENT_KEY)
  ]);
  const docs: Record<string, string> = {
    ...(legacyPayload?.docs ?? {})
  };
  const chunkKeysByDocKey = new Map<string, Array<{ key: string; index: number }>>();

  for (const key of contentKeys) {
    const docKey = key.slice(PERSONA_MEMORY_DOC_CONTENT_PREFIX.length);
    const content = await kvGet<string>(key);
    if (typeof content === 'string') {
      docs[docKey] = content;
    }
  }

  for (const key of chunkEntryKeys) {
    const chunk = parseDocContentChunkEntryKey(key);
    if (chunk) {
      const entries = chunkKeysByDocKey.get(chunk.docKey) ?? [];
      entries.push({ key, index: chunk.index });
      chunkKeysByDocKey.set(chunk.docKey, entries);
    }
  }

  for (const [docKey, entries] of chunkKeysByDocKey) {
    docs[docKey] = await readCompleteChunkedContent(docKey, entries);
  }

  return {
    version: 1,
    docs
  } satisfies PersonaMemoryDocContentPayload;
}

async function readPersonaMemoryDocChunkedContent(key: string) {
  const prefix = docContentChunkEntryPrefix(key);
  const chunkKeys = (await kvKeysWithPrefix(prefix))
    .map((entryKey) => {
      const parsed = parseDocContentChunkEntryKey(entryKey);
      return parsed ? { key: entryKey, index: parsed.index } : null;
    })
    .filter((entry): entry is { key: string; index: number } => entry !== null)
    .sort((left, right) => left.index - right.index);
  if (!chunkKeys.length) return null;

  return await readCompleteChunkedContent(key, chunkKeys);
}

async function readExistingPersonaMemoryDocContentForComparison(
  key: string,
  existingEntryKey: string,
  existingChunkKeys: string[]
) {
  if (existingChunkKeys.length > 0) {
    try {
      return await readCompleteChunkedContent(
        key,
        existingChunkKeys
          .map((entryKey) => {
            const parsed = parseDocContentChunkEntryKey(entryKey);
            return parsed ? { key: entryKey, index: parsed.index } : null;
          })
          .filter((entry): entry is { key: string; index: number } => entry !== null)
      );
    } catch {
      return undefined;
    }
  }
  const persistedContent = await kvGet<string>(existingEntryKey);
  return typeof persistedContent === 'string' ? persistedContent : undefined;
}

function toPersonaMemoryDocumentSeed(
  persona: Persona,
  doc: PersonaMemoryReferenceDoc,
  content: string
): DocumentObjectSeed {
  return {
    id: docContentKey(persona.id, doc.id),
    kind: 'persona-memory-doc',
    title: doc.title,
    summary: doc.summary,
    declaredCharCount: content.length,
    contentLoaded: true,
    body: { source: 'inline', content, keys: [], chunkIndexes: [], chunkCount: 0, contiguous: true },
    ownerRefs: [{ kind: 'persona', id: persona.id, label: persona.name.trim() || persona.id }],
    updatedAt: doc.updatedAt,
    expectsBody: content.length > 0
  };
}

function resolvePersonaMemoryDocBodyToPersist(persona: Persona, doc: PersonaMemoryReferenceDoc): string | undefined {
  const key = docContentKey(persona.id, doc.id);
  const rawStagedContent = stagedDocContent.get(key);
  const stagedContent = rawStagedContent !== undefined
    && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
      ? rawStagedContent
      : undefined;
  const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
  return stagedContent ?? inlineContent;
}

/**
 * Persist persona memory doc bodies as document rows: upsert the loaded bodies and tombstone
 * the rows whose docs are explicitly deleted, in one commit. This is the first-write
 * self-activation path — it writes the rows when the document domain is active OR when it is a
 * genuinely fresh domain (no legacy chunked-KV bodies), self-activating in the latter case.
 * Returns true when this path handled the write (so the caller skips the legacy chunked-KV
 * storage). Returns false only when the domain is inactive AND legacy chunked-KV bodies still
 * exist, leaving the legacy chunked-KV write path unchanged (those bodies migrate through the
 * explicit import / migration boundary).
 */
async function writePersonaMemoryDocBodiesToDocumentRowsActivating(personas: Persona[]): Promise<boolean> {
  // Cheap pre-check: a not-yet-active document domain that still holds legacy chunked-KV bodies
  // must stay on the chunked-KV path (self-activating would strand its unloaded bodies). Skip the
  // row scan below and let the caller write chunked-KV.
  if (!(await isLocalDataRepositoryDomainActive('document')) && (await hasLegacyDocumentBodyChunkedKvKeys())) {
    return false;
  }

  const presentPersonaIds = new Set(personas.map((persona) => persona.id));
  const presentDocIds = new Set<string>();
  const changes: DocumentRowChange[] = [];
  for (const persona of personas) {
    for (const doc of persona.memory.referenceDocs) {
      presentDocIds.add(docContentKey(persona.id, doc.id));
      if (doc.bodyStatus === 'missing') continue;
      const content = resolvePersonaMemoryDocBodyToPersist(persona, doc);
      if (content === undefined) continue;
      changes.push({ type: 'upsert', seed: toPersonaMemoryDocumentSeed(persona, doc, content) });
    }
  }
  // A body row is tombstoned only on an EXPLICIT delete signal, never on mere absence,
  // because once the document domain is the active body owner the old chunked KV no longer
  // backs the body, so an absence-driven tombstone would be irreversible. The three explicit
  // signals:
  //   (a) a persona PRESENT in this write that no longer declares the doc — the present
  //       persona's `referenceDocs` is its authoritative doc directory, so a dropped doc is
  //       an explicit per-persona removal;
  //   (b) a persona explicitly deleted (staged) — its owned body rows are tombstoned through
  //       the channel even though it is now absent from the write;
  //   (c) a single doc explicitly deleted (staged) by id.
  // A body row owned by a persona that is merely ABSENT (a sealed archive persona, a
  // partial/failed hydrate) matches none of these and survives. Orphan body rows are a
  // different document kind and are never returned here.
  for (const existingId of await listActiveDocumentBodyRowIds('persona-memory-doc')) {
    if (presentDocIds.has(existingId)) continue;
    const ownerPersonaId = personaIdFromDocContentKey(existingId);
    const presentPersonaDroppedDoc = ownerPersonaId !== null && presentPersonaIds.has(ownerPersonaId);
    const explicitPersonaDelete = ownerPersonaId !== null && stagedDeletedPersonaIds.has(ownerPersonaId);
    const explicitDocDelete = stagedDeletedDocBodyKeys.has(existingId);
    if (presentPersonaDroppedDoc || explicitPersonaDelete || explicitDocDelete) {
      changes.push({ type: 'delete', kind: 'persona-memory-doc', id: existingId });
    }
  }
  return await commitDocumentRowChangesActivating({ changes });
}

export async function readPersonaMemoryDocContent(
  personaId: string,
  doc: PersonaMemoryReferenceDoc
) {
  if (doc.bodyStatus === 'missing') throw new Error(`Persona memory document content is missing: ${personaId}:${doc.id}`);
  if (doc.contentLoaded) return doc.content;
  const documentRowBody = await readDocumentBodyIfActive('persona-memory-doc', docContentKey(personaId, doc.id));
  if (documentRowBody.status === 'complete') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      documentRowBody.content,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return documentRowBody.content;
  }
  if (documentRowBody.status === 'incomplete') {
    throw new Error(`Persona memory document content is missing: ${personaId}:${doc.id}`);
  }
  if (documentRowBody.status === 'missing') {
    throw new Error(`Persona memory document content is missing: ${personaId}:${doc.id}`);
  }
  const key = docContentKey(personaId, doc.id);
  const stagedContent = stagedDocContent.get(key);
  if (stagedContent !== undefined) {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      stagedContent,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return stagedContent;
  }
  const chunkedContent = await readPersonaMemoryDocChunkedContent(key);
  if (typeof chunkedContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      chunkedContent,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return chunkedContent;
  }
  const splitContent = await kvGet<string>(docContentEntryKey(key));
  if (typeof splitContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      splitContent,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return splitContent;
  }
  const legacyPayload = await kvGet<PersonaMemoryDocContentPayload>(PERSONA_MEMORY_DOC_CONTENT_KEY);
  const legacyContent = legacyPayload?.docs?.[key];
  if (typeof legacyContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      legacyContent,
      `Persona memory document content is missing: ${personaId}:${doc.id}`
    );
    return legacyContent;
  }
  if (expectsUnloadedReferenceDocBody(doc) || hasUnloadedPersonaMemoryDocBody(doc)) {
    throw new Error(`Persona memory document content is missing: ${personaId}:${doc.id}`);
  }
  return doc.content;
}

export async function loadPersonaMemoryReferenceDocContent(
  personaId: string,
  doc: PersonaMemoryReferenceDoc
) {
  const content = await readPersonaMemoryDocContent(personaId, doc);
  return {
    ...doc,
    content,
    charCount: content.length,
    contentLoaded: true
  } satisfies PersonaMemoryReferenceDoc;
}

export async function loadPersonaMemoryReferenceDocsContent(personas: Persona[]) {
  return await Promise.all(personas.map(async (persona) => ({
    ...persona,
    memory: {
      ...persona.memory,
      referenceDocs: await Promise.all(persona.memory.referenceDocs.map((doc) => (
        loadPersonaMemoryReferenceDocContent(persona.id, doc)
      )))
    }
  } satisfies Persona)));
}

export async function restoreCurrentPersonaMemoryDocContent(personas: Persona[]) {
  return await Promise.all(personas.map(async (persona) => ({
    ...persona,
    memory: {
      ...persona.memory,
      referenceDocs: await Promise.all(persona.memory.referenceDocs.map(async (doc) => {
        try {
          return await loadPersonaMemoryReferenceDocContent(persona.id, doc);
        } catch (error) {
          if (!isConfirmedPersonaMemoryDocBodyDamage(error)) throw error;
          return doc;
        }
      }))
    }
  } satisfies Persona)));
}

export function isConfirmedPersonaMemoryDocBodyDamage(error: unknown) {
  return error instanceof Error
    && (
      error.message.startsWith('Persona memory document content is missing:')
      || error.message.startsWith('Persona memory document content chunk is missing:')
    );
}

export async function writePersonaMemoryDocContentForPersonas(personas: Persona[]) {
  if (await writePersonaMemoryDocBodiesToDocumentRowsActivating(personas)) return;

  const [contentKeys, chunkEntryKeys, legacyPayload] = await Promise.all([
    kvKeysWithPrefix(PERSONA_MEMORY_DOC_CONTENT_PREFIX),
    kvKeysWithPrefix(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX),
    kvGet<PersonaMemoryDocContentPayload>(PERSONA_MEMORY_DOC_CONTENT_KEY)
  ]);
  const keys = [...contentKeys, ...chunkEntryKeys];
  const mutations: Array<{ type: 'set'; key: string; value: unknown } | { type: 'delete'; key: string }> = [];
  const currentEntryKeys = new Set<string>();
  const currentChunkEntryKeys = new Set<string>();
  const existingContentKeys = new Set<string>();
  const existingChunkKeysByDocKey = new Map<string, string[]>();

  for (const key of keys) {
    if (isPersonaMemoryDocContentEntryKey(key)) {
      existingContentKeys.add(key);
      continue;
    }
    const chunk = parseDocContentChunkEntryKey(key);
    if (chunk) {
      existingChunkKeysByDocKey.set(chunk.docKey, [
        ...(existingChunkKeysByDocKey.get(chunk.docKey) ?? []),
        key
      ]);
    }
  }

  for (const persona of personas) {
    for (const doc of persona.memory.referenceDocs) {
      const key = docContentKey(persona.id, doc.id);
      const existingEntryKey = docContentEntryKey(key);
      const existingChunkKeys = existingChunkKeysByDocKey.get(key) ?? [];
      if (existingContentKeys.has(existingEntryKey)) {
        currentEntryKeys.add(existingEntryKey);
      }
      for (const chunkKey of existingChunkKeys) {
        currentChunkEntryKeys.add(chunkKey);
      }

      const rawStagedContent = stagedDocContent.get(key);
      const stagedContent = rawStagedContent !== undefined
        && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
          ? rawStagedContent
          : undefined;
      const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
      const legacyContent = legacyPayload?.docs?.[key];
      const fallbackLegacyContent = typeof legacyContent === 'string'
        && contentMatchesReferenceDocDirectory(doc, legacyContent)
          ? legacyContent
          : undefined;
      const persistedContentForComparison = inlineContent !== undefined
        ? await readExistingPersonaMemoryDocContentForComparison(key, existingEntryKey, existingChunkKeys)
        : undefined;
      const changedInlineContent = inlineContent !== undefined && inlineContent !== persistedContentForComparison
        ? inlineContent
        : undefined;
      const content = stagedContent
        ?? changedInlineContent
        ?? fallbackLegacyContent;
      if (content !== undefined) {
        currentEntryKeys.delete(existingEntryKey);
        for (const chunkKey of existingChunkKeys) {
          currentChunkEntryKeys.delete(chunkKey);
        }
        const entries = serializeDocContentEntries(key, content);
        for (const entry of entries) {
          mutations.push({
            type: 'set',
            key: entry.key,
            value: entry.value
          });
          if (entry.key.startsWith(PERSONA_MEMORY_DOC_CONTENT_PREFIX)) {
            currentEntryKeys.add(entry.key);
          } else {
            currentChunkEntryKeys.add(entry.key);
          }
        }
      }
    }
  }

  for (const key of keys) {
    if (isPersonaMemoryDocContentEntryKey(key) && !currentEntryKeys.has(key)) {
      mutations.push({ type: 'delete', key });
    }
    if (isPersonaMemoryDocContentChunkEntryKey(key) && !currentChunkEntryKeys.has(key)) {
      mutations.push({ type: 'delete', key });
    }
  }

  if (legacyPayload) {
    mutations.push({ type: 'delete', key: PERSONA_MEMORY_DOC_CONTENT_KEY });
  }

  await kvApplyMutations(mutations);
}
