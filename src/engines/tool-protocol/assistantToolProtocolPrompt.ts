import { buildAttachmentContextPrompt, buildCardContextPrompt, buildDesktopLocalContextPrompt, buildUiContextPrompt } from './assistantToolPromptContext';
import { buildBulletPromptLines } from '../promptFormatting';
import type { AssistantToolContext } from './assistantToolProtocolTypes';
import {
  resolveToolCapabilityReceipt,
  TOOL_GROUP_LABELS,
  TOOL_GROUP_ORDER,
  type ToolCapabilityReceipt
} from './toolCapabilityReceipt';
import type { PolarisToolDefinition } from './toolRegistry';
import { buildThemeSnapshotPrompt } from './toolRegistryThemeRules';
import { buildThemePresetSummaryLine } from './themePresetPromptCatalog';
import { isPolarisRegistryToolGroupEnabled } from './toolAvailability';
import {
  areAllUserFacingPolarisToolPromptGroupsDisabled
} from './toolPromptPreferences';

export type AssistantToolPromptProtocolMode = 'native-first' | 'hybrid';
export type AssistantToolPromptSectionName =
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
  | 'theme_context_capability';

export type AssistantToolPromptSection = {
  name: AssistantToolPromptSectionName;
  label: string;
  content: string;
};

const WORKSPACE_FILE_TARGETING_RULE =
  '工作区文件统一定位：所有工作区文件读写、插入、替换、删除都用真实 `filePath`；入口文件也写 `filePath="index.html"`，脚本/CSS 写实际路径；不要用 active 或省略目标让系统猜。';

function buildFallbackProtocolLines(
  protocolMode: AssistantToolPromptProtocolMode,
  receipt: ToolCapabilityReceipt,
  context?: AssistantToolContext
) {
  const themeOnly = context?.toolEnforcementScope === 'theme-only';
  const creativeThemeOnly = themeOnly && (context?.themeToolMode ?? 'stable') === 'creative';
  if (protocolMode === 'native-first') {
    const nativeExample = themeOnly
      ? creativeThemeOnly
        ? '例如创意换肤，把当前皮肤当作 `theme.css` 文件：`replaceThemeCss` 承载完整 CSS；`appendThemeCss` 承载新增规则；`editThemeCss` 承载已有片段替换；`insertThemeCss` 承载贴着已有片段的插入。'
        : '例如稳态换肤，发出 `applyThemeCoordinates` 或 `applySurfaceTokens` 的原生 tool call。'
      : receipt.hasWorkspaceFileTools
        ? (receipt.hasCrossBoundaryTools
          ? '例如当前工作区文件和封面信息由工具目录里的工作区文件工具承载；新建或切换工作区属于跨界工具。长文件正文走下面的 `polaris-project-file` 代码块。'
          : '例如当前工作区文件和封面信息由工具目录里的工作区文件工具承载。长文件正文走下面的 `polaris-project-file` 代码块。')
        : receipt.hasDesktopLocalTools
          ? '例如本机文件夹、真实电脑文件和命令行由工具目录里的本机环境工具承载；只在已授权 rootId 内用相对路径操作。'
        : receipt.hasRoomContentTools
        ? (receipt.hasCrossBoundaryTools
          ? '例如普通房间产物由工具目录里的房间卡工具承载；工作区必须由用户先进入后再继续。'
          : '例如普通房间产物由工具目录里的房间卡工具承载。')
          : '例如当前需要动作时，发出对应可见工具的原生 tool call。';
    return [
      '工具调用：',
      '当前通道按原生 tools 走。需要工具时发出原生 tool call；正文按当前对话语境回应。',
      nativeExample
    ];
  }

  const hybridExample = themeOnly
    ? creativeThemeOnly
      ? '最短格式：```polaris-tools {"actions":[{"kind":"appendThemeCss","css":"...新增 CSS..."}]}``` 表示追加新增 CSS；`replaceThemeCss` 承载完整 CSS；`readThemeCss` 返回可供 `editThemeCss` 精确替换的当前 CSS 片段。'
      : '最短格式：```polaris-tools {"actions":[{"kind":"applyThemeCoordinates","targets":"all","hue":28,"hueCount":2,"emotion":3,"meaning":6,"label":"纸本暖粉"}]}```'
    : receipt.hasWorkspaceFileTools
      ? '最短格式：```polaris-tools {"actions":[{"kind":"appendProjectFile","filePath":"index.html","code":"下一段内容"}]}```；工作区文件动作必须写具体 filePath，继续脚本就传脚本路径，不要写 active。'
      : receipt.hasDesktopLocalTools
        ? '最短格式：```polaris-tools {"actions":[{"kind":"listDesktopFiles","path":"."}]}```；本机路径必须是已授权 rootId 内的相对路径。'
      : receipt.hasRoomContentTools
        ? (receipt.hasCrossBoundaryTools
          ? '最短格式：```polaris-tools {"actions":[{"kind":"createCodeCard","title":"示例","cardNote":"像留给明天的薄纸条。","language":"txt","code":"内容","cardFaceCss":"& { background: linear-gradient(180deg, rgba(248,252,255,0.98), rgba(232,240,255,0.94)); }\\n\\n& h3 { color: #28405c; }","tags":["草稿","房间"]}]}```；工作区必须由用户先进入后再继续。'
          : '最短格式：```polaris-tools {"actions":[{"kind":"createCodeCard","title":"示例","cardNote":"像留给明天的薄纸条。","language":"txt","code":"内容","cardFaceCss":"& { background: linear-gradient(180deg, rgba(248,252,255,0.98), rgba(232,240,255,0.94)); }\\n\\n& h3 { color: #28405c; }","tags":["草稿","房间"]}]}```')
        : '最短格式：```polaris-tools {"actions":[{"kind":"runCode","language":"javascript","code":"console.log(1)"}]}```';
  return [
    '协议 fallback：',
    '能用原生 tools 时直接调用；当前通道不支持原生 tools 时，就在回复开头先输出一个 `polaris-tools` JSON 代码块。',
    hybridExample,
    '不要写半截 JSON，也不要把动作藏进普通文案里。'
  ];
}

