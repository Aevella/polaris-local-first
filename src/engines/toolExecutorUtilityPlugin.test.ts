import { describe, expect, it, vi } from 'vitest';
import { utilityToolExecutorPlugin } from './toolExecutorUtilityPlugin';
import type { ToolContext } from './toolExecutorTypes';

function createUtilityContext(overrides: Partial<ToolContext> = {}) {
  return {
    appendCollaboratorMemories: vi.fn(() => true),
    writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
    readCollaboratorMemoryDoc: vi.fn(async () => null),
    readPolarisKnowledge: vi.fn(() => ({
      ok: true as const,
      summary: '已读取 Polaris 产品知识全文',
      detailText: '# Polaris 产品知识'
    })),
    listCalendars: vi.fn(async () => ({
      ok: true as const,
      summary: '已读取可写系统日历 · 1 个',
      detailText: '1. 个人 · 系统默认',
      calendars: [{
        calendarId: 'calendar-1',
        calendarName: '个人',
        sourceId: 'source-1',
        sourceName: 'iCloud',
        sourceType: 'calDAV',
        isDefault: true,
        allowsContentModifications: true
      }]
    })),
    readCalendarEvents: vi.fn(async () => ({
      ok: true as const,
      summary: '已读取系统日历 · 0 条',
      detailText: '这个时间段里没有读到匹配的日历事件。',
      events: []
    })),
    createCalendarEvent: vi.fn(async () => ({
      ok: true as const,
      summary: '已创建系统日历事件 · 看牙',
      detailText: '1. 看牙\n   eventId=event-1\n   2026-06-14T10:00:00Z - 2026-06-14T11:00:00Z\n   calendar=个人',
      event: {
        eventId: 'event-1',
        title: '看牙',
        startDate: '2026-06-14T10:00:00Z',
        endDate: '2026-06-14T11:00:00Z',
        calendarId: 'calendar-1',
        calendarName: '个人',
        calendarSource: 'iCloud',
        calendarSourceType: 'calDAV',
        allDay: false
      }
    })),
    updateCalendarEvent: vi.fn(async () => ({
      ok: true as const,
      summary: '已修改系统日历事件 · 看牙',
      detailText: '1. 看牙\n   eventId=event-1\n   2026-06-14T12:00:00Z - 2026-06-14T13:00:00Z\n   calendar=个人',
      event: {
        eventId: 'event-1',
        title: '看牙',
        startDate: '2026-06-14T12:00:00Z',
        endDate: '2026-06-14T13:00:00Z',
        calendarId: 'calendar-1',
        calendarName: '个人',
        calendarSource: 'iCloud',
        calendarSourceType: 'calDAV',
        allDay: false
      }
    })),
    deleteCalendarEvent: vi.fn(async () => ({
      ok: true as const,
      summary: '已删除系统日历事件 · 看牙',
      detailText: '1. 看牙\n   eventId=event-1\n   2026-06-14T12:00:00Z - 2026-06-14T13:00:00Z\n   calendar=个人',
      event: {
        eventId: 'event-1',
        title: '看牙',
        startDate: '2026-06-14T12:00:00Z',
        endDate: '2026-06-14T13:00:00Z',
        calendarId: 'calendar-1',
        calendarName: '个人',
        calendarSource: 'iCloud',
        calendarSourceType: 'calDAV',
        allDay: false
      }
    })),
    listProactiveMessageRules: vi.fn(() => ({
      ok: true as const,
      summary: '已查看主动消息规则 · 0 条',
      detailText: '当前协作者还没有主动消息规则。',
      triggerRules: []
    })),
    updateProactiveMessageRule: vi.fn(() => ({
      ok: true as const,
      summary: '已修改主动消息规则 · 早安',
      detailText: 'ruleId=trigger-1',
      triggerRuleId: 'trigger-1'
    })),
    deleteProactiveMessageRule: vi.fn(() => ({
      ok: true as const,
      summary: '已取消主动消息规则 · 早安',
      detailText: 'ruleId=trigger-1',
      triggerRuleId: 'trigger-1'
    })),
    runCode: vi.fn(async () => ({ ok: true as const, returnValue: '42', logs: [] })),
    syncDesktopWorkspaceFromDisk: vi.fn(async () => ({
      ok: true as const,
      summary: '已从电脑读入工作区 · Demo',
      detailText: 'changedFiles=1'
    })),
    syncDesktopWorkspaceToDisk: vi.fn(async () => ({
      ok: true as const,
      summary: '已送到电脑工作区 · Demo',
      detailText: 'writtenFiles=1'
    })),
    desktopLocalHost: {
      getState: vi.fn(async () => ({
        available: true,
        platform: 'darwin',
        permissionMode: 'confirm-each' as const,
        trustedRoots: [{
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: null
        }]
      })),
      listDirectory: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        relativePath: 'src',
        entries: [{ name: 'main.tsx', kind: 'file' as const }]
      })),
      readWorkspaceFiles: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        files: [{
          relativePath: 'src/main.tsx',
          content: 'render();',
          bytes: 9,
          updatedAt: 2
        }]
      })),
      writeWorkspaceFiles: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        writtenFiles: [{
          relativePath: 'src/main.tsx',
          bytes: 9
        }]
      })),
      readFile: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        relativePath: 'src/main.tsx',
        content: 'render();'
      })),
      writeFile: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        relativePath: 'README.md',
        bytes: 5
      })),
      createDirectory: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        relativePath: 'src/new-folder'
      })),
      deletePath: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        relativePath: 'src/old-folder',
        kind: 'directory' as const
      })),
      movePath: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        fromRelativePath: 'src/old-name.ts',
        toRelativePath: 'src/new-name.ts',
        kind: 'file' as const
      })),
      runCommand: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        cwd: '/Users/example/Desktop/Polaris',
        cwdRelativePath: '',
        command: 'npm',
        args: ['test'],
        durationMs: 10,
        exitCode: 0,
        signal: null,
        stdout: 'ok',
        stderr: ''
      })),
      runCommandSequence: vi.fn(async () => ({
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        durationMs: 25,
        continueOnError: false,
        stoppedAtStep: null,
        steps: [{
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          index: 0,
          label: 'typecheck',
          cwd: '/Users/example/Desktop/Polaris',
          cwdRelativePath: '',
          command: 'npx',
          args: ['tsc', '--noEmit'],
          durationMs: 25,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: ''
        }]
      })),
      startCommand: vi.fn(async () => ({
        id: 'session-1',
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        cwd: '/Users/example/Desktop/Polaris',
        cwdRelativePath: '',
        command: 'npm',
        args: ['run', 'dev'],
        status: 'running' as const,
        startedAt: 10,
        endedAt: null,
        durationMs: 0,
        exitCode: null,
        signal: null,
        stdout: 'ready',
        stderr: ''
      })),
      listCommandSessions: vi.fn(async () => [{
        id: 'session-1',
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        cwd: '/Users/example/Desktop/Polaris',
        cwdRelativePath: '',
        command: 'npm',
        args: ['run', 'dev'],
        status: 'running' as const,
        startedAt: 10,
        endedAt: null,
        durationMs: 5,
        exitCode: null,
        signal: null,
        stdout: 'ready',
        stderr: ''
      }]),
      stopCommand: vi.fn(async () => ({
        id: 'session-1',
        root: {
          id: 'local-root-1',
          label: 'Polaris',
          path: '/Users/example/Desktop/Polaris',
          createdAt: 1,
          lastUsedAt: 2
        },
        cwd: '/Users/example/Desktop/Polaris',
        cwdRelativePath: '',
        command: 'npm',
        args: ['run', 'dev'],
        status: 'exited' as const,
        startedAt: 10,
        endedAt: 20,
        durationMs: 10,
        exitCode: null,
        signal: 'SIGTERM',
        stdout: 'ready',
        stderr: ''
      }))
    },
    ...overrides
  } as ToolContext;
}

