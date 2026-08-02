export type ClientDiagnosticsEventKind =
  | 'startup'
  | 'storage-summary'
  | 'persistence-error'
  | 'window-error'
  | 'unhandled-rejection';

export type ClientDiagnosticsPlatform = 'web' | 'ios' | 'android' | 'desktop' | 'unknown';

export type ClientDiagnosticsStorageSummary = {
  storageMode?: string;
  storageLabel?: string;
  kvKeyCount: number;
  kvKeyBuckets: Record<string, number>;
  assetMetaKeyCount: number;
  assetBinaryKeyCount: number;
  assetPreviewKeyCount: number;
  localStorageKeyCount: number;
  localStorageBytes: number;
};

export type ClientDiagnosticsLocalDataUsageSummary = {
  activeDataSource: 'repository' | 'unknown';
  activeDataSourceRowPresent: boolean;
  activeDomainCount: number;
  activeDomains: string[];
  repositoryKeyCount: number;
  repositoryRowCount: number;
  repositoryPointerCount: number;
  repositoryRowsByDomain: Record<string, number>;
  nonRepositoryKvKeyCount: number;
  domainSources?: ClientDiagnosticsLocalDataDomainSourceSummary[];
  collaboratorOrphans?: ClientDiagnosticsCollaboratorOrphanSummary[];
};

export type ClientDiagnosticsLocalDataDomainSourceStatus =
  | 'repository-active'
  | 'local-data-live'
  | 'repository-staged'
  | 'legacy-fallback'
  | 'ledger-only'
  | 'empty';

export type ClientDiagnosticsLocalDataDomainSourceSummary = {
  domain: string;
  status: ClientDiagnosticsLocalDataDomainSourceStatus;
  activeObjectCount: number;
  objectCount: number;
  repositoryRowCount: number;
  legacySourceCount: number;
  issueCount: number;
};

export type ClientDiagnosticsCollaboratorOrphanSummary = {
  collaboratorFingerprint: string;
  rowFingerprint: string;
  rowState: 'complete' | 'unloaded' | 'incomplete' | 'timedOut' | 'deleted' | 'missing' | 'unreadable';
  rowUpdatedAt: number | null;
  rowDeletedAt: number | null;
  repositoryRowPresent: boolean;
  personaStateHasId: boolean;
  referencedByLiveOwnerRef: boolean;
  hasOrphanMemoryBodies: boolean;
  splitMemoryBodyCount: number;
  chunkedMemoryBodyCount: number;
  chunkedMemoryBodyChunkCount: number;
};

export type ClientDiagnosticsErrorSummary = {
  source: 'window-error' | 'unhandled-rejection' | 'boundary' | 'persistence' | 'manual';
  name?: string;
  message: string;
  stack?: string;
  context?: string;
};

export type ClientDiagnosticsPersistenceSummary = {
  backend: string;
  store: string;
  domain?: string;
  operation: string;
  stage: string;
  integrity: 'complete' | 'degraded' | 'failed';
  rowCount: number;
  fingerprint?: string;
};

export type ClientDiagnosticsPayload = {
  schemaVersion: 1;
  eventId: string;
  sessionId: string;
  eventKind: ClientDiagnosticsEventKind;
  createdAt: number;
  appVersion?: string;
  platform: ClientDiagnosticsPlatform;
  channel?: string;
  urlPath?: string;
  storage?: ClientDiagnosticsStorageSummary;
  localData?: ClientDiagnosticsLocalDataUsageSummary;
  error?: ClientDiagnosticsErrorSummary;
  persistence?: ClientDiagnosticsPersistenceSummary;
};

export type ClientDiagnosticsLogEntry = ClientDiagnosticsPayload & {
  receivedAt: number;
};

