import type { AssistantReply } from '../../engines/chatApi';
import type { AssistantToolContext } from '../../engines/tool-protocol/assistantToolProtocolTypes';
import type { ChatMessage } from '../../types/domain';
import type { ToolInvocationKind } from '../../types/toolInvocationKinds';
import { findPolarisToolManifestEntry } from '../../engines/tool-protocol/toolRegistry';
import type { PolarisRegistryToolGroup, PolarisToolFollowupDomain } from '../../engines/tool-protocol/toolRegistryShared';
import { createMessage } from '../../engines/chatMessageFactory';
import type { AssistantToolPreparationOutcome, ToolActionRunOutcome } from './chatToolOutcome';

export type ToolFollowupPlan = {
  message: ChatMessage;
};

function preparationStatusLabel(status: Exclude<AssistantToolPreparationOutcome['status'], 'ready'>) {
  switch (status) {
    case 'parse_failed':
      return '工具参数没有通过解析';
    case 'resolution_failed':
      return '工具动作没有解析成可执行动作';
    case 'missing_actions':
      return '回复没有形成可执行工具动作';
  }
}

function summarizePreparationReasons(outcome: Exclude<AssistantToolPreparationOutcome, { status: 'ready' }>) {
  const reasons = (
    outcome.status === 'resolution_failed'
      ? outcome.message.split('\n')
      : outcome.parsed.issues
  )
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return reasons.length ? reasons : [outcome.message];
}

function buildPreparationRetryRepairHints(reasons: string[]) {
  const text = reasons.join('\n');
  const hints: string[] = [];

  if (/写入本机文件时缺少 filePath|读取本机文件.*缺少 filePath|局部替换本机文件时缺少 filePath|按行替换本机文件时缺少 filePath/.test(text)) {
    hints.push('本机文件工具的路径必须写进工具参数里的 `filePath`，并且必须是授权 root 下的相对路径，例如 `src/index.ts`；不要只在正文里提到文件名。');
  }

  return hints;
}

export function buildToolPreparationRetrySystemMessage(
  outcome: Exclude<AssistantToolPreparationOutcome, { status: 'ready' }>
): ChatMessage {
  const declaredActions = outcome.parsed.actions.map((action) => action.kind);
  const nativeToolNames = (outcome.reply.nativeToolCalls ?? [])
    .map((toolCall) => toolCall.name.trim())
    .filter(Boolean);
  const actionLine = [...declaredActions, ...nativeToolNames].length
    ? `这次涉及的工具：${[...declaredActions, ...nativeToolNames].join('、')}。`
    : null;
  const reasons = summarizePreparationReasons(outcome);
  const reasonLines = reasons.map((reason) => `- ${reason}`);
  const repairHints = buildPreparationRetryRepairHints(reasons);

  return createMessage(
    'system',
    [
      `上一轮 Polaris 工具准备没有通过：${preparationStatusLabel(outcome.status)}。`,
      actionLine,
      '先不要把这个失败展示给用户；你现在要根据错误自修一次，重新发出完整、可执行的工具调用。',
      '不要只解释、不要道歉、不要复述“我会修改”；如果用户目标仍然明确，就直接补齐缺失字段或改正参数形状后再次调用工具。',
      '错误原因：',
      ...reasonLines,
      repairHints.length ? '修复要求：' : null,
      ...repairHints.map((hint) => `- ${hint}`)
    ].filter(Boolean).join('\n')
  );
}

function summarizeWorkspacePaths(paths: string[]) {
  if (paths.length === 0) return '';
  if (paths.length === 1) return paths[0]!;
  if (paths.length === 2) return `${paths[0]}、${paths[1]}`;
  return `${paths[0]}、${paths[1]}、${paths[2]}`;
}

