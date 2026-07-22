import type {
  ChatNativeToolCall,
  PersonaMemoryReferenceDoc,
  ToolLedgerEntry,
  ToolInvocationStatus,
  WorkspaceReferenceDoc
} from '../../types/domain';
import {
  buildConversationSummarySegment,
  buildMemorySegment,
  buildSemanticRecallSegment,
  buildWorkspaceReferenceSegment,
  buildMessageContent,
  normalizeMemoryReferenceDocs,
  normalizeMemoryLines,
  normalizeWorkspaceReferenceDocs
} from './requestContextContent';
import { normalizeRequestContextMessageOrder } from './requestContextMessages';
import type { RequestMessage } from './requestMessage';
import type { AssistantPromptPart, AssistantPromptPartLayer, AssistantPromptPartName } from './requestAudit';
import type { AssistantRequestCachePlan } from './requestCachePlan';
import type { AssistantToolContext } from '../assistantToolProtocol';
import { isSettledToolLedgerEntry, rebuildConversationToolLedger } from '../toolLedger';
import { projectToolResultPayloadForRequest } from './requestToolResultProjection';
import type { AssistantConversationSummaryDecision } from './requestConversationSummaryPlan';
import type { AssistantSemanticRecallContextCandidate } from './requestSemanticRecallPlan';

export type AssistantContextRole = 'system' | 'user' | 'assistant' | 'tool';
export type AssistantRequestToolChoice = 'auto' | 'required' | 'none';
export type AssistantRequestTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AssistantMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type AssistantMessageContent = string | AssistantMessageContentPart[];

export type AssistantContextToolCall = ChatNativeToolCall & { id: string };

export type AssistantContextToolResult = {
  schemaVersion: 1;
  toolCallId: string;
  toolName: string;
  sourceMessageId?: string;
  status: ToolInvocationStatus;
  isError?: boolean;
  structuredPayload: Record<string, unknown>;
};

export type AssistantContextMessage = {
  role: AssistantContextRole;
  content: AssistantMessageContent;
  cachePrefixEligible?: boolean;
  thinkingText?: string;
  toolCalls?: AssistantContextToolCall[];
  toolResult?: AssistantContextToolResult;
  promptPartName?: AssistantPromptPartName;
  promptPartLayer?: AssistantPromptPartLayer;
};

export type AssistantContextSegment = {
  kind: 'system' | 'memory' | 'conversation_summary' | 'semantic_recall' | 'history_summary' | 'conversation';
  messages: AssistantContextMessage[];
};

export type AssistantRequestContext = {
  memorySlots: {
    session: string[];
    profile: string[];
    pin: string[];
  };
  attachmentSlots: {
    enabled: boolean;
    pending: Array<{
      id: string;
      kind: 'image' | 'file';
      name: string;
    }>;
  };
  segments: AssistantContextSegment[];
  tools?: AssistantRequestTool[];
  toolChoice?: AssistantRequestToolChoice;
  cachePlan?: AssistantRequestCachePlan;
};

export type AssembleAssistantContextParams = {
  systemPrompts?: Array<
    string | {
      content: string;
      cachePrefixEligible?: boolean;
    }
  >;
  systemPromptParts?: Array<Pick<AssistantPromptPart, 'name' | 'layer' | 'content'>>;
  messages: RequestMessage[];
  messagesPrepared?: boolean;
  toolLedger?: ToolLedgerEntry[];
  memoryLines?: string[];
  conversationSummaries?: AssistantConversationSummaryDecision[];
  semanticRecallCandidates?: AssistantSemanticRecallContextCandidate[];
  memoryReferenceDocs?: PersonaMemoryReferenceDoc[];
  workspaceReferenceDocs?: WorkspaceReferenceDoc[];
  historySummaries?: string[];
  allowImages?: boolean;
  latestUserSupplementalContent?: AssistantMessageContentPart[];
  toolContext?: AssistantToolContext;
  tools?: AssistantRequestTool[];
  toolChoice?: AssistantRequestToolChoice;
  cachePlan?: AssistantRequestCachePlan;
};

function buildPromptPartSystemSegment(part: Pick<AssistantPromptPart, 'name' | 'layer' | 'content'>): AssistantContextSegment {
  return {
    kind: 'system',
    messages: [{
      role: 'system',
      content: part.content,
      promptPartName: part.name,
      promptPartLayer: part.layer
    }]
  };
}

