import JSZip from 'jszip';
import { KNOWN_BUNDLED_PERSONA_IDS } from '../../config/persona/personaBuilder';
import {
  buildChatMigrationDryRunReport,
  type ChatMigrationDryRunChatState,
  type ChatMigrationDryRunReport
} from './chatMigrationDryRun';

type ExportManifest = {
  stores?: {
    chat?: string;
    persona?: string;
    runtime?: string;
  };
  assets?: {
    index?: string;
  };
};

type ExportAssetIndexEntry = {
  id: string;
};

type ExportPersona = {
  id?: unknown;
};

type ExportCompanionConnection = {
  collaboratorId?: unknown;
};

export async function buildChatMigrationDryRunReportFromExportZipBuffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<ChatMigrationDryRunReport> {
  const zip = await JSZip.loadAsync(buffer);
  const manifest = parseExportManifest(await readRequiredZipText(zip, 'manifest.json'));
  const chatPath = manifest.stores?.chat ?? 'stores/chat.json';
  const personaPath = manifest.stores?.persona ?? 'stores/persona.json';
  const runtimePath = manifest.stores?.runtime ?? 'stores/runtime.json';
  const assetIndexPath = manifest.assets?.index ?? 'assets/index.json';
  const chatState = parseExportChatState(await readRequiredZipText(zip, chatPath));
  const knownCollaboratorIds = await readKnownCollaboratorIds(zip, personaPath, runtimePath);
  const assetIndexIds = await readOptionalAssetIndexIds(zip, assetIndexPath);

  return await buildChatMigrationDryRunReport({
    chatState,
    assetIndexIds,
    knownCollaboratorIds
  });
}

export function formatChatMigrationDryRunReport(report: ChatMigrationDryRunReport) {
  return [
    `ok: ${report.ok ? 'true' : 'false'}`,
    `conversations: ${report.summary.conversationCount}`,
    `messages: ${report.summary.messageCount}`,
    `activeConversationRecovered: ${report.summary.activeConversationRecovered}`,
    `stagingHydrated: ${report.projection.stagingHydrated}`,
    `promotionReady: ${report.projection.promotionReady}`,
    `activeObjects: ${report.projection.activeObjectCount}`,
    `quarantinedObjects: ${report.projection.quarantinedObjectCount}`,
    `duplicateObjectIds: ${report.projection.duplicateObjectIdCount}`,
    `missingActiveCollaborators: ${report.projection.missingActiveCollaboratorIdCount}`,
    `fieldMismatches: ${report.mismatches.durableFieldMismatchCount}`,
    `messageCountMismatches: ${report.mismatches.messageCountMismatchCount}`,
    `latestTimestampMismatches: ${report.mismatches.latestTimestampMismatchCount}`,
    `assetRefs: referenced=${report.assetRefs.referencedAssetCount} projected=${report.assetRefs.projectedAssetRefCount} assetIndex=${report.assetRefs.assetIndexCount} missing=${report.assetRefs.missingAssetRefCount}`,
    ...(report.projection.promotionError ? [`promotionError: ${report.projection.promotionError}`] : [])
  ].join('\n');
}

async function readOptionalPersonaIds(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) return [];
  const value = JSON.parse(await file.async('string')) as { personas?: ExportPersona[] };
  if (!Array.isArray(value.personas)) return [];
  return value.personas
    .map((persona) => persona.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .sort();
}

async function readKnownCollaboratorIds(zip: JSZip, personaPath: string, runtimePath: string) {
  return Array.from(new Set([
    ...KNOWN_BUNDLED_PERSONA_IDS,
    ...await readOptionalPersonaIds(zip, personaPath),
    ...await readOptionalRuntimeCompanionCollaboratorIds(zip, runtimePath)
  ])).sort();
}

async function readOptionalRuntimeCompanionCollaboratorIds(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) return [];
  const value = JSON.parse(await file.async('string')) as { companionConnections?: ExportCompanionConnection[] };
  if (!Array.isArray(value.companionConnections)) return [];
  return value.companionConnections
    .map((connection) => connection.collaboratorId)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .sort();
}

async function readRequiredZipText(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`Export package is missing ${path}`);
  return await file.async('string');
}

async function readOptionalAssetIndexIds(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) return [];
  const entries = JSON.parse(await file.async('string')) as ExportAssetIndexEntry[];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

function parseExportManifest(text: string): ExportManifest {
  const value = JSON.parse(text) as ExportManifest & { format?: string; version?: number };
  if (value.format !== 'polaris-export' || value.version !== 1) {
    throw new Error('Export package is not a Polaris export v1 package.');
  }
  return value;
}

function parseExportChatState(text: string): ChatMigrationDryRunChatState {
  const value = JSON.parse(text) as ChatMigrationDryRunChatState;
  if (!Array.isArray(value.conversations)) {
    throw new Error('Export chat state is missing conversations.');
  }
  return {
    conversations: value.conversations,
    activeConversationId: typeof value.activeConversationId === 'string' ? value.activeConversationId : null
  };
}
