import { runImpactAction } from '../../haptics';
import { Icon } from '../../Icon';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  'previewStateReadEnabled' | 'onSetProjectPreviewStateAccess' | 'project' | 't'
>;

export function RoomProjectPreviewAccessControl(props: Props) {
  const { previewStateReadEnabled, onSetProjectPreviewStateAccess, project, t } = props;
  return (
    <button
      type="button"
      className={`room-project-preview-access-card ${previewStateReadEnabled ? 'enabled' : ''}`}
      role="switch"
      aria-checked={previewStateReadEnabled}
      onClick={(event) => {
        runImpactAction(
          () => {
            onSetProjectPreviewStateAccess(project.id, !previewStateReadEnabled);
          },
          { element: event.currentTarget }
        );
      }}
    >
      <span className="room-project-preview-access-icon" aria-hidden="true">
        <Icon name="eye" size={14} />
      </span>
      <span className="room-project-preview-access-copy">
        <strong>
          {previewStateReadEnabled
            ? t('collection.workspace.previewAccessEnabledTitle')
            : t('collection.workspace.previewAccessDisabledTitle')}
        </strong>
        <small>
          {previewStateReadEnabled
            ? t('collection.workspace.previewAccessEnabledDetail')
            : t('collection.workspace.previewAccessDisabledDetail')}
        </small>
      </span>
      <span
        className={`room-project-preview-access-switch ${previewStateReadEnabled ? 'enabled' : ''}`}
        aria-hidden="true"
      >
        <span />
      </span>
    </button>
  );
}
