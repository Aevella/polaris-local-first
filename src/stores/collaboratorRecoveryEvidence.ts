import {
  getLocalDataRowKey,
  isLegacyLifecyclePersonaState,
  getPersonaObjectLocalDataRef,
  type PersonaObjectRow
} from '../engines/localData';
import { readStoreLocalDataValue } from './storeLocalDataBackendHost';
import {
  createStoreLocalDataRepository,
  isLocalDataRepositoryDomainActive
} from './localDataStorePersistence';
export type CollaboratorRecoveryEvidence =
  | { mode: 'checking' }
  | { mode: 'reload'; name: string }
  | { mode: 'rebuild' }
  | { mode: 'blocked'; reason: 'damaged' | 'deleted-without-snapshot' };

export function classifyCollaboratorRecoveryEvidence(args: {
  repositoryActive: boolean;
  repositoryStatus?: 'complete' | 'deleted' | 'incomplete' | 'unloaded' | 'timedOut';
  repositoryName?: string;
  rawRowPresent?: boolean;
}): CollaboratorRecoveryEvidence {
  if (!args.repositoryActive) return { mode: 'rebuild' };
  if (args.repositoryStatus === 'complete' && args.repositoryName) {
    return { mode: 'reload', name: args.repositoryName };
  }
  if (args.repositoryStatus === 'deleted') {
    return { mode: 'blocked', reason: 'deleted-without-snapshot' };
  }
  return args.rawRowPresent
    ? { mode: 'blocked', reason: 'damaged' }
    : { mode: 'rebuild' };
}

export async function readCollaboratorRecoveryEvidence(
  collaboratorIds: readonly string[]
): Promise<Record<string, CollaboratorRecoveryEvidence>> {
  const ids = Array.from(new Set(collaboratorIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return {};

  const repositoryActive = await isLocalDataRepositoryDomainActive('persona');
  if (!repositoryActive) return Object.fromEntries(ids.map(id => [id, { mode: 'blocked', reason: 'damaged' } as const]));

  const repository = createStoreLocalDataRepository();
  const entries = await Promise.all(ids.map(async (id) => {

    const ref = getPersonaObjectLocalDataRef(id);
    try {
      const read = await repository.read<PersonaObjectRow>(ref);
      if (read.status === 'complete' && isLegacyLifecyclePersonaState(read.value.state)) return [id, { mode: 'blocked', reason: 'damaged' }] as const;
      if (read.status === 'complete') return [id, classifyCollaboratorRecoveryEvidence({
        repositoryActive,
        repositoryStatus: read.status,
        repositoryName: read.value.value.name
      })] as const;
      const rawRow = await readStoreLocalDataValue<unknown>(getLocalDataRowKey(ref));
      return [id, classifyCollaboratorRecoveryEvidence({
        repositoryActive,
        repositoryStatus: read.status,
        rawRowPresent: rawRow !== null
      })] as const;
    } catch {
      return [id, classifyCollaboratorRecoveryEvidence({
        repositoryActive,
        repositoryStatus: 'incomplete',
        rawRowPresent: true
      })] as const;
    }
  }));

  return Object.fromEntries(entries);
}
