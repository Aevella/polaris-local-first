import { collectAssetReferenceOwners } from '../engines/assetGovernance';
import {
  buildAssetMigrationPlan,
  buildChatMigrationRehearsal,
  buildCollectionMigrationPlan,
  buildDocumentLocalDataStateFromSources,
  buildDocumentMigrationPlan,
  buildPersonaMigrationPlan,
  buildRuntimeMigrationPlan,
  buildSpaceMigrationPlan,
  commitChatMigrationRehearsalAndBuildValidationReport,
  getLocalDataRowKey,
  LOCAL_DATA_SCHEMA_VERSION,
  LOCAL_DATA_NAMESPACE,
  buildLocalDataStoreHydrationValidationReports,
  type LocalDataCommitMeta,
  type LocalDataDomain,
  type LocalDataMigrationValidationReport
} from '../engines/localData';
import type { AssetExportEntry } from '../infrastructure/assetStore';
import { readLocalDataCensusReportForKv } from '../infrastructure/localDataHealth';
import type { PersistedCollectionState } from './collectionStorePersistence';
import {
  type LocalDataLiveSourcePromotionSkippedDomain
} from './localDataSourcePromotionPersistence';
import {
  restorePersonaMemoryDocContent,
  serializePersonaMemoryDocContentEntries,
  stripPersonaMemoryDocContent,
  type PersonaMemoryDocContentPayload
} from './personaMemoryReferenceDocPersistence';
import type { RuntimePayload } from './runtimeStorePersistence';
import type { MigratedPersistedSpaceState } from './spaceStorePersistence';
import type { PersistedChatState } from './chatCurrentPersistence';
import type { Persona } from '../types/domain';
import { createStoreLocalDataRepository } from './localDataStorePersistence';
import {
  discoverLocalDataDomainRefs,
  pruneLocalDataUnitOfWorkToChangedRows
} from './localDataStorePersistence';
import { readStoreLocalDataEntriesWithPrefix } from './storeLocalDataBackendHost';

export type StructuredImportLocalDataRestorePayload = {
  chatState: PersistedChatState;
  collectionState: PersistedCollectionState;
  personaState: {
    personas: Persona[];
    activeCollaboratorId: string | null;
    seededDefaultPersonaIds?: string[];
  };
  personaMemoryDocContent: PersonaMemoryDocContentPayload | null;
  runtimeState: RuntimePayload;
  spaceState: MigratedPersistedSpaceState;
  assetEntries: AssetExportEntry[];
};

export type StructuredImportLocalDataRestoreSkippedDomain = {
  domain: LocalDataDomain;
  reason: string;
};

export type StructuredImportLocalDataRestoreResult = {
  restoredDomains: LocalDataDomain[];
  promotedDomains: LocalDataDomain[];
  skippedDomains: StructuredImportLocalDataRestoreSkippedDomain[];
  promotionSkippedDomains: LocalDataLiveSourcePromotionSkippedDomain[];
  promotionFailure: string | null;
};

export type StructuredImportLocalDataRestoreOptions = {
  skipDomains?: LocalDataDomain[];
};

const STRUCTURED_IMPORT_DOMAINS = [
  'chat',
  'collection',
  'persona',
  'runtime',
  'space',
  'asset',
  'document'
] satisfies LocalDataDomain[];

function assetBinaryEntries(assetEntries: AssetExportEntry[]) {
  return assetEntries.map((entry) => ({
    id: entry.meta.id,
    bytes: entry.blob.size
  }));
}

function assetPreviewEntries(assetEntries: AssetExportEntry[]) {
  return assetEntries.flatMap((entry) => (
    entry.previewBlob
      ? [{
          id: entry.meta.id,
          bytes: entry.previewBlob.size
        }]
      : []
  ));
}

function restoreFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === 'object' && 'causeError' in error) {
    const causeError = (error as { causeError?: unknown }).causeError;
    if (causeError) {
      const causeMessage = causeError instanceof Error ? causeError.message : String(causeError);
      return `${message}: ${causeMessage}`;
    }
  }
  return message;
}

