import { useMemo } from 'react';
import { buildConversationCardSummary } from '../../../app/collection/conversationCardSummary';
import type { ConversationMessageSearchIndex } from '../../../app/collection/conversationMessageSearch';
import { useI18n } from '../../../i18n';
import type { Conversation, Persona } from '../../../types/domain';
import { ConversationCardProvider } from './ConversationCardContext';
import { ConversationCardItem } from './ConversationCardItem';
import { useVirtualCardWindow } from './useVirtualCardWindow';

type ConversationCardGridProps = {
  cardsExpanded: boolean;
  conversations: Conversation[];
  conversationMessageSearchIndex?: ConversationMessageSearchIndex;
  personas: Persona[];
  projectTitleById: Record<string, string>;
  activeConversationId: string | null;
  editingConversationId: string | null;
  conversationTitleDraft: string;
  onConversationTitleDraftChange: (value: string) => void;
  onStartConversationRename: (conversationId: string, currentTitle: string) => void;
  onCommitConversationRename: (conversationId: string) => void;
  onCancelConversationRename: () => void;
  onConversationPinToggle: (conversationId: string) => void;
  onConversationDelete: (conversationId: string, title: string) => void;
  onOpenConversation: (conversationId: string) => void;
  onOpenConversationMessage?: (conversationId: string, messageId: string) => void;
};

export function ConversationCardGrid({
  cardsExpanded,
  conversations,
  conversationMessageSearchIndex,
  personas,
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
}: ConversationCardGridProps) {
  const { t, language } = useI18n();
  const listDensity = conversations.length > 8 ? 'cards-heavy' : 'cards-normal';
  const hasMessageSearchMatches = Object.keys(conversationMessageSearchIndex ?? {}).length > 0;
  const virtualWindow = useVirtualCardWindow({
    itemCount: conversations.length,
    estimateRowHeight: cardsExpanded ? (hasMessageSearchMatches ? 226 : 154) : 54,
    overscanRows: cardsExpanded ? 5 : 10
  });
  const visibleConversations = useMemo(
    () => conversations.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [conversations, virtualWindow.endIndex, virtualWindow.startIndex]
  );
  const visibleConversationSummaries = useMemo(
    () =>
      visibleConversations.map((conversation) => ({
        ...buildConversationCardSummary(conversation, { language }),
        searchMatches: conversationMessageSearchIndex?.[conversation.id] ?? null
      })),
    [
      conversationMessageSearchIndex,
      language,
      visibleConversations
    ]
  );
  const collaboratorNameById = useMemo(
    () => Object.fromEntries(personas.map((persona) => [persona.id, persona.name])) as Record<string, string>,
    [personas]
  );
  const contextValue = useMemo(
    () => ({
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
    }),
    [
      activeConversationId,
      collaboratorNameById,
      conversationTitleDraft,
      editingConversationId,
      onCancelConversationRename,
      onCommitConversationRename,
      onConversationDelete,
      onConversationPinToggle,
      onConversationTitleDraftChange,
      onOpenConversationMessage,
      onOpenConversation,
      onStartConversationRename,
      projectTitleById
    ]
  );

  return (
    <ConversationCardProvider value={contextValue}>
      <div
        ref={virtualWindow.containerRef}
        className={`conversation-card-list ${cardsExpanded ? 'search-open' : 'search-closed'} ${listDensity}`}
      >
        {virtualWindow.topSpacerHeight > 0 ? (
          <div
            className="collection-virtual-spacer"
            style={{ height: virtualWindow.topSpacerHeight }}
            aria-hidden="true"
          />
        ) : null}

        {visibleConversationSummaries.map((conversation) => (
          <ConversationCardItem
            key={conversation.id}
            conversation={conversation}
            cardsExpanded={cardsExpanded}
          />
        ))}

        {virtualWindow.bottomSpacerHeight > 0 ? (
          <div
            className="collection-virtual-spacer"
            style={{ height: virtualWindow.bottomSpacerHeight }}
            aria-hidden="true"
          />
        ) : null}

        {conversations.length === 0 && (
          <div className="empty-state-floating collection-shelf-empty-state dialogue-empty-state">
            <p className="empty-state-title">{t('collection.dialogue.emptyTitle')}</p>
          </div>
        )}
      </div>
    </ConversationCardProvider>
  );
}
