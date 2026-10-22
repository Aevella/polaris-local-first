import type { Persona } from '../types/domain';
import {
  docContentKey, isConfirmedPersonaMemoryDocBodyDamage, readPersonaMemoryDocContent,
  restorePersonaMemoryDocContent, stripPersonaMemoryDocContent, type PersonaMemoryDocContentPayload
} from './personaMemoryReferenceDocPersistence';

// Backup reads only the live directory. Unreferenced physical fragments stay on
// the source device; a failed read is degraded only for confirmed body damage.
export async function preparePersonaBackupDocuments(personas: Persona[], supplied?: PersonaMemoryDocContentPayload | null) {
  const docs: Record<string, string> = {};
  const missing: Array<{ personaId: string; docId: string; title: string }> = [];
  const prepared: Persona[] = [];
  for (const persona of personas) {
    const referenceDocs = [];
    for (const doc of persona.memory.referenceDocs) {
      const key = docContentKey(persona.id, doc.id);
      try {
        if (doc.bodyStatus === 'missing' && typeof supplied?.docs[key] !== 'string') {
          throw new Error(`Persona memory document content is missing: ${key}`);
        }
        const restored = doc.contentLoaded || doc.content.length > 0
          ? doc
          : supplied !== undefined
          ? restorePersonaMemoryDocContent([{ ...persona, memory: { ...persona.memory, referenceDocs: [doc] } }], supplied)[0]!.memory.referenceDocs[0]!
          : { ...doc, content: await readPersonaMemoryDocContent(persona.id, doc), contentLoaded: true };
        if (!restored.contentLoaded && !restored.content && ((restored.charCount ?? 0) > 0 || restored.source !== 'user')) throw new Error(`Persona memory document content is missing: ${key}`);
        const { bodyStatus: _status, ...available } = restored;
        docs[key] = available.content;
        referenceDocs.push(available);
      } catch (error) {
        if (!isConfirmedPersonaMemoryDocBodyDamage(error)) throw error;
        missing.push({ personaId: persona.id, docId: doc.id, title: doc.title });
        referenceDocs.push({ ...doc, content: '', contentLoaded: false, bodyStatus: 'missing' as const });
      }
    }
    prepared.push({ ...persona, memory: { ...persona.memory, referenceDocs } });
  }
  return { personas: stripPersonaMemoryDocContent(prepared), payload: { version: 1 as const, docs }, missing };
}

// An explicitly missing imported body must not replace a readable copy already
// on the destination. Full restore still owns all other replacement semantics.
export async function preserveExistingBodiesForMissingImports(personas: Persona[]) {
  if (!personas.some(persona => persona.memory.referenceDocs.some(doc => doc.bodyStatus === 'missing'))) return personas;
  const { kvGet } = await import('../infrastructure/persistence');
  const { createStoreLocalDataRepository, isLocalDataRepositoryDomainActive } = await import('./localDataStorePersistence');
  const { getPersonaObjectLocalDataRef, isLiveProductPersonaState } = await import('../engines/localData');
  const { readPersonaMemoryDocContent } = await import('./personaMemoryReferenceDocPersistence');
  const active = await isLocalDataRepositoryDomainActive('persona');
  const legacy = active ? null : await kvGet<{ personas: Persona[] }>('persona-state-v2');
  const result: Persona[] = [];
  for (const persona of personas) {
    if (!persona.memory.referenceDocs.some(doc => doc.bodyStatus === 'missing')) { result.push(persona); continue; }
    const row = active ? await createStoreLocalDataRepository().read<import('../engines/localData').PersonaObjectRow>(getPersonaObjectLocalDataRef(persona.id)) : null;
    if (row?.status === 'timedOut' || row?.status === 'unloaded') {
      throw new Error(`Destination collaborator is temporarily unreadable (${row.status}): ${persona.id}`);
    }
    const existing = row?.status === 'complete' && isLiveProductPersonaState(row.value.state) ? row.value.value : legacy?.personas.find(item => item.id === persona.id);
    const referenceDocs = [];
    for (const doc of persona.memory.referenceDocs) {
      const previous = existing?.memory.referenceDocs.find(item => item.id === doc.id);
      if (doc.bodyStatus !== 'missing' || !previous || previous.bodyStatus === 'missing') { referenceDocs.push(doc); continue; }
      try {
        const content = previous.contentLoaded ? previous.content : await readPersonaMemoryDocContent(persona.id, previous);
        const { bodyStatus: _status, ...restored } = doc;
        referenceDocs.push({ ...restored, content, contentLoaded: true, charCount: content.length });
      } catch (error) {
        if (!isConfirmedPersonaMemoryDocBodyDamage(error)) throw error;
        referenceDocs.push(doc);
      }
    }
    result.push({ ...persona, memory: { ...persona.memory, referenceDocs } });
  }
  return result;
}
