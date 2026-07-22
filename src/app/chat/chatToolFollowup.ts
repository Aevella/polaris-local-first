import type { AssistantReply } from '../../engines/chatApi';
import { createMessage } from '../../engines/chatMessageFactory';
import type { AssistantToolContext } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ChatMessage, ToolInvocation } from '../../types/domain';
import type { AssistantToolPreparationOutcome, ToolActionRunOutcome } from './chatToolOutcome';

export type ToolFollowupPlan = {
  exchangeFingerprint: string;
};

function preparationStatusLabel(status: Exclude<AssistantToolPreparationOutcome['status'], 'ready'>) {
  switch (status) {
    case 'parse_failed':
      return '工具参数没有通过解析';
    case 'resolution_failed':
      return '工具动作没有解析成可执行动作';
    case 'missing_actions':
      return '回复没有形成可执行工具动作';
  }
}

function summarizePreparationReasons(outcome: Exclude<AssistantToolPreparationOutcome, { status: 'ready' }>) {
  const reasons = (
    outcome.status === 'resolution_failed'
      ? outcome.message.split('\n')
      : outcome.parsed.issues
  )
    .map((line) => line.trim())
    .map((line) => /^原始(?:片段|参数)：/u.test(line) ? '原始工具参数已从下一轮上下文省略。' : line)
    .filter(Boolean)
    .slice(0, 4);

  return reasons.length ? reasons : [outcome.message];
}

export function buildToolPreparationRetrySystemMessage(
  outcome: Exclude<AssistantToolPreparationOutcome, { status: 'ready' }>
): ChatMessage {
  const declaredActions = outcome.parsed.actions.map((action) => action.kind);
  const nativeToolNames = (outcome.reply.nativeToolCalls ?? [])
    .map((toolCall) => toolCall.name.trim())
    .filter(Boolean);
  const actionLine = [...declaredActions, ...nativeToolNames].length
    ? `这次涉及的工具：${[...declaredActions, ...nativeToolNames].join('、')}。`
    : null;
  const reasonLines = summarizePreparationReasons(outcome).map((reason) => `- ${reason}`);

  return createMessage(
    'system',
    [
      `上一轮 Polaris 工具准备没有通过：${preparationStatusLabel(outcome.status)}。`,
      actionLine,
      '先不要把这个失败展示给用户；你现在要根据错误自修一次，重新发出完整、可执行的工具调用。',
      '不要只解释、不要道歉、不要复述“我会修改”；如果用户目标仍然明确，就直接补齐缺失字段或改正参数形状后再次调用工具。',
      '错误原因：',
      ...reasonLines
    ].filter(Boolean).join('\n')
  );
}

function isFollowupOutcome(outcome: ToolActionRunOutcome) {
  return (
    (outcome.path === 'direct' && outcome.status === 'executed')
    || (outcome.path === 'direct' && outcome.status === 'failed')
    || (outcome.path === 'memory' && outcome.status === 'handled')
    || (outcome.path === 'preview' && outcome.status === 'previewed')
    || (outcome.path === 'preview' && outcome.status === 'failed')
  );
}

function settledInvocationFingerprint(invocation: ToolInvocation) {
  const {
    id: _id,
    toolCallId: _toolCallId,
    originMessageId: _originMessageId,
    ...stableInvocation
  } = invocation;
  return stableInvocation;
}

export function buildToolExchangeFingerprint(outcomes: ToolActionRunOutcome[]) {
  const settledOutcomes = outcomes.filter(isFollowupOutcome).map((outcome) => {
    if (outcome.path === 'direct') {
      return {
        path: outcome.path,
        status: outcome.status,
        action: outcome.action,
        result: settledInvocationFingerprint(outcome.toolInvocation),
        error: outcome.error
      };
    }
    return {
      path: outcome.path,
      status: outcome.status,
      action: outcome.action,
      error: 'error' in outcome ? outcome.error : undefined
    };
  });

  return settledOutcomes.length > 0 ? JSON.stringify(settledOutcomes) : null;
}

export function resolveToolFollowupPlan(args: {
  outcomes: ToolActionRunOutcome[];
  seenExchangeFingerprints?: readonly string[];
  assistantToolOnlyTurn?: boolean;
}): ToolFollowupPlan | null {
  const exchangeFingerprint = buildToolExchangeFingerprint(args.outcomes);
  if (!exchangeFingerprint || args.seenExchangeFingerprints?.includes(exchangeFingerprint)) {
    return null;
  }

  const hasCompletedTaskOutcome = args.outcomes.some((outcome) =>
    outcome.path === 'direct'
    && outcome.status === 'executed'
    && outcome.action.kind === 'completeTask'
  );
  if (hasCompletedTaskOutcome && args.assistantToolOnlyTurn !== true) {
    return null;
  }

  return { exchangeFingerprint };
}

export function shouldRequestLengthFollowup(args: {
  reply: Pick<AssistantReply, 'finishReason' | 'transportIncomplete'>;
  isTruncatedToolOutput?: boolean;
  depth: number;
}) {
  if (args.depth >= 2) return false;
  if (args.reply.transportIncomplete) return true;
  if (args.isTruncatedToolOutput) return true;
  if (args.reply.finishReason !== 'length') return false;
  return true;
}

export function buildLengthFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'user',
    [
      '上一条回答在中途停住了，可能是输出长度到顶，也可能是流式连接提前结束。',
      '不要重头开始，不要道歉，不要复述前文。',
      '直接从刚才断开的那一句继续，但只接下一小段。',
      '如果剩余内容还很多，分块推进，不要试图在这一轮把所有剩余内容一次写完。'
    ].join(' '),
    undefined,
    'system-note'
  );
}

export function buildTruncatedToolFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'user',
    [
      '上一条回答里的工具调用或代码参数在中途截断了；Polaris 已尽量先保存能恢复的工作区草稿或文件壳。',
      '不要只输出剩下半截 JSON，也不要把整份代码重新塞进一个巨大工具动作。',
      '把任务拆成下一小块：长文件或多文件同步改用 polaris-project-file 代码块，定点插入用 insertProjectFile，已知行号的行段替换用 replaceProjectFileLines，尾部续写用 appendProjectFile，精确片段替换用 editProjectFileText，删除整个文件用 deleteProjectFile。',
      '一次只落当前这一块；剩余很多时等下一轮继续追加。'
    ].join(' '),
    undefined,
    'system-note'
  );
}

export function relaxToolEnforcementForFollowup(
  toolContext: AssistantToolContext,
  depth: number
): AssistantToolContext {
  if (depth <= 0 || toolContext.toolEnforcementMode !== 'force') {
    return toolContext;
  }

  return {
    ...toolContext,
    toolEnforcementMode: 'normal'
  };
}
