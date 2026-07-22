import { describe, expect, it } from 'vitest';
import { THEME_TOOL_INVOCATION_KINDS } from '../../types/toolInvocationKinds';
import type { ToolInvocationKind } from '../../types/toolInvocationKinds';
import { CARD_TOOL_DEFINITION_MAP } from '../../engines/tool-protocol/toolRegistryCards';
import {
  buildToolPreparationRetrySystemMessage,
  buildLengthFollowupSystemMessage,
  buildTruncatedToolFollowupSystemMessage,
  relaxToolEnforcementForFollowup,
  resolveToolKindFollowupDomain,
  resolveToolFollowupPlan,
  shouldRequestLengthFollowup,
} from './chatToolFollowup';

describe('toolFollowup', () => {
  it('tells the model to put desktop file paths inside retry tool arguments', () => {
    const message = buildToolPreparationRetrySystemMessage({
      status: 'parse_failed',
      message: '工具准备失败。',
      truncated: false,
      reply: {
        content: '现在重新写 index.ts',
        model: 'test-model',
        nativeToolCalls: [{
          id: 'call-1',
          name: 'writeDesktopFile',
          argumentsText: '{};\n\nconsole.log("hello");'
        }]
      },
      parsed: {
        displayContent: '现在重新写 index.ts',
        actions: [],
        issues: ['写入本机文件时缺少 filePath。']
      },
      resolvedActions: []
    });

    expect(message.content).toContain('写入本机文件时缺少 filePath');
    expect(message.content).toContain('路径必须写进工具参数里的 `filePath`');
    expect(message.content).toContain('例如 `src/index.ts`');
    expect(message.content).toContain('不要只在正文里提到文件名');
  });

  it('requests a followup when the assistant turn is still tool-only after a successful direct action', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'webSearch',
            query: 'Polaris'
          },
          toolInvocation: {
            id: 'tool-1',
            kind: 'webSearch',
            status: 'executed',
            title: '联网搜索',
            summary: '已找到 3 条网页结果',
            detailText: '1. ...'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮联网搜索已经执行完了');
    expect(plan?.message.content).toContain('readWebPage');
    expect(plan?.message.content).toContain('不要对同一个问题或同一组关键词再次 webSearch');
  });

  it('treats degraded search results as candidates to read, not a same-query retry signal', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [{
        path: 'direct',
        status: 'executed',
        action: { kind: 'webSearch', query: 'degraded results' },
        toolInvocation: {
          id: 'tool-web-degraded',
          kind: 'webSearch',
          status: 'executed',
          title: '联网搜索',
          summary: '已找到 2 条降级网页结果',
          detailText: '状态：降级搜索结果',
          webSearch: {
            query: 'degraded results',
            provider: 'example',
            degraded: true,
            results: [{ title: 'Example', url: 'https://example.com', snippet: 'Example snippet' }]
          }
        }
      }]
    });

    expect(plan?.message.content).toContain('降级不是重试同一搜索的信号');
    expect(plan?.message.content).toContain('用 readWebPage 读取刚返回的相关 URL');
  });

  it('answers from read web page text before searching again', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [{
        path: 'direct',
        status: 'executed',
        action: { kind: 'readWebPage', url: 'https://example.com/report' },
        toolInvocation: {
          id: 'tool-web-read',
          kind: 'readWebPage',
          status: 'executed',
          title: '读取网页正文',
          summary: '已读取网页',
          detailText: 'Report body',
          webPageRead: {
            url: 'https://example.com/report',
            title: 'Example Report',
            provider: 'reader',
            excerpt: 'Report body'
          }
        }
      }]
    });

    expect(plan?.message.content).toContain('上一轮网页正文已经读取完了');
    expect(plan?.message.content).toContain('基于刚读到的网页文本回答用户上一句');
    expect(plan?.message.content).toContain('不要因为正文不完美就回到同一个查询再次 webSearch');
  });

  it('continues after narrated one-shot tools so the model can close from the real result', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'createQrCode',
            text: 'https://polaris.example.com'
          },
          toolInvocation: {
            id: 'tool-2',
            kind: 'createQrCode',
            status: 'executed',
            title: '生成二维码',
            summary: '已生成二维码',
            detailText: ''
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮工具已经执行完了');
    expect(plan?.message.content).toContain('给用户一句自然收尾');
  });

  it('answers after narrated MCP tool calls because the model has not seen the result yet', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'invokeMcpTool',
            serverId: 'github',
            serverName: 'GitHub',
            schemaName: 'mcp__github__github_list_files',
            toolName: 'github_list_files',
            argumentsObject: {
              owner: 'octocat',
              repo: 'Hello-World'
            }
          },
          toolInvocation: {
            id: 'tool-mcp',
            kind: 'invokeMcpTool',
            status: 'executed',
            title: '调用 MCP 工具',
            summary: '已调用 MCP 工具 · GitHub / github_list_files',
            detailText: 'file README (13 bytes)'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮 MCP 工具已经执行完了');
    expect(plan?.message.content).toContain('基于刚拿到的 MCP 工具结果回答用户上一句');
  });

  it('keeps repeated MCP followups moving until the model naturally stops', () => {
    const plan = resolveToolFollowupPlan({
      depth: 2,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'invokeMcpTool',
            serverId: 'github',
            serverName: 'GitHub',
            toolName: 'github_repo_summary',
            argumentsObject: {}
          },
          toolInvocation: {
            id: 'tool-mcp-repeat',
            kind: 'invokeMcpTool',
            status: 'executed',
            title: '调用 MCP 工具',
            summary: '已调用 MCP 工具'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮 MCP 工具已经执行完了');
    expect(plan?.message.content).toContain('不要让用户再催你走下一步');
  });

  it('keeps project writes moving even when the assistant adds narration', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'createRoomProject',
            project: {
              projectId: 'mini-phone',
              title: 'Mini Phone'
            }
          },
          toolInvocation: {
            id: 'tool-project',
            kind: 'createRoomProject',
            status: 'executed',
            title: '已创建工作区',
            summary: '已创建工作区 · Mini Phone'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('keeps project file writes moving after a narrated file creation', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'createProjectFile',
            file: {
              projectId: 'mini-phone',
              filePath: 'index.html',
              language: 'html',
              code: '<main>Mini Phone</main>'
            }
          },
          toolInvocation: {
            id: 'tool-file',
            kind: 'createProjectFile',
            status: 'executed',
            title: '已创建工作区文件',
            summary: '已创建工作区文件 · index.html'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('keeps project file edits moving after a narrated partial replacement', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'editProjectFileText',
            fileId: 'file-1',
            oldString: '<main>Mini Phone</main>',
            newString: '<main><section>Mini Phone</section></main>'
          },
          toolInvocation: {
            id: 'tool-edit-file',
            kind: 'editProjectFileText',
            status: 'executed',
            title: '已局部替换工作区文件',
            summary: '已局部替换工作区文件 · index.html'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('keeps room card writes moving after narrated partial replacements', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'editCodeCardText',
            cardId: 'card-1',
            oldString: 'function onHit() {}',
            newString: 'function onHit() { playTone(); }'
          },
          toolInvocation: {
            id: 'tool-room-edit',
            kind: 'editCodeCardText',
            status: 'executed',
            title: '已局部替换房间',
            summary: '已局部替换房间 · Neon Beat',
            cardId: 'card-1'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('同一个房间卡');
    expect(plan?.message.content).toContain('下一步仍属于当前房间卡动作链');
  });

  it('keeps room card write continuations moving until the model naturally stops', () => {
    const plan = resolveToolFollowupPlan({
      depth: 2,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'createCodeCard',
            card: {
              title: '温柔的提醒',
              language: 'markdown',
              code: '**今天的你**'
            }
          },
          toolInvocation: {
            id: 'tool-room-create',
            kind: 'createCodeCard',
            status: 'executed',
            title: '已创建卡片',
            summary: '温柔的提醒',
            cardId: 'card-1'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('同一个房间卡');
    expect(plan?.message.content).toContain('只有确实已经做完，才自然收尾');
  });

  it('still follows up once after narrated informational tools without action-kind whitelists', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'inspectArchiveEntries',
            target: 'latest'
          },
          toolInvocation: {
            id: 'tool-3',
            kind: 'inspectArchiveEntries',
            status: 'executed',
            title: '查看压缩包',
            summary: '已列出 26 个文件',
            detailText: '1. README.md'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('requests a natural followup after memory writes handled outside direct tool execution', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'memory',
          status: 'handled',
          action: {
            kind: 'writeMemory',
            memory: ['用户 是女王。']
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮工具已经执行完了');
    expect(plan?.message.content).toContain('给用户一句自然收尾');
  });

  it('asks the assistant to answer after reading a long-term reference doc', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readMemoryDoc',
            docId: 'doc-1'
          },
          toolInvocation: {
            id: 'tool-read-memory-doc',
            kind: 'readMemoryDoc',
            status: 'executed',
            title: '读取长期资料',
            summary: '已读取长期资料 · 桃乐丝合集'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('长期资料已经读取完了');
    expect(plan?.message.content).toContain('基于刚读到的资料正文回答用户上一句');
    expect(plan?.message.content).toContain('这本/这个怎么样');
  });

  it('requests a natural followup after preview tools prepare a visible trial result', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'preview',
          status: 'previewed',
          action: {
            kind: 'patchRawCss',
            css: '.app-shell.chat { color: white; }',
            label: '深色主题'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('continues after narrated readCodeCard results because the model has not seen the body yet', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readCodeCard',
            cardId: 'card-1'
          },
          toolInvocation: {
            id: 'tool-read',
            kind: 'readCodeCard',
            status: 'executed',
            title: '读取房间',
            summary: '已读取房间',
            detailText: '<main>hello</main>'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('同一个房间卡');
    expect(plan?.message.content).toContain('工具结果已经进入当前上下文');
  });

  it('still requests a followup when the turn is tool-only after a readCodeCard', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readCodeCard',
            cardId: 'card-1'
          },
          toolInvocation: {
            id: 'tool-read-only',
            kind: 'readCodeCard',
            status: 'executed',
            title: '读取房间',
            summary: '已读取房间',
            detailText: '<main>hello</main>'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('asks for a visible closing answer when completeTask was tool-only', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'completeTask',
            stage: '已完成',
            summary: '已经看见压缩包内容。'
          },
          toolInvocation: {
            id: 'tool-complete',
            kind: 'completeTask',
            status: 'executed',
            title: '完成任务',
            summary: '已完成'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('完成任务工具已经执行完了');
    expect(plan?.message.content).toContain('当前任务已经完成');
  });

  it('does not add a completion followup when completeTask already had visible text', () => {
    expect(resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'completeTask',
            stage: '已完成',
            summary: '已经完成。'
          },
          toolInvocation: {
            id: 'tool-complete-with-text',
            kind: 'completeTask',
            status: 'executed',
            title: '完成任务',
            summary: '已完成'
          }
        }
      ]
    })).toBeNull();
  });

  it('allows a second broad tool-only continuation before stopping', () => {
    expect(resolveToolFollowupPlan({
      depth: 1,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readCodeCard',
            cardId: 'card-1'
          },
          toolInvocation: {
            id: 'tool-read-repeat',
            kind: 'readCodeCard',
            status: 'executed',
            title: '读取房间',
            summary: '已读取房间',
            detailText: '<main>hello</main>'
          }
        }
      ]
    })).toMatchObject({});
  });

  it('keeps workspace continuations alive past the generic depth cap', () => {
    expect(resolveToolFollowupPlan({
      depth: 2,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'appendProjectFile',
            fileId: 'file-1',
            code: '\nconst nextChunk = true;'
          },
          toolInvocation: {
            id: 'tool-append-project',
            kind: 'appendProjectFile',
            status: 'executed',
            title: '追加工作区文件',
            summary: '已追加工作区文件 · script.js',
            projectFilePaths: ['script.js']
          }
        }
      ]
    })).toMatchObject({});
  });

  it('keeps desktop agent continuations alive with repair-and-retest guidance', () => {
    const plan = resolveToolFollowupPlan({
      depth: 2,
      assistantToolOnlyTurn: true,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'runDesktopCommandSequence',
            steps: [{
              label: 'test',
              command: 'npm',
              args: ['test']
            }]
          },
          toolInvocation: {
            id: 'tool-desktop-sequence',
            kind: 'runDesktopCommandSequence',
            status: 'failed',
            title: '运行本机命令流程',
            summary: '运行本机命令流程 · 1 步',
            error: '1. test · $ npm test\nexpected true to be false'
          }
        }
      ]
    });

    expect(plan).not.toBeNull();
    expect(plan?.message.content).toContain('你还在 Mac 桌面本机工作循环里');
    expect(plan?.message.content).toContain('最近命令结果：失败');
    expect(plan?.message.content).toContain('读取失败指向的文件或上下文、做最小修复、再复跑同一组验证命令');
    expect(plan?.message.content).toContain('不要停在把失败转述给用户');
  });

  it('relaxes forced tool mode during followup turns', () => {
    expect(relaxToolEnforcementForFollowup({
      activeCard: null,
      visibleCards: [],
      toolEnforcementMode: 'force'
    }, 1).toolEnforcementMode).toBe('normal');
  });

  it('keeps workspace reads on the same broad followup path', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readProjectFile',
            fileId: 'file-1'
          },
          toolInvocation: {
            id: 'tool-read-project',
            kind: 'readProjectFile',
            status: 'executed',
            title: '读取工作区文件',
            summary: '已读取工作区文件 · index.html',
            projectFilePaths: ['index.html']
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('你还在同一个工作区的连续施工链里');
    expect(plan?.message.content).toContain('读取结果由工具结果本身承载');
    expect(plan?.message.content).not.toContain('最近刚看过');
  });

  it('continues after narrated theme reads instead of stopping at inspection', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readThemeCss'
          },
          toolInvocation: {
            id: 'tool-read-theme',
            kind: 'readThemeCss',
            status: 'executed',
            title: '已读取 theme.css',
            summary: '读取当前虚拟主题文件',
            detailText: '.app-shell { color: black; }'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('主题工具结果已经进入当前上下文');
    expect(plan?.message.content).toContain('不要停在“已读取”');
    expect(plan?.message.content).toContain('直接发起主题试穿或写入动作');
  });

  it('routes every theme tool kind through the theme followup domain', () => {
    expect(THEME_TOOL_INVOCATION_KINDS.map((kind) => [
      kind,
      resolveToolKindFollowupDomain(kind)
    ])).toEqual(THEME_TOOL_INVOCATION_KINDS.map((kind) => [kind, 'theme']));
  });

  it('routes fixed room-card registry tools through the room-card followup domain', () => {
    const roomCardToolKinds = Object.values(CARD_TOOL_DEFINITION_MAP)
      .filter((tool) => tool.group === 'card')
      .map((tool) => tool.name as ToolInvocationKind);

    expect(roomCardToolKinds.map((kind) => [
      kind,
      resolveToolKindFollowupDomain(kind)
    ])).toEqual(roomCardToolKinds.map((kind) => [kind, 'room-card']));
  });

  it('routes fixed workspace registry tools through the workspace followup domain unless explicitly evidence-only', () => {
    const evidenceOnlyWorkspaceTools = new Set(['searchReadableContext']);
    const workspaceToolKinds = Object.values(CARD_TOOL_DEFINITION_MAP)
      .filter((tool) => (
        (tool.group === 'project' || tool.group === 'cross-boundary')
        && !evidenceOnlyWorkspaceTools.has(tool.name)
      ))
      .map((tool) => tool.name as ToolInvocationKind);

    expect(workspaceToolKinds.map((kind) => [
      kind,
      resolveToolKindFollowupDomain(kind)
    ])).toEqual(workspaceToolKinds.map((kind) => [kind, 'workspace']));
    expect(resolveToolKindFollowupDomain('searchReadableContext')).toBe('tool-result');
  });

  it('uses registry followup overrides for tools whose group alone is not enough', () => {
    expect(resolveToolKindFollowupDomain('saveAttachmentAsCodeCard')).toBe('room-card');
    expect(resolveToolKindFollowupDomain('saveArchiveEntryAsCodeCard')).toBe('room-card');
    expect(resolveToolKindFollowupDomain('saveAttachmentToCollection')).toBeNull();
    expect(resolveToolKindFollowupDomain('createQrCode')).toBeNull();
  });

  it('continues after theme preview writes with the theme-specific handoff', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'preview',
          status: 'previewed',
          action: {
            kind: 'appendThemeCss',
            css: '.app-shell.chat .bubble.assistant { color: #f8fbff; }',
            label: '亮一点'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('主题写入或试穿已经完成');
    expect(plan?.message.content).toContain('当前主题状态事实');
    expect(plan?.message.content).toContain('不要重复调用刚刚已经成功执行过的同一轮主题写入');
    expect(plan?.message.content).not.toContain('直接发起主题试穿或写入动作');
  });

  it('continues after narrated attachment and archive evidence tools through the shared result path', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      assistantToolOnlyTurn: false,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readAttachmentText',
            target: 'latest'
          },
          toolInvocation: {
            id: 'tool-read-attachment',
            kind: 'readAttachmentText',
            status: 'executed',
            title: '读取附件文本',
            summary: '已读取附件文本',
            detailText: 'draft body'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('上一轮工具已经执行完了');
    expect(plan?.message.content).toContain('基于刚拿到的工具结果继续');
  });

  it('keeps informational workspace rereads on the broad path for a second tool-only continuation', () => {
    const plan = resolveToolFollowupPlan({
      depth: 1,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readProjectFile',
            fileId: 'file-2'
          },
          toolInvocation: {
            id: 'tool-read-project-2',
            kind: 'readProjectFile',
            status: 'executed',
            title: '读取工作区文件',
            summary: '已读取工作区文件 · styles/theme.css',
            projectFilePaths: ['styles/theme.css']
          }
        }
      ]
    });

    expect(plan).not.toBeNull();
    expect(plan?.message.content).toContain('读取结果由工具结果本身承载');
    expect(plan?.message.content).not.toContain('最近刚看过');
  });

  it('carries recent write context into workspace followups', () => {
    const plan = resolveToolFollowupPlan({
      depth: 0,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'editProjectFileText',
            fileId: 'file-3',
            oldString: 'const ready = false;',
            newString: 'const ready = true;'
          },
          toolInvocation: {
            id: 'tool-edit-project-3',
            kind: 'editProjectFileText',
            status: 'executed',
            title: '局部替换工作区文件',
            summary: '已局部替换工作区文件 · script.js',
            projectFilePaths: ['script.js']
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('最近刚改过：script.js。');
    expect(plan?.message.content).toContain('写入结果以最近改动作为状态事实');
    expect(plan?.message.content).not.toContain('刚刚看过或改过');
  });

  it('keeps broad followups alive until the model returns a final non-tool answer', () => {
    const plan = resolveToolFollowupPlan({
      depth: 2,
      outcomes: [
        {
          path: 'direct',
          status: 'executed',
          action: {
            kind: 'readCodeCard',
            cardId: 'card-1'
          },
          toolInvocation: {
            id: 'tool-read-repeat-3',
            kind: 'readCodeCard',
            status: 'executed',
            title: '读取房间',
            summary: '已读取房间',
            detailText: '<main>hello</main>'
          }
        }
      ]
    });

    expect(plan?.message.content).toContain('同一个房间卡');
  });

  it('requests a length followup for truncated replies', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 0
    })).toBe(true);
  });

  it('requests a length followup even when tool calls were present', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 0
    })).toBe(true);
  });

  it('requests a length followup when the stream ended without a complete transport close', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'stop', transportIncomplete: true },
      depth: 0
    })).toBe(true);
  });

  it('requests a followup for truncated tool output even when the assistant turn is tool-only', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'stop' },
      isTruncatedToolOutput: true,
      depth: 0
    })).toBe(true);
  });

  it('does not request a length followup once retries are already deep', () => {
    expect(shouldRequestLengthFollowup({
      reply: { finishReason: 'length' },
      depth: 2
    })).toBe(false);
  });

  it('builds a direct continue-from-cutoff instruction message', () => {
    const content = buildLengthFollowupSystemMessage().content;
    expect(content).toContain('输出长度到顶');
    expect(content).toContain('不要重头开始');
    expect(content).toContain('只接下一小段');
    expect(content).toContain('不要试图在这一轮把所有剩余内容一次写完');
  });

  it('builds a chunked tool retry instruction for truncated tool arguments', () => {
    const content = buildTruncatedToolFollowupSystemMessage().content;
    expect(content).toContain('工具调用或代码参数在中途截断');
    expect(content).toContain('不要只输出剩下半截 JSON');
    expect(content).toContain('editProjectFileText');
    expect(content).toContain('appendProjectFile');
    expect(content).toContain('一次只落当前这一块');
  });
});
