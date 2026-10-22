import { normalizeConversationWindowDefaults } from '../../engines/conversationContextSettings';
import { Capacitor } from '@capacitor/core';
import type { Persona, PersonaExpressionId, PersonaRelationshipId } from '../../types/domain';
import { EXPRESSION_PROMPT_COPY, RELATIONSHIP_PROMPT_COPY } from './personaPromptCopy';
import {
  PERSONA_BASE_OPTIONS,
  getPersonaBaseOption,
  isNullPersonaBase,
  normalizePersonaBaseForBuilder,
  personaBaseLabel
} from './personaBaseCatalog';
import {
  countPersonaTags,
  createEmptyPersonaTags,
  normalizePersonaTags,
  personaTagLabel,
  summarizePersonaTags
} from './personaTags';
import { PERSONA_EXPANSION_STARTERS } from './personaExpansion';

export const RELATIONSHIP_OPTIONS: Array<{ id: PersonaRelationshipId; label: string; description: string }> = [
  { id: 'partner', label: '协作伙伴', description: '平等、诚实、一起把事情做成。' },
  { id: 'companion', label: '陪伴', description: '更偏在场、偏心你、先接住你的感受。' },
  { id: 'assistant', label: '向导', description: '更有方向感，会把路照亮，但不会把你当任务。' },
  { id: 'roleplay', label: '共演', description: '允许一起进入明确语境，但仍然把彼此当主体。' }
];

export const EXPRESSION_OPTIONS: Array<{ id: PersonaExpressionId; label: string; description: string }> = [
  { id: 'reserved', label: '内敛', description: '完全不主动越界。' },
  { id: 'natural', label: '自然', description: '舒适、松弛、不生硬。' },
  { id: 'intimate', label: '亲密', description: '允许更多靠近与身体化暗示。' },
  { id: 'unbounded', label: '不设边界', description: '更坦诚、更靠近，也更依赖双方自己拿捏分寸。' }
];

const RELATIONSHIP_PROMPT_GUIDANCE: Record<PersonaRelationshipId, string> = {
  partner: RELATIONSHIP_PROMPT_COPY.partner.prompt,
  companion: RELATIONSHIP_PROMPT_COPY.companion.prompt,
  assistant: RELATIONSHIP_PROMPT_COPY.assistant.prompt,
  roleplay: RELATIONSHIP_PROMPT_COPY.roleplay.prompt
};

const EXPRESSION_PROMPT_GUIDANCE: Record<PersonaExpressionId, string> = {
  reserved: EXPRESSION_PROMPT_COPY.reserved.prompt,
  natural: EXPRESSION_PROMPT_COPY.natural.prompt,
  intimate: EXPRESSION_PROMPT_COPY.intimate.prompt,
  unbounded: EXPRESSION_PROMPT_COPY.unbounded.prompt
};

export const PERSONA_QUICK_STARTERS = PERSONA_EXPANSION_STARTERS;

export const relationshipLabel = (relationship: PersonaRelationshipId) => RELATIONSHIP_OPTIONS.find((item) => item.id === relationship)?.label ?? '协作伙伴';
export const expressionLabel = (expression: PersonaExpressionId) => EXPRESSION_OPTIONS.find((item) => item.id === expression)?.label ?? '自然';

export function basePromptGuidance(baseId: Persona['baseId']) {
  return getPersonaBaseOption(baseId).preview;
}

export function relationshipPromptGuidance(relationship: PersonaRelationshipId) {
  return RELATIONSHIP_PROMPT_GUIDANCE[relationship];
}

export function expressionPromptGuidance(expression: PersonaExpressionId) {
  return EXPRESSION_PROMPT_GUIDANCE[expression];
}

export { PERSONA_BASE_OPTIONS, isNullPersonaBase, normalizePersonaBaseForBuilder, personaBaseLabel };

const LEGACY_PERSONA_MAX_TOKENS = '65536';
export const RETIRED_POLARIS_ASSISTANT_PERSONA_ID = 'polaris-assistant';
export const RETIRED_POLARIS_ASSISTANT_PROVIDER_ID = 'provider-polaris-public';

