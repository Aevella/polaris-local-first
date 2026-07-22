import { create } from 'zustand';
import {
  BUNDLED_DEFAULT_PERSONA_IDS,
  DEFAULT_PERSONAS,
  POLARIS_ASSISTANT_PERSONA_ID,
  type DefaultPersonaPlatformOptions,
  createPersonaTemplate,
  getDefaultPersonasForPlatform,
  getSeededDefaultPersonaIdsForPlatform
} from '../config/persona/personaBuilder';
import { normalizeAvatarIconId } from '../config/catalog/avatarIconCatalog';
import { resolvePersonaTags } from '../engines/personaTagResolver';
import { isCorePersona, isPharosPersona } from '../engines/personaBuiltin';
import { createUid } from '../engines/id';
import { clearMemoryVectorIndexForCollaborator } from '../engines/memoryVectorIndexStorage';
import { kvGet } from '../infrastructure/persistence';
import { reportPersistenceError } from '../infrastructure/persistenceDiagnostics';
import type { Persona } from '../types/domain';
import {
  readPersonaStateFromLocalDataRepositoryIfActive,
  writePersonaState
} from './personaLocalDataPersistence';
import {
  stagePersonaMemoryDocContentFromPersonas,
  stagePersonaMemoryDocDeletionForPersona,
  stripPersonaMemoryDocContent,
} from './personaMemoryReferenceDocPersistence';

type PersonaPatch = Partial<Omit<Persona, 'id' | 'version' | 'deepDefinition' | 'memory' | 'advanced' | 'mcp'>> & {
  deepDefinition?: Partial<Persona['deepDefinition']>;
  memory?: Partial<Persona['memory']>;
  advanced?: Partial<Persona['advanced']>;
  mcp?: Partial<Persona['mcp']>;
};

type CreatePersonaOptions = {
  activate?: boolean;
  template?: 'builder' | 'custom';
};

type PersonaState = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  seededDefaultPersonaIds: string[];
  hydrated: boolean;
  setActiveCollaborator: (id: string) => void;
  createPersona: (options?: CreatePersonaOptions) => string;
  duplicatePersona: (id: string) => string | null;
  deleteCollaborator: (id: string) => boolean;
  toggleCollaboratorPinned: (id: string) => void;
  updateCollaborator: (id: string, patch: PersonaPatch) => void;
  hydrateFromDb: () => Promise<boolean>;
  persistToDb: () => Promise<void>;
};

type PersistedPersonaPayload = {
  personas: Persona[];
  activeCollaboratorId: string | null;
  editingCollaboratorId?: string | null;
  seededDefaultPersonaIds?: string[];
};

function createSeedPersona(id: string, template: CreatePersonaOptions['template'] = 'builder') {
  if (template === 'custom') {
    return createPersonaTemplate({
      id,
      name: '未命名',
      description: '',
      purpose: '',
      baseId: 'custom',
      generatedPromptMode: 'vnext',
      builderManaged: false,
      compiledPrompt: ''
    });
  }

  return createPersonaTemplate({
    id,
    name: '新助手',
    description: '刚刚来到这里',
    purpose: '先陪你说话，再一起慢慢长出更清楚的形状。',
    generatedPromptMode: 'vnext'
  });
}

function normalizePersonaName(name: string) {
  const trimmed = name.trim();
  return trimmed === '未命名人格' ? '未命名' : trimmed;
}

function normalizeGeneratedPromptMode(value: Persona['generatedPromptMode'] | undefined) {
  return value === 'off' ? 'off' : 'vnext';
}

function normalizeSeededDefaultPersonaIds(value: string[] | undefined) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id) => typeof id === 'string' && id.trim().length > 0)));
}

function getDefaultPersona(id: string) {
  return DEFAULT_PERSONAS.find((persona) => persona.id === id) ?? null;
}

