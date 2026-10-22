import { Icon } from '../../Icon';
import { runImpactAction } from '../../haptics';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  | 'desktopLocalAvailable'
  | 't'
  | 'onOpenDesktopLocalSettings'
  | 'desktopBinding'
  | 'desktopSyncedLabel'
  | 'desktopLocalBusy'
  | 'onInspectProjectChanges'
  | 'project'
  | 'onSyncProjectFromDisk'
  | 'onSyncProjectToDisk'
  | 'desktopLocalStatus'
  | 'desktopLocalStatusTone'
  | 'onRunDesktopProjectCommand'
  | 'activeCommandSession'
  | 'onStopDesktopProjectCommand'
  | 'desktopCommandBusy'
  | 'desktopCommand'
  | 'onDesktopCommandChange'
  | 'desktopCommandArgs'
  | 'onDesktopCommandArgsChange'
  | 'commandOutput'
  | 'desktopCommandResult'
>;

export function RoomProjectDesktopSection(props: Props) {
  const {
    desktopLocalAvailable,
    t,
    onOpenDesktopLocalSettings,
    desktopBinding,
    desktopSyncedLabel,
    desktopLocalBusy,
    onInspectProjectChanges,
    project,
    onSyncProjectFromDisk,
    onSyncProjectToDisk,
    desktopLocalStatus,
    desktopLocalStatusTone,
    onRunDesktopProjectCommand,
    activeCommandSession,
    onStopDesktopProjectCommand,
    desktopCommandBusy,
    desktopCommand,
    onDesktopCommandChange,
    desktopCommandArgs,
    onDesktopCommandArgsChange,
    commandOutput,
    desktopCommandResult
  } = props;
  return desktopLocalAvailable ? (
    <section className="room-project-fullscreen-section room-project-fullscreen-section--desktop-local">
      <div className="room-project-fullscreen-section-head">
        <span className="room-project-fullscreen-section-label">
          <Icon name="compass" size={13} />
          <strong>{t('settings.desktopLocal.projectSectionTitle')}</strong>
        </span>
        <span className="room-project-fullscreen-section-tools">
          <button
            type="button"
            className="room-project-section-action"
            onClick={(event) => {
              runImpactAction(onOpenDesktopLocalSettings, { element: event.currentTarget });
            }}
          >
            <Icon name="settings" size={11} />
            <span>{desktopBinding ? t('settings.desktopLocal.manage') : t('settings.desktopLocal.connect')}</span>
          </button>
        </span>
      </div>
      <div className={`room-project-desktop-local-card ${desktopBinding ? 'bound' : 'unbound'}`}>
        <button
          type="button"
          className="room-project-desktop-local-main"
          onClick={(event) => {
            runImpactAction(onOpenDesktopLocalSettings, { element: event.currentTarget });
          }}
        >
          <span className="room-project-desktop-local-icon" aria-hidden="true">
            <Icon name={desktopBinding ? 'check' : 'folder'} size={14} />
          </span>
          <span className="room-project-desktop-local-copy">
            <strong>{desktopBinding ? desktopBinding.rootLabel : t('settings.desktopLocal.notConnected')}</strong>
            <small>
              {desktopBinding
                ? t('settings.desktopLocal.projectBoundDetail', {
                    entry: desktopBinding.entryFilePath,
                    time: desktopSyncedLabel ?? ''
                  })
                : t('settings.desktopLocal.notConnectedDetail')}
            </small>
          </span>
        </button>
        {desktopBinding ? (
          <div className="room-project-desktop-local-actions">
            <button
              type="button"
              className="room-project-desktop-local-action"
              disabled={desktopLocalBusy}
              onClick={(event) => {
                runImpactAction(() => onInspectProjectChanges(project.id), { element: event.currentTarget });
              }}
            >
              <Icon name="eye" size={11} />
              <span>{t('settings.desktopLocal.inspect')}</span>
            </button>
            <button
              type="button"
              className="room-project-desktop-local-action"
              disabled={desktopLocalBusy}
              onClick={(event) => {
                runImpactAction(() => onSyncProjectFromDisk(project.id), { element: event.currentTarget });
              }}
            >
              <Icon name="refresh" size={11} />
              <span>{t('settings.desktopLocal.readFromMac')}</span>
            </button>
            <button
              type="button"
              className="room-project-desktop-local-action"
              disabled={desktopLocalBusy}
              onClick={(event) => {
                runImpactAction(() => onSyncProjectToDisk(project.id), { element: event.currentTarget });
              }}
            >
              <Icon name="download" size={11} />
              <span>{t('settings.desktopLocal.writeBack')}</span>
            </button>
          </div>
        ) : null}
        {desktopLocalStatus ? (
          <small
            className={`room-project-desktop-local-status ${desktopLocalStatusTone === 'warning' ? 'warning' : ''}`.trim()}
          >
            {desktopLocalStatus}
          </small>
        ) : null}
      </div>
      {desktopBinding ? (
        <form
          className="room-project-desktop-command-card"
          onSubmit={(event) => {
            event.preventDefault();
            runImpactAction(() => onRunDesktopProjectCommand(project.id), { element: event.currentTarget });
          }}
        >
          <div className="room-project-desktop-command-head">
            <span>
              <Icon name="zap" size={12} />
              <strong>{t('settings.desktopLocal.terminal')}</strong>
            </span>
            {activeCommandSession?.status === 'running' ? (
              <button
                type="button"
                className="room-project-desktop-command-run room-project-desktop-command-run--stop"
                onClick={(event) => {
                  runImpactAction(() => onStopDesktopProjectCommand(activeCommandSession.id), {
                    element: event.currentTarget
                  });
                }}
              >
                <Icon name="x" size={10} />
                <span>{t('settings.desktopLocal.stop')}</span>
              </button>
            ) : (
              <button
                type="submit"
                className="room-project-desktop-command-run"
                disabled={desktopCommandBusy || !desktopCommand.trim()}
              >
                <Icon name="play" size={10} />
                <span>{desktopCommandBusy ? t('settings.desktopLocal.starting') : t('settings.desktopLocal.run')}</span>
              </button>
            )}
          </div>
          <div className="room-project-desktop-command-inputs">
            <input
              value={desktopCommand}
              onChange={(event) => onDesktopCommandChange(event.target.value)}
              placeholder="npm"
              aria-label={t('settings.desktopLocal.commandAria')}
            />
            <input
              value={desktopCommandArgs}
              onChange={(event) => onDesktopCommandArgsChange(event.target.value)}
              placeholder="test"
              aria-label={t('settings.desktopLocal.argsAria')}
            />
          </div>
          {commandOutput ? (
            <pre
              className={`room-project-desktop-command-output ${desktopCommandResult?.error || activeCommandSession?.status === 'failed' ? 'error' : ''}`.trim()}
            >
              {commandOutput}
            </pre>
          ) : null}
        </form>
      ) : null}
    </section>
  ) : null;
}
