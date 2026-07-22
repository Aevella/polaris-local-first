import { describe, expect, it } from 'vitest';
import { materializeRequestContextMessage, shouldKeepMessageInRequestContext } from './requestContextMessages';

describe('requestContextMessages', () => {
  it('keeps executed informational tool messages in request context', () => {
    expect(shouldKeepMessageInRequestContext({
      id: 'tool-1',
      role: 'system',
      content: '已找到 3 条网页结果',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-1',
        kind: 'webSearch',
        status: 'executed',
        title: '联网搜索',
        summary: '已找到 3 条网页结果',
        detailText: '1. 第一条\n2. 第二条'
      }
    })).toBe(true);
  });

  it('keeps terminal tool messages from request context even when they are not on the old whitelist', () => {
    expect(shouldKeepMessageInRequestContext({
      id: 'tool-2',
      role: 'system',
      content: '已生成二维码',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-2',
        kind: 'createQrCode',
        status: 'executed',
        title: '生成二维码',
        summary: '已生成二维码'
      }
    })).toBe(true);
  });

  it('keeps recent theme tool messages in request context', () => {
    expect(shouldKeepMessageInRequestContext({
      id: 'tool-3',
      role: 'system',
      content: '这版试穿已应用。',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-3',
        kind: 'applyThemeCoordinates',
        status: 'applied',
        title: '整体坐标换肤试穿',
        summary: '整页奶绿纸本 · hue 132 · 色数 2 · 情绪 -1 · 材质 5',
        previewId: 'preview-1',
        themeScope: 'app',
        themeSurfaceLabels: ['背景', '顶栏'],
        themeIntentLabel: '整页奶绿纸本'
      }
    })).toBe(true);
  });

  it('materializes detailed tool payload into request-visible content', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-4',
      role: 'system',
      content: '已读取网页',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-4',
        kind: 'readWebPage',
        status: 'executed',
        title: '读取网页',
        summary: '已读取网页',
        detailText: '这里是网页正文摘要'
      }
    }).content;

    expect(content).toContain('摘要：已读取网页');
    expect(content).toContain('详情：');
    expect(content).toContain('这里是网页正文摘要');
  });

  it('materializes action tool details as an omission marker instead of raw logs', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-action',
      role: 'system',
      content: '已应用 CSS',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-action',
        kind: 'saveCodeCard',
        status: 'saved',
        title: '保存卡片',
        summary: '已保存一张 HTML 卡片。',
        detailText: '<main>raw card body</main>'
      }
    }).content;

    expect(content).toContain('摘要：已保存一张 HTML 卡片。');
    expect(content).toContain('详情：已省略原始执行细节');
    expect(content).not.toContain('<main>raw card body</main>');
  });

  it('materializes theme tool payload into a compact executed-tool block', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-5',
      role: 'system',
      content: '这版试穿已应用。',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-5',
        kind: 'applySurfaceTokens',
        status: 'preview',
        title: '单区域精修试穿',
        summary: '回复气泡晚雾 · 06 · hue 266',
        previewId: 'preview-2',
        themeScope: 'chat',
        themeSurfaceLabels: ['回复气泡'],
        themeIntentLabel: '晚雾'
      }
    }).content;

    expect(content).toContain('[工具结果：单区域精修试穿]');
    expect(content).toContain('状态：preview');
    expect(content).toContain('摘要：回复气泡晚雾 · 06 · hue 266');
    expect(content).toContain('区域：回复气泡');
    expect(content).toContain('意图：晚雾');
  });

  it('materializes structured workspace evidence without replaying file bodies', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-workspace',
      role: 'system',
      content: '已续写工作区文件 · styles/main.css',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-workspace',
        kind: 'appendProjectFile',
        status: 'executed',
        title: '已续写工作区文件',
        summary: '已续写工作区文件 · styles/main.css',
        projectFileEffects: [{
          projectId: 'project-1',
          fileId: 'file-css',
          filePath: 'styles/main.css',
          operation: 'appended',
          beforeLines: 12,
          afterLines: 24,
          changedLines: { start: 13, end: 24 },
          afterExcerptStartLine: 22,
          afterExcerptEndLine: 24,
          afterExcerpt: '22: .card {\n23:   color: red;\n24: }',
          insertedChars: 420
        }]
      }
    }).content;

    expect(content).toContain('摘要：已续写工作区文件 · styles/main.css');
    expect(content).toContain('变更证据：');
    expect(content).toContain('styles/main.css · appended · 12→24 行 · 范围 13-24 · 新增 420 字 · 后文 22-24');
    expect(content).toContain('23:   color: red;');
  });

  it('materializes structured MCP result evidence for follow-up tool calls', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-mcp',
      role: 'system',
      content: '已调用 MCP 工具 · Forum MCP / forum_read',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-mcp',
        kind: 'invokeMcpTool',
        toolName: 'mcp__forum__forum_read',
        status: 'executed',
        title: '调用 MCP 工具',
        summary: '已调用 MCP 工具 · Forum MCP / forum_read',
        detailText: '已返回帖子回复。',
        mcpResult: {
          serverId: 'forum',
          serverName: 'Forum MCP',
          schemaName: 'mcp__forum__forum_read',
          toolName: 'forum_read',
          isError: true,
          argumentsObject: {
            thread_id: 809
          },
          structuredContent: {
            replies: [
              { id: 8891, author: 'me' },
              { id: 8892, author: 'me' }
            ]
          }
        }
      }
    }).content;

    expect(content).toContain('MCP 结果证据：');
    expect(content).toContain('工具：Forum MCP / forum_read');
    expect(content).toContain('isError=true');
    expect(content).not.toContain('参数：');
    expect(content).not.toContain('8891');
  });

  it('materializes runtime diagnostics with the first actionable error location', () => {
    const content = materializeRequestContextMessage({
      id: 'tool-runtime',
      role: 'system',
      content: '运行检查完成 · console error 1 条 · scripts/app.js:17',
      timestamp: 1,
      toolInvocation: {
        id: 'tool-runtime',
        kind: 'inspectProjectRuntime',
        status: 'executed',
        title: '运行工作区预览',
        summary: '运行检查完成 · console error 1 条 · scripts/app.js:17',
        projectDiagnostics: [{
          tool: 'inspectProjectRuntime',
          projectId: 'project-1',
          runnable: true,
          reason: 'console-error',
          entryFilePath: 'index.html',
          status: 'loaded',
          errorsCount: 1,
          firstErrorFilePath: 'scripts/app.js',
          firstErrorLineNumber: 17,
          firstErrorMessage: 'Uncaught ReferenceError: missingThing is not defined'
        }]
      }
    }).content;

    expect(content).toContain('诊断证据：');
    expect(content).toContain('reason=console-error');
    expect(content).toContain('firstError=scripts/app.js:17 Uncaught ReferenceError: missingThing is not defined');
  });

  it('keeps assistant content intact when materializing plain assistant history', () => {
    const materialized = materializeRequestContextMessage({
      id: 'assistant-plain',
      role: 'assistant',
      content: '助手正文应该按原样进入历史。',
      timestamp: 1,
      nativeToolCalls: [{
        name: 'patchRawCss',
        argumentsText: '{"css":"body { color: red; }"}'
      }]
    });

    expect(materialized.content).toBe('助手正文应该按原样进入历史。');
    expect(materialized.nativeToolCalls).toEqual([{
      name: 'patchRawCss',
      argumentsText: '{"css":"body { color: red; }"}'
    }]);
  });
});
