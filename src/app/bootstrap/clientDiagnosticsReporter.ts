import { Capacitor } from '@capacitor/core';
import packageJson from '../../../package.json';
import {
  getPersistenceStorageDiagnostic,
  kvGet,
  kvKeys
} from '../../infrastructure/persistence';
import {
  listActiveAssetBinaryKeys,
  listActiveAssetMetaEntries,
  listActiveAssetPreviewKeys
} from '../../infrastructure/assetStore';
import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';
import { getPolarisDeviceId } from '../../engines/freeProvider';
import {
  getLocalDataActiveDataSourceKey,
  LOCAL_DATA_NAMESPACE,
  type LocalDataActiveDataSourceRow,
  type LocalDataDomain
} from '../../engines/localData/types';
import {
  sanitizeClientDiagnosticText,
  type ClientDiagnosticsCollaboratorOrphanSummary,
  type ClientDiagnosticsErrorSummary,
  type ClientDiagnosticsLocalDataDomainSourceSummary,
  type ClientDiagnosticsLocalDataUsageSummary,
  type ClientDiagnosticsPayload,
  type ClientDiagnosticsPersistenceSummary,
  type ClientDiagnosticsPlatform,
  type ClientDiagnosticsStorageSummary
} from '../../engines/clientDiagnostics';
import type { LocalDataCollaboratorOrphanDiagnostic, LocalDataHealthSnapshot } from '../../infrastructure/localDataHealth';
import {
  subscribeLatestPersistenceError,
  fingerprintDiagnosticId,
  type PersistenceDiagnosticEntry
} from '../../infrastructure/persistenceDiagnostics';
import {
  getStoreLocalDataBackend,
  listStoreLocalDataKeysWithPrefix,
  readStoreLocalDataValue
} from '../../stores/storeLocalDataBackendHost';

const CLIENT_DIAGNOSTICS_DISABLED_KEY = 'polaris-client-diagnostics-disabled';
const CLIENT_DIAGNOSTICS_DEV_ENABLED_KEY = 'polaris-client-diagnostics-dev-enabled';
const STARTUP_REPORT_SETTLE_DELAY_MS = 6000;
const STARTUP_REPORT_IDLE_TIMEOUT_MS = 20000;
const LOCAL_DATA_DOMAINS: LocalDataDomain[] = ['asset', 'chat', 'collection', 'document', 'persona', 'runtime', 'space'];
const CHAT_CATALOG_KEY = 'chat-catalog-v1';
const PERSONA_STATE_KEY = 'persona-state-v2';
const PERSONA_MEMORY_DOC_CONTENT_PREFIX = 'persona-memory-doc-content-v2:';
const PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX = 'persona-memory-doc-content-v3:';
const RUNTIME_STATE_KEY = 'runtime-providers-v2';

let diagnosticsSessionId: string | null = null;
let installed = false;

function createDiagnosticsId(prefix: string) {
  const random = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function getDiagnosticsSessionId() {
  diagnosticsSessionId ??= createDiagnosticsId('diag-session');
  return diagnosticsSessionId;
}

function isClientDiagnosticsEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(CLIENT_DIAGNOSTICS_DISABLED_KEY) === 'true') return false;
    if (import.meta.env.DEV) {
      return window.localStorage.getItem(CLIENT_DIAGNOSTICS_DEV_ENABLED_KEY) === 'true'
        || new URLSearchParams(window.location.search).has('client-diagnostics');
    }
    return true;
  } catch {
    return !import.meta.env.DEV;
  }
}

function resolvePlatform(): ClientDiagnosticsPlatform {
  try {
    if (Capacitor.isNativePlatform()) {
      const platform = Capacitor.getPlatform();
      return platform === 'ios' || platform === 'android' ? platform : 'unknown';
    }
  } catch {
    return 'unknown';
  }
  return typeof window !== 'undefined' && window.polarisDesktopLocal ? 'desktop' : 'web';
}

function resolveChannel() {
  if (import.meta.env.DEV) return 'dev';
  if (Capacitor.isNativePlatform()) return `native-${Capacitor.getPlatform()}`;
  return 'web';
}

function currentUrlPath() {
  if (typeof window === 'undefined') return undefined;
  try {
    return `${window.location.pathname || '/'}${window.location.search ? '?[redacted-query]' : ''}`;
  } catch {
    return undefined;
  }
}

