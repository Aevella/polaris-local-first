import { Icon } from '../../Icon';
import { runImpactAction } from '../../haptics';
import { CreateActionSheet } from '../../create/CreateActionSheet';
import { FileImportControl } from './RoomProjectFileImportControl';
import { RoomProjectFileTree } from './RoomProjectFileTree';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  | 't'
  | 'files'
  | 'createMenuTriggerRef'
  | 'createMenuOpen'
  | 'toggleFileCreateMenu'
  | 'setCreateMenuOpen'
  | 'createMenuRef'
  | 'handleCreateFile'
  | 'importAccept'
  | 'importingFiles'
  | 'handleImportFiles'
  | 'importLabel'
  | 'onOpenFile'
  | 'describeFileMeta'
  | 'handlePinFileAsReference'
>;

export function RoomProjectFilesSection(props: Props) {
  const {
    t,
    files,
    createMenuTriggerRef,
    createMenuOpen,
    toggleFileCreateMenu,
    setCreateMenuOpen,
    createMenuRef,
    handleCreateFile,
    importAccept,
    importingFiles,
    handleImportFiles,
    importLabel,
    onOpenFile,
    describeFileMeta,
    handlePinFileAsReference
  } = props;
  return (
    <section className="room-project-fullscreen-section room-project-fullscreen-section--files">
      <div className="room-project-fullscreen-section-head">
        <span className="room-project-fullscreen-section-label">
          <Icon name="code" size={13} />
          <strong>{t('collection.workspace.filesSection')}</strong>
        </span>
        <span className="room-project-fullscreen-section-tools">
          <small className="room-project-section-count">
            {t('collection.workspace.fileCount', { count: files.length })}
          </small>
          {files.length > 0 ? (
            <button
              ref={createMenuTriggerRef}
              type="button"
              className="room-project-section-action"
              aria-label={t('collection.workspace.fileCreateMenuAria')}
              aria-expanded={createMenuOpen}
              onClick={(event) => {
                runImpactAction(toggleFileCreateMenu, { element: event.currentTarget });
              }}
            >
              <Icon name={createMenuOpen ? 'x' : 'plus'} size={11} />
              <span>{createMenuOpen ? t('collection.workspace.collapse') : t('collection.workspace.addFiles')}</span>
            </button>
          ) : null}
        </span>
      </div>
      <CreateActionSheet
        open={createMenuOpen}
        ariaLabel={t('collection.workspace.fileCreateMenuAria')}
        className="room-project-create-action-sheet"
        onClose={() => setCreateMenuOpen(false)}
      >
        <div
          ref={createMenuRef}
          className="room-project-file-quick-menu"
          role="menu"
          aria-label={t('collection.workspace.fileCreateMenuAria')}
        >
          <button
            type="button"
            className="room-project-file-quick-menu-item"
            role="menuitem"
            onClick={(event) => {
              runImpactAction(handleCreateFile, { element: event.currentTarget });
            }}
          >
            <span className="room-project-file-quick-menu-item-icon" aria-hidden="true">
              <Icon name="filePlus" size={12} />
            </span>
            <span className="room-project-file-quick-menu-item-copy">
              <strong>{t('collection.workspace.newFile')}</strong>
              <small>{t('collection.workspace.newFileDetail')}</small>
            </span>
          </button>
          <FileImportControl
            className="room-project-file-quick-menu-item"
            role="menuitem"
            accept={importAccept}
            disabled={importingFiles}
            multiple
            onFiles={handleImportFiles}
          >
            <span className="room-project-file-quick-menu-item-icon" aria-hidden="true">
              <Icon name="folder" size={12} />
            </span>
            <span className="room-project-file-quick-menu-item-copy">
              <strong>{importLabel}</strong>
              <small>{t('collection.workspace.importFilesDetail')}</small>
            </span>
          </FileImportControl>
        </div>
      </CreateActionSheet>
      {files.length > 0 ? (
        <>
          <RoomProjectFileTree files={files} onOpenFile={onOpenFile} />
          <div className="room-project-fullscreen-file-list">
            {files.map((file) => (
              <div
                key={file.fileId}
                className={`room-project-file-row ${file.isEntry ? 'room-project-file-row--entry' : ''}`}
              >
                <button
                  type="button"
                  className="room-project-file-row-main"
                  onClick={(event) => {
                    runImpactAction(() => onOpenFile(file.fileId), { element: event.currentTarget });
                  }}
                >
                  <span className="room-project-file-row-icon">
                    <Icon name={file.isEntry ? 'sparkle' : 'code'} size={12} />
                  </span>
                  <span className="room-project-file-row-copy">
                    <strong>{file.path}</strong>
                    <small>{describeFileMeta(file)}</small>
                  </span>
                </button>
                <div className="room-project-file-row-actions">
                  <button
                    type="button"
                    className="room-project-file-row-action"
                    aria-label={t('collection.workspace.pinFileAsReferenceAria', { path: file.path })}
                    title={t('collection.workspace.pinFileAsReferenceTitle', { path: file.path })}
                    onClick={(event) => {
                      runImpactAction(() => handlePinFileAsReference(file), { element: event.currentTarget });
                    }}
                  >
                    <Icon name="pin" size={12} />
                  </button>
                  <button
                    type="button"
                    className="room-project-file-row-action"
                    aria-label={t('collection.workspace.editFileAria', { path: file.path })}
                    title={t('collection.workspace.editFileTitle', { path: file.path })}
                    onClick={(event) => {
                      runImpactAction(() => onOpenFile(file.fileId), { element: event.currentTarget });
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="room-project-fullscreen-empty">
          <span className="room-project-fullscreen-empty-icon" aria-hidden="true">
            <Icon name="folder" size={15} />
          </span>
          <strong>{t('collection.workspace.emptyFilesTitle')}</strong>
          <div className="room-project-fullscreen-empty-actions">
            <button
              type="button"
              className="room-project-fullscreen-inline-action"
              onClick={(event) => {
                runImpactAction(handleCreateFile, { element: event.currentTarget });
              }}
            >
              <Icon name="filePlus" size={12} />
              <span>{t('collection.workspace.newFile')}</span>
            </button>
            <FileImportControl
              className="room-project-fullscreen-inline-action"
              accept={importAccept}
              disabled={importingFiles}
              multiple
              onFiles={handleImportFiles}
            >
              <Icon name="folder" size={12} />
              <span>{importLabel}</span>
            </FileImportControl>
          </div>
        </div>
      )}
    </section>
  );
}