describe('utilityToolExecutorPlugin', () => {
  it('writes trimmed memory items', async () => {
    const ctx = createUtilityContext();

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'writeMemory',
      memory: ['  喜欢清楚边界  ', '']
    }, ctx);

    expect(result).toEqual({ ok: true, memoryCount: 1 });
    expect(ctx.appendCollaboratorMemories).toHaveBeenCalledWith(['喜欢清楚边界']);
  });

  it('writes a collaborator memory reference doc', async () => {
    const ctx = createUtilityContext();

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'writeMemoryDoc',
      title: '  关系边界  ',
      summary: '长期关系背景',
      content: '  正文内容  '
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已写入长期资料 · 关系边界',
      memoryDocId: 'memory-doc-1',
      memoryDocTitle: '关系边界',
      memoryDocCreated: true
    });
    expect(ctx.writeCollaboratorMemoryDoc).toHaveBeenCalledWith({
      docId: undefined,
      title: '关系边界',
      summary: '长期关系背景',
      content: '正文内容'
    });
  });

  it('reads a collaborator memory reference doc by id', async () => {
    const ctx = createUtilityContext({
      readCollaboratorMemoryDoc: vi.fn(async () => ({
        id: 'memory-doc-1',
        title: '关系边界',
        summary: '长期关系背景',
        content: '正文内容',
        source: 'user' as const,
        updatedAt: 1
      }))
    });

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'readMemoryDoc',
      docId: 'memory-doc-1'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取长期资料 · 关系边界',
      detailText: '# 关系边界\n\n摘要：长期关系背景\n\n正文内容'
    });
    expect(ctx.readCollaboratorMemoryDoc).toHaveBeenCalledWith('memory-doc-1');
  });

  it('reports an unreadable collaborator memory doc body without throwing', async () => {
    const ctx = createUtilityContext({
      readCollaboratorMemoryDoc: vi.fn(async () => {
        throw new Error('Persona memory document content is missing: persona-1:memory-doc-1');
      })
    });

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'readMemoryDoc',
      docId: 'memory-doc-1'
    }, ctx);

    expect(result).toEqual({
      ok: false,
      error: '长期资料目录还在，但正文没有在当前本机数据里找到：memory-doc-1'
    });
  });

  it('searches collaborator memory through the utility context', async () => {
    const ctx = createUtilityContext({
      searchCollaboratorMemory: vi.fn(() => ({
        ok: true as const,
        summary: '已搜索记忆 · 1 个候选',
        detailText: 'sourceConversationId=old'
      }))
    });

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'searchMemory',
      query: '智齿',
      mode: 'auto',
      maxResults: 2
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已搜索记忆 · 1 个候选',
      detailText: 'sourceConversationId=old'
    });
    expect(ctx.searchCollaboratorMemory).toHaveBeenCalledWith('智齿', 'auto', 2);
  });

  it('opens collaborator memory source through the utility context', async () => {
    const ctx = createUtilityContext({
      openMemorySource: vi.fn(() => ({
        ok: true as const,
        summary: '已打开记忆原文 · 旧对话',
        detailText: 'user: 原文'
      }))
    });

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'openMemorySource',
      sourceConversationId: 'old',
      sourceMessageIds: ['old-user'],
      maxChars: 2000
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已打开记忆原文 · 旧对话',
      detailText: 'user: 原文'
    });
    expect(ctx.openMemorySource).toHaveBeenCalledWith('old', ['old-user'], 2000);
  });

  it('reads the built-in Polaris knowledge doc through the utility context', async () => {
    const ctx = createUtilityContext();

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'readPolarisKnowledge',
      topic: 'MCP'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取 Polaris 产品知识全文',
      detailText: '# Polaris 产品知识'
    });
    expect(ctx.readPolarisKnowledge).toHaveBeenCalledWith('MCP');
  });

  it('creates proactive message rules through the utility context', async () => {
    const ctx = createUtilityContext({
      createProactiveMessageRule: vi.fn(() => ({
        ok: true as const,
        summary: '已创建主动消息规则 · 早安',
        detailText: 'ruleId=trigger-1',
        triggerRuleId: 'trigger-1'
      }))
    });

    const action = {
      kind: 'createProactiveMessageRule' as const,
      name: '早安',
      prompt: '每天早上问候一下。',
      schedule: {
        kind: 'daily' as const,
        time: '09:30'
      }
    };
    const result = await utilityToolExecutorPlugin.execute(action, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已创建主动消息规则 · 早安',
      detailText: 'ruleId=trigger-1',
      triggerRuleId: 'trigger-1'
    });
    expect(ctx.createProactiveMessageRule).toHaveBeenCalledWith(action);
  });

  it('lists, updates, and deletes proactive message rules through the utility context', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'listProactiveMessageRules'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已查看主动消息规则 · 0 条'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      schedule: { kind: 'daily', time: '21:30' }
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已修改主动消息规则 · 早安',
      triggerRuleId: 'trigger-1'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'deleteProactiveMessageRule',
      ruleId: 'trigger-1'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已取消主动消息规则 · 早安',
      triggerRuleId: 'trigger-1'
    });

    expect(ctx.listProactiveMessageRules).toHaveBeenCalledWith({ kind: 'listProactiveMessageRules' });
    expect(ctx.updateProactiveMessageRule).toHaveBeenCalledWith({
      kind: 'updateProactiveMessageRule',
      ruleId: 'trigger-1',
      schedule: { kind: 'daily', time: '21:30' }
    });
    expect(ctx.deleteProactiveMessageRule).toHaveBeenCalledWith({
      kind: 'deleteProactiveMessageRule',
      ruleId: 'trigger-1'
    });
  });

  it('returns task marker summaries', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'startTask',
      title: '整理执行器',
      capability: 'code'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '任务已开启 · 整理执行器'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'completeTask',
      stage: '已验证'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '任务已完成 · 已验证'
    });
  });

  it('waits and returns polling continuation evidence', async () => {
    vi.useFakeTimers();
    try {
      const ctx = createUtilityContext();
      const pending = utilityToolExecutorPlugin.execute({
        kind: 'wait',
        seconds: 1.25,
        reason: '等待 MCP 截图写入',
        targetLabel: '光遇截图'
      }, ctx);

      await vi.advanceTimersByTimeAsync(1250);

      await expect(pending).resolves.toEqual({
        ok: true,
        summary: '已等待 1.25 秒 · 光遇截图',
        detailText: '等待原因：等待 MCP 截图写入\n等待已结束；请继续读取真实状态、检查结果，或给出自然收尾。'
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps runCode logs and return value in successful output', async () => {
    const ctx = createUtilityContext({
      runCode: vi.fn(async () => ({
        ok: true as const,
        returnValue: '3',
        logs: [{ level: 'log' as const, args: ['step', '1'] }]
      }))
    });

    const result = await utilityToolExecutorPlugin.execute({ kind: 'runCode', code: 'return 3' }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '代码已执行',
      detailText: '返回值：3\n\n--- console ---\n[log] step 1'
    });
  });

  it('keeps runCode error stack and console output together', async () => {
    const ctx = createUtilityContext({
      runCode: vi.fn(async () => ({
        ok: false as const,
        error: 'Boom',
        stack: 'Error: Boom',
        logs: [{ level: 'error' as const, args: ['bad'] }]
      }))
    });

    const result = await utilityToolExecutorPlugin.execute({ kind: 'runCode', code: 'throw new Error("Boom")' }, ctx);

    expect(result).toEqual({
      ok: false,
      error: 'Boom\nError: Boom\n--- console ---\n[error] bad'
    });
  });

  it('lists and reads desktop local workspace files', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({ kind: 'listDesktopFiles', path: 'src' }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已读取本机目录 · Polaris/src',
      detailText: 'rootId=local-root-1 · Polaris\npath=src\nfile  main.tsx'
    });

    await expect(utilityToolExecutorPlugin.execute({ kind: 'readDesktopFile', filePath: 'src/main.tsx' }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已读取本机文件 · Polaris/src/main.tsx',
      detailText: 'render();'
    });
  });

  it('searches and reads desktop local file context', async () => {
    const ctx = createUtilityContext({
      desktopLocalHost: {
        ...createUtilityContext().desktopLocalHost!,
        readWorkspaceFiles: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          files: [{
            relativePath: 'src/main.tsx',
            content: 'function boot() {\n  renderApp();\n}\n',
            bytes: 34,
            updatedAt: 2
          }, {
            relativePath: 'README.md',
            content: '# Polaris',
            bytes: 9,
            updatedAt: 2
          }]
        })),
        readFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          content: 'function boot() {\n  renderApp();\n}\n'
        }))
      }
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'searchDesktopFiles',
      path: 'src',
      query: 'renderApp'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已搜索本机文件 · 1 处命中',
      detailText: expect.stringContaining('src/main.tsx:2')
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'readDesktopFileContext',
      filePath: 'src/main.tsx',
      lineNumber: 2,
      before: 1,
      after: 1
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已读取本机文件上下文 · Polaris/src/main.tsx:2',
      detailText: expect.stringContaining('2:   renderApp();')
    });
  });

  it('writes and runs commands through the desktop local host', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'writeDesktopFile',
      filePath: 'README.md',
      content: 'hello'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已写入本机文件 · Polaris/README.md',
      detailText: '5 bytes'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'runDesktopCommand',
      command: 'npm',
      args: ['test']
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '本机命令已完成 · $ npm test'
    });
  });

  it('runs desktop command sequences through the desktop local host', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'runDesktopCommandSequence',
      steps: [{
        label: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit']
      }]
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '本机命令流程已完成 · 1 步',
      detailText: expect.stringContaining('1. typecheck · $ npx tsc --noEmit')
    });

    expect(ctx.desktopLocalHost?.runCommandSequence).toHaveBeenCalledWith({
      rootId: 'local-root-1',
      steps: [{
        label: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit'],
        cwdRelativePath: undefined
      }],
      continueOnError: undefined
    });
  });

  it('returns failed desktop command sequence output as repair evidence', async () => {
    const ctx = createUtilityContext({
      desktopLocalHost: {
        ...createUtilityContext().desktopLocalHost!,
        runCommandSequence: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          durationMs: 12,
          continueOnError: false,
          stoppedAtStep: 0,
          steps: [{
            root: {
              id: 'local-root-1',
              label: 'Polaris',
              path: '/Users/example/Desktop/Polaris',
              createdAt: 1,
              lastUsedAt: 2
            },
            index: 0,
            label: 'test',
            cwd: '/Users/example/Desktop/Polaris',
            cwdRelativePath: '',
            command: 'npm',
            args: ['test'],
            durationMs: 12,
            exitCode: 1,
            signal: null,
            stdout: '',
            stderr: 'expected true to be false'
          }]
        }))
      }
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'runDesktopCommandSequence',
      steps: [{
        label: 'test',
        command: 'npm',
        args: ['test']
      }]
    }, ctx)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('expected true to be false')
    });
  });

  it('creates, deletes, and moves desktop local paths through the desktop local host', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'createDesktopDirectory',
      path: 'src/new-folder'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已创建本机文件夹 · Polaris/src/new-folder',
      detailText: 'directory=src/new-folder'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'deleteDesktopPath',
      path: 'src/old-folder'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已删除本机路径 · Polaris/src/old-folder',
      detailText: 'deleted=src/old-folder · kind=directory'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'moveDesktopPath',
      fromPath: 'src/old-name.ts',
      toPath: 'src/new-name.ts'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已移动本机路径 · Polaris/src/new-name.ts',
      detailText: 'src/old-name.ts -> src/new-name.ts · kind=file'
    });
  });

  it('starts, lists, and stops desktop command sessions through the desktop local host', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'startDesktopCommand',
      command: 'npm',
      args: ['run', 'dev']
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '本机终端会话已启动 · session-1',
      detailText: expect.stringContaining('session-1 · running · $ npm run dev')
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'listDesktopCommandSessions'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '找到 1 个本机终端会话。',
      detailText: expect.stringContaining('running=5ms')
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'stopDesktopCommand',
      sessionId: 'session-1'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '本机终端会话已停止 · session-1',
      detailText: expect.stringContaining('exit=SIGTERM · 10ms')
    });
  });

  it('edits desktop local files with an exact unique replacement', async () => {
    const ctx = createUtilityContext({
      desktopLocalHost: {
        ...createUtilityContext().desktopLocalHost!,
        readFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          content: 'function boot() {\n  render();\n}\n'
        })),
        writeFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          bytes: 34
        }))
      }
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'editDesktopFileText',
      filePath: 'src/main.tsx',
      oldString: '  render();',
      newString: '  renderApp();'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已局部替换本机文件 · Polaris/src/main.tsx',
      detailText: 'replaced=1 · 34 bytes'
    });

    expect(ctx.desktopLocalHost?.writeFile).toHaveBeenCalledWith({
      rootId: 'local-root-1',
      relativePath: 'src/main.tsx',
      content: 'function boot() {\n  renderApp();\n}\n'
    });
  });

  it('refuses ambiguous desktop local replacements', async () => {
    const ctx = createUtilityContext({
      desktopLocalHost: {
        ...createUtilityContext().desktopLocalHost!,
        readFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          content: '<button>OK</button>\n<button>OK</button>'
        }))
      }
    });

    const result = await utilityToolExecutorPlugin.execute({
      kind: 'editDesktopFileText',
      filePath: 'src/main.tsx',
      oldString: '<button>OK</button>',
      newString: '<button>Open</button>'
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('要替换的本机文件片段匹配到 2 处');
    expect(ctx.desktopLocalHost?.writeFile).not.toHaveBeenCalled();
  });

  it('replaces desktop local file lines from line context', async () => {
    const ctx = createUtilityContext({
      desktopLocalHost: {
        ...createUtilityContext().desktopLocalHost!,
        readFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          content: 'function boot() {\n  render();\n}\n'
        })),
        writeFile: vi.fn(async () => ({
          root: {
            id: 'local-root-1',
            label: 'Polaris',
            path: '/Users/example/Desktop/Polaris',
            createdAt: 1,
            lastUsedAt: 2
          },
          relativePath: 'src/main.tsx',
          bytes: 34
        }))
      }
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'replaceDesktopFileLines',
      filePath: 'src/main.tsx',
      startLine: 2,
      code: '  renderApp();'
    }, ctx)).resolves.toEqual({
      ok: true,
      summary: '已按行替换本机文件 · Polaris/src/main.tsx:2-2',
      detailText: 'lines=2-2 · 34 bytes'
    });

    expect(ctx.desktopLocalHost?.writeFile).toHaveBeenCalledWith({
      rootId: 'local-root-1',
      relativePath: 'src/main.tsx',
      content: 'function boot() {\n  renderApp();\n}\n'
    });
  });

  it('delegates desktop workspace sync actions to desktop-only context ports', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'syncDesktopWorkspaceFromDisk',
      projectId: 'project-1',
      rootId: 'local-root-1',
      allowOverwrite: true
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已从电脑读入工作区 · Demo'
    });

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'syncDesktopWorkspaceToDisk',
      projectId: 'project-1',
      rootId: 'local-root-1'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已送到电脑工作区 · Demo'
    });

    expect(ctx.syncDesktopWorkspaceFromDisk).toHaveBeenCalledWith({
      projectId: 'project-1',
      rootId: 'local-root-1',
      allowOverwrite: true
    });
    expect(ctx.syncDesktopWorkspaceToDisk).toHaveBeenCalledWith({
      projectId: 'project-1',
      rootId: 'local-root-1',
      allowOverwrite: undefined
    });
  });

  it('delegates personal data read actions to native context ports', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'listCalendars'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已读取可写系统日历 · 1 个'
    });
    await expect(utilityToolExecutorPlugin.execute({
      kind: 'readCalendarEvents',
      startDate: '2026-06-12',
      endDate: '2026-06-13',
      query: 'meeting',
      maxEvents: 5
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已读取系统日历 · 0 条'
    });
    expect(ctx.readCalendarEvents).toHaveBeenCalledWith({
      startDate: '2026-06-12',
      endDate: '2026-06-13',
      query: 'meeting',
      maxEvents: 5
    });
    expect(ctx.listCalendars).toHaveBeenCalledOnce();
  });

  it('delegates calendar write actions to native context ports', async () => {
    const ctx = createUtilityContext();

    await expect(utilityToolExecutorPlugin.execute({
      kind: 'createCalendarEvent',
      title: '看牙',
      startDate: '2026-06-14T10:00:00Z',
      endDate: '2026-06-14T11:00:00Z',
      location: '诊所',
      calendarId: 'calendar-1'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已创建系统日历事件 · 看牙'
    });
    await expect(utilityToolExecutorPlugin.execute({
      kind: 'updateCalendarEvent',
      eventId: 'event-1',
      startDate: '2026-06-14T12:00:00Z',
      endDate: '2026-06-14T13:00:00Z'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已修改系统日历事件 · 看牙'
    });
    await expect(utilityToolExecutorPlugin.execute({
      kind: 'deleteCalendarEvent',
      eventId: 'event-1'
    }, ctx)).resolves.toMatchObject({
      ok: true,
      summary: '已删除系统日历事件 · 看牙'
    });

    expect(ctx.createCalendarEvent).toHaveBeenCalledWith({
      title: '看牙',
      startDate: '2026-06-14T10:00:00Z',
      endDate: '2026-06-14T11:00:00Z',
      allDay: undefined,
      location: '诊所',
      notes: undefined,
      calendarId: 'calendar-1'
    });
    expect(ctx.updateCalendarEvent).toHaveBeenCalledWith({
      eventId: 'event-1',
      title: undefined,
      startDate: '2026-06-14T12:00:00Z',
      endDate: '2026-06-14T13:00:00Z',
      allDay: undefined,
      location: undefined,
      notes: undefined
    });
    expect(ctx.deleteCalendarEvent).toHaveBeenCalledWith({
      eventId: 'event-1'
    });
  });
});
