import { Icon } from '../../Icon';
import { runImpactAction } from '../../haptics';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';
import { RoomProjectConversationsSection } from './RoomProjectConversationsSection';
import { RoomProjectFilesSection } from './RoomProjectFilesSection';
import { RoomProjectReferencesSection } from './RoomProjectReferencesSection';
import { RoomProjectDesktopSection } from './RoomProjectDesktopSection';
import { RoomProjectSettingsSheet } from './RoomProjectSettingsSheet';

/** Render the fullscreen shell and entity surfaces using the controller contract. */
export function RoomProjectFullscreenView(props: RoomProjectFullscreenModel) {
  const {
    isWideLayout,
    dropActive,
    compactView,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    onClose,
    t,
    titleEditing,
    titleInputRef,
    titleDraft,
    setTitleDraft,
    commitTitle,
    project,
    setTitleEditing,
    projectMetaLabel,
    computerStatus,
    setSettingsOpen,
    conversations,
    files,
    referenceDocs,
    setCompactView,
    dropSummary,
    onRunProject,
    dropBusy
  } = props;
  return (
    <div
      className={`room-project-fullscreen ${isWideLayout ? 'room-project-fullscreen--wide' : ''} ${dropActive ? 'room-project-fullscreen--drop-active' : ''}`}
      data-room-project-view={compactView}
      role="dialog"
      aria-modal="true"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="room-project-fullscreen-bar">
        <div className="room-project-fullscreen-copy">
          <button
            type="button"
            className="room-project-fullscreen-back"
            onClick={(event) => {
              runImpactAction(onClose, { element: event.currentTarget });
            }}
            aria-label={t('collection.workspace.backToCollection')}
          >
            <Icon name="chevron" size={15} />
          </button>
          <div className="room-project-fullscreen-title">
            {titleEditing ? (
              <input
                ref={titleInputRef}
                className="room-project-fullscreen-title-input"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitTitle();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setTitleDraft(project.title);
                    setTitleEditing(false);
                  }
                }}
                aria-label={t('collection.workspace.editTitleAria')}
              />
            ) : (
              <button
                type="button"
                className="room-project-fullscreen-title-trigger"
                onClick={(event) => {
                  runImpactAction(() => setTitleEditing(true), { element: event.currentTarget });
                }}
              >
                {project.title}
              </button>
            )}
            <small>{projectMetaLabel}</small>
            <span className="room-project-computer-status" data-tone={computerStatus.tone}>
              <span className="room-project-computer-status-dot" aria-hidden="true" />
              <span>{computerStatus.label}</span>
            </span>
          </div>
        </div>
        <div className="room-project-fullscreen-actions">
          <button
            type="button"
            className="room-project-fullscreen-settings"
            aria-label={t('collection.workspace.settingsAria')}
            onClick={(event) => {
              runImpactAction(() => setSettingsOpen(true), { element: event.currentTarget });
            }}
          >
            <Icon name="settings" size={15} />
          </button>
        </div>
      </div>

      <div className="room-project-compact-tabs" role="tablist" aria-label={t('collection.workspace.viewTabsAria')}>
        {(
          [
            ['conversations', t('collection.workspace.conversationsTab'), conversations.length],
            ['files', t('collection.workspace.filesTab'), files.length],
            ['references', t('collection.workspace.referencesTab'), referenceDocs.length]
          ] as const
        ).map(([view, label, count]) => (
          <button
            key={view}
            type="button"
            className={`room-project-compact-tab ${compactView === view ? 'active' : ''}`}
            role="tab"
            aria-selected={compactView === view}
            onClick={(event) => {
              runImpactAction(() => setCompactView(view), { element: event.currentTarget });
            }}
          >
            <span>{label}</span>
            <small>{count}</small>
          </button>
        ))}
      </div>

      {dropSummary ? (
        <div className="room-project-drop-status" role="status">
          {dropSummary}
        </div>
      ) : null}

      <div className="room-project-fullscreen-body">
        <RoomProjectDesktopSection {...props} />

        <RoomProjectConversationsSection {...props} />

        <RoomProjectFilesSection {...props} />

        <RoomProjectReferencesSection {...props} />
      </div>
      <div className="room-project-run-floating-anchor">
        <button
          type="button"
          className="room-project-run-floating-fab"
          aria-label={t('collection.workspace.runWorkspaceAria')}
          title={t('collection.workspace.runWorkspaceTitle')}
          onClick={(event) => {
            runImpactAction(() => onRunProject(project.id), { element: event.currentTarget });
          }}
        >
          <Icon name="play" size={16} />
        </button>
      </div>
      {dropActive || dropBusy ? (
        <div className={`room-project-drop-overlay ${dropBusy ? 'busy' : ''}`} aria-hidden="true">
          <span className="room-project-drop-overlay-icon">
            <Icon name="folder" size={18} />
          </span>
          <strong>
            {dropBusy ? t('collection.workspace.dropImporting') : t('collection.workspace.dropReleaseToImport')}
          </strong>
          <small>{t('collection.workspace.dropHint')}</small>
        </div>
      ) : null}
      <RoomProjectSettingsSheet {...props} />
    </div>
  );
}
