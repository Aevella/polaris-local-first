import {
  extractAssistantNativeToolActions,
  extractAssistantToolActions
} from '../../engines/assistantToolProtocol';
import type { AssistantNativeToolCall } from '../../engines/chatApi';
import { parseAssistantTaskUpdate } from '../../engines/conversationTaskUpdateParser';
import { extractProjectFileDraftActions } from '../../engines/tool-protocol/assistantProjectFileDrafts';
import {
  recoverCreativeCssToolAction,
  recoverLooseJsonToolActions,
  recoverTextualToolCallActions,
  recoverTranscriptToolCallActions
} from '../../engines/tool-protocol/assistantToolActionRecovery';
import type { AssistantToolAction } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { McpResolvedToolDefinition } from '../../engines/mcpRuntime';
import type { ModelTier, ThemeToolMode } from '../../types/domain';

export type AssistantToolIngressSource =
  | 'native'
  | 'fence'
  | 'project-draft'
  | 'transcript-recovery'
  | 'textual-recovery'
  | 'loose-json-recovery'
  | 'creative-css-recovery'
  | 'none';

export type AssistantToolIngressBatch = {
  displayContent: string;
  actions: AssistantToolAction[];
  issues: string[];
};

type ResolveAssistantToolIngressArgs = {
  content: string;
  modelTier: ModelTier;
  themeToolMode: ThemeToolMode;
  phase: 'streaming' | 'final';
  nativeToolCalls: AssistantNativeToolCall[];
  ignoredUnknownNativeToolNames: string[];
  hasWorkspaceContext?: boolean;
  activeProjectId?: string | null;
  allowCreativeCssRecovery?: boolean;
  mcpTools?: McpResolvedToolDefinition[];
};

function uniqueSources(sources: AssistantToolIngressSource[]) {
  return Array.from(new Set(sources));
}

/**
 * Owns assistant tool ingress precedence. Native calls replace textual fence
 * actions, while project-file drafts may accompany either transport. Recovery
 * sources are attempted only when the authoritative transport produced no
 * actions, in the order recorded below.
 */
export function resolveAssistantToolIngress(args: ResolveAssistantToolIngressArgs) {
  const taskParsed = parseAssistantTaskUpdate(args.content);
  const actionParseContext = {
    activeProjectId: args.activeProjectId ?? null,
    mcpTools: args.mcpTools
  };
  const transcriptRecovery = recoverTranscriptToolCallActions(
    taskParsed.displayContent,
    args.themeToolMode,
    actionParseContext
  );
  const sanitizedContent = transcriptRecovery?.displayContent ?? taskParsed.displayContent;
  const fence = extractAssistantToolActions(
    sanitizedContent,
    args.modelTier,
    args.themeToolMode,
    actionParseContext
  );
  const projectDraft = extractProjectFileDraftActions(
    fence.displayContent || sanitizedContent,
    { preserveDraftBodyInDisplay: args.phase === 'streaming' }
  );
  const native = args.nativeToolCalls.length > 0
    ? extractAssistantNativeToolActions(
        args.nativeToolCalls,
        projectDraft.displayContent || fence.displayContent || sanitizedContent,
        args.themeToolMode,
        args.ignoredUnknownNativeToolNames,
        actionParseContext
      )
    : null;

  const authoritativeBatch: AssistantToolIngressBatch & { sources: AssistantToolIngressSource[] } = native
    ? {
        displayContent: projectDraft.displayContent,
        actions: [...projectDraft.actions, ...native.actions],
        issues: [...projectDraft.issues, ...native.issues],
        sources: uniqueSources([
          ...(projectDraft.actions.length ? ['project-draft' as const] : []),
          ...(native.actions.length || native.issues.length ? ['native' as const] : [])
        ])
      }
    : {
        displayContent: projectDraft.displayContent,
        actions: [...fence.actions, ...projectDraft.actions],
        issues: [...fence.issues, ...projectDraft.issues],
        sources: uniqueSources([
          ...(fence.actions.length || fence.issues.length ? ['fence' as const] : []),
          ...(projectDraft.actions.length ? ['project-draft' as const] : [])
        ])
      };

  if (authoritativeBatch.actions.length > 0 || native) {
    return {
      parsed: {
        displayContent: authoritativeBatch.displayContent,
        actions: authoritativeBatch.actions,
        issues: authoritativeBatch.issues
      },
      sources: authoritativeBatch.sources.length ? authoritativeBatch.sources : ['none' as const],
      sanitizedContent,
      taskUpdate: taskParsed.taskUpdate
    };
  }

  const recoveries: Array<{
    source: AssistantToolIngressSource;
    resolve: () => AssistantToolIngressBatch | null;
  }> = [
    {
      source: 'transcript-recovery',
      resolve: () => transcriptRecovery
    },
    {
      source: 'textual-recovery',
      resolve: () => recoverTextualToolCallActions(
        authoritativeBatch.displayContent,
        args.themeToolMode,
        actionParseContext
      )
    },
    {
      source: 'loose-json-recovery',
      resolve: () => recoverLooseJsonToolActions(
        authoritativeBatch.displayContent,
        args.themeToolMode,
        actionParseContext
      )
    },
    {
      source: 'creative-css-recovery',
      resolve: () => (
        !args.hasWorkspaceContext || args.allowCreativeCssRecovery
          ? recoverCreativeCssToolAction(authoritativeBatch.displayContent, args.themeToolMode)
          : null
      )
    }
  ];

  for (const recovery of recoveries) {
    const recovered = recovery.resolve();
    if (!recovered) continue;
    return {
      parsed: recovered,
      sources: [recovery.source],
      sanitizedContent,
      taskUpdate: taskParsed.taskUpdate
    };
  }

  return {
    parsed: {
      displayContent: authoritativeBatch.displayContent,
      actions: authoritativeBatch.actions,
      issues: authoritativeBatch.issues
    },
    sources: authoritativeBatch.sources.length ? authoritativeBatch.sources : ['none' as const],
    sanitizedContent,
    taskUpdate: taskParsed.taskUpdate
  };
}
