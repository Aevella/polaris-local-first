import type { AssistantReply } from '../../engines/chatApi';
import { createMessage } from '../../engines/chatMessageFactory';
import type { McpResolvedToolDefinition } from '../../engines/mcpRuntime';
import type { AssistantToolEnforcementScope } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ToolAction } from '../../engines/toolExecutor';
import type { AssistantToolAction } from '../../engines/toolActionTypes';
import type { WritableConversationBody } from '../../stores/chatStore';
import type { ChatMessage, ModelTier } from '../../types/domain';
import { throwIfAborted } from './chatAbortError';
import { resolveAssistantToolActions } from './chatAssistantToolRuntime';
import { parseAssistantReplyContent } from './chatReplyContent';
import {
  buildInterruptedWorkspaceDraftFailureToolInvocation,
  type ToolActionRunOutcome
} from './chatToolOutcome';
import { recoverTruncatedNativeProjectActions } from './chatTruncatedProjectRecovery';

type ExecuteToolActions = (
  conversationId: string,
  actions: ToolAction[],
  options?: {
    beforeMessageId?: string;
    toolCallIds?: string[];
    signal?: AbortSignal;
  }
) => Promise<ToolActionRunOutcome[]>;

type AssistantToolResolutionContext = Pick<
  Parameters<typeof resolveAssistantToolActions>[0],
  | 'cards'
  | 'projectFiles'
  | 'projectScopes'
  | 'activeCardId'
  | 'activeProjectId'
  | 'enabledToolGroups'
  | 'toolEnforcementScope'
  | 'themeToolMode'
  | 'availableToolNames'
> & {
  mcpTools?: McpResolvedToolDefinition[];
};

const INTERRUPTED_WORKSPACE_NATIVE_TOOL_NAMES = new Set([
  'createProjectFile',
  'writeProjectFiles',
  'appendProjectFile',
  'insertProjectFile',
  'replaceProjectFileLines',
  'editProjectFileText',
  'deleteProjectFile'
]);

export function hasInterruptedWorkspaceDraftShape(args: {
  activeProjectId?: string | null;
  placeholder: ChatMessage;
  partialReply?: AssistantReply | null;
}) {
  if (!args.activeProjectId) return false;
  const content = `${args.placeholder.content}\n${args.partialReply?.content ?? ''}`;
  if (content.includes('```polaris-project-file')) return true;

  const nativeToolCalls = [
    ...(args.placeholder.nativeToolCalls ?? []),
    ...(args.partialReply?.nativeToolCalls ?? [])
  ];
  return nativeToolCalls.some((toolCall) =>
    INTERRUPTED_WORKSPACE_NATIVE_TOOL_NAMES.has(toolCall.name.trim())
  );
}

export function appendInterruptedWorkspaceDraftFailure(
  chat: { addMessage: (target: WritableConversationBody, message: ChatMessage) => void },
  writableConversation: WritableConversationBody,
  error?: unknown
) {
  const toolInvocation = buildInterruptedWorkspaceDraftFailureToolInvocation(error);
  chat.addMessage(writableConversation, {
    ...createMessage('system', toolInvocation.summary, undefined, 'tool-runtime', toolInvocation.id),
    model: 'local-tool',
    toolInvocation
  });
}

