import type { ChangeEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';
import { Icon } from '../../../Icon';
import { runSelectionAction } from '../../../haptics';
import { resolveDocumentFilePickerAccept } from '../../../filePickerAccept';
import type { ChatCardReference, CodeCard, ConversationReasoningStrength } from '../../../../types/domain';
import { cleanDisplayText } from '../../../text/displayText';
import { canUseNativeCameraCapture, canUseNativePhotoLibraryPicker } from '../../../../native/imagePickerFiles';
import { canUseNativeSystemFilePicker, pickNativeSystemFiles } from '../../../../native/systemPickedFiles';
import { useI18n } from '../../../../i18n';
import { ConversationReasoningPicker } from './ConversationReasoningPicker';

type ComposerAttachmentsProps = {
  pickerOpen: boolean;
  interactionLocked: boolean;
  pendingAttachmentsCount: number;
  hasUnsupportedPendingImages: boolean;
  taskToolsEnabled: boolean;
  taskModeEnabled: boolean;
  reasoningStrength: ConversationReasoningStrength;
  onAddAttachments: (files: FileList | File[]) => Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void;
  pendingAttachments: import('../../../../types/domain').ChatAttachment[];
  pendingCardReference: ChatCardReference | null;
  availableCards: CodeCard[];
  onToggleTaskModeEnabled: (enabled: boolean) => void;
  onSetReasoningStrength: (strength: ConversationReasoningStrength) => void;
  onOpenToolbox: () => void;
  onSetPickerOpen: (open: boolean) => void;
  onSetPendingCardReference: (reference: ChatCardReference | null) => void;
};

type ComposerQuickActionsProps = {
  pickerOpen: boolean;
  interactionLocked: boolean;
  onSetPickerOpen: (open: boolean) => void;
};

const FILE_ACCEPT =
  '.zip,.pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yml,.yaml,.py,.rb,.go,.rs,.java,.kt,.swift,.sh,.sql';

export function ComposerQuickActions({
  pickerOpen,
  interactionLocked,
  onSetPickerOpen
}: ComposerQuickActionsProps) {
  const { t } = useI18n();

  return (
    <div className="composer-quick-actions">
      <button
        type="button"
        className={`composer-slot-btn composer-slot-btn-attachment ${pickerOpen ? 'active' : ''}`}
        title={t('chat.composer.attachmentsToggle')}
        aria-label={t('chat.composer.attachmentsToggle')}
        aria-expanded={pickerOpen}
        aria-controls="composer-attachment-picker"
        disabled={interactionLocked}
        onClick={(event) => {
          runSelectionAction(() => {
            onSetPickerOpen(!pickerOpen);
          }, { element: event.currentTarget });
        }}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}

export function ComposerAttachments({
  pickerOpen,
  interactionLocked,
  pendingAttachmentsCount,
  hasUnsupportedPendingImages,
  taskToolsEnabled,
  taskModeEnabled,
  reasoningStrength,
  onAddAttachments,
  onRemoveAttachment,
  pendingAttachments,
  pendingCardReference,
  availableCards,
  onToggleTaskModeEnabled,
  onSetReasoningStrength,
  onOpenToolbox,
  onSetPickerOpen,
  onSetPendingCardReference
}: ComposerAttachmentsProps) {
  const { t } = useI18n();
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false);
  const imageLibraryPickerRef = useRef<HTMLInputElement>(null);
  const cameraPickerRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const nativeImagePickerPromiseRef = useRef<Promise<typeof import('../../../../native/imagePickerFiles')> | null>(null);
  const fileAccept = resolveDocumentFilePickerAccept(FILE_ACCEPT);
  const closePicker = () => {
    onSetPickerOpen(false);
    setCardPickerOpen(false);
    setReasoningPickerOpen(false);
  };
  const visibleCards = availableCards.filter((card) => card.kind !== 'room-rule');

  useEffect(() => {
    if (pickerOpen) return;
    setCardPickerOpen(false);
    setReasoningPickerOpen(false);
  }, [pickerOpen]);

  const handleAttachmentSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    await onAddAttachments(files);
  };

  const openNativeCamera = async () => {
    nativeImagePickerPromiseRef.current ??= import('../../../../native/imagePickerFiles');
    const { captureNativePhotoFile } = await nativeImagePickerPromiseRef.current;
    const file = await captureNativePhotoFile();
    await onAddAttachments([file]);
  };
  const openNativePhotoLibrary = async () => {
    nativeImagePickerPromiseRef.current ??= import('../../../../native/imagePickerFiles');
    const { pickNativePhotoLibraryFiles } = await nativeImagePickerPromiseRef.current;
    const files = await pickNativePhotoLibraryFiles();
    if (files.length > 0) {
      await onAddAttachments(files);
    }
  };
  const openNativeFiles = async () => {
    const files = await pickNativeSystemFiles({
      accept: FILE_ACCEPT,
      multiple: true
    });
    if (files.length > 0) {
      await onAddAttachments(files);
    }
  };

  return (
    <>
      {pendingAttachmentsCount > 0 ? (
        <ChatAttachmentStrip attachments={pendingAttachments} tone="pending" onRemove={onRemoveAttachment} />
      ) : null}
      {hasUnsupportedPendingImages ? (
        <div className="attachment-warning">
          {t('chat.composer.unsupportedImages')}
        </div>
      ) : null}
      <input
        ref={imageLibraryPickerRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden-file-input"
        onChange={(event) => { void handleAttachmentSelection(event); }}
      />
      <input
        ref={cameraPickerRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden-file-input"
        onChange={(event) => { void handleAttachmentSelection(event); }}
      />
      <input
        ref={filePickerRef}
        type="file"
        accept={fileAccept}
        multiple
        className="hidden-file-input"
        onChange={(event) => { void handleAttachmentSelection(event); }}
      />
      {pickerOpen ? (
        <div className="attachment-picker-sheet" id="composer-attachment-picker" role="region" aria-label={t('chat.composer.attachmentPickerAria')}>
          {!reasoningPickerOpen ? <div className="attachment-picker-actions">
            <button
              type="button"
              className={`attachment-picker-action ${reasoningStrength !== 'automatic' ? 'active' : ''}`}
              onClick={(event) => {
                runSelectionAction(() => {
                  setCardPickerOpen(false);
                  setReasoningPickerOpen(true);
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="orbit" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.reasoning.title')}</strong>
              </span>
            </button>
            <button
              type="button"
              className="attachment-picker-action"
              onClick={(event) => {
                runSelectionAction(() => {
                  closePicker();
                  if (canUseNativePhotoLibraryPicker()) {
                    void openNativePhotoLibrary().catch(() => undefined);
                    return;
                  }
                  imageLibraryPickerRef.current?.click();
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="image" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.composer.photoLibrary')}</strong>
              </span>
            </button>
            <button
              type="button"
              className="attachment-picker-action"
              onClick={(event) => {
                runSelectionAction(() => {
                  closePicker();
                  if (canUseNativeCameraCapture()) {
                    void openNativeCamera().catch(() => undefined);
                    return;
                  }
                  cameraPickerRef.current?.click();
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="camera" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.composer.camera')}</strong>
              </span>
            </button>
            <button
              type="button"
              className="attachment-picker-action"
              onClick={(event) => {
                runSelectionAction(() => {
                  closePicker();
                  if (canUseNativeSystemFilePicker()) {
                    void openNativeFiles().catch(() => undefined);
                    return;
                  }
                  filePickerRef.current?.click();
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="folder" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.composer.filePicker')}</strong>
              </span>
            </button>
            <button
              type="button"
              className="attachment-picker-action"
              onClick={(event) => {
                runSelectionAction(() => {
                  setCardPickerOpen(true);
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="navCard" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.composer.sendCard')}</strong>
              </span>
            </button>
            {taskToolsEnabled ? (
              <button
                type="button"
                className={`attachment-picker-action ${taskModeEnabled ? 'active' : ''}`}
                aria-pressed={taskModeEnabled}
                onClick={(event) => {
                  runSelectionAction(() => {
                    onToggleTaskModeEnabled(!taskModeEnabled);
                    closePicker();
                  }, { element: event.currentTarget });
                }}
              >
                <span className="attachment-picker-action-icon">
                  <Icon name="task" size={18} />
                </span>
                <span className="attachment-picker-action-copy">
                  <strong>{taskModeEnabled ? t('chat.composer.closeTaskMode') : t('chat.composer.openTaskMode')}</strong>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="attachment-picker-action"
              onClick={(event) => {
                runSelectionAction(() => {
                  closePicker();
                  onOpenToolbox();
                }, { element: event.currentTarget });
              }}
            >
              <span className="attachment-picker-action-icon">
                <Icon name="layers" size={18} />
              </span>
              <span className="attachment-picker-action-copy">
                <strong>{t('chat.composer.toolbox')}</strong>
              </span>
            </button>
          </div> : null}
          {reasoningPickerOpen ? (
            <ConversationReasoningPicker
              value={reasoningStrength}
              onChange={(strength) => {
                onSetReasoningStrength(strength);
                closePicker();
              }}
              onBack={() => setReasoningPickerOpen(false)}
            />
          ) : null}
          {cardPickerOpen ? (
            <div className="attachment-picker-card-section">
              <div className="attachment-picker-card-head">
                <strong>{t('chat.composer.sendCard')}</strong>
                <button
                  type="button"
                  className="attachment-picker-card-back"
                  onClick={(event) => {
                    runSelectionAction(() => setCardPickerOpen(false), { element: event.currentTarget });
                  }}
                >
                  {t('chat.composer.back')}
                </button>
              </div>
              <div className="attachment-picker-card-list" role="list" aria-label={t('chat.composer.cardListAria')}>
                {visibleCards.map((card) => {
                  const selected = pendingCardReference?.id === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      className={`attachment-picker-card ${selected ? 'selected' : ''}`}
                      onClick={(event) => {
                        runSelectionAction(() => {
                        onSetPendingCardReference({
                          id: card.id,
                          title: card.title,
                          cardNote: card.cardNote,
                          language: card.language,
                          code: card.code,
                          cardFaceCss: card.cardFaceCss,
                          mode: 'reference'
                        });
                        closePicker();
                        }, { element: event.currentTarget });
                      }}
                    >
                      <span className="attachment-picker-card-copy">
                        <strong>{cleanDisplayText(card.title)}</strong>
                        <span>{card.language}</span>
                      </span>
                      <span className="attachment-picker-card-preview">
                        {(card.code.trim() || t('chat.composer.emptyCardPreview')).slice(0, 72)}
                      </span>
                    </button>
                  );
                })}
                {visibleCards.length === 0 ? (
                  <div className="attachment-picker-card-empty">{t('chat.composer.noCards')}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