function buildProjectDraftProtocolLines(receipt: ToolCapabilityReceipt, context?: AssistantToolContext) {
  if (!receipt.hasWorkspaceFileTools) return [];
  const activeProjectId = context?.activeProject?.id ?? 'current-workspace-id';
  const activeProjectTitle = context?.activeProject?.title ?? '当前工作区';
  const entryFilePath = context?.activeProject?.entryFilePath ?? 'index.html';
  const headerExample = JSON.stringify({
    projectId: activeProjectId,
    projectTitle: activeProjectTitle,
    filePath: entryFilePath,
    language: 'html',
    fileRole: 'entry',
    mode: 'replace'
  });

  return [
    '工作区长文件写入：',
    '长 HTML / CSS / JS / TSX 不要塞进原生 tool 参数，也不要放进 `polaris-tools` JSON 字符串；代码正文直接用可见代码块，Polaris 会把它当工作区文件写入。',
    `格式：\`\`\`polaris-project-file ${headerExample}\\n...文件正文...\\n\`\`\``,
    '格式里的 projectId 使用当前对话绑定的工作区 id。',
    '格式里的 filePath 必须是要写的真实文件路径；不要用 active 代指入口文件或上一轮文件。',
    '`mode=replace` 用于新建文件或重写当前文件；`mode=append` 用于断点续写，只追加下一小块。',
    '已经从 `readProjectFileContext` 或 `searchProjectFiles` 拿到行号时，小段替换优先用 `replaceProjectFileLines`，不要为了行号附近几行再手拼 `oldString`。',
    '如果同一个文件要同时改多处结构，或者你已经知道要动 `head + HTML 主体 + script/style` 这几块，不要连着发几次 `editProjectFileText`，直接用 `mode=replace` 重写这份文件。',
    '如果文件很长，一次只写一个文件的一小块；没写完就停在自然断点，下一轮继续同一个 `projectId + filePath` 且 `mode=append`。'
  ];
}

function buildObjectBoundaryLines(receipt: ToolCapabilityReceipt) {
  if (!receipt.hasRoomContentTools && !receipt.hasWorkspaceFileTools && !receipt.hasCrossBoundaryTools) return [];
  if (receipt.hasRoomContentTools && receipt.hasWorkspaceFileTools) {
    return [
      '对象边界：',
      '房间卡和工作区文件是两套不同对象，各自用自己的工具。',
      '提到卡片、房间、当前卡、卡片标题或卡片正文，就用工具目录里的房间卡工具。',
      '提到当前工作区、项目文件、入口文件或当前工作区入口文件，就用工具目录里的工作区文件工具；长文件正文走 `polaris-project-file` 代码块；不要在模型侧新建或切换工作区。'
    ];
  }
  if (receipt.hasRoomContentTools) {
    return [
      '对象边界：',
      '当前是房间内容场景，只暴露房间内容工具。',
      receipt.hasCrossBoundaryTools
        ? '工作区必须由用户先进入后再继续，模型不要在普通房间场景里创建或切换工作区。'
        : '这轮没有跨界工具。工作区相关动作等用户明确进入工作区后再处理。',
      '卡片相关内容默认直接用房间工具。'
    ];
  }
  if (receipt.hasWorkspaceFileTools) {
    return [
      '对象边界：',
      '当前是工作区内容场景，只暴露当前工作区工具。',
      receipt.hasCrossBoundaryTools
        ? '如果用户明确要新建或切换到别的工作区，单独用跨界工具。'
        : '这轮没有跨界工具。新建或切换工作区等用户明确提出后再处理。',
      '`patchRoomProject` 修改当前工作区的标题、标签、小字和封面样式，不修改任何文件正文。',
      '工作区文件默认按真实路径维护；详细定位规则见工具扩展规则。',
      '工作区里的内容默认按文件来处理。'
    ];
  }
  return [
    '对象边界：',
    '这轮只暴露跨界工具；它们只负责新建、升格或切换工作区，不负责直接编辑卡片或文件。'
  ];
}