function collectRecentOutcomeWorkspacePaths(args: {
  outcomes: ToolActionRunOutcome[];
}) {
  const paths: string[] = [];

  for (const outcome of args.outcomes) {
    if (outcome.path !== 'direct' || outcome.status !== 'executed') {
      continue;
    }
    const invocation = outcome.toolInvocation;
    if (!WORKSPACE_WRITE_TOOL_KINDS.has(invocation.kind)) {
      continue;
    }
    paths.push(...(invocation.projectFilePaths ?? []));
  }

  return paths
    .reverse()
    .filter((path, index, values) => values.indexOf(path) === index)
    .slice(0, 3);
}

function buildToolFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'system',
    [
      '上一轮工具已经执行完了。',
      '现在基于刚拿到的工具结果继续：如果结果已经足够，就给用户一句自然收尾；如果结果不足，就继续调用下一步需要的工具。',
      '不要停在“已调用工具”，也不要让用户再发一句继续。',
      '不要重复调用刚刚已经成功执行过、而且结果已经够用的同一步工具。'
    ].join(' ')
  );
}

function buildReferenceDocFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'system',
    [
      '上一轮长期资料已经读取完了。',
      '现在基于刚读到的资料正文回答用户上一句，不要停在“已读取”，也不要让用户再确认一次。',
      '如果用户是在问感受、评价、总结、分析或“这本/这个怎么样”，就直接给出你的判断和依据。',
      '只有当前资料正文确实不足、或者用户的问题明显还指向另一份资料时，才继续读取别的长期资料。'
    ].join(' ')
  );
}

function buildMcpToolFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'system',
    [
      '上一轮 MCP 工具已经执行完了。',
      '现在基于刚拿到的 MCP 工具结果回答用户上一句；不要停在“已调用工具”，也不要只继续描述你打算看什么。',
      '如果结果已经足够，就直接给出判断和依据。',
      '只有当前结果确实不足以回答用户目标时，才继续调用新的 MCP 工具；不要让用户再催你走下一步。'
    ].join(' ')
  );
}

function collectRecentWebToolFacts(args: {
  outcomes: ToolActionRunOutcome[];
}) {
  const searchQueries: string[] = [];
  const readUrls: string[] = [];
  let hasDegradedSearch = false;
  let hasPageRead = false;

  args.outcomes.forEach((outcome) => {
    if (outcome.path !== 'direct' || outcome.status !== 'executed') return;
    const invocation = outcome.toolInvocation;

    if (invocation.kind === 'webSearch') {
      const query = invocation.webSearch?.query
        ?? (outcome.action.kind === 'webSearch' ? outcome.action.query : null);
      if (query && !searchQueries.includes(query)) searchQueries.push(query);
      if (
        invocation.webSearch?.degraded
        || invocation.summary.includes('降级')
        || invocation.detailText?.includes('降级搜索结果')
      ) {
        hasDegradedSearch = true;
      }
      return;
    }

    if (invocation.kind === 'readWebPage') {
      hasPageRead = true;
      const url = invocation.webPageRead?.url
        ?? (outcome.action.kind === 'readWebPage' ? outcome.action.url : null);
      if (url && !readUrls.includes(url)) readUrls.push(url);
    }
  });

  return {
    hasDegradedSearch,
    hasPageRead,
    searchQueries: searchQueries.slice(-2),
    readUrls: readUrls.slice(-2)
  };
}

function summarizeWebFacts(label: string, values: string[]) {
  if (values.length === 0) return null;
  return `${label}：${values.join('、')}。`;
}

