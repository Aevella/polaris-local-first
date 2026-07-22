import { describe, expect, it } from 'vitest';
import {
  projectToolInvocationForRequest,
  projectToolResultPayloadForRequest
} from './requestToolResultProjection';

describe('requestToolResultProjection', () => {
  it('keeps full detail for material read results', () => {
    expect(projectToolInvocationForRequest({
      id: 'tool-read',
      kind: 'readAttachmentText',
      status: 'executed',
      title: '读附件',
      summary: '已读取：设定.txt',
      detailText: '附件：设定.txt\n\n第一行\n第二行'
    })).toMatchObject({
      kind: 'readAttachmentText',
      status: 'executed',
      title: '读附件',
      summary: '已读取：设定.txt',
      detailText: '附件：设定.txt\n\n第一行\n第二行'
    });
  });

  it('omits raw details for action results', () => {
    const projected = projectToolInvocationForRequest({
      id: 'tool-save',
      kind: 'saveCodeCard',
      status: 'saved',
      title: '保存卡片',
      summary: '已保存卡片。',
      detailText: '<main>raw card body</main>'
    });

    expect(projected).toMatchObject({
      kind: 'saveCodeCard',
      status: 'saved',
      title: '保存卡片',
      summary: '已保存卡片。',
      detailOmitted: true
    });
    expect(projected).not.toHaveProperty('detailText');
  });

  it('keeps bounded excerpts for diagnostic tool output', () => {
    const projected = projectToolResultPayloadForRequest({
      toolName: 'runCode',
      kind: 'runCode',
      status: 'failed',
      summary: '代码执行超时。',
      detailText: `start\n${'log '.repeat(800)}\nend`
    });

    expect(projected.detailExcerpt).toEqual(expect.stringContaining('start'));
    expect(projected.detailExcerpt).toEqual(expect.stringContaining('end'));
    expect(projected.detailExcerpt).toEqual(expect.stringContaining('中间已省略'));
    expect(projected.detailOmittedChars).toEqual(expect.any(Number));
  });

  it('keeps full MCP detail when provider adapters override dynamic tool names', () => {
    const detailText = `first reply id=8891\n${'reply body '.repeat(500)}\nlast reply id=8892`;
    const projected = projectToolResultPayloadForRequest({
      toolName: 'mcp__forum__forum_read',
      kind: 'invokeMcpTool',
      status: 'executed',
      summary: '已调用 MCP 工具 · forum_read',
      detailText
    }, {
      toolName: 'mcp__forum__forum_read',
      kind: 'mcp__forum__forum_read'
    });

    expect(projected).toMatchObject({
      toolName: 'mcp__forum__forum_read',
      kind: 'mcp__forum__forum_read',
      detailText
    });
    expect(projected).not.toHaveProperty('detailExcerpt');
    expect(projected).not.toHaveProperty('detailOmittedChars');
    expect(projected).not.toHaveProperty('detailOmitted');
  });

  it('slims MCP result evidence to identifiers so content only rides in detailText', () => {
    const projected = projectToolResultPayloadForRequest({
      toolName: 'mcp__forum__forum_read',
      kind: 'invokeMcpTool',
      status: 'executed',
      summary: '已调用 MCP 工具 · forum_read',
      detailText: '已返回帖子回复。',
      mcpResult: {
        serverId: 'forum',
        serverName: 'Forum MCP',
        schemaName: 'mcp__forum__forum_read',
        toolName: 'forum_read',
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
    }, {
      toolName: 'mcp__forum__forum_read',
      kind: 'mcp__forum__forum_read'
    });

    expect(projected).toMatchObject({
      toolName: 'mcp__forum__forum_read',
      kind: 'mcp__forum__forum_read',
      mcpResult: {
        serverId: 'forum',
        serverName: 'Forum MCP',
        schemaName: 'mcp__forum__forum_read',
        toolName: 'forum_read'
      }
    });
    expect(projected.mcpResult).not.toHaveProperty('argumentsObject');
    expect(projected.mcpResult).not.toHaveProperty('structuredContent');
  });

  it('projects resolved workspace file paths for write results', () => {
    expect(projectToolInvocationForRequest({
      id: 'tool-append',
      kind: 'appendProjectFile',
      status: 'executed',
      title: '已续写工作区文件',
      summary: '已续写工作区文件 · index.html',
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      targetLabel: 'index.html'
    })).toMatchObject({
      kind: 'appendProjectFile',
      status: 'executed',
      summary: '已续写工作区文件 · index.html',
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      targetLabel: 'index.html'
    });
  });

  it('projects structured workspace evidence for request replay', () => {
    expect(projectToolInvocationForRequest({
      id: 'tool-append',
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
        insertedChars: 420
      }]
    })).toMatchObject({
      kind: 'appendProjectFile',
      projectFileEffects: [{
        projectId: 'project-1',
        fileId: 'file-css',
        filePath: 'styles/main.css',
        operation: 'appended',
        beforeLines: 12,
        afterLines: 24,
        changedLines: { start: 13, end: 24 },
        insertedChars: 420
      }]
    });
  });

  it('drops web evidence duplicates so results only ride in detailText', () => {
    const projected = projectToolInvocationForRequest({
      id: 'tool-search',
      kind: 'webSearch',
      status: 'executed',
      title: '联网搜索',
      summary: '已找到 1 条降级网页结果 · Bing HTML fallback (degraded)',
      detailText: '查询：OpenAI release notes',
      webSearch: {
        query: 'OpenAI release notes',
        provider: 'Bing HTML fallback (degraded)',
        degraded: true,
        warning: 'BRAVE_SEARCH_API_KEY 未配置；已使用降级 Bing HTML 搜索。',
        results: [{
          title: 'OpenAI release notes',
          url: 'https://example.com/release',
          snippet: 'Latest release note summary.',
          source: 'example.com'
        }]
      }
    });
    expect(projected).toMatchObject({
      kind: 'webSearch',
      detailText: '查询：OpenAI release notes'
    });
    expect(projected).not.toHaveProperty('webSearch');
    expect(projected).not.toHaveProperty('webPageRead');
  });
});