function normalizeProductGuidePersona(persona: Persona) {
  if (persona.id !== POLARIS_ASSISTANT_PERSONA_ID) return persona;
  const defaultProductGuide = getDefaultPersona(POLARIS_ASSISTANT_PERSONA_ID);
  if (!defaultProductGuide) return persona;

  return normalizePersona({
    ...persona,
    name: defaultProductGuide.name,
    description: defaultProductGuide.description,
    purpose: defaultProductGuide.purpose,
    compiledPrompt: defaultProductGuide.compiledPrompt,
    advanced: {
      ...persona.advanced,
      providerId: defaultProductGuide.advanced.providerId,
      modelOverride: defaultProductGuide.advanced.modelOverride,
      showThinking: defaultProductGuide.advanced.showThinking
    }
  });
}

export function migratePersistedPersonaPayload(
  payload: Pick<PersistedPersonaPayload, 'personas' | 'seededDefaultPersonaIds'>,
  options?: DefaultPersonaPlatformOptions
) {
  const seededDefaultPersonaIds = normalizeSeededDefaultPersonaIds(payload.seededDefaultPersonaIds);
  const includeBundledDefaultPersonas = options?.includeBundledDefaultPersonas ?? getDefaultPersonasForPlatform().length > 0;

  if (!includeBundledDefaultPersonas) {
    const removedBundledDefaultPersonaIds = new Set<string>(BUNDLED_DEFAULT_PERSONA_IDS);
    return {
      personas: sortPersonasByPinned(
        payload.personas
          .filter((persona) => persona.id !== 'coder' && !removedBundledDefaultPersonaIds.has(persona.id))
          .map((persona) => normalizePersona(persona))
      ),
      seededDefaultPersonaIds: normalizeSeededDefaultPersonaIds([
        ...seededDefaultPersonaIds,
        ...BUNDLED_DEFAULT_PERSONA_IDS
      ])
    };
  }

  const migratedPersonas = payload.personas
    .filter((persona) => persona.id !== 'coder')
    .map((persona) => normalizeProductGuidePersona(normalizePersona(
      persona.id === 'pharos'
        ? {
            ...persona,
            systemRole: 'default'
          }
        : persona
    )));

  const hasProductGuide = migratedPersonas.some((persona) => persona.id === POLARIS_ASSISTANT_PERSONA_ID);
  const productGuideSeeded = seededDefaultPersonaIds.includes(POLARIS_ASSISTANT_PERSONA_ID);
  const productGuide = getDefaultPersona(POLARIS_ASSISTANT_PERSONA_ID);
  if (hasProductGuide && !productGuideSeeded) {
    return {
      personas: sortPersonasByPinned(migratedPersonas),
      seededDefaultPersonaIds: [...seededDefaultPersonaIds, POLARIS_ASSISTANT_PERSONA_ID]
    };
  }

  if (!hasProductGuide && !productGuideSeeded && productGuide) {
    return {
      personas: sortPersonasByPinned([normalizePersona(productGuide), ...migratedPersonas]),
      seededDefaultPersonaIds: [...seededDefaultPersonaIds, POLARIS_ASSISTANT_PERSONA_ID]
    };
  }

  return {
    personas: sortPersonasByPinned(migratedPersonas),
    seededDefaultPersonaIds
  };
}

export function migratePersistedPersonas(
  personas: Persona[],
  seededDefaultPersonaIds?: string[],
  options?: DefaultPersonaPlatformOptions
) {
  return migratePersistedPersonaPayload({ personas, seededDefaultPersonaIds }, options).personas;
}

function resolveActiveCollaboratorId(activeCollaboratorId: string | null, personas: Persona[]) {
  if (activeCollaboratorId && personas.some((persona) => persona.id === activeCollaboratorId)) return activeCollaboratorId;
  return personas[0]?.id ?? null;
}

function sortPersonasByPinned(personas: Persona[]) {
  return [...personas].sort((left, right) => {
    const pinDelta = Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));
    if (pinDelta !== 0) return pinDelta;
    return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
  });
}

