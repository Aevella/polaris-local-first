import { describe, expect, it } from 'vitest';
import { buildThemeSnapshotPrompt, buildThemeToolRules } from './toolRegistryThemeRules';

describe('toolRegistryThemeRules', () => {
  it('builds stable-only rule views from the stable rule source', () => {
    const lines = buildThemeToolRules({
      themeToolMode: 'stable',
      themeContextMode: 'focused',
      toolEnforcementMode: 'force',
      modelTier: 'medium',
      themePreviewActive: false,
      themeSnapshot: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: ''
      },
      activeCard: null,
      visibleCards: []
    });

    expect(lines.some((line) => line.includes('applyThemeCoordinates'))).toBe(true);
    expect(lines.some((line) => line.includes('readThemeCss：读取当前完整'))).toBe(false);
    expect(lines.some((line) => line.includes('patchRawCss 是旧入口'))).toBe(false);
    expect(lines.some((line) => line.includes('当前换肤模式：稳定模式'))).toBe(true);
    expect(lines.some((line) => line.includes('稳态前台只用编号说话'))).toBe(true);
    expect(lines.some((line) => line.includes('一律折成编号'))).toBe(true);
  });

  it('builds creative-only rule views from the creative rule source', () => {
    const lines = buildThemeToolRules({
      themeToolMode: 'creative',
      themeContextMode: 'focused',
      toolEnforcementMode: 'force',
      modelTier: 'strong',
      themePreviewActive: true,
      uiSnapshot: {
        activeWorld: 'chat',
        collectionShelf: 'code',
        activeConversationTitle: '测试对话',
        activeCollaboratorName: 'Pharos'
      },
      attachmentSnapshot: {
        latest: [{ id: 'attachment-1', assetId: 'asset-cat', kind: 'image', name: 'cat.png' }],
        available: [{ id: 'attachment-1', assetId: 'asset-cat', kind: 'image', name: 'cat.png' }]
      },
      imageAssetSnapshot: {
        available: [{
          id: 'image-toast',
          assetId: 'asset-toast',
          title: '吐司贴纸',
          tags: ['贴纸'],
          source: 'imported',
          cssUrl: 'url("polaris-asset://asset-toast")'
        }]
      },
      themeSnapshot: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '',
        customCSS: '',
        generatedCSS: ''
      },
      activeCard: null,
      visibleCards: []
    });

    expect(lines.some((line) => line.includes('readThemeCss 只返回当前 CSS 快照'))).toBe(true);
    expect(lines.some((line) => line.includes('不是每轮通行证'))).toBe(true);
    expect(lines.some((line) => line.includes('新增 selector 用 appendThemeCss'))).toBe(true);
    expect(lines.some((line) => line.includes('appendThemeCss.css`'))).toBe(false);
    expect(lines.some((line) => line.includes('replaceThemeCss.css`'))).toBe(false);
    expect(lines.some((line) => line.includes('editThemeCss 替换已有片段'))).toBe(true);
    expect(lines.some((line) => line.includes('用 replaceThemeCss 写完整 CSS'))).toBe(true);
    expect(lines.some((line) => line.includes('inspectThemeRender 只能读取当前已经挂载的界面 DOM'))).toBe(true);
    expect(lines.some((line) => line.includes('patchRawCss 是旧入口'))).toBe(true);
    expect(lines.some((line) => line.includes('创意模式 selector：'))).toBe(true);
    expect(lines.some((line) => line.includes('alias=chat-bubble-user'))).toBe(true);
    expect(lines.some((line) => line.includes('alias=chat-tool-receipt'))).toBe(true);
    expect(lines.some((line) => line.includes('助手正文是阅读文字，工具收据是执行反馈'))).toBe(true);
    expect(lines.some((line) => line.includes('可读性是硬要求'))).toBe(true);
    expect(lines.some((line) => line.includes('同一轮必须确认文字色仍清楚'))).toBe(true);
    expect(lines.some((line) => line.includes('完整规则'))).toBe(true);
    expect(lines.some((line) => line.includes('不要只写 selector 列表'))).toBe(true);
    expect(lines.some((line) => line.includes('inspectThemeRender 只能读取当前已经挂载的界面 DOM'))).toBe(true);
    expect(lines.some((line) => line.includes('QQ 式图片气泡'))).toBe(true);
    expect(lines.some((line) => line.includes('.bubble-frame.user::after'))).toBe(true);
    expect(lines.some((line) => line.includes('background-image: url'))).toBe(true);
    expect(lines.some((line) => line.includes('polaris-asset://asset-cat'))).toBe(true);
    expect(lines.some((line) => line.includes('图片库 吐司贴纸'))).toBe(true);
    expect(lines.some((line) => line.includes('polaris-asset://asset-toast'))).toBe(true);
    expect(lines.some((line) => line.includes('createImageVariant'))).toBe(true);
    expect(lines.some((line) => line.includes('extractImagePalette'))).toBe(true);
    expect(lines.some((line) => line.includes('四轴怎么理解'))).toBe(false);
  });

  it('keeps theme snapshot prompt shared across both modes', () => {
    expect(buildThemeSnapshotPrompt({
      themeToolMode: 'creative',
      themeContextMode: 'focused',
      themePreviewActive: true,
      modelTier: 'strong',
      themeSnapshot: {
        activePresetId: 'polaris-default',
        activeSavedSkinId: null,
        cssVariables: {},
        presetCSS: '.preset {}',
        customCSS: '.custom {}',
        generatedCSS: '.generated {}'
      },
      activeCard: null,
      visibleCards: []
    })).toContain('正在试穿 · 创意模式 · 强模型');
  });

  it('keeps stable theme rules visible whenever stable mode is active', () => {
    const lines = buildThemeToolRules({
      themeToolMode: 'stable',
      themeContextMode: 'none',
      activeCard: null,
      visibleCards: []
    });

    expect(lines.some((line) => line.includes('applyThemeCoordinates'))).toBe(true);
    expect(lines.some((line) => line.includes('当前换肤模式：稳定模式'))).toBe(true);
    expect(lines.some((line) => line.includes('四轴怎么理解'))).toBe(true);
  });

  it('keeps creative theme rules visible whenever creative mode is active', () => {
    const lines = buildThemeToolRules({
      themeToolMode: 'creative',
      themeContextMode: 'none',
      modelTier: 'medium',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      activeCard: null,
      visibleCards: []
    });

    expect(lines.some((line) => line.includes('readThemeCss 只返回当前 CSS 快照'))).toBe(true);
    expect(lines.some((line) => line.includes('不是每轮通行证'))).toBe(true);
    expect(lines.some((line) => line.includes('editThemeCss 替换已有片段'))).toBe(true);
    expect(lines.some((line) => line.includes('用 replaceThemeCss 写完整 CSS'))).toBe(true);
    expect(lines.some((line) => line.includes('patchRawCss 是旧入口'))).toBe(true);
    expect(lines.some((line) => line.includes('创意模式 selector：'))).toBe(true);
    expect(lines.some((line) => line.includes('alias=chat-tool-receipt'))).toBe(true);
    expect(lines.some((line) => line.includes('不要把 `chat-background` 写成 `.chat-background`'))).toBe(true);
  });

  it('uses selector hints already derived from the current request context', () => {
    const lines = buildThemeToolRules({
      themeToolMode: 'creative',
      themeContextMode: 'focused',
      modelTier: 'medium',
      toolEnforcementMode: 'normal',
      themePreviewActive: false,
      uiSnapshot: {
        activeWorld: 'chat',
        collectionShelf: 'code',
        selectorHints: [{
          name: '收藏底栏',
          alias: 'collection-shelf-tabs',
          selectors: ['.app-shell.collection .collection-shelf-tabs']
        }]
      },
      activeCard: null,
      visibleCards: []
    });

    expect(lines.some((line) => line.includes('alias=collection-shelf-tabs'))).toBe(true);
  });
});