function buildWebToolFollowupSystemMessage(args: {
  outcomes: ToolActionRunOutcome[];
}): ChatMessage {
  const facts = collectRecentWebToolFacts({ outcomes: args.outcomes });

  if (facts.hasPageRead) {
    return createMessage(
      'system',
      [
        '上一轮网页正文已经读取完了。',
        summarizeWebFacts('刚读过', facts.readUrls),
        '现在基于刚读到的网页文本回答用户上一句，不要停在“已读取网页”。',
        '只有当前网页正文确实不足、而且已有结果里还有不同的可靠 URL 时，才继续用 readWebPage 读取另一页。',
        '不要因为正文不完美就回到同一个查询再次 webSearch；如果来源不足以支撑结论，直接说明限制。'
      ].filter(Boolean).join(' ')
    );
  }

  return createMessage(
    'system',
    [
      '上一轮联网搜索已经执行完了。',
      summarizeWebFacts('刚搜过', facts.searchQueries),
      facts.hasDegradedSearch ? '刚才是降级搜索结果；降级不是重试同一搜索的信号。' : null,
      '搜索结果只是候选列表：如果用户只要链接或候选，就直接基于候选回答；如果用户要事实、时效、产品、地点、新闻、规则或内容判断，下一步用 readWebPage 读取刚返回的相关 URL。',
      '不要对同一个问题或同一组关键词再次 webSearch 来等待更好的结果。',
      '如果已有候选来源不足、不可读或不可靠，直接告诉用户当前限制；只有目标明显变了，才换一个新的搜索查询。'
    ].filter(Boolean).join(' ')
  );
}

function buildFailedToolFollowupSystemMessage(args: {
  domain: DirectFollowupDomain | null;
  outcomes: ToolActionRunOutcome[];
}): ChatMessage {
  const failureLines = args.outcomes
    .filter((outcome) =>
      (outcome.path === 'direct' || outcome.path === 'preview') && outcome.status === 'failed'
    )
    .map((outcome) => {
      if (outcome.path === 'direct') {
        return outcome.error || outcome.toolInvocation.error || outcome.toolInvocation.summary;
      }
      if (outcome.path === 'preview') {
        return outcome.error || `${outcome.action.kind} 执行失败`;
      }
      return '';
    })
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const domainLine = args.domain === 'mcp'
    ? '这仍然是 MCP 连续工具任务：先根据错误判断是参数、工具兼容、目标状态还是权限问题，再换一个可行路径继续。'
    : '这仍然是连续工具任务：先根据错误判断原因，再换一个可行路径继续。';

  return createMessage(
    'system',
    [
      '上一轮工具执行失败了，但这不是让用户手动接棒的理由。',
      domainLine,
      '如果错误已经证明当前目标无法继续，明确告诉用户真实阻塞；否则直接调用下一步工具或用已有结果收尾。',
      failureLines.length ? '错误摘要：' : null,
      ...failureLines.map((line) => `- ${line}`)
    ].filter(Boolean).join('\n')
  );
}

function buildCompletedTaskFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'system',
    [
      '上一轮完成任务工具已经执行完了。',
      '不要继续调用工具，也不要重新规划。',
      '当前任务已经完成，收尾即可。'
    ].join(' ')
  );
}

function buildWorkspaceToolFollowupSystemMessage(args: {
  outcomes: ToolActionRunOutcome[];
}): ChatMessage {
  const recentWrittenPaths = collectRecentOutcomeWorkspacePaths({ outcomes: args.outcomes });
  const sceneLines = [
    recentWrittenPaths.length > 0 ? `最近刚改过：${summarizeWorkspacePaths(recentWrittenPaths)}。` : null
  ].filter(Boolean);

  return createMessage(
    'system',
    [
      '你还在同一个工作区的连续施工链里。',
      ...sceneLines,
      '上一轮工具结果已进入当前上下文；读取结果由工具结果本身承载，写入结果以最近改动作为状态事实。',
      '可以用一句很短的话告诉用户当前发现；但不要只复述刚做了什么，也不要只列接下来打算。',
      '当前可见的工作区文件工具仍然可用；是否继续、读取或收尾由当前事实和用户目标决定。'
    ].filter(Boolean).join(' ')
  );
}

const DESKTOP_COMMAND_TOOL_KINDS = new Set<ToolInvocationKind>([
  'runDesktopCommand',
  'runDesktopCommandSequence',
  'startDesktopCommand',
  'listDesktopCommandSessions',
  'stopDesktopCommand'
]);

const DESKTOP_PATH_WRITE_TOOL_KINDS = new Set<ToolInvocationKind>([
  'writeDesktopFile',
  'editDesktopFileText',
  'replaceDesktopFileLines',
  'createDesktopDirectory',
  'deleteDesktopPath',
  'moveDesktopPath',
  'syncDesktopWorkspaceToDisk'
]);