function getRecoverableActionKey(action: ToolAction) {
  switch (action.kind) {
    case 'createRoomProject':
      return `project:${action.project.projectId}`;
    case 'createProjectFile':
      return `project-file:${action.file.projectId}:${action.file.filePath}`;
    case 'writeProjectFiles':
      return `write-project-files:${action.projectId}:${action.files.map((file) => `${file.filePath}:${file.code}`).join('|')}`;
    case 'patchRoomProject':
      return `patch-room-project:${action.projectId}:${JSON.stringify(action.patch)}`;
    case 'listProjectFiles':
      return `list-project-files:${action.projectId}`;
    case 'searchProjectFiles':
      return `search-project-files:${action.projectId}:${action.query}:${action.maxResults ?? ''}`;
    case 'listWorkspaceReferences':
      return `list-workspace-references:${action.projectId}`;
    case 'searchWorkspaceReferences':
      return `search-workspace-references:${action.projectId}:${action.query}:${action.maxResults ?? ''}`;
    case 'readWorkspaceReference':
      return `read-workspace-reference:${action.projectId}:${action.docId ?? ''}:${action.title ?? ''}`;
    case 'searchReadableContext':
      return `search-readable-context:${action.projectId ?? ''}:${action.query}:${action.maxResults ?? ''}`;
    case 'checkProjectPreview':
      return `check-project-preview:${action.projectId}`;
    case 'inspectProjectRuntime':
      return `inspect-project-runtime:${action.projectId}:${action.settleMs ?? ''}`;
    case 'appendProjectFile':
      return `append-project-file:${action.fileId}:${action.code}`;
    case 'insertProjectFile':
      return `insert-project-file:${action.fileId}:${action.beforeString ?? ''}:${action.afterString ?? ''}:${action.lineNumber ?? ''}:${action.linePosition ?? ''}:${action.code}`;
    case 'replaceProjectFileLines':
      return `replace-project-file-lines:${action.fileId}:${action.startLine}:${action.endLine ?? ''}:${action.code}`;
    case 'editProjectFileText':
      return `edit-project-file:${action.fileId}:${action.oldString}:${action.newString}`;
    case 'deleteProjectFile':
      return `delete-project-file:${action.fileId}`;
    case 'readProjectFileContext':
      return `read-project-file-context:${action.fileId}:${action.query ?? ''}:${action.lineNumber ?? ''}:${action.before ?? ''}:${action.after ?? ''}:${action.occurrence ?? ''}`;
    case 'appendCodeCard':
      return `append:${action.cardId}:${action.code}`;
    default:
      return `${action.kind}:${JSON.stringify(action)}`;
  }
}

function prepareRecoverableTruncatedActions(args: {
  resolvedActions: ToolAction[];
  recoveredActions: ToolAction[];
  existingProjectIds: string[];
}) {
  const knownProjectIds = new Set(args.existingProjectIds);
  const seenActionKeys = new Set<string>();
  const prepared: ToolAction[] = [];

  const appendAction = (action: ToolAction) => {
    const key = getRecoverableActionKey(action);
    if (seenActionKeys.has(key)) return;
    seenActionKeys.add(key);

    if (action.kind === 'createRoomProject') {
      knownProjectIds.add(action.project.projectId);
      prepared.push(action);
      return;
    }

    if (action.kind === 'createProjectFile' && !knownProjectIds.has(action.file.projectId)) {
      return;
    }

    prepared.push(action);
  };

  for (const action of [...args.resolvedActions, ...args.recoveredActions]) {
    appendAction(action);
  }

  return prepared;
}

export async function executeRecoverableTruncatedToolActions(args: {
  executeToolActions: ExecuteToolActions;
  conversationId: string;
  placeholderId: string;
  toolOutcome: {
    resolvedActions: ToolAction[];
  };
  reply: AssistantReply;
  existingProjectIds: string[];
  signal?: AbortSignal;
} & AssistantToolResolutionContext) {
  throwIfAborted(args.signal);
  const recoveredAssistantActions = recoverTruncatedNativeProjectActions(args.reply.nativeToolCalls ?? []);
  const recoveredResolution = recoveredAssistantActions.length > 0
    ? resolveAssistantToolActions({
        actions: recoveredAssistantActions,
        cards: args.cards,
        projectFiles: args.projectFiles,
        projectScopes: args.projectScopes,
        activeCardId: args.activeCardId,
        activeProjectId: args.activeProjectId,
        enabledToolGroups: args.enabledToolGroups,
        toolEnforcementScope: args.toolEnforcementScope,
        themeToolMode: args.themeToolMode,
        availableToolNames: args.availableToolNames
      })
    : { resolved: [] as ToolAction[], errors: [] as string[] };
  const actions = prepareRecoverableTruncatedActions({
    resolvedActions: args.toolOutcome.resolvedActions,
    recoveredActions: recoveredResolution.resolved,
    existingProjectIds: args.existingProjectIds
  });

  if (actions.length === 0) return [];

  return await args.executeToolActions(args.conversationId, actions, {
    beforeMessageId: args.placeholderId,
    signal: args.signal
  });
}

