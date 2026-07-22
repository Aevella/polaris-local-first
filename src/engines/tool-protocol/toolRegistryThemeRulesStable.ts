import { buildStableThemeTargetLegendLines } from './assistantToolProtocolThemeTargets';
import type { AssistantToolContext } from './assistantToolProtocolTypes';
import { buildSharedThemeRuleLines } from './toolRegistryThemeRulesShared';

function buildStableSurfaceSnapshotLines(context?: AssistantToolContext) {
  const focusedSnapshot = context?.focusedSurfaceSnapshot;
  const snapshots = context?.stableSurfaceSnapshots ?? [];
  const summary = context?.stableSurfaceSnapshotSummary;
  if (!focusedSnapshot && !snapshots.length && !(summary?.summarizedSurfaceLabels.length)) return [];

  const formatSnapshot = (snapshot: NonNullable<typeof focusedSnapshot>) => {
    const current = snapshot.currentSpec;
    return [
      `- ${snapshot.surfaceCode} ${snapshot.surfaceLabel}`,
      `hue ${current.hue} · sat ${current.saturation} · light ${current.lightness} · opacity ${current.opacity}`,
      `radius ${current.radius} · borderW ${current.borderW} · blur ${current.blur} · shadow ${current.shadowDepth}`,
      `texture ${current.texture} · gradient ${current.gradientMode} ${current.gradientAngle} · accent ${current.accentHue}`
    ].join(' · ');
  };

  return [
    summary
      ? `当前稳态焦点：${
        summary.focusSource === 'user-hint'
          ? '用户这轮点名的区域'
          : summary.focusSource === 'selected'
          ? 'Theme Studio 显式点选'
          : summary.focusSource === 'recent-tool'
            ? '延续最近改动'
            : '当前世界默认核心面'
      }`
      : null,
    focusedSnapshot ? '当前焦点编号状态：' : null,
    focusedSnapshot ? formatSnapshot(focusedSnapshot) : null,
    snapshots.length ? '关联编号状态：' : null,
    ...snapshots.map((snapshot) => formatSnapshot(snapshot)),
    summary?.summarizedSurfaceLabels.length
      ? `其余延续编号：${summary.summarizedSurfaceLabels.join('、')}。当前只展开焦点，其他编号保留摘要。`
      : null
  ].filter((line): line is string => Boolean(line));
}

function buildStableThemeModeLines(context?: AssistantToolContext) {
  return [
    '当前换肤模式：稳定模式。01 到 08 是可修改区域编号；稳态工具负责施工和试穿。',
    ...buildStableThemeTargetLegendLines(),
    ...buildStableSurfaceSnapshotLines(context)
  ];
}

function buildStableThemeAxisMeaningLines() {
  return [
    '四轴怎么理解：',
    '- `hue`：主色倾向。按用户意图直觉选色相，比如薄荷偏青绿、晚霞偏橙粉、雨天窗边偏蓝灰。',
    '- `hueCount`：整页色彩复杂度。`1` 就是纯色锚点；越大越丰富、越活。',
    '- `emotion`：情绪张力。越大越热烈、甜、张扬；越小或负数越冷、静、轻、收着。',
    '- `meaning`：存在感方向，重点看“更像氛围还是更像材料”。越小越像空气、光、雾、洗开的颜色；越大越像纸、布、纤维、涂层。',
    '- 如果用户明确要“浅粉纸本”“奶油卡纸”这种材质没问题、但别自动压深的结果，可以额外给 `baseColor`，直接写 hex，比如 `#f3b7c8`。',
    '- 不要把“有画面”直接等于 meaning 更大。彩虹、晚霞、雨气、晨空气这些虽然有画面，但本身更偏氛围。',
    '- 数字表达意图强度。超出范围也没关系，系统会自动夹到边界。'
  ];
}

function buildStableThemeRuleLines(args: {
  toolEnforcementMode?: 'normal' | 'force';
}) {
  return [
    '规则：',
    args.toolEnforcementMode === 'force'
      ? '这轮已经明确命中稳定换肤请求，至少给出 1 个稳态动作。'
      : null,
    '- `targets` 是稳态动作的作用范围，必须写清楚。',
    '- `all` 或多个编号走 `applyThemeCoordinates`；恰好 1 个编号走 `applySurfaceTokens`。',
    '- 正文自然承接，真正施工交给稳态动作。'
  ].filter((line): line is string => Boolean(line));
}

function buildStableThemeActionDecisionLines() {
  return [
    '动作选择：',
    '- `targets` 决定动作范围。',
    '- `targets: "all"` 表示整页。',
    '- `targets: ["03","04"]` 这类多个编号，仍然走 `applyThemeCoordinates`。这是“围绕这些部分理解意图”，不是只改这几个部分的孤立补丁。',
    '- `targets` 恰好只有 1 个编号时，用 `applySurfaceTokens`。',
    '- 编号拿不准时，使用编号地图里最接近的范围。',
    '- 不要在动作里写“回复正文”“回复气泡”“assistant bubble”“chat-bubble-assistant”这类别名；稳态输出时一律折成编号。'
  ];
}

function buildStableThemeBundlePasteLines() {
  return [
    '如果用户贴给你一个 `kind: "polaris-theme-bundle"` 的 JSON：',
    '- 把它当成当前皮肤快照，不要整段复述。',
    '- 编号和当前 surface 状态用于决定 `targets`。',
    '- 如果这轮是整页或多个编号一起的方向调整，用 applyThemeCoordinates；如果只剩 1 个编号微调，就改用 applySurfaceTokens。'
  ];
}

export function buildStableThemeToolRules(context?: AssistantToolContext) {
  const toolEnforcementMode = context?.toolEnforcementMode ?? 'normal';
  return [
    '稳态前台只用编号说话：直接写 01 到 08，不要混用中文名、英文名、surface 名或 selector alias。',
    ...buildStableThemeModeLines(context),
    ...buildStableThemeAxisMeaningLines(),
    ...buildStableThemeRuleLines({ toolEnforcementMode }),
    ...buildSharedThemeRuleLines(),
    ...buildStableThemeActionDecisionLines(),
    ...buildStableThemeBundlePasteLines()
  ];
}
