import { describe, expect, it } from 'vitest';
import { buildAssistantToolPrompt, buildAssistantToolPromptSections } from './assistantToolProtocolPrompt';
import { resolveAssistantToolRequestTools } from './assistantToolProtocolRequestTools';

function workspaceSnapshot() {
  return {
    id: 'workspace-mini-phone',
    title: 'Mini Phone',
    slug: 'mini-phone',
    tags: [],
    source: 'chat-generated' as const,
    fileCount: 1,
    files: [],
    entryFileId: 'file-1',
    entryFilePath: 'index.html'
  };
}

describe('assistantToolProtocolPrompt', () => {
  it('describes native tool calls without implying that visible text is forbidden', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      activeCard: null,
      visibleCards: []
    }, { protocolMode: 'native-first' });

    expect(prompt).toContain('需要工具时发出原生 tool call');
    expect(prompt).toContain('工具提示只教现实边界，不教脑内流程');
    expect(prompt).toContain('正文按当前对话语境回应');
    expect(prompt).not.toContain('当前通道按原生 tools 走，直接返回 tool call。');
    expect(prompt).not.toContain('不要手写 `<tool_call>`');
  });

  it('keeps the prompt catalog aligned with native request tool schemas', () => {
    const context = {
      themeToolMode: 'stable' as const,
      themeContextMode: 'none' as const,
      toolEnforcementMode: 'normal' as const,
      modelTier: 'medium' as const,
      themePreviewActive: false,
      enabledToolGroups: {
        environment: true,
        room: true,
        project: true,
        theme: true,
        attachment: true,
        generation: true,
        archive: true,
        web: true,
        memory: true,
        memoryWrite: true
      },
      activeCard: null,
      visibleCards: [],
      activeProject: workspaceSnapshot()
    };
    const catalog = buildAssistantToolPromptSections(context)
      .find((section) => section.name === 'tool_catalog_capability')?.content ?? '';
    const catalogToolNames = [...catalog.matchAll(/`([^`]+)`：/g)].map((match) => match[1]);
    const nativeToolNames = resolveAssistantToolRequestTools(context).tools
      .map((tool) => tool.function.name);

    expect([...catalogToolNames].sort()).toEqual([...nativeToolNames].sort());
    expect(catalogToolNames).not.toContain('writeProjectFiles');
  });

  it('surfaces MCP catalog failures without pretending MCP is unconfigured', () => {
    const sections = buildAssistantToolPromptSections({
      themeToolMode: 'off',
      toolEnforcementMode: 'normal',
      enabledToolGroups: {
        environment: false,
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false,
        memoryWrite: false
      },
      activeCard: null,
      visibleCards: [],
      mcpServers: [{
        id: 'mcp-1',
        handle: 'github',
        name: 'GitHub',
        description: '',
        transport: 'streamable-http',
        url: 'http://192.168.0.104:8787/',
        headers: [],
        isActive: true
      }],
      mcpTools: [],
      mcpCatalogErrors: ['GitHub：初始化 MCP 服务 GitHub 失败：Failed to fetch']
    });
    const prompt = sections.map((section) => section.content).join('\n');

    expect(sections.some((section) => section.name === 'mcp_status_capability')).toBe(true);
    expect(sections.find((section) => section.name === 'tool_catalog_capability')?.content ?? '').not.toContain('MCP：');
    expect(prompt).toContain('用户已经配置并启用了 MCP 服务');
    expect(prompt).toContain('不要说用户没有配置 MCP');
    expect(prompt).toContain('GitHub：初始化 MCP 服务 GitHub 失败');
  });

  it('uses a short disabled-tool notice when the user turns off every toolbox group', () => {
    const sections = buildAssistantToolPromptSections({
      themeToolMode: 'off',
      toolEnforcementMode: 'normal',
      enabledToolGroups: {
        environment: false,
        knowledge: false,
        task: false,
        room: false,
        desktop: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false,
        memory: false,
        memoryRecall: false,
        memoryWrite: false,
        proactive: false
      },
      mcpCatalogErrors: ['Example MCP failed'],
      activeCard: null,
      visibleCards: []
    });
    const prompt = sections.map((section) => section.content).join('\n');

    expect(sections.map((section) => section.name)).toEqual(['tool_disabled_capability']);
    expect(prompt).toContain('用户目前关闭了所有工具');
    expect(prompt).toContain('不要假装能调用 Polaris 工具');
    expect(prompt).toContain('提醒她到工具箱打开对应工具');
    expect(prompt).not.toContain('如果用户只是普通聊天');
    expect(prompt).not.toContain('MCP 状态：');
    expect(prompt).not.toContain('工具目录：');
    expect(prompt).not.toContain('协议 fallback：');
  });

  it('keeps context snapshots aligned with actually visible tool groups', () => {
    const sections = buildAssistantToolPromptSections({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        environment: true,
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: [],
      activeProject: workspaceSnapshot(),
      themeSnapshot: {
        activePresetId: 'warm',
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: ''
      }
    });

    expect(sections.some((section) => section.name === 'room_context_capability')).toBe(true);
    expect(sections.some((section) => section.name === 'theme_context_capability')).toBe(false);
    expect(sections.map((section) => section.content).join('\n')).not.toContain('当前换肤模式：稳定模式。');
  });

  it('frames desktop local tools as a normal filesystem and terminal worksite', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'off',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      enabledToolGroups: {
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false,
        desktop: true
      },
      activeCard: null,
      visibleCards: [],
      desktopLocalHost: {
        available: true,
        platform: 'darwin',
        permissionMode: 'trusted',
        trustedRoots: [{
          id: 'root-1',
          label: 'Demo app',
          path: '/Users/aa/Demo',
          lastUsedAt: 1
        }]
      }
    });

    expect(prompt).toContain('普通本机开发现场');
    expect(prompt).toContain('filesystem + terminal');
    expect(prompt).toContain('Polaris 只负责授权边界、工具执行和结果回放');
    expect(prompt).toContain('信任文件读写只影响目录读取、文件读写和同步');
    expect(prompt).toContain('命令仍由桌面宿主逐次确认');
    expect(prompt).toContain('像处理普通终端输出一样处理结果');
  });

  it('keeps room content tools visible during ordinary chat turns', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('`createCodeCard`');
    expect(prompt).not.toContain('`createRoomProject`');
    expect(prompt).not.toContain('`promoteCardToProject`');
    expect(prompt).not.toContain('`createProjectFile`');
    expect(prompt).toContain('`patchCodeCard`');
    expect(prompt).toContain('`appendCodeCard`');
    expect(prompt).toContain('`editCodeCardText`');
    expect(prompt).not.toContain('`appendProjectFile`');
    expect(prompt).not.toContain('`insertProjectFile`');
    expect(prompt).not.toContain('`editProjectFileText`');
    expect(prompt).not.toContain('`readProjectFile`');
    expect(prompt).toContain('对象边界：');
    expect(prompt).toContain('当前是房间内容场景，只暴露房间内容工具。');
    expect(prompt).toContain('这轮没有跨界工具。工作区相关动作等用户明确进入工作区后再处理。');
    expect(prompt).toContain('`readCodeCard`');
    expect(prompt).toContain('如果用户只是普通聊天、写自介、润色文案或表达想法');
    expect(prompt).toContain('房间卡 / 代码卡动作：');
    expect(prompt).not.toContain('工作区文件动作：');
    expect(prompt).not.toContain('跨界：');
    expect(prompt).toContain('`cardFaceCss` 承载这张卡自己的卡面外观');
    expect(prompt).toContain('`cardFaceCss` 直接按创意模式改房间卡卡面来写');
    expect(prompt).toContain('直接把核心状态放进 `window.PolarisRoom`');
    expect(prompt).toContain('复杂交互卡把 `window.PolarisRoom` 当成唯一状态源');
    expect(prompt).toContain('`applyThemeCoordinates`');
    expect(prompt).toContain('`applySurfaceTokens`');
    expect(prompt).toContain('当前换肤模式：稳定模式。01 到 08 是可修改区域编号；稳态工具负责施工和试穿。');
    expect(prompt).not.toContain('`patchRawCss`');
  });

  it('keeps the prompt light before a task is activated', () => {
    const sections = buildAssistantToolPromptSections({
      taskMode: 'seed',
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: true,
        generation: true,
        archive: true,
        web: true,
        memory: true
      },
      activeCard: null,
      visibleCards: []
    });
    const prompt = sections.map((section) => section.content).join('\n');
    const catalog = sections.find((section) => section.name === 'tool_catalog_capability')?.content ?? '';

    expect(prompt).not.toContain('`inspectAttachments`');
    expect(prompt).toContain('`webSearch`');
    expect(prompt).toContain('`createQrCode`');
    expect(prompt).toContain('`readMemoryDoc`');
    expect(prompt).not.toContain('`writeMemory`');
    expect(prompt).not.toContain('`writeMemoryDoc`');
    expect(prompt).toContain('`startTask`');
    expect(prompt).toContain('换肤工具如果已经出现在当前工具目录里，可以直接使用');
    expect(prompt).toContain('startTask capability=theme 只表示把换肤纳入持续任务账本');
    expect(prompt).toContain('startTask 不是工具开关');
    expect(prompt).toContain('任务账本入口：');
    expect(prompt).toContain('工具目录里已经出现的工具就是这轮可调用工具');
    expect(prompt).toContain('用户没有要求进度记录时，不需要为了使用工具而调用 startTask');
    expect(prompt).toContain('稳态换肤工具如果已经在工具目录里就直接用');
    expect(prompt).toContain('房间卡工具如果已经在工具目录里就直接用');
    expect(prompt).toContain('房间卡是收藏区里的可保存产物');
    expect(prompt).toContain('房间卡承载可打开的页面和互动产物');
    expect(prompt).not.toContain('一步就能收尾的小动作不要调用 startTask');
    expect(catalog).not.toContain('`completeTask`');
    expect(catalog).toContain('`createCodeCard`');
    expect(catalog).not.toContain('`createRoomProject`');
    expect(catalog).not.toContain('`createProjectFile`');
    expect(catalog).toContain('`applyThemeCoordinates`');
    expect(catalog).toContain('`applySurfaceTokens`');
    expect(catalog).toContain('`runCode`');
  });

  it('shows real preset ids while keeping opened creative tools visible in seed chat', () => {
    const sections = buildAssistantToolPromptSections({
      taskMode: 'seed',
      themeToolMode: 'creative',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });
    const catalog = sections.find((section) => section.name === 'tool_catalog_capability')?.content ?? '';
    const handoff = sections.find((section) => section.name === 'task_handoff_capability')?.content ?? '';

    expect(handoff).toContain('任务账本入口：');
    expect(handoff).toContain('创意换肤工具如果已经在工具目录里就直接用');
    expect(handoff).toContain('presetId 速查：');
    expect(handoff).toContain('polaris-night');
    expect(handoff).toContain('glass-mint');
    expect(handoff).toContain('不要按命名规律临时编 `polaris-light`');
    expect(catalog).toContain('`patchRawCss`');
    expect(catalog).toContain('`readThemeCss`');
    expect(catalog).toContain('`editThemeCss`');
    expect(catalog).toContain('`replaceThemeCss`');
    expect(catalog).toContain('`applyPreset`');
  });

  it('switches to workspace file tools when the conversation is inside a workspace', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: [],
      activeProject: workspaceSnapshot()
    });

    expect(prompt).not.toContain('`createCodeCard`');
    expect(prompt).not.toContain('`appendCodeCard`');
    expect(prompt).not.toContain('`editCodeCardText`');
    expect(prompt).not.toContain('`createRoomProject`');
    expect(prompt).not.toContain('`promoteCardToProject`');
    expect(prompt).toContain('`patchRoomProject`');
    expect(prompt).toContain('`listProjectFiles`');
    expect(prompt).toContain('`searchProjectFiles`');
    expect(prompt).toContain('`readProjectFileContext`');
    expect(prompt).toContain('`createProjectFile`');
    expect(prompt).toContain('`appendProjectFile`');
    expect(prompt).toContain('`insertProjectFile`');
    expect(prompt).toContain('`editProjectFileText`');
    expect(prompt).toContain('`deleteProjectFile`');
    expect(prompt).toContain('`checkProjectPreview`');
    expect(prompt).toContain('`inspectProjectRuntime`');
    expect(prompt).toContain('`readProjectFile`');
    expect(prompt).toContain('当前是工作区内容场景，只暴露当前工作区工具。');
    expect(prompt).toContain('这轮没有跨界工具。新建或切换工作区等用户明确提出后再处理。');
    expect(prompt).toContain('`patchRoomProject` 修改当前工作区的标题、标签、小字和封面样式');
    expect(prompt).toContain('工作区文件统一定位：所有工作区文件读写');
    expect((prompt.match(/工作区文件统一定位/g) ?? [])).toHaveLength(1);
    expect(prompt).toContain('这是定点插入工具，不是替换工具');
    expect(prompt).toContain('工作区文件：');
    expect(prompt).toContain('工作区长文件写入：');
    expect(prompt).toContain('```polaris-project-file {"projectId":"workspace-mini-phone"');
    expect(prompt).toContain('格式里的 projectId 使用当前对话绑定的工作区 id。');
  });

  it('keeps workspace task handoff visible when the internal project preference is false', () => {
    const sections = buildAssistantToolPromptSections({
      taskMode: 'seed',
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: false,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: [],
      activeProject: workspaceSnapshot()
    });
    const handoff = sections.find((section) => section.name === 'task_handoff_capability')?.content ?? '';

    expect(handoff).toContain('workspace：当前对话已经绑定工作区时');
    expect(handoff).toContain('工作区文件工具如果已经在工具目录里就直接用');
    expect(handoff).toContain('只把文件工作纳入持续任务账本');
  });

  it('keeps stable target legend visible even outside theme-focused turns', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('当前换肤模式：稳定模式。01 到 08 是可修改区域编号；稳态工具负责施工和试穿。');
    expect(prompt).toContain('编号地图：01=背景 · 02=顶栏 · 03=右侧气泡 · 04=回复正文 · 05=发送栏 · 06=系统框 · 07=面板 · 08=卡片');
    expect(prompt).toContain('`targets: ["03","04"]` 这类多个编号，仍然走 `applyThemeCoordinates`');
    expect(prompt).not.toContain('可用 action：');
  });

  it('does not inject theme continuation commands from recent theme focus', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      themeFocus: {
        scopeLabel: '回复气泡',
        recentSurfaceLabels: ['回复气泡'],
        recentSummary: '刚动过回复气泡',
        avoidGlobalPreset: true
      },
      recentToolHistory: {
        kind: 'applySurfaceTokens',
        title: '回复气泡晚雾',
        targetLabel: '回复气泡',
        summary: '已试穿回复气泡',
        status: 'applied'
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).not.toContain('连续对话延续规则');
    expect(prompt).not.toContain('当前延续焦点');
    expect(prompt).not.toContain('上一轮刚动过');
    expect(prompt).not.toContain('最近一次工具结果');
  });

  it('keeps creative selector guidance visible outside preview turns', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'creative',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      uiSnapshot: {
        activeWorld: 'chat',
        collectionShelf: 'code',
        activeConversationTitle: '测试对话',
        activeCollaboratorName: 'Pharos'
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('当前换肤模式：创意模式。把皮肤当作 `theme.css` 文件编辑');
    expect(prompt).toContain('replaceThemeCss 写完整 CSS');
    expect(prompt).toContain('appendThemeCss 新增规则');
    expect(prompt).toContain('`readThemeCss`');
    expect(prompt).toContain('`editThemeCss`');
    expect(prompt).toContain('`replaceThemeCss`');
    expect(prompt).toContain('patchRawCss 是旧入口');
    expect(prompt).toContain('创意模式 selector：');
    expect(prompt).toContain('alias=chat-bubble-user');
    expect(prompt).toContain('alias=chat-tool-receipt');
    expect(prompt).toContain('`.app-shell.chat .bubble.user`');
    expect(prompt).toContain('.world-chat .tool-event');
    expect(prompt).toContain('alias=chat-code-detail');
    expect(prompt).toContain('app-topbar-identity');
    expect(prompt).toContain('“框框 / 外框 / 边框 / 硬框 / 框住”通常对应内层壳');
    expect(prompt).toContain('助手正文是阅读文字，工具收据是执行反馈');
    expect(prompt).toContain('不要把 `chat-background` 写成 `.chat-background`');
    expect(prompt).not.toContain('`applyThemeCoordinates`');
  });

  it('removes a disabled tool group from the prompt catalog without extra disabled notices', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).not.toContain('`applyThemeCoordinates`');
    expect(prompt).not.toContain('`applySurfaceTokens`');
    expect(prompt).not.toContain('当前换肤模式：稳定模式。');
    expect(prompt).not.toContain('提示：现在换肤工具处于关闭状态。');
  });

  it('switches the boundary guidance when only room tools are visible', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('当前是房间内容场景，只暴露房间内容工具。');
    expect(prompt).toContain('这轮没有跨界工具。工作区相关动作等用户明确进入工作区后再处理。');
  });

  it('keeps a toggled-on tool group visible with its full rules', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: true,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('`webSearch`');
    expect(prompt).toContain('`readWebPage`');
    expect(prompt).toContain('联网动作：');
    expect(prompt).toContain('先 webSearch 找候选，再用 readWebPage 读取 2-3 个相关/可信来源后再下结论');
    expect(prompt).toContain('短链分享也交给 readWebPage 跟随跳转读取，包括小红书这类分享链接');
  });

  it('includes attachment and archive rules whenever those groups are visible', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: true,
        generation: false,
        archive: true,
        web: false,
        memory: false
      },
      attachmentSnapshot: {
        latest: [{
          id: 'attachment-zip',
          kind: 'file',
          name: 'materials.zip',
          mimeType: 'application/zip'
        }],
        available: [{
          id: 'attachment-zip',
          kind: 'file',
          name: 'materials.zip',
          mimeType: 'application/zip'
        }]
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('附件动作：');
    expect(prompt).toContain('压缩包动作：');
    expect(prompt).toContain('`inspectAttachments`');
    expect(prompt).toContain('`inspectArchiveEntries`');
    expect(prompt).not.toContain('`createQrCode`');
  });

  it('shows generation tools as their own catalog group', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('生成：');
    expect(prompt).toContain('`createQrCode`');
    expect(prompt).not.toContain('`generateImage`');
    expect(prompt).toContain('生成动作：');
    expect(prompt).not.toContain('生成图片动作：');
    expect(prompt).not.toContain('附件动作：');
  });

  it('adds image generation prompt rules only when the image route is available', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      imageGenerationAvailable: true,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('生成：');
    expect(prompt).toContain('`createQrCode`');
    expect(prompt).toContain('`generateImage`');
    expect(prompt).toContain('生成图片动作：');
  });

  it('teaches the expanded runCode sandbox when the experimental profile is unlocked', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      runCodeSandboxProfile: 'experimental',
      enabledToolGroups: {
        room: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('当前 runCode 沙箱：实验模式。可以联网 fetch / XHR / WebSocket、弹 modal / popup、跑 blob worker，也允许下载');
    expect(prompt).not.toContain(`Polaris${'Host'}`);
    expect(prompt).not.toContain(`window${'.parent'}`);
  });

  it('shrinks forced beautify turns to theme tools only', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'force',
      toolEnforcementScope: 'theme-only',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('这轮已经进入美化辅助，只允许调用换肤工具');
    expect(prompt).toContain('`applyThemeCoordinates`');
    expect(prompt).toContain('`applySurfaceTokens`');
    expect(prompt).not.toContain('`createCodeCard`');
    expect(prompt).not.toContain('`createProjectFile`');
    expect(prompt).not.toContain('`patchCodeCard`');
  });

  it('uses creative theme css examples on forced creative beautify turns', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'creative',
      themeContextMode: 'none',
      toolEnforcementMode: 'force',
      toolEnforcementScope: 'theme-only',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(prompt).toContain('这轮已经进入美化辅助，只允许调用换肤工具');
    expect(prompt).toContain('`readThemeCss`');
    expect(prompt).toContain('`editThemeCss`');
    expect(prompt).toContain('`appendThemeCss`');
    expect(prompt).toContain('`insertThemeCss`');
    expect(prompt).toContain('`deleteThemeCss`');
    expect(prompt).toContain('`replaceThemeCss`');
    expect(prompt).toContain('`inspectThemeRender`');
    expect(prompt).toContain('```polaris-tools {"actions":[{"kind":"appendThemeCss","css":"...新增 CSS..."}]}``` 表示追加新增 CSS');
    expect(prompt).toContain('`readThemeCss` 返回可供 `editThemeCss` 精确替换的当前 CSS 片段');
    expect(prompt).not.toContain('`applyThemeCoordinates`');
    expect(prompt).not.toContain('`createCodeCard`');
    expect(prompt).not.toContain('`createProjectFile`');
  });

  it('drops fallback json teaching in native-first mode', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    }, {
      protocolMode: 'native-first'
    });

    expect(prompt).toContain('当前通道按原生 tools 走。需要工具时发出原生 tool call');
    expect(prompt).toContain('例如普通房间产物由工具目录里的房间卡工具承载。');
    expect(prompt).toContain('这轮没有跨界工具。工作区相关动作等用户明确进入工作区后再处理。');
    expect(prompt).not.toContain('工作区长文件写入：');
    expect(prompt).not.toContain('```polaris-project-file {"projectId":"mini-phone"');
    expect(prompt).not.toContain('协议 fallback：');
    expect(prompt).not.toContain('`polaris-tools` JSON 代码块');
  });

  it('teaches flat createCodeCard payloads in hybrid fallback mode', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    }, {
      protocolMode: 'hybrid'
    });

    expect(prompt).toContain('最短格式：```polaris-tools {"actions":[{"kind":"createCodeCard"');
    expect(prompt).toContain('这轮没有跨界工具。工作区相关动作等用户明确进入工作区后再处理。');
    expect(prompt).not.toContain('长工作区代码用下面的工作区文件代码块落盘');
    expect(prompt).not.toContain('```polaris-project-file {"projectId":"mini-phone"');
    expect(prompt).not.toContain('`mode=append` 用于断点续写');
    expect(prompt).not.toContain('"card":{"title":"示例"');
  });

  it('teaches real card face variables and selectors for code cards', () => {
    const prompt = buildAssistantToolPrompt({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      modelTier: 'medium',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    }, {
      protocolMode: 'native-first'
    });

    expect(prompt).toContain('`cardFaceCss` 是单张房间卡 / 代码卡的局部卡面 CSS');
    expect(prompt).toContain('作用域已经自动收在卡内');
    expect(prompt).toContain('正文 HTML 或 `<style>` 属于卡片正文作用域');
    expect(prompt).toContain('卡面边框是可见卡面的一部分');
    expect(prompt).toContain('`window.PolarisRoom`');
    expect(prompt).toContain('简单 `input / textarea / select` 会自动持久化');
    expect(prompt).toContain('不要让 checkbox DOM 和你自己的 JS 数组各记一份');
    expect(prompt).toContain('`& .code-card-main`');
    expect(prompt).toContain('`& .card-meta-row small`');
    expect(prompt).toContain('`& h3`');
    expect(prompt).toContain('`& .code-card-snippet`');
    expect(prompt).not.toContain('`& .code-card-time`');
    expect(prompt).not.toContain('`& .code-card-footer`');
    expect(prompt).toContain('不要再写 `--code-card-face-*`、`--card-bg`、`.code-card-title`');
    expect(prompt).not.toContain('卡面示例：');
  });
});
