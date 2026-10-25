import { Icon } from '../../Icon';
import { runImpactAction } from '../../haptics';
import { CreateActionSheet } from '../../create/CreateActionSheet';
import { FileImportControl } from './RoomProjectFileImportControl';
import { MEMORY_REFERENCE_DOC_ACCEPT } from '../../../engines/memoryReferenceDocImport';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  | 't'
  | 'referenceDocs'
  | 'referenceMenuTriggerRef'
  | 'referenceMenuOpen'
  | 'toggleReferenceCreateMenu'
  | 'setReferenceMenuOpen'
  | 'referenceMenuRef'
  | 'handleCreateReference'
  | 'importingReferences'
  | 'handleImportReferences'
  | 'referenceImportLabel'
  | 'handleEditReference'
  | 'summarizeReferenceDoc'
  | 'handleDeleteReference'
>;

export function RoomProjectReferencesSection(props: Props) {
  const {
    t,
    referenceDocs,
    referenceMenuTriggerRef,
    referenceMenuOpen,
    toggleReferenceCreateMenu,
    setReferenceMenuOpen,
    referenceMenuRef,
    handleCreateReference,
    importingReferences,
    handleImportReferences,
    referenceImportLabel,
    handleEditReference,
    summarizeReferenceDoc,
    handleDeleteReference
  } = props;
  return (
    <section className="room-project-fullscreen-section room-project-fullscreen-section--references">
      <div className="room-project-fullscreen-section-head">
        <span className="room-project-fullscreen-section-label">
          <Icon name="fileText" size={13} />
          <strong>{t('collection.workspace.referencesSection')}</strong>
        </span>
        <span className="room-project-fullscreen-section-tools">
          <small className="room-project-section-count">
            {t('collection.workspace.referenceCount', { count: referenceDocs.length })}
          </small>
          <button
            ref={referenceMenuTriggerRef}
            type="button"
            className="room-project-section-action"
            aria-label={t('collection.workspace.referenceCreateMenuAria')}
            aria-expanded={referenceMenuOpen}
            onClick={(event) => {
              runImpactAction(toggleReferenceCreateMenu, { element: event.currentTarget });
            }}
          >
            <Icon name={referenceMenuOpen ? 'x' : 'plus'} size={11} />
            <span>
              {referenceMenuOpen ? t('collection.workspace.collapse') : t('collection.workspace.addReferences')}
            </span>
          </button>
        </span>
      </div>
      <CreateActionSheet
        open={referenceMenuOpen}
        ariaLabel={t('collection.workspace.referenceCreateMenuAria')}
        className="room-project-create-action-sheet"
        onClose={() => setReferenceMenuOpen(false)}
      >
        <div
          ref={referenceMenuRef}
          className="room-project-file-quick-menu"
          role="menu"
          aria-label={t('collection.workspace.referenceCreateMenuAria')}
        >
          <button
            type="button"
            className="room-project-file-quick-menu-item"
            role="menuitem"
            onClick={(event) => {
              runImpactAction(handleCreateReference, { element: event.currentTarget });
            }}
          >
            <span className="room-project-file-quick-menu-item-icon" aria-hidden="true">
              <Icon name="filePlus" size={12} />
            </span>
            <span className="room-project-file-quick-menu-item-copy">
              <strong>{t('collection.workspace.newReference')}</strong>
              <small>{t('collection.workspace.newReferenceDetail')}</small>
            </span>
          </button>
          <FileImportControl
            className="room-project-file-quick-menu-item"
            role="menuitem"
            accept={MEMORY_REFERENCE_DOC_ACCEPT}
            disabled={importingReferences}
            multiple
            onFiles={handleImportReferences}
          >
            <span className="room-project-file-quick-menu-item-icon" aria-hidden="true">
              <Icon name="folder" size={12} />
            </span>
            <span className="room-project-file-quick-menu-item-copy">
              <strong>{referenceImportLabel}</strong>
              <small>{t('collection.workspace.importReferencesDetail')}</small>
            </span>
          </FileImportControl>
        </div>
      </CreateActionSheet>
      {referenceDocs.length > 0 ? (
        <div className="room-project-fullscreen-file-list">
          {referenceDocs.map((doc) => (
            <div key={doc.id} className="room-project-file-row">
              <button
                type="button"
                className="room-project-file-row-main"
                onClick={(event) => {
                  runImpactAction(() => handleEditReference(doc), { element: event.currentTarget });
                }}
              >
                <span className="room-project-file-row-icon">
                  <Icon name="feather" size={12} />
                </span>
                <span className="room-project-file-row-copy">
                  <strong>{doc.title}</strong>
                  <small>{summarizeReferenceDoc(doc)}</small>
                </span>
              </button>
              <div className="room-project-file-row-actions">
                <button
                  type="button"
                  className="room-project-file-row-action"
                  aria-label={t('collection.workspace.editReferenceAria', { title: doc.title })}
                  title={t('collection.workspace.editReferenceTitle', { title: doc.title })}
                  onClick={(event) => {
                    runImpactAction(() => handleEditReference(doc), { element: event.currentTarget });
                  }}
                >
                  <Icon name="edit" size={12} />
                </button>
                <button
                  type="button"
                  className="room-project-file-row-action"
                  aria-label={t('collection.workspace.deleteReferenceAria', { title: doc.title })}
                  title={t('collection.workspace.deleteReferenceTitle', { title: doc.title })}
                  onClick={(event) => {
                    runImpactAction(() => handleDeleteReference(doc), { element: event.currentTarget });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="room-project-fullscreen-reference-empty">
          <span className="room-project-fullscreen-reference-mark" aria-hidden="true">
            <Icon name="feather" size={14} />
          </span>
          <span>
            <strong>{t('collection.workspace.emptyReferencesTitle')}</strong>
            <small>{t('collection.workspace.emptyReferencesDetail')}</small>
          </span>
        </div>
      )}
    </section>
  );
}
