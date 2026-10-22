import { selectSteppedRequestMessages } from '../conversationContextSettings';
import type { AssistantRequestAudit } from './requestAudit';
import { estimateConversationMessageTokens } from './requestTokenEstimation';
import {
  normalizeRequestContextMessageOrder,
  shouldKeepMessageInRequestContext
} from './requestContextMessages';
import type { RequestMessage } from './requestMessage';

type RequestContextUnit = {
  unitId: string;
  kind: AssistantRequestAudit['contextPlan']['units'][number]['kind'];
  messages: RequestMessage[];
  estimatedTokens: number;
  protectedMessageId: string | null;
};

function messageHasAssistantToolCalls(message: RequestMessage) {
  return message.role === 'assistant' && (message.nativeToolCalls?.length ?? 0) > 0;
}

function resolveRequestContextUnitKind(message: RequestMessage): RequestContextUnit['kind'] {
  if (message.role === 'user') return 'user_turn';
  if (message.role === 'assistant') {
    return messageHasAssistantToolCalls(message) ? 'assistant_tool_call' : 'assistant_turn';
  }
  if (message.toolInvocation) {
    return message.toolInvocation.originMessageId?.trim() ? 'tool_result' : 'orphaned_tool_result';
  }
  return 'system_feedback';
}

function buildRequestContextUnits(messages: RequestMessage[]) {
  const toolMessagesByOriginId = new Map<string, RequestMessage[]>();

  messages.forEach((message) => {
    const originMessageId = message.toolInvocation?.originMessageId?.trim();
    if (!originMessageId) return;
    const bucket = toolMessagesByOriginId.get(originMessageId) ?? [];
    bucket.push(message);
    toolMessagesByOriginId.set(originMessageId, bucket);
  });

  const groupedToolMessageIds = new Set(
    [...toolMessagesByOriginId.values()].flatMap((bucket) => bucket.map((message) => message.id))
  );

  return messages.flatMap((message) => {
    if (groupedToolMessageIds.has(message.id)) {
      return [];
    }

    if (!messageHasAssistantToolCalls(message)) {
      return [{
        unitId: message.id,
        kind: resolveRequestContextUnitKind(message),
        messages: [message],
        estimatedTokens: estimateConversationMessageTokens(message),
        protectedMessageId: message.role === 'user' ? message.id : null
      }];
    }

    const pairedToolMessages = toolMessagesByOriginId.get(message.id) ?? [];
    const groupedMessages = [message, ...pairedToolMessages];
    const protectedMessageId = groupedMessages.find((entry) => entry.role === 'user')?.id ?? null;

    return [{
      unitId: [message.id, ...pairedToolMessages.map((entry) => entry.id)].join('+'),
      kind: pairedToolMessages.length > 0 ? 'tool_pair' : 'assistant_tool_call',
      messages: groupedMessages,
      estimatedTokens: groupedMessages.reduce((total, entry) => total + estimateConversationMessageTokens(entry), 0),
      protectedMessageId
    }] satisfies RequestContextUnit[];
  });
}

function isConversationTextUnit(unit: RequestContextUnit) {
  return unit.kind === 'user_turn' || unit.kind === 'assistant_turn';
}

function isWorkspaceWorkflowUnit(unit: RequestContextUnit) {
  return !isConversationTextUnit(unit) && !isOrphanedToolResultUnit(unit);
}

function isOrphanedToolResultUnit(unit: RequestContextUnit) {
  return unit.kind === 'orphaned_tool_result';
}

function selectRequestContextMessageWindow(messages: RequestMessage[], messageLimit: number) {
  const selectedMessages = selectSteppedRequestMessages(messages, messageLimit);
  const selectedMessageIds = new Set(selectedMessages.map((message) => message.id));

  return selectedMessages.filter((message) => {
    const originMessageId = message.toolInvocation?.originMessageId?.trim();
    return !originMessageId || selectedMessageIds.has(originMessageId);
  });
}

function selectRequestContextUnitsWithinBudget(params: {
  units: ReturnType<typeof buildRequestContextUnits>;
  historyMaxTokens: number;
  protectedMessageId: string | null;
  historyMode: AssistantRequestAudit['contextPlan']['historyMode'];
}) {
  const { units, historyMaxTokens, protectedMessageId, historyMode } = params;
  const keptUnitIndexes = new Set<number>();
  let keptTokens = 0;
  let trimmedBudget = false;
  const keepUnit = (index: number) => {
    if (keptUnitIndexes.has(index)) return;
    keptUnitIndexes.add(index);
    keptTokens += units[index]?.estimatedTokens ?? 0;
  };

  const protectedUnitIndex = units.findIndex((unit) => (
      protectedMessageId !== null
      && unit.messages.some((message) => message.id === protectedMessageId)
  ));

  if (protectedUnitIndex >= 0) {
    const protectedUnit = units[protectedUnitIndex];
    if (protectedUnit && protectedUnit.estimatedTokens > historyMaxTokens) {
      trimmedBudget = true;
    }
    keepUnit(protectedUnitIndex);
  }

  const selectMatchingUnits = (matches: (unit: RequestContextUnit) => boolean) => {
    for (let index = units.length - 1; index >= 0; index -= 1) {
      const unit = units[index];
      if (!unit || keptUnitIndexes.has(index) || isOrphanedToolResultUnit(unit) || !matches(unit)) {
        continue;
      }

      if (keptTokens + unit.estimatedTokens > historyMaxTokens) {
        trimmedBudget = true;
        continue;
      }

      keepUnit(index);
    }
  };

  const priorityGroups =
    historyMode === 'workspace'
      ? [isWorkspaceWorkflowUnit, isConversationTextUnit]
      : [isConversationTextUnit, isWorkspaceWorkflowUnit];
  priorityGroups.forEach((matches) => selectMatchingUnits(matches));

  let lastNonOrphanUnitIndex = -1;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (unit && !isOrphanedToolResultUnit(unit)) {
      lastNonOrphanUnitIndex = index;
      break;
    }
  }
  if (keptUnitIndexes.size === 0 && lastNonOrphanUnitIndex >= 0) {
    trimmedBudget = true;
    keepUnit(lastNonOrphanUnitIndex);
  }

  return {
    keptUnitIndexes,
    keptTokens,
    trimmedBudget
  };
}

