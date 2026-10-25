import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONAS, RETIRED_POLARIS_ASSISTANT_PERSONA_ID, createPersonaTemplate } from '../config/persona/personaBuilder';
import { canEditPersonaPrompt } from './personaBuiltin';

describe('personaBuiltin', () => {
  it('treats the retired Xiao Assistant id as an ordinary editable collaborator', () => {
    const assistant = createPersonaTemplate({
      id: RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
      name: '小助手',
      description: '旧角色'
    });

    expect(canEditPersonaPrompt(assistant)).toBe(true);
  });

  it('keeps Pharos editable even though it is built in', () => {
    const pharos = DEFAULT_PERSONAS.find((persona) => persona.id === 'pharos');

    expect(canEditPersonaPrompt(pharos)).toBe(true);
  });
});
