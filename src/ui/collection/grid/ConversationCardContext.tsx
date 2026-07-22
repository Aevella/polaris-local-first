import { createContext, useContext } from 'react';

type ConversationCardContextValue = {
  collaboratorNameById: Record<string, string>;
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

const ConversationCardContext = createContext<ConversationCardContextValue | null>(null);

export function ConversationCardProvider(props: {
  value: ConversationCardContextValue;
  children: React.ReactNode;
}) {
  return <ConversationCardContext.Provider value={props.value}>{props.children}</ConversationCardContext.Provider>;
}

export function useConversationCardContext() {
  const value = useContext(ConversationCardContext);
  if (!value) {
    throw new Error('useConversationCardContext must be used within ConversationCardProvider');
  }
  return value;
}
