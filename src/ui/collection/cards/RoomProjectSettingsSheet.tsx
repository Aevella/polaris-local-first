import { runImpactAction } from '../../haptics';
import { Icon } from '../../Icon';
import { FileImportControl } from './RoomProjectFileImportControl';
import { MEMORY_REFERENCE_DOC_ACCEPT } from '../../../engines/memoryReferenceDocImport';
import { RoomProjectPreviewAccessControl } from './RoomProjectPreviewAccessControl';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  | 'settingsOpen'
  | 'setSettingsOpen'
  | 't'
  | 'files'
  | 'conversations'
  | 'referenceDocs'
  | 'entryFile'
  | 'previewStateAccessLabel'
  | 'previewStateReadEnabled'
  | 'onCreateProjectChat'
  | 'handleCreateFile'
  | 'importAccept'
  | 'importingFiles'
  | 'handleImportFiles'
  | 'importLabel'
  | 'handleCreateReference'
  | 'importingReferences'
  | 'handleImportReferences'
  | 'referenceImportLabel'
  | 'onRunProject'
  | 'project'
  | 'onSetProjectPreviewStateAccess'
>;

export function RoomProjectSettingsSheet(props: Props) {
  const {
    settingsOpen,
    setSettingsOpen,
    t,
    files,
    conversations,
    referenceDocs,
    entryFile,
    previewStateAccessLabel,
    previewStateReadEnabled,
    onCreateProjectChat,
    handleCreateFile,
    importAccept,
    importingFiles,
    handleImportFiles,
    importLabel,
    handleCreateReference,
    importingReferences,
    handleImportReferences,
    referenceImportLabel,
    onRunProject,
    project,
    onSetProjectPreviewStateAccess
  } = props;
  return settingsOpen ? (
    <div className="room-project-settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <section
        className="room-project-settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('collection.workspace.settingsTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="room-project-settings-head">
          <span>
            <small>{t('collection.workspace.settingsEyebrow')}</small>
            <strong>{t('collection.workspace.settingsTitle')}</strong>
          </span>
          <button
            type="button"
            className="room-project-settings-close"
            aria-label={t('collection.workspace.settingsClose')}
            onClick={(event) => {
              runImpactAction(() => setSettingsOpen(false), { element: event.currentTarget });
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </header>
        <div className="room-project-settings-body">
          <section className="room-project-settings-panel">
            <div className="room-project-settings-panel-head">
              <Icon name="folder" size={13} />
              <strong>{t('collection.workspace.settingsOverview')}</strong>
            </div>
            <div className="room-project-settings-outline">
              <div className="room-project-settings-outline-row">
                <span>{t('collection.workspace.settingsFiles')}</span>
                <strong>{t('collection.workspace.fileCount', { count: files.length })}</strong>
              </div>
              <div className="room-project-settings-outline-row">
                <span>{t('collection.workspace.settingsConversations')}</span>
                <strong>{t('collection.workspace.conversationCount', { count: conversations.length })}</strong>
              </div>
              <div className="room-project-settings-outline-row">
                <span>{t('collection.workspace.settingsReferences')}</span>
                <strong>{t('collection.workspace.referenceCount', { count: referenceDocs.length })}</strong>
              </div>
              <div className="room-project-settings-outline-row">
                <span>{t('collection.workspace.settingsEntryFile')}</span>
                <strong>{entryFile?.path ?? t('collection.workspace.settingsEntryMissing')}</strong>
              </div>
              <div className="room-project-settings-outline-row">
                <span>{t('collection.workspace.previewAccessSection')}</span>
                <strong>{previewStateAccessLabel}</strong>
              </div>
            </div>
          </section>

          <section className="room-project-settings-panel room-project-settings-panel--preview">
            <div className="room-project-settings-panel-head">
              <Icon name="eye" size={13} />
              <strong>{t('collection.workspace.previewAccessSection')}</strong>
              <span className={`room-project-preview-access-state ${previewStateReadEnabled ? 'enabled' : ''}`}>
                {previewStateAccessLabel}
              </span>
            </div>
            <RoomProjectPreviewAccessControl {...props} />
          </section>

          <section className="room-project-settings-panel">
            <div className="room-project-settings-panel-head">
              <Icon name="zap" size={13} />
              <strong>{t('collection.workspace.settingsActions')}</strong>
            </div>
            <div className="room-project-settings-actions">
              <button
                type="button"
                className="room-project-settings-action"
                onClick={(event) => {
                  runImpactAction(
                    () => {
                      setSettingsOpen(false);
                      onCreateProjectChat();
                    },
                    { element: event.currentTarget }
                  );
                }}
              >
                <Icon name="send" size={13} />
                <span>{t('collection.workspace.newConversation')}</span>
              </button>
              <button
                type="button"
                className="room-project-settings-action"
                onClick={(event) => {
                  runImpactAction(
                    () => {
                      setSettingsOpen(false);
                      handleCreateFile();
                    },
                    { element: event.currentTarget }
                  );
                }}
              >
                <Icon name="filePlus" size={13} />
                <span>{t('collection.workspace.newFile')}</span>
              </button>
              <FileImportControl
                className="room-project-settings-action"
                accept={importAccept}
                disabled={importingFiles}
                multiple
                onFiles={handleImportFiles}
              >
                <Icon name="folder" size={13} />
                <span>{importLabel}</span>
              </FileImportControl>
              <button
                type="button"
                className="room-project-settings-action"
                onClick={(event) => {
                  runImpactAction(
                    () => {
                      setSettingsOpen(false);
                      handleCreateReference();
                    },
                    { element: event.currentTarget }
                  );
                }}
              >
                <Icon name="fileText" size={13} />
                <span>{t('collection.workspace.newReference')}</span>
              </button>
              <FileImportControl
                className="room-project-settings-action"
                accept={MEMORY_REFERENCE_DOC_ACCEPT}
                disabled={importingReferences}
                multiple
                onFiles={handleImportReferences}
              >
                <Icon name="folder" size={13} />
                <span>{referenceImportLabel}</span>
              </FileImportControl>
              <button
                type="button"
                className="room-project-settings-action room-project-settings-action--run"
                onClick={(event) => {
                  runImpactAction(
                    () => {
                      setSettingsOpen(false);
                      onRunProject(project.id);
                    },
                    { element: event.currentTarget }
                  );
                }}
              >
                <Icon name="play" size={13} />
                <span>{t('collection.workspace.runWorkspaceTitle')}</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  ) : null;
}
