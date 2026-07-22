import { buildThemePresetSummaryLine } from './themePresetPromptCatalog';
import { buildSelectorCatalogPromptLines, formatThemeSelectorHintLine } from './themeSelectorPromptCatalog';
import type { AssistantToolContext } from './assistantToolProtocolTypes';

const THEME_PRESET_SUMMARY_LINE = buildThemePresetSummaryLine();

function buildThemeImageAssetLines(context: AssistantToolContext | undefined) {
  const imageAssets = (context?.attachmentSnapshot?.available ?? [])
    .filter((attachment) => attachment.kind === 'image' && attachment.assetId)
    .slice(-6);
  const libraryAssets = (context?.imageAssetSnapshot?.available ?? []).slice(0, 8);
  if (imageAssets.length === 0 && libraryAssets.length === 0) return [];

  const lines = [
    '当前可用于换肤的本地图片素材：',
    ...libraryAssets.map((asset) =>
      `- 图片库 ${asset.title} id=${asset.id}${asset.tags.length ? ` tags=${asset.tags.join('、')}` : ''}：\`${asset.cssUrl}\``
    ),
    ...imageAssets.map((attachment) =>
      `- 对话附件 ${attachment.name} id=${attachment.id}：\`url("polaris-asset://${attachment.assetId}")\``
    )
  ];
  return lines;
}

function buildCreativeSelectorCatalogLines(context: AssistantToolContext | undefined) {
  const selectorHints = context?.uiSnapshot?.selectorHints;
  if (selectorHints?.length) {
    return [
      '创意模式 selector：',
      ...selectorHints.map((hint) => formatThemeSelectorHintLine(hint))
    ];
  }

  return buildSelectorCatalogPromptLines({
    activeWorld: context?.uiSnapshot?.activeWorld,
    collectionShelf: context?.uiSnapshot?.collectionShelf,
    modelTier: context?.modelTier,
    chatAvatarLayoutEnabled: context?.uiSnapshot?.chatAvatarLayoutEnabled
  });
}

export function buildCreativeThemeToolRules(context?: AssistantToolContext) {
  const toolEnforcementMode = context?.toolEnforcementMode ?? 'normal';

  return [
    '创意模式把当前皮肤当作一份虚拟 `theme.css` 来编辑。',
    toolEnforcementMode === 'force'
      ? '这轮已经明确进入换肤辅助；写入工具会进入试穿，读取工具只返回 CSS 证据。'
      : null,
    '当前换肤模式：创意模式。把皮肤当作 `theme.css` 文件编辑；replaceThemeCss 写完整 CSS，appendThemeCss 新增规则，editThemeCss 替换已有片段。readThemeCss 只返回当前 CSS 快照，不是每轮通行证。',
    buildCreativeSelectorCatalogLines(context).join('\n'),
    THEME_PRESET_SUMMARY_LINE,
    '规则：',
    '- alias 只是目录里的记号，不是类名；真正落笔只抄上面的 selector，不要把 `chat-background` 写成 `.chat-background`，也不要给 alias 补点。',
    '- 用户点名收藏区、房间、卡片架、代码卡、房间卡或对话卡时，CSS 里必须包含 `.app-shell.collection` / `.world-collection` 这类收藏区 selector；点名对话卡优先用 `.conversation-card`，点名代码卡 / 房间卡优先用 `.code-card`，如果只写了 `.app-shell.chat`，正文不能说收藏区已经变了。',
    '- 用户要求对话区和收藏区一起变时，CSS 必须同时包含 chat selector 和 collection selector。',
    '- 界面角色决定形态：助手正文是阅读文字，工具收据是执行反馈，系统提示是轻状态，输入区是稳定底座。',
    '- 可读性是硬要求：给有文字的面改 background / border / filter 时，同一轮必须确认文字色仍清楚；必要时在同一个 selector 或它的文字子层同步写 `color`，或在 `.app-shell.chat` / `.app-shell.collection` 上同步写 `--text`、`--text-soft`、`--text-muted` 这组变量。',
    '- 不要只把 accent 当文字色直接抹到正文、按钮标签、tab label 或工具收据上；深底用接近白的文字，浅底用接近深墨的文字，弱化文字用透明度而不是低对比同色。',
    '- CSS 必须是浏览器能直接应用的完整规则：写成 `selector { property: value; }`。不要只写 selector 列表，也不要把裸声明直接丢在顶层；只改变量时写进 `.app-shell { --name: value; }`。',
    '- 小改不要清底：新增 selector 用 appendThemeCss；改已有 selector 的局部几行用 editThemeCss；删除误写片段用 deleteThemeCss。保留用户前几轮已经做过的颜色、边框或装饰。',
    '- 整套新皮肤才清底：当用户说“换一套 / 整个房间 / 整页风格”时，用 replaceThemeCss 写完整 CSS，不要把完整皮肤叠在默认 preset 上。',
    '- 小改就只编辑、追加或删除那几个 selector，大改就写一份完整 CSS。',
    '- “框框 / 外框 / 边框 / 硬框 / 框住”通常对应内层壳：顶栏身份区是 `app-topbar-identity`，代码详情是 `chat-code-detail`，工具小票/图标/展开按钮是 `chat-tool-receipt`；背景或外层 topbar 不是这些内层壳。',
    '- inspectThemeRender 只能读取当前已经挂载的界面 DOM。目标在另一个世界时，按当前 theme.css 快照和 selector 目录编辑；不要把 missing 当成 selector 不存在，也不要声称已经完成跨世界视觉检查。',
    '- 聊天气泡可以做 QQ 式图片气泡：`.bubble.user` / `.bubble.assistant` 负责气泡底和正文区域；贴纸、小尾巴、角标或漂浮装饰优先挂到 `.bubble-frame.user::before` / `.bubble-frame.user::after` 或 `.bubble-frame.assistant::before` / `.bubble-frame.assistant::after`，必要时同步让 `.msg-row.*`、`.bubble-frame.*`、`.bubble.*` `overflow: visible`；如果用户给了可访问图片 URL，可以在伪元素里写 `background-image: url("...")`，不要说聊天气泡不支持图片。',
    '- 用户想保存、复用、复制或分享某个部件样式时，把该部件 CSS 包在 `/* @polaris-part target="chat-bubble-user" name="..." */ ... /* @end-polaris-part */` 中；target 用 selector catalog alias。这样的片段粘进 CSS 框会替换同 target 的旧部件，同时保留其他部件。',
    '- 下面列出的 `polaris-asset://...` 是本地可用图片地址，可以直接写成 `url("polaris-asset://...")`；不需要外链图床。',
    '- createImageVariant 会生成 background / bubble-sticker / avatar 变体，并返回可写进 CSS 的 `polaris-asset://...`。',
    '- extractImagePalette 会从图片返回 background / surface / accent / text 建议。',
    '- 气泡装饰图只做视觉层，必须写 `pointer-events: none`，不要遮住正文、复制按钮、工具收据或输入区；正文可读性是硬边界，装饰贴图不清楚时缩小或移到气泡外沿。',
    ...buildThemeImageAssetLines(context),
    '- patchRawCss 是旧入口；appendThemeCss 是新增 CSS 的当前入口。',
    '- 不要再输出坐标动作、surface token 动作或别的创意旧 action。',
    '- 正文自然接话，具体改动结果由系统按执行回填。'
  ].filter((line): line is string => Boolean(line));
}
