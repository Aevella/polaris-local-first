import {
  isPolarisToolExposedAsNative,
  resolveAvailablePolarisTools,
  type PolarisRegistryToolGroup,
  type PolarisToolDefinition,
  type ToolResolutionSource
} from './toolRegistry';

export type ToolCapabilityScene = 'room' | 'workspace' | 'cross-boundary' | 'utility';

export type ToolCapabilityReceipt = {
  availableTools: PolarisToolDefinition[];
  nativeTools: PolarisToolDefinition[];
  scene: ToolCapabilityScene;
  hasRoomContentTools: boolean;
  hasWorkspaceFileTools: boolean;
  hasCrossBoundaryTools: boolean;
  hasThemeTools: boolean;
  hasAttachmentOrArchiveTools: boolean;
  hasDesktopLocalTools: boolean;
  nativeToolsByGroup: Partial<Record<PolarisRegistryToolGroup, PolarisToolDefinition[]>>;
};

export const TOOL_GROUP_ORDER: PolarisRegistryToolGroup[] = [
  'environment',
  'knowledge',
  'card',
  'cross-boundary',
  'project',
  'desktop',
  'mcp',
  'task',
  'theme-stable',
  'theme-creative',
  'attachment',
  'generation',
  'archive',
  'web',
  'personalData',
  'memory',
  'memoryRecall',
  'memoryWrite',
  'proactive'
];

export const TOOL_GROUP_LABELS: Record<PolarisRegistryToolGroup, string> = {
  environment: '环境目录',
  card: '卡片',
  'cross-boundary': '跨界',
  project: '工作区文件',
  desktop: '本机环境',
  mcp: 'MCP',
  task: '任务',
  'theme-stable': '稳态换肤',
  'theme-creative': '创意换肤',
  attachment: '附件',
  generation: '生成',
  archive: '压缩包',
  web: '联网',
  personalData: '系统资料',
  knowledge: '产品知识',
  memory: '长期资料',
  memoryRecall: '主动回忆',
  memoryWrite: '写入记忆',
  proactive: '主动消息'
};

function groupNativeTools(tools: PolarisToolDefinition[]) {
  return tools.reduce<Partial<Record<PolarisRegistryToolGroup, PolarisToolDefinition[]>>>(
    (groups, tool) => ({
      ...groups,
      [tool.group]: [...(groups[tool.group] ?? []), tool]
    }),
    {}
  );
}

function resolveScene(args: {
  hasRoomContentTools: boolean;
  hasWorkspaceFileTools: boolean;
  hasCrossBoundaryTools: boolean;
}): ToolCapabilityScene {
  if (args.hasWorkspaceFileTools) return 'workspace';
  if (args.hasRoomContentTools) return 'room';
  if (args.hasCrossBoundaryTools) return 'cross-boundary';
  return 'utility';
}

function isRoomContentTool(tool: PolarisToolDefinition) {
  return tool.group === 'card' && tool.name !== 'runCode';
}

export function resolveToolCapabilityReceipt(context?: ToolResolutionSource): ToolCapabilityReceipt {
  const availableTools = resolveAvailablePolarisTools(context);
  const nativeTools = availableTools.filter(isPolarisToolExposedAsNative);
  const hasRoomContentTools = nativeTools.some(isRoomContentTool);
  const hasWorkspaceFileTools = nativeTools.some((tool) => tool.group === 'project');
  const hasCrossBoundaryTools = nativeTools.some((tool) => tool.group === 'cross-boundary');
  const hasThemeTools = nativeTools.some((tool) => tool.group === 'theme-stable' || tool.group === 'theme-creative');
  const hasAttachmentOrArchiveTools = nativeTools.some((tool) => tool.group === 'attachment' || tool.group === 'archive');
  const hasDesktopLocalTools = nativeTools.some((tool) => tool.group === 'desktop');

  return {
    availableTools,
    nativeTools,
    scene: resolveScene({
      hasRoomContentTools,
      hasWorkspaceFileTools,
      hasCrossBoundaryTools
    }),
    hasRoomContentTools,
    hasWorkspaceFileTools,
    hasCrossBoundaryTools,
    hasThemeTools,
    hasAttachmentOrArchiveTools,
    hasDesktopLocalTools,
    nativeToolsByGroup: groupNativeTools(nativeTools)
  };
}