function buildToolEnforcementLines(
  context: AssistantToolContext | undefined,
  protocolMode: AssistantToolPromptProtocolMode
) {
  const mode = context?.toolEnforcementMode ?? 'normal';
  if (mode !== 'force') return [];
  const themeOnly = context?.toolEnforcementScope === 'theme-only';

  return [
    '执行态指引：',
    themeOnly
      ? '这轮已经进入美化辅助，只允许调用换肤工具，不要改房间卡、附件、记忆或联网。'
      : '这轮用户已经明确在要你真的动 Polaris 界面、房间、附件、记忆或联网结果。',
    protocolMode === 'native-first'
      ? '原生 tool call 代表真实动作；读取/检查工具只返回证据，不代表写入、应用或完成。'
      : '原生 tool call 或 `polaris-tools` 工具块代表真实动作；读取/检查工具只返回证据，不代表写入、应用或完成。',
    '没有实际动作时只能说还在判断或需要下一步，不能把未执行的动作写成已完成。'
  ];
}

function buildCatalogLines(tools: PolarisToolDefinition[]) {
  const lines = ['工具目录：'];

  for (const group of TOOL_GROUP_ORDER) {
    const groupTools = tools.filter((tool) => tool.group === group);
    if (!groupTools.length) continue;
    lines.push(`${TOOL_GROUP_LABELS[group]}：`);
    lines.push(...buildBulletPromptLines(groupTools, (tool) => `\`${tool.name}\`：${tool.brief}`));
  }

  return lines;
}

function buildMcpStatusLines(context?: AssistantToolContext) {
  const errors = context?.mcpCatalogErrors?.filter((error) => error.trim()) ?? [];
  if (!errors.length) return [];

  return [
    'MCP 状态：',
    '用户已经配置并启用了 MCP 服务，但这轮读取 MCP 工具目录失败，所以对应 MCP 工具没有进入当前工具目录。',
    '不要说用户没有配置 MCP，也不要把联网搜索或读取网页说成 MCP 调用；如果用户问的是 MCP 能力，直接说明连接/目录读取失败并给出错误。',
    ...buildBulletPromptLines(errors, (error) => error)
  ];
}

function buildAllToolsDisabledLines() {
  return [
    '用户目前关闭了所有工具。',
    '不要假装能调用 Polaris 工具；如果用户需要你操作界面、房间、附件、联网、记忆、MCP 或生成内容，先提醒她到工具箱打开对应工具。'
  ];
}

function canShowTaskHandoff(availableTools: PolarisToolDefinition[]) {
  return availableTools.some((tool) => tool.name === 'startTask');
}

function buildThemeTaskHandoffLines(context?: AssistantToolContext) {
  const themeMode = context?.themeToolMode ?? 'stable';
  if (themeMode === 'off') return [];
  if (context?.activeProject) return [];
  if (!isPolarisRegistryToolGroupEnabled(context?.enabledToolGroups, 'theme-stable', context?.toolEnforcementScope)) {
    return [];
  }

  if (themeMode === 'creative') {
    return [
      'theme：用户明确要换肤、换主题、改 Polaris 皮肤或应用整体视觉风格时，创意换肤工具如果已经在工具目录里就直接用；`startTask({ capability: "theme" })` 只把换肤纳入持续任务账本。',
      '卡片 CSS、工作区文件 CSS、键盘/布局/交互修复不走 theme。',
      '创意模式里 `applyPreset.presetId` 只能从真实 presetId 里选；不要按命名规律临时编 `polaris-light`、`polaris-dawn`、`polaris-twilight` 这类不存在的名字。',
      buildThemePresetSummaryLine()
    ];
  }

  return [
    'theme：用户明确要换肤、换主题、改 Polaris 皮肤或应用整体视觉风格时，稳态换肤工具如果已经在工具目录里就直接用；`startTask({ capability: "theme" })` 只把换肤纳入持续任务账本。',
    '卡片 CSS、工作区文件 CSS、键盘/布局/交互修复不走 theme。',
    '稳态换肤用 01-08 编号和四轴/token 工具，不靠猜 presetId。'
  ];
}

