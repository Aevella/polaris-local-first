import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONAS,
  POLARIS_ASSISTANT_DEFAULT_MODEL,
  POLARIS_ASSISTANT_DEFAULT_PROVIDER_ID,
  POLARIS_ASSISTANT_PERSONA_ID
} from '../config/persona/personaBuilder';
import { POLARIS_PUBLIC_PROVIDER } from './freeProvider';
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

  it('pins Xiao Assistant to the built-in Polaris product guide model', () => {
    const assistant = DEFAULT_PERSONAS.find((persona) => persona.id === POLARIS_ASSISTANT_PERSONA_ID);
    expect(assistant).toBeDefined();

    const result = resolvePersonaProviderBinding({
      globalApi,
      providers: [POLARIS_PUBLIC_PROVIDER, globalApi],
      persona: assistant
    });

    expect(result.fixedProviderId).toBe(POLARIS_ASSISTANT_DEFAULT_PROVIDER_ID);
    expect(result.api.id).toBe(POLARIS_ASSISTANT_DEFAULT_PROVIDER_ID);
    expect(result.api.model).toBe(POLARIS_ASSISTANT_DEFAULT_MODEL);
  });
});
