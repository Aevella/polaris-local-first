import { describe, it, expect } from 'vitest';
import { normalizeMemoryReferenceDocs } from './requestContextContent';

describe('normalizeMemoryReferenceDocs', () => {
  it('does not advertise missing backup bodies as readable model context', () => {
    const doc = { id: 'doc', title: 'Title', summary: 'summary', content: '', charCount: 42, contentLoaded: false, source: 'upload' as const, updatedAt: 1 };
    expect(normalizeMemoryReferenceDocs([{ ...doc, bodyStatus: 'missing' }])).toEqual([]);
    expect(normalizeMemoryReferenceDocs([doc])).toEqual([{ id: 'doc', title: 'Title', summary: 'summary', charCount: 42, updatedAt: 1 }]);
  });
});
