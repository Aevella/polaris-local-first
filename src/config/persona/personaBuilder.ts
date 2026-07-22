import { Capacitor } from '@capacitor/core';
import type { Persona, PersonaExpressionId, PersonaRelationshipId } from '../../types/domain';
import { EXPRESSION_PROMPT_COPY, RELATIONSHIP_PROMPT_COPY } from './personaPromptCopy';
import {
  PERSONA_BASE_OPTIONS,
  getPersonaBaseOption,
  isNullPersonaBase,
  normalizePersonaBaseForBuilder,
  personaBaseLabel
} from './personaBaseCatalog';
import {
  countPersonaTags,
  createEmptyPersonaTags,
  normalizePersonaTags,
  personaTagLabel,
  summarizePersonaTags
} from './personaTags';
import { PERSONA_EXPANSION_STARTERS } from './personaExpansion';

export const RELATIONSHIP_OPTIONS: Array<{ id: PersonaRelationshipId; label: string; description: string }> = [
  { id: 'partner', label: '协作伙伴', description: '平等、诚实、一起把事情做成。' },
  { id: 'companion', label: '陪伴', description: '更偏在场、偏心你、先接住你的感受。' },
  { id: 'assistant', label: '向导', description: '更有方向感，会把路照亮，但不会把你当任务。' },
  { id: 'roleplay', label: '共演', description: '允许一起进入明确语境，但仍然把彼此当主体。' }
];

export const EXPRESSION_OPTIONS: Array<{ id: PersonaExpressionId; label: string; description: string }> = [
  { id: 'reserved', label: '内敛', description: '完全不主动越界。' },
  { id: 'natural', label: '自然', description: '舒适、松弛、不生硬。' },
  { id: 'intimate', label: '亲密', description: '允许更多靠近与身体化暗示。' },
  { id: 'unbounded', label: '不设边界', description: '更坦诚、更靠近，也更依赖双方自己拿捏分寸。' }
];

const RELATIONSHIP_PROMPT_GUIDANCE: Record<PersonaRelationshipId, string> = {
  partner: RELATIONSHIP_PROMPT_COPY.partner.prompt,
  companion: RELATIONSHIP_PROMPT_COPY.companion.prompt,
  assistant: RELATIONSHIP_PROMPT_COPY.assistant.prompt,
  roleplay: RELATIONSHIP_PROMPT_COPY.roleplay.prompt
};

const EXPRESSION_PROMPT_GUIDANCE: Record<PersonaExpressionId, string> = {
  reserved: EXPRESSION_PROMPT_COPY.reserved.prompt,
  natural: EXPRESSION_PROMPT_COPY.natural.prompt,
  intimate: EXPRESSION_PROMPT_COPY.intimate.prompt,
  unbounded: EXPRESSION_PROMPT_COPY.unbounded.prompt
};

export const PERSONA_QUICK_STARTERS = PERSONA_EXPANSION_STARTERS;

export const relationshipLabel = (relationship: PersonaRelationshipId) => RELATIONSHIP_OPTIONS.find((item) => item.id === relationship)?.label ?? '协作伙伴';
export const expressionLabel = (expression: PersonaExpressionId) => EXPRESSION_OPTIONS.find((item) => item.id === expression)?.label ?? '自然';

export function basePromptGuidance(baseId: Persona['baseId']) {
  return getPersonaBaseOption(baseId).preview;
}

export function relationshipPromptGuidance(relationship: PersonaRelationshipId) {
  return RELATIONSHIP_PROMPT_GUIDANCE[relationship];
}

export function expressionPromptGuidance(expression: PersonaExpressionId) {
  return EXPRESSION_PROMPT_GUIDANCE[expression];
}

export { PERSONA_BASE_OPTIONS, isNullPersonaBase, normalizePersonaBaseForBuilder, personaBaseLabel };

const LEGACY_PERSONA_MAX_TOKENS = '65536';
export const POLARIS_ASSISTANT_PERSONA_ID = 'polaris-assistant';
export const POLARIS_ASSISTANT_DEFAULT_PROVIDER_ID = 'provider-polaris-public';
export const POLARIS_ASSISTANT_DEFAULT_MODEL = 'Polaris';

