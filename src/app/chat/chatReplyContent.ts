import type { AssistantNativeToolCall } from '../../engines/chatApi';
import { stripCodeBlocksFromMessage } from '../../engines/codeCardText';
import type { ChatMessage, ModelTier, ThemeToolMode } from '../../types/domain';
import type { WritableConversationBody } from '../../stores/chatStore';
import { createMessage } from '../../engines/chatMessageFactory';
import {
  buildToolOnlyFallback,
  mergeNativeToolCallDraftCodeIntoVisibleContent,
  mergeToolActionCodeIntoVisibleContent,
  projectToolDraftBlocksAsCode,
  stripToolDraftBlocks
} from './chatReplyContentProjection';
import { normalizeReplySpacing } from '../../engines/replyText';
import type { McpResolvedToolDefinition } from '../../engines/mcpRuntime';
import { resolveAssistantToolIngress } from './chatToolActionIngress';

type StartAssistantPlaceholderArgs = {
  writableConversation: WritableConversationBody;
  placeholderId: string;
  assistantName: string;
  speakerCollaboratorId?: string;
  addMessage: (target: WritableConversationBody, message: ChatMessage) => void;
  setStreamingMessageId: (messageId: string) => void;
};

function hasUnclosedToolDraftBlock(content: string) {
  const trimmed = content.trim();
  if (!trimmed.includes('```polaris-tools') && !trimmed.includes('```polaris_tools')) return false;
  return ((trimmed.match(/```/g) ?? []).length % 2) === 1;
}

export function startAssistantPlaceholder({
  writableConversation,
  placeholderId,
  assistantName,
  speakerCollaboratorId,
  addMessage,
  setStreamingMessageId
}: StartAssistantPlaceholderArgs) {
  setStreamingMessageId(placeholderId);
  addMessage(writableConversation, {
    ...createMessage('assistant', '', undefined, 'assistant-reply'),
    id: placeholderId,
    assistantName,
    speakerCollaboratorId
  });
}

export function parseAssistantReplyContent(
  content: string,
  modelTier: ModelTier = 'medium',
  themeToolMode: ThemeToolMode = 'stable',
  phase: 'streaming' | 'final' = 'final',
  nativeToolCalls: AssistantNativeToolCall[] = [],
  ignoredUnknownNativeToolNames: string[] = [],
  options: {
    hasWorkspaceContext?: boolean;
    activeProjectId?: string | null;
    allowCreativeCssRecovery?: boolean;
    mcpTools?: McpResolvedToolDefinition[];
  } = {}
) {
  const {
    parsed: effectiveParsed,
    sources: ingressSources,
    sanitizedContent,
    taskUpdate
  } = resolveAssistantToolIngress({
    content,
    modelTier,
    themeToolMode,
    phase,
    nativeToolCalls,
    ignoredUnknownNativeToolNames,
    ...options
  });
  const visibleFallback =
    phase === 'streaming'
      ? projectToolDraftBlocksAsCode(sanitizedContent)
      : stripToolDraftBlocks(sanitizedContent);
  const shouldProjectActionCode =
    !(phase === 'streaming' && nativeToolCalls.length > 0);
  const visibleWithCodeProjection = shouldProjectActionCode
    ? mergeToolActionCodeIntoVisibleContent(effectiveParsed.displayContent, effectiveParsed.actions, {
        excludeProjectFileWrites: phase === 'final'
      })
    : normalizeReplySpacing(effectiveParsed.displayContent);
  const shouldProjectNativeDraftCode =
    nativeToolCalls.length > 0
    && (
      phase === 'streaming'
      || effectiveParsed.actions.length === 0
      || effectiveParsed.issues.length > 0
    );
  const visibleWithNativeDraftProjection =
    shouldProjectNativeDraftCode
      ? mergeNativeToolCallDraftCodeIntoVisibleContent(visibleWithCodeProjection, nativeToolCalls)
      : visibleWithCodeProjection;
  const streamingDraftProjection =
    phase === 'streaming' && effectiveParsed.actions.length === 0 && hasUnclosedToolDraftBlock(sanitizedContent)
      ? projectToolDraftBlocksAsCode(sanitizedContent)
      : '';
  const shouldUseStreamingDraftProjection =
    streamingDraftProjection.includes('```')
    && !streamingDraftProjection.includes('```polaris-tools');
  const hasToolDraft = effectiveParsed.actions.length > 0 || nativeToolCalls.length > 0;
  const normalizedBaseNarration = normalizeReplySpacing(
    stripCodeBlocksFromMessage(stripToolDraftBlocks(effectiveParsed.displayContent))
  );
  const normalizedProjectedVisible = normalizeReplySpacing(
    shouldUseStreamingDraftProjection
      ? streamingDraftProjection
      : visibleWithNativeDraftProjection
  );
  const normalizedStreamingFallback = normalizeReplySpacing(visibleFallback || sanitizedContent);
  const isToolOnlyTurn =
    phase === 'final'
    && hasToolDraft
    && !normalizedBaseNarration;
  const visibleContent =
    normalizedProjectedVisible ||
    (
      phase === 'streaming'
        ? normalizedStreamingFallback
        : hasToolDraft
          ? buildToolOnlyFallback(effectiveParsed.actions)
          : normalizedStreamingFallback
    );

  return {
    parsed: effectiveParsed,
    toolIngressSources: ingressSources,
    visibleContent,
    isToolOnlyTurn,
    taskUpdate
  };
}
