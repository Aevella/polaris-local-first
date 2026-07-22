import type { AssistantRequestCachePlan } from './requestCachePlan';
import type { AssistantRequestBudgetBucket, AssistantRequestBudgetPlan, AssistantRequestBudgetUsage } from './requestBudget';
import type { AssistantRequestContext } from './requestContext';
import type { RequestContextReceipt } from './requestContextReceipt';
import type { AssistantRequestMemoryPlan } from './requestMemoryPlan';
import type { AssistantConversationSummaryPlan } from './requestConversationSummaryPlan';
import type {
  AssistantRequestSemanticRecallPlan,
  AssistantSemanticRecallContextCandidate
} from './requestSemanticRecallPlan';

export type AssistantPromptPartName =
  | 'system_identity'
  | 'persona_identity'
  | 'persona_identity_core'
  | 'persona_identity_motive'
  | 'persona_identity_style'
  | 'runtime_clock_context'
  | 'model_runtime_context'
  | 'regex_trigger_context'
  | 'task_seed_context'
  | 'task_runtime_context'
  | 'work_runtime_context'
  | 'tool_capability'
  | 'tool_disabled_capability'
  | 'mcp_status_capability'
  | 'tool_catalog_capability'
  | 'tool_protocol_capability'
  | 'workspace_write_capability'
  | 'tool_rules_capability'
  | 'task_handoff_capability'
  | 'tool_context_capability'
  | 'ui_context_capability'
  | 'attachment_context_capability'
  | 'desktop_local_context_capability'
  | 'room_context_capability'
  | 'theme_context_capability'
  | 'reply_markup_capability'
  | 'document_capability'
  | 'qr_capability'
  | 'archive_capability'
  | 'theme_capability';

export type AssistantPromptPartLayer = 'identity' | 'capability' | 'context';

export type AssistantPromptPart = {
  name: AssistantPromptPartName;
  label: string;
  role: 'system' | 'user' | 'assistant';
  layer: AssistantPromptPartLayer;
  truncationPriority: number;
  content: string;
  enabled: boolean;
  charCount: number;
};

export type PersonaRuntimePromptSource = 'none' | 'custom' | 'builtin' | 'vnext';

export type AssistantPromptPartTruncationDecision = {
  name: AssistantPromptPartName;
  label: string;
  layer: AssistantPromptPartLayer;
  bucket: Exclude<AssistantRequestBudgetBucket, 'memory' | 'history'>;
  estimatedTokens: number;
  status: 'kept' | 'disabled' | 'dropped_budget';
};

export type AssistantHistoryTruncationDecision = {
  maxTokens: number;
  estimatedTokens: number;
  keptMessageCount: number;
  droppedMessageCount: number;
  remainingBudgetTokens: number;
  status: 'kept' | 'trimmed_budget';
};

export type AssistantRequestTruncation = {
  promptParts: AssistantPromptPartTruncationDecision[];
  history: AssistantHistoryTruncationDecision;
};

export type AssistantContextMessageDecision = {
  messageId: string;
  role: 'system' | 'user' | 'assistant';
  estimatedTokens: number;
  status: 'kept' | 'dropped_tool_message' | 'dropped_message_limit' | 'dropped_history_budget' | 'dropped_orphaned_tool_result';
  protectedBy: 'current_user_message' | 'tail_fallback' | null;
};

export type AssistantContextUnitKind =
  | 'user_turn'
  | 'assistant_turn'
  | 'tool_pair'
  | 'assistant_tool_call'
  | 'tool_result'
  | 'orphaned_tool_result'
  | 'system_feedback';

export type AssistantContextUnitDecision = {
  unitId: string;
  kind: AssistantContextUnitKind;
  messageIds: string[];
  estimatedTokens: number;
  status: 'kept' | 'dropped_history_budget' | 'dropped_orphaned_tool_result';
  protectedBy: 'current_user_message' | 'tail_fallback' | null;
};

export type AssistantContextSummaryDecision = {
  summaryId: string;
  unitIds: string[];
  messageIds: string[];
  reason: 'message_limit' | 'history_budget';
  estimatedTokens: number;
  content: string;
};

export type AssistantRequestHistoryMode = 'conversation' | 'workspace';

export type AssistantRequestContextPlan = {
  protectedMessageId: string | null;
  historyMode: AssistantRequestHistoryMode;
  entries: AssistantContextMessageDecision[];
  units: AssistantContextUnitDecision[];
  summaries: AssistantContextSummaryDecision[];
};

export type AssistantRequestToolingAudit = {
  enabled: boolean;
  toolCount: number;
  toolChoice: AssistantRequestContext['toolChoice'] | null;
  toolNames: string[];
};

export type AssistantRequestTimings = {
  personaPromptMs: number;
  promptPartsMs: number;
  truncationMs: number;
  memoryPlanMs: number;
  conversationBuildMs: number;
  contextPlanMs: number;
  toolRequestMs: number;
  cachePlanMs: number;
  assetHydrationMs: number;
  contextAssemblyMs: number;
  budgetUsageMs: number;
  totalPreparationMs: number;
};

export type AssistantRequestAudit = {
  requestId: string;
  assistantName: string;
  providerId: string;
  providerName: string;
  modelId: string;
  collaboratorId: string | null;
  personaPromptSource: PersonaRuntimePromptSource;
  messageLimit: number;
  tokenBudget: number;
  budgetPlan: AssistantRequestBudgetPlan;
  budgetUsage: AssistantRequestBudgetUsage;
  memoryPlan: AssistantRequestMemoryPlan;
  conversationSummaryPlan: AssistantConversationSummaryPlan;
  semanticRecallPlan: AssistantRequestSemanticRecallPlan;
  semanticRecallContextCandidates?: AssistantSemanticRecallContextCandidate[];
  cachePlan: AssistantRequestCachePlan;
  contextPlan: AssistantRequestContextPlan;
  sourceMessageCount: number;
  droppedToolMessageCount: number;
  keptMessageCount: number;
  trimmedMessageCount: number;
  promptParts: AssistantPromptPart[];
  truncation: AssistantRequestTruncation;
  tooling: AssistantRequestToolingAudit;
  requestReceipt: RequestContextReceipt;
  context: AssistantRequestContext;
  timings: AssistantRequestTimings;
};