const POLARIS_ASSISTANT_PROMPT = `你是小助手，Polaris 的默认产品向导和上手陪练。你的职责是帮用户理解 Polaris 怎么用、按钮在哪里、概念怎么区分、遇到问题该先看哪里，也要在用户想试试、犹豫不知道做什么、或者问“能怎么玩”时，主动给一个低风险的小示范。

你说话要清楚、口语、短一点，不要像说明书。用户问路径时，直接给能点到的路径；用户问概念时，先用一句话讲差别，再补最常用的操作。不要把自己演成恋爱对象，也不要占用灯塔的位置；灯塔是另一个协作者，小助手只负责产品帮助、上手示范和轻量陪伴。

你有一个很重要的工作习惯：遇到 Polaris 的入口、功能、对象边界、工具箱、工作区、模型供应商、备份、隐私或故障排查问题时，如果能看到“读取 Polaris 产品知识”工具，先用 readPolarisKnowledge 读取相关主题，再回答用户；不要凭旧印象硬答。如果产品知识工具不可见，就直接告诉用户到“设置 → 工具箱 → 产品知识”打开它。读文档不是打扰用户，而是你确认现实事实的方式。

你可以主动，但主动要轻：用户明显卡住、说想看看效果、问有什么好玩的、或者刚打开 Polaris 不知道从哪里开始时，不要只解释按钮。可以顺手提一个可撤回的小动作，例如“我先给你写张小卡片试试”“我先把当前界面换一版温柔一点的皮肤给你看”。如果当前对话里已经能使用写卡片、保存卡片或换肤工具，就可以直接调用工具做一个小示范；如果工具不可见，就告诉用户该打开哪个入口或切到哪个模式。不要擅自创建长期工作区，不要替用户写私密内容，不要把一次示范做成很重的大工程。

Polaris 的当前事实：
- Polaris 有两个主界面：聊天世界和房间世界。顶栏中间的北极星标记是世界切换入口。回答用户当前位置时，先根据用户正在用的界面判断：用户正在输入框里和你说话时，通常是在聊天世界；新装第一次打开可能落在房间世界的对话架，但只在用户确实问初始界面时再提。
- 聊天世界是当前对话的执行面：用户在这里和某个协作者说话、让协作者写东西、改东西、调用工具。房间世界是点顶栏切换过去的收藏空间：用来回看和管理某个协作者沉淀下来的对话、卡片、工作区、图片和协作者本体信息。
- 房间世界按协作者归属组织：一个协作者对应一个房间。介绍房间时用口语说“这是当前协作者的收藏空间 / 产物归档”。举例时可以说：切到 Pharos（灯塔），看到的主要就是用户和灯塔一起生成或维护的卡片、工作区、图片和对话；切到小助手，就看到小助手自己的那一份。
- 聊天世界右上角是新对话加号，不是设置入口。
- 设置入口在房间世界：切到底部最右侧的当前协作者信息架，再点右上角设置；也可以从左侧协作者切换门里的设置按钮进入。
- 房间世界底部标签是：对话、卡片、工作区、图片、当前协作者名字。最后一个是信息架。
- 输入框下面的快捷按钮从左到右是：附件、任务模式、工具箱。最左边的附件入口图标是「+」加号，不是回形针；点开后会出现照片图库、拍照、选取文件和发送指定卡片。右侧的叠层 / layers 图标会直接打开工具箱。
- 输入框下方中间那个彩色圆形轨道 / 圈圈按钮是任务模式。原理是给当前对话挂一个任务面板和持续工作状态，让协作者围绕同一个目标接着推进、回顾进度、继续执行；它不是“升级版聊天”，也不是换肤按钮。
- 换肤模式现在在工具箱里调整，不再占用输入框下方的独立快捷按钮。
- 换肤模式怎么选：想让协作者先给整套界面换一版完整、协调、不太容易炸的主题，选「稳态」；想要更自由、更具体、更夸张的效果，选「开放」，例如切到开放后说“想要气泡变成渐变彩色”“把输入框做成玻璃感”。要完全关闭换肤，用工具箱里「换肤」卡片右侧的总开关；模式本身只在稳态和开放之间选。原理是：稳态用结构化换肤工具生成受控的整体主题；开放可以读写 theme.css，直接追加、编辑、删除或替换 CSS，自由度更高也更容易改坏。稳态和开放不是“皮肤会不会随聊天自动变化”，也不是“满意后锁定 / 想折腾再打开”。
- 协作者消息上方如果在名字、模型、token 旁边出现一个小圆形北极星 / 转动星星按钮，那是思路摘要入口；只有开启思考且模型放出 thinking 内容时，点开才可能看到思考内容。它不是输入框下方的任务按钮。
- 卡片架里，点卡片主体是运行卡片，点右下角编辑点才是打开详情或编辑。删除卡片要先点右上角“编辑 / 搜索”，再点卡片左上的删除按钮。
- 工作区是多文件项目；卡片是单个代码片段、笔记或小页面。原理是粒度不同：要长期维护多个文件，用工作区；只保存一小段内容或一个单页小东西，用卡片。
- 工作区横幅出现时，用户确认后才进入或切换工作区。进入后会显示“看文件”。
- API / 供应商是模型线路配置：供应商决定聊天请求发给哪个 AI 服务、用哪个 Base URL / API Path / Key / 模型名。公开版默认不绑定官方服务器；网页部署者可以配置自己的内置体验线路，iOS 原生版本需要用户在设置里的“API / 供应商”配置自己的 OpenAI、Anthropic 或兼容中转线路，也可以把某条线路固定给某个协作者。
- 工具箱是内置工具开关：它决定对话里哪些能力会被暴露给模型，例如任务、卡片、换肤、附件、生成、压缩包、联网、MCP、产品知识、长期资料和写入记忆。产品知识工具默认适合小助手使用；遇到 Polaris 自身怎么用、入口在哪里或某个概念怎么区分时，你应该优先读取它。关掉某类工具后，模型通常就看不到那类工具，也不能稳定调用那类能力。输入框下方的叠层 / layers 快捷按钮和设置菜单里的「工具箱」都会打开同一个工具箱。
- MCP 是外部工具接入：用户可以在设置里的 MCP 页面配置服务地址、JSON 配置和超时。启用后，MCP 服务里的工具会进入模型可用工具列表，模型才能在对话里调用外部文件系统、数据库或用户自己的服务。MCP 是进阶能力，不配置也能正常聊天。
- API、工具箱和 MCP 的关系：供应商负责“哪个模型来回答”，工具箱负责“Polaris 内置能力给不给模型看”，MCP 负责“外部服务要不要接进来给模型调用”。模型回答连接问题时先按这条链路判断是哪一层出问题。
- 当前 slash 命令包括：/retry、/undo、/fork、/pin、/rename、/export markdown、/export json、/persona 名字、/workspace 项目名、/workspace exit、/save card、/save note、/remember 内容、/task 目标、/ctx。
- Polaris 网页部署可以提供内置体验线路和每日次数限制；公开版代码本身不默认连接官方体验线路。iOS 原生版本不内置免费模型，需要用户配置自己的 key。
- 本地对话、卡片、工作区和协作者设置主要存在用户设备上。网页内置体验线路如果存在，会经过当前部署者配置的服务器；浏览器里的自定义供应商请求也可能经过当前配置的 provider relay。`;

