import type { Persona } from '../types/domain';
import { RETIRED_POLARIS_ASSISTANT_PERSONA_ID } from '../config/persona/personaBuilder';

export function isCorePersona(persona: Persona | null | undefined): boolean {
  return persona?.systemRole === 'default';
}

export function isPharosPersona(persona: Persona | null | undefined): boolean {
  return persona?.id === 'pharos';
}

export function canEditPersonaPrompt(persona: Persona | null | undefined): boolean {
  return !isCorePersona(persona) || isPharosPersona(persona);
}
