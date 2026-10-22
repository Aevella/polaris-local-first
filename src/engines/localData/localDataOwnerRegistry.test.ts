import { describe, it, expect } from 'vitest';
import { buildLocalDataOwnerRegistry } from './localDataOwnerRegistry';
import { RETIRED_POLARIS_ASSISTANT_PERSONA_ID } from '../../config/persona/personaBuilder';

describe('buildLocalDataOwnerRegistry', () => {
  it('recognizes retired bundled owners without making them live collaborators', () => {
    const registry = buildLocalDataOwnerRegistry(new Map());
    expect(registry.historicalOwnerIds).toContain(RETIRED_POLARIS_ASSISTANT_PERSONA_ID);
    expect(registry.collaboratorIds).not.toContain(RETIRED_POLARIS_ASSISTANT_PERSONA_ID);
  });
});
