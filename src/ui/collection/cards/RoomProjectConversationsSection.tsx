import { Icon } from '../../Icon';
import { runImpactAction } from '../../haptics';
import { RoomProjectConversationRow } from './RoomProjectConversationRow';
import { displayConversationTitle } from '../../../stores/chatStoreTitles';
import type { RoomProjectFullscreenModel } from '../../../app/collection/useRoomProjectFullscreenController';

type Props = Pick<
  RoomProjectFullscreenModel,
  | 't'
  | 'conversations'
  | 'onCreateProjectChat'
  | 'personas'
  | 'activeConversationId'
  | 'onOpenProjectChat'
  | 'onDeleteProjectChat'
>;

export function RoomProjectConversationsSection(props: Props) {
  const {
    t,
    conversations,
    onCreateProjectChat,
    personas,
    activeConversationId,
    onOpenProjectChat,
    onDeleteProjectChat
  } = props;
  return (
    <section className="room-project-fullscreen-section room-project-fullscreen-section--conversations">
      <div className="room-project-fullscreen-section-head">
        <span className="room-project-fullscreen-section-label">
          <Icon name="send" size={13} />
          <strong>{t('collection.workspace.conversationsSection')}</strong>
        </span>
        <span className="room-project-fullscreen-section-tools">
          <small className="room-project-section-count">
            {t('collection.workspace.conversationCount', { count: conversations.length })}
          </small>
          <button
            type="button"
            className="room-project-section-action"
            aria-label={t('collection.workspace.newConversationAria')}
            onClick={(event) => {
              runImpactAction(onCreateProjectChat, { element: event.currentTarget });
            }}
          >
            <Icon name="plus" size={11} />
            <span>{t('collection.workspace.newConversation')}</span>
          </button>
        </span>
      </div>
      {conversations.length > 0 ? (
        <div className="room-project-conversation-list">
          {conversations.map((conversation) => (
            <RoomProjectConversationRow
              key={conversation.id}
              conversation={conversation}
              personas={personas}
              active={conversation.id === activeConversationId}
              onOpen={() => onOpenProjectChat(conversation.id)}
              onDelete={() => onDeleteProjectChat(conversation.id, displayConversationTitle(conversation))}
            />
          ))}
        </div>
      ) : (
        <div className="room-project-fullscreen-empty room-project-fullscreen-empty--compact">
          <span className="room-project-fullscreen-empty-icon" aria-hidden="true">
            <Icon name="send" size={14} />
          </span>
          <span className="room-project-fullscreen-empty-copy">
            <strong>{t('collection.workspace.emptyConversationsTitle')}</strong>
            <p>{t('collection.workspace.emptyConversationsDetail')}</p>
          </span>
        </div>
      )}
    </section>
  );
}
