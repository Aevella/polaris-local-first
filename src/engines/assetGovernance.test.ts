import { describe, expect, it } from 'vitest';
import type {
  AppCustomization,
  CodeCard,
  Conversation,
  ImageAssetCard,
  Persona,
  ProjectFile,
  RoomProject,
  ThemeState,
  WorkspaceReferenceDoc
} from '../types/domain';
import {
  buildAssetAuditSummary,
  collectAssetReferenceOwners,
  collectConversationOnlyAssetIds,
  collectReferencedAssetIds,
  resolveRedundantAssetPreviewAudit
} from './assetGovernance';
import type { StoredAssetMeta } from '../infrastructure/assetStore';

describe('collectReferencedAssetIds', () => {
  it('collects asset ids from chat attachments, image cards, pending attachments, personas, and customization', () => {
    const conversations: Conversation[] = [
      {
        id: 'c-1',
        title: 'Test',
        collaboratorId: 'pharos',
        pinnedAt: null,
        updatedAt: 1,
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: 'hi',
            timestamp: 1,
            attachments: [
              {
                id: 'a-1',
                assetId: 'asset-chat-image',
                kind: 'image',
                name: 'photo.png',
                mimeType: 'image/png',
                size: 12
              }
            ]
          },
          {
            id: 'm-voice',
            role: 'assistant',
            content: 'voice',
            timestamp: 2,
            voiceCache: {
              assetId: 'asset-voice-cache',
              name: 'voice.mp3',
              mimeType: 'audio/mpeg',
              size: 256,
              createdAt: 2,
              textHash: 'voice-hash',
              textLength: 5,
              providerType: 'openai-compatible',
              model: 'tts-1',
              voice: 'alloy',
              format: 'mp3'
            }
          }
        ]
      }
    ];
    const imageCards: ImageAssetCard[] = [
      {
        id: 'card-1',
        assetId: 'asset-collection-image',
        title: 'Photo',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }
    ];
    const personas: Persona[] = [
      {
        id: 'persona-1',
        systemRole: 'default',
        name: 'Pharos',
        description: '灯塔',
        assistantAvatarAssetId: 'asset-assistant-avatar',
        assistantAvatarIconId: null,
        assistantAvatarShape: 'circle',
        assistantAvatarSize: 'medium',
        userAvatarAssetId: 'asset-user-avatar',
        userAvatarIconId: null,
        userAvatarShape: 'rounded',
        userAvatarSize: 'medium',
        userName: '',
        purpose: '',
        compiledPrompt: '',
        builderManaged: true,
        generatedPromptMode: 'vnext',
        messageTemplate: '',
        systemTimeContextEnabled: false,
        baseId: 'blank',
        relationship: 'companion',
        expression: 'natural',
        tags: {
          temperament: [],
          interaction: [],
          expression: [],
          thinking: [],
          action: []
        },
        initiative: 'balanced',
        memoryStyle: 'quiet',
        silence: 'wait',
        disagreement: 'defer',
        humor: 'none',
        attachment: 'presence',
        curiosity: 'respectful',
        selfDisclosure: 'selective',
        deepDefinition: {
          identityHint: '',
          missionHint: '',
          conflictPriority: '',
          conflictReason: '',
          avoidBecoming: '',
          correctiveAction: '',
          vulnerableFirst: '',
          vulnerableThen: '',
          hardBoundary: '',
          hardBoundaryAction: ''
        },
        memory: {
          inheritGlobal: true,
          crossConversationRecallEnabled: true,
          excludedGlobalIds: [],
          personalMemories: [],
          conversationSummaries: [],
          referenceDocs: []
        },
        mcp: {
          inheritGlobal: true,
          serverIds: []
        },
        advanced: {
          modelOverride: '',
          temperature: '',
          topP: '',
          maxTokens: '',
          thinkingBudget: '',
          contextMessageLimit: '',
          showThinking: false,
          streaming: true,
          customHeaders: '',
          customBody: '',
          regexRules: '',
          snippets: []
        },
        version: 1
      }
    ];
    const customization: AppCustomization = {
      showChatAvatars: true,
      starColor: null,
      starOpacity: 0.98,
      starGlow: 0.46,
      starScale: 1,
      starWarmth: 0.54,
      backgroundAssetId: 'asset-background',
      customFontAssetIds: [],
      customFontScopeAssignments: {
        global: null,
        titles: null,
        chat: null,
        cards: null
      },
      backgroundOpacity: 0.46,
      backgroundDim: 0.24,
      backgroundBlur: 10,
      backgroundFit: 'cover'
    };

    const referenced = collectReferencedAssetIds({
      conversations,
      imageCards,
      personas,
      customization,
      pendingAttachments: [
        {
          id: 'pending-1',
          assetId: 'asset-pending-file',
          kind: 'file',
          name: 'doc.txt',
          mimeType: 'text/plain',
          size: 8
        }
      ]
    });

    expect([...referenced].sort()).toEqual([
      'asset-assistant-avatar',
      'asset-background',
      'asset-chat-image',
      'asset-collection-image',
      'asset-pending-file',
      'asset-user-avatar',
      'asset-voice-cache'
    ]);
  });

  it('ignores manually cleared chat attachments as active references', () => {
    const referenced = collectReferencedAssetIds({
      conversations: [
        {
          id: 'c-1',
          title: 'Test',
          collaboratorId: 'pharos',
          pinnedAt: null,
          updatedAt: 1,
          messages: [
            {
              id: 'm-1',
              role: 'user',
              content: 'hi',
              timestamp: 1,
              attachments: [
                {
                  id: 'a-1',
                  assetId: 'asset-cleared',
                  kind: 'file',
                  name: 'notes.txt',
                  mimeType: 'text/plain',
                  size: 12,
                  clearedAt: 2
                },
                {
                  id: 'a-2',
                  assetId: 'asset-live',
                  kind: 'file',
                  name: 'live.txt',
                  mimeType: 'text/plain',
                  size: 8
                }
              ]
            }
          ]
        }
      ],
      imageCards: []
    });

    expect([...referenced].sort()).toEqual(['asset-live']);
  });

  it('keeps assets referenced from long-lived collection and theme text', () => {
    const referenced = collectReferencedAssetIds({
      conversations: [],
      imageCards: [],
      codeCards: [{
        id: 'card-1',
        title: '素材房间',
        language: 'html',
        code: '<img src="polaris-asset://asset-card-code">',
        cardFaceCss: '.card { background: url("polaris-asset://asset-card-css"); }',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }],
      projectFiles: [{
        id: 'file-1',
        projectId: 'project-1',
        filePath: 'index.html',
        language: 'html',
        content: '<img src="polaris-asset://asset-project-file">',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }],
      workspaceReferenceDocs: [{
        id: 'doc-1',
        projectId: 'project-1',
        title: '参考资料',
        summary: '素材 polaris-asset://asset-reference-summary',
        content: '长期资料图片 polaris-asset://asset-reference-doc',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }],
      roomProjects: [{
        id: 'project-1',
        title: '项目',
        slug: 'project',
        fileIds: ['file-1'],
        tags: [],
        coverStyle: 'background: url("polaris-asset://asset-project-cover");',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }],
      theme: {
        activePresetId: null,
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: 'body { background: url("polaris-asset://asset-theme"); }',
        generatedCSS: '',
        toolMode: 'stable',
        selectedSurfaceCodes: [],
        savedSkins: [{
          id: 'skin-1',
          name: '皮肤',
          sourcePresetId: null,
          cssVariables: {},
          presetCSS: '',
          customCSS: 'body { background: url("polaris-asset://asset-saved-skin"); }',
          generatedCSS: '',
          createdAt: 1,
          updatedAt: 1
        }],
        skinHistory: [],
        patchLedger: []
      }
    });

    expect([...referenced].sort()).toEqual([
      'asset-card-code',
      'asset-card-css',
      'asset-project-cover',
      'asset-project-file',
      'asset-reference-doc',
      'asset-reference-summary',
      'asset-saved-skin',
      'asset-theme'
    ]);
  });

  it('collects every durable asset-bearing owner field used by cleanup', () => {
    const conversation: Conversation = {
      id: 'c-1',
      title: 'Chat',
      collaboratorId: 'pharos',
      pinnedAt: null,
      updatedAt: 1,
      messages: [{
        id: 'm-1',
        role: 'assistant',
        content: 'done',
        timestamp: 1,
        attachments: [{
          id: 'attachment-1',
          assetId: 'asset-conversation-attachment',
          kind: 'image',
          name: 'chat.png',
          mimeType: 'image/png',
          size: 12
        }]
      }]
    };
    const codeCard: CodeCard = {
      id: 'card-1',
      title: 'Card',
      language: 'html',
      code: '<img src="polaris-asset://asset-code-card-code">',
      cardFaceCss: '.card { background: url("polaris-asset://asset-code-card-css"); }',
      cardNote: 'note polaris-asset://asset-code-card-note',
      tags: [],
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    };
    const imageCard: ImageAssetCard = {
      id: 'image-1',
      assetId: 'asset-image-card',
      title: 'Image',
      tags: [],
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    };
    const projectFile: ProjectFile = {
      id: 'file-1',
      projectId: 'project-1',
      filePath: 'index.html',
      language: 'html',
      content: '<img src="polaris-asset://asset-project-file">',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    };
    const workspaceReferenceDoc: WorkspaceReferenceDoc = {
      id: 'doc-1',
      projectId: 'project-1',
      title: 'Reference',
      summary: 'summary polaris-asset://asset-reference-summary',
      content: 'body polaris-asset://asset-reference-content',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    };
    const roomProject: RoomProject = {
      id: 'project-1',
      title: 'Project',
      slug: 'project',
      fileIds: ['file-1'],
      tags: [],
      coverStyle: 'background: url("polaris-asset://asset-room-cover-style");',
      coverNote: 'cover note polaris-asset://asset-room-cover-note',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    };
    const persona = {
      id: 'persona-1',
      name: 'Persona',
      assistantAvatarAssetId: 'asset-persona-assistant-avatar',
      userAvatarAssetId: 'asset-persona-user-avatar'
    } as Persona;
    const theme: ThemeState = {
      activePresetId: null,
      activeSavedSkinId: null,
      cssVariables: {
        '--ignored-asset-url': 'url("polaris-asset://asset-css-variable-intentionally-ignored")'
      },
      presetCSS: 'body { background: url("polaris-asset://asset-theme-preset-css"); }',
      customCSS: 'body { background: url("polaris-asset://asset-theme-custom-css"); }',
      generatedCSS: 'body { background: url("polaris-asset://asset-theme-generated-css"); }',
      toolMode: 'stable',
      selectedSurfaceCodes: [],
      savedSkins: [{
        id: 'skin-1',
        name: 'Skin',
        sourcePresetId: null,
        cssVariables: {},
        presetCSS: 'body { background: url("polaris-asset://asset-saved-skin-preset-css"); }',
        customCSS: 'body { background: url("polaris-asset://asset-saved-skin-custom-css"); }',
        generatedCSS: 'body { background: url("polaris-asset://asset-saved-skin-generated-css"); }',
        createdAt: 1,
        updatedAt: 1
      }],
      skinHistory: [{
        id: 'snapshot-1',
        label: 'snapshot',
        sourcePresetId: null,
        sourceSavedSkinId: null,
        createdAt: 1,
        cssVariables: {},
        presetCSS: 'body { background: url("polaris-asset://asset-skin-history-preset-css"); }',
        customCSS: 'body { background: url("polaris-asset://asset-skin-history-custom-css"); }',
        generatedCSS: 'body { background: url("polaris-asset://asset-skin-history-generated-css"); }'
      }],
      patchLedger: [{
        id: 'patch-1',
        previewId: 'preview-1',
        conversationId: 'conversation-1',
        kind: 'patchRawCss',
        label: 'Patch',
        summary: 'Patch',
        status: 'preview',
        detailText: 'preview polaris-asset://asset-theme-patch-detail',
        createdAt: 1,
        updatedAt: 1
      }]
    };
    const customization: AppCustomization = {
      showChatAvatars: true,
      starColor: null,
      starOpacity: 0.98,
      starGlow: 0.46,
      starScale: 1,
      starWarmth: 0.54,
      backgroundAssetId: 'asset-customization-background',
      customFontAssetIds: ['asset-customization-font'],
      customFontScopeAssignments: {
        global: 'asset-customization-font',
        titles: null,
        chat: null,
        cards: null
      },
      backgroundOpacity: 0.46,
      backgroundDim: 0.24,
      backgroundBlur: 10,
      backgroundFit: 'cover'
    };

    const referenced = collectReferencedAssetIds({
      conversations: [conversation],
      codeCards: [codeCard],
      imageCards: [imageCard],
      projectFiles: [projectFile],
      workspaceReferenceDocs: [workspaceReferenceDoc],
      roomProjects: [roomProject],
      personas: [persona],
      theme,
      customization,
      pendingAttachments: [{
        id: 'pending-1',
        assetId: 'asset-pending-attachment',
        kind: 'file',
        name: 'draft.txt',
        mimeType: 'text/plain',
        size: 8
      }],
      collaboratorThemes: {
        nova: {
          theme: {
            ...theme,
            presetCSS: 'body { background: url("polaris-asset://asset-collaborator-theme"); }',
            customCSS: '',
            generatedCSS: '',
            savedSkins: [],
            skinHistory: [],
            patchLedger: []
          },
          customization: {
            ...customization,
            backgroundAssetId: 'asset-collaborator-background',
            customFontAssetIds: ['asset-collaborator-font'],
            customFontScopeAssignments: {
              global: 'asset-collaborator-font',
              titles: null,
              chat: null,
              cards: null
            }
          }
        }
      }
    });

    expect([...referenced].sort()).toEqual([
      'asset-code-card-code',
      'asset-code-card-css',
      'asset-code-card-note',
      'asset-collaborator-background',
      'asset-collaborator-font',
      'asset-collaborator-theme',
      'asset-conversation-attachment',
      'asset-customization-background',
      'asset-customization-font',
      'asset-image-card',
      'asset-pending-attachment',
      'asset-persona-assistant-avatar',
      'asset-persona-user-avatar',
      'asset-project-file',
      'asset-reference-content',
      'asset-reference-summary',
      'asset-room-cover-note',
      'asset-room-cover-style',
      'asset-saved-skin-custom-css',
      'asset-saved-skin-generated-css',
      'asset-saved-skin-preset-css',
      'asset-skin-history-custom-css',
      'asset-skin-history-generated-css',
      'asset-skin-history-preset-css',
      'asset-theme-custom-css',
      'asset-theme-generated-css',
      'asset-theme-patch-detail',
      'asset-theme-preset-css'
    ]);
    expect(referenced.has('asset-css-variable-intentionally-ignored')).toBe(false);
  });
});

