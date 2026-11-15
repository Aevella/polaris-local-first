import { kvGet, kvSet } from '../infrastructure/persistence';
import { createStoreLocalDataRepository, isLocalDataRepositoryDomainActive } from './localDataStorePersistence';
import { getPersonaObjectLocalDataRef, LOCAL_DATA_SCHEMA_VERSION, type PersonaObjectRow } from '../engines/localData';
import type { Persona } from '../types/domain';
import { stripPersonaMemoryDocContent } from './personaMemoryReferenceDocPersistence';

type PersonaSnapshot = { personas: Persona[]; activeCollaboratorId: string | null; seededDefaultPersonaIds?: string[] };

// Called under the persona commit queue. Only the selected world's field changes;
// document bodies and other collaborators are never read, rewritten or finalized.
export async function persistPersonaWorldBook(snapshot: PersonaSnapshot, personaId: string, regexTriggers: string) {
  if (await isLocalDataRepositoryDomainActive('persona')) {
    const repository = createStoreLocalDataRepository();
    const current = await repository.read<PersonaObjectRow>(getPersonaObjectLocalDataRef(personaId));
    if (current.status !== 'complete') throw new Error('协作者资料尚未完整载入，请稍后重试。');
    const row = current.row;
    const updatedAt = Date.now();
    await repository.commit({
      domain: 'persona', version: LOCAL_DATA_SCHEMA_VERSION,
      mutations: [{ type: 'put', row: {
        ...row, updatedAt,
        value: { ...row.value, updatedAt, value: {
          ...row.value.value,
          advanced: { ...row.value.value.advanced, regexTriggers }
        } }
      } }]
    });
    return;
  }
  const stored = await kvGet<PersonaSnapshot>('persona-state-v2');
  if (stored && !Array.isArray(stored.personas)) throw new Error('协作者存储格式异常，原数据已保留。');
  const base = stored ?? { ...snapshot, personas: stripPersonaMemoryDocContent(snapshot.personas) };
  const target = base.personas.find((persona) => persona.id === personaId)
    ?? snapshot.personas.find((persona) => persona.id === personaId);
  if (!target) throw new Error('协作者已不存在，世界书未写入。');
  const updated = { ...target, advanced: { ...target.advanced, regexTriggers } };
  await kvSet('persona-state-v2', {
    ...base,
    personas: base.personas.some((persona) => persona.id === personaId)
      ? base.personas.map((persona) => persona.id === personaId ? updated : persona)
      : [...base.personas, stripPersonaMemoryDocContent([updated])[0]]
  });
}
