import type { ChatDerivedState } from '../../../../app/chat/chatDerivedState';
import type { ChatStoreBindings } from '../../../../app/chat/useChatStoreBindings';
import { getConversationBodyState } from '../../../../stores/chatConversationBodyStatus';
import type { ChatUiState } from '../context/ChatUiState';
import { useCleanupEditingEffect } from './useCleanupEditingEffect';
import { useCleanupExpandedCodeEffect } from './useCleanupExpandedCodeEffect';
import { useCleanupThinkingStateEffect } from './useCleanupThinkingStateEffect';
import { useFocusMessageEffect } from './useFocusMessageEffect';
import { useResetUiStateOnConversationChange } from './useResetUiStateOnConversationChange';

type UseChatProviderEffectsArgs = {
  ui: ChatUiState;
  store: ChatStoreBindings;
  derived: ChatDerivedState;
};

export function useChatProviderEffects({ ui, store, derived }: UseChatProviderEffectsArgs) {
  useResetUiStateOnConversationChange(store.chat.activeConversationId, ui);
  useCleanupEditingEffect(ui, derived.messages);
  useCleanupThinkingStateEffect(ui, derived.messages);
  useCleanupExpandedCodeEffect(ui, derived.messages);
  useFocusMessageEffect({
    focusedMessageId: derived.focusedMessageId,
    messageBodyReady: !derived.activeConversation
      || getConversationBodyState(store.chat, derived.activeConversation.id) === 'loaded',
    visibleMessages: derived.messages,
    setFocusedMessageTarget: store.space.setFocusedMessageTarget
  });
}
