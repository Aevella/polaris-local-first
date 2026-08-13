import type { AssistantToolContext } from './assistantToolProtocolTypes';
import { buildBulletPromptLines, buildNumberedPromptLines } from '../promptFormatting';
import { buildToolCardFunctionName, isRunnableToolCodeCard } from '../toolCardRuntime';
import { buildWorkspaceContextPrompt } from './assistantToolPromptWorkspace';
import type { CodeCard } from '../../types/domain';

function buildRoomProjectFitSignals(card: CodeCard) {
  if (card.kind === 'tool') return [];

  const code = card.code.trim();
  if (!code) return [];

  const signals: string[] = [];
  const language = card.language.toLowerCase();
  const hasHtml = /<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<div[\s>]/iu.test(code) || language === 'html';
  const hasStyle = /<style[\s>]|style=|class=|className=|\.([\w-]+)\s*\{/u.test(code) || language === 'css';
  const hasScript = /<script[\s>]|addEventListener|function\s+\w+\s*\(|const\s+\w+\s*=|window\.PolarisRoom/u.test(code) || language === 'javascript' || language === 'tsx';
  const lineCount = code.split(/\r\n|\r|\n/).length;

  if (hasHtml && hasStyle && hasScript) {
    signals.push('HTML、样式和脚本已经混在同一张卡里');
  }
  if (/(?:src|href)=["'][^"']+\.(?:css|js|json|png|jpe?g|webp|svg|gif)(?:[?#][^"']*)?["']/iu.test(code)) {
    signals.push('正文里已经出现外部或本地资源路径引用');
  }
  if (lineCount >= 120 || code.length >= 8000) {
    signals.push('正文已经偏长，后续局部修改会越来越依赖精确锚点');
  }
  if (/window\.PolarisRoom\.(?:getState|setState|patchState|whenReady)|localStorage|sessionStorage|addEventListener/u.test(code)) {
    signals.push('卡内已经有交互状态或事件逻辑，需要持续维护时更适合按文件管理');
  }

  return signals.slice(0, 3);
}

export function buildCardContextPrompt(context: AssistantToolContext | undefined): string {
  if (
    !context
    || (
      !context.activeCard
      && !context.activeProject
      && !(context.retrievedCards?.length)
      && context.visibleCards.length === 0
      && !(context.visibleProjects?.length)
    )
  ) return '';

  const lines: string[] = [];
  const workspaceLocked = Boolean(context.activeProject);
  const workspaceContextPrompt = buildWorkspaceContextPrompt(context);
  if (workspaceContextPrompt) {
    lines.push(workspaceContextPrompt);
  }
  if (!workspaceLocked && context.activeCard) {
    const referenceMode = context.activeCardReferenceMode ?? 'ambient';
    if (referenceMode === 'continue') {
      lines.push(`本轮明确继续修改的房间：${context.activeCard.title}（${context.activeCard.language}） id=${context.activeCard.id} selector=.app-shell.collection .world-collection [data-polaris-card-id="${context.activeCard.id}"]`);
      lines.push('这张房间卡是当前写入目标；target 可以写 active，也可以直接写这个 id。');
    } else if (referenceMode === 'reference') {
      lines.push(`本轮用户附带的参考房间：${context.activeCard.title}（${context.activeCard.language}） id=${context.activeCard.id} selector=.app-shell.collection .world-collection [data-polaris-card-id="${context.activeCard.id}"]`);
      lines.push('这张房间卡先作为参考材料；只有用户明确要求修改这张卡时，才把它当写入目标。');
    } else {
      lines.push(`当前屏幕选中的房间：${context.activeCard.title}（${context.activeCard.language}） id=${context.activeCard.id} selector=.app-shell.collection .world-collection [data-polaris-card-id="${context.activeCard.id}"]`);
      lines.push('当前屏幕选中只表示界面上下文，不代表本轮必须修改它；用户只是聊天、解释问题、报告 Polaris 行为或问系统原因时，不要动这张卡。');
      lines.push('如果用户明确说“这张卡 / 当前卡 / 补封面 / 继续改它”，这张卡就是房间目标；readCodeCard 返回卡片正文和卡面 CSS。');
    }
    if (referenceMode === 'continue' && context.roomContextMode === 'active') {
      lines.push('这张房间的完整正文、卡面小字和卡面 CSS 已作为本轮卡片引用进入对话上下文；这里不重复展开全文。');
    }
    const projectFitSignals = buildRoomProjectFitSignals(context.activeCard);
    if (projectFitSignals.length > 0) {
      lines.push(`当前房间有项目化信号：${projectFitSignals.join('；')}。`);
      lines.push('如果本轮用户要继续扩展、拆 HTML/CSS/JS、反复修 bug、需要运行检查，或希望长期维护，主动建议把这张房间升为工作区；不要在普通房间对话里偷偷拆文件或新建无关工作区。');
    }
  }
  if (!workspaceLocked && context.visibleProjects?.length) {
    lines.push('当前可见工作区：');
    lines.push(
      ...buildNumberedPromptLines(context.visibleProjects, (project) =>
        `${project.title} · slug=${project.slug} · 文件数=${project.fileCount}${project.entryFilePath ? ` · 入口=${project.entryFilePath}` : ''}`
      )
    );
  }
  if (!workspaceLocked) {
    lines.push('房间卡适合单张就能交付、能内联完成、或直接改当前房间的内容。');
    lines.push('工作区适合多条文件路径彼此引用、并且后续要按 `filePath` 分开继续维护的内容；需要工作区时等用户先进入工作区，不要在普通对话里代建。');
  }
  if (!workspaceLocked && context.visibleCards.length > 0) {
    lines.push('当前可见房间：');
    lines.push(
      ...buildNumberedPromptLines(context.visibleCards, (card) =>
        `${card.title}（${card.language}） selector=.app-shell.collection .world-collection [data-polaris-card-id="${card.id}"]`
      )
    );
  }
  const toolCards = context.visibleCards.filter((card) => isRunnableToolCodeCard(card));
  if (toolCards.length > 0) {
    lines.push('当前可调用房间工具：');
    lines.push(
      ...buildNumberedPromptLines(toolCards, (card) =>
        `${card.title} → \`${buildToolCardFunctionName(card)}\`${card.cardNote?.trim() ? ` · ${card.cardNote.trim()}` : ''}`
      )
    );
  }
  if (!workspaceLocked) {
    lines.push('房间卡补充规则：默认卡面已经存在；`cardFaceCss` 是新建或改单张卡时的卡面外观字段。');
    lines.push('卡面底部那句轻写小字走 `cardNote`；不传就沿用默认来源文案。');
    lines.push('卡面 CSS 默认给 `&` 写一个看得见的自由边框；solid / dashed / dotted / double、1px 到 2px、透明彩边或柔和深色都可以，除非用户明确要无边框。');
    lines.push('`cardFaceCss` 只写这张卡自己的局部规则：`&`、`& .code-card-main`、`& h3`、`& .code-card-footer`、`& .code-card-origin`、`& .code-card-time`、`& .tags`。不要再写 `--code-card-face-*`、`--card-bg`、`.code-card-title`。');
    lines.push('房间运行时直接用 `window.PolarisRoom`；简单 `input / textarea / select` 会自动持久化。');
    lines.push('有内部状态的卡通过 `await window.PolarisRoom.whenReady()` 或 `window.PolarisRoom.getState()` 读取状态，通过 `window.PolarisRoom.patchState({ ... })` 写入状态。不要让 checkbox DOM 和你自己的 JS 数组各记一份。');
    if (toolCards.length > 0) {
      lines.push('tool 房间额外能读 `window.PolarisTool.input`、`window.PolarisTool.args`、`window.PolarisTool.card`；需要把一段能力固化成下次可直接调用的工具时，就新建或改成 `kind=tool`。');
    }
  }
  if (!workspaceLocked && context.roomContextMode === 'active' && context.retrievedCards?.length) {
    lines.push('收藏检索结果目录：');
    lines.push(
      ...buildNumberedPromptLines(context.retrievedCards, (card) => [
        `${card.title}（${card.language}） id=${card.id}`,
        card.tags.length ? `标签：${card.tags.join('、')}` : null,
        card.originLabel ? `来源：${card.originLabel}` : null
      ].filter(Boolean).join('\n'))
    );
  }
  return lines.join('\n');
}

export function buildUiContextPrompt(context: AssistantToolContext | undefined): string {
  const ui = context?.uiSnapshot;
  if (!ui) return '';
  const collectionShelfLabel =
    ui.collectionShelf === 'info'
      ? '协作者信息'
      : ui.collectionShelf === 'dialogue'
      ? '对话收藏'
      : ui.collectionShelf === 'image'
        ? '图片收藏'
        : '代码收藏';
  const lines = [
    `当前界面：${ui.activeWorld === 'chat' ? '对话区' : '收藏区'}${ui.activeWorld === 'collection' ? ` · ${collectionShelfLabel}` : ''}`,
    ui.activeConversationTitle
      ? `当前对话：${ui.activeConversationTitle}${ui.activeCollaboratorName ? ` · 协作者=${ui.activeCollaboratorName}` : ''}`
      : ui.activeCollaboratorName
        ? `当前协作者：${ui.activeCollaboratorName}`
        : null,
    ui.activeWorld === 'chat' && ui.chatAvatarLayoutEnabled
      ? [
          '当前是带头像的对话式聊天软件布局，普通文字每次换行都会显示为下一只气泡。',
          '代码、列表、表格、长工具说明和任务账本保持连续完整；多个气泡仍属于同一回合，工具只调用一次。'
        ].join('\n')
      : null
  ].filter(Boolean) as string[];
  return lines.join('\n');
}

export function buildAttachmentContextPrompt(context: AssistantToolContext | undefined): string {
  const snapshot = context?.attachmentSnapshot;
  if (!snapshot || snapshot.available.length === 0) return '';
  const formatAttachmentLine = (attachment: typeof snapshot.available[number]) => {
    const cssAssetUrl = attachment.kind === 'image' && attachment.assetId
      ? ` · themeCss=url("polaris-asset://${attachment.assetId}")`
      : '';
    return `${attachment.id} · ${attachment.name} [${attachment.kind}]${cssAssetUrl}`;
  };
  const latestLines = snapshot.latest.length
    ? [
        '最近一条用户附件：',
        ...buildBulletPromptLines(snapshot.latest, formatAttachmentLine)
      ]
    : [];
  const availableLines = [
    '当前对话可用附件：',
    ...buildBulletPromptLines(snapshot.available, formatAttachmentLine)
  ];
  return [...latestLines, ...availableLines].join('\n');
}

export function buildDesktopLocalContextPrompt(context: AssistantToolContext | undefined): string {
  const host = context?.desktopLocalHost;
  if (!host?.available || host.trustedRoots.length === 0) return '';
  const lines = [
    `本机环境：官网 Mac 桌面宿主 · ${host.permissionMode === 'trusted' ? '信任文件读写' : '每步确认'}`,
    '已授权本机工作区：',
    ...buildNumberedPromptLines(host.trustedRoots, (root) =>
      `${root.label} · rootId=${root.id} · path=${root.path}`
    ),
    '本机文件工具只能使用这些 rootId 和相对路径；省略 rootId 时默认使用第一项。',
    '信任文件读写只影响目录读取、文件读写和同步；命令仍由桌面宿主逐次确认。',
    '工作方式按普通本机开发现场理解：查看目录，读取文件，改真实文件，运行命令，依据 stdout / stderr 和退出码继续下一步。',
    'Polaris 只负责授权边界、工具执行和结果回放；不要把本机工作翻译成另一套内部流程。'
  ];
  return lines.join('\n');
}
