import { useState } from 'react';
import type { MissingCollaboratorIncident } from '../../../app/collection/collaboratorRecoveryPlan';
import { useI18n } from '../../../i18n';
import type { Persona } from '../../../types/domain';
import { Icon } from '../../Icon';
import { runImpactAction, runSelectionAction } from '../../haptics';

type MissingCollaboratorRecoveryPanelProps = {
  incidents: MissingCollaboratorIncident[];
  personas: Persona[];
  busyCollaboratorId: string | null;
  onRestore: (collaboratorId: string) => void;
  onRebuild: (collaboratorId: string, name: string) => void;
  onReassign: (sourceCollaboratorId: string, targetCollaboratorId: string) => void;
};

type OpenAction = { collaboratorId: string; kind: 'rebuild' | 'reassign' } | null;

export function MissingCollaboratorRecoveryPanel({
  incidents,
  personas,
  busyCollaboratorId,
  onRestore,
  onRebuild,
  onReassign
}: MissingCollaboratorRecoveryPanelProps) {
  const { t, formatNumber } = useI18n();
  const [openAction, setOpenAction] = useState<OpenAction>(null);
  const [nameDraftById, setNameDraftById] = useState<Record<string, string>>({});
  const [targetById, setTargetById] = useState<Record<string, string>>({});

  if (incidents.length === 0) return null;

  return (
    <section className="missing-collaborator-recovery" aria-label={t('collaborator.recovery.aria')}>
      <div className="missing-collaborator-recovery-lead">
        <span className="missing-collaborator-recovery-mark" aria-hidden="true">
          <Icon name="inbox" size={15} />
        </span>
        <div>
          <strong>{t('collaborator.recovery.title')}</strong>
          <p>{t('collaborator.recovery.help')}</p>
        </div>
      </div>

      <div className="missing-collaborator-recovery-list">
        {incidents.map((incident) => {
          const busy = busyCollaboratorId === incident.collaboratorId;
          const action = openAction?.collaboratorId === incident.collaboratorId ? openAction.kind : null;
          const evidence = incident.evidence;
          const canRestore = evidence.mode === 'reload';
          const canRebuild = evidence.mode === 'rebuild';
          const targetId = targetById[incident.collaboratorId] ?? personas[0]?.id ?? '';
          const displayName = incident.snapshotName || t('collaborator.recovery.unknownName');
          const evidenceText = evidence.mode === 'checking'
            ? t('collaborator.recovery.checking')
            : evidence.mode === 'reload'
                ? t('collaborator.recovery.reloadReady')
                : evidence.mode === 'rebuild'
                  ? t('collaborator.recovery.rebuildReady')
                  : t('collaborator.recovery.blocked');

          return (
            <article className="missing-collaborator-recovery-card" key={incident.collaboratorId}>
              <div className="missing-collaborator-recovery-copy">
                <strong>{displayName}</strong>
                <span>{t('collaborator.recovery.chatCount', {
                  count: formatNumber(incident.conversationCount)
                })}</span>
                <small>{evidenceText}</small>
              </div>
              <div className="missing-collaborator-recovery-actions">
                {canRestore ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || busyCollaboratorId !== null}
                    onClick={(event) => runImpactAction(
                      () => onRestore(incident.collaboratorId),
                      { element: event.currentTarget }
                    )}
                  >
                    {busy ? t('collaborator.recovery.working') : t('collaborator.recovery.restore')}
                  </button>
                ) : null}
                {canRebuild ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || busyCollaboratorId !== null}
                    onClick={(event) => runSelectionAction(() => setOpenAction(
                      action === 'rebuild' ? null : { collaboratorId: incident.collaboratorId, kind: 'rebuild' }
                    ), { element: event.currentTarget })}
                  >
                    {t('collaborator.recovery.rebuild')}
                  </button>
                ) : null}
                {personas.length > 0 ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || busyCollaboratorId !== null}
                    onClick={(event) => runSelectionAction(() => setOpenAction(
                      action === 'reassign' ? null : { collaboratorId: incident.collaboratorId, kind: 'reassign' }
                    ), { element: event.currentTarget })}
                  >
                    {t('collaborator.recovery.reassign')}
                  </button>
                ) : null}
              </div>

              {action === 'rebuild' ? (
                <div className="missing-collaborator-recovery-form">
                  <input
                    value={nameDraftById[incident.collaboratorId] ?? ''}
                    placeholder={t('collaborator.recovery.namePlaceholder')}
                    autoFocus
                    onChange={(event) => setNameDraftById((current) => ({
                      ...current,
                      [incident.collaboratorId]: event.target.value
                    }))}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !(nameDraftById[incident.collaboratorId] ?? '').trim()}
                    onClick={(event) => runImpactAction(() => onRebuild(
                      incident.collaboratorId,
                      nameDraftById[incident.collaboratorId] ?? ''
                    ), { element: event.currentTarget })}
                  >
                    {t('collaborator.recovery.confirmRebuild')}
                  </button>
                </div>
              ) : null}

              {action === 'reassign' ? (
                <div className="missing-collaborator-recovery-form">
                  <select
                    value={targetId}
                    onChange={(event) => setTargetById((current) => ({
                      ...current,
                      [incident.collaboratorId]: event.target.value
                    }))}
                  >
                    {personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>{persona.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !targetId}
                    onClick={(event) => runImpactAction(
                      () => onReassign(incident.collaboratorId, targetId),
                      { element: event.currentTarget }
                    )}
                  >
                    {t('collaborator.recovery.confirmReassign')}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