export function normalizePersona(persona: Partial<Persona> & Pick<Persona, 'id' | 'name' | 'description'>): Persona {
  return createPersonaTemplate({
    id: persona.id,
    name: normalizePersonaName(persona.name),
    systemRole: persona.systemRole,
    description: persona.description,
    assistantAvatarAssetId: persona.assistantAvatarAssetId,
    assistantAvatarIconId: normalizeAvatarIconId(persona.assistantAvatarIconId),
    assistantAvatarShape: persona.assistantAvatarShape,
    assistantAvatarSize: persona.assistantAvatarSize,
    userAvatarAssetId: persona.userAvatarAssetId,
    userAvatarIconId: normalizeAvatarIconId(persona.userAvatarIconId),
    userAvatarShape: persona.userAvatarShape,
    userAvatarSize: persona.userAvatarSize,
    userName: persona.userName,
    purpose: persona.purpose,
    compiledPrompt: persona.compiledPrompt ?? '',
    builderManaged: persona.builderManaged,
    generatedPromptMode: normalizeGeneratedPromptMode(persona.generatedPromptMode),
    messageTemplate: persona.messageTemplate,
    systemTimeContextEnabled: persona.systemTimeContextEnabled ?? false,
    baseId: persona.baseId,
    relationship: persona.relationship,
    expression: persona.expression,
    tags: resolvePersonaTags(persona as Persona),
    initiative: persona.initiative,
    memoryStyle: persona.memoryStyle,
    silence: persona.silence,
    disagreement: persona.disagreement,
    humor: persona.humor,
    attachment: persona.attachment,
    curiosity: persona.curiosity,
    selfDisclosure: persona.selfDisclosure,
    deepDefinition: persona.deepDefinition,
    memory: persona.memory,
    advanced: persona.advanced,
    mcp: persona.mcp,
    pinnedAt: typeof persona.pinnedAt === 'number' ? persona.pinnedAt : null,
    version: persona.version
  });
}

const initialDefaultPersonas = getDefaultPersonasForPlatform();
const initialSeededDefaultPersonaIds = getSeededDefaultPersonaIdsForPlatform();

