import type { ChatProviderReasoningState, ChatTokenUsage } from '../../types/domain';
import type { AssistantReply } from './providerRuntimeTypes';

export type OpenAiToolCallAccumulator = {
  id?: string;
  name?: string;
  argumentsText: string;
  providerMetadata?: {
    geminiThoughtSignature?: string;
  };
  sourceSpan?: {
    transport: 'native';
    index: number;
  };
};

export type ReplyAccumulator = {
  content: string;
  thinkingText: string;
  providerReasoning?: ChatProviderReasoningState;
  model?: string;
  tokenCount?: number;
  tokenUsage?: ChatTokenUsage;
  toolCalls?: OpenAiToolCallAccumulator[];
  finishReason?: string;
  transportIncomplete?: boolean;
};

export function toAssistantReply(
  target: ReplyAccumulator,
  fallbackModel: string,
  options?: {
    allowThinkingFallbackInContent?: boolean;
  }
): AssistantReply {
  const allowThinkingFallbackInContent = options?.allowThinkingFallbackInContent ?? true;
  const hasVisibleContent = Boolean(target.content.trim());
  const normalizedContent = hasVisibleContent
    ? target.content
    : allowThinkingFallbackInContent
      ? target.thinkingText
      : '';
  const normalizedThinkingText = target.thinkingText.trim() ? target.thinkingText : undefined;
  const nativeToolCalls = (target.toolCalls ?? [])
    .filter((call): call is { id?: string; name: string; argumentsText: string; providerMetadata?: { geminiThoughtSignature?: string } } => Boolean(call.name?.trim()))
    .map((call) => ({
      id: call.id,
      name: call.name.trim(),
      argumentsText: call.argumentsText,
      ...(call.providerMetadata ? { providerMetadata: call.providerMetadata } : {})
    }));

  return {
    content: normalizedContent,
    model: target.model || fallbackModel,
    tokenCount: target.tokenCount,
    tokenUsage: target.tokenUsage,
    thinkingText: normalizedThinkingText,
    providerReasoning: target.providerReasoning,
    nativeToolCalls,
    usedNativeToolCalls: nativeToolCalls.length > 0,
    nativeToolCallCount: nativeToolCalls.length,
    finishReason: target.finishReason,
    transportIncomplete: target.transportIncomplete
  };
}
