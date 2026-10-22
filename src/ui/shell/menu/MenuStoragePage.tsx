import type { LocalDataHealthSnapshot } from '../../../infrastructure/localDataHealth';
import type { LocalRuntimeLogEntry } from '../../../app/shell/localRuntimeLog';
import { HelpHint } from '../../HelpHint';
import { Icon } from '../../Icon';
import { MenuSheetItem } from './MenuSheetItem';
import { useI18n, type I18nTranslator } from '../../../i18n';

type MenuStoragePageProps = {
  snapshot: LocalDataHealthSnapshot | null;
  error: string | null;
  runtimeLogEntries: LocalRuntimeLogEntry[];
  refreshing: boolean;
  clearingDiagnostics: boolean;
  clearingConversationAttachments: boolean;
  clearingOrphanAssets: boolean;
  clearingRedundantPreviews: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onClearDiagnostics: () => void;
  onClearOrphanAssets: () => void;
  onClearConversationAttachmentCopies: () => void;
  onClearRedundantAssetPreviews: () => void;
};

type StorageCopy = Pick<I18nTranslator, 'formatNumber' | 'language' | 't'>;

function formatBytes(bytes: number, copy: StorageCopy) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${copy.formatNumber(value, { maximumFractionDigits: value >= 10 ? 1 : 2 })} ${units[unitIndex]}`;
}

function formatGeneratedAt(value: number, copy: StorageCopy) {
  return new Date(value).toLocaleString(copy.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatStorageSummary(snapshot: LocalDataHealthSnapshot) {
  return `${snapshot.storage.label} · ${snapshot.storage.detail}`;
}

function formatStorageSafetySummary(snapshot: LocalDataHealthSnapshot, copy: StorageCopy) {
  const { t, formatNumber } = copy;
  const issues: string[] = [];
  const chat = snapshot.chatPersistence;
  const report = snapshot.censusReport;
  const totals = report.totals;

  if (!chat.hasCommitPointer || (chat.hasCommitPointer && !chat.hasCurrentManifest)) {
    issues.push(t('settings.storage.issueChatPreparing'));
  }
  if (chat.quarantinedConversationCount > 0) {
    issues.push(t('settings.storage.issueQuarantinedChats', { count: formatNumber(chat.quarantinedConversationCount) }));
  }
  if (totals.missingBodyObjectCount > 0) {
    issues.push(t('settings.storage.issueMissingBodies', { count: formatNumber(totals.missingBodyObjectCount) }));
  }
  if (totals.unresolvedOwnerObjectCount + totals.danglingOwnerObjectCount > 0) {
    issues.push(t('settings.storage.issueOwners', { count: formatNumber(totals.unresolvedOwnerObjectCount + totals.danglingOwnerObjectCount) }));
  }
  if (totals.missingAssetMetaRefCount + totals.missingAssetBinaryRefCount > 0) {
    issues.push(t('settings.storage.issueMissingAssets', { count: formatNumber(totals.missingAssetMetaRefCount + totals.missingAssetBinaryRefCount) }));
  }
  const sourceIssues = snapshot.domainSources
    .filter((domain) => domain.issueCount > 0)
    .map((domain) => `${domain.label} ${formatNumber(domain.issueCount)}`);
  if (sourceIssues.length > 0) {
    issues.push(t('settings.storage.issueDomainSources', { issues: sourceIssues.join(t('settings.storage.listSeparator')) }));
  }

  if (issues.length === 0) return t('settings.storage.noBlockingIssues');
  return issues.join(t('settings.storage.issueSeparator'));
}

export function MenuStoragePage({
  snapshot,
  error,
  runtimeLogEntries,
  refreshing,
  clearingDiagnostics,
  clearingConversationAttachments,
  clearingOrphanAssets,
  clearingRedundantPreviews,
  onBack,
  onRefresh,
  onClearDiagnostics,
  onClearOrphanAssets,
  onClearConversationAttachmentCopies,
  onClearRedundantAssetPreviews
}: MenuStoragePageProps) {
  const copy = useI18n();
  const { t, formatNumber } = copy;
  const diagnostics = snapshot?.buckets.find((bucket) => bucket.id === 'diagnostics') ?? null;
  const assets = snapshot?.buckets.find((bucket) => bucket.id === 'assets') ?? null;
  const isMaintenanceBusy =
    refreshing
    || clearingDiagnostics
    || clearingConversationAttachments
    || clearingOrphanAssets
    || clearingRedundantPreviews;

  return (
    <div className="menu-sheet-page">
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title">
          <small>{t('settings.storage.sectionData')}</small>
          <h2>
            {t('settings.storage.title')}
            <HelpHint
              className="help-hint--inline-title"
              label={t('settings.storage.title')}
              text={t('settings.storage.helpText')}
            />
          </h2>
          <p>
            {error
              ? t('settings.storage.unreadable')
              : snapshot
              ? t('settings.storage.estimatedTotal', {
                  size: formatBytes(snapshot.totalBytes, copy),
                  time: formatGeneratedAt(snapshot.generatedAt, copy)
                })
              : t('settings.storage.loadingSummary')}
          </p>
          {snapshot && !error ? <p>{formatStorageSummary(snapshot)}</p> : null}
          {refreshing ? (
            <div className="settings-note">
              {t('settings.storage.refreshingNotice')}
            </div>
          ) : null}
        </div>
      </div>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker">{t('settings.storage.compositionSection')}</span>
          <p className="menu-section-note">{t('settings.storage.compositionNote')}</p>
        </div>
        {snapshot ? (
          <details className="settings-note local-data-health-plain-summary">
            <summary>{t('settings.storage.diagnosticDetails')}</summary>
            <p>{formatStorageSafetySummary(snapshot, copy)}</p>
          </details>
        ) : null}
        <div className="usage-entry-list">
          {(snapshot?.buckets ?? []).map((bucket) => (
            <div className="usage-entry-row" key={bucket.id}>
              <div className="usage-entry-head">
                <strong>{bucket.label}</strong>
                <span>{formatBytes(bucket.bytes, copy)} · {t('settings.storage.entryCount', { count: formatNumber(bucket.entryCount) })}</span>
              </div>
            </div>
          ))}
          {!snapshot ? (
            <div className="settings-note">
              {error
                ? t('settings.storage.connectionError', { error })
                : t('settings.storage.readingSizes')}
            </div>
          ) : null}
        </div>
      </section>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker">{t('settings.storage.maintenanceSection')}</span>
          <p className="menu-section-note">{t('settings.storage.maintenanceNote')}</p>
        </div>
        <MenuSheetItem
          icon="search"
          title={refreshing ? t('settings.storage.refreshing') : t('settings.storage.refresh')}
          detail={t('settings.storage.refreshDetail')}
          onClick={onRefresh}
          disabled={isMaintenanceBusy}
        />
        <MenuSheetItem
          icon="trash"
          title={clearingOrphanAssets ? t('settings.storage.orphanChecking') : t('settings.storage.clearOrphanAssets')}
          detail={
            clearingOrphanAssets
              ? t('settings.storage.orphanScanningDetail')
              : assets && assets.bytes > 0
                ? t('settings.storage.orphanReadyDetail')
                : t('settings.storage.noAssetData')
          }
          helpText={t('settings.storage.orphanHelp')}
          onClick={onClearOrphanAssets}
          disabled={isMaintenanceBusy || !assets || assets.bytes === 0}
        />
        <MenuSheetItem
          icon="trash"
          title={clearingRedundantPreviews ? t('settings.storage.clearing') : t('settings.storage.clearRedundantPreviews')}
          detail={assets && assets.bytes > 0 ? t('settings.storage.redundantPreviewsDetail') : t('settings.storage.noAssetData')}
          helpText={t('settings.storage.redundantPreviewsHelp')}
          onClick={onClearRedundantAssetPreviews}
          disabled={isMaintenanceBusy || !assets || assets.bytes === 0}
        />
        <MenuSheetItem
          icon="trash"
          title={clearingConversationAttachments ? t('settings.storage.clearing') : t('settings.storage.clearConversationAttachments')}
          detail={assets && assets.bytes > 0 ? t('settings.storage.conversationAttachmentsDetail', { size: formatBytes(assets.bytes, copy) }) : t('settings.storage.noAssetData')}
          helpText={t('settings.storage.conversationAttachmentsHelp')}
          onClick={onClearConversationAttachmentCopies}
          disabled={isMaintenanceBusy || !assets || assets.bytes === 0}
        />
        <MenuSheetItem
          icon="copy"
          title={clearingDiagnostics ? t('settings.storage.clearing') : t('settings.storage.clearDiagnostics')}
          detail={diagnostics && diagnostics.bytes > 0
            ? t('settings.storage.diagnosticsDetail', {
                size: formatBytes(diagnostics.bytes, copy),
                count: formatNumber(diagnostics.entryCount)
              })
            : t('settings.storage.noDiagnostics')}
          helpText={t('settings.storage.diagnosticsHelp')}
          onClick={onClearDiagnostics}
          disabled={isMaintenanceBusy || !diagnostics || diagnostics.bytes === 0}
        />
      </section>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker">{t('settings.storage.runtimeLogSection')}</span>
          <p className="menu-section-note">{t('settings.storage.runtimeLogNote')}</p>
        </div>
        <div className="usage-entry-list">
          {runtimeLogEntries.map((entry) => (
            <div className="usage-entry-row" key={entry.id}>
              <div className="usage-entry-head">
                <strong>{entry.source} · {entry.title}</strong>
                <span>{formatGeneratedAt(entry.at, copy)} · {entry.detail}</span>
              </div>
            </div>
          ))}
          {runtimeLogEntries.length === 0 ? (
            <div className="settings-note">
              {t('settings.storage.runtimeLogEmpty')}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
