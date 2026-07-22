export function buildCardFacePromptLines() {
  return [
    '`cardFaceCss` 是单张房间卡 / 代码卡的局部卡面 CSS，作用域已经自动收在卡内；`&` 表示这张卡的卡面根节点。它不作用于对话架里的对话卡。',
    '卡面、封面、皮肤、像礼物/档案/样张这些说法属于 `cardFaceCss` 作用域；正文 HTML 或 `<style>` 属于卡片正文作用域。',
    '可用真实节点只有这些：`&`、`& .code-card-main`、`& .card-meta-row`、`& .card-meta-row small`、`& h3`、`& .code-card-origin`、`& .code-card-snippet`、`& .tags`、`& .tags span`、`& .code-card-run-dot`、`& .code-card-run-dot::before`、`&::before`、`&::after`。',
    '卡面边框是可见卡面的一部分；边框格式自由，按这张卡的气质选择 solid / dashed / dotted / double、1px 到 2px、透明彩边或柔和深色都可以，除非用户明确要无边框。',
    '纯封面不需要新组件：`& .card-meta-row`、`& .code-card-origin`、`& .code-card-snippet`、`& .tags` 都是可隐藏节点，`& h3` 或 `& .code-card-main::before` 可以承载主视觉。',
    '不要再写 `--code-card-face-*`、`--card-bg`、`.code-card-title` 这种 Polaris 里不存在或已经没人消费的名字。'
  ];
}
