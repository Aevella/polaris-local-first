import { describe, it, expect } from 'vitest';
import { describeToolArguments, normalizeToolPreparationDiagnostic } from './toolPreparationDiagnostics';

describe('describeToolArguments', () => {
  it('distinguishes missing, empty, nested and wrong-type code without retaining values or unknown keys', () => {
    expect(describeToolArguments({})).toEqual({ fields: [], unknownFieldCount: 0 });
    const result = describeToolArguments({ card: { code: '', html: 'SECRET', secretTitle: 'SECRET' }, code: 12 });
    expect(result).toMatchObject({ unknownFieldCount: 1, fields: [
      { field: 'code', type: 'number' },
      { field: 'card', type: 'object', children: [{ field: 'code', type: 'string', length: 0 }, { field: 'html', type: 'string', length: 6 }] }
    ] });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('secretTitle');
  });
});
describe('normalizeToolPreparationDiagnostic', () => {
  it('rejects arbitrary correlation text and unknown status', () => {
    expect(normalizeToolPreparationDiagnostic({ attemptId: 'private text', status: 'ready' })).toBeUndefined();
    expect(normalizeToolPreparationDiagnostic(null)).toBeUndefined();
  });
});
