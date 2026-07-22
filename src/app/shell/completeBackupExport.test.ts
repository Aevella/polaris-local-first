import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceReferenceDoc } from '../../types/domain';
import { useChatStore } from '../../stores/chatStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { loadWorkspaceReferenceDocsContent } from '../../stores/workspaceReferenceDocContentPersistence';
import { prepareCompleteExportSnapshot } from './completeBackupExport';

vi.mock('../../stores/workspaceReferenceDocContentPersistence', () => ({
  loadWorkspaceReferenceDocsContent: vi.fn()
}));

function referenceDoc(patch: Partial<WorkspaceReferenceDoc> = {}): WorkspaceReferenceDoc {
  return {
    id: 'workspace-doc-1',
    projectId: 'workspace-1',
    title: 'Reference',
    summary: '',
    content: '',
    charCount: 12,
    contentLoaded: false,
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

describe('prepareCompleteExportSnapshot', () => {
  const originalCollectionState = useCollectionStore.getState();

  afterEach(() => {
    vi.restoreAllMocks();
    useCollectionStore.setState(originalCollectionState, true);
  });

  it('loads workspace reference document bodies before building a complete backup', async () => {
    const shell = referenceDoc();
    const loaded = {
      ...referenceDoc(),
      content: 'full content',
      charCount: 12,
      contentLoaded: true as const
    } satisfies WorkspaceReferenceDoc;
    vi.spyOn(useChatStore.getState(), 'persistToDb').mockResolvedValue();
    vi.mocked(loadWorkspaceReferenceDocsContent).mockResolvedValue([loaded]);
    useCollectionStore.setState({ workspaceReferenceDocs: [shell] });

    const snapshot = await prepareCompleteExportSnapshot();

    expect(loadWorkspaceReferenceDocsContent).toHaveBeenCalledWith([shell]);
    expect(snapshot.collectionState?.workspaceReferenceDocs).toEqual([loaded]);
  });

  it('fails the backup when a declared workspace document body cannot be loaded', async () => {
    vi.spyOn(useChatStore.getState(), 'persistToDb').mockResolvedValue();
    vi.mocked(loadWorkspaceReferenceDocsContent).mockRejectedValue(
      new Error('Workspace reference document content is missing')
    );
    useCollectionStore.setState({ workspaceReferenceDocs: [referenceDoc()] });

    await expect(prepareCompleteExportSnapshot()).rejects.toThrow(
      'Workspace reference document content is missing'
    );
  });
});