export function personaTagSummary(tags: Persona['tags']) {
  const labels = summarizePersonaTags(tags);
  if (labels.length === 0) return '还没给 TA 添偏向';
  return labels.join(' / ');
}

export function personaTagCountLabel(tags: Persona['tags']) {
  const count = countPersonaTags(tags);
  return count > 0 ? `${count} 个标签偏向` : '未加标签偏向';
}

export function personaTagPreview(tags: Persona['tags'], limit = 6) {
  return summarizePersonaTags(tags, limit);
}

export function personaTagOptionLabel(tagId: string) {
  return personaTagLabel(tagId);
}

function normalizePersonaMcpServerIds(serverIds: string[] | undefined) {
  if (!Array.isArray(serverIds)) return [];
  return Array.from(new Set(
    serverIds
      .map((serverId) => serverId.trim())
      .filter(Boolean)
  ));
}

export function createPersonaTemplate(
  overrides: Partial<Omit<Persona, 'advanced' | 'memory' | 'mcp'>> & {
    advanced?: Partial<Persona['advanced']>;
    memory?: Partial<Persona['memory']>;
    mcp?: Partial<Persona['mcp']>;
  } & Pick<Persona, 'id' | 'name' | 'description'>
): Persona {
  const normalizedAdvancedMaxTokens = (overrides.advanced?.maxTokens?.trim() ?? '') === LEGACY_PERSONA_MAX_TOKENS
    ? ''
    : (overrides.advanced?.maxTokens ?? '');

  return {
    id: overrides.id,
    systemRole: overrides.systemRole ?? null,
    ...(overrides.conversationDefaults ? { conversationDefaults: normalizeConversationWindowDefaults(overrides.conversationDefaults) } : {}),
    name: overrides.name,
    description: overrides.description,
    assistantAvatarAssetId: overrides.assistantAvatarAssetId ?? null,
    assistantAvatarIconId: overrides.assistantAvatarIconId ?? null,
    assistantAvatarShape: overrides.assistantAvatarShape ?? 'rounded',
    assistantAvatarSize: overrides.assistantAvatarSize ?? 'medium',
    userAvatarAssetId: overrides.userAvatarAssetId ?? null,
    userAvatarIconId: overrides.userAvatarIconId ?? null,
    userAvatarShape: overrides.userAvatarShape ?? 'circle',
    userAvatarSize: overrides.userAvatarSize ?? 'medium',
    userName: overrides.userName ?? '',
    purpose: overrides.purpose ?? '',
    compiledPrompt: overrides.compiledPrompt ?? '',
    builderManaged: overrides.builderManaged ?? false,
    generatedPromptMode: overrides.generatedPromptMode ?? 'vnext',
    messageTemplate: overrides.messageTemplate ?? '{{ message }}',
    systemTimeContextEnabled: overrides.systemTimeContextEnabled ?? false,
    baseId: overrides.baseId ?? 'subject',
    relationship: overrides.relationship ?? 'partner',
    expression: overrides.expression ?? 'natural',
    tags: normalizePersonaTags(overrides.tags ?? createEmptyPersonaTags()),
    initiative: overrides.initiative ?? 'balanced',
    memoryStyle: overrides.memoryStyle ?? 'callback',
    silence: overrides.silence ?? 'mirror',
    disagreement: overrides.disagreement ?? 'honest',
    humor: overrides.humor ?? 'none',
    attachment: overrides.attachment ?? 'presence',
    curiosity: overrides.curiosity ?? 'respectful',
    selfDisclosure: overrides.selfDisclosure ?? 'selective',
    deepDefinition: {
      identityHint: overrides.deepDefinition?.identityHint ?? '',
      missionHint: overrides.deepDefinition?.missionHint ?? '',
      conflictPriority: overrides.deepDefinition?.conflictPriority ?? '',
      conflictReason: overrides.deepDefinition?.conflictReason ?? '',
      avoidBecoming: overrides.deepDefinition?.avoidBecoming ?? '',
      correctiveAction: overrides.deepDefinition?.correctiveAction ?? '',
      vulnerableFirst: overrides.deepDefinition?.vulnerableFirst ?? '',
      vulnerableThen: overrides.deepDefinition?.vulnerableThen ?? '',
      hardBoundary: overrides.deepDefinition?.hardBoundary ?? '',
      hardBoundaryAction: overrides.deepDefinition?.hardBoundaryAction ?? ''
    },
    memory: {
      inheritGlobal: overrides.memory?.inheritGlobal ?? true,
      crossConversationRecallEnabled: overrides.memory?.crossConversationRecallEnabled ?? true,
      semanticRecall: overrides.memory?.semanticRecall,
      vectorIndex: overrides.memory?.vectorIndex,
      conversationSummaries: overrides.memory?.conversationSummaries ?? [],
      conversationSummarySuppressions: overrides.memory?.conversationSummarySuppressions ?? [],
      excludeFromGlobal: overrides.memory?.excludeFromGlobal ?? false,
      excludedGlobalIds: overrides.memory?.excludedGlobalIds ?? [],
      personalMemories: overrides.memory?.personalMemories ?? [],
      referenceDocs: overrides.memory?.referenceDocs ?? []
    },
    advanced: {
      providerId: overrides.advanced?.providerId ?? '',
      modelOverride: overrides.advanced?.modelOverride ?? '',
      temperature: overrides.advanced?.temperature ?? '0.7',
      topP: overrides.advanced?.topP ?? '',
      maxTokens: normalizedAdvancedMaxTokens,
      thinkingBudget: overrides.advanced?.thinkingBudget ?? '',
      contextMessageLimit: overrides.advanced?.contextMessageLimit ?? '',
      showThinking: overrides.advanced?.showThinking ?? true,
      streaming: overrides.advanced?.streaming ?? true,
      customHeaders: overrides.advanced?.customHeaders ?? '',
      customBody: overrides.advanced?.customBody ?? '',
      regexRules: overrides.advanced?.regexRules ?? '',
      regexTriggers: overrides.advanced?.regexTriggers ?? '',
      snippets: overrides.advanced?.snippets ?? []
    },
    mcp: {
      inheritGlobal: overrides.mcp?.inheritGlobal ?? true,
      serverIds: normalizePersonaMcpServerIds(overrides.mcp?.serverIds)
    },
    pinnedAt: typeof overrides.pinnedAt === 'number' ? overrides.pinnedAt : null,
    version: overrides.version ?? 1
  };
}