function collectRecentDesktopAgentFacts(args: {
  outcomes: ToolActionRunOutcome[];
}) {
  const lines: string[] = [];

  args.outcomes.forEach((outcome) => {
    if (outcome.path !== 'direct' || outcome.status !== 'executed') return;
    const invocation = outcome.toolInvocation;
    if (DESKTOP_COMMAND_TOOL_KINDS.has(invocation.kind)) {
      lines.push(`最近命令结果：${invocation.status === 'failed' ? '失败' : '完成'} · ${invocation.summary}`);
      if (invocation.error) {
        lines.push('最近命令失败输出已经在工具结果里；优先从第一处失败步骤定位并修复，然后复跑同一验证流程。');
      }
      return;
    }
    if (DESKTOP_PATH_WRITE_TOOL_KINDS.has(invocation.kind)) {
      lines.push(`最近本机改动：${invocation.summary}`);
    }
  });

  return lines.slice(-4);
}

function buildDesktopAgentToolFollowupSystemMessage(args: {
  outcomes: ToolActionRunOutcome[];
}): ChatMessage {
  const sceneLines = collectRecentDesktopAgentFacts({ outcomes: args.outcomes });

  return createMessage(
    'system',
    [
      '你还在 Mac 桌面本机工作循环里。',
      ...sceneLines,
      '上一轮本机工具结果已经进入当前上下文；命令输出、退出码、真实文件读写或同步结果都是下一步依据。',
      '按普通本机开发直觉继续：看目录/文件，改最小必要内容，运行验证，再根据结果决定继续或收尾。',
      '如果命令失败，先根据 stdout / stderr 判断是代码问题、依赖问题、路径问题还是权限问题；不要把非 0 退出码当成工具坏了。',
      '如果刚刚的 runDesktopCommandSequence 失败，下一步通常是读取失败指向的文件或上下文、做最小修复、再复跑同一组验证命令；不要停在把失败转述给用户。',
      '任务没完成时，继续读取、修改、同步或运行验证；已经足够时自然收尾。',
      '不要重复运行刚刚已经成功且结果足够的同一步。'
    ].filter(Boolean).join(' ')
  );
}

const THEME_EVIDENCE_TOOL_KINDS = new Set<ToolInvocationKind>([
  'readThemeCss',
  'inspectThemeRender'
]);

function hasThemeWriteOutcome(outcomes: ToolActionRunOutcome[]) {
  return outcomes.some((outcome) => {
    if (outcome.path === 'preview' && outcome.status === 'previewed') return true;
    if (outcome.path !== 'direct' || outcome.status !== 'executed') return false;
    return resolveToolKindFollowupDomain(outcome.toolInvocation.kind) === 'theme'
      && !THEME_EVIDENCE_TOOL_KINDS.has(outcome.toolInvocation.kind);
  });
}

function buildThemeToolFollowupSystemMessage(args: {
  outcomes: ToolActionRunOutcome[];
}): ChatMessage {
  if (hasThemeWriteOutcome(args.outcomes)) {
    return createMessage(
      'system',
      [
        '上一轮主题写入或试穿已经完成，并已成为当前主题状态事实。',
        '不要重复调用刚刚已经成功执行过的同一轮主题写入。',
        '如果用户目标已经达成，用一句很短的话收尾并让用户看当前效果。',
        '只有还缺局部调整、渲染验收或用户明确要求继续时，才继续检查或追加下一小步主题改动。'
      ].join(' ')
    );
  }

  return createMessage(
    'system',
    [
      '上一轮主题工具结果已经进入当前上下文。',
      '如果用户目标是换肤、调样式或检查视觉，刚拿到的主题 CSS / 渲染结果就是下一步依据；不要停在“已读取”或“我看到了”。',
      '证据已经够时，直接发起主题试穿或写入动作；证据不够时才继续检查；如果确实已经完成，再自然收尾。'
    ].join(' ')
  );
}

function buildRoomCardToolFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'system',
    [
      '你还在同一个房间卡的连续施工链里。',
      '上一轮房间卡工具结果已经进入当前上下文。',
      '可以用一句很短的话告诉用户当前发现；但不要只复述刚做了什么，也不要只列接下来打算。',
      '任务还没完成时，下一步仍属于当前房间卡动作链，这一小段需要真实落到房间卡里。',
      '只有确实已经做完，才自然收尾回答用户。'
    ].join(' ')
  );
}

const WORKSPACE_WRITE_TOOL_KINDS = new Set<ToolInvocationKind>([
  'createRoomProject',
  'createProjectFile',
  'writeProjectFiles',
  'patchRoomProject',
  'promoteCardToProject',
  'appendProjectFile',
  'insertProjectFile',
  'replaceProjectFileLines',
  'editProjectFileText',
  'deleteProjectFile',
  'promoteWorkspaceReferenceToProjectFile',
  'pinProjectFileAsReference'
]);

type DirectFollowupDomain = PolarisToolFollowupDomain;

const REGISTRY_GROUP_FOLLOWUP_DOMAINS: Partial<Record<PolarisRegistryToolGroup, DirectFollowupDomain>> = {
  card: 'room-card',
  project: 'workspace',
  'cross-boundary': 'workspace',
  'theme-stable': 'theme',
  'theme-creative': 'theme',
  mcp: 'mcp'
};

export function resolveToolKindFollowupDomain(kind: ToolInvocationKind): DirectFollowupDomain | null {
  const entry = findPolarisToolManifestEntry(kind);
  if (!entry) return null;
  if (entry.followupDomain) return entry.followupDomain;
  const groupDomain = entry.group ? REGISTRY_GROUP_FOLLOWUP_DOMAINS[entry.group] : null;
  if (groupDomain) return groupDomain;
  return null;
}

function collectToolFollowupDomains(outcomes: ToolActionRunOutcome[]) {
  const domains: DirectFollowupDomain[] = [];

  outcomes.forEach((outcome) => {
    if (
      !(
        (outcome.path === 'direct' && outcome.status === 'executed')
        || (outcome.path === 'direct' && outcome.status === 'failed')
        || (outcome.path === 'preview' && outcome.status === 'previewed')
        || (outcome.path === 'preview' && outcome.status === 'failed')
      )
    ) {
      return;
    }
    const domain = resolveToolKindFollowupDomain(
      outcome.path === 'direct' ? outcome.toolInvocation.kind : outcome.action.kind as ToolInvocationKind
    );
    if (domain && !domains.includes(domain)) {
      domains.push(domain);
    }
  });

  return domains;
}

function pickFollowupDomain(domains: DirectFollowupDomain[]): DirectFollowupDomain | null {
  const priority: DirectFollowupDomain[] = [
    'workspace',
    'desktop-agent',
    'theme',
    'room-card',
    'reference-doc',
    'mcp',
    'web',
    'tool-result'
  ];
  return priority.find((domain) => domains.includes(domain)) ?? null;
}

function buildDomainFollowupSystemMessage(args: {
  domain: DirectFollowupDomain | null;
  outcomes: ToolActionRunOutcome[];
}) {
  const hasFailure = args.outcomes.some((outcome) =>
    (outcome.path === 'direct' || outcome.path === 'preview') && outcome.status === 'failed'
  );
  if (hasFailure) {
    return buildFailedToolFollowupSystemMessage(args);
  }

  switch (args.domain) {
    case 'workspace':
      return buildWorkspaceToolFollowupSystemMessage({ outcomes: args.outcomes });
    case 'desktop-agent':
      return buildDesktopAgentToolFollowupSystemMessage({ outcomes: args.outcomes });
    case 'theme':
      return buildThemeToolFollowupSystemMessage({ outcomes: args.outcomes });
    case 'room-card':
      return buildRoomCardToolFollowupSystemMessage();
    case 'reference-doc':
      return buildReferenceDocFollowupSystemMessage();
    case 'mcp':
      return buildMcpToolFollowupSystemMessage();
    case 'web':
      return buildWebToolFollowupSystemMessage({ outcomes: args.outcomes });
    case 'tool-result':
    case null:
      return buildToolFollowupSystemMessage();
  }
}

