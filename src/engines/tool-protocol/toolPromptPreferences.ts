import type {
  AssistantToolEnforcementScope,
  PolarisToolPromptGroup,
  PolarisToolPromptPreferences
} from './assistantToolProtocolTypes';
import { isPolarisToolGroupEnabled } from './toolAvailability';

export const POLARIS_TOOL_PROMPT_GROUP_ORDER: PolarisToolPromptGroup[] = [
  'environment',
  'knowledge',
  'task',
  'room',
  'project',
  'desktop',
  'theme',
  'attachment',
  'generation',
  'archive',
  'web',
  'personalData',
  'mcp',
  'memory',
  'memoryRecall',
  'memoryWrite',
  'proactive'
];

export const POLARIS_TOOLBOX_PROMPT_GROUP_ORDER: PolarisToolPromptGroup[] = [
  'environment',
  'knowledge',
  'task',
  'room',
  'desktop',
  'theme',
  'attachment',
  'generation',
  'archive',
  'web',
  'personalData',
  'mcp',
  'memory',
  'memoryRecall',
  'memoryWrite',
  'proactive'
];

export const DEFAULT_POLARIS_TOOL_PROMPT_PREFERENCES: Record<PolarisToolPromptGroup, boolean> = {
  environment: true,
  task: true,
  room: true,
  project: false,
  desktop: true,
  theme: true,
  attachment: false,
  generation: false,
  archive: false,
  web: false,
  personalData: false,
  mcp: true,
  knowledge: true,
  memory: true,
  memoryRecall: true,
  memoryWrite: false,
  proactive: false
};

export const POLARIS_TOOL_PROMPT_GROUP_LABELS: Record<PolarisToolPromptGroup, string> = {
  environment: '环境',
  task: '任务',
  room: '卡片',
  project: '工作区',
  desktop: '本机',
  theme: '换肤',
  attachment: '附件',
  generation: '生成',
  archive: '压缩包',
  web: '联网',
  personalData: '系统资料',
  mcp: 'MCP',
  knowledge: '产品知识',
  memory: '长期资料',
  memoryRecall: '主动回忆',
  memoryWrite: '写入记忆',
  proactive: '主动消息'
};

export const POLARIS_TOOL_PROMPT_GROUP_DESCRIPTIONS: Record<PolarisToolPromptGroup, string> = {
  environment: '让协作者按需查看当前环境目录、设置入口、工作区、房间卡、附件、本机、MCP 和记忆的可用取景，不直接替代真实工具。',
  task: '让协作者把连续工作纳入任务账本，保留目标、进度、工具结果和下一步。',
  room: '让协作者能新建或修改房间卡 / 代码卡，也能用 JS 沙箱处理计算、文本和卡片产物。',
  project: '内部场景开关：进入工作区后自动使用文件工具，不作为普通对话里的常驻工具展示。',
  desktop: '让官网 Mac 桌面版协作者使用你授权的本机文件夹和需要逐次确认的命令行。',
  theme: '让协作者能试穿、精修和回滚界面换肤。',
  attachment: '让协作者查看、读取和保存当前对话里的附件。',
  generation: '让协作者生成新的产物附件，比如二维码。',
  archive: '让协作者处理 zip 和压缩包里的条目。',
  web: '让协作者联网搜索或读网页。',
  personalData: '让协作者在你主动开启后读取本设备日历，也可以按你的要求创建、修改或删除日历事件。',
  mcp: '让协作者调用已启用 MCP 服务暴露出来的外部工具。',
  knowledge: '当你不知道怎么使用北极星时，可以打开这个工具，让协作者读取产品知识来指引你，或者你也可以直接看使用文档。',
  memory: '让协作者读取当前协作者的长期资料全文。',
  memoryRecall: '让协作者在不确定你当前指代、但过往对话可能有帮助时，主动搜索旧摘要和原文锚点。',
  memoryWrite: '让协作者把稳定线索写进长期记忆。',
  proactive: '让协作者在对话中为自己创建主动消息规则，之后按时间主动开口。'
};

export function isPolarisToolPromptGroupEnabled(
  preferences: PolarisToolPromptPreferences | undefined,
  group: PolarisToolPromptGroup,
  enforcementScope?: AssistantToolEnforcementScope
) {
  return isPolarisToolGroupEnabled(preferences, group, enforcementScope);
}

export function areAllUserFacingPolarisToolPromptGroupsDisabled(
  preferences: PolarisToolPromptPreferences | undefined,
  enforcementScope?: AssistantToolEnforcementScope
) {
  if (!preferences) return false;
  return POLARIS_TOOLBOX_PROMPT_GROUP_ORDER.every((group) =>
    !isPolarisToolPromptGroupEnabled(preferences, group, enforcementScope)
  );
}
