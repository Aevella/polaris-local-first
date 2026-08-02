import type { PersistenceReadFailureNoticeState } from './usePersistenceReadFailureNotice';
import { useI18n } from '../../i18n';

type PersistenceReadFailureNoticeProps = {
  notice: PersistenceReadFailureNoticeState;
  onRetry: () => void;
  onOpenBackup: () => void;
};

export function PersistenceReadFailureNotice({
  notice,
  onRetry,
  onOpenBackup
}: PersistenceReadFailureNoticeProps) {
  const { t } = useI18n();
  if (!notice.visible) return null;
  const blockedStores = notice.blockedStores.join(t('settings.storage.listSeparator'));
  const isolated = notice.reason === 'isolated-row';

  return (
    <aside className="persistence-read-failure-notice" role="alert" aria-live="assertive">
      <div className="persistence-read-failure-notice__body">
        <strong>{t(isolated ? 'app.persistence.isolatedTitle' : 'app.persistence.title')}</strong>
        <p>
          {t(isolated ? 'app.persistence.isolatedBody' : 'app.persistence.body', { stores: blockedStores })}
        </p>
        {!isolated && notice.error ? <span>{t('app.persistence.errorDetails', { message: notice.error.message })}</span> : null}
      </div>
      <div className="persistence-read-failure-notice__actions">
        <button type="button" onClick={onRetry}>
          {t(isolated ? 'app.persistence.rescan' : 'app.persistence.retry')}
        </button>
        <button type="button" className="primary" onClick={onOpenBackup}>
          {t('app.persistence.openBackup')}
        </button>
      </div>
    </aside>
  );
}
