import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import { preparePersonaBackupDocuments, preserveExistingBodiesForMissingImports } from './personaBackupDocuments';
import { readPersonaMemoryDocContent } from './personaMemoryReferenceDocPersistence';

const mocks = vi.hoisted(() => ({ read: vi.fn(), active: vi.fn() }));
vi.mock('./personaMemoryReferenceDocPersistence', async importOriginal => ({
  ...await importOriginal<typeof import('./personaMemoryReferenceDocPersistence')>(),
  readPersonaMemoryDocContent: vi.fn()
}));
vi.mock('./localDataStorePersistence', () => ({
  createStoreLocalDataRepository: () => ({ read: mocks.read }),
  isLocalDataRepositoryDomainActive: mocks.active
}));

function persona() {
  return createPersonaTemplate({ id: 'p', name: 'P', description: '', memory: {
    referenceDocs: [{ id: 'd', title: 'Material', summary: 'Summary survives', source: 'upload', content: '', contentLoaded: false, charCount: 4, updatedAt: 1 }]
  } });
}

beforeEach(() => { vi.resetAllMocks(); mocks.active.mockResolvedValue(true); });

describe('preparePersonaBackupDocuments', () => {
  it('keeps the directory and an explicit missing marker for confirmed missing bodies', async () => {
    vi.mocked(readPersonaMemoryDocContent).mockRejectedValue(new Error('Persona memory document content is missing: p:d'));
    const result = await preparePersonaBackupDocuments([persona()]);
    expect(result.payload.docs).toEqual({});
    expect(result.missing).toEqual([{ personaId: 'p', docId: 'd', title: 'Material' }]);
    expect(result.personas[0].memory.referenceDocs[0]).toMatchObject({ bodyStatus: 'missing', summary: 'Summary survives', charCount: 4 });
  });

  it('does not disguise an unavailable storage backend as a missing document', async () => {
    vi.mocked(readPersonaMemoryDocContent).mockRejectedValue(new Error('disk unavailable'));
    await expect(preparePersonaBackupDocuments([persona()])).rejects.toThrow('disk unavailable');
  });

  it('exports supplied selected bodies without reading historical fragments', async () => {
    const result = await preparePersonaBackupDocuments([persona()], { version: 1, docs: { 'p:d': 'body' } });
    expect(result.payload.docs).toEqual({ 'p:d': 'body' });
    expect(readPersonaMemoryDocContent).not.toHaveBeenCalled();
  });
});

describe('preserveExistingBodiesForMissingImports', () => {
  it('keeps the destination body when the imported package explicitly lacks it', async () => {
    const previous = persona();
    mocks.read.mockResolvedValue({ status: 'complete', row: { value: { value: previous } } });
    vi.mocked(readPersonaMemoryDocContent).mockResolvedValue('body');
    const incoming = persona();
    incoming.memory.referenceDocs[0].bodyStatus = 'missing';
    const result = await preserveExistingBodiesForMissingImports([incoming]);
    expect(result[0].memory.referenceDocs[0]).toMatchObject({ content: 'body', contentLoaded: true, charCount: 4 });
    expect(result[0].memory.referenceDocs[0].bodyStatus).toBeUndefined();
  });

  it('does not resurrect a deleted destination collaborator', async () => {
    mocks.read.mockResolvedValue({ status: 'deleted' });
    const incoming = persona();
    incoming.memory.referenceDocs[0].bodyStatus = 'missing';
    const result = await preserveExistingBodiesForMissingImports([incoming]);
    expect(result[0].memory.referenceDocs[0].bodyStatus).toBe('missing');
    expect(readPersonaMemoryDocContent).not.toHaveBeenCalled();
  });
});
