import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceReferenceDoc } from '../types/domain';
import {
  installStoreLocalDataBackend,
  resetStoreLocalDataBackendForTesting
} from './storeLocalDataBackendHost';
import {
  buildWorkspaceReferenceDocContentPayload,
  readWorkspaceReferenceDocContent,
  readWorkspaceReferenceDocContentPayload,
  restoreWorkspaceReferenceDocContent,
  serializeWorkspaceReferenceDocContentEntries,
  clearStagedWorkspaceReferenceDocContent,
  stageWorkspaceReferenceDocContent,
  stripWorkspaceReferenceDocContent,
  writeWorkspaceReferenceDocContentForDocs
} from './workspaceReferenceDocContentPersistence';

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

function makeDoc(patch: Partial<WorkspaceReferenceDoc> & Pick<WorkspaceReferenceDoc, 'id' | 'content'>): WorkspaceReferenceDoc {
  return {
    id: patch.id,
    projectId: patch.projectId ?? 'project-1',
    title: patch.title ?? 'Reference',
    summary: patch.summary ?? 'summary',
    content: patch.content,
    source: patch.source ?? 'manual',
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    charCount: patch.charCount,
    contentLoaded: patch.contentLoaded
  };
}

describe('workspaceReferenceDocContentPersistence', () => {
  beforeEach(() => {
    persistence.kvKeys.mockReset();
    persistence.kvKeysWithPrefix.mockReset();
    persistence.kvKeysWithPrefix.mockImplementation(async (prefix: string) =>
      (await persistence.kvKeys()).filter((key: string) => key.startsWith(prefix))
    );
    persistence.kvGet.mockReset();
    persistence.kvApplyMutations.mockReset();
    clearStagedWorkspaceReferenceDocContent();
    // The workspace doc-body writer checks LocalData domain activity through the store backend
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

  it('strips workspace reference document bodies while preserving directory metadata', () => {
    const [stripped] = stripWorkspaceReferenceDocContent([
      makeDoc({ id: 'doc-1', content: 'large body' })
    ]);

    expect(stripped?.content).toBe('');
    expect(stripped?.charCount).toBe('large body'.length);
    expect(stripped?.contentLoaded).toBe(false);
  });

  it('does not restore a missing split body as loaded empty content', () => {
    const [restored] = restoreWorkspaceReferenceDocContent([
      makeDoc({
        id: 'doc-1',
        content: '',
        charCount: 42,
        contentLoaded: false
      })
    ], {
      version: 1,
      docs: {}
    });

    expect(restored).toEqual(expect.objectContaining({
      content: '',
      charCount: 42,
      contentLoaded: false
    }));
  });

  it('does not invent an empty body payload for an unloaded missing workspace document', () => {
    expect(buildWorkspaceReferenceDocContentPayload([
      makeDoc({
        id: 'doc-missing',
        content: '',
        charCount: 42,
        contentLoaded: false
      })
    ])).toEqual({
      version: 1,
      docs: {}
    });
  });

  it('ignores staged empty content that contradicts an unloaded body count', () => {
    stageWorkspaceReferenceDocContent('doc-missing', '');

    expect(buildWorkspaceReferenceDocContentPayload([
      makeDoc({
        id: 'doc-missing',
        content: '',
        charCount: 42,
        contentLoaded: false
      })
    ])).toEqual({
      version: 1,
      docs: {}
    });
  });

  it('serializes large document bodies as chunked entries', () => {
    const largeBody = 'A'.repeat(70 * 1024);

    const entries = serializeWorkspaceReferenceDocContentEntries({
      version: 1,
      docs: {
        'doc-large': largeBody
      }
    });

    expect(entries).toEqual([
      {
        key: 'workspace-reference-doc-content-v2:doc-large:0',
        value: 'A'.repeat(64 * 1024)
      },
      {
        key: 'workspace-reference-doc-content-v2:doc-large:1',
        value: 'A'.repeat(6 * 1024)
      }
    ]);
  });

  it('reads chunked document bodies in index order', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v2:doc-large:1',
      'workspace-reference-doc-content-v2:doc-large:0'
    ]);
    persistence.kvGet.mockImplementation(async (key: string) => {
      if (key === 'workspace-reference-doc-content-v2:doc-large:0') return 'hello ';
      if (key === 'workspace-reference-doc-content-v2:doc-large:1') return 'world';
      return null;
    });

    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-large',
      content: '',
      contentLoaded: false
    }))).resolves.toBe('hello world');
    await expect(readWorkspaceReferenceDocContentPayload()).resolves.toEqual({
      version: 1,
      docs: {
        'doc-large': 'hello world'
      }
    });
  });

  it('throws instead of silently joining a partial chunked document body', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v2:doc-large:0',
      'workspace-reference-doc-content-v2:doc-large:1'
    ]);
    persistence.kvGet.mockImplementation(async (key: string) => {
      if (key === 'workspace-reference-doc-content-v2:doc-large:0') return 'hello ';
      return null;
    });

    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-large',
      content: '',
      contentLoaded: false
    }))).rejects.toThrow('Workspace reference document content chunk is missing');
    await expect(readWorkspaceReferenceDocContentPayload()).rejects.toThrow(
      'Workspace reference document content chunk is missing'
    );
  });

  it('throws when chunk indexes are not contiguous', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v2:doc-large:0',
      'workspace-reference-doc-content-v2:doc-large:2'
    ]);
    persistence.kvGet.mockResolvedValue('chunk');

    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-large',
      content: '',
      contentLoaded: false
    }))).rejects.toThrow('Workspace reference document content chunk is missing');
  });

  it('reads the valid persisted body when staged content does not match the current directory', async () => {
    const body = 'current complete document';
    stageWorkspaceReferenceDocContent('doc-current', 'old');
    persistence.kvKeys.mockResolvedValue(['workspace-reference-doc-content-v1:doc-current']);
    persistence.kvGet.mockResolvedValue(body);
    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-current', content: '', charCount: body.length, contentLoaded: false
    }))).resolves.toBe(body);
    expect(persistence.kvApplyMutations).not.toHaveBeenCalled();
  });

  it('does not turn invalid staged content into an empty or truncated backup when disk is also missing', async () => {
    stageWorkspaceReferenceDocContent('doc-current', 'old');
    persistence.kvKeys.mockResolvedValue([]);
    persistence.kvGet.mockResolvedValue(null);
    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-current', content: '', charCount: 42, contentLoaded: false
    }))).rejects.toThrow('Workspace reference document content is missing');
  });

  it('throws instead of treating an unloaded missing document body as empty', async () => {
    persistence.kvKeys.mockResolvedValue([]);
    persistence.kvGet.mockResolvedValue(null);

    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-missing',
      content: '',
      charCount: 42,
      contentLoaded: false
    }))).rejects.toThrow('Workspace reference document content is missing');
  });

  it('throws instead of accepting an empty split body for a non-empty directory', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v1:doc-missing'
    ]);
    persistence.kvGet.mockResolvedValue('');

    await expect(readWorkspaceReferenceDocContent(makeDoc({
      id: 'doc-missing',
      content: '',
      charCount: 42,
      contentLoaded: false
    }))).rejects.toThrow('Workspace reference document content is missing');
  });

  it('preserves unloaded chunked bodies for current document directories', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v2:doc-current:0',
      'workspace-reference-doc-content-v2:doc-current:1',
      'workspace-reference-doc-content-v2:doc-deleted:0'
    ]);
    persistence.kvGet.mockResolvedValue(null);

    await writeWorkspaceReferenceDocContentForDocs([
      makeDoc({
        id: 'doc-current',
        content: '',
        contentLoaded: false
      })
    ]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([
      { type: 'delete', key: 'workspace-reference-doc-content-v2:doc-deleted:0' }
    ]);
  });

  it('does not rewrite loaded document bodies when only collection metadata changed', async () => {
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v1:doc-current'
    ]);
    persistence.kvGet.mockImplementation(async (key) => (
      key === 'workspace-reference-doc-content-v1:doc-current'
        ? 'loaded body that should not be rewritten'
        : null
    ));

    await writeWorkspaceReferenceDocContentForDocs([
      makeDoc({
        id: 'doc-current',
        title: 'Retitled reference',
        content: 'loaded body that should not be rewritten',
        contentLoaded: true
      })
    ]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([]);
  });

  it('rewrites only staged document content and clears stale chunks for that document', async () => {
    stageWorkspaceReferenceDocContent('doc-current', 'shorter body');
    persistence.kvKeys.mockResolvedValue([
      'workspace-reference-doc-content-v2:doc-current:0',
      'workspace-reference-doc-content-v2:doc-current:1',
      'workspace-reference-doc-content-v1:doc-other'
    ]);
    persistence.kvGet.mockResolvedValue(null);

    await writeWorkspaceReferenceDocContentForDocs([
      makeDoc({ id: 'doc-current', content: '', contentLoaded: false }),
      makeDoc({ id: 'doc-other', content: '', contentLoaded: false })
    ]);

    expect(persistence.kvApplyMutations).toHaveBeenCalledWith([
      {
        type: 'set',
        key: 'workspace-reference-doc-content-v1:doc-current',
        value: 'shorter body'
      },
      { type: 'delete', key: 'workspace-reference-doc-content-v2:doc-current:0' },
      { type: 'delete', key: 'workspace-reference-doc-content-v2:doc-current:1' }
    ]);
  });
});
