import { memo } from 'react';
import type { ConversationCardSummary } from '../../../app/collection/conversationCardSummary';
import { useI18n } from '../../../i18n';
import { Icon } from '../../Icon';
import { runImpactAction, runSelectionAction } from '../../haptics';
import { useConversationCardContext } from './ConversationCardContext';
import { useSwipeDelete } from './useSwipeDelete';
import { useTapIntentGuard } from '../useTapIntentGuard';
import { collectionArchiveDateLabel, collectionRelativeDateLabel } from '../collectionUtils';

type ConversationCardItemProps = {
  conversation: ConversationCardSummary;
  cardsExpanded: boolean;
};

export const ConversationCardItem = memo(function ConversationCardItem({
  conversation,
  cardsExpanded
}: ConversationCardItemProps) {
  const { t, language, formatNumber } = useI18n();
  const {
    collaboratorNameById,
    projectTitleById,
    activeConversationId,
    editingConversationId,
    conversationTitleDraft,
    onConversationTitleDraftChange,
    onStartConversationRename,
    onCommitConversationRename,
    onCancelConversationRename,
    onConversationPinToggle,
    onConversationDelete,
    onOpenConversation,
    onOpenConversationMessage
  } = useConversationCardContext();
  const collaboratorName = conversation.collaboratorId
    ? collaboratorNameById[conversation.collaboratorId] ?? '?'
    : t('collection.dialogue.unassignedHistory');
  const workspaceTitle = conversation.activeProjectId
    ? projectTitleById[conversation.activeProjectId] ?? t('common.untitledWorkspace')
    : null;
  const isEditing = editingConversationId === conversation.id;
  const isActive = conversation.id === activeConversationId;
  const inlineStateLabels = [
    workspaceTitle ? { label: t('common.workspace'), kind: 'workspace' } : null
  ].filter((entry): entry is { label: string; kind: string } => Boolean(entry));
  const hasInlineStateLabels = inlineStateLabels.length > 0;
  const conversationTitle = conversation.displayTitle;
  const swipeDelete = useSwipeDelete(isEditing);
  const tapIntent = useTapIntentGuard();
  const handleDelete = (element?: HTMLElement | null) => {
    runImpactAction(() => {
      swipeDelete.close();
      onConversationDelete(conversation.id, conversation.title);
    }, element ? { element } : undefined);
  };
  const handleOpenConversation = (element?: HTMLElement | null) => {
    if (swipeDelete.open) {
      swipeDelete.close();
      return;
    }
    swipeDelete.close();
    runSelectionAction(() => onOpenConversation(conversation.id), element ? { element } : undefined);
  };
  const handleOpenMessageMatch = (messageId: string, element?: HTMLElement | null) => {
    if (swipeDelete.open) {
      swipeDelete.close();
      return;
    }
    swipeDelete.close();
    runSelectionAction(() => {
      if (onOpenConversationMessage) {
        onOpenConversationMessage(conversation.id, messageId);
        return;
      }
      onOpenConversation(conversation.id);
    }, element ? { element } : undefined);
  };

  const searchMatches = cardsExpanded ? conversation.searchMatches : null;
  const visibleSearchMatches = searchMatches?.matches ?? [];
  const hiddenSearchMatchCount = Math.max(0, (searchMatches?.total ?? 0) - visibleSearchMatches.length);
  const searchRoleLabel = (role: (typeof visibleSearchMatches)[number]['role']) => {
    if (role === 'user') return t('collection.dialogue.searchRole.user');
    if (role === 'assistant') return collaboratorName;
    return t('collection.dialogue.searchRole.system');
  };

  const detailExpanded = isEditing || cardsExpanded;

  return (
    <article
      className={`card conversation-card ${isActive ? 'active' : ''} ${conversation.pinnedAt ? 'pinned' : ''} ${isEditing ? 'editing' : ''} ${detailExpanded ? 'expanded' : 'collapsed'} ${cardsExpanded ? 'search-expanded' : 'search-collapsed'} ${cardsExpanded ? 'detail-static' : 'detail-animated'} ${swipeDelete.open ? 'swipe-open' : ''} ${swipeDelete.dragging ? 'swiping' : ''}`}
      style={swipeDelete.style}
      {...swipeDelete.swipeProps}
    >
      <button
        type="button"
        className="conversation-card-swipe-delete"
        data-swipe-delete-action="true"
        onClick={(event) => handleDelete(event.currentTarget)}
        aria-label={t('collection.dialogue.deleteAria', { title: conversationTitle })}
      >
        {t('collection.dialogue.delete')}
      </button>
      <div className="conversation-card-swipe-surface">
        <div className="conversation-card-thread-mark" aria-hidden="true" />
        <div className="conversation-card-head">
          <div className="card-meta-row">
            <div className="conversation-card-meta-copy">
              <small className="conversation-card-persona">{collaboratorName}</small>
              {workspaceTitle && (
                <small className="conversation-card-workspace-badge">{t('collection.dialogue.workspaceBadge', { title: workspaceTitle })}</small>
              )}
            </div>
            <small className="conversation-card-updated">{conversation.pinnedAt ? t('common.pinned') : collectionRelativeDateLabel(conversation.updatedAt, language)}</small>
          </div>
          <div className="conversation-card-actions" data-swipe-delete-ignore="true">
            <button
              type="button"
              className={`micro-action-btn ${conversation.pinnedAt ? 'active' : ''}`}
              onClick={(event) => {
                runSelectionAction(() => onConversationPinToggle(conversation.id), { element: event.currentTarget });
              }}
              title={conversation.pinnedAt ? t('collection.dialogue.unpin') : t('collection.dialogue.pin')}
            >
              <Icon name="pin" size={14} />
            </button>
            <button
              type="button"
              className="micro-action-btn danger"
              onClick={(event) => handleDelete(event.currentTarget)}
              title={t('collection.dialogue.delete')}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>

        {isEditing ? (
          <div className="conversation-card-edit" data-swipe-delete-ignore="true">
            <input
              value={conversationTitleDraft}
              onChange={(event) => onConversationTitleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  runImpactAction(() => onCommitConversationRename(conversation.id), { settle: 'none' });
                } else if (event.key === 'Escape') {
                  runSelectionAction(onCancelConversationRename, { settle: 'none' });
                }
              }}
              autoFocus
            />
            <div className="conversation-card-edit-actions">
              <button type="button" className="btn-secondary compact-btn" onClick={(event) => {
                runImpactAction(() => onCommitConversationRename(conversation.id), { element: event.currentTarget });
              }}>
                {t('collection.dialogue.save')}
              </button>
              <button type="button" className="btn-secondary compact-btn" onClick={(event) => {
                runSelectionAction(onCancelConversationRename, { element: event.currentTarget });
              }}>
                {t('collection.dialogue.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="conversation-card-main"
            role="button"
            tabIndex={0}
            onPointerDown={tapIntent.handlePointerDown}
            onPointerMove={tapIntent.handlePointerMove}
            onPointerUp={tapIntent.handlePointerEnd}
            onPointerCancel={tapIntent.handlePointerEnd}
            onClick={(event) => {
              if (!tapIntent.shouldAllowTap()) return;
              handleOpenConversation(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              handleOpenConversation(event.currentTarget);
            }}
          >
            <div className="conversation-card-copy">
              <div className={`conversation-card-title-row ${hasInlineStateLabels ? 'has-inline-states' : ''}`}>
                <small className={`conversation-card-archive-date ${conversation.pinnedAt ? 'pinned' : ''}`}>
                  {conversation.pinnedAt ? <Icon name="polarisStar" size={10} /> : null}
                  <span>{collectionArchiveDateLabel(conversation.updatedAt)}</span>
                </small>
                <div className="conversation-card-title-line">
                  <h3>{conversationTitle}</h3>
                  {cardsExpanded ? (
                    <button
                      type="button"
                      className="conversation-card-title-rename micro-action-btn"
                      data-swipe-delete-ignore="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        runSelectionAction(() => onStartConversationRename(conversation.id, conversation.title), { element: event.currentTarget });
                      }}
                      title={t('collection.dialogue.rename')}
                      aria-label={t('collection.dialogue.renameAria', { title: conversationTitle })}
                    >
                      <Icon name="edit" size={12} />
                    </button>
                  ) : null}
                </div>
                {hasInlineStateLabels && (
                  <span className="conversation-card-inline-states">
                    {inlineStateLabels.map(({ label, kind }) => (
                      <span key={`${kind}-${label}`} className={`conversation-card-state ${kind}`}>
                        {label}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className={`conversation-card-detail ${detailExpanded ? 'expanded' : 'collapsed'}`}>
                <p className="conversation-excerpt">{conversation.latestExcerpt}</p>
                {visibleSearchMatches.length > 0 ? (
                  <div className="conversation-message-search-matches" data-swipe-delete-ignore="true">
                    <div className="conversation-message-search-meta">
                      {t('collection.dialogue.searchMatchCount', {
                        count: formatNumber(searchMatches?.total ?? visibleSearchMatches.length)
                      })}
                    </div>
                    {visibleSearchMatches.map((match) => (
                      <button
                        key={match.messageId}
                        type="button"
                        className="conversation-message-search-match"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenMessageMatch(match.messageId, event.currentTarget);
                        }}
                        aria-label={t('collection.dialogue.searchOpenMessageAria', { title: conversationTitle })}
                      >
                        <span className="conversation-message-search-role">{searchRoleLabel(match.role)}</span>
                        <span className="conversation-message-search-excerpt">{match.excerpt}</span>
                      </button>
                    ))}
                    {hiddenSearchMatchCount > 0 ? (
                      <span className="conversation-message-search-more">
                        {t('collection.dialogue.searchHiddenCount', { count: formatNumber(hiddenSearchMatchCount) })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="conversation-stats">
              <span>{t('collection.dialogue.messageCount', { count: formatNumber(conversation.messageCount) })}</span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
});