function buildRoomTaskHandoffLines(context?: AssistantToolContext) {
  if (!isPolarisRegistryToolGroupEnabled(context?.enabledToolGroups, 'card', context?.toolEnforcementScope)) {
    return [];
  }

  return [
    'room：房间卡工具如果已经在工具目录里就直接用；`startTask({ capability: "room" })` 只把房间卡工作纳入持续任务账本。',
    '房间卡是收藏区里的可保存产物，适合小网页、HTML、小游戏、问卷、菜单、交互故事、礼物页、规则页和单文件互动页面。',
    '房间卡承载可打开的页面和互动产物；纯文本代码块只存在于普通正文，不会进入收藏区。'
  ];
}

function buildWorkspaceTaskHandoffLines(context?: AssistantToolContext) {
  if (!context?.activeProject) return [];
  if (context.toolEnforcementScope === 'theme-only') {
    return [];
  }

  return [
    'workspace：当前对话已经绑定工作区时，工作区文件工具如果已经在工具目录里就直接用；`startTask({ capability: "workspace" })` 只把文件工作纳入持续任务账本。长文件正文用 `polaris-project-file` 代码块写入。',
    '工作区工具按 `projectId + filePath` 维护项目文件：目录工具返回文件列表，读取工具返回文件内容，写入工具改变文件，预览/运行工具返回诊断。'
  ];
}

function buildDesktopTaskHandoffLines(context?: AssistantToolContext) {
  if (!context?.desktopLocalHost?.available || context.desktopLocalHost.trustedRoots.length === 0) {
    return [];
  }
  if (!isPolarisRegistryToolGroupEnabled(context.enabledToolGroups, 'desktop', context.toolEnforcementScope)) {
    return [];
  }

  return [
    'desktop：官网 Mac 桌面版且已有授权本机文件夹时，桌面本机工具如果已经在工具目录里就直接用；`startTask({ capability: "desktop" })` 只把“读/改本机文件、运行命令、复测”的连续工作纳入任务账本。',
    '桌面本机工具只在授权 root 里工作；本机命令和真实文件副作用仍由桌面宿主确认。'
  ];
}

function buildAppTaskHandoffLines() {
  return [
    'app：在 Polaris 应用内部连续处理时，房间卡、工作区、主题、附件、预览和诊断工具如果已经在工具目录里就直接用；`startTask({ capability: "app" })` 只把“看应用内状态、调用已有工具、按证据修正、再次检查”的循环纳入任务账本。',
    'app 循环适合网页、iOS、Android 和桌面共享前端；它不表示手机 shell、不读取手机任意文件，也不复制桌面本机环境工具。'
  ];
}

function buildTaskHandoffLines(
  availableTools: PolarisToolDefinition[],
  context?: AssistantToolContext
) {
  if (!canShowTaskHandoff(availableTools)) return [];
  if ((context?.taskMode ?? 'active') === 'active') return [];

  const lines = [
    '任务账本入口：',
    'startTask 只负责把当前连续工作纳入任务账本；工具目录里已经出现的工具就是这轮可调用工具，不需要先开启任务。',
    ...buildThemeTaskHandoffLines(context),
    ...buildRoomTaskHandoffLines(context),
    ...buildWorkspaceTaskHandoffLines(context),
    ...buildDesktopTaskHandoffLines(context),
    ...buildAppTaskHandoffLines()
  ];

  return lines.length > 2 ? lines : [];
}