export const usePersonaStore = create<PersonaState>((set, get) => ({
  personas: initialDefaultPersonas,
  activeCollaboratorId: initialDefaultPersonas[0]?.id ?? null,
  seededDefaultPersonaIds: initialSeededDefaultPersonaIds,
  hydrated: false,
  setActiveCollaborator: (id) => set({ activeCollaboratorId: id }),
  createPersona: (options) => {
    const id = createUid('persona');
    const nextPersona = createSeedPersona(id, options?.template);

    set((state) => ({
      personas: sortPersonasByPinned([nextPersona, ...state.personas]),
      activeCollaboratorId: options?.activate === false ? state.activeCollaboratorId : id
    }));

    return id;
  },
  duplicatePersona: (id) => {
    const source = get().personas.find((persona) => persona.id === id);
    if (!source) return null;

    const nextId = createUid('persona');
    const nextPersona = normalizePersona({
      ...source,
      id: nextId,
      name: `${source.name} 副本`
    });

    set((state) => ({
      personas: sortPersonasByPinned([nextPersona, ...state.personas]),
      activeCollaboratorId: nextId
    }));

    return nextId;
  },
  deleteCollaborator: (id) => {
    const state = get();
    const target = state.personas.find((persona) => persona.id === id);
    if (!target) return false;

    const nextPersonas = state.personas.filter((persona) => persona.id !== id);
    const fallbackCollaboratorId = nextPersonas[0]?.id ?? null;

    // Record the explicit deletion so the next persist tombstones this persona's memory doc
    // bodies through the explicit channel. The persona is now absent from the live list, and
    // absence alone must never tombstone a body (it would be irreversible once the document
    // domain owns bodies); the explicit signal is what authorizes the body removal.
    stagePersonaMemoryDocDeletionForPersona(id);

    set({
      personas: nextPersonas,
      activeCollaboratorId: state.activeCollaboratorId === id ? fallbackCollaboratorId : state.activeCollaboratorId
    });
    if (state.hydrated) {
      void clearMemoryVectorIndexForCollaborator(id).catch((error) => {
        reportPersistenceError({ label: '[store:persist]', store: 'persona', operation: 'delete-collaborator-derived-index' }, error);
      });
    }

    return true;
  },
  toggleCollaboratorPinned: (id) => {
    set((state) => ({
      personas: sortPersonasByPinned(
        state.personas.map((persona) =>
          persona.id === id ? { ...persona, pinnedAt: persona.pinnedAt ? null : Date.now() } : persona
        )
      )
    }));
  },
  updateCollaborator: (id, patch) => {
    const currentPersona = get().personas.find((persona) => persona.id === id) ?? null;
    const sanitizedPatch = isCorePersona(currentPersona) && !isPharosPersona(currentPersona)
      ? {
          ...patch,
          compiledPrompt: undefined,
          messageTemplate: undefined,
          systemTimeContextEnabled: undefined,
          generatedPromptMode: undefined
        }
      : patch;

    set((state) => ({
      personas: sortPersonasByPinned(
        state.personas.map((persona) =>
          persona.id === id
            ? normalizePersona({
                ...persona,
                ...sanitizedPatch,
                name: sanitizedPatch.name !== undefined ? sanitizedPatch.name : persona.name,
                description: (sanitizedPatch.description ?? persona.description).trim(),
                purpose: (sanitizedPatch.purpose ?? persona.purpose).trim(),
                deepDefinition: {
                  ...persona.deepDefinition,
                  ...sanitizedPatch.deepDefinition
                },
                memory: {
                  ...persona.memory,
                  ...sanitizedPatch.memory
                },
                advanced: {
                  ...persona.advanced,
                  ...sanitizedPatch.advanced
                },
                mcp: {
                  ...persona.mcp,
                  ...sanitizedPatch.mcp
                },
                version: persona.version + 1
              })
            : persona
        )
      )
    }));
  },
  hydrateFromDb: async () => {
    try {
      const repositoryPayload = await readPersonaStateFromLocalDataRepositoryIfActive();
      if (repositoryPayload) {
        const migrated = migratePersistedPersonaPayload(repositoryPayload);
        // The repository read returns the stored active pointer verbatim (it does not
        // guess). This is the single resolution point, run AFTER migration so a pointer
        // orphaned by a known default-persona removal (e.g. `coder`) degrades to a valid
        // live persona instead of pointing at a row migration just dropped.
        const activeCollaboratorId = resolveActiveCollaboratorId(
          repositoryPayload.activeCollaboratorId,
          migrated.personas
        );
        set({
          personas: migrated.personas,
          activeCollaboratorId,
          seededDefaultPersonaIds: migrated.seededDefaultPersonaIds,
          hydrated: true
        });
        return false;
      }

      const payload = await kvGet<{
        personas: Persona[];
        activeCollaboratorId: string | null;
        editingCollaboratorId?: string | null;
        seededDefaultPersonaIds?: string[];
      }>('persona-state-v2');

      if (payload && Array.isArray(payload.personas)) {
        const migrated = migratePersistedPersonaPayload({
          personas: payload.personas.map((persona) => normalizePersona(persona)),
          seededDefaultPersonaIds: payload.seededDefaultPersonaIds
        });
        stagePersonaMemoryDocContentFromPersonas(migrated.personas);
        const directoryPersonas = stripPersonaMemoryDocContent(migrated.personas);
        const activeCollaboratorId = resolveActiveCollaboratorId(payload.activeCollaboratorId, directoryPersonas);
        set({
          personas: directoryPersonas,
          activeCollaboratorId,
          seededDefaultPersonaIds: migrated.seededDefaultPersonaIds,
          hydrated: true
        });
        const shouldRewritePayload =
          JSON.stringify(payload.personas) !== JSON.stringify(directoryPersonas) ||
          JSON.stringify(payload.seededDefaultPersonaIds ?? []) !== JSON.stringify(migrated.seededDefaultPersonaIds);
        return shouldRewritePayload;
      }
    } catch (e) {
      reportPersistenceError({ label: '[store:persist]', store: 'persona', operation: 'read' }, e);
      return false;
    }

    set({ hydrated: true });
    return false;
  },
  persistToDb: async () => {
    const { personas, activeCollaboratorId, seededDefaultPersonaIds } = get();
    await writePersonaState({ personas, activeCollaboratorId, seededDefaultPersonaIds });
  }
}));
