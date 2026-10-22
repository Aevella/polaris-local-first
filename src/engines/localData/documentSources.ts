import type { PersistedDbEntry } from '../../infrastructure/persistence';
import type { Persona, PersonaMemoryReferenceDoc, WorkspaceReferenceDoc } from '../../types/domain';
import type {
  DocumentBodySource,
  DocumentLocalDataState,
  DocumentObjectSeed
} from './documentRows';

const PERSONA_LEGACY_KEY = 'persona-memory-doc-content-v1';
const PERSONA_SPLIT_PREFIX = 'persona-memory-doc-content-v2:';
const PERSONA_CHUNK_PREFIX = 'persona-memory-doc-content-v3:';
const WORKSPACE_SPLIT_PREFIX = 'workspace-reference-doc-content-v1:';
const WORKSPACE_CHUNK_PREFIX = 'workspace-reference-doc-content-v2:';

type ChunkEntry = {
  key: string;
  index: number;
  value: unknown;
};

type BodyIndex = {
  splitByKey: Map<string, { key: string; value: unknown }>;
  chunksByKey: Map<string, ChunkEntry[]>;
  legacyByKey: Map<string, string>;
};

function encodeKey(...parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

function uniqueSortedIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0))).sort();
}

function parseChunkEntry(key: string, prefix: string, value: unknown): { docKey: string; entry: ChunkEntry } | null {
  if (!key.startsWith(prefix)) return null;
  const body = key.slice(prefix.length);
  const separatorIndex = body.lastIndexOf(':');
  if (separatorIndex < 0) return null;
  const docKey = body.slice(0, separatorIndex);
  const index = Number(body.slice(separatorIndex + 1));
  if (!docKey || !Number.isInteger(index) || index < 0) return null;
  return {
    docKey,
    entry: { key, index, value }
  };
}

function addChunk(chunksByKey: Map<string, ChunkEntry[]>, docKey: string, entry: ChunkEntry) {
  chunksByKey.set(docKey, [
    ...(chunksByKey.get(docKey) ?? []),
    entry
  ]);
}

function buildBodyIndex(args: {
  kv: PersistedDbEntry[];
  splitPrefix: string;
  chunkPrefix: string;
  legacyDocs?: Record<string, string>;
}): BodyIndex {
  const splitByKey = new Map<string, { key: string; value: unknown }>();
  const chunksByKey = new Map<string, ChunkEntry[]>();
  const legacyByKey = new Map(Object.entries(args.legacyDocs ?? {}));

  args.kv.forEach((entry) => {
    if (entry.key.startsWith(args.splitPrefix)) {
      splitByKey.set(entry.key.slice(args.splitPrefix.length), entry);
      return;
    }
    const chunk = parseChunkEntry(entry.key, args.chunkPrefix, entry.value);
    if (chunk) addChunk(chunksByKey, chunk.docKey, chunk.entry);
  });

  return {
    splitByKey,
    chunksByKey,
    legacyByKey
  };
}

function resolveChunkedBody(docKey: string, entries: ChunkEntry[]): DocumentBodySource {
  const sortedEntries = [...entries].sort((left, right) => left.index - right.index);
  const expectedIndexes = sortedEntries.map((_, index) => index);
  const actualIndexes = sortedEntries.map((entry) => entry.index);
  const contiguous = expectedIndexes.every((index, offset) => actualIndexes[offset] === index)
    && sortedEntries.every((entry) => typeof entry.value === 'string');

  return {
    source: 'chunked',
    content: contiguous ? sortedEntries.map((entry) => entry.value as string).join('') : null,
    keys: sortedEntries.map((entry) => entry.key),
    chunkIndexes: actualIndexes,
    chunkCount: sortedEntries.length,
    contiguous
  };
}

function resolveBody(args: {
  docKey: string;
  inlineContent: string;
  inlineLoaded: boolean;
  expectsBody: boolean;
  index: BodyIndex;
}): DocumentBodySource {
  if (args.inlineLoaded || args.inlineContent.length > 0) {
    return {
      source: 'inline',
      content: args.inlineContent,
      keys: [],
      chunkIndexes: [],
      chunkCount: 0,
      contiguous: true
    };
  }

  const chunks = args.index.chunksByKey.get(args.docKey);
  if (chunks?.length) return resolveChunkedBody(args.docKey, chunks);

  const split = args.index.splitByKey.get(args.docKey);
  if (split) {
    return {
      source: 'split',
      content: typeof split.value === 'string' ? split.value : null,
      keys: [split.key],
      chunkIndexes: [],
      chunkCount: 0,
      contiguous: true
    };
  }

  if (args.index.legacyByKey.has(args.docKey)) {
    return {
      source: 'legacy',
      content: args.index.legacyByKey.get(args.docKey) ?? '',
      keys: [PERSONA_LEGACY_KEY],
      chunkIndexes: [],
      chunkCount: 0,
      contiguous: true
    };
  }

  return {
    source: args.expectsBody ? 'missing' : 'empty',
    content: args.expectsBody ? null : '',
    keys: [],
    chunkIndexes: [],
    chunkCount: 0,
    contiguous: true
  };
}

function declaredCharCount(doc: { charCount?: number; content: string }) {
  return typeof doc.charCount === 'number' ? doc.charCount : doc.content.length;
}

