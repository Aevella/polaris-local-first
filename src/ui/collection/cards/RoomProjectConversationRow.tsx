import { type Conversation, type Persona } from '../../../types/domain';
import { useI18n } from '../../../i18n';
import { resolveConversationCollaboratorName } from '../../../engines/conversationOwnership';
import { recentConversationCopy, conversationUpdatedLabel } from '../collectionUtils';
import { displayConversationTitle } from '../../../stores/chatStoreTitles';
import { useSwipeDelete } from '../grid/useSwipeDelete';
import { runImpactAction } from '../../haptics';

export function RoomProjectConversationRow({
  conversation,
  personas,
  active,
  onOpen,
  onDelete
}: {
  conversation: Conversation;
  personas: Persona[];
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, language } = useI18n();
  const collaboratorName = resolveConversationCollaboratorName(conversation, personas);
  const excerpt = recentConversationCopy(conversation, language);
  const title = displayConversationTitle(conversation);
  const swipeDelete = useSwipeDelete();

  return (
    <div
      className={`room-project-conversation-row-shell ${active ? 'active' : ''} ${swipeDelete.open ? 'swipe-open' : ''} ${swipeDelete.dragging ? 'swiping' : ''}`}
      style={swipeDelete.style}
      {...swipeDelete.swipeProps}
    >
      <button
        type="button"
        className="room-project-conversation-row-delete"
        data-swipe-delete-action="true"
        onClick={(event) => {
          runImpactAction(
            () => {
              swipeDelete.close();
              onDelete();
            },
            { element: event.currentTarget }
          );
        }}
        aria-label={t('collection.workspace.deleteConversationAria', { title })}
      >
        {t('collection.workspace.delete')}
      </button>
      <button
        type="button"
        className={`room-project-conversation-row ${active ? 'active' : ''}`}
        onClick={(event) => {
          if (swipeDelete.open) {
            swipeDelete.close();
            return;
          }
          swipeDelete.close();
          runImpactAction(onOpen, { element: event.currentTarget });
        }}
      >
        <span className="room-project-conversation-row-copy">
          <strong>{title}</strong>
          <small>
            {collaboratorName} · {conversationUpdatedLabel(conversation, language)}
          </small>
          {excerpt ? <span>{excerpt}</span> : null}
        </span>
        {active ? (
          <span className="room-project-conversation-row-state">{t('collection.workspace.current')}</span>
        ) : null}
      </button>
    </div>
  );
}