export async function restoreStructuredImportToLocalDataRepository(
  payload: StructuredImportLocalDataRestorePayload,
  options: StructuredImportLocalDataRestoreOptions = {}
): Promise<StructuredImportLocalDataRestoreResult> {
  const committedAt = Date.now();
  const validatedAt = committedAt;
  const repository = createStoreLocalDataRepository({ now: () => committedAt });
  const version = LOCAL_DATA_SCHEMA_VERSION;
  const personasWithDocContent = restorePersonaMemoryDocContent(
    payload.personaState.personas,
    payload.personaMemoryDocContent
  );
  const validationReports: Partial<Record<LocalDataDomain, LocalDataMigrationValidationReport>> = {};
  const commitMetas: Partial<Record<LocalDataDomain, LocalDataCommitMeta>> = {};
  const restoredDomains: LocalDataDomain[] = [];
  const skippedDomains: StructuredImportLocalDataRestoreSkippedDomain[] = [];
  const skippedDomainSet = new Set(options.skipDomains ?? []);

  async function prepareReplacement(unitOfWork: Parameters<typeof repository.commit>[0]) {
    const currentRows = [];
    const projectedKeys = new Set(unitOfWork.mutations.flatMap((mutation) => (
      mutation.type === 'put' || mutation.type === 'restore' ? [mutation.row.key] : []
    )));
    for (const ref of await discoverLocalDataDomainRefs(unitOfWork.domain)) {
      const current = await repository.read(ref);
      if (current.status === 'complete' || current.status === 'deleted') {
        currentRows.push(current.row);
      } else if (ref.kind !== 'domainMeta' && !projectedKeys.has(getLocalDataRowKey(ref))) {
        unitOfWork.mutations.push({
          type: 'tombstone',
          ref,
          version: unitOfWork.version,
          deletedAt: committedAt
        });
      }
    }
    pruneLocalDataUnitOfWorkToChangedRows({
      unitOfWork,
      currentRows,
      deletedAt: committedAt
    });
    return unitOfWork;
  }

  async function restoreDomain(domain: LocalDataDomain, operation: () => Promise<LocalDataCommitMeta>) {
    if (skippedDomainSet.has(domain)) {
      skippedDomains.push({ domain, reason: 'precondition-failed' });
      return;
    }
    try {
      commitMetas[domain] = await operation();
      restoredDomains.push(domain);
    } catch (error) {
      skippedDomains.push({ domain, reason: restoreFailureReason(error) });
    }
  }

  await restoreDomain('chat', async () => {
    const chatRehearsal = buildChatMigrationRehearsal({
      snapshot: {
        conversations: payload.chatState.conversations,
        activeConversationId: payload.chatState.activeConversationId
      },
      version,
      committedAt,
      unitId: `import-chat-${committedAt}`,
      knownCollaboratorIds: personasWithDocContent.map((persona) => persona.id)
    });
    await prepareReplacement(chatRehearsal.unitOfWork);
    const chatReadback = await commitChatMigrationRehearsalAndBuildValidationReport({
      repository,
      rehearsal: chatRehearsal,
      validatedAt
    });
    validationReports.chat = chatReadback.validationReport;
    return chatReadback.commitMeta;
  });

  await restoreDomain('collection', async () => {
    const collectionPlan = buildCollectionMigrationPlan({
      id: `import-collection-${committedAt}`,
      state: payload.collectionState,
      activeProjectId: payload.spaceState.collectionProjectId,
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(collectionPlan.unitOfWork));
  });

  await restoreDomain('persona', async () => {
    const personaPlan = buildPersonaMigrationPlan({
      id: `import-persona-${committedAt}`,
      state: {
        personas: stripPersonaMemoryDocContent(personasWithDocContent),
        activeCollaboratorId: payload.personaState.activeCollaboratorId,
        seededDefaultPersonaIds: payload.personaState.seededDefaultPersonaIds ?? []
      },
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(personaPlan.unitOfWork));
  });

  await restoreDomain('runtime', async () => {
    const runtimePlan = buildRuntimeMigrationPlan({
      id: `import-runtime-${committedAt}`,
      state: payload.runtimeState,
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(runtimePlan.unitOfWork));
  });

  await restoreDomain('space', async () => {
    const spacePlan = buildSpaceMigrationPlan({
      id: `import-space-${committedAt}`,
      state: payload.spaceState,
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(spacePlan.unitOfWork));
  });

  await restoreDomain('document', async () => {
    const documentPlan = buildDocumentMigrationPlan({
      id: `import-document-${committedAt}`,
      state: buildDocumentLocalDataStateFromSources({
        kv: serializePersonaMemoryDocContentEntries(payload.personaMemoryDocContent),
        personas: personasWithDocContent,
        workspaceReferenceDocs: payload.collectionState.workspaceReferenceDocs,
        updatedAt: committedAt
      }),
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(documentPlan.unitOfWork));
  });

  await restoreDomain('asset', async () => {
    const assetPlan = buildAssetMigrationPlan({
      id: `import-asset-${committedAt}`,
      state: {
        meta: payload.assetEntries.map((entry) => entry.meta),
        binary: assetBinaryEntries(payload.assetEntries),
        preview: assetPreviewEntries(payload.assetEntries),
        ownersByAssetId: collectAssetReferenceOwners({
          conversations: payload.chatState.conversations,
          codeCards: payload.collectionState.cards,
          imageCards: payload.collectionState.imageCards,
          projectFiles: payload.collectionState.projectFiles,
          workspaceReferenceDocs: payload.collectionState.workspaceReferenceDocs,
          roomProjects: payload.collectionState.roomProjects,
          personas: personasWithDocContent,
          theme: payload.spaceState.theme,
          collaboratorThemes: payload.spaceState.collaboratorThemes,
          customization: payload.spaceState.customization,
          pendingAttachments: []
        })
      },
      version,
      updatedAt: committedAt
    });
    return await repository.commit(await prepareReplacement(assetPlan.unitOfWork));
  });

  let promotedDomains: LocalDataDomain[] = [];
  let promotionSkippedDomains: LocalDataLiveSourcePromotionSkippedDomain[] = [];
  let promotionFailure: string | null = null;

  if (restoredDomains.length > 0) {
    try {
      const kv = await readStoreLocalDataEntriesWithPrefix(`${LOCAL_DATA_NAMESPACE}:`);
      const censusReport = await readLocalDataCensusReportForKv(kv);
      const storeValidation = buildLocalDataStoreHydrationValidationReports({
        kv,
        censusDomains: censusReport.domains,
        validatedAt
      });
      const mergedValidationReports = {
        ...storeValidation.validationReports,
        ...validationReports
      };
      const promotions = STRUCTURED_IMPORT_DOMAINS.flatMap((domain) => {
        if (!restoredDomains.includes(domain)) return [];
        const meta = commitMetas[domain];
        const validationReport = mergedValidationReports[domain];
        if (!meta || !validationReport) {
          promotionSkippedDomains.push({
            domain,
            status: 'validation-report-missing',
            reasons: ['validation-report-missing']
          });
          return [];
        }
        return [{ meta, validationReport }];
      });
      if (promotions.length === 0) {
        throw new Error('No LocalData import domains have promotion validation reports.');
      }
      await repository.promoteActiveDataSources(promotions);
      promotedDomains = promotions.map((promotion) => promotion.meta.domain);
    } catch (error) {
      promotionFailure = restoreFailureReason(error);
    }
  }

  return {
    restoredDomains: STRUCTURED_IMPORT_DOMAINS.filter((domain) => restoredDomains.includes(domain)),
    promotedDomains,
    skippedDomains,
    promotionSkippedDomains,
    promotionFailure
  };
}