const MAX_TEXT_LENGTH = 360;
const MAX_STACK_LENGTH = 1200;
const MAX_BUCKET_COUNT = 32;
const MAX_FORENSIC_STRING_LENGTH = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeUrlLikeText(value: string) {
  return value.replace(/\bhttps?:\/\/[^\s'"<>]+/gi, (match) => {
    try {
      const url = new URL(match);
      url.search = '';
      url.hash = '';
      return `${url.toString()}[redacted-url-tail]`;
    } catch {
      return '[redacted-url]';
    }
  });
}

export function sanitizeClientDiagnosticText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  const sanitized = sanitizeUrlLikeText(raw)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|rk|ak|api)[-_]?[A-Za-z0-9]{16,}\b/gi, '[redacted-token]')
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, '[redacted-long-token]')
    .replace(/data:[^,\s]+,[A-Za-z0-9+/=._-]+/gi, '[redacted-data-url]')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}…` : sanitized;
}

function normalizeString(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return undefined;
  const sanitized = sanitizeClientDiagnosticText(value, maxLength);
  return sanitized || undefined;
}

function normalizeUrlPath(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const redacted = trimmed.split(/[?#]/, 1)[0] || '/';
  return redacted.length > 180 ? `${redacted.slice(0, 180)}…` : redacted;
}

function normalizeForensicString(value: unknown, maxLength = MAX_FORENSIC_STRING_LENGTH) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return /^[a-z0-9:._%/-]+$/i.test(trimmed) ? trimmed : undefined;
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

function normalizePlatform(value: unknown): ClientDiagnosticsPlatform {
  return value === 'web'
    || value === 'ios'
    || value === 'android'
    || value === 'desktop'
    || value === 'unknown'
    ? value
    : 'unknown';
}

function normalizeEventKind(value: unknown): ClientDiagnosticsEventKind | null {
  return value === 'startup'
    || value === 'storage-summary'
    || value === 'persistence-error'
    || value === 'window-error'
    || value === 'unhandled-rejection'
    ? value
    : null;
}

function normalizeBucketCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, number]> = [];
  for (const [key, count] of Object.entries(value)) {
    if (!/^[a-z0-9:_-]{1,64}$/i.test(key) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    entries.push([key, Math.max(0, Math.round(count))]);
    if (entries.length >= MAX_BUCKET_COUNT) break;
  }
  return Object.fromEntries(entries);
}

function normalizeStorageSummary(value: unknown): ClientDiagnosticsStorageSummary | undefined {
  if (!isRecord(value)) return undefined;
  return {
    storageMode: normalizeString(value.storageMode, 80),
    storageLabel: normalizeString(value.storageLabel, 120),
    kvKeyCount: normalizeNumber(value.kvKeyCount),
    kvKeyBuckets: normalizeBucketCounts(value.kvKeyBuckets),
    assetMetaKeyCount: normalizeNumber(value.assetMetaKeyCount),
    assetBinaryKeyCount: normalizeNumber(value.assetBinaryKeyCount),
    assetPreviewKeyCount: normalizeNumber(value.assetPreviewKeyCount),
    localStorageKeyCount: normalizeNumber(value.localStorageKeyCount),
    localStorageBytes: normalizeNumber(value.localStorageBytes)
  };
}

function normalizeStringList(value: unknown, maxItems = 16) {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const item of value) {
    const normalized = normalizeString(item, 80);
    if (!normalized) continue;
    entries.push(normalized);
    if (entries.length >= maxItems) break;
  }
  return entries;
}

function normalizeLocalDataDomainList(value: unknown) {
  const allowedDomains = new Set(['asset', 'chat', 'collection', 'document', 'persona', 'runtime', 'space']);
  return normalizeStringList(value).filter((domain) => allowedDomains.has(domain));
}

function normalizeActiveDataSource(value: unknown): ClientDiagnosticsLocalDataUsageSummary['activeDataSource'] {
  return value === 'repository' ? value : 'unknown';
}

function normalizeDomainSourceStatus(value: unknown): ClientDiagnosticsLocalDataDomainSourceStatus | null {
  return value === 'repository-active'
    || value === 'local-data-live'
    || value === 'repository-staged'
    || value === 'legacy-fallback'
    || value === 'ledger-only'
    || value === 'empty'
    ? value
    : null;
}

function normalizeLocalDataDomainSourceSummary(value: unknown): ClientDiagnosticsLocalDataDomainSourceSummary | null {
  if (!isRecord(value)) return null;
  const domain = normalizeLocalDataDomainList([value.domain])[0];
  const status = normalizeDomainSourceStatus(value.status);
  if (!domain || !status) return null;
  return {
    domain,
    status,
    activeObjectCount: normalizeNumber(value.activeObjectCount),
    objectCount: normalizeNumber(value.objectCount),
    repositoryRowCount: normalizeNumber(value.repositoryRowCount),
    legacySourceCount: normalizeNumber(value.legacySourceCount),
    issueCount: normalizeNumber(value.issueCount)
  };
}

function normalizeLocalDataDomainSources(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const sources = value
    .map(normalizeLocalDataDomainSourceSummary)
    .filter((source): source is ClientDiagnosticsLocalDataDomainSourceSummary => Boolean(source))
    .slice(0, 7);
  return sources.length > 0 ? sources : undefined;
}

function normalizeCollaboratorOrphanRowState(
  value: unknown
): ClientDiagnosticsCollaboratorOrphanSummary['rowState'] | null {
  return value === 'complete'
    || value === 'unloaded'
    || value === 'incomplete'
    || value === 'timedOut'
    || value === 'deleted'
    || value === 'missing'
    || value === 'unreadable'
    ? value
    : null;
}

function normalizeCollaboratorOrphanSummary(value: unknown): ClientDiagnosticsCollaboratorOrphanSummary | null {
  if (!isRecord(value)) return null;
  const collaboratorFingerprint = normalizeForensicString(value.collaboratorFingerprint);
  const rowFingerprint = normalizeForensicString(value.rowFingerprint);
  const rowState = normalizeCollaboratorOrphanRowState(value.rowState);
  if (!collaboratorFingerprint?.startsWith('anon-') || !rowFingerprint?.startsWith('anon-') || !rowState) return null;
  return {
    collaboratorFingerprint,
    rowFingerprint,
    rowState,
    rowUpdatedAt: normalizeOptionalNumber(value.rowUpdatedAt),
    rowDeletedAt: normalizeOptionalNumber(value.rowDeletedAt),
    repositoryRowPresent: value.repositoryRowPresent === true,
    personaStateHasId: value.personaStateHasId === true,
    referencedByLiveOwnerRef: value.referencedByLiveOwnerRef === true,
    hasOrphanMemoryBodies: value.hasOrphanMemoryBodies === true,
    splitMemoryBodyCount: normalizeNumber(value.splitMemoryBodyCount),
    chunkedMemoryBodyCount: normalizeNumber(value.chunkedMemoryBodyCount),
    chunkedMemoryBodyChunkCount: normalizeNumber(value.chunkedMemoryBodyChunkCount)
  };
}

function normalizeCollaboratorOrphans(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const orphans = value
    .map(normalizeCollaboratorOrphanSummary)
    .filter((orphan): orphan is ClientDiagnosticsCollaboratorOrphanSummary => Boolean(orphan));
  return orphans.length > 0 ? orphans : undefined;
}

function normalizeLocalDataUsageSummary(value: unknown): ClientDiagnosticsLocalDataUsageSummary | undefined {
  if (!isRecord(value)) return undefined;
  const domainSources = normalizeLocalDataDomainSources(value.domainSources);
  const collaboratorOrphans = normalizeCollaboratorOrphans(value.collaboratorOrphans);
  return {
    activeDataSource: normalizeActiveDataSource(value.activeDataSource),
    activeDataSourceRowPresent: value.activeDataSourceRowPresent === true,
    activeDomainCount: normalizeNumber(value.activeDomainCount),
    activeDomains: normalizeLocalDataDomainList(value.activeDomains),
    repositoryKeyCount: normalizeNumber(value.repositoryKeyCount),
    repositoryRowCount: normalizeNumber(value.repositoryRowCount),
    repositoryPointerCount: normalizeNumber(value.repositoryPointerCount),
    repositoryRowsByDomain: normalizeBucketCounts(value.repositoryRowsByDomain),
    nonRepositoryKvKeyCount: normalizeNumber(value.nonRepositoryKvKeyCount),
    ...(domainSources ? { domainSources } : {}),
    ...(collaboratorOrphans ? { collaboratorOrphans } : {})
  };
}

function normalizeErrorSummary(value: unknown): ClientDiagnosticsErrorSummary | undefined {
  if (!isRecord(value)) return undefined;
  const source = value.source === 'window-error'
    || value.source === 'unhandled-rejection'
    || value.source === 'boundary'
    || value.source === 'persistence'
    || value.source === 'manual'
    ? value.source
    : 'manual';
  const message = sanitizeClientDiagnosticText(value.message);
  if (!message) return undefined;
  return {
    source,
    name: normalizeString(value.name, 120),
    message,
    stack: normalizeString(value.stack, MAX_STACK_LENGTH),
    context: normalizeString(value.context, 240)
  };
}

function normalizePersistenceSummary(value: unknown): ClientDiagnosticsPersistenceSummary | undefined {
  if (!isRecord(value)) return undefined;
  const backend = normalizeForensicString(value.backend, 120);
  const store = normalizeForensicString(value.store, 64);
  const operation = normalizeForensicString(value.operation, 80);
  const stage = normalizeForensicString(value.stage, 80);
  const integrity = value.integrity === 'complete' || value.integrity === 'degraded' || value.integrity === 'failed'
    ? value.integrity
    : null;
  const domain = normalizeLocalDataDomainList([value.domain])[0];
  const fingerprint = normalizeForensicString(value.fingerprint, 80);
  if (!backend || !store || !operation || !stage || !integrity) return undefined;
  return {
    backend,
    store,
    operation,
    stage,
    integrity,
    rowCount: normalizeNumber(value.rowCount),
    ...(domain ? { domain } : {}),
    ...(fingerprint?.startsWith('anon-') ? { fingerprint } : {})
  };
}

export function normalizeClientDiagnosticsPayload(
  value: unknown,
  receivedAt = Date.now()
): ClientDiagnosticsLogEntry | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const eventKind = normalizeEventKind(value.eventKind);
  const eventId = normalizeString(value.eventId, 120);
  const sessionId = normalizeString(value.sessionId, 120);
  if (!eventKind || !eventId || !sessionId) return null;
  const storage = normalizeStorageSummary(value.storage);
  const localData = normalizeLocalDataUsageSummary(value.localData);
  const error = normalizeErrorSummary(value.error);
  const persistence = normalizePersistenceSummary(value.persistence);
  if ((eventKind === 'storage-summary' || eventKind === 'startup') && !storage) return null;
  if ((eventKind === 'window-error' || eventKind === 'unhandled-rejection') && !error) return null;
  if (eventKind === 'persistence-error' && (!error || !persistence)) return null;

  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    eventKind,
    createdAt: normalizeNumber(value.createdAt) || receivedAt,
    appVersion: normalizeString(value.appVersion, 80),
    platform: normalizePlatform(value.platform),
    channel: normalizeString(value.channel, 80),
    urlPath: normalizeUrlPath(value.urlPath),
    ...(storage ? { storage } : {}),
    ...(localData ? { localData } : {}),
    ...(error ? { error } : {}),
    ...(persistence ? { persistence } : {}),
    receivedAt
  };
}

export function formatClientDiagnosticsLog(entry: ClientDiagnosticsLogEntry) {
  return `[polaris-client-diagnostics] ${JSON.stringify(entry)}`;
}
