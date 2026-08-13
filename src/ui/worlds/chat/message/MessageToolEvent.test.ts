import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ToolInvocation } from '../../../../types/domain';
import { MessageToolEvent, buildThemeCssDetailPreview, shouldAutoExpandToolEvent } from './MessageToolEvent';

function createToolMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'tool-message-1',
    role: 'system',
    content: '',
    timestamp: 1,
    ...overrides
  };
}

function renderToolEvent(message: ChatMessage) {
  return renderToStaticMarkup(createElement(MessageToolEvent, {
    message,
    onSaveImageAttachment: () => {},
    onApplyToolPreview: () => {},
    onSaveToolPreview: () => {},
    onRollbackToolPreview: () => {},
    onOpenToolbox: () => {}
  }));
}

describe('MessageToolEvent', () => {
  it('keeps sandbox notifications collapsed while running', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-runner',
        kind: 'runCode',
        status: 'running',
        title: '执行 JavaScript',
        summary: '正在执行 JavaScript · sandbox',
        detailText: 'console.log("hello")'
      }
    }));

    expect(html).toContain('collapsed');
    expect(html).toContain('展开工具详情');
    expect(html).not.toContain('tool-event-detail');
  });

  it('keeps readProjectFile collapsed by default even while running', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-1',
        kind: 'readProjectFile',
        status: 'running',
        title: '读取工作区文件',
        summary: '正在读取工作区文件 · index.html',
        detailText: '<main>workspace file</main>'
      }
    }));

    expect(html).toContain('collapsed');
    expect(html).not.toContain('tool-event-detail');
    expect(html).toContain('展开工具详情');
  });

  it('keeps readCodeCard collapsed by default even while running', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-1',
        kind: 'readCodeCard',
        status: 'running',
        title: '读取房间',
        summary: '正在读取房间 · Mini Phone',
        detailText: '这里是一大段房间代码'
      }
    }));

    expect(html).toContain('collapsed');
    expect(html).not.toContain('tool-event-detail');
    expect(html).toContain('展开工具详情');
  });

  it('keeps the executed project file action in the collapsed summary', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-1',
        kind: 'createProjectFile',
        status: 'executed',
        title: '已创建工作区文件',
        summary: '已创建工作区文件 · index.html',
        targetLabel: 'index.html',
        projectFileId: 'file-1'
      }
    }));

    expect(html).toContain('collapsed');
    expect(html).toContain('已创建工作区文件 · index.html');
  });

  it('does not repeat sandbox failure copy when summary and detail are the same', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-1',
        kind: 'runCode',
        status: 'failed',
        title: '执行 JavaScript',
        summary: '代码执行超时（60 秒）。',
        detailText: '代码执行超时（60 秒）。'
      }
    }));

    expect(html.match(/代码执行超时（60 秒）。/g)).toHaveLength(1);
  });

  it('only auto-expands readCodeCard when it fails', () => {
    const runningTool = {
      id: 'tool-running',
      kind: 'readCodeCard',
      status: 'running',
      title: '读取房间',
      summary: '正在读取房间 · Mini Phone'
    } satisfies ToolInvocation;
    const executedTool = {
      ...runningTool,
      id: 'tool-executed',
      status: 'executed',
      summary: '已读取房间 · Mini Phone'
    } satisfies ToolInvocation;
    const failedTool = {
      ...runningTool,
      id: 'tool-failed',
      status: 'failed',
      summary: '读取失败 · Mini Phone'
    } satisfies ToolInvocation;

    expect(shouldAutoExpandToolEvent(runningTool)).toBe(false);
    expect(shouldAutoExpandToolEvent(executedTool)).toBe(false);
    expect(shouldAutoExpandToolEvent(failedTool)).toBe(true);
  });

  it('auto-expands previews because they carry immediate actions', () => {
    expect(shouldAutoExpandToolEvent({
      id: 'tool-preview',
      kind: 'writeMemory',
      status: 'preview',
      title: '写入记忆',
      summary: '这批记忆暂未写入。'
    })).toBe(true);
  });

  it('offers to open toolbox for missing built-in capabilities', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-missing-capability',
        kind: 'writeMemory',
        status: 'failed',
        title: '当前没有工具能力',
        summary: '当前没有“写入记忆”能力。',
        detailText: '当前没有“写入记忆”能力。',
        error: '当前没有“写入记忆”能力。'
      }
    }));

    expect(html).toContain('前往工具箱打开');
  });

  it('shows a raw CSS preview for creative theme previews', () => {
    const css = [
      '.app-shell.collection {',
      '  background: #111827;',
      '}',
      '.app-shell.collection .world-collection .card {',
      '  border-color: #93c5fd;',
      '}',
      '.app-shell.collection .world-collection .conversation-card {',
      '  color: #f8fafc;',
      '}'
    ].join('\n');
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-css',
        kind: 'patchRawCss',
        status: 'preview',
        title: '创意 CSS 试穿',
        summary: '收藏背景 · .app-shell.collection { background: #111827; }',
        detailText: css,
        themeSurfaceLabels: ['收藏背景']
      }
    }));

    expect(html).toContain('实际命中');
    expect(html).toContain('tool-event-write-detail');
    expect(html).toContain('message-code-sandbox-band');
    expect(html).toContain('.app-shell.collection {');
    expect(html).toContain('+9');
    expect(html).toContain('-0');
    expect(html).toContain('复制代码');
    expect(html).toContain('收藏背景');
  });

  it('renders write tool code details with line deltas when expanded', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-write',
        kind: 'editProjectFileText',
        status: 'failed',
        title: '局部替换工作区文件',
        summary: '写入失败 · index.html',
        targetLabel: 'index.html',
        codeWriteDetails: [{
          label: 'index.html',
          language: 'html',
          code: '<main>\n  <h1>Hi</h1>\n</main>',
          addedLines: 3,
          removedLines: 1
        }]
      }
    }));

    expect(html).toContain('tool-event-write-row');
    expect(html).toContain('index.html');
    expect(html).toContain('+3');
    expect(html).toContain('-1');
    expect(html).toContain('message-code-sandbox-band');
    expect(html).toContain('&lt;main');
  });

  it('does not show generic detail copy for ordinary tool results', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-detail',
        kind: 'runCode',
        status: 'failed',
        title: '执行 JavaScript',
        summary: '执行失败',
        detailText: 'ReferenceError: value is not defined'
      }
    }));

    expect(html).not.toContain('复制详情');
    expect(html).not.toContain('已复制详情');
  });

  it('keeps audio results out of the expanded receipt while retaining ordinary files', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-mcp-audio',
        kind: 'invokeMcpTool',
        status: 'failed',
        title: '调用语音工具',
        summary: '调用失败',
        detailText: ''
      },
      attachments: [
        {
          id: 'audio-1',
          assetId: 'asset-audio-1',
          kind: 'file',
          name: 'reply.mp3',
          mimeType: 'audio/mpeg',
          size: 2048
        },
        {
          id: 'file-1',
          assetId: 'asset-file-1',
          kind: 'file',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 128
        }
      ]
    }));

    expect(html).not.toContain('reply.mp3');
    expect(html).toContain('notes.txt');
  });

  it('builds a short preview from the beginning of raw theme CSS', () => {
    expect(buildThemeCssDetailPreview('a\nb\nc', 2)).toEqual({
      preview: 'a\nb\n...',
      truncated: true
    });
    expect(buildThemeCssDetailPreview('a\nb', 2)).toEqual({
      preview: 'a\nb',
      truncated: false
    });
  });

  it('does not show a workspace open action for promoteCardToProject events', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-1',
        kind: 'promoteCardToProject',
        status: 'failed',
        title: '已升为工作区',
        summary: '已升为工作区 · Mini Phone',
        targetLabel: 'Mini Phone',
        projectFileId: 'file-1',
        error: '升为工作区失败。'
      }
    }));

    expect(html).not.toContain('去工作区查看');
  });

  it('does not show a workspace open action for appendProjectFile events', () => {
    const html = renderToolEvent(createToolMessage({
      toolInvocation: {
        id: 'tool-2',
        kind: 'appendProjectFile',
        status: 'failed',
        title: '更新工作区文件',
        summary: '更新工作区文件失败 · index.html',
        targetLabel: 'index.html',
        projectFileId: 'file-1',
        error: '写入失败。'
      }
    }));

    expect(html).not.toContain('去工作区查看');
    expect(html).toContain('index.html');
  });
});