function buildLatestUserContextMessage(part: Pick<AssistantPromptPart, 'name' | 'layer' | 'content'>): AssistantContextMessage {
  return {
    role: 'user',
    content: [
      '[本轮请求上下文，不是用户原话]',
      part.content
    ].join('\n'),
    promptPartName: part.name,
    promptPartLayer: part.layer
  };
}

function buildToolLedgerLookups(
  toolLedger: ToolLedgerEntry[] | undefined,
  availableMessageIds?: ReadonlySet<string>
) {
  if (!toolLedger?.length) {
    return null;
  }

  const toolCallsByAssistantMessageId = new Map<string, AssistantContextToolCall[]>();
  const toolResultsByMessageId = new Map<string, AssistantContextToolResult>();
  const transcriptToolResultsByMessageId = new Map<string, AssistantContextToolResult>();

  for (const entry of toolLedger) {
    if (!isSettledToolLedgerEntry(entry)) {
      continue;
    }

    const toolResult: AssistantContextToolResult = {
      schemaVersion: 1,
      toolCallId: entry.toolCallId,
      toolName: entry.resultToolName ?? entry.toolName,
      sourceMessageId: entry.resultSourceMessageId,
      status: entry.resultStatus,
      isError: entry.resultIsError,
      structuredPayload: entry.resultStructuredPayload
    };

    if (entry.sourceSpan?.transport !== 'native') {
      if (availableMessageIds && !availableMessageIds.has(entry.resultMessageId)) {
        continue;
      }
      transcriptToolResultsByMessageId.set(entry.resultMessageId, toolResult);
      continue;
    }
    if (
      availableMessageIds
      && (
        !availableMessageIds.has(entry.assistantMessageId)
        || !availableMessageIds.has(entry.resultMessageId)
      )
    ) {
      continue;
    }

    const assistantToolCall: AssistantContextToolCall = {
      id: entry.toolCallId,
      name: entry.toolName,
      argumentsText: entry.argumentsText,
      sourceSpan: entry.sourceSpan,
      ...(entry.providerMetadata ? { providerMetadata: entry.providerMetadata } : {})
    };
    toolCallsByAssistantMessageId.set(entry.assistantMessageId, [
      ...(toolCallsByAssistantMessageId.get(entry.assistantMessageId) ?? []),
      assistantToolCall
    ]);

    toolResultsByMessageId.set(entry.resultMessageId, toolResult);
  }

  return {
    toolCallsByAssistantMessageId,
    toolResultsByMessageId,
    transcriptToolResultsByMessageId
  };
}

function buildTranscriptToolResultContent(toolResult: AssistantContextToolResult) {
  const payload = projectToolResultPayloadForRequest({
    toolName: toolResult.toolName,
    status: toolResult.status,
    sourceMessageId: toolResult.sourceMessageId,
    isError: toolResult.isError,
    ...toolResult.structuredPayload
  }, {
    toolName: toolResult.toolName,
    kind: toolResult.toolName
  });

  return [
    `[tool_result:${toolResult.toolName}]`,
    JSON.stringify(payload)
  ].join('\n\n');
}

