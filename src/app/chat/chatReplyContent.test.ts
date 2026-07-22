import { describe, expect, it } from 'vitest';
import { parseAssistantReplyContent } from './chatReplyContent';

describe('parseAssistantReplyContent', () => {
  it('parses dynamic MCP tool blocks with the discovered MCP catalog', () => {
    const parsed = parseAssistantReplyContent(
      '```polaris-tools\n{"kind":"mcp__github__github_read_file","owner":"octocat","repo":"Hello-World","path":"README","action":{"type":"describe","name":"round-action"}}\n```',
      'medium',
      'stable',
      'final',
      [],
      [],
      {
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
      }
    );

    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.toolIngressSources).toEqual(['fence']);
    expect(parsed.parsed.actions).toEqual([{
      kind: 'invokeMcpTool',
      serverId: 'server-github',
      serverName: 'GitHub',
      schemaName: 'mcp__github__github_read_file',
      toolName: 'github_read_file',
      argumentsObject: {
        owner: 'octocat',
        repo: 'Hello-World',
        path: 'README',
        action: {
          type: 'describe',
          name: 'round-action'
        }
      },
      targetLabel: 'GitHub / github_read_file'
    }]);
  });

  it('parses native MCP tool calls through the main reply content path', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_mcp_1',
        name: 'mcp__github__github_read_file',
        argumentsText: '{"owner":"octocat","repo":"Hello-World","path":"README"}'
      }],
      [],
      {
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
      }
    );

    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.toolIngressSources).toEqual(['native']);
    expect(parsed.parsed.actions).toEqual([{
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
    }]);
  });

  it('prefers native tool calls over text fences for executable actions', () => {
    const parsed = parseAssistantReplyContent(
      '我先把这版界面试出来。',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"# hello","language":"markdown","title":"Draft","tags":["笔记"]}'
      }]
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'createCodeCard',
      card: {
        code: '# hello',
        language: 'markdown',
        title: 'Draft',
        tags: ['笔记']
      },
      openInCollection: true
    }]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).toBe('我先把这版界面试出来。\n\n```markdown\n# hello\n```');
  });

  it('keeps startTask capability intent from native tool calls', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'startTask',
        argumentsText: '{"capability":"theme","title":"换肤","steps":["试穿主题"]}'
      }]
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'startTask',
      capability: 'theme',
      title: '换肤',
      steps: ['试穿主题']
    }]);
    expect(parsed.parsed.issues).toEqual([]);
  });

  it('shows projected code when native createCodeCard arrives without text', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"# hello","language":"markdown","title":"Draft","tags":["笔记"]}'
      }]
    );

    expect(parsed.parsed.actions[0]?.kind).toBe('createCodeCard');
    expect(parsed.visibleContent).toBe('```markdown\n# hello\n```');
  });

  it('keeps half-written native createCodeCard code visible in final content', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"<section>\\n  <h1>Hello</h1>\\n</section>","language":"html","title":"Draft"'
      }]
    );

    expect(parsed.parsed.actions).toEqual([]);
    expect(parsed.parsed.issues[0]).toContain('原生工具 createCodeCard 解析失败');
    expect(parsed.visibleContent).toBe(
      '```html\n<section>\n  <h1>Hello</h1>\n</section>\n```'
    );
  });

  it('projects raw css native tool drafts into streaming content before the tool call fully closes', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'creative',
      'streaming',
      [{
        id: 'call_1',
        name: 'patchRawCss',
        argumentsText: '{"css":".app-shell.chat .bubble.user {\\n  background: linear-gradient(135deg, #cde8df, #f5fffb);\\n}'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```polaris-tools\n.app-shell.chat .bubble.user {\n  background: linear-gradient(135deg, #cde8df, #f5fffb);\n}\n```'
    );
  });

  it('projects patchRawCss fence actions into streaming content on fallback channels', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我先给你做一版。',
        '',
        '```polaris-tools',
        '{"actions":[{"kind":"patchRawCss","css":".app-shell.chat .bubble.user {\\n  background: linear-gradient(135deg, #cde8df, #f5fffb);\\n}"}]}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'streaming'
    );

    expect(parsed.visibleContent).toBe(
      '我先给你做一版。\n\n```css\n.app-shell.chat .bubble.user {\n  background: linear-gradient(135deg, #cde8df, #f5fffb);\n}\n```'
    );
  });

  it('keeps unfinished fallback editThemeCss drafts visible during streaming', () => {
    const parsed = parseAssistantReplyContent(
      [
        '```polaris-tools',
        '{"actions":[{"kind":"editThemeCss","oldString":".bubble.user { color: black; }","newString":".bubble.user {\\n  color: white;\\n  border: 1px solid rgba(255,255,255,.4);\\n}'
      ].join('\n'),
      'medium',
      'creative',
      'streaming'
    );

    expect(parsed.visibleContent).toBe(
      '```css\n.bubble.user {\n  color: white;\n  border: 1px solid rgba(255,255,255,.4);\n}\n```'
    );
  });

  it('keeps unfinished fallback editProjectFileText drafts visible during streaming', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我先补这一段。',
        '',
        '```polaris-tools',
        '{"actions":[{"kind":"editProjectFileText","filePath":"index.html","oldString":"<main></main>","newString":"<main>\\n  <section class=\\"hero\\">Aeve</section>\\n</main>'
      ].join('\n'),
      'medium',
      'stable',
      'streaming'
    );

    expect(parsed.visibleContent).toBe(
      '我先补这一段。\n\n```html\n<main>\n  <section class="hero">Aeve</section>\n</main>\n```'
    );
  });

  it('projects native code card drafts into streaming content before the tool call fully closes', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"<section>\\n  <h1>Hello</h1>\\n</section>","language":"html","title":"Draft","tags":["房间"]}'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```html\n<section>\n  <h1>Hello</h1>\n</section>\n```'
    );
  });

  it('projects native appendProjectFile drafts into streaming content before the tool call fully closes', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'appendProjectFile',
        argumentsText: '{"target":"active","code":"\\n<section class=\\"lock-screen\\">\\n  <h2>Today</h2>\\n</section>'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```\n<section class="lock-screen">\n  <h2>Today</h2>\n</section>\n```'
    );
  });

  it('resolves native createProjectFile drafts against the active workspace id', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'createProjectFile',
        argumentsText: '{"filePath":"index.html","language":"html","fileRole":"entry","code":"<main>Aelion</main>"}'
      }],
      [],
      {
        hasWorkspaceContext: true,
        activeProjectId: 'workspace-aelion-diary'
      }
    );

    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.parsed.actions).toEqual([{
      kind: 'createProjectFile',
      file: {
        projectId: 'workspace-aelion-diary',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main>Aelion</main>'
      },
      targetLabel: undefined,
      openInCollection: false
    }]);
  });

  it('projects native runCode drafts into streaming content before the tool call fully closes', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'runCode',
        argumentsText: '{"code":"const laughs = 156;\\nreturn laughs;"}'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```js\nconst laughs = 156;\nreturn laughs;\n```'
    );
  });

  it('projects stable coordinate tool drafts into streaming content as visible JSON', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'applyThemeCoordinates',
        argumentsText: '{"targets":"all","hue":28,"hueCount":2,"emotion":3,"meaning":6,"label":"纸本暖粉"}'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```polaris-tools\n{\n  "kind": "applyThemeCoordinates",\n  "targets": "all",\n  "hue": 28,\n  "hueCount": 2,\n  "emotion": 3,\n  "meaning": 6,\n  "label": "纸本暖粉"\n}\n```'
    );
  });

  it('projects single-surface stable token drafts into streaming content as visible JSON', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'applySurfaceTokens',
        argumentsText: '{"targets":["04"],"spell":"soft dusk","hue":266,"saturation":24,"lightness":34,"opacity":76,"radius":18,"texture":"frosted-glass","label":"回复气泡晚雾"}'
      }]
    );

    expect(parsed.visibleContent).toBe(
      '```polaris-tools\n{\n  "kind": "applySurfaceTokens",\n  "targets": [\n    "04"\n  ],\n  "spell": "soft dusk",\n  "texture": "frosted-glass",\n  "label": "回复气泡晚雾",\n  "hue": 266,\n  "saturation": 24,\n  "lightness": 34,\n  "opacity": 76,\n  "radius": 18\n}\n```'
    );
  });

  it('keeps streaming tool-only replies visually empty until real content arrives', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'readWebPage',
        argumentsText: '{"url":"https://example.com"}'
      }]
    );

    expect(parsed.visibleContent).toBe('');
  });

  it('keeps final read-only tool turns visually empty when there is no narration yet', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'inspectArchiveEntries',
        argumentsText: '{"target":"latest"}'
      }]
    );

    expect(parsed.parsed.actions[0]?.kind).toBe('inspectArchiveEntries');
    expect(parsed.visibleContent).toBe('');
    expect(parsed.isToolOnlyTurn).toBe(true);
  });

  it('shows projected runCode when the final native tool call arrives without narration', () => {
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'runCode',
        argumentsText: '{"code":"const laughs = 156;\\nreturn laughs;"}'
      }]
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'runCode',
      code: 'const laughs = 156;\nreturn laughs;'
    }]);
    expect(parsed.visibleContent).toBe(
      '```js\nconst laughs = 156;\nreturn laughs;\n```'
    );
  });

  it('recovers loose native runCode arguments when a provider appends code after an empty JSON shell', () => {
    const code = [
      'function getBatteryLevel() {',
      '  return 42;',
      '}',
      'return getBatteryLevel();'
    ].join('\n');
    const parsed = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'runCode',
        argumentsText: `{};\n\n${code}`
      }]
    );

    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.parsed.actions).toEqual([{
      kind: 'runCode',
      code
    }]);
    expect(parsed.visibleContent).toBe(`\`\`\`js\n${code}\n\`\`\``);
  });

  it('recovers assistant tool call transcripts without leaking them into visible content', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我去把锁屏那块收一下。',
        '',
        '[assistanttoolcalls]',
        '[',
        '  {',
        '    "id": "call_1",',
        '    "name": "editProjectFileText",',
        '    "arguments": "{\\"target\\":\\"active\\",\\"oldString\\":\\"<head>\\",\\"newString\\":\\"<head>\\\\n<style>body { overscroll-behavior: none; }</style>\\"}"',
        '  }',
        ']'
      ].join('\n'),
      'medium',
      'stable',
      'final'
    );

    expect(parsed.parsed.actions).toHaveLength(1);
    expect(parsed.parsed.actions[0]).toMatchObject({
      kind: 'editProjectFileText',
      target: 'active',
      oldString: '<head>',
      newString: '<head>\n<style>body { overscroll-behavior: none; }</style>'
    });
    expect(parsed.visibleContent).not.toContain('[assistanttoolcalls]');
    expect(parsed.visibleContent).toContain('我去把锁屏那块收一下。');
    expect(parsed.parsed.actions[0]).toMatchObject({
      kind: 'editProjectFileText',
      newString: '<head>\n<style>body { overscroll-behavior: none; }</style>'
    });
    expect(parsed.visibleContent).not.toContain('overscroll-behavior: none;');
  });

  it('keeps narrated createCodeCard code blocks inline instead of re-appending them at the bottom', () => {
    const content = [
      '我先给你一个完整例子，结构就在这里：',
      '',
      '```html',
      '<section class="demo-card">',
      '  <h1>Polaris Card</h1>',
      '  <p>这是一段说明。</p>',
      '</section>',
      '```',
      '',
      '你直接从这个骨架往下改就行。'
    ].join('\n');

    const parsed = parseAssistantReplyContent(
      content,
      'medium',
      'stable',
      'final',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"<section class=\\"demo-card\\">\\n  <h1>Polaris Card</h1>\\n  <p>这是一段说明。</p>\\n</section>","language":"html","title":"Draft","tags":["房间"]}'
      }]
    );

    expect(parsed.visibleContent).toBe(content);
  });

  it('recovers a creative css code block into appendThemeCss when the model only wrote css', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我先给你试一版。',
        '',
        '```css',
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #ffe7f1, #fff4e8);',
        '  border-radius: 22px;',
        '}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'final'
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'appendThemeCss',
      css: [
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #ffe7f1, #fff4e8);',
        '  border-radius: 22px;',
        '}'
      ].join('\n')
    }]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).toContain('```css');
  });

  it('keeps a creative css code block as file content inside a workspace context', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我先写样式文件。',
        '',
        '```css',
        '.game-shell {',
        '  min-height: 100vh;',
        '}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'final',
      [],
      [],
      { hasWorkspaceContext: true }
    );

    expect(parsed.parsed.actions).toEqual([]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).toContain('```css');
  });

  it('recovers a creative css code block inside a workspace when theme-only mode is active', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我直接把主题 CSS 试穿上去。',
        '',
        '```css',
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #e8f5ff, #fff8e8);',
        '}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'final',
      [],
      [],
      { hasWorkspaceContext: true, allowCreativeCssRecovery: true }
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'appendThemeCss',
      css: [
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #e8f5ff, #fff8e8);',
        '}'
      ].join('\n')
    }]);
    expect(parsed.parsed.issues).toEqual([]);
  });

  it('recovers a creative css code block even when the model also emitted a broken tool fence', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我直接给你写出来。',
        '',
        '```polaris-tools',
        '{"actions":[{"kind":"patchRawCss","css":"oops"}',
        '```',
        '',
        '```css',
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #d8f4ec, #fff6dd);',
        '  border: 2px solid rgba(210, 182, 132, 0.38);',
        '}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'final'
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'appendThemeCss',
      css: [
        '.app-shell.chat .bubble.user {',
        '  background: linear-gradient(135deg, #d8f4ec, #fff6dd);',
        '  border: 2px solid rgba(210, 182, 132, 0.38);',
        '}'
      ].join('\n')
    }]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).toContain('```css');
  });

  it('keeps a creative JSON code block with patchRawCss actions on the compatibility path', () => {
    const parsed = parseAssistantReplyContent(
      [
        '也调了，半透明偏奶白，底下透着一点背景的粉紫色。',
        '',
        '```json',
        '{"actions":[{"kind":"patchRawCss","css":".app-shell.chat .topbar-surface {\\n  background: rgba(255, 255, 255, 0.55);\\n  backdrop-filter: blur(16px);\\n  -webkit-backdrop-filter: blur(16px);\\n  border-bottom: 1px solid rgba(200, 180, 210, 0.25);\\n  box-shadow: 0 1px 8px rgba(180, 160, 200, 0.08);\\n}"}]}',
        '```'
      ].join('\n'),
      'medium',
      'creative',
      'final'
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'patchRawCss',
      css: [
        '.app-shell.chat .topbar-surface {',
        '  background: rgba(255, 255, 255, 0.55);',
        '  backdrop-filter: blur(16px);',
        '  -webkit-backdrop-filter: blur(16px);',
        '  border-bottom: 1px solid rgba(200, 180, 210, 0.25);',
        '  box-shadow: 0 1px 8px rgba(180, 160, 200, 0.08);',
        '}'
      ].join('\n')
    }]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).not.toContain('```json');
    expect(parsed.visibleContent).toContain('```css');
  });

  it('keeps a bare creative JSON payload with patchRawCss actions on the compatibility path', () => {
    const parsed = parseAssistantReplyContent(
      '{"actions":[{"kind":"patchRawCss","css":".app-shell.chat .topbar-surface {\\n  background: rgba(255, 255, 255, 0.55);\\n}"}]}',
      'medium',
      'creative',
      'final'
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'patchRawCss',
      css: [
        '.app-shell.chat .topbar-surface {',
        '  background: rgba(255, 255, 255, 0.55);',
        '}'
      ].join('\n')
    }]);
    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.visibleContent).toBe(
      '```css\n.app-shell.chat .topbar-surface {\n  background: rgba(255, 255, 255, 0.55);\n}\n```'
    );
  });

  it('recovers pseudo tool-call markup into createCodeCard actions', () => {
    const parsed = parseAssistantReplyContent(
      [
        '<tool_call>',
        '<function=createCodeCard>',
        '<parameter=title>失物招领</parameter>',
        '<parameter=language>txt</parameter>',
        '<parameter=code>第一天早上八点，他去打开店门，发现门口堆着东西。</parameter>',
        '<parameter=tags>["小说","荒诞","短篇"]</parameter>',
        '</function>',
        '</tool_call>'
      ].join('\n'),
      'medium',
      'stable',
      'final'
    );

    expect(parsed.parsed.actions).toEqual([{
      kind: 'createCodeCard',
      card: {
        title: '失物招领',
        language: 'txt',
        code: '第一天早上八点，他去打开店门，发现门口堆着东西。',
        tags: ['小说', '荒诞', '短篇']
      },
      openInCollection: true
    }]);
    expect(parsed.visibleContent).toBe(
      '```txt\n第一天早上八点，他去打开店门，发现门口堆着东西。\n```'
    );
  });

  it('turns project file draft blocks into executable project file actions', () => {
    const parsed = parseAssistantReplyContent(
      [
        '我先把入口文件落下来。',
        '',
        '```polaris-project-file {"projectId":"mini-phone","projectTitle":"Mini Phone","filePath":"index.html","language":"html","fileRole":"entry"}',
        '<main class="phone">',
        '  <h1>Mini Phone</h1>',
        '</main>',
        '```'
      ].join('\n'),
      'medium',
      'stable',
      'final'
    );

    expect(parsed.parsed.issues).toEqual([]);
    expect(parsed.parsed.actions).toEqual([{
      kind: 'writeProjectFiles',
      projectId: 'mini-phone',
      files: [{
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        code: '<main class="phone">\n  <h1>Mini Phone</h1>\n</main>\n',
        replaceContent: true
      }],
      openInCollection: false
    }]);
    expect(parsed.visibleContent).toBe(
      '我先把入口文件落下来。'
    );
  });

});

