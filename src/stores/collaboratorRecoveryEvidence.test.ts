import { describe, expect, it } from 'vitest';
import {
  classifyCollaboratorRecoveryEvidence
} from './collaboratorRecoveryEvidence';

describe('classifyCollaboratorRecoveryEvidence', () => {
  it('reloads a complete row without rebuilding identity', () => {
    expect(classifyCollaboratorRecoveryEvidence({
      repositoryActive: true,
      repositoryStatus: 'complete',
      repositoryName: '仍在仓库里的协作者'
    })).toEqual({ mode: 'reload', name: '仍在仓库里的协作者' });
  });

  it('allows rebuild only when no collaborator row exists', () => {
    expect(classifyCollaboratorRecoveryEvidence({
      repositoryActive: true,
      repositoryStatus: 'incomplete',
      rawRowPresent: false
    })).toEqual({ mode: 'rebuild' });
    expect(classifyCollaboratorRecoveryEvidence({
      repositoryActive: true,
      repositoryStatus: 'incomplete',
      rawRowPresent: true
    })).toEqual({ mode: 'blocked', reason: 'damaged' });
  });

  it('does not revive an explicit deletion without its verified snapshot', () => {
    expect(classifyCollaboratorRecoveryEvidence({
      repositoryActive: true,
      repositoryStatus: 'deleted',
      rawRowPresent: true
    })).toEqual({ mode: 'blocked', reason: 'deleted-without-snapshot' });
  });

});
