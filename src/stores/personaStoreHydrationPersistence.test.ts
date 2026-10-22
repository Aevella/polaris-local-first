import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('personaStore hydration persistence repair', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../infrastructure/persistenceDiagnostics', () => ({
      reportPersistenceError: vi.fn()
    }));
  });

  // Persona hydrate/persist checks LocalData repository activity through the store backend host.
  // These legacy-repair scenarios run against an inactive repository, so install an inactive
  // backend (after the persistence doMock) instead of relying on the partial KV mock.
  async function installInactiveStoreLocalDataBackend() {
    const { installStoreLocalDataBackend } = await import('./storeLocalDataBackendHost');
    installStoreLocalDataBackend({
      mode: 'transactional',
      read: async () => null,
      listKeysWithPrefix: async () => [],
      commitAtomic: async () => {}
    });
  }

  it('hydrates persona directories without reading long memory document bodies', async () => {
    const kvGet = vi.fn(async (key: string) => {
      if (key !== 'persona-state-v2') return null;
      return {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      };
    });
    const kvSet = vi.fn(async (_key: string, _value: unknown) => {});
    const kvKeys = vi.fn(async (): Promise<string[]> => []);
    const kvKeysWithPrefix = vi.fn(async (prefix: string) => (await kvKeys()).filter((key) => key.startsWith(prefix)));
    const kvApplyMutations = vi.fn(async () => {});
    vi.doMock('../infrastructure/persistence', () => ({ kvGet, kvSet, kvKeys, kvKeysWithPrefix, kvApplyMutations }));
    await installInactiveStoreLocalDataBackend();

    const { usePersonaStore } = await import('./personaStore');
    const shouldPersist = await usePersonaStore.getState().hydrateFromDb();

    expect(shouldPersist).toBe(false);
    expect(usePersonaStore.getState().hydrated).toBe(true);
    expect(kvGet).toHaveBeenCalledWith('persona-state-v2');
    expect(kvGet).not.toHaveBeenCalledWith('persona-memory-doc-content-v1');
    expect(kvGet).not.toHaveBeenCalledWith('persona-state-v1');
    expect(kvSet).not.toHaveBeenCalled();
  });

  it('persists memory reference document content outside the persona state payload', async () => {
    const kvGet = vi.fn(async (key: string) => {
      if (key === 'persona-memory-doc-content-v1') return null;
      if (key !== 'persona-state-v2') return null;
      return {
        personas: [{
          id: 'persona-1',
          name: 'A',
          description: '',
          memory: {
            inheritGlobal: true,
            excludedGlobalIds: [],
            personalMemories: [],
            referenceDocs: [{
              id: 'doc-1',
              title: 'Imported',
              summary: 'summary',
              content: 'large body',
              source: 'upload',
              updatedAt: 1
            }]
          }
        }],
        activeCollaboratorId: 'persona-1',
        seededDefaultPersonaIds: []
      };
    });
    const kvSet = vi.fn(async (_key: string, _value: unknown) => {});
    // An old install whose memory bodies still live in legacy chunked-KV: the document domain
    // must NOT self-activate on this ordinary save (that would strand unloaded bodies), so the
    // body keeps writing to chunked-KV. The doc's own entry key is present, so nothing is stale.
    const kvKeys = vi.fn(async (): Promise<string[]> => ['persona-memory-doc-content-v2:persona-1:doc-1']);
    const kvKeysWithPrefix = vi.fn(async (prefix: string) => (await kvKeys()).filter((key) => key.startsWith(prefix)));
    const kvApplyMutations = vi.fn(async (_mutations: unknown[]) => {});
    vi.doMock('../infrastructure/persistence', () => ({ kvGet, kvSet, kvKeys, kvKeysWithPrefix, kvApplyMutations }));
    await installInactiveStoreLocalDataBackend();

    const { usePersonaStore } = await import('./personaStore');
    await usePersonaStore.getState().hydrateFromDb();
    const hydratedPersona = usePersonaStore.getState().personas.find((persona) => persona.id === 'persona-1');
    expect(hydratedPersona?.memory.referenceDocs[0]?.content).toBe('');
    expect(hydratedPersona?.memory.referenceDocs[0]?.charCount).toBe('large body'.length);
    await usePersonaStore.getState().persistToDb();

    expect(kvApplyMutations).toHaveBeenCalledWith([{
      type: 'set',
      key: 'persona-memory-doc-content-v2:persona-1:doc-1',
      value: 'large body'
    }]);
    const personaStatePayload = kvSet.mock.calls.find(([key]) => key === 'persona-state-v2')?.[1] as {
      personas: Array<{ id: string; memory: { referenceDocs: Array<{ id: string; content: string }> } }>;
    };
    const persistedPersona = personaStatePayload.personas.find((persona) => persona.id === 'persona-1');

    expect(persistedPersona?.memory.referenceDocs).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        content: ''
      })
    ]);
  });

  it('serializes overlapping persona persists and writes the latest snapshot second', async () => {
    let releaseFirstWrite: () => void = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const kvGet = vi.fn(async (key: string) => {
      if (key !== 'persona-state-v2') return null;
      return {
        personas: [],
        activeCollaboratorId: null,
        seededDefaultPersonaIds: []
      };
    });
    const kvSet = vi.fn(async () => {});
    // Old install: the persona directory and memory bodies are still legacy, so the persona domain
    // and document domain both decline ordinary self-activation; the body writes stay serialized on
    // chunked-KV while the directory keeps using persona-state-v2.
    const kvKeys = vi.fn(async (): Promise<string[]> => ['persona-memory-doc-content-v2:persona-1:doc-1']);
    const kvKeysWithPrefix = vi.fn(async (prefix: string) => (await kvKeys()).filter((key) => key.startsWith(prefix)));
    const kvApplyMutations = vi.fn(async (_mutations: unknown[]) => {
      if (kvApplyMutations.mock.calls.length === 1) {
        await firstWrite;
      }
    });
    vi.doMock('../infrastructure/persistence', () => ({ kvGet, kvSet, kvKeys, kvKeysWithPrefix, kvApplyMutations }));
    await installInactiveStoreLocalDataBackend();

    const [{ usePersonaStore }, { createPersonaTemplate }] = await Promise.all([
      import('./personaStore'),
      import('../config/persona/personaBuilder')
    ]);
    const makePersona = (content: string) => createPersonaTemplate({
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
          title: 'Doc',
          summary: '',
          content,
          source: 'upload',
          updatedAt: 1
        }]
      }
    });

    usePersonaStore.setState({
      personas: [makePersona('first body')],
      activeCollaboratorId: 'persona-1',
      seededDefaultPersonaIds: []
    });
    const firstPersist = usePersonaStore.getState().persistToDb();
    usePersonaStore.setState({ personas: [makePersona('second body')] });
    const secondPersist = usePersonaStore.getState().persistToDb();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kvApplyMutations).toHaveBeenCalledTimes(1);

    releaseFirstWrite();
    await Promise.all([firstPersist, secondPersist]);

    expect(kvApplyMutations).toHaveBeenCalledTimes(2);
    expect(kvApplyMutations.mock.calls[1]?.[0]).toEqual([{
      type: 'set',
      key: 'persona-memory-doc-content-v2:persona-1:doc-1',
      value: 'second body'
    }]);
  });

  it('keeps persona unhydrated when persistence reads fail', async () => {
    const kvGet = vi.fn(async () => {
      throw new Error('db unavailable');
    });
    const kvSet = vi.fn(async () => {});
    const kvKeys = vi.fn(async (): Promise<string[]> => []);
    const kvKeysWithPrefix = vi.fn(async (prefix: string) => (await kvKeys()).filter((key) => key.startsWith(prefix)));
    const kvApplyMutations = vi.fn(async () => {});
    vi.doMock('../infrastructure/persistence', () => ({ kvGet, kvSet, kvKeys, kvKeysWithPrefix, kvApplyMutations }));
    await installInactiveStoreLocalDataBackend();

    const { usePersonaStore } = await import('./personaStore');
    const shouldPersist = await usePersonaStore.getState().hydrateFromDb();

    expect(shouldPersist).toBe(false);
    expect(usePersonaStore.getState().hydrated).toBe(false);
  });
});
