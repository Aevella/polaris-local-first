import { normalizeChatNativeToolCalls } from './chatMessageNormalization';
import type {
  ChatMessage,
  ToolInvocation,
  ToolInvocationStatus,
  ToolLedgerEntry
} from '../types/domain';
import { buildToolResultEvidence } from './toolResultEvidence';

type ToolLedgerSourceMessage = Pick<ChatMessage, 'id' | 'role' | 'nativeToolCalls' | 'toolInvocation'>;
type SettledToolLedgerEntry = ToolLedgerEntry & Required<Pick<
  ToolLedgerEntry,
  'resultMessageId' | 'resultStatus' | 'resultStructuredPayload'
>>;

const TERMINAL_TOOL_INVOCATION_STATUSES = new Set<ToolInvocationStatus>([
  'preview',
  'applied',
  'rolled_back',
  'superseded',
  'executed',
  'saved',
  'failed'
]);

export function isTerminalToolInvocationStatus(status: ToolInvocationStatus) {
  return TERMINAL_TOOL_INVOCATION_STATUSES.has(status);
}

export function isSettledToolLedgerEntry(entry: ToolLedgerEntry): entry is SettledToolLedgerEntry {
  return Boolean(
    entry.resultMessageId
    && entry.resultStatus
    && isTerminalToolInvocationStatus(entry.resultStatus)
    && entry.resultStructuredPayload
  );
}

function trimString(value: string | undefined) {
  return value?.trim() || null;
}

function findPendingToolLedgerEntry(args: {
  toolInvocation: ToolInvocation;
  pendingEntriesByAssistantMessageId: Map<string, ToolLedgerEntry[]>;
}) {
  const sourceMessageId = trimString(args.toolInvocation.originMessageId);
  if (!sourceMessageId) {
    return null;
  }

  const candidates = args.pendingEntriesByAssistantMessageId.get(sourceMessageId) ?? [];
  if (candidates.length === 0) {
    return null;
  }

  const exactToolName = args.toolInvocation.toolName ?? args.toolInvocation.kind;
  const exactMatch = candidates.find((entry) => entry.toolName === exactToolName) ?? null;
  if (exactMatch) {
    return exactMatch;
  }

  return candidates[0] ?? null;
}

function consumePendingToolLedgerEntry(
  pendingEntriesByAssistantMessageId: Map<string, ToolLedgerEntry[]>,
  entry: ToolLedgerEntry
) {
  const pendingEntries = pendingEntriesByAssistantMessageId.get(entry.assistantMessageId);
  if (!pendingEntries) {
    return;
  }

  const nextPendingEntries = pendingEntries.filter((candidate) => candidate.id !== entry.id);
  if (nextPendingEntries.length === 0) {
    pendingEntriesByAssistantMessageId.delete(entry.assistantMessageId);
    return;
  }

  pendingEntriesByAssistantMessageId.set(entry.assistantMessageId, nextPendingEntries);
}

export function rebuildConversationToolLedger(messages: ToolLedgerSourceMessage[]) {
  const entries: ToolLedgerEntry[] = [];
  const entriesByToolCallId = new Map<string, ToolLedgerEntry>();
  const pendingEntriesByAssistantMessageId = new Map<string, ToolLedgerEntry[]>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      const toolCalls = normalizeChatNativeToolCalls(message.id, message.nativeToolCalls) ?? [];
      if (toolCalls.length > 0) {
        const ledgerEntries = toolCalls
          .map((toolCall, index) => {
            const toolCallId = trimString(toolCall.id);
            if (!toolCallId) {
              return null;
            }

            const entry: ToolLedgerEntry = {
              id: `${message.id}:tool-ledger:${index + 1}`,
              toolCallId,
              assistantMessageId: message.id,
              order: index,
              toolName: toolCall.name,
              argumentsText: toolCall.argumentsText,
              sourceSpan: toolCall.sourceSpan,
              ...(toolCall.providerMetadata ? { providerMetadata: toolCall.providerMetadata } : {})
            };
            entriesByToolCallId.set(toolCallId, entry);
            return entry;
          })
          .filter((entry): entry is ToolLedgerEntry => entry !== null);

        if (ledgerEntries.length > 0) {
          entries.push(...ledgerEntries);
          pendingEntriesByAssistantMessageId.set(message.id, ledgerEntries);
        }
      }
    }

    const toolInvocation = message.toolInvocation;
    if (!toolInvocation) {
      continue;
    }
    if (!isTerminalToolInvocationStatus(toolInvocation.status)) {
      continue;
    }

    const explicitToolCallId = trimString(toolInvocation.toolCallId);
    const resolvedEntry =
      (explicitToolCallId ? entriesByToolCallId.get(explicitToolCallId) ?? null : null)
      ?? findPendingToolLedgerEntry({
        toolInvocation,
        pendingEntriesByAssistantMessageId
      });

    if (!resolvedEntry) {
      continue;
    }

    resolvedEntry.resultMessageId = message.id;
    resolvedEntry.resultToolName = toolInvocation.toolName ?? toolInvocation.kind;
    resolvedEntry.resultStatus = toolInvocation.status;
    resolvedEntry.resultIsError = toolInvocation.status === 'failed';
    resolvedEntry.resultSourceMessageId = toolInvocation.originMessageId;
    resolvedEntry.resultStructuredPayload = buildToolResultEvidence(toolInvocation);
    consumePendingToolLedgerEntry(pendingEntriesByAssistantMessageId, resolvedEntry);
  }

  return entries.length > 0 ? entries : undefined;
}
