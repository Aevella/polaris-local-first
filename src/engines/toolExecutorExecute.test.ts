import { describe, expect, it, vi } from 'vitest';
import { executeToolAction } from './toolExecutorExecute';
import type { ToolContext } from './toolExecutorTypes';
import type { ArchiveEntryRef } from './attachmentArchiveTools';
import type { ToolAttachmentRef } from './attachmentToolEntries';
import type { ChatAttachment, RoomProject } from '../types/domain';

function createAttachmentRef(overrides: Partial<ToolAttachmentRef> = {}): ToolAttachmentRef {
  return {
    id: 'file-1',
    kind: 'file',
    name: 'note.txt',
    mimeType: 'text/plain',
    size: 4,
    hasText: true,
    sourceLabel: '用户消息',
    ...overrides
  };
}

function createChatAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: 'attachment-1',
    assetId: 'asset-1',
    kind: 'file',
    name: 'file.txt',
    mimeType: 'text/plain',
    size: 4,
    ...overrides
  };
}

function createArchiveEntryRef(overrides: Partial<ArchiveEntryRef> = {}): ArchiveEntryRef {
  return {
    path: 'src/index.ts',
    size: 5,
    hasText: true,
    ...overrides
  };
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    applyThemePatch: vi.fn(),
    applyThemePreset: vi.fn(),
    setWorld: vi.fn(),
    setCollectionShelf: vi.fn(),
    createRoomProject: vi.fn(() => 'proj-1'),
    readRoomProject: vi.fn(() => null),
    patchRoomProject: vi.fn(() => true),
    listCodeCards: vi.fn(() => []),
    listProjectFiles: vi.fn(() => []),
    createCodeCard: vi.fn(() => 'card-1'),
    createProjectFile: vi.fn(() => 'file-1'),
    promoteCardToProject: vi.fn(() => ({ projectId: 'proj-1', fileId: 'file-1' })),
    patchCodeCard: vi.fn(() => true),
    patchProjectFile: vi.fn(() => true),
    deleteProjectFile: vi.fn(() => true),
    selectCodeCard: vi.fn(),
    spotlightCodeCard: vi.fn(),
    readCodeCard: vi.fn(() => null),
    readProjectFile: vi.fn(() => null),
    appendCollaboratorMemories: vi.fn(() => true),
    writeCollaboratorMemoryDoc: vi.fn(() => ({ ok: true as const, docId: 'memory-doc-1', title: '关系边界', created: true })),
    readCollaboratorMemoryDoc: vi.fn(async () => null),
    readPolarisKnowledge: vi.fn(() => ({ ok: true as const, summary: '已读取 Polaris 产品知识全文', detailText: '# Polaris 产品知识' })),
    createProactiveMessageRule: vi.fn(() => ({
      ok: true as const,
      summary: '已创建主动消息规则 · 早安',
      detailText: 'ruleId=trigger-1',
      triggerRuleId: 'trigger-1'
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
    inspectAttachments: vi.fn(() => ({ ok: true as const, items: [], detailText: 'empty' })),
	    webSearch: vi.fn(async () => ({
	      ok: true as const,
	      query: 'demo',
	      provider: 'mock',
	      results: [],
	      webSearch: {
	        query: 'demo',
	        provider: 'mock',
	        results: []
	      },
	      detailText: 'empty'
    })),
    readWebPage: vi.fn(async () => ({
      ok: true as const,
      url: 'https://example.com',
      title: 'Example',
	      text: 'page',
	      provider: 'mock',
	      truncated: false,
	      originalLength: 4,
	      webPageRead: {
	        url: 'https://example.com',
	        title: 'Example',
	        provider: 'mock',
	        excerpt: 'page'
	      },
	      detailText: 'page'
	    })),
    readCalendarEvents: vi.fn(async () => ({
      ok: true as const,
      summary: '已读取系统日历 · 0 条',
      detailText: '这个时间段里没有读到匹配的日历事件。',
      events: []
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
    createCalendarEvent: vi.fn(async () => ({
      ok: true as const,
      summary: '已创建系统日历事件 · 看牙',
      detailText: '1. 看牙',
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
      detailText: '1. 看牙',
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
      detailText: '1. 看牙',
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
    inspectArchiveEntries: vi.fn(async () => ({
      ok: true as const,
      attachment: createAttachmentRef({
        id: 'archive-1',
        name: 'archive.zip',
        mimeType: 'application/zip',
        size: 10,
        hasText: false
      }),
      entries: [],
      detailText: 'entries'
    })),
    readAttachmentText: vi.fn(() => ({
      ok: true as const,
      attachment: createAttachmentRef(),
      detailText: 'text'
    })),
    readArchiveEntryText: vi.fn(async () => ({
      ok: true as const,
      attachment: createAttachmentRef({
        id: 'archive-1',
        name: 'archive.zip',
        mimeType: 'application/zip',
        size: 10,
        hasText: false
      }),
      entry: createArchiveEntryRef(),
      text: 'hello',
      inferredLanguage: 'typescript',
      detailText: 'entry'
    })),
    bundleArchiveEntries: vi.fn(async () => ({
      ok: true as const,
      sourceAttachment: createAttachmentRef({
        id: 'archive-1',
        name: 'archive.zip',
        mimeType: 'application/zip',
        size: 10,
        hasText: false
      }),
      attachment: createChatAttachment({
        id: 'bundled-1',
        assetId: 'asset-bundled-1',
        kind: 'file',
        name: 'picked.zip',
        mimeType: 'application/zip',
        size: 10
      }),
      entries: [],
      detailText: 'bundle'
    })),
    bundleAttachments: vi.fn(async () => ({
      ok: true as const,
      attachment: createChatAttachment({
        id: 'bundled-2',
        assetId: 'asset-bundled-2',
        kind: 'file',
        name: 'attachments.zip',
        mimeType: 'application/zip',
        size: 10
      }),
      itemCount: 1,
      detailText: 'bundle'
    })),
    createQrCode: vi.fn(async () => ({
      ok: true as const,
      attachment: createChatAttachment({
        id: 'qr-1',
        assetId: 'asset-qr-1',
        kind: 'image',
        name: 'qr.png',
        mimeType: 'image/png',
        size: 10
      }),
      detailText: 'qr'
    })),
    generateImage: vi.fn(async () => ({
      ok: true as const,
      attachment: createChatAttachment({
        id: 'generated-image-1',
        assetId: 'asset-generated-image-1',
        kind: 'image',
        name: 'generated.png',
        mimeType: 'image/png',
        size: 10
      }),
      model: 'gpt-image-1',
      size: '1024x1024',
      detailText: 'generated image'
    })),
    sendImageAttachment: vi.fn(async () => ({
      ok: true as const,
      attachment: createChatAttachment({
        id: 'sent-image-1',
        assetId: 'asset-sent-image-1',
        kind: 'image',
        name: 'sent.png',
        mimeType: 'image/png',
        size: 10
      }),
      detailText: 'sent image'
    })),
    inspectImageAsset: vi.fn(async () => ({
      ok: true as const,
      assetId: 'asset-image-1',
      name: 'poster.png',
      mimeType: 'image/png',
      width: 1200,
      height: 800,
      aspectRatio: 1.5,
      hasTransparency: false,
      averageColor: '#334455',
      averageLuminance: 0.12,
      suggestedTextColor: '#f8fafc' as const,
      palette: [{ hex: '#334455', count: 1, ratio: 1, luminance: 0.12 }],
      cssUrl: 'url("polaris-asset://asset-image-1")',
      detailText: 'image'
    })),
    extractImagePalette: vi.fn(async () => ({
      ok: true as const,
      assetId: 'asset-image-1',
      name: 'poster.png',
      cssUrl: 'url("polaris-asset://asset-image-1")',
      averageColor: '#334455',
      suggestedTextColor: '#f8fafc' as const,
      palette: [{ hex: '#334455', count: 1, ratio: 1, luminance: 0.12 }],
      themeVariables: {
        background: '#334455',
        surface: '#334455',
        accent: '#334455',
        text: '#f8fafc' as const
      },
      detailText: 'palette'
    })),
    createImageVariant: vi.fn(async () => ({
      ok: true as const,
      attachment: createChatAttachment({
        id: 'variant-1',
        assetId: 'asset-variant-1',
        kind: 'image',
        name: 'poster-background.jpg',
        mimeType: 'image/jpeg',
        size: 10
      }),
      sourceAttachment: createChatAttachment({
        id: 'source-1',
        assetId: 'asset-image-1',
        kind: 'image',
        name: 'poster.png',
        mimeType: 'image/png',
        size: 10
      }),
      cssUrl: 'url("polaris-asset://asset-variant-1")',
      width: 1080,
      height: 1920,
      purpose: 'background' as const,
      detailText: 'variant'
    })),
    saveAttachmentToCollection: vi.fn(() => ({ ok: true as const, cardId: 'image-1', created: true, title: 'Poster' })),
    saveAttachmentAsCodeCard: vi.fn(() => ({ ok: true as const, cardId: 'code-1', created: true, title: 'Snippet' })),
    saveArchiveEntryAsCodeCard: vi.fn(async () => ({ ok: true as const, cardId: 'code-1', created: true, title: 'Entry' })),
    runCode: vi.fn(async () => ({ ok: true as const, returnValue: '42', logs: [] })),
    invokeMcpTool: vi.fn(async () => ({ ok: true as const, detailText: 'mcp ok' })),
    readCodeCardState: vi.fn(async () => ({})),
    writeCodeCardState: vi.fn(),
    ...overrides
  };
}

describe('executeToolAction', () => {
  it('creates room projects before files when createRoomProject succeeds', async () => {
    const ctx = createToolContext();

    const result = await executeToolAction({
      kind: 'createRoomProject',
      project: {
        projectId: 'landing-refresh',
        title: 'Landing Refresh',
        tags: ['首页']
      },
      openInCollection: true
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      roomProjectId: 'proj-1',
      summary: '已创建工作区 · Landing Refresh',
      projectFileReads: [
        expect.objectContaining({
          kind: 'directory',
          projectId: 'proj-1',
          totalFiles: 0
        })
      ]
    });
    expect(ctx.createRoomProject).toHaveBeenCalledWith({
      id: 'landing-refresh',
      title: 'Landing Refresh',
      slug: undefined,
      tags: ['首页'],
      coverNote: undefined,
      coverStyle: undefined,
      source: 'chat-generated'
    });
  });

  it('creates project file shells with empty code allowed', async () => {
    const ctx = createToolContext();

    const result = await executeToolAction({
      kind: 'createProjectFile',
      file: {
        projectId: 'mini-phone',
        filePath: 'index.html',
        fileRole: 'entry',
        language: 'html'
      },
      openInCollection: true
    }, ctx);

    expect(result).toEqual({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      summary: '已创建工作区文件 · index.html'
    });
    expect(ctx.createProjectFile).toHaveBeenCalledWith({
      projectId: 'mini-phone',
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      code: ''
    });
    expect(ctx.setCollectionShelf).toHaveBeenCalledWith('project');
    expect(ctx.selectCodeCard).not.toHaveBeenCalled();
  });

  it('patches room project cover metadata without touching files', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn((): RoomProject => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        tags: [],
        fileIds: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }))
    });

    const result = await executeToolAction({
      kind: 'patchRoomProject',
      projectId: 'mini-phone',
      patch: {
        coverNote: '小屏幕里的柔光入口。',
        coverStyle: '& { background: #10131c; }'
      },
      openInCollection: true
    }, ctx);

    expect(result).toEqual({
      ok: true,
      roomProjectId: 'mini-phone',
      summary: '已更新工作区封面 · Mini Phone'
    });
    expect(ctx.patchRoomProject).toHaveBeenCalledWith('mini-phone', {
      coverNote: '小屏幕里的柔光入口。',
      coverStyle: '& { background: #10131c; }'
    });
    expect(ctx.createProjectFile).not.toHaveBeenCalled();
    expect(ctx.setCollectionShelf).toHaveBeenCalledWith('project');
  });

  it('writes multiple project files in one workspace action', async () => {
    const ctx = createToolContext({
      createProjectFile: vi.fn((file) => `${file.projectId}:${file.filePath}`)
    });

    const result = await executeToolAction({
      kind: 'writeProjectFiles',
      projectId: 'mini-phone',
      targetLabel: 'Mini Phone',
      files: [
        {
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry',
          language: 'html',
          code: '<link rel="stylesheet" href="styles/main.css">'
        },
        {
          projectId: 'mini-phone',
          filePath: 'styles/main.css',
          fileRole: 'style',
          language: 'css',
          code: 'body { margin: 0; }'
        }
      ],
      openInCollection: true
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'mini-phone:index.html',
      projectFileIds: ['mini-phone:index.html', 'mini-phone:styles/main.css'],
      projectFilePaths: ['index.html', 'styles/main.css'],
      summary: '已写入 2 个工作区文件',
      detailText: [
        'index.html · 覆盖',
        'styles/main.css · 覆盖'
      ].join('\n'),
      projectFileEffects: [],
      projectFiles: []
    });
    expect(ctx.createProjectFile).toHaveBeenNthCalledWith(1, {
      projectId: 'mini-phone',
      filePath: 'index.html',
      fileRole: 'entry',
      language: 'html',
      code: '<link rel="stylesheet" href="styles/main.css">',
      replaceContent: true
    });
    expect(ctx.createProjectFile).toHaveBeenNthCalledWith(2, {
      projectId: 'mini-phone',
      filePath: 'styles/main.css',
      fileRole: 'style',
      language: 'css',
      code: 'body { margin: 0; }',
      replaceContent: true
    });
    expect(ctx.setCollectionShelf).toHaveBeenCalledWith('project');
  });

  it('lists project files without reading every file body', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html', 'file-css'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<main></main>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'file-css',
          projectId: 'mini-phone',
          filePath: 'styles/main.css',
          fileRole: 'style' as const,
          language: 'css',
          content: 'body { margin: 0; }',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'listProjectFiles',
      projectId: 'mini-phone'
    }, ctx);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      summary: '已列出工作区文件 · Mini Phone',
      roomProjectId: 'mini-phone'
    });
    expect(result.ok ? result.detailText : '').toContain('入口 · index.html · html · role=entry');
    expect(result.ok ? result.detailText : '').toContain('文件 · styles/main.css · css · role=style');
  });

  it('searches project files and returns matched lines with paths', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html', 'file-js'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<button id="save">Save</button>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'file-js',
          projectId: 'mini-phone',
          filePath: 'scripts/app.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'function saveState() {}\nbutton.addEventListener("click", saveState);',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'searchProjectFiles',
      projectId: 'mini-phone',
      query: 'saveState',
      maxResults: 5
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      summary: '已搜索工作区 · 2 处命中',
      roomProjectId: 'mini-phone'
    });
    expect(result.ok ? result.detailText : '').toContain('scripts/app.js:1 · function saveState() {}');
    expect(result.ok ? result.detailText : '').toContain('scripts/app.js:2 · button.addEventListener("click", saveState);');
    expect(result.ok ? result.detailText : '').toContain('匹配：精确匹配');
    expect(result.ok ? result.detailText : '').toContain('范围：1-2');
  });

  it('checks project preview entry and local asset references', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html', 'file-css'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<!doctype html><link rel="stylesheet" href="./styles/main.css"><script src="./scripts/app.js"></script>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'file-css',
          projectId: 'mini-phone',
          filePath: 'styles/main.css',
          fileRole: 'style' as const,
          language: 'css',
          content: 'body { margin: 0; }',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'checkProjectPreview',
      projectId: 'mini-phone'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      summary: '预览检查通过 · index.html',
      roomProjectId: 'mini-phone',
      projectFileId: 'file-html',
      projectPreviewRunnable: true
    });
    expect(result.ok ? result.detailText : '').toContain('状态：可预览');
    expect(result.ok ? result.detailText : '').toContain('已找到本地资源：styles/main.css');
    expect(result.ok ? result.detailText : '').toContain('缺失本地资源：./scripts/app.js');
  });

  it('reports structural script diagnostics during project preview checks', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html', 'file-js'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<!doctype html><script src="./scripts/app.js"></script>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'file-js',
          projectId: 'mini-phone',
          filePath: 'scripts/app.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: [
            'function boot() {}',
            'function boot() {}',
            'document.addEventListener("DOMContentLoaded", () => {});',
            'document.addEventListener("DOMContentLoaded", () => {});'
          ].join('\n'),
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'checkProjectPreview',
      projectId: 'mini-phone'
    }, ctx);

    expect(result.ok ? result.detailText : '').toContain('已找到本地资源：scripts/app.js');
    expect(result.ok ? result.detailText : '').toContain('scripts/app.js:1 · 重复声明 boot，可能会覆盖前一个定义。');
    expect(result.ok ? result.detailText : '').toContain('发现 2 处 DOMContentLoaded 监听');
  });

  it('marks project previews with script syntax errors as not runnable evidence', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html', 'file-js'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<!doctype html><script src="./scripts/app.js"></script>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'file-js',
          projectId: 'mini-phone',
          filePath: 'scripts/app.js',
          fileRole: 'logic' as const,
          language: 'javascript',
          content: 'const scenes = {\n  intro: { text: "hello" }',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'checkProjectPreview',
      projectId: 'mini-phone'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectPreviewRunnable: false
    });
    expect(result.ok ? result.summary : '').toContain('脚本语法错误 1 条 · scripts/app.js:1');
    expect(result.ok ? result.detailText : '').toContain('错误 · scripts/app.js:1');
    expect(result.ok ? result.detailText : '').toContain('> 1: const scenes = {');
    expect(result.ok ? result.projectDiagnostics?.[0]?.reason : '').toBe('syntax-error');
    expect(result.ok ? result.projectDiagnostics?.[0]?.firstErrorFilePath : '').toBe('scripts/app.js');
  });

  it('returns an unavailable runtime inspection result outside the browser runtime', async () => {
    const ctx = createToolContext({
      readRoomProject: vi.fn(() => ({
        id: 'mini-phone',
        title: 'Mini Phone',
        slug: 'mini-phone',
        fileIds: ['file-html'],
        tags: [],
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      })),
      listProjectFiles: vi.fn(() => [
        {
          id: 'file-html',
          projectId: 'mini-phone',
          filePath: 'index.html',
          fileRole: 'entry' as const,
          language: 'html',
          content: '<!doctype html><main>ready</main>',
          source: 'chat-generated' as const,
          createdAt: 1,
          updatedAt: 1
        }
      ])
    });

    const result = await executeToolAction({
      kind: 'inspectProjectRuntime',
      projectId: 'mini-phone',
      settleMs: 50
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      roomProjectId: 'mini-phone',
      projectFileId: 'file-html',
      projectPreviewRunnable: false
    });
    expect(result.ok ? result.detailText : '').toContain('状态：当前环境不可运行');
    expect(result.ok ? result.detailText : '').toContain('运行预览检查只能在浏览器环境中执行。');
  });

  it('promotes a standalone card into a workspace and opens the workspace shelf', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Mini Phone',
        language: 'html',
        code: '<main />',
        tags: ['demo'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'promoteCardToProject',
      cardId: 'card-1',
      projectTitle: 'Mini Phone',
      targetLabel: 'Mini Phone',
      openInCollection: true
    }, ctx);

    expect(result).toEqual({
      ok: true,
      roomProjectId: 'proj-1',
      projectFileId: 'file-1'
    });
    expect(ctx.promoteCardToProject).toHaveBeenCalledWith({
      cardId: 'card-1',
      projectTitle: 'Mini Phone',
      filePath: undefined,
      fileRole: undefined
    });
    expect(ctx.setCollectionShelf).toHaveBeenCalledWith('project');
  });

  it('refuses to promote tool cards into workspaces', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Formatter',
        language: 'javascript',
        code: 'return input;',
        tags: ['tool'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'tool' as const,
        source: 'manual' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'promoteCardToProject',
      cardId: 'card-1',
      openInCollection: true
    }, ctx);

    expect(result).toEqual({
      ok: false,
      error: '工具卡不能直接升为工作区。请先另存为普通房间卡，或新建工作区后把内容放进去。'
    });
    expect(ctx.promoteCardToProject).not.toHaveBeenCalled();
  });

  it('returns a failed tool result when runCode errors', async () => {
    const ctx = createToolContext({
      runCode: vi.fn(async () => ({
        ok: false as const,
        error: 'Boom',
        stack: 'Error: Boom',
        logs: [{ level: 'error' as const, args: ['bad'] }]
      }))
    });

    const result = await executeToolAction({ kind: 'runCode', code: 'throw new Error("Boom")' }, ctx);

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: 'Boom\nError: Boom\n--- console ---\n[error] bad'
    });
  });

  it('returns full card content when readCodeCard succeeds', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Landing Hero',
        language: 'tsx',
        code: 'export function Hero() { return <section>hello</section>; }',
        tags: ['首页', 'hero'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({ kind: 'readCodeCard', cardId: 'card-1', targetLabel: 'Landing Hero' }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取房间 · Landing Hero',
      detailText: [
        '房间：Landing Hero',
        '语言：tsx',
        '标签：首页、hero',
        'export function Hero() { return <section>hello</section>; }'
      ].join('\n'),
      cardId: 'card-1'
    });
  });

  it('returns a directory when listCodeCards succeeds', async () => {
    const ctx = createToolContext({
      listCodeCards: vi.fn(() => [
        {
          id: 'card-1',
          title: 'Landing Hero',
          language: 'tsx',
          code: 'export function Hero() {}',
          tags: ['首页', 'hero'],
          createdAt: 1,
          updatedAt: 2,
          kind: 'card' as const,
          source: 'chat-generated' as const
        },
        {
          id: 'card-2',
          title: 'Footer',
          language: 'html',
          code: '<footer />',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          kind: 'card' as const,
          source: 'chat-generated' as const
        }
      ])
    });

    const result = await executeToolAction({ kind: 'listCodeCards' }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取房间卡目录 · 2 张',
      detailText: [
        '房间卡目录：2 张',
        '1. Landing Hero（tsx） id=card-1',
        '   标签：首页、hero',
        '   更新：1970-01-01T00:00:00.002Z',
        '2. Footer（html） id=card-2',
        '   更新：1970-01-01T00:00:00.001Z'
      ].join('\n')
    });
  });

  it('returns full project file content when readProjectFile targets a project file', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<main>hello</main>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({ kind: 'readProjectFile', fileId: 'file-1', targetLabel: 'index.html' }, ctx);

    expect(result).toMatchObject({
      ok: true,
      summary: '已读取工作区文件 · index.html',
      detailText: [
        '文件：index.html',
        '语言：html',
        '工作区：mini-phone',
        '角色：entry',
        '<main>hello</main>'
      ].join('\n'),
      projectFileId: 'file-1',
      projectFiles: [
        expect.objectContaining({
          filePath: 'index.html',
          totalLines: 1,
          totalChars: 18
        })
      ],
      projectFileReads: [
        expect.objectContaining({
          kind: 'file',
          projectId: 'mini-phone'
        })
      ]
    });
  });

  it('returns line-numbered context around a project file query', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'scripts/app.js',
        fileRole: 'logic' as const,
        language: 'javascript',
        content: [
          'const root = document.querySelector("#app");',
          'function render() {',
          '  root.textContent = "ready";',
          '}',
          'render();'
        ].join('\n'),
        source: 'chat-generated' as const,
        createdAt: 1,
        updatedAt: 1
      }))
    });

    const result = await executeToolAction({
      kind: 'readProjectFileContext',
      fileId: 'file-1',
      query: 'root.textContent',
      before: 1,
      after: 1
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      summary: '已读取上下文 · scripts/app.js:3',
      projectFileId: 'file-1'
    });
    expect(result.ok ? result.detailText : '').toContain('范围：2-4');
    expect(result.ok ? result.detailText : '').toContain('3:   root.textContent = "ready";');
  });

  it('appends code card chunks without requiring the assistant to resend the full file', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Mini Phone',
        language: 'html',
        code: '<main>',
        tags: ['项目'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'appendCodeCard',
      cardId: 'card-1',
      code: '\n<section>lock screen</section>',
      targetLabel: 'Mini Phone'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      cardId: 'card-1'
    });
    expect(ctx.patchCodeCard).toHaveBeenCalledWith('card-1', {
      code: '<main>\n<section>lock screen</section>'
    });
    expect(ctx.selectCodeCard).toHaveBeenCalledWith('card-1');
  });

  it('appends project file chunks without routing through code cards', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<main>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'appendProjectFile',
      fileId: 'file-1',
      code: '\n<section>lock screen</section>',
      targetLabel: 'index.html'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      summary: '已续写工作区文件 · index.html',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'index.html',
          operation: 'appended',
          beforeLines: 1,
          afterLines: 2
        })
      ]
    });
    expect(ctx.patchProjectFile).toHaveBeenCalledWith('file-1', {
      content: '<main>\n<section>lock screen</section>'
    });
    expect(ctx.patchCodeCard).not.toHaveBeenCalled();
    expect(ctx.selectCodeCard).not.toHaveBeenCalled();
  });

  it('keeps appended HTML chunks inside the document body when the file is already closed', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<!doctype html><html><head></head><body><main></main></body></html>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'appendProjectFile',
      fileId: 'file-1',
      code: '<script>boot();</script>',
      targetLabel: 'index.html'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      summary: '已续写工作区文件 · index.html',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'index.html',
          operation: 'inserted'
        })
      ]
    });
    expect(ctx.patchProjectFile).toHaveBeenCalledWith('file-1', {
      content: '<!doctype html><html><head></head><body><main></main><script>boot();</script></body></html>'
    });
  });

  it('inserts project file chunks before a unique anchor', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<main>\n</main>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'insertProjectFile',
      fileId: 'file-1',
      beforeString: '</main>',
      code: '  <section>lock screen</section>\n',
      targetLabel: 'index.html'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      summary: '已插入工作区文件 · index.html',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'index.html',
          operation: 'inserted',
          matchCount: 1
        })
      ]
    });
    expect(ctx.patchProjectFile).toHaveBeenCalledWith('file-1', {
      content: '<main>\n  <section>lock screen</section>\n</main>'
    });
    expect(ctx.patchCodeCard).not.toHaveBeenCalled();
  });

  it('inserts project file chunks after a line number from context reads', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'scenes-level1.js',
        language: 'javascript',
        content: 'const scene = {\n  lines: [],\n};',
        fileRole: 'logic' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'insertProjectFile',
      fileId: 'file-1',
      lineNumber: 2,
      linePosition: 'after',
      code: '  endings: [],\n',
      targetLabel: 'scenes-level1.js'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['scenes-level1.js'],
      summary: '已按行插入工作区文件 · scenes-level1.js:2',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'scenes-level1.js',
          operation: 'inserted',
          changedLines: {
            start: 3,
            end: 4
          },
          afterExcerptStartLine: 2,
          afterExcerptEndLine: 4,
          afterExcerpt: expect.stringContaining('3:   endings: [],')
        })
      ]
    });
    expect(ctx.patchProjectFile).toHaveBeenCalledWith('file-1', {
      content: 'const scene = {\n  lines: [],\n  endings: [],\n};'
    });
  });

  it('refuses ambiguous project file insertion anchors', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<button>OK</button><button>OK</button>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'insertProjectFile',
      fileId: 'file-1',
      afterString: '<button>OK</button>',
      code: '<span>ready</span>'
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('要插入的锚点片段匹配到 2 处，请提供更长的 beforeString 或 afterString。');
    expect(result.ok ? '' : result.error).toContain('命中位置：index.html:1');
    expect(ctx.patchProjectFile).not.toHaveBeenCalled();
  });

  it('explains missing project file insertion anchors with recovery steps', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<main>\n  <button>OK</button>\n</main>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'insertProjectFile',
      fileId: 'file-1',
      afterString: '<button>Missing</button>',
      code: '<span>ready</span>'
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('要插入的锚点片段没有命中 · index.html。');
    expect(result.ok ? '' : result.error).toContain('片段开头：<button>Missing</button>');
    expect(result.ok ? '' : result.error).toContain('readProjectFileContext');
    expect(result.ok ? '' : result.error).toContain('lineNumber + linePosition');
    expect(ctx.patchProjectFile).not.toHaveBeenCalled();
  });

  it('edits code card text with an exact unique replacement', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Mini Phone',
        language: 'html',
        code: '<main>\n  <section>old</section>\n</main>',
        tags: ['项目'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'editCodeCardText',
      cardId: 'card-1',
      oldString: '  <section>old</section>',
      newString: '  <section>new</section>',
      targetLabel: 'Mini Phone'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      cardId: 'card-1'
    });
    expect(ctx.patchCodeCard).toHaveBeenCalledWith('card-1', {
      code: '<main>\n  <section>new</section>\n</main>'
    });
  });

  it('edits project file text with an exact unique replacement', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'index.html',
        language: 'html',
        content: '<main>\n  <section>old</section>\n</main>',
        fileRole: 'entry' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'editProjectFileText',
      fileId: 'file-1',
      oldString: '  <section>old</section>',
      newString: '  <section>new</section>',
      targetLabel: 'index.html'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-1',
      projectFilePaths: ['index.html'],
      summary: '已局部替换工作区文件 · index.html',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'index.html',
          operation: 'replaced',
          matchCount: 1
        })
      ]
    });
    expect(ctx.patchProjectFile).toHaveBeenCalledWith('file-1', {
      content: '<main>\n  <section>new</section>\n</main>'
    });
    expect(ctx.patchCodeCard).not.toHaveBeenCalled();
  });

  it('explains missing project file replacement snippets with recovery steps', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'scripts/app.js',
        language: 'javascript',
        content: 'function boot() {\n  start();\n}\n',
        fileRole: 'logic' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'editProjectFileText',
      fileId: 'file-1',
      oldString: 'function missing() {\n  start();\n}',
      newString: 'function boot() {\n  start();\n}'
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('要替换的原文片段没有命中 · scripts/app.js。');
    expect(result.ok ? '' : result.error).toContain('片段开头：function missing() { / start(); / }');
    expect(result.ok ? '' : result.error).toContain('searchProjectFiles');
    expect(result.ok ? '' : result.error).toContain('oldString 必须和当前文件完全一致');
    expect(ctx.patchProjectFile).not.toHaveBeenCalled();
  });

  it('returns the deleted project file path before removing the file', async () => {
    const ctx = createToolContext({
      readProjectFile: vi.fn((fileId) => ({
        id: fileId,
        projectId: 'mini-phone',
        filePath: 'styles/old.css',
        language: 'css',
        content: 'body {}',
        fileRole: 'style' as const,
        createdAt: 1,
        updatedAt: 1,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'deleteProjectFile',
      fileId: 'file-style',
      targetLabel: 'styles/old.css'
    }, ctx);

    expect(result).toMatchObject({
      ok: true,
      projectFileId: 'file-style',
      projectFilePaths: ['styles/old.css'],
      summary: '已删除工作区文件 · styles/old.css',
      projectFileEffects: [
        expect.objectContaining({
          filePath: 'styles/old.css',
          operation: 'deleted',
          beforeLines: 1
        })
      ]
    });
    expect(ctx.deleteProjectFile).toHaveBeenCalledWith('file-style');
  });

  it('refuses ambiguous exact replacements instead of changing multiple places', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Mini Phone',
        language: 'html',
        code: '<button>OK</button><button>OK</button>',
        tags: ['项目'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({
      kind: 'editCodeCardText',
      cardId: 'card-1',
      oldString: '<button>OK</button>',
      newString: '<button>Open</button>'
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('要替换的原文片段匹配到 2 处，请提供更长的 oldString。');
    expect(result.ok ? '' : result.error).toContain('命中位置：第 1 行');
    expect(ctx.patchCodeCard).not.toHaveBeenCalled();
  });

  it('reads standalone card details without legacy project metadata', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn(() => ({
        id: 'card-1',
        title: 'Landing Hero',
        language: 'tsx',
        code: 'export default function Page() {}',
        tags: ['首页', 'hero'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'card' as const,
        source: 'chat-generated' as const
      }))
    });

    const result = await executeToolAction({ kind: 'readCodeCard', cardId: 'card-1' }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取房间 · Landing Hero',
      detailText: [
        '房间：Landing Hero',
        '语言：tsx',
        '标签：首页、hero',
        'export default function Page() {}'
      ].join('\n'),
      cardId: 'card-1'
    });
  });

  it('keeps console output in successful runCode responses', async () => {
    const ctx = createToolContext({
      runCode: vi.fn(async () => ({
        ok: true as const,
        returnValue: '3',
        logs: [{ level: 'log' as const, args: ['step', '1'] }]
      }))
    });

    const result = await executeToolAction({ kind: 'runCode', code: 'return 3' }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '代码已执行',
      detailText: '返回值：3\n\n--- console ---\n[log] step 1'
    });
  });

  it('runs tool cards through the sandbox wrapper and writes room state back', async () => {
    const ctx = createToolContext({
      readCodeCard: vi.fn((cardId) => ({
        id: cardId,
        title: 'Format Notes',
        language: 'javascript',
        code: 'return { output: window.PolarisTool.input };',
        tags: ['工具'],
        createdAt: 1,
        updatedAt: 1,
        kind: 'tool' as const,
        source: 'manual' as const
      })),
      readCodeCardState: vi.fn(async () => ({ count: 1 })),
      runCode: vi.fn(async () => ({
        ok: true as const,
        returnValue: JSON.stringify({
          __polarisTool: true,
          result: {
            output: '整理好了'
          },
          resultProvided: true,
          roomState: {
            count: 2
          }
        }),
        logs: [{ level: 'log' as const, args: ['done'] }]
      }))
    });

    const result = await executeToolAction({
      kind: 'invokeCodeCardTool',
      cardId: 'card-1',
      toolName: 'cardTool_format_notes_card_1',
      input: '整理好了',
      args: {
        tone: 'clean'
      },
      targetLabel: 'Format Notes'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已调用工具卡 · Format Notes',
      detailText: '返回值：{\n  "output": "整理好了"\n}\n\n--- console ---\n[log] done',
      cardId: 'card-1'
    });
    expect(ctx.writeCodeCardState).toHaveBeenCalledWith('card-1', { count: 2 });
  });

  it('returns MCP tool output when invokeMcpTool succeeds', async () => {
    const ctx = createToolContext({
      invokeMcpTool: vi.fn(async () => ({
        ok: true as const,
        detailText: 'weather: sunny'
      }))
    });

    const result = await executeToolAction({
      kind: 'invokeMcpTool',
      serverId: 'server-1',
      serverName: 'Weather MCP',
      toolName: 'get_weather',
      argumentsObject: {
        city: 'Shanghai'
      },
      targetLabel: 'Weather MCP / get_weather'
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已调用 MCP 工具 · Weather MCP / get_weather',
      detailText: 'weather: sunny',
      mcpResult: {
        serverId: 'server-1',
        serverName: 'Weather MCP',
        toolName: 'get_weather',
        argumentsObject: {
          city: 'Shanghai'
        }
      }
    });
  });
});
