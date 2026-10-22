import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PERSONAS,
  KNOWN_BUNDLED_PERSONA_IDS,
  RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
  RETIRED_POLARIS_ASSISTANT_PROVIDER_ID,
  createPersonaTemplate
} from '../config/persona/personaBuilder';
import { normalizePersona, migratePersistedPersonaPayload, migratePersistedPersonas, usePersonaStore } from './personaStore';
import * as personaMemoryDocPersistence from './personaMemoryReferenceDocPersistence';

describe('migratePersistedPersonas', () => {
  it('preserves user-edited Pharos fields and prompt during hydration', () => {
    const defaultPharos = DEFAULT_PERSONAS.find((persona) => persona.id === 'pharos');
    expect(defaultPharos).toBeDefined();

    const editedPharos = createPersonaTemplate({
      ...defaultPharos!,
      id: 'pharos',
      name: '砚',
      description: '用户改过的描述',
      purpose: '用户改过的方向',
      compiledPrompt: '用户改过的 Pharos 提示词'
    });

    const personas = migratePersistedPersonas([editedPharos]);
    const pharos = personas.find((persona) => persona.id === 'pharos');

    expect(pharos?.systemRole).toBe('default');
    expect(pharos?.name).toBe('砚');
    expect(pharos?.description).toBe('用户改过的描述');
    expect(pharos?.purpose).toBe('用户改过的方向');
    expect(pharos?.compiledPrompt).toBe('用户改过的 Pharos 提示词');
  });

  it('does not seed retired bundled collaborators into persisted data', () => {
    const customPersona = createPersonaTemplate({
      id: 'persona-custom',
      name: '自定义',
      description: '用户创建的角色'
    });

    const personas = migratePersistedPersonas([customPersona]);

    expect(personas.map((persona) => persona.id)).toEqual(['persona-custom']);
    expect(personas.some((persona) => persona.id === 'pharos')).toBe(false);
  });

  it('preserves valid avatar logo choices and drops unknown persisted values', () => {
    const customPersona = createPersonaTemplate({
      id: 'persona-custom',
      name: '自定义',
      description: '用户创建的角色',
      assistantAvatarIconId: 'claude',
      userAvatarIconId: 'gemini'
    });
    const invalidPersona = {
      ...customPersona,
      id: 'persona-invalid',
      assistantAvatarIconId: 'not-a-logo',
      userAvatarIconId: 'not-a-logo'
    } as unknown as typeof customPersona;

    const personas = migratePersistedPersonas([customPersona, invalidPersona]);

    expect(personas.find((persona) => persona.id === 'persona-custom')).toMatchObject({
      assistantAvatarIconId: 'claude',
      userAvatarIconId: 'gemini'
    });
    expect(personas.find((persona) => persona.id === 'persona-invalid')).toMatchObject({
      assistantAvatarIconId: null,
      userAvatarIconId: null
    });
  });

  it('keeps an existing Xiao Assistant as ordinary user data and retires its fixed product route', () => {
    const staleAssistant = createPersonaTemplate({
      id: RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
      name: '旧小助手',
      description: '旧描述',
      compiledPrompt: '旧提示',
      advanced: {
        providerId: RETIRED_POLARIS_ASSISTANT_PROVIDER_ID,
        modelOverride: 'Polaris',
        showThinking: false
      }
    });

    const personas = migratePersistedPersonas([staleAssistant]);
    const assistant = personas.find((persona) => persona.id === RETIRED_POLARIS_ASSISTANT_PERSONA_ID);

    expect(assistant).toMatchObject({
      name: '旧小助手',
      description: '旧描述',
      compiledPrompt: '旧提示',
      advanced: {
        providerId: '',
        modelOverride: '',
        showThinking: false
      }
    });
  });

  it('preserves a user-selected provider on an existing Xiao Assistant', () => {
    const assistant = createPersonaTemplate({
      id: RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
      name: '小助手',
      description: '用户留下的角色',
      advanced: { providerId: 'provider-custom', modelOverride: 'custom-model' }
    });

    const personas = migratePersistedPersonas([assistant]);

    expect(personas[0].advanced).toMatchObject({
      providerId: 'provider-custom',
      modelOverride: 'custom-model'
    });
  });

  it('removes bundled defaults from native app persona hydration', () => {
    const assistant = createPersonaTemplate({
      id: RETIRED_POLARIS_ASSISTANT_PERSONA_ID,
      name: '小助手',
      description: '旧内置角色'
    });
    const pharos = DEFAULT_PERSONAS.find((persona) => persona.id === 'pharos');
    const customPersona = createPersonaTemplate({
      id: 'persona-custom',
      name: '自定义',
      description: '用户创建的角色'
    });
    expect(pharos).toBeDefined();

    const migrated = migratePersistedPersonaPayload({
      personas: [assistant, pharos!, customPersona],
      seededDefaultPersonaIds: []
    }, {
      includeBundledDefaultPersonas: false
    });

    expect(migrated.personas.map((persona) => persona.id)).toEqual(['persona-custom']);
    expect(migrated.seededDefaultPersonaIds).toEqual([...KNOWN_BUNDLED_PERSONA_IDS]);
  });

  it('starts fresh installs with Pharos only', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);

    const state = usePersonaStore.getState();

    expect(state.activeCollaboratorId).toBe('pharos');
    expect(state.seededDefaultPersonaIds).toEqual([]);
    expect(state.personas.map((persona) => persona.id)).toEqual(['pharos']);
    expect(state.personas[0]).toMatchObject({
      id: 'pharos',
      systemRole: 'default'
    });
  });

  it('allows deleting the built-in Pharos persona', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);

    const deleted = usePersonaStore.getState().deleteCollaborator('pharos');

    expect(deleted).toBe(true);
    expect(usePersonaStore.getState().personas.some((persona) => persona.id === 'pharos')).toBe(false);
    expect(usePersonaStore.getState().activeCollaboratorId).toBe(usePersonaStore.getState().personas[0]?.id ?? null);
  });

  it('stages an explicit memory-doc body deletion when a collaborator is deleted', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);
    const stageDeletion = vi.spyOn(personaMemoryDocPersistence, 'stagePersonaMemoryDocDeletionForPersona');

    try {
      usePersonaStore.getState().deleteCollaborator('pharos');
      // The body deletion goes through the explicit channel, not through the persona being
      // absent from the next persist's list.
      expect(stageDeletion).toHaveBeenCalledWith('pharos');
    } finally {
      stageDeletion.mockRestore();
    }
  });

  it('allows editing the built-in Pharos prompt', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);

    usePersonaStore.getState().updateCollaborator('pharos', {
      compiledPrompt: '用户改过的 Pharos 提示词'
    });

    const pharos = usePersonaStore.getState().personas.find((persona) => persona.id === 'pharos');
    expect(pharos?.compiledPrompt).toBe('用户改过的 Pharos 提示词');
  });

  it('preserves explicit generated prompt opt-out when a collaborator prompt is cleared', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);
    const customId = usePersonaStore.getState().createPersona({ activate: true, template: 'custom' });

    usePersonaStore.getState().updateCollaborator(customId, {
      compiledPrompt: '',
      generatedPromptMode: 'off',
      builderManaged: false
    });

    const persona = usePersonaStore.getState().personas.find((item) => item.id === customId);
    expect(persona?.compiledPrompt).toBe('');
    expect(persona?.generatedPromptMode).toBe('off');
    expect(persona?.builderManaged).toBe(false);
  });

  it('pins collaborators above the normal list', () => {
    usePersonaStore.setState(usePersonaStore.getInitialState(), true);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);

    try {
      usePersonaStore.getState().toggleCollaboratorPinned('pharos');

      const state = usePersonaStore.getState();
      expect(state.personas[0]?.id).toBe('pharos');
      expect(state.personas[0]?.pinnedAt).toBe(12345);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps pinned collaborators first after hydration migration', () => {
    const pinned = createPersonaTemplate({
      id: 'persona-pinned',
      name: '置顶',
      description: '排在前面',
      pinnedAt: 20
    });
    const regular = createPersonaTemplate({
      id: 'persona-regular',
      name: '普通',
      description: '留在后面'
    });

    const personas = migratePersistedPersonas([regular, pinned]);

    expect(personas.map((persona) => persona.id)).toEqual(['persona-pinned', 'persona-regular']);
  });
});

it('normalizes incomplete imported window defaults at the persona boundary', () => {
  const imported = { ...createPersonaTemplate({id: 'p', name: 'P', description: ''}),
    conversationDefaults: {reasoningStrength: 'invalid'} };
  const normalized = normalizePersona(imported as unknown as Parameters<typeof normalizePersona>[0]);
  expect(normalized.conversationDefaults).toMatchObject({
    requestContext: {mode: 'inherit'}, reasoningStrength: 'automatic'
  });
});
