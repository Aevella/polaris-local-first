import type { AssistantRequestContext } from '../../request/requestContext';
import type { ProviderCapability } from '../providerCapability';
import type { OrderedContextMessage } from './types';

type HistoricalToolCallLike = {
  id?: string;
  name: string;
  argumentsText: string;
};

export function extractTextPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : '';
    })
    .join('');
}

export function buildOrderedMessages(
  context: AssistantRequestContext,
  policy: Pick<ProviderCapability['context'], 'collapseSystemMessages' | 'deferVolatileSystemMessages' | 'omitVolatileSystemMessages'>
): OrderedContextMessage[] {
  const allMessages = context.segments.flatMap((segment) =>
    segment.messages.map((message) => ({
      ...message,
      contextSegmentKind: segment.kind
    }))
  );
  const rawSystemMessages = allMessages.filter((message) => message.role === 'system');
  const nonSystemMessages = allMessages.filter((message) => message.role !== 'system');

  if (policy.deferVolatileSystemMessages) {
    const stableSystemMessages = rawSystemMessages.filter(isStableSystemMessage);
    const volatileSystemMessages = rawSystemMessages.filter((message) => !isStableSystemMessage(message));
    // Keep the completed history cacheable without making recalled background
    // the apparent newest instruction. Tool calls/results remain together.
    let latestUserIndex = -1;
    for (let index = nonSystemMessages.length - 1; index >= 0; index -= 1) {
      const message = nonSystemMessages[index];
      if (message.role === 'user' && !message.promptPartName && !message.isToolTranscript) {
        latestUserIndex = index;
        break;
      }
    }
    const turnStart = latestUserIndex < 0 ? nonSystemMessages.length : latestUserIndex;
    const clockIndex = nonSystemMessages.findIndex((message) => message.promptPartName === 'runtime_clock_context');
    const insertionIndex = clockIndex < 0 ? turnStart : Math.min(turnStart, clockIndex);
    return [
      ...buildSystemMessageGroup(stableSystemMessages, policy),
      ...nonSystemMessages.slice(0, insertionIndex),
      ...(
        policy.omitVolatileSystemMessages
          ? buildSystemMessageGroup(volatileSystemMessages.filter(shouldKeepDeepSeekVolatileSystemMessage), policy)
          : buildSystemMessageGroup(volatileSystemMessages, policy)
      ),
      ...nonSystemMessages.slice(insertionIndex)
    ];
  }

  return [
    ...buildSystemMessageGroup(rawSystemMessages, policy),
    ...nonSystemMessages
  ];
}

/** Protocols with a separate system field cannot leave moving background there. */
export function buildSeparatedSystemMessages(context: AssistantRequestContext): OrderedContextMessage[] {
  return buildOrderedMessages(context, {
    collapseSystemMessages: false,
    deferVolatileSystemMessages: true,
    omitVolatileSystemMessages: false
  }).map((message) => message.role === 'system' && !isStableSystemMessage(message)
    ? {
        ...message,
        role: 'user' as const,
        content: `[request_context]\n以下是本轮应用背景，不是用户的新消息。\n${extractTextPayload(message.content)}\n[/request_context]`
      }
    : message);
}

export function isStableSystemMessage(message: OrderedContextMessage) {
  return (
    message.cachePrefixEligible === true
    || message.promptPartLayer === 'identity'
    || message.promptPartLayer === 'capability'
    || (message.promptPartLayer === undefined && message.contextSegmentKind === 'system')
  );
}

function shouldKeepDeepSeekVolatileSystemMessage(message: OrderedContextMessage) {
  return message.contextSegmentKind === 'semantic_recall';
}

function buildSystemMessageGroup(
  messages: OrderedContextMessage[],
  policy: Pick<ProviderCapability['context'], 'collapseSystemMessages'>
): OrderedContextMessage[] {
  if (!messages.length) return [];

  return policy.collapseSystemMessages
    ? [{
        role: 'system' as const,
        content: messages
          .map((message) => extractTextPayload(message.content))
          .filter(Boolean)
          .join('\n\n')
      }].filter((message) => message.content)
    : messages;
}

export function normalizeHistoricalToolCallName(toolCall: HistoricalToolCallLike) {
  return toolCall.name;
}

export function normalizeHistoricalProjectFileToolName(name: string | undefined) {
  switch (name) {
    case 'appendProjectFile':
    case 'insertProjectFile':
    case 'replaceProjectFileLines':
    case 'writeProjectFiles':
    case 'patchRoomProject':
    case 'listProjectFiles':
    case 'searchProjectFiles':
    case 'checkProjectPreview':
    case 'inspectProjectRuntime':
    case 'editProjectFileText':
    case 'deleteProjectFile':
    case 'readProjectFile':
    case 'readProjectFileContext':
      return name;
    default:
      return null;
  }
}

export function buildHistoricalToolCallNameMap(messages: OrderedContextMessage[]) {
  const normalizedNames = new Map<string, string>();

  messages.forEach((message) => {
    const toolResult = message.toolResult;
    if (!toolResult) return;

    const explicitProjectFileName =
      normalizeHistoricalProjectFileToolName(
        typeof toolResult.structuredPayload.kind === 'string' ? toolResult.structuredPayload.kind : undefined
      )
      ?? normalizeHistoricalProjectFileToolName(toolResult.toolName);

    if (!explicitProjectFileName) return;
    normalizedNames.set(toolResult.toolCallId, explicitProjectFileName);
  });

  messages.forEach((message) => {
    message.toolCalls?.forEach((toolCall) => {
      if (!toolCall.id) return;
      if (normalizedNames.has(toolCall.id)) return;
      normalizedNames.set(toolCall.id, normalizeHistoricalToolCallName(toolCall));
    });
  });

  return normalizedNames;
}