describe('parseAssistantReplyContent streaming phase', () => {
  it('keeps narration while executable tool fences are streaming', () => {
    const { visibleContent } = parseAssistantReplyContent(
      [
        '我先给你起一版。',
        '',
        '```polaris-tools',
        '{"actions":[{"kind":"patchRawCss","css":".bubble.user { color: #fff; }"}]}',
        '```'
      ].join('\n'),
      'medium',
      'stable',
      'streaming'
    );

    expect(visibleContent).toBe('我先给你起一版。');
  });

  it('keeps native code drafts visible during streaming', () => {
    const { visibleContent } = parseAssistantReplyContent(
      '',
      'medium',
      'stable',
      'streaming',
      [{
        id: 'call_1',
        name: 'createCodeCard',
        argumentsText: '{"code":"<section>\\n  <h1>Hello</h1>\\n</section>","language":"html","title":"Draft","tags":["房间"]}'
      }]
    );

    expect(visibleContent).toBe(
      '```html\n<section>\n  <h1>Hello</h1>\n</section>\n```'
    );
  });

  it('keeps unfinished project file drafts visible during streaming', () => {
    const { visibleContent } = parseAssistantReplyContent(
      [
        '```polaris-project-file {"projectId":"mini-phone","filePath":"index.html","language":"html"}',
        '<main>',
        '  <h1>Still writing</h1>'
      ].join('\n'),
      'medium',
      'stable',
      'streaming'
    );

    expect(visibleContent).toBe(
      '```html\n<main>\n  <h1>Still writing</h1>\n```'
    );
  });
});
