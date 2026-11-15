import { describe, expect, it } from 'vitest';
import {
  resolveAssistantToolActions,
  resolveNativeMcpToolActions,
  resolveNativeToolCardActions
} from './chatAssistantToolRuntime';
import { buildToolCardFunctionName } from '../../engines/toolCardRuntime';

describe('chatAssistantToolRuntime', () => {
  it('blocks parsed actions from disabled tool groups', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'webSearch', query: 'Polaris' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“联网”能力。']);
  });

  it('keeps enabled actions resolvable', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'webSearch', query: 'Polaris' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: true,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'webSearch',
        query: 'Polaris',
        maxResults: undefined,
        targetLabel: undefined
      }
    ]);
  });

  it('keeps long reference doc reads resolvable when the memory group is visible', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'readMemoryDoc', docId: 'doc-1', targetLabel: '长期资料' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: false,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: true,
        memoryRecall: false
      },
      availableToolNames: new Set(['readMemoryDoc'])
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'readMemoryDoc',
      docId: 'doc-1',
      targetLabel: '长期资料'
    }]);
  });

  it('passes memory search availability into active recall fallback actions', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'searchMemory', query: '恐龙', mode: 'auto', maxResults: 3 }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: false,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false,
        memoryRecall: true
      },
      availableToolNames: new Set(['searchMemory']),
      memorySearchAvailable: true
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'searchMemory',
      query: '恐龙',
      mode: 'auto',
      maxResults: 3,
      targetLabel: undefined
    }]);
  });

  it('blocks active recall fallback actions when old-memory search is unavailable', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'searchMemory', query: '恐龙' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: false,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false,
        memoryRecall: true
      },
      availableToolNames: new Set(['searchMemory']),
      memorySearchAvailable: false
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“主动回忆”能力。']);
  });

  it('keeps generated image actions resolvable when the image route is available', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'generateImage',
        prompt: '一张极简黑白二维码风格的便签',
        title: '二维码便签'
      }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      },
      availableToolNames: new Set(['generateImage']),
      imageGenerationAvailable: true
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'generateImage',
        prompt: '一张极简黑白二维码风格的便签',
        title: '二维码便签'
      }
    ]);
  });

  it('keeps existing image send actions resolvable without image generation', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'sendImageAttachment',
        target: 'https://example.com/poster.png',
        title: 'poster.png'
      }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: true,
        generation: false,
        archive: false,
        web: false,
        memory: false
      },
      availableToolNames: new Set(['sendImageAttachment'])
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'sendImageAttachment',
        target: 'https://example.com/poster.png',
        title: 'poster.png'
      }
    ]);
  });

  it('resolves listCodeCards without requiring an active card', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'listCodeCards' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'listCodeCards',
        targetLabel: undefined
      }
    ]);
  });

  it('resolves runCode actions instead of dropping them silently', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'runCode', code: 'return 1 + 2;' }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        generation: true,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'runCode',
        code: 'return 1 + 2;',
        targetLabel: undefined
      }
    ]);
  });

  it('blocks room actions while theme-only enforcement is active', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'createCodeCard', card: { code: 'body' } }],
      cards: [],
      activeCardId: null,
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      },
      toolEnforcementScope: 'theme-only'
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“卡片”能力。']);
  });

  it('blocks theme actions when theme tool mode hides them from the schema', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'applyThemeCoordinates', targets: 'all', hue: 180, hueCount: 3, emotion: 1, meaning: 2 }],
      cards: [],
      activeCardId: null,
      themeToolMode: 'off',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“换肤”能力。']);
  });

  it('blocks app theme actions inside a workspace conversation', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'patchRawCss', css: '.app-shell.chat { background: lavender; }' }],
      cards: [],
      activeCardId: null,
      activeProjectId: 'workspace-1',
      themeToolMode: 'creative',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual([
      '当前是工作区对话，界面换肤工具不会在这里执行。要写 CSS，请写入当前工作区的样式文件；要改 Polaris 外观，请离开工作区后再打开换肤工具。'
    ]);
  });

  it('blocks parsed fallback actions that were not visible in the current tool set', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'createCodeCard', card: { code: 'body' } }],
      cards: [],
      activeCardId: null,
      availableToolNames: new Set(['createProjectFile'])
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“卡片”能力。']);
  });

  it('blocks archive reads when only attachment tools are visible', () => {
    const result = resolveAssistantToolActions({
      actions: [{ kind: 'readArchiveEntryText', target: 'bundle.zip', entry: 'notes/todo.txt' }],
      cards: [],
      activeCardId: null,
      themeToolMode: 'stable',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: true,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual(['当前没有“压缩包”能力。']);
  });

  it('resolves patchCodeCard targets by card id before title matching', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'patchCodeCard',
          target: 'card-2',
          patch: {
            code: 'updated body'
          }
        }
      ],
      cards: [
        {
          id: 'card-1',
          title: '第一张卡',
          language: 'text',
          code: 'one',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          kind: 'card',
          source: 'chat-generated'
        },
        {
          id: 'card-2',
          title: '第二张卡',
          language: 'text',
          code: 'two',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      activeCardId: 'card-1',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'patchCodeCard',
        cardId: 'card-2',
        patch: {
          code: 'updated body'
        },
        targetLabel: '第二张卡',
        openInCollection: undefined
      }
    ]);
  });

  it('uses the renamed title as patchCodeCard target label when the patch renames the card', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'patchCodeCard',
          target: 'card-2',
          patch: {
            title: '阳台泡泡机',
            code: 'updated body'
          }
        }
      ],
      cards: [
        {
          id: 'card-2',
          title: 'html 片段',
          language: 'html',
          code: 'two',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      activeCardId: 'card-2',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'patchCodeCard',
        cardId: 'card-2',
        patch: {
          title: '阳台泡泡机',
          code: 'updated body'
        },
        targetLabel: '阳台泡泡机',
        openInCollection: undefined
      }
    ]);
  });

  it('resolves appendCodeCard to the active card without building a full patch', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendCodeCard',
          target: 'active',
          code: '\nconst next = true;'
        }
      ],
      cards: [
        {
          id: 'card-2',
          title: 'Mini Phone',
          language: 'html',
          code: '<main></main>',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      activeCardId: 'card-2',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'appendCodeCard',
        cardId: 'card-2',
        code: '\nconst next = true;',
        targetLabel: 'Mini Phone',
        openInCollection: true
      }
    ]);
  });

  it('rejects target=active for workspace files so models must name the filePath', () => {
    const projectFiles = [
      {
        id: 'file-style',
        projectId: 'mini-phone',
        filePath: 'styles/app.css',
        fileRole: 'style' as const,
        language: 'css',
        content: 'body {}',
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      },
      {
        id: 'file-entry',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry' as const,
        language: 'html',
        content: '<main></main>',
        createdAt: 2,
        updatedAt: 2,
        source: 'chat-generated' as const
      }
    ];

    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          target: 'active',
          code: '\n<section>lock</section>'
        },
        {
          kind: 'readProjectFile',
          target: 'active'
        }
      ],
      cards: [],
      projectFiles,
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区文件动作不再支持 target；请直接传当前工作区里的 filePath，例如 index.html 或 script.js。',
      '工作区文件动作不再支持 target；请直接传当前工作区里的 filePath，例如 index.html 或 script.js。'
    ]);
  });

  it('resolves active workspace files by filePath alone when already inside that workspace', () => {
    const projectFiles = [
      {
        id: 'file-entry',
        projectId: 'workspace-new-1',
        filePath: 'index.html',
        fileRole: 'entry' as const,
        language: 'html',
        content: '<main></main>',
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      },
      {
        id: 'file-style',
        projectId: 'workspace-new-1',
        filePath: 'styles/new-features.css',
        fileRole: 'style' as const,
        language: 'css',
        content: '.hero {}',
        createdAt: 2,
        updatedAt: 2,
        source: 'chat-generated' as const
      }
    ];

    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          filePath: 'styles/new-features.css'
        }
      ],
      cards: [],
      projectFiles,
      activeCardId: null,
      activeProjectId: 'workspace-new-1',
      projectScopes: [{
        id: 'workspace-new-1',
        title: '新工作区',
        slug: 'new-workspace'
      }],
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'readProjectFile',
        fileId: 'file-style',
        targetLabel: 'styles/new-features.css'
      }
    ]);
  });

  it('keeps workspace actions resolvable when the old project preference is false', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          filePath: 'index.html'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-entry',
          projectId: 'workspace-new-1',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main></main>',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'workspace-new-1',
      enabledToolGroups: {
        room: true,
        project: false,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'readProjectFile',
        fileId: 'file-entry',
        targetLabel: 'index.html'
      }
    ]);
  });

  it('does not guess the entry file when a workspace write omits both filePath and target', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          code: '\nbody { color: red; }'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-entry',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main></main>',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-style',
          projectId: 'mini-phone',
          filePath: 'style.css',
          fileRole: 'style' as const,
          language: 'css',
          content: 'body {}',
          createdAt: 2,
          updatedAt: 2,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区文件动作需要明确 filePath；入口文件也传 filePath="index.html"，不要用 target=active。'
    ]);
  });

  it('resolves explicit workspace file deletes inside the active project', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'deleteProjectFile',
          filePath: './style.css'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-style',
          projectId: 'mini-phone',
          filePath: 'style.css',
          fileRole: 'style' as const,
          language: 'css',
          content: 'body {}',
          createdAt: 2,
          updatedAt: 2,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'deleteProjectFile',
        fileId: 'file-style',
        targetLabel: 'style.css',
        openInCollection: false
      }
    ]);
  });

  it('rejects human-readable projectId aliases even when the project is visible', () => {
    const projectFiles = [
      {
        id: 'file-entry',
        projectId: 'workspace-new-1',
        filePath: 'index.html',
        fileRole: 'entry' as const,
        language: 'html',
        content: '<main></main>',
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }
    ];

    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          projectId: '新工作区',
          filePath: 'index.html'
        }
      ],
      cards: [],
      projectFiles,
      activeCardId: null,
      activeProjectId: 'workspace-new-1',
      projectScopes: [{
        id: 'workspace-new-1',
        title: '新工作区',
        slug: 'new-workspace'
      }],
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话已绑定工作区 workspace-new-1，不能写到 新工作区。需要切换工作区时，请由用户从目标工作区打开对话。'
    ]);
  });

  it('resolves project file actions by projectId and filePath', () => {
    const projectFiles = [
      {
        id: 'file-2',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry' as const,
        language: 'html',
        content: '<main></main>',
        createdAt: 2,
        updatedAt: 2,
        source: 'chat-generated' as const
      }
    ];

    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          projectId: 'mini-phone',
          filePath: './index.html',
          code: '\n<section>lock</section>'
        },
        {
          kind: 'editProjectFileText',
          projectId: 'mini-phone',
          filePath: 'index.html',
          oldString: '<main></main>',
          newString: '<main><section>lock</section></main>'
        },
        {
          kind: 'insertProjectFile',
          projectId: 'mini-phone',
          filePath: 'index.html',
          lineNumber: 1,
          linePosition: 'after',
          code: '\n<footer></footer>'
        },
        {
          kind: 'replaceProjectFileLines',
          projectId: 'mini-phone',
          filePath: 'index.html',
          startLine: 2,
          endLine: 3,
          code: '<section>line replacement</section>'
        }
      ],
      cards: [],
      projectFiles,
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'appendProjectFile',
        fileId: 'file-2',
        code: '\n<section>lock</section>',
        targetLabel: 'index.html',
        openInCollection: false
      },
      {
        kind: 'editProjectFileText',
        fileId: 'file-2',
        oldString: '<main></main>',
        newString: '<main><section>lock</section></main>',
        targetLabel: 'index.html',
        openInCollection: false
      },
      {
        kind: 'insertProjectFile',
        fileId: 'file-2',
        beforeString: undefined,
        afterString: undefined,
        lineNumber: 1,
        linePosition: 'after',
        code: '\n<footer></footer>',
        targetLabel: 'index.html',
        openInCollection: false
      },
      {
        kind: 'replaceProjectFileLines',
        fileId: 'file-2',
        startLine: 2,
        endLine: 3,
        code: '<section>line replacement</section>',
        targetLabel: 'index.html',
        openInCollection: false
      }
    ]);
  });

  it('resolves multi-file workspace writes inside the active project', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'writeProjectFiles',
          files: [
            {
              filePath: 'index.html',
              fileRole: 'entry',
              language: 'html',
              code: '<main></main>'
            },
            {
              filePath: 'styles/main.css',
              fileRole: 'style',
              language: 'css',
              code: 'body { margin: 0; }'
            }
          ]
        }
      ],
      cards: [],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'writeProjectFiles',
        projectId: 'mini-phone',
        targetLabel: undefined,
        openInCollection: false,
        files: [
          {
            projectId: 'mini-phone',
            filePath: 'index.html',
            fileRole: 'entry',
            language: 'html',
            code: '<main></main>',
            replaceContent: true
          },
          {
            projectId: 'mini-phone',
            filePath: 'styles/main.css',
            fileRole: 'style',
            language: 'css',
            code: 'body { margin: 0; }',
            replaceContent: true
          }
        ]
      }
    ]);
  });

  it('resolves workspace cover patches inside the active project', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'patchRoomProject',
          patch: {
            coverNote: '小屏幕里的柔光入口。',
            coverStyle: '& { background: #10131c; }'
          }
        }
      ],
      cards: [],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'patchRoomProject',
        projectId: 'mini-phone',
        patch: {
          coverNote: '小屏幕里的柔光入口。',
          coverStyle: '& { background: #10131c; }'
        },
        targetLabel: undefined,
        openInCollection: true
      }
    ]);
  });

  it('resolves project directory and preview checks inside the active project', () => {
    const result = resolveAssistantToolActions({
      actions: [
        { kind: 'listProjectFiles' },
        { kind: 'checkProjectPreview', targetLabel: 'Mini Phone' }
      ],
      cards: [],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'listProjectFiles',
        projectId: 'mini-phone',
        targetLabel: undefined
      },
      {
        kind: 'checkProjectPreview',
        projectId: 'mini-phone',
        targetLabel: 'Mini Phone'
      }
    ]);
  });

  it('blocks model-driven workspace promotion', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'promoteCardToProject',
          target: 'active',
          projectTitle: 'Mini Phone'
        }
      ],
      cards: [
        {
          id: 'card-2',
          title: 'Mini Phone',
          language: 'html',
          code: '<main></main>',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      activeCardId: 'card-2',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual(['工作区边界由用户决定。请让用户先新建、进入或切换工作区；模型不能直接创建、升格或切换工作区。']);
  });

  it('blocks project file actions when the conversation is not inside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          projectId: 'mini-phone',
          filePath: 'index.html',
          code: '\n<section>lock</section>'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-1',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          content: '<main></main>',
          createdAt: 3,
          updatedAt: 10,
          source: 'chat-generated'
        }
      ],
      activeCardId: null,
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('blocks multi-file workspace writes when the conversation is not inside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'writeProjectFiles',
          files: [{ filePath: 'index.html', code: '<main></main>' }]
        }
      ],
      cards: [],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('blocks project directory checks when the conversation is not inside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [
        { kind: 'listProjectFiles' },
        { kind: 'checkProjectPreview' }
      ],
      cards: [],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。',
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('does not fall back to legacy project-backed cards for project file actions', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          projectId: 'mini-phone',
          filePath: 'index.html',
          code: '\n<section>lock</section>'
        },
        {
          kind: 'editProjectFileText',
          projectId: 'mini-phone',
          filePath: 'index.html',
          oldString: '<main></main>',
          newString: '<main><section>lock</section></main>'
        },
        {
          kind: 'readProjectFile',
          projectId: 'mini-phone',
          filePath: 'index.html'
        }
      ],
      cards: [
        {
          id: 'card-legacy',
          title: 'Mini Phone index',
          language: 'html',
          code: '<main></main>',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card' as const,
          source: 'chat-generated' as const
        }
      ],
      projectFiles: [
        {
          id: 'file-1',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          content: '<main></main>',
          createdAt: 3,
          updatedAt: 10,
          source: 'chat-generated'
        }
      ],
      activeCardId: null,
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'appendProjectFile',
        fileId: 'file-1',
        code: '\n<section>lock</section>',
        targetLabel: 'index.html',
        openInCollection: false
      },
      {
        kind: 'editProjectFileText',
        fileId: 'file-1',
        oldString: '<main></main>',
        newString: '<main><section>lock</section></main>',
        targetLabel: 'index.html',
        openInCollection: false
      },
      {
        kind: 'readProjectFile',
        fileId: 'file-1',
        targetLabel: 'index.html'
      }
    ]);
  });

  it('rejects project file edits when duplicate paths make the filePath ambiguous', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'appendProjectFile',
          projectId: 'white-cat-box',
          filePath: 'script.js',
          code: '\nconsole.log("next");'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-old',
          projectId: 'white-cat-box',
          filePath: 'script.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'console.log("old");',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-new',
          projectId: 'white-cat-box',
          filePath: 'script.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'console.log("active");',
          createdAt: 2,
          updatedAt: 10,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'white-cat-box',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区 white-cat-box 里有 2 个 script.js，不能猜要写哪一个。请先整理重复文件后再继续。'
    ]);
  });

  it('rejects free-text workspace file targets even inside the active workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          target: 'index.html'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-workspace-2',
          projectId: 'workspace-2',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>two</main>',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-workspace-3',
          projectId: 'workspace-3',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>three</main>',
          createdAt: 2,
          updatedAt: 2,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'workspace-3',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区文件动作不再支持 target；请直接传当前工作区里的 filePath，例如 index.html 或 script.js。'
    ]);
  });

  it('rejects free-text workspace file targets when the conversation lost its workspace binding', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          target: 'index.html'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-workspace-2',
          projectId: 'workspace-2',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>two</main>',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-workspace-3',
          projectId: 'workspace-3',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>three</main>',
          createdAt: 2,
          updatedAt: 2,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('does not fall back to standalone cards when the conversation is already inside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readProjectFile',
          target: 'index.html'
        }
      ],
      cards: [
        {
          id: 'card-1',
          title: 'index.html',
          language: 'html',
          code: '<main>legacy</main>',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      projectFiles: [],
      activeCardId: null,
      activeProjectId: 'workspace-3',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区文件动作不再支持 target；请直接传当前工作区里的 filePath，例如 index.html 或 script.js。'
    ]);
  });

  it('rejects text edits when duplicate project file paths exist', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'editProjectFileText',
          projectId: 'white-cat-box',
          filePath: './script.js',
          oldString: 'console.log("new");',
          newString: 'console.log("latest");'
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-old',
          projectId: 'white-cat-box',
          filePath: 'script.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'console.log("old");',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-new',
          projectId: 'white-cat-box',
          filePath: 'script.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'console.log("new");',
          createdAt: 2,
          updatedAt: 10,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'white-cat-box',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区 white-cat-box 里有 2 个 script.js，不能猜要写哪一个。请先整理重复文件后再继续。'
    ]);
  });

  it('rejects createProjectFile when duplicate existing paths make overwrite ambiguous', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'createProjectFile',
          file: {
            projectId: 'white-cat-box',
            filePath: 'index.html',
            code: '<main>next</main>'
          }
        }
      ],
      cards: [],
      projectFiles: [
        {
          id: 'file-old',
          projectId: 'white-cat-box',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>old</main>',
          createdAt: 1,
          updatedAt: 1,
          source: 'chat-generated' as const
        },
        {
          id: 'file-new',
          projectId: 'white-cat-box',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main>new</main>',
          createdAt: 2,
          updatedAt: 10,
          source: 'chat-generated' as const
        }
      ],
      activeCardId: null,
      activeProjectId: 'white-cat-box',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '工作区 white-cat-box 里有 2 个 index.html，不能猜要写哪一个。请先整理重复文件后再继续。'
    ]);
  });

  it('does not fall back to the active card when appendProjectFile is used outside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'appendProjectFile',
        target: 'active',
        code: '\nnext'
      }],
      cards: [{
        id: 'card-2',
        title: 'Mini Phone',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      activeCardId: 'card-2',
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('does not fall back to the active card when editProjectFileText is used outside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'editProjectFileText',
        target: 'active',
        oldString: '<main></main>',
        newString: '<main><section>next</section></main>'
      }],
      cards: [{
        id: 'card-2',
        title: 'Mini Phone',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      activeCardId: 'card-2',
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('does not fall back to the active card when insertProjectFile is used outside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'insertProjectFile',
        target: 'active',
        beforeString: '</main>',
        code: '\n<section>next</section>'
      }],
      cards: [{
        id: 'card-2',
        title: 'Mini Phone',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      activeCardId: 'card-2',
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('does not fall back to the active card when readProjectFile is used outside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'readProjectFile',
        target: 'active'
      }],
      cards: [{
        id: 'card-2',
        title: 'Mini Phone',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      activeCardId: 'card-2',
      activeProjectId: null,
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toEqual([]);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('reports the real workspace boundary instead of a removed project toolbox toggle', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'appendProjectFile',
        target: 'active',
        code: '\nnext'
      }],
      cards: [{
        id: 'card-2',
        title: 'Mini Phone',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      activeCardId: 'card-2',
      enabledToolGroups: {
        room: true,
        project: false,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.resolved).toHaveLength(0);
    expect(result.errors).toEqual([
      '这条对话还没有绑定工作区。工作区必须先由用户打开；模型不能在普通对话里创建或切换工作区。'
    ]);
  });

  it('keeps room tools inside the room even when the conversation is already inside a workspace', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'appendCodeCard',
        target: 'active',
        code: '\n<div>note</div>'
      }],
      cards: [{
        id: 'card-room-1',
        title: 'Loose card',
        language: 'html',
        code: '<main></main>',
        tags: [],
        createdAt: 2,
        updatedAt: 2,
        kind: 'card',
        source: 'chat-generated'
      }],
      projectFiles: [{
        id: 'file-entry',
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html',
        content: '<main>workspace</main>',
        createdAt: 3,
        updatedAt: 3,
        source: 'chat-generated'
      }],
      activeCardId: 'card-room-1',
      activeProjectId: 'mini-phone',
      enabledToolGroups: {
        room: true,
        project: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'appendCodeCard',
      cardId: 'card-room-1',
      code: '\n<div>note</div>',
      targetLabel: 'Loose card',
      openInCollection: true
    }]);
  });

  it('resolves readCodeCard targets by id into a direct read action', () => {
    const result = resolveAssistantToolActions({
      actions: [
        {
          kind: 'readCodeCard',
          target: 'card-2'
        }
      ],
      cards: [
        {
          id: 'card-1',
          title: '第一张卡',
          language: 'text',
          code: 'one',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          kind: 'card',
          source: 'chat-generated'
        },
        {
          id: 'card-2',
          title: '第二张卡',
          language: 'text',
          code: 'two',
          tags: [],
          createdAt: 2,
          updatedAt: 2,
          kind: 'card',
          source: 'chat-generated'
        }
      ],
      activeCardId: 'card-1',
      enabledToolGroups: {
        room: true,
        theme: true,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([
      {
        kind: 'readCodeCard',
        cardId: 'card-2',
        targetLabel: '第二张卡'
      }
    ]);
  });

  it('resolves native tool calls for runnable tool cards', () => {
    const card = {
      id: 'card-9',
      title: 'Format Notes',
      language: 'javascript',
      code: 'return window.PolarisTool.input;',
      tags: ['工具'],
      createdAt: 1,
      updatedAt: 1,
      kind: 'tool' as const,
      source: 'manual' as const
    };
    const result = resolveNativeToolCardActions({
      toolCalls: [{
        id: 'call-1',
        name: buildToolCardFunctionName(card),
        argumentsText: '{"input":"整理成三条","args":{"tone":"clean"}}'
      }],
      cards: [card],
      enabledToolGroups: {
        room: true,
        theme: false,
        attachment: false,
        archive: false,
        web: false,
        memory: false
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'invokeCodeCardTool',
      cardId: 'card-9',
      toolName: buildToolCardFunctionName(card),
      input: '整理成三条',
      args: {
        tone: 'clean'
      },
      targetLabel: 'Format Notes'
    }]);
  });

  it('ignores native tool card calls that were not visible in the current tool set', () => {
    const card = {
      id: 'card-10',
      title: 'Hidden Tool',
      language: 'javascript',
      code: 'return window.PolarisTool.input;',
      tags: ['工具'],
      createdAt: 1,
      updatedAt: 1,
      kind: 'tool' as const,
      source: 'manual' as const
    };

    const result = resolveNativeToolCardActions({
      toolCalls: [{
        id: 'call-hidden-card',
        name: buildToolCardFunctionName(card),
        argumentsText: '{"input":"run"}'
      }],
      cards: [card],
      availableToolNames: new Set()
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });

  it('keeps nested arguments intact for native MCP tool calls', () => {
    const result = resolveNativeMcpToolActions({
      toolCalls: [{
        id: 'call-2',
        name: 'mcp__aisay__cli',
        argumentsText: '{"command":"help","args":{"path":"account"}}'
      }],
      mcpTools: [{
        schemaName: 'mcp__aisay__cli',
        serverId: 'server-1',
        serverName: 'AISay',
        serverHandle: 'aisay',
        transport: 'streamable-http',
        url: 'https://aisay.top/chatroom/mcp',
        toolName: 'cli',
        description: 'AISay CLI',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string'
            },
            args: {
              type: 'object'
            }
          },
          required: ['command']
        }
      }]
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'invokeMcpTool',
      serverId: 'server-1',
      serverName: 'AISay',
      schemaName: 'mcp__aisay__cli',
      toolName: 'cli',
      argumentsObject: {
        command: 'help',
        args: {
          path: 'account'
        }
      },
      targetLabel: 'AISay / cli'
    }]);
  });

  it('ignores native MCP tool calls that were not visible in the current tool set', () => {
    const result = resolveNativeMcpToolActions({
      toolCalls: [{
        id: 'call-hidden-mcp',
        name: 'mcp__weather__get_weather',
        argumentsText: '{"city":"Shanghai"}'
      }],
      mcpTools: [{
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      }],
      availableToolNames: new Set()
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });

  it('resolves parsed dynamic MCP tool actions only when the schema is visible', () => {
    const result = resolveAssistantToolActions({
      actions: [{
        kind: 'invokeMcpTool',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        schemaName: 'mcp__weather__get_weather',
        toolName: 'get_weather',
        argumentsObject: {
          city: 'Shanghai'
        },
        targetLabel: 'Weather MCP / get_weather'
      }],
      cards: [],
      activeCardId: null,
      availableToolNames: new Set(['mcp__weather__get_weather'])
    });

    expect(result.errors).toHaveLength(0);
    expect(result.resolved).toEqual([{
      kind: 'invokeMcpTool',
      serverId: 'server-1',
      serverName: 'Weather MCP',
      schemaName: 'mcp__weather__get_weather',
      toolName: 'get_weather',
      argumentsObject: {
        city: 'Shanghai'
      },
      targetLabel: 'Weather MCP / get_weather'
    }]);
  });
});
