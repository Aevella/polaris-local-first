import type { AssistantReply, AssistantReplyProgress } from './chat-api/chatApiTypes';
import type { ChatMessage, ChatNativeToolCall } from '../types/domain';
import { normalizeProviderReasoningState } from './provider-runtime/providerRuntimeReasoningState';

export type NormalizedChatNativeToolCall = ChatNativeToolCall & { id: string };

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? value : undefined;
}

function normalizeToolCallProviderMetadata(metadata: ChatNativeToolCall['providerMetadata']) {
  const geminiThoughtSignature = normalizeOptionalText(metadata?.geminiThoughtSignature);
  return geminiThoughtSignature ? { geminiThoughtSignature } : undefined;
}

export function normalizeChatNativeToolCalls(
  messageId: string,
  nativeToolCalls: ChatNativeToolCall[] | undefined
): NormalizedChatNativeToolCall[] | undefined {
  if (!nativeToolCalls?.length) {
    return undefined;
  }

  const normalized = nativeToolCalls
    .filter((toolCall) => toolCall.name.trim())
    .map((toolCall, index) => ({
      id: toolCall.id?.trim() || `${messageId}:tool-call:${index + 1}`,
      name: toolCall.name.trim(),
      argumentsText: toolCall.argumentsText,
      ...(normalizeToolCallProviderMetadata(toolCall.providerMetadata)
        ? { providerMetadata: normalizeToolCallProviderMetadata(toolCall.providerMetadata) }
        : {}),
      sourceSpan: toolCall.sourceSpan ?? {
        transport: 'native' as const,
        index
      }
    }));

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const providerReasoning = normalizeProviderReasoningState(message.providerReasoning);
  return {
    ...message,
    thinkingText: normalizeOptionalText(message.thinkingText),
    ...(providerReasoning ? { providerReasoning } : {}),
    nativeToolCalls: normalizeChatNativeToolCalls(message.id, message.nativeToolCalls)
  };
}

type AssistantReplyLike = Pick<
  AssistantReply | AssistantReplyProgress,
  'model' | 'tokenCount' | 'tokenUsage' | 'thinkingText' | 'providerReasoning'
>;

export function buildAssistantMessagePatch(args: {
  messageId: string;
  assistantName: string;
  speakerCollaboratorId?: string;
  providerId?: string;
  providerName?: string;
  visibleContent: string;
  reply: AssistantReplyLike;
  nativeToolCalls?: ChatNativeToolCall[];
  memoryEvidence?: ChatMessage['memoryEvidence'];
}): Partial<ChatMessage> {
  const providerReasoning = normalizeProviderReasoningState(args.reply.providerReasoning);
  const patch: Partial<ChatMessage> = {
    content: args.visibleContent,
    providerId: args.providerId,
    providerName: args.providerName,
    model: args.reply.model,
    tokenCount: args.reply.tokenCount,
    assistantName: args.assistantName,
    speakerCollaboratorId: args.speakerCollaboratorId,
    thinkingText: normalizeOptionalText(args.reply.thinkingText),
    ...(providerReasoning ? { providerReasoning } : {}),
    nativeToolCalls: normalizeChatNativeToolCalls(args.messageId, args.nativeToolCalls)
  };
  if (args.reply.tokenUsage) {
    patch.tokenUsage = args.reply.tokenUsage;
  }
  if (args.memoryEvidence) {
    patch.memoryEvidence = args.memoryEvidence;
  }
  return patch;
}
