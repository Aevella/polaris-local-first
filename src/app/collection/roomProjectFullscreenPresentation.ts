import type { RoomProjectFullscreenInput } from './useRoomProjectFullscreenController';
import type { PolarisCompanionConnection } from '../../types/domain';
import type { useI18n } from '../../i18n';
import type { ResolvedRoomProjectFile } from '../../engines/roomProjects';
import type { WorkspaceReferenceDoc } from '../../types/domain';
import type { DesktopLocalCommandSession } from '../../desktop/localHost';

type ComputerWorkspaceStatusTone = 'online' | 'waiting' | 'offline' | 'error';

const COMPANION_WORKSPACE_STATUS_ONLINE_WINDOW_MS = 30 * 1000;

function formatComputerStatusAge(timestamp: number | null, language: string, fallback: string) {
  if (!timestamp) return fallback;
  const elapsedMs = Date.now() - timestamp;
  const absMs = Math.abs(elapsedMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 60 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000]
  ];
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const [unit, unitMs] of units) {
    if (absMs >= unitMs) {
      const divisor = unit === 'month' ? 30 * 24 * 60 * 60 * 1000 : unitMs;
      return formatter.format(Math.round(-elapsedMs / divisor), unit);
    }
  }
  return fallback;
}

/** Derive display data from explicit workspace and host facts; no store or bridge reads. */
export function buildRoomProjectFullscreenPresentation({
  importingFiles,
  t,
  importingReferences,
  files,
  conversations,
  referenceDocs,
  previewStateReadEnabled,
  project,
  companionConnections,
  desktopLocalAvailable,
  language,
  desktopCommandResult,
  desktopCommandSessions
}: Pick<
  RoomProjectFullscreenInput,
  'files' | 'conversations' | 'referenceDocs' | 'project' | 'desktopCommandResult' | 'desktopCommandSessions'
> & {
  t: ReturnType<typeof useI18n>['t'];
  language: string;
  desktopLocalAvailable: boolean;
  companionConnections: PolarisCompanionConnection[];
  previewStateReadEnabled: boolean;
  importingFiles: boolean;
  importingReferences: boolean;
}) {
  const importAccept = '.html,.htm,.css,.js,.ts,.tsx,.jsx,.json,.md,.txt,text/*';

  const importLabel = importingFiles ? t('collection.workspace.importingFiles') : t('collection.workspace.importFiles');

  const referenceImportLabel = importingReferences
    ? t('collection.workspace.importingReferences')
    : t('collection.workspace.importReferences');

  const projectMetaLabel = t('collection.workspace.metaLabel', {
    files: files.length,
    conversations: conversations.length,
    references: referenceDocs.length
  });

  const entryFile = files.find((file) => file.isEntry) ?? files.find((file) => file.role === 'entry') ?? null;

  const previewStateAccessLabel = previewStateReadEnabled
    ? t('collection.workspace.previewAccessEnabledBadge')
    : t('collection.workspace.previewAccessDisabledBadge');

  const desktopBinding = project.desktopBinding;

  const latestCompanionConnection =
    [...companionConnections].sort(
      (a, b) => (b.lastSnapshotAt ?? b.createdAt) - (a.lastSnapshotAt ?? a.createdAt)
    )[0] ?? null;

  const latestCompanionSnapshotAgeMs = latestCompanionConnection?.lastSnapshotAt
    ? Date.now() - latestCompanionConnection.lastSnapshotAt
    : null;

  const latestCompanionLooksOnline =
    latestCompanionSnapshotAgeMs !== null &&
    latestCompanionSnapshotAgeMs >= 0 &&
    latestCompanionSnapshotAgeMs <= COMPANION_WORKSPACE_STATUS_ONLINE_WINDOW_MS;

  const companionSeenLabelKey = latestCompanionLooksOnline
    ? 'settings.desktopLocal.workspaceStatusCompanionOnline'
    : 'settings.desktopLocal.workspaceStatusCompanionSeen';

  const computerStatus: { tone: ComputerWorkspaceStatusTone; label: string } = desktopLocalAvailable
    ? {
        tone: 'online',
        label: desktopBinding
          ? t('settings.desktopLocal.workspaceStatusMacBound')
          : t('settings.desktopLocal.workspaceStatusMacOnline')
      }
    : latestCompanionConnection
      ? latestCompanionConnection.lastError
        ? {
            tone: 'error',
            label: t('settings.desktopLocal.workspaceStatusCompanionError')
          }
        : {
            tone: latestCompanionLooksOnline
              ? 'online'
              : latestCompanionConnection.lastSnapshotAt
                ? 'offline'
                : 'waiting',
            label: latestCompanionConnection.lastSnapshotAt
              ? t(companionSeenLabelKey, {
                  time: formatComputerStatusAge(
                    latestCompanionConnection.lastSnapshotAt,
                    language,
                    t('settings.desktopLocal.workspaceStatusJustNow')
                  )
                })
              : t('settings.desktopLocal.workspaceStatusCompanionWaiting')
          }
      : {
          tone: 'offline',
          label: t('settings.desktopLocal.workspaceStatusNoComputer')
        };

  const desktopSyncedLabel = desktopBinding
    ? new Intl.DateTimeFormat(language, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(desktopBinding.syncedAt))
    : null;

  const commandResult = desktopCommandResult?.result ?? null;

  const sortedCommandSessions = [...desktopCommandSessions].sort((a, b) => b.startedAt - a.startedAt);

  const activeCommandSession =
    sortedCommandSessions.find((session) => session.status === 'running') ?? sortedCommandSessions[0] ?? null;

  const formatCommandSessionStatus = (session: DesktopLocalCommandSession) => {
    if (session.status === 'running')
      return t('settings.desktopLocal.commandStatusRunning', { duration: session.durationMs });
    if (session.status === 'failed')
      return t('settings.desktopLocal.commandStatusFailed', { duration: session.durationMs });
    return t('settings.desktopLocal.commandStatusExit', {
      code: session.exitCode ?? session.signal ?? 0,
      duration: session.durationMs
    });
  };

  const commandOutput = activeCommandSession
    ? [
        `$ ${activeCommandSession.command} ${activeCommandSession.args.join(' ')}`.trim(),
        formatCommandSessionStatus(activeCommandSession),
        activeCommandSession.stdout,
        activeCommandSession.stderr
      ]
        .filter(Boolean)
        .join('\n')
    : commandResult
      ? [
          `$ ${commandResult.command} ${commandResult.args.join(' ')}`.trim(),
          t('settings.desktopLocal.commandStatusExit', {
            code: commandResult.exitCode ?? commandResult.signal ?? 0,
            duration: commandResult.durationMs
          }),
          commandResult.stdout,
          commandResult.stderr
        ]
          .filter(Boolean)
          .join('\n')
      : (desktopCommandResult?.error ?? null);

  const describeFileMeta = (file: ResolvedRoomProjectFile) => {
    const languageLabel = file.language.toUpperCase();
    if (file.isEntry) return t('collection.workspace.fileMetaRunEntry', { language: languageLabel });
    if (file.role === 'entry') return t('collection.workspace.fileMetaEntryRole', { language: languageLabel });
    if (file.role) return `${file.role} · ${languageLabel}`;
    return languageLabel;
  };

  const summarizeReferenceDoc = (doc: WorkspaceReferenceDoc) => {
    const summary = doc.summary.trim();
    if (summary) return summary;
    const content = doc.contentLoaded ? doc.content.trim().replace(/\s+/g, ' ') : '';
    return content ? content.slice(0, 64) : t('collection.workspace.referenceFallbackSummary');
  };
  return {
    importAccept,
    importLabel,
    referenceImportLabel,
    projectMetaLabel,
    entryFile,
    previewStateAccessLabel,
    desktopBinding,
    latestCompanionConnection,
    latestCompanionSnapshotAgeMs,
    latestCompanionLooksOnline,
    companionSeenLabelKey,
    computerStatus,
    desktopSyncedLabel,
    commandResult,
    sortedCommandSessions,
    activeCommandSession,
    formatCommandSessionStatus,
    commandOutput,
    describeFileMeta,
    summarizeReferenceDoc
  };
}