function buildContextSnapshotSections(
  receipt: ToolCapabilityReceipt,
  context?: AssistantToolContext
): AssistantToolPromptSection[] {
  const hasRoomOrWorkspaceTools = receipt.hasRoomContentTools || receipt.hasWorkspaceFileTools;
  const sections: AssistantToolPromptSection[] = [
    {
      name: 'ui_context_capability',
      label: '界面上下文快照',
      content: buildUiContextPrompt(context)
    },
    {
      name: 'attachment_context_capability',
      label: '附件上下文快照',
      content: receipt.hasAttachmentOrArchiveTools ? buildAttachmentContextPrompt(context) : ''
    },
    {
      name: 'desktop_local_context_capability',
      label: '本机环境上下文快照',
      content: receipt.hasDesktopLocalTools ? buildDesktopLocalContextPrompt(context) : ''
    },
    {
      name: 'room_context_capability',
      label: '房间 / 工作区上下文快照',
      content: hasRoomOrWorkspaceTools ? buildCardContextPrompt(context) : ''
    },
    {
      name: 'theme_context_capability',
      label: '主题上下文快照',
      content: receipt.hasThemeTools ? buildThemeSnapshotPrompt(context) : ''
    }
  ];

  return sections.filter((section) => section.content.trim().length > 0);
}

function buildExpandedRuleLines(
  receipt: ToolCapabilityReceipt,
  context?: AssistantToolContext
) {
  const seen = new Set<string>();
  const lines: string[] = [];

  if (receipt.hasWorkspaceFileTools) {
    seen.add(WORKSPACE_FILE_TARGETING_RULE);
    lines.push(WORKSPACE_FILE_TARGETING_RULE);
  }

  for (const tool of receipt.nativeTools) {
    const nextLines = tool.buildRules?.(context) ?? tool.rules ?? [];
    for (const line of nextLines) {
      if (!line || seen.has(line)) continue;
      if (receipt.hasWorkspaceFileTools && line.startsWith('- 必须明确 `filePath`：')) continue;
      seen.add(line);
      lines.push(line);
    }
  }

  return lines;
}

export function buildAssistantToolPromptSections(
  context?: AssistantToolContext,
  options?: { protocolMode?: AssistantToolPromptProtocolMode }
): AssistantToolPromptSection[] {
  const receipt = resolveToolCapabilityReceipt(context);
  const contextSnapshotSections = buildContextSnapshotSections(receipt, context);
  const protocolMode = options?.protocolMode ?? 'hybrid';
  const mcpStatusLines = buildMcpStatusLines(context);
  const allToolboxGroupsDisabled = areAllUserFacingPolarisToolPromptGroupsDisabled(
    context?.enabledToolGroups,
    context?.toolEnforcementScope
  );

  if (allToolboxGroupsDisabled) {
    return [{
      name: 'tool_disabled_capability',
      label: '工具关闭状态',
      content: buildAllToolsDisabledLines().join('\n')
    }];
  }

  if (!receipt.availableTools.length && !mcpStatusLines.length) {
    return [];
  }

  const sections: AssistantToolPromptSection[] = [
    {
      name: 'tool_capability',
      label: '工具契约',
      content: [
        '下面这段只管执行，不改你的 persona；Polaris 是应用名，不是你的名字。',
        '工具提示只教现实边界，不教脑内流程：说明真实对象、可用能力、输入输出、副作用和作用域，不替你规定固定步骤。',
        '这里只列这轮当前已打开的工具；工具动作按需要使用，正文按当前对话语境回应。',
        '如果用户只是普通聊天、写自介、润色文案或表达想法，先自然回答，不要输出工具协议、代码草稿或调试残片。',
        ...buildToolEnforcementLines(context, protocolMode),
        ...buildObjectBoundaryLines(receipt)
      ].filter(Boolean).join('\n')
    },
    {
      name: 'mcp_status_capability',
      label: 'MCP 状态',
      content: mcpStatusLines.join('\n')
    },
    {
      name: 'tool_catalog_capability',
      label: '工具目录',
      content:
        protocolMode === 'hybrid' && receipt.nativeTools.length
          ? buildCatalogLines(receipt.nativeTools).join('\n')
          : ''
    },
    {
      name: 'tool_protocol_capability',
      label: '工具协议',
      content: buildFallbackProtocolLines(protocolMode, receipt, context).join('\n')
    },
    {
      name: 'workspace_write_capability',
      label: '工作区长文件写入',
      content: buildProjectDraftProtocolLines(receipt, context).join('\n')
    },
    {
      name: 'tool_rules_capability',
      label: '工具扩展规则',
      content: buildExpandedRuleLines(receipt, context).join('\n')
    },
    {
      name: 'task_handoff_capability',
      label: '任务账本入口',
      content: buildTaskHandoffLines(receipt.nativeTools, context).join('\n')
    }
  ];

  return [...sections, ...contextSnapshotSections].filter((section) => section.content.trim().length > 0);
}

export function buildAssistantToolPrompt(
  context?: AssistantToolContext,
  options?: { protocolMode?: AssistantToolPromptProtocolMode }
): string {
  return buildAssistantToolPromptSections(context, options)
    .map((section) => section.content)
    .join('\n');
}