function personaDocSeed(
  persona: Persona,
  doc: PersonaMemoryReferenceDoc,
  body: DocumentBodySource
): DocumentObjectSeed {
  const docKey = encodeKey(persona.id, doc.id);
  return {
    id: docKey,
    kind: 'persona-memory-doc',
    title: doc.title,
    summary: doc.summary,
    declaredCharCount: declaredCharCount(doc),
    contentLoaded: Boolean(doc.contentLoaded),
    body,
    ownerRefs: [{
      kind: 'persona',
      id: persona.id,
      label: persona.name.trim() || persona.id
    }],
    updatedAt: doc.updatedAt,
    expectsBody: declaredCharCount(doc) > 0 || doc.content.length > 0
  };
}

function workspaceDocSeed(
  doc: WorkspaceReferenceDoc,
  body: DocumentBodySource
): DocumentObjectSeed {
  const docKey = encodeKey(doc.id);
  return {
    id: docKey,
    kind: 'workspace-reference-doc',
    title: doc.title,
    summary: doc.summary,
    declaredCharCount: declaredCharCount(doc),
    contentLoaded: Boolean(doc.contentLoaded),
    body,
    ownerRefs: [{
      kind: 'workspace-doc',
      id: doc.id,
      label: doc.title.trim() || doc.id
    }],
    updatedAt: doc.updatedAt,
    expectsBody: declaredCharCount(doc) > 0 || doc.content.length > 0
  };
}

function orphanSeed(args: {
  id: string;
  storageLabel: string;
  body: DocumentBodySource;
  updatedAt: number;
}): DocumentObjectSeed {
  return {
    id: args.id,
    kind: 'orphan-body',
    title: args.storageLabel,
    summary: '',
    declaredCharCount: args.body.content?.length ?? 0,
    contentLoaded: args.body.content !== null,
    body: args.body,
    ownerRefs: [],
    updatedAt: args.updatedAt,
    expectsBody: true
  };
}

function collectBodyKeys(index: BodyIndex) {
  return new Set([
    ...index.splitByKey.keys(),
    ...index.chunksByKey.keys(),
    ...index.legacyByKey.keys()
  ]);
}

function buildOrphanBodySeeds(args: {
  index: BodyIndex;
  declaredKeys: Set<string>;
  idPrefix: string;
  storageLabel: string;
  updatedAt: number;
}) {
  return uniqueSortedIds(collectBodyKeys(args.index))
    .filter((docKey) => !args.declaredKeys.has(docKey))
    .map((docKey) => orphanSeed({
      id: `${args.idPrefix}:${docKey}`,
      storageLabel: `${args.storageLabel}:${docKey}`,
      body: resolveBody({
        docKey,
        inlineContent: '',
        inlineLoaded: false,
        expectsBody: true,
        index: args.index
      }),
      updatedAt: args.updatedAt
    }));
}

export function buildDocumentLocalDataStateFromSources(args: {
  kv: PersistedDbEntry[];
  personas: Persona[];
  workspaceReferenceDocs: WorkspaceReferenceDoc[];
  updatedAt: number;
}): DocumentLocalDataState {
  const personaLegacy = args.kv.find((entry) => entry.key === PERSONA_LEGACY_KEY)?.value;
  const personaIndex = buildBodyIndex({
    kv: args.kv,
    splitPrefix: PERSONA_SPLIT_PREFIX,
    chunkPrefix: PERSONA_CHUNK_PREFIX,
    legacyDocs: personaLegacy && typeof personaLegacy === 'object' && 'docs' in personaLegacy
      ? (personaLegacy as { docs?: Record<string, string> }).docs
      : undefined
  });
  const workspaceIndex = buildBodyIndex({
    kv: args.kv,
    splitPrefix: WORKSPACE_SPLIT_PREFIX,
    chunkPrefix: WORKSPACE_CHUNK_PREFIX
  });
  const declaredPersonaKeys = new Set<string>();
  const declaredWorkspaceKeys = new Set<string>();
  const documents: DocumentObjectSeed[] = [];

  args.personas.forEach((persona) => {
    persona.memory.referenceDocs.forEach((doc) => {
      const docKey = encodeKey(persona.id, doc.id);
      declaredPersonaKeys.add(docKey);
      if (doc.bodyStatus === 'missing') return;
      documents.push(personaDocSeed(
        persona,
        doc,
        resolveBody({
          docKey,
          inlineContent: doc.content,
          inlineLoaded: Boolean(doc.contentLoaded),
          expectsBody: declaredCharCount(doc) > 0 || doc.content.length > 0,
          index: personaIndex
        })
      ));
    });
  });

  args.workspaceReferenceDocs.forEach((doc) => {
    const docKey = encodeKey(doc.id);
    declaredWorkspaceKeys.add(docKey);
    documents.push(workspaceDocSeed(
      doc,
      resolveBody({
        docKey,
        inlineContent: doc.content,
        inlineLoaded: Boolean(doc.contentLoaded),
        expectsBody: declaredCharCount(doc) > 0 || doc.content.length > 0,
        index: workspaceIndex
      })
    ));
  });

  documents.push(...buildOrphanBodySeeds({
    index: personaIndex,
    declaredKeys: declaredPersonaKeys,
    idPrefix: 'persona-orphan',
    storageLabel: 'persona-memory-doc',
    updatedAt: args.updatedAt
  }));
  documents.push(...buildOrphanBodySeeds({
    index: workspaceIndex,
    declaredKeys: declaredWorkspaceKeys,
    idPrefix: 'workspace-orphan',
    storageLabel: 'workspace-reference-doc',
    updatedAt: args.updatedAt
  }));

  return { documents };
}
