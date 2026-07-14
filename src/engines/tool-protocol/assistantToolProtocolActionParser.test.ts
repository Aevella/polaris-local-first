import { describe, expect, it } from 'vitest';
import { parseAssistantToolAction } from './assistantToolProtocolActionParser';

describe('parseAssistantToolAction', () => {
  it('parses createRoomProject from flat payloads', () => {
    const result = parseAssistantToolAction({
      projectId: 'landing-refresh',
      title: 'Landing Refresh',
      tags: ['首页', '重构'],
      coverNote: '把首页重做成更稳的入口。',
      coverStyle: '& { background: #f7fbff; }'
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'createRoomProject',
      project: {
        projectId: 'landing-refresh',
        title: 'Landing Refresh',
        slug: undefined,
        tags: ['首页', '重构'],
        coverNote: '把首页重做成更稳的入口。',
        coverStyle: '& { background: #f7fbff; }'
      },
      openInCollection: false,
      targetLabel: undefined
    });
  });

  it('normalizes inferred createCodeCard payloads through the action normalizer', () => {
    const result = parseAssistantToolAction({
      title: 'Draft',
      cardNote: '像贴在卡边的提醒。',
      language: 'markdown',
      code: '# hello',
      cardFaceCss: '& { background: linear-gradient(135deg, #fff6fb, #fff); }',
      tags: ['notes']
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'createCodeCard',
      card: {
        title: 'Draft',
        cardNote: '像贴在卡边的提醒。',
        language: 'markdown',
        code: '# hello',
        cardFaceCss: '& { background: linear-gradient(135deg, #fff6fb, #fff); }',
        tags: ['notes']
      },
      openInCollection: true
    });
  });

  it('uses the active workspace id for createProjectFile when the model omits projectId', () => {
    const result = parseAssistantToolAction({
      kind: 'createProjectFile',
      filePath: 'index.html',
      language: 'html',
      fileRole: 'entry',
      code: '<main>Nova</main>'
    }, undefined, 'stable', {
      activeProjectId: 'workspace-nova-diary'
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'createProjectFile',
      file: {
        projectId: 'workspace-nova-diary',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main>Nova</main>'
      },
      targetLabel: undefined,
      openInCollection: false
    });
  });

  it('uses the active workspace id for reference and project-file conversion tools', () => {
    const referenceToFile = parseAssistantToolAction({
      kind: 'promoteWorkspaceReferenceToProjectFile',
      docId: 'ref-1',
      filePath: 'notes/ref-1.md',
      fileRole: 'content',
      language: 'markdown'
    }, undefined, 'stable', {
      activeProjectId: 'workspace-nova-diary'
    });
    const fileToReference = parseAssistantToolAction({
      kind: 'pinProjectFileAsReference',
      filePath: 'src/unused-notes.md',
      title: '旧笔记'
    }, undefined, 'stable', {
      activeProjectId: 'workspace-nova-diary'
    });

    expect(referenceToFile.action).toEqual({
      kind: 'promoteWorkspaceReferenceToProjectFile',
      projectId: 'workspace-nova-diary',
      docId: 'ref-1',
      title: undefined,
      filePath: 'notes/ref-1.md',
      fileRole: 'content',
      language: 'markdown',
      replaceContent: true,
      targetLabel: undefined,
      openInCollection: undefined
    });
    expect(fileToReference.action).toEqual({
      kind: 'pinProjectFileAsReference',
      target: undefined,
      projectId: 'workspace-nova-diary',
      filePath: 'src/unused-notes.md',
      title: '旧笔记',
      summary: undefined,
      targetLabel: undefined,
      openInCollection: undefined
    });
  });

  it('keeps legacy saveAttachment payloads compatible at parser entry', () => {
    const result = parseAssistantToolAction({
      target: 'latest-image',
      saveAs: 'imageCard',
      title: 'Poster',
      tags: ['ref']
    });

    expect(result.action).toEqual({
      kind: 'saveAttachmentToCollection',
      target: 'latest-image',
      title: 'Poster',
      tags: ['ref'],
      openInCollection: true,
      targetLabel: undefined
    });
  });

  it('infers readWebPage from url payloads', () => {
    const result = parseAssistantToolAction({
      url: 'https://example.com/readme',
      maxChars: 1200
    });

    expect(result.action).toEqual({
      kind: 'readWebPage',
      url: 'https://example.com/readme',
      maxChars: 1200,
      targetLabel: undefined
    });
  });

  it('parses memory reference doc reads by docId', () => {
    const result = parseAssistantToolAction({
      kind: 'readMemoryDoc',
      docId: 'memory-doc-1'
    });

    expect(result.action).toEqual({
      kind: 'readMemoryDoc',
      docId: 'memory-doc-1',
      targetLabel: undefined
    });
  });

  it('parses memory search and source-open actions', () => {
    expect(parseAssistantToolAction({
      kind: 'searchMemory',
      query: '我妈',
      mode: 'source',
      maxResults: 2
    }).action).toEqual({
      kind: 'searchMemory',
      query: '我妈',
      mode: 'source',
      maxResults: 2,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'openMemorySource',
      sourceConversationId: 'old',
      sourceMessageIds: ['m1'],
      maxChars: 4000
    }).action).toEqual({
      kind: 'openMemorySource',
      sourceConversationId: 'old',
      sourceMessageIds: ['m1'],
      maxChars: 4000,
      targetLabel: undefined
    });
  });

  it('parses Polaris knowledge reads with an optional topic', () => {
    const result = parseAssistantToolAction({
      kind: 'readPolarisKnowledge',
      topic: 'MCP'
    });

    expect(result.action).toEqual({
      kind: 'readPolarisKnowledge',
      topic: 'MCP',
      targetLabel: undefined
    });
  });

  it('parses proactive message rule creation', () => {
    const result = parseAssistantToolAction({
      kind: 'createProactiveMessageRule',
      name: '早安',
      prompt: '每天早上轻轻问候一下。',
      scheduleKind: 'daily',
      time: '09:30',
      conversationMode: 'follow-latest'
    });

    expect(result.action).toEqual({
      kind: 'createProactiveMessageRule',
      name: '早安',
      prompt: '每天早上轻轻问候一下。',
      schedule: {
        kind: 'daily',
        time: '09:30'
      },
      conversationMode: 'follow-latest',
      targetLabel: undefined
    });
  });

  it('parses proactive message rule list, update, and delete actions', () => {
    expect(parseAssistantToolAction({
      kind: 'listProactiveMessageRules'
    }).action).toEqual({
      kind: 'listProactiveMessageRules',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      prompt: '晚上来贴一下。',
      scheduleKind: 'daily',
      time: '21:30',
      conversationMode: 'fixed'
    }).action).toEqual({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      name: undefined,
      prompt: '晚上来贴一下。',
      schedule: {
        kind: 'daily',
        time: '21:30'
      },
      conversationMode: 'fixed',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      time: '22:30'
    }).action).toEqual({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      name: undefined,
      prompt: undefined,
      schedule: {
        kind: 'daily',
        time: '22:30'
      },
      conversationMode: undefined,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      schedule: {
        kind: 'interval',
        everyMinutes: 45
      }
    }).action).toEqual({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      name: undefined,
      prompt: undefined,
      schedule: {
        kind: 'interval',
        everyMinutes: 45
      },
      conversationMode: undefined,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'deleteProactiveMessageRule',
      ruleId: 'trigger-1'
    }).action).toEqual({
      kind: 'deleteProactiveMessageRule',
      ruleId: 'trigger-1',
      targetLabel: undefined
    });
  });

  it('parses memory reference doc writes by title and content', () => {
    const result = parseAssistantToolAction({
      kind: 'writeMemoryDoc',
      docId: 'memory-doc-1',
      title: '关系边界',
      summary: '长期关系背景',
      content: '正文内容'
    });

    expect(result.action).toEqual({
      kind: 'writeMemoryDoc',
      docId: 'memory-doc-1',
      title: '关系边界',
      summary: '长期关系背景',
      content: '正文内容',
      targetLabel: undefined
    });
  });

  it('routes theme actions through the theme parser before non-theme dispatch', () => {
    const result = parseAssistantToolAction({
      selector: '.bubble',
      css: 'color: red;'
    }, undefined, 'stable');

    expect(result.action).toBeNull();
    expect(result.issue).toContain('系统编译路径');
  });

  it('parses appendThemeCss actions in creative mode', () => {
    const result = parseAssistantToolAction({
      kind: 'appendThemeCss',
      css: '.app-shell.chat .bubble.user { color: white; }',
      layer: 'generated',
      label: '气泡补色'
    }, undefined, 'creative');

    expect(result.action).toEqual({
      kind: 'appendThemeCss',
      css: '.app-shell.chat .bubble.user { color: white; }',
      layer: 'generated',
      label: '气泡补色'
    });
  });

  it('parses insertThemeCss actions in creative mode', () => {
    const result = parseAssistantToolAction({
      kind: 'insertThemeCss',
      anchorString: '.app-shell.chat { color: var(--text); }',
      css: '.app-shell.chat .chat-input { background: white; }',
      position: 'before'
    }, undefined, 'creative');

    expect(result.action).toEqual({
      kind: 'insertThemeCss',
      anchorString: '.app-shell.chat { color: var(--text); }',
      css: '.app-shell.chat .chat-input { background: white; }',
      position: 'before',
      layer: undefined,
      label: undefined
    });
  });

  it('parses deleteThemeCss actions in creative mode', () => {
    const result = parseAssistantToolAction({
      kind: 'deleteThemeCss',
      oldString: '.bad-rule { opacity: 0; }',
      layer: 'custom'
    }, undefined, 'creative');

    expect(result.action).toEqual({
      kind: 'deleteThemeCss',
      oldString: '.bad-rule { opacity: 0; }',
      layer: 'custom',
      label: undefined
    });
  });

  it('parses explicit createQrCode actions without falling through to other families', () => {
    const result = parseAssistantToolAction({
      kind: 'createQrCode',
      text: 'https://example.com',
      fileName: 'example.png'
    });

    expect(result.action).toEqual({
      kind: 'createQrCode',
      text: 'https://example.com',
      fileName: 'example.png',
      targetLabel: undefined
    });
  });

  it('parses existing image send actions without treating them as generation', () => {
    const result = parseAssistantToolAction({
      kind: 'sendImage',
      target: 'https://example.com/poster.png',
      title: 'poster.png'
    });

    expect(result.action).toEqual({
      kind: 'sendImageAttachment',
      target: 'https://example.com/poster.png',
      title: 'poster.png',
      targetLabel: undefined
    });
  });

  it('parses image material actions with normalized variant options', () => {
    expect(parseAssistantToolAction({
      kind: 'inspectImageAsset',
      target: 'poster.png'
    }).action).toEqual({
      kind: 'inspectImageAsset',
      target: 'poster.png',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'extractImagePalette',
      target: 'poster.png'
    }).action).toEqual({
      kind: 'extractImagePalette',
      target: 'poster.png',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'createImageVariant',
      target: 'poster.png',
      purpose: 'background',
      width: 1080,
      height: 1920,
      fit: 'cover',
      blur: 8,
      dim: 0.24,
      format: 'jpeg',
      quality: 0.82,
      name: 'poster-background.jpg'
    }).action).toEqual({
      kind: 'createImageVariant',
      target: 'poster.png',
      purpose: 'background',
      width: 1080,
      height: 1920,
      fit: 'cover',
      blur: 8,
      dim: 0.24,
      format: 'jpeg',
      quality: 0.82,
      name: 'poster-background.jpg',
      targetLabel: undefined
    });
  });

  it('parses explicit runCode actions', () => {
    const result = parseAssistantToolAction({
      kind: 'runCode',
      code: 'return JSON.parse("{\\"ok\\":true}").ok;'
    });

    expect(result.action).toEqual({
      kind: 'runCode',
      code: 'return JSON.parse("{\\"ok\\":true}").ok;',
      targetLabel: undefined
    });
  });

  it('parses explicit wait actions for polling loops', () => {
    const result = parseAssistantToolAction({
      kind: 'sleep',
      seconds: 1.5,
      reason: '等待 MCP 截图写入',
      targetLabel: '光遇截图'
    });

    expect(result.action).toEqual({
      kind: 'wait',
      seconds: 1.5,
      reason: '等待 MCP 截图写入',
      targetLabel: '光遇截图'
    });
  });

  it('parses explicit calendar read actions', () => {
    expect(parseAssistantToolAction({
      kind: 'listCalendars'
    }).action).toEqual({
      kind: 'listCalendars',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'readCalendarEvents',
      startDate: '2026-06-12',
      query: 'meeting',
      maxEvents: 5
    }).action).toEqual({
      kind: 'readCalendarEvents',
      startDate: '2026-06-12',
      endDate: undefined,
      query: 'meeting',
      maxEvents: 5,
      targetLabel: undefined
    });
  });

  it('parses explicit calendar write actions', () => {
    expect(parseAssistantToolAction({
      kind: 'createCalendarEvent',
      title: '看牙',
      startDate: '2026-06-14T10:00:00Z',
      endDate: '2026-06-14T11:00:00Z',
      allDay: false,
      location: '诊所',
      notes: '带牙套',
      calendarId: 'calendar-1'
    }).action).toEqual({
      kind: 'createCalendarEvent',
      title: '看牙',
      startDate: '2026-06-14T10:00:00Z',
      endDate: '2026-06-14T11:00:00Z',
      allDay: false,
      location: '诊所',
      notes: '带牙套',
      calendarId: 'calendar-1',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'updateCalendarEvent',
      eventId: 'event-1',
      location: ''
    }).action).toEqual({
      kind: 'updateCalendarEvent',
      eventId: 'event-1',
      title: undefined,
      startDate: undefined,
      endDate: undefined,
      allDay: undefined,
      location: '',
      notes: undefined,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'deleteCalendarEvent',
      eventId: 'event-1'
    }).action).toEqual({
      kind: 'deleteCalendarEvent',
      eventId: 'event-1',
      targetLabel: undefined
    });
  });

  it('parses desktop task activation', () => {
    const result = parseAssistantToolAction({
      kind: 'startTask',
      capability: 'desktop',
      title: '修复本机项目',
      stage: '先跑验证',
      steps: ['运行验证', '按失败修复', '复测']
    });

    expect(result.action).toEqual({
      kind: 'startTask',
      capability: 'desktop',
      title: '修复本机项目',
      stage: '先跑验证',
      steps: ['运行验证', '按失败修复', '复测'],
      targetLabel: undefined
    });
  });

  it('parses app task activation for in-app loops', () => {
    const result = parseAssistantToolAction({
      kind: 'startTask',
      capability: 'app',
      title: '移动端应用内修复',
      stage: '先看应用内证据',
      steps: ['读取当前状态', '用已有工具修正', '再次检查']
    });

    expect(result.action).toEqual({
      kind: 'startTask',
      capability: 'app',
      title: '移动端应用内修复',
      stage: '先看应用内证据',
      steps: ['读取当前状态', '用已有工具修正', '再次检查'],
      targetLabel: undefined
    });
  });

  it('parses explicit readCodeCard actions', () => {
    const result = parseAssistantToolAction({
      kind: 'readCodeCard',
      target: 'card-2'
    });

    expect(result.action).toEqual({
      kind: 'readCodeCard',
      target: 'card-2',
      targetLabel: undefined
    });
  });

  it('parses explicit readProjectFile actions into the project-file read action', () => {
    const result = parseAssistantToolAction({
      kind: 'readProjectFile',
      projectId: 'mini-phone',
      filePath: 'index.html'
    });

    expect(result.action).toEqual({
      kind: 'readProjectFile',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'index.html',
      targetLabel: undefined
    });
  });

  it('parses searchProjectFiles actions', () => {
    const result = parseAssistantToolAction({
      kind: 'searchProjectFiles',
      projectId: 'mini-phone',
      query: 'initApi',
      maxResults: 8
    });

    expect(result.action).toEqual({
      kind: 'searchProjectFiles',
      projectId: 'mini-phone',
      query: 'initApi',
      maxResults: 8,
      targetLabel: undefined
    });
  });

  it('parses readProjectFileContext actions', () => {
    const result = parseAssistantToolAction({
      kind: 'readProjectFileContext',
      projectId: 'mini-phone',
      filePath: 'scripts/app.js',
      query: 'initApi',
      before: 4,
      after: 6
    });

    expect(result.action).toEqual({
      kind: 'readProjectFileContext',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'scripts/app.js',
      query: 'initApi',
      lineNumber: undefined,
      before: 4,
      after: 6,
      occurrence: undefined,
      targetLabel: undefined
    });
  });

  it('parses desktop local file and command actions', () => {
    expect(parseAssistantToolAction({
      kind: 'readDesktopFile',
      rootId: 'local-root-1',
      filePath: 'src/main.ts'
    }).action).toEqual({
      kind: 'readDesktopFile',
      rootId: 'local-root-1',
      filePath: 'src/main.ts',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'runDesktopCommand',
      command: 'npm',
      args: ['test'],
      cwdPath: 'app'
    }).action).toEqual({
      kind: 'runDesktopCommand',
      rootId: undefined,
      command: 'npm',
      args: ['test'],
      cwdPath: 'app',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'runDesktopVerification',
      steps: [{
        label: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit'],
        cwd: 'app'
      }, {
        label: 'test',
        command: 'npm',
        args: ['test']
      }],
      continueOnError: true
    }).action).toEqual({
      kind: 'runDesktopCommandSequence',
      rootId: undefined,
      steps: [{
        label: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit'],
        cwdPath: 'app'
      }, {
        label: 'test',
        command: 'npm',
        args: ['test'],
        cwdPath: undefined
      }],
      continueOnError: true,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'startDesktopCommand',
      command: 'npm',
      args: ['run', 'dev'],
      cwd: 'app'
    }).action).toEqual({
      kind: 'startDesktopCommand',
      rootId: undefined,
      command: 'npm',
      args: ['run', 'dev'],
      cwdPath: 'app',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'stopDesktopCommand',
      sessionId: 'session-1'
    }).action).toEqual({
      kind: 'stopDesktopCommand',
      sessionId: 'session-1',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'patchDesktopFileText',
      rootId: 'local-root-1',
      filePath: 'src/main.ts',
      oldString: 'render();',
      newString: 'renderApp();'
    }).action).toEqual({
      kind: 'editDesktopFileText',
      rootId: 'local-root-1',
      filePath: 'src/main.ts',
      oldString: 'render();',
      newString: 'renderApp();',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'searchLocalFiles',
      query: 'renderApp',
      directory: 'src',
      maxResults: 5
    }).action).toEqual({
      kind: 'searchDesktopFiles',
      rootId: undefined,
      path: 'src',
      query: 'renderApp',
      maxResults: 5,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'readDesktopFileContext',
      filePath: 'src/main.ts',
      lineNumber: 8,
      before: 2,
      after: 3
    }).action).toEqual({
      kind: 'readDesktopFileContext',
      rootId: undefined,
      filePath: 'src/main.ts',
      query: undefined,
      lineNumber: 8,
      before: 2,
      after: 3,
      occurrence: undefined,
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'replaceDesktopFileLines',
      filePath: 'src/main.ts',
      startLine: 2,
      endLine: 3,
      code: '  renderApp();'
    }).action).toEqual({
      kind: 'replaceDesktopFileLines',
      rootId: undefined,
      filePath: 'src/main.ts',
      startLine: 2,
      endLine: 3,
      code: '  renderApp();',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'createLocalFolder',
      directoryPath: 'src/generated'
    }).action).toEqual({
      kind: 'createDesktopDirectory',
      rootId: undefined,
      path: 'src/generated',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'deleteDesktopPath',
      path: 'src/generated/old.ts'
    }).action).toEqual({
      kind: 'deleteDesktopPath',
      rootId: undefined,
      path: 'src/generated/old.ts',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'renameLocalPath',
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts'
    }).action).toEqual({
      kind: 'moveDesktopPath',
      rootId: undefined,
      fromPath: 'src/old.ts',
      toPath: 'src/new.ts',
      targetLabel: undefined
    });

    expect(parseAssistantToolAction({
      kind: 'syncDesktopWorkspaceToDisk',
      projectId: 'project-1',
      rootId: 'local-root-1',
      allowOverwrite: true
    }).action).toEqual({
      kind: 'syncDesktopWorkspaceToDisk',
      projectId: 'project-1',
      rootId: 'local-root-1',
      allowOverwrite: true,
      targetLabel: undefined
    });
  });

  it('parses inspectProjectRuntime actions', () => {
    const result = parseAssistantToolAction({
      kind: 'inspectProjectRuntime',
      projectId: 'mini-phone',
      settleMs: 1200
    });

    expect(result.action).toEqual({
      kind: 'inspectProjectRuntime',
      projectId: 'mini-phone',
      settleMs: 1200,
      targetLabel: undefined
    });
  });

  it('parses cardFaceCss for patchCodeCard actions', () => {
    const result = parseAssistantToolAction({
      kind: 'patchCodeCard',
      target: 'active',
      cardNote: '换成更轻的一句。',
      cardFaceCss: '& { background: linear-gradient(180deg, #fff1f5, #fff); }'
    });

    expect(result.action).toEqual({
      kind: 'patchCodeCard',
      target: 'active',
      targetLabel: undefined,
      patch: {
        title: undefined,
        cardNote: '换成更轻的一句。',
        language: undefined,
        code: undefined,
        cardFaceCss: '& { background: linear-gradient(180deg, #fff1f5, #fff); }',
        tags: []
      },
      openInCollection: true
    });
  });

  it('parses appendProjectFile actions without wrapping them as full replacements', () => {
    const result = parseAssistantToolAction({
      kind: 'appendProjectFile',
      projectId: 'mini-phone',
      filePath: 'index.html',
      target: 'active',
      code: '\n<section>next chunk</section>'
    });

    expect(result.action).toEqual({
      kind: 'appendProjectFile',
      target: 'active',
      projectId: 'mini-phone',
      filePath: 'index.html',
      targetLabel: undefined,
      code: '\n<section>next chunk</section>',
      openInCollection: undefined
    });
  });

  it('parses patchRoomProject cover actions', () => {
    const result = parseAssistantToolAction({
      kind: 'patch_workspace_cover',
      project_id: 'mini-phone',
      cover_note: '小屏幕里的柔光入口。',
      cover_css: '& { background: #10131c; }',
      tags: ['封面', '手机']
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'patchRoomProject',
      projectId: 'mini-phone',
      targetLabel: undefined,
      patch: {
        title: undefined,
        slug: undefined,
        tags: ['封面', '手机'],
        coverNote: '小屏幕里的柔光入口。',
        coverStyle: '& { background: #10131c; }'
      },
      openInCollection: true
    });
  });

  it('parses insertProjectFile actions as anchor insertions', () => {
    const result = parseAssistantToolAction({
      kind: 'insert_project_file',
      project_id: 'mini-phone',
      file_path: 'styles/main.css',
      before_selector: '.app-shell {',
      content: '.phone-frame { overflow: hidden; }\n'
    });

    expect(result.action).toEqual({
      kind: 'insertProjectFile',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'styles/main.css',
      targetLabel: undefined,
      beforeString: '.app-shell {',
      afterString: undefined,
      code: '.phone-frame { overflow: hidden; }\n',
      openInCollection: undefined
    });
  });

  it('parses insertProjectFile actions as line insertions', () => {
    const result = parseAssistantToolAction({
      kind: 'insert_project_file',
      project_id: 'mini-phone',
      file_path: 'scenes-level1.js',
      line_number: 961,
      line_position: 'after',
      content: '  endings: [],\n'
    });

    expect(result.action).toEqual({
      kind: 'insertProjectFile',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'scenes-level1.js',
      targetLabel: undefined,
      beforeString: undefined,
      afterString: undefined,
      lineNumber: 961,
      linePosition: 'after',
      code: '  endings: [],\n',
      openInCollection: undefined
    });
  });

  it('parses replaceProjectFileLines actions from context line numbers', () => {
    const result = parseAssistantToolAction({
      kind: 'replace_project_file_lines',
      project_id: 'mini-phone',
      file_path: 'index.html',
      start_line: 675,
      end_line: 677,
      replacement: '  <button id="random-prompt">随机灵感</button>'
    });

    expect(result.action).toEqual({
      kind: 'replaceProjectFileLines',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'index.html',
      targetLabel: undefined,
      startLine: 675,
      endLine: 677,
      code: '  <button id="random-prompt">随机灵感</button>',
      openInCollection: undefined
    });
  });

  it('parses appendCodeCard actions as room-only appends', () => {
    const result = parseAssistantToolAction({
      kind: 'appendCodeCard',
      target: 'active',
      projectId: 'mini-phone',
      filePath: 'index.html',
      code: '\nnext chunk'
    });

    expect(result.action).toEqual({
      kind: 'appendCodeCard',
      target: 'active',
      targetLabel: undefined,
      code: '\nnext chunk',
      openInCollection: undefined
    });
  });

  it('parses createProjectFile with optional empty code', () => {
    const result = parseAssistantToolAction({
      kind: 'createProjectFile',
      projectId: 'mini-phone',
      filePath: 'index.html',
      fileRole: 'entry',
      title: 'Mini Phone / index.html',
      language: 'html',
      tags: ['项目']
    });

    expect(result.action).toEqual({
      kind: 'createProjectFile',
      file: {
        language: 'html',
        code: '',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry'
      },
      targetLabel: undefined,
      openInCollection: false
    });
  });

  it('parses promoteCardToProject without dragging card-only fields back in', () => {
    const result = parseAssistantToolAction({
      kind: 'promoteCardToProject',
      target: 'active',
      projectTitle: 'Mini Phone',
      filePath: 'index.html',
      fileRole: 'entry'
    });

    expect(result.action).toEqual({
      kind: 'promoteCardToProject',
      target: 'active',
      projectTitle: 'Mini Phone',
      filePath: 'index.html',
      fileRole: 'entry',
      targetLabel: undefined,
      openInCollection: false
    });
  });

  it('parses editProjectFileText oldString newString actions', () => {
    const result = parseAssistantToolAction({
      kind: 'editProjectFileText',
      project_id: 'mini-phone',
      file_path: 'index.html',
      old_string: '<main></main>',
      new_string: '<main><section>lock</section></main>'
    });

    expect(result.action).toEqual({
      kind: 'editProjectFileText',
      target: undefined,
      projectId: 'mini-phone',
      filePath: 'index.html',
      targetLabel: undefined,
      oldString: '<main></main>',
      newString: '<main><section>lock</section></main>',
      openInCollection: undefined
    });
  });

  it('parses editCodeCardText oldString newString actions as room edits', () => {
    const result = parseAssistantToolAction({
      kind: 'editCodeCardText',
      target: 'active',
      project_id: 'mini-phone',
      file_path: 'index.html',
      old_string: '<main></main>',
      new_string: '<main><section>lock</section></main>'
    });

    expect(result.action).toEqual({
      kind: 'editCodeCardText',
      target: 'active',
      targetLabel: undefined,
      oldString: '<main></main>',
      newString: '<main><section>lock</section></main>',
      openInCollection: undefined
    });
  });

  it('parses visible dynamic MCP tool actions', () => {
    const result = parseAssistantToolAction({
      kind: 'mcp__github__github_read_file',
      owner: 'octocat',
      repo: 'Hello-World',
      path: 'README'
    }, undefined, 'stable', {
      mcpTools: [{
        schemaName: 'mcp__github__github_read_file',
        serverId: 'server-github',
        serverName: 'GitHub',
        serverHandle: 'github',
        transport: 'streamable-http',
        url: 'http://192.168.0.104:8787/',
        toolName: 'github_read_file',
        description: 'Read GitHub file',
        inputSchema: {
          type: 'object'
        }
      }]
    });

    expect(result.issue).toBeUndefined();
    expect(result.action).toEqual({
      kind: 'invokeMcpTool',
      serverId: 'server-github',
      serverName: 'GitHub',
      schemaName: 'mcp__github__github_read_file',
      toolName: 'github_read_file',
      argumentsObject: {
        owner: 'octocat',
        repo: 'Hello-World',
        path: 'README'
      },
      targetLabel: 'GitHub / github_read_file'
    });
  });

  it('reports unavailable dynamic MCP tool actions without calling them unknown', () => {
    const result = parseAssistantToolAction({
      kind: 'mcp__github__github_read_file',
      owner: 'octocat'
    });

    expect(result.action).toBeNull();
    expect(result.issue).toBe('MCP 工具「mcp__github__github_read_file」当前不可用。');
  });
});
