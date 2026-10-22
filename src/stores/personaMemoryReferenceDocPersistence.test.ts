import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from './storeLocalDataBackendHost';
import {
  buildPersonaMemoryDocContentPayload,
  readPersonaMemoryDocContent,
  readPersonaMemoryDocContentPayload,
  restorePersonaMemoryDocContent,
  serializePersonaMemoryDocContentEntries,
  clearStagedPersonaMemoryDocContent,
  stagePersonaMemoryDocContent,
  stripPersonaMemoryDocContent,
  wouldEraseUnloadedPersonaMemoryDocContent,
  writePersonaMemoryDocContentForPersonas
} from './personaMemoryReferenceDocPersistence';

const persistence = vi.hoisted(() => ({
  kvKeys: vi.fn(),
  kvKeysWithPrefix: vi.fn(),
  kvGet: vi.fn(),
  kvApplyMutations: vi.fn()
}));

vi.mock('../infrastructure/persistence', () => ({
  kvKeys: persistence.kvKeys,
  kvKeysWithPrefix: persistence.kvKeysWithPrefix,
  kvGet: persistence.kvGet,
  kvApplyMutations: persistence.kvApplyMutations
}));

describe('personaMemoryReferenceDocPersistence', () => {
  beforeEach(() => {
    persistence.kvKeys.mockReset();
    persistence.kvKeysWithPrefix.mockReset();
    persistence.kvKeysWithPrefix.mockImplementation(async (prefix: string) =>
      (await persistence.kvKeys()).filter((key: string) => key.startsWith(prefix))
    );
    persistence.kvGet.mockReset();
    persistence.kvApplyMutations.mockReset();
    clearStagedPersonaMemoryDocContent();
    // The persona doc-body writer checks LocalData domain activity through the store backend
    // host; install an inactive backend so that check stays self-contained (the doc-body chunk
    // store itself is the separate KV layer these tests drive).
    installStoreLocalDataBackend({
      mode: 'transactional',
      read: async () => null,
      listKeysWithPrefix: async () => [],
      commitAtomic: async () => {}
    });
  });

  afterEach(() => {
    resetStoreLocalDataBackendForTesting();
  });

  it('stores long memory document bodies outside the persona payload', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: ['short'],
        referenceDocs: [{
          id: 'doc-1',
          title: 'Large doc',
          summary: 'summary',
          content: 'very long body',
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    const contentPayload = buildPersonaMemoryDocContentPayload([persona]);
    const stripped = stripPersonaMemoryDocContent([persona]);

    expect(contentPayload.docs['persona-1:doc-1']).toBe('very long body');
    expect(stripped[0]?.memory.referenceDocs[0]?.content).toBe('');
    expect(stripped[0]?.memory.referenceDocs[0]?.charCount).toBe('very long body'.length);
    expect(stripped[0]?.memory.referenceDocs[0]?.contentLoaded).toBe(false);
  });

  it('restores split document bodies during persona hydration', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-1',
          title: 'Large doc',
          summary: 'summary',
          content: '',
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    const restored = restorePersonaMemoryDocContent([persona], {
      version: 1,
      docs: {
        'persona-1:doc-1': 'restored body'
      }
    });

    expect(restored[0]?.memory.referenceDocs[0]?.content).toBe('restored body');
    expect(restored[0]?.memory.referenceDocs[0]?.contentLoaded).toBe(true);
  });

  it('clears a missing marker when the package supplies a verified body', () => {
    const persona = createPersonaTemplate({id: 'p', name: 'P', description: '', memory: {referenceDocs: [{
      id: 'd', title: 'Notes', summary: '', content: '', contentLoaded: false, charCount: 4,
      bodyStatus: 'missing', source: 'upload', updatedAt: 1
    }]}});
    const doc = restorePersonaMemoryDocContent([persona], {version: 1, docs: {'p:d': 'body'}})[0].memory.referenceDocs[0];
    expect(doc).toMatchObject({content: 'body', contentLoaded: true});
    expect(doc.bodyStatus).toBeUndefined();
  });

  it('does not restore a missing split body as loaded empty content', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-1',
          title: 'Large doc',
          summary: 'summary',
          content: '',
          charCount: 42,
          contentLoaded: false,
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    const restored = restorePersonaMemoryDocContent([persona], {
      version: 1,
      docs: {}
    });

    expect(restored[0]?.memory.referenceDocs[0]).toEqual(expect.objectContaining({
      content: '',
      charCount: 42,
      contentLoaded: false
    }));
  });

  it('keeps legacy inline content when the split payload is not present yet', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-1',
          title: 'Legacy doc',
          summary: 'summary',
          content: 'legacy body',
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    const restored = restorePersonaMemoryDocContent([persona], null);

    expect(restored[0]?.memory.referenceDocs[0]?.content).toBe('legacy body');
  });

  it('does not invent an empty body payload for an unloaded missing memory document', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-missing',
          title: 'Missing doc',
          summary: 'summary',
          content: '',
          charCount: 42,
          contentLoaded: false,
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    expect(buildPersonaMemoryDocContentPayload([persona], {
      version: 1,
      docs: {}
    })).toEqual({
      version: 1,
      docs: {}
    });
  });

  it('does not preserve an empty existing payload for a non-empty memory document directory', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-missing',
          title: 'Missing doc',
          summary: 'summary',
          content: '',
          charCount: 42,
          contentLoaded: false,
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    expect(buildPersonaMemoryDocContentPayload([persona], {
      version: 1,
      docs: {
        'persona-1:doc-missing': ''
      }
    })).toEqual({
      version: 1,
      docs: {}
    });
  });

  it('ignores staged empty content that contradicts an unloaded memory document count', () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-missing',
          title: 'Missing doc',
          summary: 'summary',
          content: '',
          charCount: 42,
          contentLoaded: false,
          source: 'upload',
          updatedAt: 1
        }]
      }
    });
    stagePersonaMemoryDocContent('persona-1', 'doc-missing', '');

    expect(buildPersonaMemoryDocContentPayload([persona])).toEqual({
      version: 1,
      docs: {}
    });
  });

  it('serializes document bodies as per-document persisted entries', () => {
    expect(serializePersonaMemoryDocContentEntries({
      version: 1,
      docs: {
        'persona-1:doc-1': 'body 1',
        'persona-1:doc-2': 'body 2'
      }
    })).toEqual([
      {
        key: 'persona-memory-doc-content-v2:persona-1:doc-1',
        value: 'body 1'
      },
      {
        key: 'persona-memory-doc-content-v2:persona-1:doc-2',
        value: 'body 2'
      }
    ]);
  });

  it('serializes large document bodies as chunked persisted entries', () => {
    const largeBody = 'A'.repeat(70 * 1024);

    const entries = serializePersonaMemoryDocContentEntries({
      version: 1,
      docs: {
        'persona-1:doc-large': largeBody
      }
    });

    expect(entries).toEqual([
      {
        key: 'persona-memory-doc-content-v3:persona-1:doc-large:0',
        value: 'A'.repeat(64 * 1024)
      },
      {
        key: 'persona-memory-doc-content-v3:persona-1:doc-large:1',
        value: 'A'.repeat(6 * 1024)
      }
    ]);
  });

  it('reads chunked document bodies without requiring a single body entry', async () => {
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v3:persona-1:doc-large:1',
      'persona-memory-doc-content-v3:persona-1:doc-large:0'
    ]);
    persistence.kvGet.mockImplementation(async (key: string) => {
      if (key === 'persona-memory-doc-content-v3:persona-1:doc-large:0') return 'hello ';
      if (key === 'persona-memory-doc-content-v3:persona-1:doc-large:1') return 'world';
      return null;
    });

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-large',
      title: 'Large doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      contentLoaded: false
    })).resolves.toBe('hello world');
    await expect(readPersonaMemoryDocContentPayload()).resolves.toEqual({
      version: 1,
      docs: {
        'persona-1:doc-large': 'hello world'
      }
    });
  });

  it('throws instead of silently joining a partial chunked memory document body', async () => {
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v3:persona-1:doc-large:0',
      'persona-memory-doc-content-v3:persona-1:doc-large:1'
    ]);
    persistence.kvGet.mockImplementation(async (key: string) => {
      if (key === 'persona-memory-doc-content-v3:persona-1:doc-large:0') return 'hello ';
      return null;
    });

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-large',
      title: 'Large doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      contentLoaded: false
    })).rejects.toThrow('Persona memory document content chunk is missing');
    await expect(readPersonaMemoryDocContentPayload()).rejects.toThrow(
      'Persona memory document content chunk is missing'
    );
  });

  it('throws when memory document chunk indexes are not contiguous', async () => {
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v3:persona-1:doc-large:0',
      'persona-memory-doc-content-v3:persona-1:doc-large:2'
    ]);
    persistence.kvGet.mockResolvedValue('chunk');

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-large',
      title: 'Large doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      contentLoaded: false
    })).rejects.toThrow('Persona memory document content chunk is missing');
  });

  it('throws instead of treating an unloaded missing memory document body as empty', async () => {
    persistence.kvKeys.mockResolvedValue([]);
    persistence.kvGet.mockResolvedValue(null);

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-missing',
      title: 'Missing doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      charCount: 42,
      contentLoaded: false
    })).rejects.toThrow('Persona memory document content is missing');
  });

  it('throws instead of treating an unloaded imported shell without a count as empty content', async () => {
    persistence.kvKeys.mockResolvedValue([]);
    persistence.kvGet.mockResolvedValue(null);

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-missing-count',
      title: 'Imported shell',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      contentLoaded: false
    })).rejects.toThrow('Persona memory document content is missing');
  });

  it('throws instead of accepting an empty split body for a non-empty memory directory', async () => {
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v2:persona-1:doc-missing'
    ]);
    persistence.kvGet.mockImplementation(async (key: string) => {
      if (key === 'persona-memory-doc-content-v2:persona-1:doc-missing') return '';
      return null;
    });

    await expect(readPersonaMemoryDocContent('persona-1', {
      id: 'doc-missing',
      title: 'Missing doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      charCount: 42,
      contentLoaded: false
    })).rejects.toThrow('Persona memory document content is missing');
  });

  it('detects empty overwrites of unloaded memory document bodies', () => {
    expect(wouldEraseUnloadedPersonaMemoryDocContent({
      id: 'doc-missing',
      title: 'Missing doc',
      summary: 'summary',
      content: '',
      source: 'upload',
      updatedAt: 1,
      charCount: 42,
      contentLoaded: false
    }, '')).toBe(true);
    expect(wouldEraseUnloadedPersonaMemoryDocContent({
      id: 'doc-loaded',
      title: 'Loaded doc',
      summary: 'summary',
      content: 'loaded',
      source: 'upload',
      updatedAt: 1,
      charCount: 6,
      contentLoaded: true
    }, '')).toBe(false);
  });

  it('deletes split document bodies that no current persona directory owns', async () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-current',
          title: 'Current doc',
          summary: 'summary',
          content: '',
          source: 'upload',
          updatedAt: 1
        }]
      }
    });
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v2:persona-1:doc-current',
      'persona-memory-doc-content-v2:persona-1:doc-deleted',
      'persona-memory-doc-content-v2:persona-deleted:doc-old'
    ]);
    persistence.kvGet.mockResolvedValue(null);

    await writePersonaMemoryDocContentForPersonas([persona]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([
      { type: 'delete', key: 'persona-memory-doc-content-v2:persona-1:doc-deleted' },
      { type: 'delete', key: 'persona-memory-doc-content-v2:persona-deleted:doc-old' }
    ]);
  });

  it('preserves unloaded chunked bodies for current document directories', async () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-current',
          title: 'Current doc',
          summary: 'summary',
          content: '',
          source: 'upload',
          updatedAt: 1,
          contentLoaded: false
        }]
      }
    });
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v3:persona-1:doc-current:0',
      'persona-memory-doc-content-v3:persona-1:doc-current:1',
      'persona-memory-doc-content-v3:persona-1:doc-deleted:0'
    ]);
    persistence.kvGet.mockResolvedValue(null);

    await writePersonaMemoryDocContentForPersonas([persona]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([
      { type: 'delete', key: 'persona-memory-doc-content-v3:persona-1:doc-deleted:0' }
    ]);
  });

  it('does not rewrite loaded document bodies when only persona metadata changed', async () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'Renamed persona',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-current',
          title: 'Current doc',
          summary: 'summary',
          content: 'loaded body that should not be rewritten',
          source: 'upload',
          updatedAt: 1,
          contentLoaded: true
        }]
      }
    });
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v2:persona-1:doc-current'
    ]);
    persistence.kvGet.mockImplementation(async (key) => (
      key === 'persona-memory-doc-content-v2:persona-1:doc-current'
        ? 'loaded body that should not be rewritten'
        : null
    ));

    await writePersonaMemoryDocContentForPersonas([persona]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([]);
  });

  it('rewrites only staged document content and clears stale chunks for that document', async () => {
    const persona = createPersonaTemplate({
      id: 'persona-1',
      name: 'A',
      description: '',
      memory: {
        inheritGlobal: true,
        crossConversationRecallEnabled: true,
        excludedGlobalIds: [],
        personalMemories: [],
        referenceDocs: [{
          id: 'doc-current',
          title: 'Current doc',
          summary: 'summary',
          content: '',
          source: 'upload',
          updatedAt: 1,
          contentLoaded: false
        }, {
          id: 'doc-other',
          title: 'Other doc',
          summary: 'summary',
          content: '',
          source: 'upload',
          updatedAt: 1,
          contentLoaded: false
        }]
      }
    });
    stagePersonaMemoryDocContent('persona-1', 'doc-current', 'shorter body');
    persistence.kvKeys.mockResolvedValue([
      'persona-memory-doc-content-v3:persona-1:doc-current:0',
      'persona-memory-doc-content-v3:persona-1:doc-current:1',
      'persona-memory-doc-content-v2:persona-1:doc-other'
    ]);
    persistence.kvGet.mockResolvedValue(null);

    await writePersonaMemoryDocContentForPersonas([persona]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([
      {
        type: 'set',
        key: 'persona-memory-doc-content-v2:persona-1:doc-current',
        value: 'shorter body'
      },
      { type: 'delete', key: 'persona-memory-doc-content-v3:persona-1:doc-current:0' },
      { type: 'delete', key: 'persona-memory-doc-content-v3:persona-1:doc-current:1' }
    ]);
  });
});