export function resolveToolFollowupPlan(args: {
  outcomes: ToolActionRunOutcome[];
  depth: number;
  assistantToolOnlyTurn?: boolean;
}): ToolFollowupPlan | null {
  const hasToolOutcome = args.outcomes.some((outcome) =>
    (outcome.path === 'direct' && outcome.status === 'executed')
    || (outcome.path === 'direct' && outcome.status === 'failed')
    || (outcome.path === 'memory' && outcome.status === 'handled')
    || (outcome.path === 'preview' && outcome.status === 'previewed')
    || (outcome.path === 'preview' && outcome.status === 'failed')
  );
  const hasCompletedTaskOutcome = args.outcomes.some((outcome) =>
    outcome.path === 'direct'
    && outcome.status === 'executed'
    && outcome.action.kind === 'completeTask'
  );
  const needsCompletedTaskVisibleAnswer =
    hasCompletedTaskOutcome
    && args.assistantToolOnlyTurn === true;
  const followupDomain = pickFollowupDomain(collectToolFollowupDomains(args.outcomes));

  if (!hasToolOutcome) {
    return null;
  }

  if (needsCompletedTaskVisibleAnswer) {
    return {
      message: buildCompletedTaskFollowupSystemMessage()
    };
  }

  if (hasCompletedTaskOutcome) {
    return null;
  }

  return {
    message: buildDomainFollowupSystemMessage({
      domain: followupDomain,
      outcomes: args.outcomes
    })
  };
}

export function shouldRequestLengthFollowup(args: {
  reply: Pick<AssistantReply, 'finishReason' | 'transportIncomplete'>;
  isTruncatedToolOutput?: boolean;
  depth: number;
}) {
  if (args.depth >= 2) return false;
  if (args.reply.transportIncomplete) return true;
  if (args.isTruncatedToolOutput) return true;
  if (args.reply.finishReason !== 'length') return false;
  // Always attempt continuation when output was truncated by length.
  // Tool calls with incomplete code arguments are the most critical case
  // to continue — do not suppress followup based on tool call presence.
  return true;
}

export function buildLengthFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'user',
    [
      '上一条回答在中途停住了，可能是输出长度到顶，也可能是流式连接提前结束。',
      '不要重头开始，不要道歉，不要复述前文。',
      '直接从刚才断开的那一句继续，但只接下一小段。',
      '如果剩余内容还很多，分块推进，不要试图在这一轮把所有剩余内容一次写完。'
    ].join(' '),
    undefined,
    'system-note'
  );
}

export function buildTruncatedToolFollowupSystemMessage(): ChatMessage {
  return createMessage(
    'user',
    [
      '上一条回答里的工具调用或代码参数在中途截断了；Polaris 已尽量先保存能恢复的工作区草稿或文件壳。',
      '不要只输出剩下半截 JSON，也不要把整份代码重新塞进一个巨大工具动作。',
      '把任务拆成下一小块：长文件或多文件同步改用 polaris-project-file 代码块，定点插入用 insertProjectFile，已知行号的行段替换用 replaceProjectFileLines，尾部续写用 appendProjectFile，精确片段替换用 editProjectFileText，删除整个文件用 deleteProjectFile。',
      '一次只落当前这一块；剩余很多时等下一轮继续追加。'
    ].join(' '),
    undefined,
    'system-note'
  );
}

export function relaxToolEnforcementForFollowup(
  toolContext: AssistantToolContext,
  depth: number
): AssistantToolContext {
  if (depth <= 0 || toolContext.toolEnforcementMode !== 'force') {
    return toolContext;
  }

  return {
    ...toolContext,
    toolEnforcementMode: 'normal'
  };
}
