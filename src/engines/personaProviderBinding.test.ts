import { POLARIS_PUBLIC_PROVIDER } from './freeProvider';
import { describe, expect, it } from 'vitest';
import { resolvePersonaProviderBinding } from './personaProviderBinding';
import type { Persona, ProviderProfile } from '../types/domain';

function createProvider(overrides: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name' | 'model'>): ProviderProfile {
  return {
    id: overrides.id,
    name: overrides.name,
    protocol: overrides.protocol ?? 'openai-completions',
    baseUrl: overrides.baseUrl ?? '/api',
    path: overrides.path ?? '/chat/completions',
    apiKey: overrides.apiKey ?? '',
    model: overrides.model,
    capabilities: overrides.capabilities ?? {
      streaming: true,
      images: false,
      thinking: false
    }
  };
}

function createPersona(advanced: Partial<Persona['advanced']>): Persona {
  return {
    id: 'persona-1',
    systemRole: null,
    name: 'Test',
    description: '',
    assistantAvatarAssetId: null,
    assistantAvatarIconId: null,
    assistantAvatarShape: 'rounded',
    assistantAvatarSize: 'medium',
    userAvatarAssetId: null,
    userAvatarIconId: null,
    userAvatarShape: 'circle',
    userAvatarSize: 'medium',
    userName: '',
    purpose: '',
    compiledPrompt: '',
    builderManaged: false,
    generatedPromptMode: 'vnext',
    messageTemplate: '{{ message }}',
    systemTimeContextEnabled: false,
    baseId: 'subject',
    relationship: 'partner',
    expression: 'natural',
    tags: {
      temperament: [],
      interaction: [],
      expression: [],
      thinking: [],
      action: []
    },
    initiative: 'balanced',
    memoryStyle: 'callback',
    silence: 'mirror',
    disagreement: 'honest',
    humor: 'none',
    attachment: 'presence',
    curiosity: 'respectful',
    selfDisclosure: 'selective',
    deepDefinition: {
      identityHint: '',
      missionHint: '',
      conflictPriority: '',
      conflictReason: '',
      avoidBecoming: '',
      correctiveAction: '',
      vulnerableFirst: '',
      vulnerableThen: '',
      hardBoundary: '',
      hardBoundaryAction: ''
    },
    memory: {
      inheritGlobal: true,
      crossConversationRecallEnabled: true,
      excludedGlobalIds: [],
      personalMemories: [],
      conversationSummaries: [],
      referenceDocs: []
    },
    mcp: {
      inheritGlobal: true,
      serverIds: []
    },
    advanced: {
      providerId: '',
      modelOverride: '',
      temperature: '',
      topP: '',
      maxTokens: '',
      thinkingBudget: '',
      contextMessageLimit: '',
      showThinking: true,
      streaming: true,
      customHeaders: '',
      customBody: '',
      regexRules: '',
      snippets: [],
      ...advanced
    },
    version: 1
  };
}

describe('resolvePersonaProviderBinding', () => {
  const globalApi = createProvider({ id: 'global', name: 'Global', model: 'global-model' });
  const kimiApi = createProvider({ id: 'kimi', name: 'Kimi', model: 'kimi-default' });

  it('uses the global provider when the collaborator does not pin a provider', () => {
    const result = resolvePersonaProviderBinding({
      globalApi,
      providers: [globalApi, kimiApi],
      persona: createPersona({ modelOverride: 'global-override' })
    });

    expect(result.fixedProvider).toBeNull();
    expect(result.api.id).toBe('global');
    expect(result.api.model).toBe('global-override');
  });

  it('uses the collaborator provider and model together when both are pinned', () => {
    const result = resolvePersonaProviderBinding({
      globalApi,
      providers: [globalApi, kimiApi],
      persona: createPersona({ providerId: 'kimi', modelOverride: 'kimi-thinking' })
    });

    expect(result.fixedProvider?.id).toBe('kimi');
    expect(result.api.id).toBe('kimi');
    expect(result.api.model).toBe('kimi-thinking');
  });

  it('does not apply a dangling pinned model to the global provider', () => {
    const result = resolvePersonaProviderBinding({
      globalApi,
      providers: [globalApi],
      persona: createPersona({ providerId: 'missing', modelOverride: 'missing-model' })
    });

    expect(result.fixedProvider).toBeNull();
    expect(result.api.id).toBe('global');
    expect(result.api.model).toBe('global-model');
  });

  it('uses a window route and model without changing the collaborator or global provider', () => {
    const persona = createPersona({ providerId: 'global', modelOverride: 'role-model' });
    const args = { globalApi, providers: [globalApi, kimiApi], persona };
    expect(resolvePersonaProviderBinding({ ...args, windowBinding: { providerId: 'kimi', model: 'window-model' } }).api).toMatchObject({ id: 'kimi', model: 'window-model' });
    expect(resolvePersonaProviderBinding({ ...args, windowBinding: { providerId: 'global', model: '' } }).api.model).toBe('global-model');
    expect(resolvePersonaProviderBinding({ ...args, windowBinding: { providerId: 'missing', model: 'bad' } }).api.model).toBe('role-model');
    expect(resolvePersonaProviderBinding(args).api.model).toBe('role-model');
    expect(persona.advanced.modelOverride).toBe('role-model');
    expect(globalApi.model).toBe('global-model');
  });
  it('keeps the built-in route model authoritative', () => {
    const result = resolvePersonaProviderBinding({ globalApi, providers: [POLARIS_PUBLIC_PROVIDER], windowBinding: { providerId: POLARIS_PUBLIC_PROVIDER.id, model: 'unsupported' } });
    expect(result.api.model).toBe(POLARIS_PUBLIC_PROVIDER.model);
  });

});
