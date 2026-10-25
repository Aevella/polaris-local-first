import type { ChatMessage, CodeCard, ChatCardReference } from '../../types/domain';
import { readMessageCodeBlocks, isThemeCssCodeBlock, hasThemeCssProjectionToolCall } from './chatCodeBlockSemantics';

export type CodeCardActionMode = 'hidden' | 'save' | 'open';
export type CodeCardMessageProgress = { saved: number; total: number };

/** Collection identity invalidates the reader; unchanged message objects retain their result. */
export function createCodeCardProjectionReader(cards: CodeCard[]) {
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const savedCodes = new Set(cards.filter(card => card.source === 'chat-generated').map(card => card.code.trim()).filter(Boolean));
  const origins = new Map<string, Set<number>>();
  for (const card of cards) {
    if (!card.originConversationId || !card.originMessageId) continue;
    const key = JSON.stringify([card.originConversationId, card.originMessageId]);
    const indexes = origins.get(key) ?? new Set<number>();
    indexes.add(card.originBlockIndex ?? 0);
    origins.set(key, indexes);
  }
  const cache = new WeakMap<ChatMessage, { conversationId: string; reference: ChatCardReference | null; mode: CodeCardActionMode; progress: CodeCardMessageProgress }>();
  return (conversationId: string, messages: ChatMessage[]) => {
    const modes: Record<string, CodeCardActionMode> = {};
    const progress: Record<string, CodeCardMessageProgress> = {};
    let reference: ChatCardReference | null = null;
    for (const message of messages) {
      if (message.role === 'user') {
        reference = message.cardReference?.mode === 'continue' ? message.cardReference : null;
        continue;
      }
      if (message.role !== 'assistant' || message.toolInvocation) continue;
      const precedingReference = reference;
      reference = null;
      const cached = cache.get(message);
      if (cached?.conversationId === conversationId && cached.reference === precedingReference) {
        modes[message.id] = cached.mode;
        progress[message.id] = cached.progress;
        continue;
      }
      const blocks = readMessageCodeBlocks(message);
      if (!blocks.length) continue;
      const target = precedingReference ? cardsById.get(precedingReference.id) : undefined;
      const saved = target
        ? Number(blocks[0]!.code.trim() === target.code.trim())
        : blocks.filter(block => origins.get(JSON.stringify([conversationId, message.id]))?.has(block.blockIndex) || savedCodes.has(block.code.trim())).length;
      const result = { saved, total: target ? 1 : blocks.length };
      const mode: CodeCardActionMode = blocks.every(isThemeCssCodeBlock) && hasThemeCssProjectionToolCall(message.nativeToolCalls)
        ? 'hidden' : saved === result.total ? 'open' : 'save';
      cache.set(message, { conversationId, reference: precedingReference, mode, progress: result });
      modes[message.id] = mode;
      progress[message.id] = result;
    }
    return { codeCardActionModeByMessageId: modes, codeCardProgressByMessageId: progress };
  };
}
