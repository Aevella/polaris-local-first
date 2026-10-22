import { useMemo } from 'react';
import { useI18n } from '../../../i18n';
import type { Conversation, Persona, RoomProject } from '../../../types/domain';
import type { ConversationMessageSearchIndex } from '../../../app/collection/conversationMessageSearch';
import { Icon } from '../../Icon';
import { CollectionShelfLead } from './CollectionShelfLead';
import { ConversationCardGrid } from './ConversationCardGrid';
import { MissingCollaboratorRecoveryPanel } from './MissingCollaboratorRecoveryPanel';
import type { CollaboratorRecoveryController } from '../../../app/collection/useCollaboratorRecoveryController';

type DialogueCollectionShelfProps = {
  cardsExpanded: boolean;
  conversations: Conversation[];
  conversationMessageSearchIndex?: ConversationMessageSearchIndex;
  personas: Persona[];
  roomProjects: RoomProject[];
  activeConversationId: string | null;
  editingConversationId: string | null;
  conversationTitleDraft: string;
  exportingConversationArchive: boolean;
  isAggregateScope: boolean;
  collaboratorRecovery: CollaboratorRecoveryController;
  onConversationTitleDraftChange: (value: string) => void;
  onStartConversationRename: (conversationId: string, title: string) => void;
  onCommitConversationRename: (conversationId: string) => void;
  onCancelConversationRename: () => void;
  onConversationPinToggle: (conversationId: string) => void;
  onConversationDelete: (conversationId: string, title: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenConversationMessage?: (conversationId: string, messageId: string) => void;
  onExportConversationArchive: () => void;
};

export function DialogueCollectionShelf({
  cardsExpanded,
  conversations,
  conversationMessageSearchIndex,
  personas,
  roomProjects,
  activeConversationId,
  editingConversationId,
  conversationTitleDraft,
  exportingConversationArchive,
  isAggregateScope,
  collaboratorRecovery,
  onConversationTitleDraftChange,
  onStartConversationRename,
  onCommitConversationRename,
  onCancelConversationRename,
  onConversationPinToggle,
  onConversationDelete,
  onOpenConversation,
  onOpenConversationMessage,
  onExportConversationArchive
}: DialogueCollectionShelfProps) {
  const { t, formatNumber } = useI18n();
  const projectTitleById = useMemo(
    () => Object.fromEntries(roomProjects.map((project) => [project.id, project.title] as const)),
    [roomProjects]
  );
  const densityClass = conversations.length > 8 ? 'cards-heavy' : 'cards-normal';
  const sectionMeta = t('collection.dialogue.shelfCount', { count: formatNumber(conversations.length) });

  return (
    <section className={`collection-shelf-stack collection-shelf-stack--dialogue ${densityClass}`}>
      <CollectionShelfLead
        meta={sectionMeta}
        helpText={t('collection.dialogue.shelfHelp')}
        action={(
          <button
            type="button"
            className="btn-secondary compact-btn dialogue-export-action"
            onClick={onExportConversationArchive}
            disabled={exportingConversationArchive}
            aria-label={exportingConversationArchive
              ? t('collection.dialogue.exportingAria')
              : t('collection.dialogue.exportAria')}
            title={exportingConversationArchive
              ? t('collection.dialogue.exporting')
              : t('collection.dialogue.export')}
          >
            <Icon name="download" size={13} />
            <span>{exportingConversationArchive ? t('collection.dialogue.exporting') : t('collection.dialogue.export')}</span>
          </button>
        )}
      />
      {isAggregateScope ? (
        <MissingCollaboratorRecoveryPanel
          incidents={collaboratorRecovery.incidents}
          personas={personas}
          busyCollaboratorId={collaboratorRecovery.busyCollaboratorId}
          onRestore={(collaboratorId) => void collaboratorRecovery.restoreCollaborator(collaboratorId)}
          onRebuild={(collaboratorId, name) => void collaboratorRecovery.rebuildCollaborator(collaboratorId, name)}
          onReassign={(sourceCollaboratorId, targetCollaboratorId) => void collaboratorRecovery.reassignConversations(
            sourceCollaboratorId,
            targetCollaboratorId
          )}
        />
      ) : null}
      <ConversationCardGrid
        cardsExpanded={cardsExpanded}
        conversations={conversations}
        conversationMessageSearchIndex={conversationMessageSearchIndex}
        personas={personas}
        projectTitleById={projectTitleById}
        activeConversationId={activeConversationId}
        editingConversationId={editingConversationId}
        conversationTitleDraft={conversationTitleDraft}
        onConversationTitleDraftChange={onConversationTitleDraftChange}
        onStartConversationRename={onStartConversationRename}
        onCommitConversationRename={onCommitConversationRename}
        onCancelConversationRename={onCancelConversationRename}
        onConversationPinToggle={onConversationPinToggle}
        onConversationDelete={onConversationDelete}
        onOpenConversation={onOpenConversation}
        onOpenConversationMessage={onOpenConversationMessage}
      />
    </section>
  );
}