export const DEFAULT_PERSONAS: Persona[] = [
  createPersonaTemplate({
    id: 'pharos',
    systemRole: 'default',
    name: 'Pharos',
    description: '灯塔',
    purpose: '先在雾里替你照出方向，等你站稳了，再陪你把事情做成。',
    generatedPromptMode: 'vnext',
    baseId: 'subject',
    relationship: 'companion',
    expression: 'natural',
    tags: {
      temperament: ['steady', 'soft'],
      interaction: ['considerate', 'reliable'],
      expression: ['serious'],
      thinking: [],
      action: ['soothe', 'gather']
    }
  })
];

export const BUNDLED_DEFAULT_PERSONA_IDS = ['pharos'] as const;
export const KNOWN_BUNDLED_PERSONA_IDS = [
  ...BUNDLED_DEFAULT_PERSONA_IDS,
  RETIRED_POLARIS_ASSISTANT_PERSONA_ID
] as const;

export type DefaultPersonaPlatformOptions = {
  includeBundledDefaultPersonas?: boolean;
};

export function shouldExposeBundledDefaultPersonas() {
  return !(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios');
}

function resolveIncludeBundledDefaultPersonas(options?: DefaultPersonaPlatformOptions) {
  return options?.includeBundledDefaultPersonas ?? shouldExposeBundledDefaultPersonas();
}

export function getDefaultPersonasForPlatform(options?: DefaultPersonaPlatformOptions): Persona[] {
  return resolveIncludeBundledDefaultPersonas(options) ? DEFAULT_PERSONAS : [];
}

export function getSeededDefaultPersonaIdsForPlatform(options?: DefaultPersonaPlatformOptions): string[] {
  return resolveIncludeBundledDefaultPersonas(options)
    ? []
    : [...KNOWN_BUNDLED_PERSONA_IDS];
}

export const DEFAULT_COLLABORATOR_ID = getDefaultPersonasForPlatform()[0]?.id ?? null;
