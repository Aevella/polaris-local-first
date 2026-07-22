import type { AssistantPromptPart } from './requestAudit';
import type { TemplateContext } from '../templateEngine';
import type { ChatMessage, ConversationTaskState } from '../../types/domain';
import { buildConversationTaskModelSnapshot, resolveConversationTaskMode } from '../conversationTask';
import type { AssistantToolContext } from '../assistantToolProtocol';
import type { ProviderCapabilityPromptInjection } from '../provider-runtime';
import { buildBulletPromptLines } from '../promptFormatting';
import { buildWorkContext, type WorkContextProjection } from '../workContext';

export function buildRuntimeClockEntry(
  templateContext: TemplateContext
): Omit<AssistantPromptPart, 'enabled' | 'charCount'> {
  return {
    name: 'runtime_clock_context',
    label: '时间上下文',
    role: 'system',
    layer: 'context',
    truncationPriority: 0,
    content: [
      '下面是这轮对话的当前本地时间上下文。',
      '凡是“现在 / 今天 / 今晚 / 明天 / 昨天 / 稍后 / 刚刚”这类相对时间，都默认按这里理解，除非用户明确指定了别的时区或日期。',
      `当前本地完整时间：${templateContext.cur_datetime}`,
      `当前时区：${templateContext.timezone}`
    ].join('\n')
  };
}

export function buildModelRuntimeEntry(args: {
  promptInjections?: ProviderCapabilityPromptInjection[];
  toolContext?: AssistantToolContext;
}): Omit<AssistantPromptPart, 'enabled' | 'charCount'> | null {
  const injection = args.promptInjections?.find((entry) => entry.name === 'model_runtime_context');
  if (!injection) {
    return null;
  }

  const hasExecutionTarget =
    Boolean(args.toolContext?.activeProject)
    || args.toolContext?.themeToolMode === 'stable'
    || args.toolContext?.themeToolMode === 'creative';
  if (injection.requiresExecutionTarget && !hasExecutionTarget) {
    return null;
  }

  return {
    name: 'model_runtime_context',
    label: '模型执行提示',
    role: 'system',
    layer: 'context',
    truncationPriority: 1,
    content: [
      '下面是当前模型的执行提示。',
      '当用户已经给出明确修改目标，并且当前上下文已经提供了可写的工作区文件或主题目标时，少思考，直接做。',
      '当前工作区文件目录和可见文件内容可能已经在上下文里；完整全文或精确锚点不在上下文时，才需要读取对应文件。',
      '当前主题目标已经在上下文里；如果用户要求直接改某个主题表面，就直接调用应用/写入工具，不要先停在 `readThemeCss` 或解释。',
      '不要把这一轮停在只读取、只检查、只解释；只有确实缺少文件内容、唯一锚点或目标身份时，才先调用读取/检查工具。',
      'For this model: if the target is explicit and the requested change is a whole-file rewrite or direct theme edit, call the write/apply tool now. A read-only first turn is unfinished.'
    ].join('\n')
  };
}

function formatWorkContextLines(workContext: WorkContextProjection) {
  const lines: string[] = [];

  if (workContext.taskLines.length) {
    lines.push('任务现场：');
    lines.push(...buildBulletPromptLines(workContext.taskLines, (line) => line));
  }
  if (workContext.workspaceLines.length) {
    lines.push('工作区动作：');
    lines.push(...buildBulletPromptLines(workContext.workspaceLines, (line) => line));
  }
  if (workContext.feedbackLines.length) {
    lines.push('需要注意：');
    lines.push(...buildBulletPromptLines(workContext.feedbackLines, (line) => line));
  }

  return lines.length ? lines : buildBulletPromptLines(workContext.lines, (line) => line);
}

export function buildWorkRuntimeEntry(args: {
  currentTask?: ConversationTaskState | null;
  messages: ChatMessage[];
  toolContext?: AssistantToolContext;
}): Omit<AssistantPromptPart, 'enabled' | 'charCount'> | null {
  const { currentTask, messages, toolContext } = args;
  const hasActiveTask = Boolean(currentTask && resolveConversationTaskMode(currentTask) === 'active');
  const workContext = toolContext?.workContext ?? buildWorkContext({
    currentTask,
    messages,
    activeProject: toolContext?.activeProject,
    visibleProjects: toolContext?.visibleProjects,
    runtimeFeedback: toolContext?.runtimeFeedback
  });
  if (!hasActiveTask && workContext.lines.length === 0) return null;
  const workContextLines = formatWorkContextLines(workContext);

  if (!hasActiveTask || !currentTask) {
    return {
      name: 'work_runtime_context',
      label: '当前工作现场',
      role: 'system',
      layer: 'context',
      truncationPriority: 0,
      content: [
        '下面是这轮对话的当前工作现场。它是从当前目标、工作区动作和运行时反馈统一派生出来的，只读，不要求你维护 task 账本。',
        ...workContextLines
      ].join('\n')
    };
  }

  const modelSnapshot = buildConversationTaskModelSnapshot(currentTask);

  return {
    name: 'work_runtime_context',
    label: '当前工作现场',
    role: 'system',
    layer: 'context',
    truncationPriority: 0,
    content: [
      '当前这轮对话天然跑在一个持续任务里。不要另起炉灶，也不要把它当一串彼此无关的回复。',
      '当任务状态发生真实变化时，在 assistant 回复结尾附带一个隐藏的 `polaris-task` JSON 代码块，用来提交任务状态补丁。这个代码块不会展示给用户。',
      '只有 seed task 需要激活、阶段/步骤/status 变化、任务 blocked/completed/cancelled，或 `focus` / `next` 有真实更新时才写这个代码块；如果只是解释、闲聊、复述，或工具结果已经能自动落账，就不要为了心跳硬写。',
      '任务更新规则：沿用同一个 `id`；`status` 只能是 `running | blocked | completed | cancelled`；`stage` 用一句短话描述当前阶段；`steps` 只写真正相关的步骤，每步 `status` 只能是 `pending | in_progress | completed | blocked`。',
      '如果这轮顺嘴，也可以额外写 `focus` 和 `next` 两个可选字段：`focus` 是你现在正埋头在做的那一句，`next` 是你等下接着要干的那一句。它们都应该像你自然抬头交代工作那样短，不要为了填字段硬写。',
      '把下面这些当成你眼前的工作现场，不是另一套要死记硬背的协议。只要现场顺，你自然会知道什么时候低声说一句现在和下一步。',
      ...workContextLines,
      '如果这轮把一个很小的 task 直接完成了，可以用一条 `completed` 更新收尾；如果状态没变，就安静保留现有 task 账本。',
      '代码块格式：```polaris-task {"id":"当前任务id","title":"短标题","status":"running","stage":"当前阶段","summary":"可选总结","focus":"可选，现在我在……","next":"可选，等下我会……","steps":[{"id":"step-1","title":"步骤标题","status":"completed"}]}```',
      '当前任务账本：',
      `\`\`\`json\n${JSON.stringify(modelSnapshot, null, 2)}\n\`\`\``
    ].join('\n')
  };
}
