import { KNOWN_BUNDLED_PERSONA_IDS } from '../../config/persona/personaBuilder';

const CHAT_CATALOG_KEY = 'chat-catalog-v1';
const PERSONA_STATE_KEY = 'persona-state-v2';
const RUNTIME_STATE_KEY = 'runtime-providers-v2';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecordArray(value: unknown, key: string) {
  return isPlainRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function uniqueSortedIds(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0))).sort();
}

export type LocalDataOwnerRegistry = {
  collaboratorIds: string[];
  historicalOwnerIds: string[];
};

export function buildLocalDataOwnerRegistry(byKey: Map<string, unknown>): LocalDataOwnerRegistry {
  const collaboratorIds = new Set<string>();
  const historicalOwnerIds = new Set<string>(KNOWN_BUNDLED_PERSONA_IDS);
  const personaState = byKey.get(PERSONA_STATE_KEY);
  const chatCatalog = byKey.get(CHAT_CATALOG_KEY);
  const runtimeState = byKey.get(RUNTIME_STATE_KEY);

  for (const persona of readRecordArray(personaState, 'personas')) {
    if (!isPlainRecord(persona)) continue;
    const id = readString(persona.id);
    if (!id) continue;
    collaboratorIds.add(id);
    historicalOwnerIds.add(id);
  }

  for (const conversation of readRecordArray(chatCatalog, 'conversations')) {
    if (!isPlainRecord(conversation)) continue;
    const collaboratorId = readString(conversation.collaboratorId);
    if (collaboratorId) historicalOwnerIds.add(collaboratorId);
  }

  for (const connection of readRecordArray(runtimeState, 'companionConnections')) {
    if (!isPlainRecord(connection)) continue;
    const collaboratorId = readString(connection.collaboratorId);
    if (collaboratorId) historicalOwnerIds.add(collaboratorId);
  }

  return {
    collaboratorIds: uniqueSortedIds(collaboratorIds),
    historicalOwnerIds: uniqueSortedIds(historicalOwnerIds)
  };
}