export function buildRequestContextPlan(args: {
  messages: RequestMessage[];
  messagesPrepared?: boolean;
  historyMaxTokens: number;
  messageLimit: number;
  historyMode?: AssistantRequestAudit['contextPlan']['historyMode'];
}): {
  conversation: RequestMessage[];
  contextPlan: AssistantRequestAudit['contextPlan'];
  historyDecision: AssistantRequestAudit['truncation']['history'];
} {
  const { historyMaxTokens, messageLimit, historyMode = 'conversation' } = args;
  const messages = args.messagesPrepared ? args.messages : normalizeRequestContextMessageOrder(args.messages);
  const historyBudget = historyMaxTokens;
  const estimatedTokensByMessageId = new Map<string, number>();
  const estimateMessageTokens = (message: RequestMessage) => {
    const cached = estimatedTokensByMessageId.get(message.id);
    if (typeof cached === 'number') {
      return cached;
    }

    const estimated = estimateConversationMessageTokens(message);
    estimatedTokensByMessageId.set(message.id, estimated);
    return estimated;
  };
  const requestContextMessages = messages.filter(shouldKeepMessageInRequestContext);
  const filteredMessages = selectRequestContextMessageWindow(requestContextMessages, messageLimit);
  const filteredMessageIds = new Set(filteredMessages.map((message) => message.id));
  const protectedMessageId = [...filteredMessages].reverse().find((message) => message.role === 'user')?.id ?? null;
  const requestUnits = buildRequestContextUnits(filteredMessages);
  const {
    keptUnitIndexes,
    keptTokens,
    trimmedBudget
  } = selectRequestContextUnitsWithinBudget({
    units: requestUnits,
    historyMaxTokens: historyBudget,
    protectedMessageId,
    historyMode
  });
  const conversation = requestUnits.flatMap((unit, index) => (
    keptUnitIndexes.has(index) && !isOrphanedToolResultUnit(unit) ? unit.messages : []
  ));
  const keptConversationMessageIds = new Set(conversation.map((message) => message.id));
  const fallbackProtectedId = protectedMessageId ? null : conversation[conversation.length - 1]?.id ?? null;
  const requestContextMessageIds = new Set(requestContextMessages.map((message) => message.id));
  const buildProtectedBy = (messageIds: string[]) => (
    messageIds.some((messageId) => messageId === protectedMessageId)
      ? 'current_user_message' as const
      : messageIds.some((messageId) => messageId === fallbackProtectedId)
        ? 'tail_fallback' as const
        : null
  );

  return {
    conversation,
    contextPlan: {
      protectedMessageId,
      historyMode,
      summaries: [],
      units: requestUnits.map((unit, index) => {
        const messageIds = unit.messages.map((message) => message.id);
        return {
          unitId: unit.unitId,
          kind: unit.kind,
          messageIds,
          estimatedTokens: unit.estimatedTokens,
          status: isOrphanedToolResultUnit(unit)
            ? 'dropped_orphaned_tool_result'
            : keptUnitIndexes.has(index)
              ? 'kept'
              : 'dropped_history_budget',
          protectedBy: buildProtectedBy(messageIds)
        };
      }),
      entries: messages.map((message) => {
        if (!requestContextMessageIds.has(message.id)) {
          return {
            messageId: message.id,
            role: message.role,
            estimatedTokens: estimateMessageTokens(message),
            status: 'dropped_tool_message' as const,
            protectedBy: null
          };
        }

        if (!filteredMessageIds.has(message.id)) {
          return {
            messageId: message.id,
            role: message.role,
            estimatedTokens: estimateMessageTokens(message),
            status: 'dropped_message_limit' as const,
            protectedBy: null
          };
        }

        if (!keptConversationMessageIds.has(message.id)) {
          if (message.toolInvocation && !message.toolInvocation.originMessageId?.trim()) {
            return {
              messageId: message.id,
              role: message.role,
              estimatedTokens: estimateMessageTokens(message),
              status: 'dropped_orphaned_tool_result' as const,
              protectedBy: null
            };
          }

          return {
            messageId: message.id,
            role: message.role,
            estimatedTokens: estimateMessageTokens(message),
            status: 'dropped_history_budget' as const,
            protectedBy: null
          };
        }

        return {
          messageId: message.id,
          role: message.role,
          estimatedTokens: estimateMessageTokens(message),
          status: 'kept' as const,
          protectedBy:
            message.id === protectedMessageId
              ? 'current_user_message'
              : message.id === fallbackProtectedId
                ? 'tail_fallback'
                : null
        };
      })
    },
    historyDecision: {
      maxTokens: historyBudget,
      estimatedTokens: keptTokens,
      keptMessageCount: conversation.length,
      droppedMessageCount: filteredMessages.length - conversation.length,
      remainingBudgetTokens: Math.max(0, historyBudget - keptTokens),
      status: trimmedBudget ? 'trimmed_budget' : 'kept'
    }
  };
}
