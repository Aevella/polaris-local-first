import type { ChatMessage, ConversationTaskState } from '../types/domain';

export type UserMessageTurnRemoval = {
  messages: ChatMessage[];
  removedMessageIds: string[];
};

function isUserTurnStart(message: ChatMessage) {
  return message.role === 'user' && !message.toolInvocation;
}

export function removeUserMessageTurn(
  messages: ChatMessage[],
  messageId: string
): UserMessageTurnRemoval | null {
  const startIndex = messages.findIndex((message) => message.id === messageId);
  const target = messages[startIndex];
  if (!target || !isUserTurnStart(target)) return null;

  const nextUserOffset = messages
    .slice(startIndex + 1)
    .findIndex(isUserTurnStart);
  const endIndex = nextUserOffset < 0
    ? messages.length
    : startIndex + 1 + nextUserOffset;
  const removedMessages = messages.slice(startIndex, endIndex);

  return {
    messages: [...messages.slice(0, startIndex), ...messages.slice(endIndex)],
    removedMessageIds: removedMessages.map((message) => message.id)
  };
}

export function reconcileConversationTaskAfterMessageRemoval(
  task: ConversationTaskState | null | undefined,
  removedMessageIds: Iterable<string>
): ConversationTaskState | null {
  if (!task) return null;
  const removedIds = new Set(removedMessageIds);
  if (removedIds.has(task.sourceMessageId)) return null;

  const executions = task.executions.filter((execution) => (
    !removedIds.has(execution.assistantMessageId)
    && !execution.resultMessageIds.some((messageId) => removedIds.has(messageId))
  ));
  const lastAssistantMessageId = task.lastAssistantMessageId
    && !removedIds.has(task.lastAssistantMessageId)
    ? task.lastAssistantMessageId
    : executions[executions.length - 1]?.assistantMessageId;

  if (
    executions.length === task.executions.length
    && lastAssistantMessageId === task.lastAssistantMessageId
  ) {
    return task;
  }

  return {
    ...task,
    executions,
    lastAssistantMessageId,
    updatedAt: Date.now()
  };
}

export function collectRemovedPendingProposalIds(
  task: ConversationTaskState | null | undefined,
  removedMessageIds: Iterable<string>
) {
  if (!task) return [];
  const removedIds = new Set(removedMessageIds);
  const removesTaskSource = removedIds.has(task.sourceMessageId);

  return task.executions
    .filter((execution) => (
      removesTaskSource
      || removedIds.has(execution.assistantMessageId)
      || execution.resultMessageIds.some((messageId) => removedIds.has(messageId))
    ))
    .flatMap((execution) => execution.pendingProposalIds);
}
