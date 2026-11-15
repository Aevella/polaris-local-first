import type { WorkspaceReferenceDoc } from '../types/domain';
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
  hasLoadedReferenceDocBody
} from './referenceDocBodyState';

export const WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX = 'workspace-reference-doc-content-v1:';
export const WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX = 'workspace-reference-doc-content-v2:';

export type WorkspaceReferenceDocContentPayload = {
  version: 1;
  docs: Record<string, string>;
};

const WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_CHARS = 64 * 1024;
const stagedWorkspaceReferenceDocContent = new Map<string, string>();

// Explicit body-deletion signal, drained by the active-document body writer. A workspace
// doc merely ABSENT from a write is never a delete (it has no per-owner sub-scope to make
// absence safe); only an id staged here through an explicit collection/store delete action
// tombstones its document body row. Mirrors the staged-content lifecycle: the action stages,
// the write drains, and the save path clears via `clearStagedWorkspaceReferenceDocContent`.
const stagedDeletedWorkspaceReferenceDocIds = new Set<string>();

export function workspaceReferenceDocContentKey(docId: string) {
  return encodeURIComponent(docId);
}

function docContentEntryKey(key: string) {
  return `${WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX}${key}`;
}

function docContentChunkEntryPrefix(key: string) {
  return `${WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX}${key}:`;
}

function docContentChunkEntryKey(key: string, index: number) {
  return `${docContentChunkEntryPrefix(key)}${index}`;
}

function isWorkspaceReferenceDocContentEntryKey(key: string) {
  return key.startsWith(WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX);
}

function isWorkspaceReferenceDocContentChunkEntryKey(key: string) {
  return key.startsWith(WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX);
}

function parseDocContentChunkEntryKey(key: string) {
  if (!isWorkspaceReferenceDocContentChunkEntryKey(key)) return null;
  const body = key.slice(WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX.length);
  const separatorIndex = body.lastIndexOf(':');
  if (separatorIndex < 0) return null;
  const docKey = body.slice(0, separatorIndex);
  const index = Number(body.slice(separatorIndex + 1));
  if (!docKey || !Number.isInteger(index) || index < 0) return null;
  return { docKey, index };
}

