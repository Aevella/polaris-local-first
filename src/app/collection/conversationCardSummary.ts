import { resolveConversationCollaboratorId } from '../../engines/conversationOwnership';
import type { AppLanguage } from '../../i18n';
import { createTranslator } from '../../i18n';
import { displayConversationTitle } from '../../stores/chatStoreTitles';
import type { Conversation } from '../../types/domain';
import type { ConversationMessageSearchResult } from './conversationMessageSearch';

export type ConversationCardSummary = {
  id: string;
  title: string;
  displayTitle: string;
  collaboratorId: string | null;
  activeProjectId: string | null;
  activeProjectTitle: string | null;
  messageCount: number;
  updatedAt: number;
  pinnedAt: number | null;
  latestExcerpt: string;
  searchMatches: ConversationMessageSearchResult | null;
};

function resolveLatestConversationExcerpt(conversation: Conversation, language: AppLanguage) {
  const { t } = createTranslator(language);
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    const content = message?.content.trim();
    if (content) return content;
  }
  return t('collection.conversation.emptyExcerpt');
}

export function buildConversationCardSummary(
  conversation: Conversation,
  options: {
    language?: AppLanguage;
  } = {}
): ConversationCardSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    displayTitle: displayConversationTitle(conversation),
    collaboratorId: resolveConversationCollaboratorId(conversation),
    activeProjectId: conversation.activeProjectId ?? null,
    activeProjectTitle: null,
    messageCount: conversation.messages.length,
    updatedAt: conversation.updatedAt,
    pinnedAt: conversation.pinnedAt ?? null,
    latestExcerpt: resolveLatestConversationExcerpt(conversation, options.language ?? 'zh-CN'),
    searchMatches: null
  };
}