describe('collectConversationOnlyAssetIds', () => {
  it('only returns assets owned by conversations and excludes saved or pending assets', () => {
    const conversation: Conversation = {
      id: 'c-1',
      title: 'Test',
      collaboratorId: 'pharos',
      pinnedAt: null,
      updatedAt: 1,
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: 'hi',
          timestamp: 1,
          attachments: [
            { id: 'a-1', assetId: 'asset-chat-only', kind: 'image', name: 'chat.png', mimeType: 'image/png', size: 120 },
            { id: 'a-2', assetId: 'asset-saved', kind: 'image', name: 'saved.png', mimeType: 'image/png', size: 80 },
            { id: 'a-3', assetId: 'asset-cleared', kind: 'file', name: 'old.txt', mimeType: 'text/plain', size: 12, clearedAt: 2 }
          ],
          voiceCache: {
            assetId: 'asset-voice-cache',
            name: 'voice.mp3',
            mimeType: 'audio/mpeg',
            size: 256,
            createdAt: 2,
            textHash: 'voice-hash',
            textLength: 5,
            providerType: 'openai-compatible',
            model: 'tts-1',
            voice: 'alloy',
            format: 'mp3'
          }
        }
      ]
    };
    const imageCards: ImageAssetCard[] = [
      {
        id: 'card-1',
        assetId: 'asset-saved',
        title: '已保存',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }
    ];

    const result = collectConversationOnlyAssetIds({
      conversations: [conversation],
      imageCards,
      pendingAttachments: [
        { id: 'pending-1', assetId: 'asset-pending', kind: 'file', name: 'draft.txt', mimeType: 'text/plain', size: 4 }
      ]
    });

    expect([...result].sort()).toEqual(['asset-chat-only']);
  });
});