function incrementBucket(buckets: Record<string, number>, key: string) {
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function bucketKvKey(key: string) {
  if (key === 'chat-catalog-v1' || key.startsWith('chat-conversation-record-v1:')) return 'chat:records';
  if (key.startsWith('chat-message-v1:') || key.startsWith('chat-manifest-v1:')) return 'chat:legacy-commit';
  if (key.startsWith('chat-messages-v2:') || key === 'chat-index-v2') return 'chat:legacy-index';
  if (key.startsWith('persona-memory-doc-content-v2:')) return 'persona:doc-body';
  if (key.startsWith('persona-memory-doc-content-v3:')) return 'persona:doc-body-chunk';
  if (key.startsWith('workspace-reference-doc-content-v1:')) return 'workspace:doc-body';
  if (key.startsWith('workspace-reference-doc-content-v2:')) return 'workspace:doc-body-chunk';
  if (key.startsWith('local-data-v1:')) return 'local-data';
  if (key === 'persona-state-v2') return 'persona:state';
  if (key === 'collection-state-v2') return 'collection:state';
  if (key === 'runtime-providers-v2') return 'runtime:state';
  if (key === 'space-theme-state-v1') return 'space:theme';
  return 'other';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLocalDataCommitPointer(value: unknown, domain: LocalDataDomain) {
  return isRecord(value)
    && value.domain === domain
    && typeof value.version === 'number'
    && typeof value.committedAt === 'number'
    && typeof value.commitId === 'string'
    && value.commitId.trim().length > 0;
}

function isLocalDataActiveDataSourceRow(value: unknown): value is LocalDataActiveDataSourceRow {
  return isRecord(value)
    && value.key === getLocalDataActiveDataSourceKey()
    && value.activeDataSource === 'repository'
    && isRecord(value.domains);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readRecordArray(value: unknown, key: string) {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function readPersonaStateIds(value: unknown) {
  const ids = new Set<string>();
  for (const persona of readRecordArray(value, 'personas')) {
    if (!isRecord(persona)) continue;
    const id = readString(persona.id);
    if (id) ids.add(id);
  }
  return ids;
}

function readExplicitOwnerRefIds(chatCatalog: unknown, runtimeState: unknown) {
  const ids = new Set<string>();
  for (const conversation of readRecordArray(chatCatalog, 'conversations')) {
    if (!isRecord(conversation)) continue;
    const collaboratorId = readString(conversation.collaboratorId);
    if (collaboratorId) ids.add(collaboratorId);
  }
  for (const connection of readRecordArray(runtimeState, 'companionConnections')) {
    if (!isRecord(connection)) continue;
    const collaboratorId = readString(connection.collaboratorId);
    if (collaboratorId) ids.add(collaboratorId);
  }
  for (const rule of readRecordArray(runtimeState, 'triggerRules')) {
    if (!isRecord(rule) || !isRecord(rule.target)) continue;
    const collaboratorId = readString(rule.target.collaboratorId);
    if (collaboratorId) ids.add(collaboratorId);
  }
  return ids;
}

function readPersonaMemoryOwnerIdFromKey(key: string, prefix: string) {
  if (!key.startsWith(prefix)) return null;
  const body = key.slice(prefix.length);
  const separatorIndex = body.indexOf(':');
  if (separatorIndex < 0) return null;
  try {
    return decodeURIComponent(body.slice(0, separatorIndex));
  } catch {
    return body.slice(0, separatorIndex);
  }
}

function readPersonaRowCollaboratorId(key: string) {
  const prefix = `${LOCAL_DATA_NAMESPACE}:row:persona:collaborator:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function readRowNumber(value: unknown, field: string) {
  return isRecord(value) && typeof value[field] === 'number' && Number.isFinite(value[field])
    ? value[field]
    : null;
}

function readRowState(value: unknown): ClientDiagnosticsCollaboratorOrphanSummary['rowState'] {
  if (value === undefined) return 'missing';
  if (
    isRecord(value)
    && (
      value.state === 'complete'
      || value.state === 'unloaded'
      || value.state === 'incomplete'
      || value.state === 'timedOut'
      || value.state === 'deleted'
    )
  ) {
    return value.state;
  }
  return 'unreadable';
}

function countChunkedMemoryBodies(keys: string[], collaboratorId: string) {
  const encodedPrefix = `${encodeURIComponent(collaboratorId)}:`;
  const bodies = new Set<string>();
  let chunks = 0;
  for (const key of keys) {
    if (!key.startsWith(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX)) continue;
    const body = key.slice(PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX.length);
    if (!body.startsWith(encodedPrefix)) continue;
    const separatorIndex = body.lastIndexOf(':');
    if (separatorIndex < 0) continue;
    bodies.add(body.slice(0, separatorIndex));
    chunks += 1;
  }
  return {
    bodyCount: bodies.size,
    chunkCount: chunks
  };
}

async function collectCollaboratorOrphanDiagnostics(
  kvKeyList: string[]
): Promise<ClientDiagnosticsCollaboratorOrphanSummary[] | undefined> {
  const [chatCatalog, personaState, runtimeState] = await Promise.all([
    kvGet<unknown>(CHAT_CATALOG_KEY).catch(() => undefined),
    kvGet<unknown>(PERSONA_STATE_KEY).catch(() => undefined),
    kvGet<unknown>(RUNTIME_STATE_KEY).catch(() => undefined)
  ]);
  const personaStateIds = readPersonaStateIds(personaState);
  const liveOwnerRefIds = new Set(Array.from(readExplicitOwnerRefIds(chatCatalog, runtimeState))
    .filter((id) => !personaStateIds.has(id)));
  const orphanMemoryOwnerIds = new Set(kvKeyList.flatMap((key) => {
    const ownerId = readPersonaMemoryOwnerIdFromKey(key, PERSONA_MEMORY_DOC_CONTENT_PREFIX)
      ?? readPersonaMemoryOwnerIdFromKey(key, PERSONA_MEMORY_DOC_CONTENT_CHUNK_PREFIX);
    return ownerId && !personaStateIds.has(ownerId) ? [ownerId] : [];
  }));
  const orphanPersonaRowIds = new Set(kvKeyList.flatMap((key) => {
    const ownerId = readPersonaRowCollaboratorId(key);
    return ownerId && !personaStateIds.has(ownerId) ? [ownerId] : [];
  }));
  const collaboratorIds = Array.from(new Set([
    ...liveOwnerRefIds,
    ...orphanMemoryOwnerIds,
    ...orphanPersonaRowIds
  ]));
  if (collaboratorIds.length === 0) return undefined;

  const entries = await Promise.all(collaboratorIds.map(async (collaboratorId) => {
    const rowKey = `${LOCAL_DATA_NAMESPACE}:row:persona:collaborator:${collaboratorId}`;
    const row = await kvGet<unknown>(rowKey).catch(() => undefined);
    const encodedPrefix = `${encodeURIComponent(collaboratorId)}:`;
    const splitMemoryBodyCount = kvKeyList.filter((key) => (
      key.startsWith(PERSONA_MEMORY_DOC_CONTENT_PREFIX + encodedPrefix)
    )).length;
    const chunkedMemory = countChunkedMemoryBodies(kvKeyList, collaboratorId);
    return {
      collaboratorFingerprint: fingerprintDiagnosticId(collaboratorId),
      rowFingerprint: fingerprintDiagnosticId(rowKey),
      rowState: readRowState(row),
      rowUpdatedAt: readRowNumber(row, 'updatedAt'),
      rowDeletedAt: readRowNumber(row, 'deletedAt'),
      repositoryRowPresent: row !== undefined,
      personaStateHasId: personaStateIds.has(collaboratorId),
      referencedByLiveOwnerRef: liveOwnerRefIds.has(collaboratorId),
      hasOrphanMemoryBodies: orphanMemoryOwnerIds.has(collaboratorId),
      splitMemoryBodyCount,
      chunkedMemoryBodyCount: chunkedMemory.bodyCount,
      chunkedMemoryBodyChunkCount: chunkedMemory.chunkCount
    };
  }));
  return entries;
}

async function collectLocalDataUsageSummary(kvKeyList: string[]): Promise<ClientDiagnosticsLocalDataUsageSummary> {
  const repositoryRowsByDomain: Record<string, number> = {};
  const repositoryKeyPrefix = `${LOCAL_DATA_NAMESPACE}:`;
  const repositoryRowPrefix = `${LOCAL_DATA_NAMESPACE}:row:`;
  const repositoryPointerPrefix = `${LOCAL_DATA_NAMESPACE}:pointer:`;
  const repositoryKeys = await listStoreLocalDataKeysWithPrefix(repositoryKeyPrefix);
  const repositoryKeyCount = repositoryKeys.length;
  const repositoryRowKeys = repositoryKeys.filter((key) => key.startsWith(repositoryRowPrefix));
  const repositoryPointerCount = repositoryKeys.filter((key) => key.startsWith(repositoryPointerPrefix)).length;

  for (const key of repositoryRowKeys) {
    for (const domain of LOCAL_DATA_DOMAINS) {
      if (key.startsWith(`${repositoryRowPrefix}${domain}:`)) {
        repositoryRowsByDomain[domain] = (repositoryRowsByDomain[domain] ?? 0) + 1;
        break;
      }
    }
  }

  let activeDataSource: ClientDiagnosticsLocalDataUsageSummary['activeDataSource'] = 'unknown';
  let activeDomains: string[] = [];
  let activeDataSourceRowPresent = false;
  try {
    const activeRow = await readStoreLocalDataValue<unknown>(getLocalDataActiveDataSourceKey());
    activeDataSourceRowPresent = Boolean(activeRow);
    if (isLocalDataActiveDataSourceRow(activeRow)) {
      activeDataSource = activeRow.activeDataSource;
      activeDomains = LOCAL_DATA_DOMAINS.filter((domain) => isLocalDataCommitPointer(activeRow.domains[domain], domain));
    }
  } catch {
    activeDataSource = 'unknown';
  }

  const collaboratorOrphans = await collectCollaboratorOrphanDiagnostics(kvKeyList);

  return {
    activeDataSource,
    activeDataSourceRowPresent,
    activeDomainCount: activeDomains.length,
    activeDomains,
    repositoryKeyCount,
    repositoryRowCount: repositoryRowKeys.length,
    repositoryPointerCount,
    repositoryRowsByDomain,
    nonRepositoryKvKeyCount: kvKeyList.filter((key) => !key.startsWith(repositoryKeyPrefix)).length,
    ...(collaboratorOrphans ? { collaboratorOrphans } : {})
  };
}

function summarizeHealthSnapshotDomainSources(
  snapshot: LocalDataHealthSnapshot
): ClientDiagnosticsLocalDataDomainSourceSummary[] {
  return snapshot.domainSources.map((source) => ({
    domain: source.domain,
    status: source.status,
    activeObjectCount: source.activeObjectCount,
    objectCount: source.objectCount,
    repositoryRowCount: source.repositoryRowCount,
    legacySourceCount: source.legacySourceCount,
    issueCount: source.issueCount
  }));
}

function summarizeHealthSnapshotCollaboratorOrphans(
  snapshot: LocalDataHealthSnapshot
): ClientDiagnosticsCollaboratorOrphanSummary[] | undefined {
  return snapshot.collaboratorOrphans.length > 0
    ? snapshot.collaboratorOrphans.map((orphan: LocalDataCollaboratorOrphanDiagnostic) => ({
        collaboratorFingerprint: fingerprintDiagnosticId(orphan.collaboratorId),
        rowFingerprint: fingerprintDiagnosticId(orphan.rowKey),
        rowState: orphan.rowState,
        rowUpdatedAt: orphan.rowUpdatedAt,
        rowDeletedAt: orphan.rowDeletedAt,
        repositoryRowPresent: orphan.repositoryRowPresent,
        personaStateHasId: orphan.personaStateHasId,
        referencedByLiveOwnerRef: orphan.referencedByLiveOwnerRef,
        hasOrphanMemoryBodies: orphan.hasOrphanMemoryBodies,
        splitMemoryBodyCount: orphan.splitMemoryBodyCount,
        chunkedMemoryBodyCount: orphan.chunkedMemoryBodyCount,
        chunkedMemoryBodyChunkCount: orphan.chunkedMemoryBodyChunkCount
      }))
    : undefined;
}

function readLocalStorageSummary() {
  if (typeof window === 'undefined') return { keyCount: 0, bytes: 0 };
  try {
    let bytes = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const valueLength = window.localStorage.getItem(key)?.length ?? 0;
      bytes += key.length + valueLength;
    }
    return {
      keyCount: window.localStorage.length,
      bytes
    };
  } catch {
    return { keyCount: 0, bytes: 0 };
  }
}

async function collectStorageSummary(keys: string[]): Promise<ClientDiagnosticsStorageSummary> {
  const [assetMetaKeys, assetBinaryKeys, assetPreviewKeys, storage] = await Promise.all([
    listActiveAssetMetaEntries().then((entries) => entries.map((entry) => entry.key)),
    listActiveAssetBinaryKeys(),
    listActiveAssetPreviewKeys(),
    getPersistenceStorageDiagnostic()
  ]);
  const kvKeyBuckets: Record<string, number> = {};
  for (const key of keys) {
    incrementBucket(kvKeyBuckets, bucketKvKey(key));
  }
  const localStorageSummary = readLocalStorageSummary();
  return {
    storageMode: storage.mode,
    storageLabel: storage.label,
    kvKeyCount: keys.length,
    kvKeyBuckets,
    assetMetaKeyCount: assetMetaKeys.length,
    assetBinaryKeyCount: assetBinaryKeys.length,
    assetPreviewKeyCount: assetPreviewKeys.length,
    localStorageKeyCount: localStorageSummary.keyCount,
    localStorageBytes: localStorageSummary.bytes
  };
}

function basePayload(eventKind: ClientDiagnosticsPayload['eventKind']): Omit<ClientDiagnosticsPayload, 'storage' | 'error'> {
  return {
    schemaVersion: 1,
    eventId: createDiagnosticsId('diag-event'),
    sessionId: getDiagnosticsSessionId(),
    eventKind,
    createdAt: Date.now(),
    appVersion: packageJson.version,
    platform: resolvePlatform(),
    channel: resolveChannel(),
    urlPath: currentUrlPath()
  };
}

async function sendDiagnosticsPayload(payload: ClientDiagnosticsPayload) {
  if (!isClientDiagnosticsEnabled()) return;
  try {
    await fetch(buildInternalApiEndpoint('/api/client-diagnostics'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Polaris-Device-Id': getPolarisDeviceId()
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
  } catch {
    // Remote diagnostics must never affect the app.
  }
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function errorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

function buildErrorSummary(
  error: unknown,
  source: ClientDiagnosticsErrorSummary['source']
): ClientDiagnosticsErrorSummary {
  return {
    source,
    name: errorName(error),
    message: sanitizeClientDiagnosticText(errorMessage(error)),
    stack: sanitizeClientDiagnosticText(errorStack(error), 1200)
  };
}

async function reportStorageSummary(eventKind: 'startup' | 'storage-summary') {
  try {
    const keys = await kvKeys();
    const [storage, localData] = await Promise.all([
      collectStorageSummary(keys),
      collectLocalDataUsageSummary(keys)
    ]);
    await sendDiagnosticsPayload({
      ...basePayload(eventKind),
      storage,
      localData
    });
  } catch {
    // Local collection failures stay local.
  }
}

export async function reportLocalDataHealthDiagnostics(snapshot: LocalDataHealthSnapshot) {
  try {
    const keys = await kvKeys();
    const [storage, localData] = await Promise.all([
      collectStorageSummary(keys),
      collectLocalDataUsageSummary(keys)
    ]);
    await sendDiagnosticsPayload({
      ...basePayload('storage-summary'),
      storage,
      localData: {
        ...localData,
        activeDataSource: snapshot.censusReport.activeDataSource,
        activeDataSourceRowPresent: snapshot.census.repository.activeDataSourceRowPresent,
        repositoryRowCount: snapshot.census.repository.rowCount,
        repositoryPointerCount: snapshot.census.repository.pointerCount,
        domainSources: summarizeHealthSnapshotDomainSources(snapshot),
        ...(() => {
          const collaboratorOrphans = summarizeHealthSnapshotCollaboratorOrphans(snapshot);
          return collaboratorOrphans ? { collaboratorOrphans } : {};
        })()
      }
    });
  } catch {
    // Remote health diagnostics must never affect the local health page.
  }
}

function reportClientError(error: unknown, source: 'window-error' | 'unhandled-rejection') {
  void sendDiagnosticsPayload({
    ...basePayload(source),
    error: buildErrorSummary(error, source)
  });
}

async function reportPersistenceDiagnostic(entry: PersistenceDiagnosticEntry) {
  try {
    const storage = await getPersistenceStorageDiagnostic();
    const summary: ClientDiagnosticsPersistenceSummary = {
      backend: entry.backend ?? `${storage.mode}-${getStoreLocalDataBackend().mode}`,
      store: entry.store,
      domain: entry.domain,
      operation: entry.operation,
      stage: entry.stage ?? 'unknown',
      integrity: entry.integrity ?? 'failed',
      rowCount: entry.rowCount ?? 0,
      fingerprint: entry.fingerprint
    };
    await sendDiagnosticsPayload({
      ...basePayload('persistence-error'),
      persistence: summary,
      error: {
        source: 'persistence',
        name: 'PersistenceIntegrityEvent',
        message: 'Local persistence integrity event.',
        context: `${summary.store}:${summary.operation}:${summary.stage}`
      }
    });
  } catch {
    // Diagnostics never change the persistence path they observe.
  }
}

export function installClientDiagnosticsReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.setTimeout(() => {
    const report = () => {
      void reportStorageSummary('startup');
    };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(report, { timeout: STARTUP_REPORT_IDLE_TIMEOUT_MS });
    } else {
      window.setTimeout(report, 0);
    }
  }, STARTUP_REPORT_SETTLE_DELAY_MS);
  window.addEventListener('error', (event) => {
    reportClientError(event.error ?? event.message, 'window-error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, 'unhandled-rejection');
  });
  subscribeLatestPersistenceError((entry) => {
    if (entry) void reportPersistenceDiagnostic(entry);
  });
}
