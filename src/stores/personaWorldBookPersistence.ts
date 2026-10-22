import { commitPersonaRowChanges, commitPersonaRowChangesFromStateActivating } from './persona/localData';
import { createStoreLocalDataRepository, isLocalDataRepositoryDomainActive } from './localDataStorePersistence';
import { getPersonaObjectLocalDataRef, isLegacyLifecyclePersonaState, LOCAL_DATA_SCHEMA_VERSION, type PersonaObjectRow } from '../engines/localData';
import type { Persona } from '../types/domain';


type PersonaSnapshot = { personas: Persona[]; activeCollaboratorId: string | null; seededDefaultPersonaIds?: string[] };

// Called under the persona commit queue. Only the selected world's field changes;
// document bodies and other collaborators are never read, rewritten or finalized.
export async function persistPersonaWorldBook(snapshot: PersonaSnapshot, personaId: string, regexTriggers: string) {
  if (await isLocalDataRepositoryDomainActive('persona')) {
    const repository = createStoreLocalDataRepository();
    const current = await repository.read<PersonaObjectRow>(getPersonaObjectLocalDataRef(personaId));
    if (current.status !== 'complete') {
      const { readStoreLocalDataValue } = await import('./storeLocalDataBackendHost');
      const { getLocalDataRowKey } = await import('../engines/localData');
      if (await readStoreLocalDataValue(getLocalDataRowKey(getPersonaObjectLocalDataRef(personaId))) !== null) {
        throw new Error('协作者资料尚未完整载入，请稍后重试。');
      }
      const target = snapshot.personas.find(persona => persona.id === personaId);
      if (!target) throw new Error('协作者已不存在，世界书未写入。');
      await commitPersonaRowChanges({
        changes: [{ type: 'upsert', value: { ...target, advanced: { ...target.advanced, regexTriggers } } }],
        activeCollaboratorId: snapshot.activeCollaboratorId,
        seededDefaultPersonaIds: snapshot.seededDefaultPersonaIds ?? []
      });
      return;
    }
    if (isLegacyLifecyclePersonaState(current.value.state)) {
      throw new Error('协作者当前不在可编辑资料中，世界书未写入。');
    }
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
  const target = snapshot.personas.find(persona => persona.id === personaId);
  if (!target) throw new Error('协作者已不存在，世界书未写入。');
  const committed = await commitPersonaRowChangesFromStateActivating({
    ...snapshot,
    seededDefaultPersonaIds: snapshot.seededDefaultPersonaIds ?? [],
    personas: snapshot.personas.map(persona => persona.id === personaId
      ? { ...persona, advanced: { ...persona.advanced, regexTriggers } } : persona)
  });
  if (!committed) throw new Error('当前资料尚未迁入本地数据仓库，世界书未写入。');
}