function serializeDocContentEntries(key: string, content: string): PersistedKvEntry[] {
  if (content.length <= WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_CHARS) {
    return [{
      key: docContentEntryKey(key),
      value: content
    }];
  }

  const entries: PersistedKvEntry[] = [];
  for (let offset = 0, index = 0; offset < content.length; offset += WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_CHARS, index += 1) {
    entries.push({
      key: docContentChunkEntryKey(key, index),
      value: content.slice(offset, offset + WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_CHARS)
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
      throw new Error(`Workspace reference document content chunk is missing: ${docKey}`);
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
    throw new Error(`Workspace reference document content chunk is missing: ${docKey}`);
  }
  return chunks.join('');
}

function stripDocContent(doc: WorkspaceReferenceDoc): WorkspaceReferenceDoc {
  return {
    ...doc,
    content: '',
    charCount: declaredReferenceDocBodyCharCount(doc),
    contentLoaded: false
  };
}

export function stageWorkspaceReferenceDocContent(docId: string, content: string) {
  stagedWorkspaceReferenceDocContent.set(workspaceReferenceDocContentKey(docId), content);
}

/**
 * Stage the explicit deletion of a workspace reference doc body. The collection store calls
 * this from its explicit delete actions (deleting one doc, or deleting a project that owns
 * docs), so the body writer can tombstone the body through the explicit channel even though
 * the doc is simply gone from the next persist's list — and so no doc that is merely absent
 * from a partial write is tombstoned by accident.
 */
export function stageWorkspaceReferenceDocDeletion(docId: string) {
  stagedDeletedWorkspaceReferenceDocIds.add(docId);
}

export function clearStagedWorkspaceReferenceDocContent() {
  stagedWorkspaceReferenceDocContent.clear();
  stagedDeletedWorkspaceReferenceDocIds.clear();
}

export function stageWorkspaceReferenceDocContentFromDocs(docs: WorkspaceReferenceDoc[]) {
  for (const doc of docs) {
    if (hasLoadedReferenceDocBody(doc)) {
      stageWorkspaceReferenceDocContent(doc.id, doc.content);
    }
  }
}

export function stripWorkspaceReferenceDocContent(docs: WorkspaceReferenceDoc[]): WorkspaceReferenceDoc[] {
  return docs.map(stripDocContent);
}

export function buildWorkspaceReferenceDocContentPayload(docs: WorkspaceReferenceDoc[]): WorkspaceReferenceDocContentPayload {
  const entries = docs.flatMap((doc): Array<[string, string]> => {
    const key = workspaceReferenceDocContentKey(doc.id);
    const rawStagedContent = stagedWorkspaceReferenceDocContent.get(key);
    const stagedContent = rawStagedContent !== undefined
      && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
        ? rawStagedContent
        : undefined;
    const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
    const content = stagedContent ?? inlineContent;
    return content !== undefined ? [[key, content]] : [];
  });
  return {
    version: 1,
    docs: Object.fromEntries(entries)
  };
}

function readDocContent(
  payload: WorkspaceReferenceDocContentPayload | null,
  doc: WorkspaceReferenceDoc
) {
  const persistedContent = payload?.docs?.[workspaceReferenceDocContentKey(doc.id)];
  return typeof persistedContent === 'string' ? persistedContent : doc.content;
}

export function restoreWorkspaceReferenceDocContent(
  docs: WorkspaceReferenceDoc[],
  payload: WorkspaceReferenceDocContentPayload | null
): WorkspaceReferenceDoc[] {
  return docs.map((doc) => {
    const key = workspaceReferenceDocContentKey(doc.id);
    const persistedContent = payload?.docs?.[key];
    if (typeof persistedContent !== 'string' && !hasLoadedReferenceDocBody(doc)) return doc;
    const content = typeof persistedContent === 'string' ? persistedContent : readDocContent(payload, doc);
    assertReferenceDocBodyMatchesDirectory(
      doc,
      content,
      `Workspace reference document content is missing: ${doc.id}`
    );
    return {
      ...doc,
      content,
      charCount: content.length,
      contentLoaded: true
    };
  });
}

export function serializeWorkspaceReferenceDocContentEntries(
  payload: WorkspaceReferenceDocContentPayload | null
): PersistedKvEntry[] {
  if (!payload) return [];
  return Object.entries(payload.docs).flatMap(([key, value]) => serializeDocContentEntries(key, value));
}

export async function readWorkspaceReferenceDocContentPayload() {
  const [contentKeys, chunkEntryKeys] = await Promise.all([
    kvKeysWithPrefix(WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX),
    kvKeysWithPrefix(WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX)
  ]);
  const docs: Record<string, string> = {};
  const chunkKeysByDocKey = new Map<string, Array<{ key: string; index: number }>>();

  for (const key of contentKeys) {
    const docKey = key.slice(WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX.length);
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
  } satisfies WorkspaceReferenceDocContentPayload;
}

async function readWorkspaceReferenceDocChunkedContent(key: string) {
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

async function readExistingWorkspaceReferenceDocContentForComparison(
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

function resolveWorkspaceReferenceDocContentToPersist(doc: WorkspaceReferenceDoc): string | undefined {
  const key = workspaceReferenceDocContentKey(doc.id);
  const rawStagedContent = stagedWorkspaceReferenceDocContent.get(key);
  const stagedContent = rawStagedContent !== undefined
    && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
      ? rawStagedContent
      : undefined;
  const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
  return stagedContent ?? inlineContent;
}

function toWorkspaceReferenceDocumentSeed(doc: WorkspaceReferenceDoc, content: string): DocumentObjectSeed {
  return {
    id: doc.id,
    kind: 'workspace-reference-doc',
    title: doc.title,
    summary: doc.summary,
    declaredCharCount: content.length,
    contentLoaded: true,
    body: { source: 'inline', content, keys: [], chunkIndexes: [], chunkCount: 0, contiguous: true },
    ownerRefs: [{ kind: 'workspace-doc', id: doc.id, label: doc.title }],
    updatedAt: doc.updatedAt,
    expectsBody: content.length > 0
  };
}

/**
 * Persist workspace reference doc bodies as document rows: upsert the loaded bodies and
 * tombstone the rows whose docs are explicitly deleted, in one commit. This is the first-write
 * self-activation path — it writes the rows when the document domain is active OR when it is a
 * genuinely fresh domain (no legacy chunked-KV bodies), self-activating in the latter case.
 * Returns true when this path handled the write (so the caller skips the legacy chunked-KV
 * storage). Returns false only when the domain is inactive AND legacy chunked-KV bodies still
 * exist, leaving the legacy chunked-KV write path unchanged (those bodies migrate through the
 * explicit import / migration boundary).
 */
async function writeWorkspaceReferenceDocBodiesToDocumentRowsActivating(
  docs: WorkspaceReferenceDoc[],
  deletedDocIds: string[]
): Promise<boolean> {
  // Cheap pre-check: a not-yet-active document domain that still holds legacy chunked-KV bodies
  // must stay on the chunked-KV path (self-activating would strand its unloaded bodies). Skip the
  // row scan below and let the caller write chunked-KV.
  if (!(await isLocalDataRepositoryDomainActive('document')) && (await hasLegacyDocumentBodyChunkedKvKeys())) {
    return false;
  }

  const changes: DocumentRowChange[] = [];
  for (const doc of docs) {
    const content = resolveWorkspaceReferenceDocContentToPersist(doc);
    if (content === undefined) continue;
    changes.push({ type: 'upsert', seed: toWorkspaceReferenceDocumentSeed(doc, content) });
  }
  // Unlike persona, a workspace doc body has no per-owner sub-scope (each doc id is a
  // top-level unit), so the present-write list cannot tell an explicit removal from a doc
  // that is merely absent (a partial hydrate, a not-yet-recovered archive). Reconcile-by-
  // absence is therefore forbidden here: a body row is tombstoned ONLY when its id is named
  // by an explicit delete signal — the `deletedDocIds` argument (direct callers / tests) or
  // the staged set the collection store fills from its explicit delete actions. A doc merely
  // absent from the write keeps its body as a recoverable orphan rather than destroying it
  // irreversibly (the active document domain no longer falls back to old KV).
  const explicitlyDeletedIds = new Set<string>([...deletedDocIds, ...stagedDeletedWorkspaceReferenceDocIds]);
  const existingIds = new Set(await listActiveDocumentBodyRowIds('workspace-reference-doc'));
  for (const deletedId of explicitlyDeletedIds) {
    if (existingIds.has(deletedId)) {
      changes.push({ type: 'delete', kind: 'workspace-reference-doc', id: deletedId });
    }
  }
  return await commitDocumentRowChangesActivating({ changes });
}

export async function readWorkspaceReferenceDocContent(doc: WorkspaceReferenceDoc) {
  if (doc.contentLoaded) return doc.content;
  const documentRowBody = await readDocumentBodyIfActive('workspace-reference-doc', doc.id);
  if (documentRowBody.status === 'complete') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      documentRowBody.content,
      `Workspace reference document content is missing: ${doc.id}`
    );
    return documentRowBody.content;
  }
  if (documentRowBody.status === 'incomplete') {
    throw new Error(`Workspace reference document content is missing: ${doc.id}`);
  }
  if (documentRowBody.status === 'missing') {
    throw new Error(`Workspace reference document content is missing: ${doc.id}`);
  }
  const key = workspaceReferenceDocContentKey(doc.id);
  const stagedContent = stagedWorkspaceReferenceDocContent.get(key);
  // The directory may have advanced past a staged draft (for example after
  // hydration/rollback). A stale staged body is not evidence that disk is missing.
  // Use the same eligibility check as the write path, then validate disk normally.
  if (stagedContent !== undefined && contentMatchesReferenceDocDirectory(doc, stagedContent)) {
    return stagedContent;
  }
  const chunkedContent = await readWorkspaceReferenceDocChunkedContent(key);
  if (typeof chunkedContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      chunkedContent,
      `Workspace reference document content is missing: ${doc.id}`
    );
    return chunkedContent;
  }
  const splitContent = await kvGet<string>(docContentEntryKey(key));
  if (typeof splitContent === 'string') {
    assertReferenceDocBodyMatchesDirectory(
      doc,
      splitContent,
      `Workspace reference document content is missing: ${doc.id}`
    );
    return splitContent;
  }
  if (expectsUnloadedReferenceDocBody(doc)) {
    throw new Error(`Workspace reference document content is missing: ${doc.id}`);
  }
  return doc.content;
}

export async function loadWorkspaceReferenceDocContent(doc: WorkspaceReferenceDoc) {
  const content = await readWorkspaceReferenceDocContent(doc);
  return {
    ...doc,
    content,
    charCount: content.length,
    contentLoaded: true
  } satisfies WorkspaceReferenceDoc;
}

export async function loadWorkspaceReferenceDocsContent(docs: WorkspaceReferenceDoc[]) {
  return await Promise.all(docs.map(loadWorkspaceReferenceDocContent));
}

export async function writeWorkspaceReferenceDocContentForDocs(
  docs: WorkspaceReferenceDoc[],
  deletedDocIds: string[] = []
) {
  if (await writeWorkspaceReferenceDocBodiesToDocumentRowsActivating(docs, deletedDocIds)) return;

  const [contentKeys, chunkEntryKeys] = await Promise.all([
    kvKeysWithPrefix(WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX),
    kvKeysWithPrefix(WORKSPACE_REFERENCE_DOC_CONTENT_CHUNK_PREFIX)
  ]);
  const keys = [...contentKeys, ...chunkEntryKeys];
  const mutations: Array<{ type: 'set'; key: string; value: unknown } | { type: 'delete'; key: string }> = [];
  const currentEntryKeys = new Set<string>();
  const currentChunkEntryKeys = new Set<string>();
  const existingContentKeys = new Set<string>();
  const existingChunkKeysByDocKey = new Map<string, string[]>();

  for (const key of keys) {
    if (isWorkspaceReferenceDocContentEntryKey(key)) {
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

  for (const doc of docs) {
    const key = workspaceReferenceDocContentKey(doc.id);
    const existingEntryKey = docContentEntryKey(key);
    const existingChunkKeys = existingChunkKeysByDocKey.get(key) ?? [];
    if (existingContentKeys.has(existingEntryKey)) {
      currentEntryKeys.add(existingEntryKey);
    }
    for (const chunkKey of existingChunkKeys) {
      currentChunkEntryKeys.add(chunkKey);
    }

    const rawStagedContent = stagedWorkspaceReferenceDocContent.get(key);
    const stagedContent = rawStagedContent !== undefined
      && contentMatchesReferenceDocDirectory(doc, rawStagedContent)
        ? rawStagedContent
        : undefined;
    const inlineContent = hasLoadedReferenceDocBody(doc) ? doc.content : undefined;
    const persistedContentForComparison = inlineContent !== undefined
      ? await readExistingWorkspaceReferenceDocContentForComparison(key, existingEntryKey, existingChunkKeys)
      : undefined;
    const changedInlineContent = inlineContent !== undefined && inlineContent !== persistedContentForComparison
      ? inlineContent
      : undefined;
    const content = stagedContent
      ?? changedInlineContent;
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
        if (entry.key.startsWith(WORKSPACE_REFERENCE_DOC_CONTENT_PREFIX)) {
          currentEntryKeys.add(entry.key);
        } else {
          currentChunkEntryKeys.add(entry.key);
        }
      }
    }
  }

  for (const key of keys) {
    if (isWorkspaceReferenceDocContentEntryKey(key) && !currentEntryKeys.has(key)) {
      mutations.push({ type: 'delete', key });
    }
    if (isWorkspaceReferenceDocContentChunkEntryKey(key) && !currentChunkEntryKeys.has(key)) {
      mutations.push({ type: 'delete', key });
    }
  }

  await kvApplyMutations(mutations);
}
