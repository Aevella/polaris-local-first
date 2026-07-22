import type { ToolContext } from '../../engines/toolExecutorTypes';
import type { PolarisTriggerRule } from '../../types/domain';
import type { ChatToolStoreBindings } from './chatToolActionTypes';

function formatTriggerScheduleLabel(action: Parameters<ToolContext['createProactiveMessageRule']>[0]) {
  return action.schedule.kind === 'daily'
    ? `每天 ${action.schedule.time}`
    : `每隔 ${action.schedule.everyMinutes} 分钟`;
}
function formatRuleScheduleLabel(rule: PolarisTriggerRule) {
  return rule.schedule.kind === 'daily'
    ? `每天 ${rule.schedule.time}`
    : `每隔 ${rule.schedule.everyMinutes} 分钟`;
}

function formatRuleTargetLabel(rule: PolarisTriggerRule) {
  return rule.target.conversationMode === 'fixed' ? '固定对话' : '最近对话';
}

export function buildProactiveToolExecutionContext(args: {
  runtime: ChatToolStoreBindings['runtime'];
  ownerCollaboratorId: string | null | undefined;
  conversationId: string;
}): Pick<ToolContext, 'createProactiveMessageRule' | 'listProactiveMessageRules' | 'updateProactiveMessageRule' | 'deleteProactiveMessageRule'> {
  const { runtime, ownerCollaboratorId, conversationId } = args;
  const listOwnerTriggerRules = () => {
    const collaboratorId = ownerCollaboratorId?.trim();
    return collaboratorId
      ? runtime.getTriggerRules().filter((rule) => rule.target.collaboratorId === collaboratorId)
      : [];
  };
  const findOwnerTriggerRule = (ruleId: string) => {
    const normalizedRuleId = ruleId.trim();
    return listOwnerTriggerRules().find((rule) => rule.id === normalizedRuleId) ?? null;
  };

  return {
    createProactiveMessageRule: (action) => {
      const collaboratorId = ownerCollaboratorId?.trim();
      if (!collaboratorId) {
        return { ok: false, error: '当前对话没有绑定协作者，不能创建主动消息规则。' };
      }
      const prompt = action.prompt.trim();
      if (!prompt) {
        return { ok: false, error: '主动消息规则缺少提示词。' };
      }
      const conversationMode = action.conversationMode === 'follow-latest' ? 'follow-latest' : 'fixed';
      const ruleId = runtime.createTriggerRule({
        name: action.name?.trim() || undefined,
        schedule: action.schedule,
        target: {
          collaboratorId,
          conversationMode,
          conversationId: conversationMode === 'fixed' ? conversationId : null
        },
        action: {
          prompt
        }
      });
      const scheduleLabel = formatTriggerScheduleLabel(action);
      const targetLabel = conversationMode === 'fixed' ? '当前对话' : '这个协作者的最近对话';
      return {
        ok: true,
        summary: `已创建主动消息规则 · ${action.name?.trim() || scheduleLabel}`,
        detailText: [
          `ruleId=${ruleId}`,
          `schedule=${scheduleLabel}`,
          `target=${targetLabel}`,
          `prompt=${prompt}`
        ].join('\n'),
        triggerRuleId: ruleId
      };
    },
    listProactiveMessageRules: () => {
      const collaboratorId = ownerCollaboratorId?.trim();
      if (!collaboratorId) {
        return { ok: false, error: '当前对话没有绑定协作者，不能查看主动消息规则。' };
      }
      const rules = listOwnerTriggerRules();
      const detailText = rules.length
        ? rules.map((rule, index) => [
            `${index + 1}. ${rule.name}`,
            `ruleId=${rule.id}`,
            `enabled=${rule.enabled ? 'true' : 'false'}`,
            `schedule=${formatRuleScheduleLabel(rule)}`,
            `target=${formatRuleTargetLabel(rule)}`,
            `prompt=${rule.action.prompt}`
          ].join('\n')).join('\n\n')
        : '当前协作者还没有主动消息规则。';
      return {
        ok: true,
        summary: `已查看主动消息规则 · ${rules.length} 条`,
        detailText,
        triggerRules: rules
      };
    },
    updateProactiveMessageRule: (action) => {
      const rule = findOwnerTriggerRule(action.ruleId);
      if (!rule) {
        return { ok: false, error: `没有找到当前协作者的主动消息规则：${action.ruleId}` };
      }
      const conversationMode = action.conversationMode;
      runtime.updateTriggerRule(rule.id, {
        ...(action.name ? { name: action.name } : {}),
        ...(action.prompt ? { action: { prompt: action.prompt } } : {}),
        ...(action.schedule ? { schedule: action.schedule } : {}),
        ...(conversationMode ? {
          target: {
            ...rule.target,
            conversationMode,
            conversationId: conversationMode === 'fixed' ? conversationId : null
          }
        } : {})
      });
      const updatedRule: PolarisTriggerRule = {
        ...rule,
        ...(action.name ? { name: action.name } : {}),
        ...(action.prompt ? { action: { prompt: action.prompt } } : {}),
        ...(action.schedule ? { schedule: action.schedule } : {}),
        ...(conversationMode ? {
          target: {
            ...rule.target,
            conversationMode,
            conversationId: conversationMode === 'fixed' ? conversationId : null
          }
        } : {})
      };
      return {
        ok: true,
        summary: `已修改主动消息规则 · ${updatedRule.name}`,
        detailText: [
          `ruleId=${updatedRule.id}`,
          `schedule=${formatRuleScheduleLabel(updatedRule)}`,
          `target=${formatRuleTargetLabel(updatedRule)}`,
          `prompt=${updatedRule.action.prompt}`
        ].join('\n'),
        triggerRuleId: updatedRule.id
      };
    },
    deleteProactiveMessageRule: (action) => {
      const rule = findOwnerTriggerRule(action.ruleId);
      if (!rule) {
        return { ok: false, error: `没有找到当前协作者的主动消息规则：${action.ruleId}` };
      }
      runtime.deleteTriggerRule(rule.id);
      return {
        ok: true,
        summary: `已取消主动消息规则 · ${rule.name}`,
        detailText: [
          `ruleId=${rule.id}`,
          `schedule=${formatRuleScheduleLabel(rule)}`,
          `target=${formatRuleTargetLabel(rule)}`
        ].join('\n'),
        triggerRuleId: rule.id
      };
    },
  };
}