export function assembleAssistantContext(params: AssembleAssistantContextParams): AssistantRequestContext {
  const {
    systemPrompts,
    systemPromptParts,
    messages: rawMessages,
    messagesPrepared = false,
    toolLedger,
    memoryLines,
    conversationSummaries,
    semanticRecallCandidates,
    memoryReferenceDocs,
    workspaceReferenceDocs,
    historySummaries,
    allowImages = false,
    latestUserSupplementalContent,
    toolContext,
    tools,
    toolChoice,
    cachePlan
  } = params;
  const messages = messagesPrepared ? rawMessages : normalizeRequestContextMessageOrder(rawMessages);
  const profileMemories = normalizeMemoryLines(memoryLines);
  const referenceDocs = normalizeMemoryReferenceDocs(memoryReferenceDocs);
  const workspaceReferenceDirectory = normalizeWorkspaceReferenceDocs(workspaceReferenceDocs);
  const memorySegment = buildMemorySegment({
    lines: profileMemories,
    referenceDocs
  });
  const conversationSummarySegment = buildConversationSummarySegment(conversationSummaries);
  const semanticRecallSegment = buildSemanticRecallSegment(semanticRecallCandidates);
  const workspaceReferenceSegment = buildWorkspaceReferenceSegment(workspaceReferenceDirectory);
  const historySummaryLines = (historySummaries ?? []).map((summary) => summary.trim()).filter(Boolean);
  const historySummarySegment = historySummaryLines.length
    ? {
        kind: 'history_summary' as const,
        messages: [
          {
            role: 'system' as const,
            content: [
              '[历史摘要，不是原文]',
              '以下内容是 Polaris 因上下文窗口或历史预算退化而压缩的旧历史，只能作为背景线索使用，不要当成用户或助手的逐字原话。',
              ...historySummaryLines
            ].join('\n'),
            cachePrefixEligible: true
          }
        ]
      }
    : null;
  const conversationMessages = messages;
  const attachments = messages.flatMap((message) => message.attachments ?? []);
  const latestUserMessageId = [...conversationMessages].reverse().find((message) => message.role === 'user')?.id;
  const effectiveToolLedger = toolLedger ?? rebuildConversationToolLedger(conversationMessages);
  const availableConversationMessageIds = new Set(conversationMessages.map((message) => message.id));
  const toolLedgerLookups = buildToolLedgerLookups(effectiveToolLedger, availableConversationMessageIds);
  const stableSystemSegments = systemPromptParts
    ? systemPromptParts
        .filter((part) => part.layer === 'identity' || part.layer === 'capability')
        .map(buildPromptPartSystemSegment)
    : (systemPrompts ?? []).map((prompt) => {
        const content = typeof prompt === 'string' ? prompt : prompt.content;
        const cachePrefixEligible = typeof prompt === 'string' ? undefined : prompt.cachePrefixEligible;
        return {
          kind: 'system' as const,
          messages: [{
            role: 'system' as const,
            content,
            ...(cachePrefixEligible ? { cachePrefixEligible: true } : {})
          }]
        };
      });
  const dynamicPromptParts = systemPromptParts?.filter((part) => part.layer === 'context') ?? [];
  const latestUserContextParts = latestUserMessageId
    ? dynamicPromptParts.filter((part) => part.name === 'runtime_clock_context')
    : [];
  const latestUserContextMessages = latestUserContextParts.map(buildLatestUserContextMessage);
  const dynamicSystemSegments = dynamicPromptParts
    .filter((part) => part.name !== 'runtime_clock_context' || !latestUserMessageId)
    .map(buildPromptPartSystemSegment);

  return {
    memorySlots: {
      session: [],
      profile: profileMemories,
      pin: []
    },
    attachmentSlots: {
      enabled: attachments.length > 0,
      pending: attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        name: attachment.name
      }))
    },
    segments: [
      ...stableSystemSegments,
      ...(memorySegment ? [memorySegment] : []),
      ...(conversationSummarySegment ? [conversationSummarySegment] : []),
      ...(semanticRecallSegment ? [semanticRecallSegment] : []),
      ...(workspaceReferenceSegment ? [workspaceReferenceSegment] : []),
      ...(historySummarySegment ? [historySummarySegment] : []),
      ...dynamicSystemSegments,
      {
        kind: 'conversation',
        messages: conversationMessages.flatMap((message) => {
          const resolvedToolCalls = toolLedgerLookups?.toolCallsByAssistantMessageId.get(message.id);
          const resolvedToolResult = toolLedgerLookups?.toolResultsByMessageId.get(message.id) ?? null;
          const resolvedTranscriptToolResult =
            toolLedgerLookups?.transcriptToolResultsByMessageId.get(message.id) ?? null;

          if (resolvedToolResult) {
            return [{
              role: 'tool' as const,
              content: message.content,
              toolResult: resolvedToolResult
            }];
          }

          if (resolvedTranscriptToolResult) {
            return [{
              role: 'user' as const,
              content: buildTranscriptToolResultContent(resolvedTranscriptToolResult)
            }];
          }

          const contextMessage: AssistantContextMessage = {
            role:
              message.role === 'system'
                ? 'system'
                : message.role === 'assistant'
                  ? 'assistant'
                  : 'user',
            content: buildMessageContent({
              message,
              allowImages,
              supplementalContent: message.id === latestUserMessageId ? latestUserSupplementalContent : undefined
            }),
            thinkingText: message.role === 'assistant' && message.thinkingText?.trim()
              ? message.thinkingText
              : undefined,
            toolCalls: message.role === 'assistant' ? resolvedToolCalls : undefined
          };
          return message.id === latestUserMessageId && latestUserContextMessages.length
            ? [...latestUserContextMessages, contextMessage]
            : [contextMessage];
        })
      }
    ],
    tools: tools?.length ? tools : undefined,
    toolChoice: tools?.length ? toolChoice : undefined,
    cachePlan
  };
}
