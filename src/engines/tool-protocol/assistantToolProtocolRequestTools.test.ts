import { describe, expect, it } from 'vitest';
import { resolveAssistantToolRequestTools } from './assistantToolProtocolRequestTools';
import { buildToolCardFunctionName } from '../toolCardRuntime';

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

describe('assistantToolProtocolRequestTools', () => {
  it('keeps room content tools visible in ordinary chat while hiding workspace file tools', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: true,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(result.toolChoice).toBe('auto');
    expect(result.tools.some((tool) => tool.function.name === 'createRoomProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'promoteCardToProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'patchCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'appendCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'editCodeCardText')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'appendProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'insertProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'editProjectFileText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'applyThemeCoordinates')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'applySurfaceTokens')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'webSearch')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'writeMemory')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'writeMemoryDoc')).toBe(false);
  });

  it('keeps creative theme tools callable in seed chat when the user opened theme mode', () => {
    const result = resolveAssistantToolRequestTools({
      taskMode: 'seed',
      themeToolMode: 'creative',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
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
      visibleCards: []
    });

    expect(result.tools.some((tool) => tool.function.name === 'startTask')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'wait')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'appendThemeCss')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'replaceThemeCss')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'applyThemeCoordinates')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(true);
  });

  it('hides only task tools when the task toolbox group is closed', () => {
    const result = resolveAssistantToolRequestTools({
      taskMode: 'seed',
      themeToolMode: 'creative',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: false,
        task: false,
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

    expect(result.tools.some((tool) => tool.function.name === 'startTask')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'wait')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'appendThemeCss')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(true);
  });

  it('switches to workspace file tools once the conversation is inside a workspace', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
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
      visibleCards: [],
      activeProject: workspaceSnapshot()
    });

    expect(result.tools.some((tool) => tool.function.name === 'createRoomProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'promoteCardToProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'appendCodeCard')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'editCodeCardText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readCodeCard')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'patchRoomProject')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'appendProjectFile')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'insertProjectFile')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'replaceProjectFileLines')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'editProjectFileText')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readProjectFile')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'startTask')).toBe(false);
  });

  it('keeps workspace file tools visible even when the internal project group is not user-toggleable', () => {
    const result = resolveAssistantToolRequestTools({
      taskMode: 'active',
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: false,
        theme: true,
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

    expect(result.tools.some((tool) => tool.function.name === 'startTask')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'writeProjectFiles')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readProjectFile')).toBe(true);
  });

  it('hides every request tool when the user closes every toolbox group', () => {
    const result = resolveAssistantToolRequestTools({
      taskMode: 'active',
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
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
      activeCard: null,
      visibleCards: [],
      activeProject: workspaceSnapshot()
    });

    expect(result.tools).toEqual([]);
    expect(result.toolChoice).toBeUndefined();
  });

  it('keeps tool choice automatic while forced mode scopes available tools', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'focused',
      toolEnforcementMode: 'force',
      toolEnforcementScope: 'theme-only',
      themePreviewActive: true,
      activeCard: null,
      visibleCards: []
    });

    expect(result.toolChoice).toBe('auto');
    expect(result.tools.some((tool) => tool.function.name === 'applyThemeCoordinates')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'applySurfaceTokens')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'patchCodeCard')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'appendProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'insertProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(false);
  });

  it('separates project tools from ordinary room tools', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
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

    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'patchCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'appendCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'editCodeCardText')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createRoomProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'promoteCardToProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'appendProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'editProjectFileText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readProjectFile')).toBe(false);
  });

  it('restores a toggled-on tool group to the request schema', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
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

    expect(result.tools.some((tool) => tool.function.name === 'webSearch')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readWebPage')).toBe(true);
  });

  it('exposes personal data tools only when the group and native capability are both available', () => {
    const unavailable = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        personalData: true
      },
      activeCard: null,
      visibleCards: []
    });
    const calendarOnly = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        personalData: true
      },
      personalData: {
        calendarAvailable: true,
        calendarWriteAvailable: true
      },
      activeCard: null,
      visibleCards: []
    });

    expect(unavailable.tools.some((tool) => tool.function.name === 'listCalendars')).toBe(false);
    expect(unavailable.tools.some((tool) => tool.function.name === 'readCalendarEvents')).toBe(false);
    expect(unavailable.tools.some((tool) => tool.function.name === 'createCalendarEvent')).toBe(false);
    expect(unavailable.tools.some((tool) => tool.function.name === 'updateCalendarEvent')).toBe(false);
    expect(unavailable.tools.some((tool) => tool.function.name === 'deleteCalendarEvent')).toBe(false);
    expect(unavailable.tools.some((tool) => tool.function.name === 'readHealthSummary')).toBe(false);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'listCalendars')).toBe(true);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'readCalendarEvents')).toBe(true);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'createCalendarEvent')).toBe(true);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'updateCalendarEvent')).toBe(true);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'deleteCalendarEvent')).toBe(true);
    expect(calendarOnly.tools.some((tool) => tool.function.name === 'readHealthSummary')).toBe(false);
  });

  it('exposes only calendar creation when the native bridge has write-only calendar permission', () => {
    const writeOnly = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        personalData: true
      },
      personalData: {
        calendarAvailable: false,
        calendarWriteAvailable: true
      },
      activeCard: null,
      visibleCards: []
    });

    expect(writeOnly.tools.some((tool) => tool.function.name === 'listCalendars')).toBe(false);
    expect(writeOnly.tools.some((tool) => tool.function.name === 'readCalendarEvents')).toBe(false);
    expect(writeOnly.tools.some((tool) => tool.function.name === 'createCalendarEvent')).toBe(true);
    expect(writeOnly.tools.some((tool) => tool.function.name === 'updateCalendarEvent')).toBe(false);
    expect(writeOnly.tools.some((tool) => tool.function.name === 'deleteCalendarEvent')).toBe(false);
  });

  it('exposes proactive message rule creation only when the proactive group is opened', () => {
    const closed = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        proactive: false
      },
      activeCard: null,
      visibleCards: []
    });
    const opened = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        proactive: true
      },
      activeCard: null,
      visibleCards: []
    });

    expect(closed.tools.some((tool) => tool.function.name === 'createProactiveMessageRule')).toBe(false);
    expect(closed.tools.some((tool) => tool.function.name === 'listProactiveMessageRules')).toBe(false);
    const tool = opened.tools.find((entry) => entry.function.name === 'createProactiveMessageRule');
    expect(opened.tools.some((entry) => entry.function.name === 'listProactiveMessageRules')).toBe(true);
    expect(opened.tools.some((entry) => entry.function.name === 'updateProactiveMessageRule')).toBe(true);
    expect(opened.tools.some((entry) => entry.function.name === 'deleteProactiveMessageRule')).toBe(true);
    expect(tool?.function.parameters).toMatchObject({
      properties: {
        scheduleKind: {
          enum: ['daily', 'interval']
        }
      },
      required: ['prompt', 'scheduleKind']
    });
  });

  it('exposes Polaris product knowledge only when the knowledge toolbox group is opened', () => {
    const closed = resolveAssistantToolRequestTools({
      themeToolMode: 'off',
      toolEnforcementMode: 'normal',
      enabledToolGroups: {
        room: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false,
        knowledge: false,
        memory: false,
        memoryRecall: false,
        memoryWrite: false
      },
      activeCard: null,
      visibleCards: []
    });
    const opened = resolveAssistantToolRequestTools({
      themeToolMode: 'off',
      toolEnforcementMode: 'normal',
      enabledToolGroups: {
        room: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false,
        knowledge: true,
        memory: false,
        memoryRecall: false,
        memoryWrite: false
      },
      activeCard: null,
      visibleCards: []
    });

    expect(closed.tools.some((tool) => tool.function.name === 'readPolarisKnowledge')).toBe(false);
    expect(opened.tools.some((tool) => tool.function.name === 'readPolarisKnowledge')).toBe(true);
  });

  it('keeps direct chat and opened theme tools visible before a task is activated', () => {
    const result = resolveAssistantToolRequestTools({
      taskMode: 'seed',
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: true,
        generation: true,
        archive: true,
        web: true,
        memory: true,
        memoryRecall: true,
        memoryWrite: true
      },
      activeCard: null,
      visibleCards: []
    });

    expect(result.tools.some((tool) => tool.function.name === 'inspectAttachments')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readAttachmentText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'inspectArchiveEntries')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readArchiveEntryText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'webSearch')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readWebPage')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'sendImageAttachment')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'saveAttachmentToCollection')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readMemoryDoc')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'writeMemory')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'writeMemoryDoc')).toBe(true);
    const startTaskTool = result.tools.find((tool) => tool.function.name === 'startTask');
    expect(startTaskTool?.function.description).toContain('不负责开启工具');
    expect(startTaskTool?.function.parameters).toMatchObject({
      properties: {
        capability: {
          description: '任务账本归类。换肤写 theme；房间卡写 room；已在工作区内继续写文件写 workspace；Mac 本机环境工作循环写 desktop；Polaris 应用内工作循环写 app；运行代码写 code；MCP 写 mcp；其他连续任务写 general。',
          enum: ['theme', 'room', 'workspace', 'desktop', 'app', 'code', 'mcp', 'general']
        }
      }
    });
    const waitTool = result.tools.find((tool) => tool.function.name === 'wait');
    expect(waitTool?.function.description).toContain('只等待，不读取状态');
    expect(result.tools.some((tool) => tool.function.name === 'completeTask')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createRoomProject')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'createProjectFile')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'applyThemeCoordinates')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'applySurfaceTokens')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'runCode')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'saveAttachmentAsCodeCard')).toBe(false);
  });

  it('hides old-memory search tools when recall and vector switches are unavailable', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        memory: true,
        memoryRecall: true,
        memoryWrite: false,
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false
      },
      memorySearchAvailable: false,
      activeCard: null,
      visibleCards: []
    });

    expect(result.tools.some((tool) => tool.function.name === 'readMemoryDoc')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readCurrentGroupChat')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'searchMemory')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'openMemorySource')).toBe(false);
  });

  it('keeps active recall tools separate from long reference docs', () => {
    const docsOnly = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        memory: true,
        memoryRecall: false,
        memoryWrite: false,
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false
      },
      memorySearchAvailable: true,
      activeCard: null,
      visibleCards: []
    });
    const recallOnly = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        memory: false,
        memoryRecall: true,
        memoryWrite: false,
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false
      },
      memorySearchAvailable: true,
      activeCard: null,
      visibleCards: []
    });

    expect(docsOnly.tools.some((tool) => tool.function.name === 'readMemoryDoc')).toBe(true);
    expect(docsOnly.tools.some((tool) => tool.function.name === 'searchMemory')).toBe(false);
    expect(docsOnly.tools.some((tool) => tool.function.name === 'openMemorySource')).toBe(false);
    expect(recallOnly.tools.some((tool) => tool.function.name === 'readMemoryDoc')).toBe(false);
    expect(recallOnly.tools.some((tool) => tool.function.name === 'searchMemory')).toBe(true);
    expect(recallOnly.tools.some((tool) => tool.function.name === 'openMemorySource')).toBe(true);
  });

  it('shows old-memory search tools when active recall is open and recall or vector memory is available', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        memory: true,
        memoryRecall: true,
        memoryWrite: false,
        room: false,
        project: false,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false
      },
      memorySearchAvailable: true,
      activeCard: null,
      visibleCards: []
    });

    expect(result.tools.some((tool) => tool.function.name === 'searchMemory')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'openMemorySource')).toBe(true);
  });

  it('exposes only attachment tools when attachment is on and archive is off', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: true,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      attachmentSnapshot: {
        latest: [{
          id: 'attachment-1',
          kind: 'file',
          name: 'materials.txt',
          mimeType: 'text/plain'
        }],
        available: [{
          id: 'attachment-1',
          kind: 'file',
          name: 'materials.txt',
          mimeType: 'text/plain'
        }]
      },
      activeCard: null,
      visibleCards: []
    });

    expect(result.tools.some((tool) => tool.function.name === 'inspectAttachments')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readAttachmentText')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'sendImageAttachment')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'saveAttachmentAsCodeCard')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'inspectArchiveEntries')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readArchiveEntryText')).toBe(false);
  });

  it('exposes generation tools separately from attachment tools', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
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

    expect(result.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'generateImage')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'sendImageAttachment')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'inspectAttachments')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readAttachmentText')).toBe(false);
  });

  it('exposes image generation only when the image model route is available', () => {
    const baseContext = {
      themeToolMode: 'stable' as const,
      themeContextMode: 'none' as const,
      toolEnforcementMode: 'normal' as const,
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      activeCard: null,
      visibleCards: []
    };
    const unavailable = resolveAssistantToolRequestTools(baseContext);
    const available = resolveAssistantToolRequestTools({
      ...baseContext,
      imageGenerationAvailable: true
    });

    expect(unavailable.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(true);
    expect(unavailable.tools.some((tool) => tool.function.name === 'generateImage')).toBe(false);
    expect(available.tools.some((tool) => tool.function.name === 'createQrCode')).toBe(true);
    expect(available.tools.some((tool) => tool.function.name === 'generateImage')).toBe(true);
  });

  it('exposes only archive tools when archive is on and attachment is off', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
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

    expect(result.tools.some((tool) => tool.function.name === 'inspectAttachments')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'readAttachmentText')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'inspectArchiveEntries')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'readArchiveEntryText')).toBe(true);
    expect(result.tools.some((tool) => tool.function.name === 'saveArchiveEntryAsCodeCard')).toBe(true);
  });

  it('hides all theme tools when theme mode is closed', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'off',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
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

    expect(result.tools.some((tool) => tool.function.name === 'applyThemeCoordinates')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'applySurfaceTokens')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'patchRawCss')).toBe(false);
    expect(result.tools.some((tool) => tool.function.name === 'applyPreset')).toBe(false);
  });

  it('registers runnable tool cards as native tools when room tools are enabled', () => {
    const toolCardName = buildToolCardFunctionName({
      id: 'card-1',
      title: 'Format Notes'
    });
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
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
      visibleCards: [{
        id: 'card-1',
        kind: 'tool',
        title: 'Format Notes',
        cardNote: '把碎句整理成清单',
        language: 'javascript',
        code: 'return window.PolarisTool.input;',
        tags: ['工具'],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }]
    });

    expect(result.tools.some((tool) => tool.function.name === toolCardName)).toBe(true);
  });

  it('registers discovered MCP tools directly into the native schema', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
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
      visibleCards: [],
      mcpTools: [{
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather by city',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          },
          required: ['city']
        }
      }]
    });

    expect(result.tools.some((tool) => tool.function.name === 'mcp__weather__get_weather')).toBe(true);
  });

  it('hides discovered MCP tools when the MCP toolbox group is closed', () => {
    const result = resolveAssistantToolRequestTools({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      enabledToolGroups: {
        room: true,
        theme: false,
        attachment: false,
        generation: false,
        archive: false,
        web: false,
        mcp: false,
        memory: false
      },
      activeCard: null,
      visibleCards: [],
      mcpTools: [{
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather by city',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          },
          required: ['city']
        }
      }]
    });

    expect(result.tools.some((tool) => tool.function.name === 'mcp__weather__get_weather')).toBe(false);
  });
});