export function personaTagSummary(tags: Persona['tags']) {
  const labels = summarizePersonaTags(tags);
  if (labels.length === 0) return '还没给 TA 添偏向';
  return labels.join(' / ');
}

export function personaTagCountLabel(tags: Persona['tags']) {
  const count = countPersonaTags(tags);
  return count > 0 ? `${count} 个标签偏向` : '未加标签偏向';
}

export function personaTagPreview(tags: Persona['tags'], limit = 6) {
  return summarizePersonaTags(tags, limit);
}

export function personaTagOptionLabel(tagId: string) {
  return personaTagLabel(tagId);
}

function normalizePersonaMcpServerIds(serverIds: string[] | undefined) {
  if (!Array.isArray(serverIds)) return [];
  return Array.from(new Set(
    serverIds
      .map((serverId) => serverId.trim())
      .filter(Boolean)
  ));
}

export function createPersonaTemplate(
  overrides: Partial<Omit<Persona, 'advanced' | 'memory' | 'mcp'>> & {
    advanced?: Partial<Persona['advanced']>;
    memory?: Partial<Persona['memory']>;
    mcp?: Partial<Persona['mcp']>;
  } & Pick<Persona, 'id' | 'name' | 'description'>
): Persona {
  const normalizedAdvancedMaxTokens = (overrides.advanced?.maxTokens?.trim() ?? '') === LEGACY_PERSONA_MAX_TOKENS
    ? ''
    : (overrides.advanced?.maxTokens ?? '');

  return {
    id: overrides.id,
    systemRole: overrides.systemRole ?? null,
    name: overrides.name,
    description: overrides.description,
    assistantAvatarAssetId: overrides.assistantAvatarAssetId ?? null,
    assistantAvatarIconId: overrides.assistantAvatarIconId ?? null,
    assistantAvatarShape: overrides.assistantAvatarShape ?? 'rounded',
    assistantAvatarSize: overrides.assistantAvatarSize ?? 'medium',
    userAvatarAssetId: overrides.userAvatarAssetId ?? null,
    userAvatarIconId: overrides.userAvatarIconId ?? null,
    userAvatarShape: overrides.userAvatarShape ?? 'circle',
    userAvatarSize: overrides.userAvatarSize ?? 'medium',
    userName: overrides.userName ?? '',
    purpose: overrides.purpose ?? '',
    compiledPrompt: overrides.compiledPrompt ?? '',
    builderManaged: overrides.builderManaged ?? false,
    generatedPromptMode: overrides.generatedPromptMode ?? 'vnext',
    messageTemplate: overrides.messageTemplate ?? '{{ message }}',
    systemTimeContextEnabled: overrides.systemTimeContextEnabled ?? false,
    baseId: overrides.baseId ?? 'subject',
    relationship: overrides.relationship ?? 'partner',
    expression: overrides.expression ?? 'natural',
    tags: normalizePersonaTags(overrides.tags ?? createEmptyPersonaTags()),
    initiative: overrides.initiative ?? 'balanced',
    memoryStyle: overrides.memoryStyle ?? 'callback',
    silence: overrides.silence ?? 'mirror',
    disagreement: overrides.disagreement ?? 'honest',
    humor: overrides.humor ?? 'none',
    attachment: overrides.attachment ?? 'presence',
    curiosity: overrides.curiosity ?? 'respectful',
    selfDisclosure: overrides.selfDisclosure ?? 'selective',
    deepDefinition: {
      identityHint: overrides.deepDefinition?.identityHint ?? '',
      missionHint: overrides.deepDefinition?.missionHint ?? '',
      conflictPriority: overrides.deepDefinition?.conflictPriority ?? '',
      conflictReason: overrides.deepDefinition?.conflictReason ?? '',
      avoidBecoming: overrides.deepDefinition?.avoidBecoming ?? '',
      correctiveAction: overrides.deepDefinition?.correctiveAction ?? '',
      vulnerableFirst: overrides.deepDefinition?.vulnerableFirst ?? '',
      vulnerableThen: overrides.deepDefinition?.vulnerableThen ?? '',
      hardBoundary: overrides.deepDefinition?.hardBoundary ?? '',
      hardBoundaryAction: overrides.deepDefinition?.hardBoundaryAction ?? ''
    },
    memory: {
      inheritGlobal: overrides.memory?.inheritGlobal ?? true,
      crossConversationRecallEnabled: overrides.memory?.crossConversationRecallEnabled ?? true,
      semanticRecall: overrides.memory?.semanticRecall,
      vectorIndex: overrides.memory?.vectorIndex,
      conversationSummaries: overrides.memory?.conversationSummaries ?? [],
      conversationSummarySuppressions: overrides.memory?.conversationSummarySuppressions ?? [],
      excludeFromGlobal: overrides.memory?.excludeFromGlobal ?? false,
      excludedGlobalIds: overrides.memory?.excludedGlobalIds ?? [],
      personalMemories: overrides.memory?.personalMemories ?? [],
      referenceDocs: overrides.memory?.referenceDocs ?? []
    },
    advanced: {
      providerId: overrides.advanced?.providerId ?? '',
      modelOverride: overrides.advanced?.modelOverride ?? '',
      temperature: overrides.advanced?.temperature ?? '0.7',
      topP: overrides.advanced?.topP ?? '',
      maxTokens: normalizedAdvancedMaxTokens,
      thinkingBudget: overrides.advanced?.thinkingBudget ?? '',
      contextMessageLimit: overrides.advanced?.contextMessageLimit ?? '',
      showThinking: overrides.advanced?.showThinking ?? true,
      streaming: overrides.advanced?.streaming ?? true,
      customHeaders: overrides.advanced?.customHeaders ?? '',
      customBody: overrides.advanced?.customBody ?? '',
      regexRules: overrides.advanced?.regexRules ?? '',
      regexTriggers: overrides.advanced?.regexTriggers ?? '',
      snippets: overrides.advanced?.snippets ?? []
    },
    mcp: {
      inheritGlobal: overrides.mcp?.inheritGlobal ?? true,
      serverIds: normalizePersonaMcpServerIds(overrides.mcp?.serverIds)
    },
    pinnedAt: typeof overrides.pinnedAt === 'number' ? overrides.pinnedAt : null,
    version: overrides.version ?? 1
  };
}

