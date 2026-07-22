import { describe, expect, it } from 'vitest';
import {
  extractAssistantNativeToolActions,
  extractAssistantToolActions
} from './assistantToolProtocolParser';

describe('extractAssistantNativeToolActions', () => {
  it('recovers native tool arguments when a provider appends a second JSON object', () => {
    const result = extractAssistantNativeToolActions([{
      name: 'readProjectFile',
      argumentsText: [
        '{"filePath":"src/App.tsx","targetLabel":"入口文件"}',
        '{"targetLabel":"重复的尾部对象"}'
      ].join('\n')
    }], '', 'stable', [], { activeProjectId: 'project-1' });

    expect(result.issues).toEqual([]);
    expect(result.actions).toEqual([{
      kind: 'readProjectFile',
      target: undefined,
      projectId: 'project-1',
      filePath: 'src/App.tsx',
      targetLabel: '入口文件'
    }]);
  });

  it('resolves native MCP schema names through the current MCP catalog', () => {
    const result = extractAssistantNativeToolActions([{
      name: 'mcp__github__github_read_file',
      argumentsText: JSON.stringify({
        owner: 'octocat',
        repo: 'Hello-World',
        path: 'README',
        type: 'root-type',
        name: 'root-name',
        kind: 'root-kind',
        targetLabel: 'schema-owned-target-label',
        action: {
          type: 'describe',
          name: 'round-action',
          payload: { type: 'nested-type' }
        }
      })
    }], '', 'stable', [], {
      mcpTools: [{
        serverId: 'server-github',
        serverName: 'GitHub',
        serverHandle: 'github',
        schemaName: 'mcp__github__github_read_file',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:8787/',
        toolName: 'github_read_file',
        description: 'Read a GitHub file',
        inputSchema: { type: 'object' }
      }]
    });

    expect(result.issues).toEqual([]);
    expect(result.actions).toEqual([{
      kind: 'invokeMcpTool',
      serverId: 'server-github',
      serverName: 'GitHub',
      schemaName: 'mcp__github__github_read_file',
      toolName: 'github_read_file',
      argumentsObject: {
        owner: 'octocat',
        repo: 'Hello-World',
        path: 'README',
        type: 'root-type',
        name: 'root-name',
        kind: 'root-kind',
        targetLabel: 'schema-owned-target-label',
        action: {
          type: 'describe',
          name: 'round-action',
          payload: { type: 'nested-type' }
        }
      },
      targetLabel: 'GitHub / github_read_file'
    }]);
  });

  it('keeps createCodeCard native tool names separate from card kind payloads', () => {
    const result = extractAssistantNativeToolActions([{
      name: 'createCodeCard',
      argumentsText: JSON.stringify({
        kind: 'tool',
        title: '薄荷测试卡',
        cardNote: '像一片薄荷叶，轻轻夹在书页里。',
        language: 'html',
        code: '<p>DeepSeek V4 Flash 可以做卡片。</p>',
        tags: ['测试', '房间']
      })
    }]);

    expect(result.issues).toEqual([]);
    expect(result.actions).toEqual([{
      kind: 'createCodeCard',
      card: {
        kind: 'tool',
        title: '薄荷测试卡',
        cardNote: '像一片薄荷叶，轻轻夹在书页里。',
        language: 'html',
        code: '<p>DeepSeek V4 Flash 可以做卡片。</p>',
        cardFaceCss: undefined,
        tags: ['测试', '房间']
      },
      targetLabel: undefined,
      openInCollection: true
    }]);
  });

  it('keeps patchCodeCard native tool names separate from card kind payloads', () => {
    const result = extractAssistantNativeToolActions([{
      name: 'patchCodeCard',
      argumentsText: JSON.stringify({
        target: 'active',
        kind: 'card',
        title: '新标题',
        code: '<p>updated</p>'
      })
    }]);

    expect(result.issues).toEqual([]);
    expect(result.actions).toEqual([{
      kind: 'patchCodeCard',
      target: 'active',
      targetLabel: undefined,
      patch: {
        kind: 'card',
        title: '新标题',
        cardNote: undefined,
        language: undefined,
        code: '<p>updated</p>',
        cardFaceCss: undefined,
        tags: []
      },
      openInCollection: true
    }]);
  });
});

describe('extractAssistantToolActions', () => {
  it('treats root card shorthand with code as a createCodeCard action', () => {
    const result = extractAssistantToolActions([
      '我先放一张便签。',
      '```polaris-tools {"actions":[{"kind":"card","title":"自动保存便签","language":"html","code":"<textarea id=\\"quickNote\\"></textarea>"}]}```'
    ].join('\n\n'));

    expect(result.issues).toEqual([]);
    expect(result.displayContent).toBe('我先放一张便签。');
    expect(result.actions).toEqual([{
      kind: 'createCodeCard',
      card: {
        kind: 'card',
        title: '自动保存便签',
        cardNote: undefined,
        language: 'html',
        code: '<textarea id="quickNote"></textarea>',
        cardFaceCss: undefined,
        tags: []
      },
      targetLabel: undefined,
      openInCollection: true
    }]);
  });

  it('keeps nested card kind values as card without rewriting them as action names', () => {
    const result = extractAssistantToolActions([
      '```polaris-tools {"actions":[{"kind":"createCodeCard","card":{"kind":"card","title":"嵌套类型","language":"txt","code":"hello"}}]}```'
    ].join('\n'));

    expect(result.issues).toEqual([]);
    expect(result.actions[0]).toEqual({
      kind: 'createCodeCard',
      card: {
        kind: 'card',
        title: '嵌套类型',
        cardNote: undefined,
        language: 'txt',
        code: 'hello',
        cardFaceCss: undefined,
        tags: []
      },
      targetLabel: undefined,
      openInCollection: true
    });
  });
});
