import type {
  ChatAttachment,
  ChatCardReference,
  ChatMessage,
  ChatNativeToolCall,
  ChatProviderReasoningState,
  ToolInvocation
} from '../../types/domain';
import {
  buildProviderFailureRequestContent,
  isProviderFailureDiagnosticMessage
} from '../providerErrorHandling';

export type RequestAttachment = ChatAttachment & { dataUrl?: string };

export type RequestMessage = {
  id: string;
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  origin?: ChatMessage['origin'];
  thinkingText?: string;
  providerReasoning?: ChatProviderReasoningState;
  attachments?: RequestAttachment[];
  nativeToolCalls?: ChatNativeToolCall[];
  toolInvocation?: ToolInvocation;
  cardReference?: ChatCardReference;
};

function isLocalProviderFailureBubble(message: ChatMessage) {
  return (
    message.role === 'assistant'
    && message.origin === 'assistant-reply'
    && !message.toolInvocation
    && (message.nativeToolCalls?.length ?? 0) === 0
    && !message.providerId
    && !message.providerName
    && !message.model
    && !message.tokenUsage
    && isProviderFailureDiagnosticMessage(message.content)
  );
}

export function toRequestMessage(message: ChatMessage): RequestMessage {
  if (isLocalProviderFailureBubble(message)) {
    return {
      id: message.id,
      role: 'system',
      content: buildProviderFailureRequestContent(message.content),
      timestamp: message.timestamp,
      origin: message.origin
    };
  }

  return {
    id: message.id,
    role: message.requestRole ?? message.role,
    content: message.requestContent ?? message.content,
    timestamp: message.timestamp,
    origin: message.origin,
    thinkingText: message.thinkingText,
    ...(message.providerReasoning ? { providerReasoning: message.providerReasoning } : {}),
    attachments: message.attachments as RequestAttachment[] | undefined,
    nativeToolCalls: message.nativeToolCalls,
    toolInvocation: message.toolInvocation,
    cardReference: message.cardReference
  };
}