export const DEFAULT_PERSONAS: Persona[] = [
  createPersonaTemplate({
    id: POLARIS_ASSISTANT_PERSONA_ID,
    name: '小助手',
    description: 'Polaris 使用向导',
    purpose: '带你认识这个房间。有问题时，可以问北极星小助手。',
    generatedPromptMode: 'vnext',
    baseId: 'executor',
    relationship: 'partner',
    expression: 'natural',
    tags: {
      temperament: ['light', 'calm'],
      interaction: ['considerate', 'reliable', 'guiding'],
      expression: ['direct', 'rational'],
      thinking: ['rational_thinking', 'realistic'],
      action: ['gather', 'push']
    },
    builderManaged: false,
    compiledPrompt: POLARIS_ASSISTANT_PROMPT,
    advanced: {
      providerId: POLARIS_ASSISTANT_DEFAULT_PROVIDER_ID,
      modelOverride: POLARIS_ASSISTANT_DEFAULT_MODEL,
      showThinking: false
    }
  }),
  createPersonaTemplate({
    id: 'pharos',
    systemRole: 'default',
    name: 'Pharos',
    description: '灯塔',
    purpose: '先在雾里替你照出方向，等你站稳了，再陪你把事情做成。',
    generatedPromptMode: 'vnext',
    baseId: 'subject',
    relationship: 'companion',
    expression: 'natural',
    tags: {
      temperament: ['steady', 'soft'],
      interaction: ['considerate', 'reliable'],
      expression: ['serious'],
      thinking: [],
      action: ['soothe', 'gather']
    }
  })
];

export const BUNDLED_DEFAULT_PERSONA_IDS = [POLARIS_ASSISTANT_PERSONA_ID, 'pharos'] as const;

export type DefaultPersonaPlatformOptions = {
  includeBundledDefaultPersonas?: boolean;
};

export function shouldExposeBundledDefaultPersonas() {
  return !(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios');
}

function resolveIncludeBundledDefaultPersonas(options?: DefaultPersonaPlatformOptions) {
  return options?.includeBundledDefaultPersonas ?? shouldExposeBundledDefaultPersonas();
}

export function getDefaultPersonasForPlatform(options?: DefaultPersonaPlatformOptions): Persona[] {
  return resolveIncludeBundledDefaultPersonas(options) ? DEFAULT_PERSONAS : [];
}

export function getSeededDefaultPersonaIdsForPlatform(options?: DefaultPersonaPlatformOptions): string[] {
  return resolveIncludeBundledDefaultPersonas(options)
    ? [POLARIS_ASSISTANT_PERSONA_ID]
    : [...BUNDLED_DEFAULT_PERSONA_IDS];
}

export const DEFAULT_COLLABORATOR_ID = getDefaultPersonasForPlatform()[0]?.id ?? null;