describe('buildAssetAuditSummary', () => {
  it('separates unreferenced asset entities from orphan preview caches', () => {
    const metaById = new Map<string, StoredAssetMeta>([
      ['asset-live', { id: 'asset-live', kind: 'image', name: 'live.png', mimeType: 'image/png', size: 120, createdAt: 1 }],
      ['asset-orphan', { id: 'asset-orphan', kind: 'file', name: 'orphan.txt', mimeType: 'text/plain', size: 40, createdAt: 1 }]
    ]);
    const binarySizeById = new Map<string, number>([
      ['asset-live', 120],
      ['asset-orphan', 40]
    ]);
    const previewSizeById = new Map<string, number>([
      ['asset-live', 15],
      ['asset-preview-only', 20]
    ]);

    const summary = buildAssetAuditSummary({
      referencedAssetIds: new Set(['asset-live']),
      metaById,
      binarySizeById,
      previewSizeById
    });

    expect(summary.totalAssetCount).toBe(2);
    expect(summary.referencedAssetCount).toBe(1);
    expect(summary.orphanAssetCount).toBe(1);
    expect(summary.totalBinaryBytes).toBe(160);
    expect(summary.totalPreviewBytes).toBe(35);
    expect(summary.orphanBinaryBytes).toBe(40);
    expect(summary.orphanPreviewBytes).toBe(0);
    expect(summary.orphanPreviewCacheCount).toBe(1);
    expect(summary.orphanPreviewCacheBytes).toBe(20);
    expect(summary.orphanAssetIds).toEqual(['asset-orphan']);
    expect(summary.orphanPreviewCacheIds).toEqual(['asset-preview-only']);
    expect(summary.missingMetaAssetIds).not.toContain('asset-preview-only');
    expect(summary.missingBinaryAssetIds).not.toContain('asset-preview-only');
    expect(summary.largestAssets[0]?.id).toBe('asset-live');
  });

  it('keeps referenced preview-only ids visible as broken asset entities', () => {
    const summary = buildAssetAuditSummary({
      referencedAssetIds: new Set(['asset-preview-only']),
      metaById: new Map(),
      binarySizeById: new Map(),
      previewSizeById: new Map<string, number>([
        ['asset-preview-only', 20]
      ])
    });

    expect(summary.totalAssetCount).toBe(1);
    expect(summary.referencedAssetCount).toBe(1);
    expect(summary.orphanPreviewCacheCount).toBe(0);
    expect(summary.missingMetaAssetIds).toEqual(['asset-preview-only']);
    expect(summary.missingBinaryAssetIds).toEqual(['asset-preview-only']);
  });

  it('summarizes the heaviest reference owners by conversation, image card, and pending attachments', () => {
    const conversations: Conversation[] = [
      {
        id: 'c-1',
        title: '很重的对话',
        collaboratorId: 'pharos',
        pinnedAt: null,
        updatedAt: 1,
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: 'hi',
            timestamp: 1,
            attachments: [
              { id: 'a-1', assetId: 'asset-a', kind: 'image', name: 'a.png', mimeType: 'image/png', size: 120 },
              { id: 'a-2', assetId: 'asset-b', kind: 'file', name: 'b.txt', mimeType: 'text/plain', size: 80 }
            ]
          }
        ]
      }
    ];
    const imageCards: ImageAssetCard[] = [
      {
        id: 'card-1',
        assetId: 'asset-c',
        title: '收藏图',
        tags: [],
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      }
    ];
    const referenceOwnersByAssetId = collectAssetReferenceOwners({
      conversations,
      imageCards,
      pendingAttachments: [
        { id: 'pending-1', assetId: 'asset-d', kind: 'file', name: 'draft.md', mimeType: 'text/markdown', size: 40 }
      ]
    });

    const summary = buildAssetAuditSummary({
      referencedAssetIds: new Set(['asset-a', 'asset-b', 'asset-c', 'asset-d']),
      referenceOwnersByAssetId,
      metaById: new Map<string, StoredAssetMeta>([
        ['asset-a', { id: 'asset-a', kind: 'image', name: 'a.png', mimeType: 'image/png', size: 120, createdAt: 1 }],
        ['asset-b', { id: 'asset-b', kind: 'file', name: 'b.txt', mimeType: 'text/plain', size: 80, createdAt: 1 }],
        ['asset-c', { id: 'asset-c', kind: 'image', name: 'c.png', mimeType: 'image/png', size: 60, createdAt: 1 }],
        ['asset-d', { id: 'asset-d', kind: 'file', name: 'draft.md', mimeType: 'text/markdown', size: 40, createdAt: 1 }]
      ]),
      binarySizeById: new Map<string, number>([
        ['asset-a', 120],
        ['asset-b', 80],
        ['asset-c', 60],
        ['asset-d', 40]
      ]),
      previewSizeById: new Map<string, number>([
        ['asset-a', 20],
        ['asset-c', 10]
      ])
    });

    expect(summary.largestOwners[0]).toMatchObject({
      kind: 'conversation',
      id: 'c-1',
      label: '很重的对话',
      assetCount: 2,
      totalBytes: 220
    });
    expect(summary.largestOwners[0]?.largestAssetId).toBe('asset-a');
    expect(summary.largestOwners[0]?.topAssets.map((asset) => asset.id)).toEqual(['asset-a', 'asset-b']);
    expect(summary.largestOwners[1]).toMatchObject({
      kind: 'image-card',
      id: 'card-1',
      label: '收藏图',
      totalBytes: 70
    });
    expect(summary.largestOwners[2]).toMatchObject({
      kind: 'pending-attachments',
      id: 'pending-attachments',
      label: '待发送附件',
      totalBytes: 40
    });
  });

  it('keeps customization and persona avatar assets referenced and attributed', () => {
    const personas: Persona[] = [
      {
        id: 'persona-1',
        systemRole: 'default',
        name: 'Aster',
        description: '同行者',
        assistantAvatarAssetId: 'asset-assistant-avatar',
        assistantAvatarIconId: null,
        assistantAvatarShape: 'circle',
        assistantAvatarSize: 'medium',
        userAvatarAssetId: null,
        userAvatarIconId: null,
        userAvatarShape: 'rounded',
        userAvatarSize: 'medium',
        userName: '',
        purpose: '',
        compiledPrompt: '',
        builderManaged: true,
        generatedPromptMode: 'vnext',
        messageTemplate: '',
        systemTimeContextEnabled: false,
        baseId: 'blank',
        relationship: 'companion',
        expression: 'natural',
        tags: {
          temperament: [],
          interaction: [],
          expression: [],
          thinking: [],
          action: []
        },
        initiative: 'balanced',
        memoryStyle: 'quiet',
        silence: 'wait',
        disagreement: 'defer',
        humor: 'none',
        attachment: 'presence',
        curiosity: 'respectful',
        selfDisclosure: 'selective',
        deepDefinition: {
          identityHint: '',
          missionHint: '',
          conflictPriority: '',
          conflictReason: '',
          avoidBecoming: '',
          correctiveAction: '',
          vulnerableFirst: '',
          vulnerableThen: '',
          hardBoundary: '',
          hardBoundaryAction: ''
        },
        memory: {
          inheritGlobal: true,
          crossConversationRecallEnabled: true,
          excludedGlobalIds: [],
          personalMemories: [],
          conversationSummaries: [],
          referenceDocs: []
        },
        mcp: {
          inheritGlobal: true,
          serverIds: []
        },
        advanced: {
          modelOverride: '',
          temperature: '',
          topP: '',
          maxTokens: '',
          thinkingBudget: '',
          contextMessageLimit: '',
          showThinking: false,
          streaming: true,
          customHeaders: '',
          customBody: '',
          regexRules: '',
          snippets: []
        },
        version: 1
      }
    ];
    const customization: AppCustomization = {
      showChatAvatars: true,
      starColor: null,
      starOpacity: 0.98,
      starGlow: 0.46,
      starScale: 1,
      starWarmth: 0.54,
      backgroundAssetId: 'asset-background',
      customFontAssetIds: ['asset-font'],
      customFontScopeAssignments: {
        global: 'asset-font',
        titles: 'asset-font',
        chat: null,
        cards: null
      },
      backgroundOpacity: 0.46,
      backgroundDim: 0.24,
      backgroundBlur: 10,
      backgroundFit: 'cover'
    };

    const referenceOwnersByAssetId = collectAssetReferenceOwners({
      conversations: [],
      imageCards: [],
      personas,
      customization
    });

    const summary = buildAssetAuditSummary({
      referencedAssetIds: collectReferencedAssetIds({
        conversations: [],
        imageCards: [],
        personas,
        customization
      }),
      referenceOwnersByAssetId,
      metaById: new Map<string, StoredAssetMeta>([
        ['asset-background', { id: 'asset-background', kind: 'image', name: 'bg.png', mimeType: 'image/png', size: 60, createdAt: 1 }],
        ['asset-assistant-avatar', { id: 'asset-assistant-avatar', kind: 'image', name: 'avatar.png', mimeType: 'image/png', size: 20, createdAt: 1 }],
        ['asset-font', { id: 'asset-font', kind: 'file', name: 'font.otf', mimeType: 'font/otf', size: 12, createdAt: 1 }]
      ]),
      binarySizeById: new Map<string, number>([
        ['asset-background', 60],
        ['asset-assistant-avatar', 20],
        ['asset-font', 12]
      ]),
      previewSizeById: new Map<string, number>([
        ['asset-background', 8],
        ['asset-assistant-avatar', 4]
      ])
    });

    expect(summary.orphanAssetIds).toEqual([]);
    expect(summary.ownerSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime-customization',
        id: 'runtime-customization',
        label: '运行时自定义',
        largestAssetId: 'asset-background'
      }),
      expect.objectContaining({
        kind: 'persona',
        id: 'persona-1',
        label: 'Aster',
        largestAssetId: 'asset-assistant-avatar'
      })
    ]));
  });
});

describe('resolveRedundantAssetPreviewAudit', () => {
  it('marks previews redundant when they are not smaller than the stored binary', () => {
    const audit = resolveRedundantAssetPreviewAudit({
      binarySizeById: new Map<string, number>([
        ['asset-duplicate', 100],
        ['asset-large-preview', 100],
        ['asset-real-preview', 100]
      ]),
      previewSizeById: new Map<string, number>([
        ['asset-duplicate', 100],
        ['asset-large-preview', 120],
        ['asset-real-preview', 40],
        ['asset-preview-only', 80]
      ])
    });

    expect(audit.redundantPreviewAssetIds.sort()).toEqual(['asset-duplicate', 'asset-large-preview']);
    expect(audit.redundantPreviewBytes).toBe(220);
  });
});