function isInterruptedWorkspaceRecoveryAction(action: AssistantToolAction) {
  switch (action.kind) {
    case 'createProjectFile':
    case 'writeProjectFiles':
    case 'patchRoomProject':
    case 'listProjectFiles':
    case 'searchProjectFiles':
    case 'checkProjectPreview':
    case 'inspectProjectRuntime':
    case 'appendProjectFile':
    case 'insertProjectFile':
    case 'replaceProjectFileLines':
    case 'editProjectFileText':
    case 'deleteProjectFile':
    case 'readProjectFile':
    case 'readProjectFileContext':
      return true;
    default:
      return false;
  }
}

export async function executeInterruptedWorkspaceDraftActions(args: {
  executeToolActions: ExecuteToolActions;
  conversationId: string;
  placeholderId: string;
  placeholder: ChatMessage;
  partialReply?: AssistantReply | null;
  modelTier: ModelTier;
  ignoredUnknownNativeToolNames: string[];
  allowCreativeCssRecovery: boolean;
  existingProjectIds: string[];
  signal?: AbortSignal;
} & AssistantToolResolutionContext) {
  if (!args.activeProjectId) return [];
  const content = args.partialReply?.content ?? args.placeholder.content ?? '';
  const nativeToolCalls = args.partialReply?.nativeToolCalls ?? args.placeholder.nativeToolCalls ?? [];
  if (!content.trim() && nativeToolCalls.length === 0) return [];

  const reply: AssistantReply = {
    content,
    thinkingText: args.partialReply?.thinkingText ?? args.placeholder.thinkingText,
    providerReasoning: args.partialReply?.providerReasoning ?? args.placeholder.providerReasoning,
    model: args.partialReply?.model ?? args.placeholder.model,
    tokenCount: args.partialReply?.tokenCount ?? args.placeholder.tokenCount,
    tokenUsage: args.partialReply?.tokenUsage ?? args.placeholder.tokenUsage,
    nativeToolCalls,
    finishReason: 'length',
    transportIncomplete: true
  };
  const parsed = parseAssistantReplyContent(
    content,
    args.modelTier,
    args.themeToolMode ?? 'stable',
    'final',
    nativeToolCalls,
    args.ignoredUnknownNativeToolNames,
    {
      hasWorkspaceContext: true,
      activeProjectId: args.activeProjectId,
      allowCreativeCssRecovery: args.allowCreativeCssRecovery,
      mcpTools: args.mcpTools
    }
  ).parsed;
  const workspaceActions = parsed.actions.filter(isInterruptedWorkspaceRecoveryAction);
  const actionResolution = workspaceActions.length > 0
    ? resolveAssistantToolActions({
        actions: workspaceActions,
        cards: args.cards,
        projectFiles: args.projectFiles,
        projectScopes: args.projectScopes,
        activeCardId: args.activeCardId,
        activeProjectId: args.activeProjectId,
        enabledToolGroups: args.enabledToolGroups,
        toolEnforcementScope: args.toolEnforcementScope,
        themeToolMode: args.themeToolMode,
        availableToolNames: args.availableToolNames
      })
    : { resolved: [] as ToolAction[], errors: [] as string[] };

  return executeRecoverableTruncatedToolActions({
    executeToolActions: args.executeToolActions,
    conversationId: args.conversationId,
    placeholderId: args.placeholderId,
    toolOutcome: {
      resolvedActions: actionResolution.resolved
    },
    reply,
    cards: args.cards,
    projectFiles: args.projectFiles,
    projectScopes: args.projectScopes,
    activeCardId: args.activeCardId,
    activeProjectId: args.activeProjectId,
    enabledToolGroups: args.enabledToolGroups,
    toolEnforcementScope: args.toolEnforcementScope,
    themeToolMode: args.themeToolMode,
    availableToolNames: args.availableToolNames,
    existingProjectIds: args.existingProjectIds,
    signal: args.signal
  });
}
