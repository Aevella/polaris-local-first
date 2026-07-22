import type { PolarisToolDefinition, ToolPromptContext } from './toolRegistryShared';
import type { AssistantToolActionKind } from '../toolActionTypes';
import {
  booleanProperty,
  numberProperty,
  objectParameters,
  stringArrayProperty,
  stringProperty
} from './toolRegistryShared';

type UtilityToolKind = Extract<
  AssistantToolActionKind,
  'listEnvironmentNodes' | 'inspectEnvironmentNode' | 'searchEnvironmentNodes' | 'createQrCode' | 'webSearch' | 'readWebPage' | 'listCalendars' | 'readCalendarEvents' | 'createCalendarEvent' | 'updateCalendarEvent' | 'deleteCalendarEvent' | 'runCode' | 'writeMemory' | 'writeMemoryDoc' | 'readMemoryDoc' | 'searchMemory' | 'openMemorySource' | 'readPolarisKnowledge' | 'startTask' | 'completeTask' | 'wait' | 'createProactiveMessageRule' | 'listProactiveMessageRules' | 'updateProactiveMessageRule' | 'deleteProactiveMessageRule'
>;

const PROACTIVE_MESSAGE_RULES = [
  '- 只有用户打开“主动消息”工具组后，这些工具才会出现在当前请求里。',
  '- 这些工具只管理当前协作者的主动消息规则；不要跨协作者替别人查看、修改或取消。',
  '- 修改或取消前如果不知道 ruleId，先用 listProactiveMessageRules 查看。'
];

function buildStartTaskRules(context?: ToolPromptContext) {
  const contentHandoffLine = context?.activeProject
    ? '- 当前对话已经绑定工作区；startTask capability=workspace 表示把当前工作区文件任务纳入持续任务账本。'
    : '- startTask capability=room 表示把房间卡、小网页、HTML、小游戏、问卷、菜单、交互故事或可保存页面纳入持续任务账本。';
  const themeLine =
    context?.themeToolMode === 'stable' || context?.themeToolMode === 'creative'
      ? '- 换肤工具如果已经出现在当前工具目录里，可以直接使用；startTask capability=theme 只表示把换肤纳入持续任务账本，不是使用换肤工具前的开关。'
      : '- capability=theme 对应换肤、换主题、改 Polaris 皮肤或调整应用整体视觉风格；普通卡片 CSS、工作区文件 CSS、键盘/布局/交互修复都不属于 theme。';

  return [
    '任务账本入口：',
    '1. startTask：把当前连续工作纳入可见任务账本。',
    '- startTask 不是工具开关；当前工具目录里已经出现的工具可以直接使用。',
    '- 用户没有要求进度记录时，不需要为了使用工具而调用 startTask。',
    themeLine,
    contentHandoffLine,
    '- 已进入工作区后的文件任务、本机桌面工作循环、应用内工作循环、代码运行、MCP 调用分别对应 workspace / desktop / app / code / mcp。',
    '- workspace 只表示当前对话已经在工作区场景内继续文件任务；不要用它在普通对话里代建、升格或切换工作区。',
    '- capability=desktop 对应 Mac 桌面本机环境里的读文件、改文件、运行验证、看命令输出和复测循环；它只记录任务，不授权新的本机能力。',
    '- capability=app 对应 Polaris 应用内部的连续工作循环，复用房间卡、工作区、主题、附件、预览和诊断工具；它不代表手机 shell，也不新增文件系统权限。',
    '- startTask 表示后续轮次需要持续记录目标、阶段和完成状态，不表示正文写不出文本。',
    '- 实际写入、读取、运行或换肤由当前可见工具完成。'
  ];
}

export const UTILITY_TOOL_DEFINITION_MAP = {
  listEnvironmentNodes: {
    name: 'listEnvironmentNodes',
    group: 'environment',
    resultReplayMode: 'detail-excerpt',
    brief: '列出当前环境目录的一层或多层节点',
    schema: {
      name: 'listEnvironmentNodes',
      description: '列出当前 Polaris 环境目录节点。用于先看设置、工作区、房间卡、附件、本机、MCP、记忆等入口；节点只是取景索引，真实修改继续用对应工具。',
      parameters: objectParameters({
        parentNodeId: stringProperty('可选父节点 id；不填默认 environment。'),
        depth: numberProperty('可选展开深度；默认 1。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '环境取景动作：',
      '1. listEnvironmentNodes：列出当前环境目录的一层或多层节点。',
      '- 这个工具只告诉你环境里有哪些真实入口，不直接改设置、不写文件、不执行命令。',
      '- 默认先从 parentNodeId="environment" 看顶层；看到目标后，再用对应真实工具读取或修改。'
    ]
  },
  inspectEnvironmentNode: {
    name: 'inspectEnvironmentNode',
    group: 'environment',
    resultReplayMode: 'detail-excerpt',
    brief: '检查一个环境节点',
    schema: {
      name: 'inspectEnvironmentNode',
      description: '检查一个环境节点的状态、证据、子节点和建议的真实后续工具。',
      parameters: objectParameters({
        nodeId: stringProperty('要检查的环境节点 id。'),
        detailLevel: stringProperty('可选详细度。summary 或 expanded；不填等同 summary。', {
          enum: ['summary', 'expanded']
        }),
        targetLabel: stringProperty('可选目标说明。')
      }, ['nodeId'])
    },
    rules: [
      '2. inspectEnvironmentNode：检查一个具体环境节点。',
      '- 需要确认某个设置区、工作区、房间、本机目录、MCP server 或记忆资料当前状态时使用。',
      '- 返回里的 actions 是真实工具建议；如果要修改，调用那些工具，不要把 nodeId 当写入口。'
    ]
  },
  searchEnvironmentNodes: {
    name: 'searchEnvironmentNodes',
    group: 'environment',
    resultReplayMode: 'detail-excerpt',
    brief: '搜索当前环境目录',
    schema: {
      name: 'searchEnvironmentNodes',
      description: '按关键词搜索当前环境目录节点。适合普通聊天没有明确现场、但需要找到设置项、工具区、工作区文件、MCP、记忆或附件入口时使用。',
      parameters: objectParameters({
        query: stringProperty('搜索词，例如 provider、导入导出、MCP、记忆、工作区文件。'),
        scopeNodeId: stringProperty('可选范围节点 id；不填搜索整个环境目录。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['query'])
    },
    rules: [
      '3. searchEnvironmentNodes：搜索当前环境目录。',
      '- 普通聊天里没有显式选中区域时，用它找候选入口；不要一次性要求系统展开整棵树。',
      '- 搜到目标后，用 inspectEnvironmentNode 看状态，或直接调用结果里的真实工具。'
    ]
  },
  createQrCode: {
    name: 'createQrCode',
    group: 'generation',
    brief: '生成二维码图片',
    schema: {
      name: 'createQrCode',
      description: '把文字、链接或 vCard 内容生成二维码图片。',
      parameters: objectParameters({
        text: stringProperty('二维码内容。'),
        fileName: stringProperty('可选文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['text'])
    },
    rules: [
      '生成动作：',
      '1. createQrCode：把文字、链接或 vCard 内容生成二维码图片。'
    ]
  },
  webSearch: {
    name: 'webSearch',
    group: 'web',
    resultReplayMode: 'full-detail',
    brief: '联网搜索',
    schema: {
      name: 'webSearch',
      description: '联网搜索网页结果。',
      parameters: objectParameters({
        query: stringProperty('搜索词。'),
        maxResults: numberProperty('可选结果数。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['query'])
    },
    rules: [
      '联网动作：',
      '1. webSearch：联网搜索网页结果。query 填搜索词，maxResults 可选。',
      '- webSearch 只返回候选网页和搜索摘要，不等于已经读过来源正文。',
      '- 普通搜索质量取决于用户在设置里的联网搜索服务；未配置搜索 Key 时会返回降级候选，但 readWebPage 仍可读取用户给出的具体链接。',
      '- 回答新闻、价格、版本、地点、产品、法律、规则、近期事件等会随时间变化的信息时，先 webSearch 找候选，再用 readWebPage 读取 2-3 个相关/可信来源后再下结论。',
      '- 如果 webSearch 标记为降级结果，更不能只根据 snippet 回答；除非用户只要链接，否则继续读取网页正文。'
    ]
  },
  readWebPage: {
    name: 'readWebPage',
    group: 'web',
    resultReplayMode: 'full-detail',
    brief: '读取网页正文',
    schema: {
      name: 'readWebPage',
      description: '读取某个网页正文。',
      parameters: objectParameters({
        url: stringProperty('完整网页链接。'),
        maxChars: numberProperty('最多读取多少字符。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['url'])
    },
    rules: [
      '2. readWebPage：读取某个网页正文。url 填完整链接。',
      '- 用户直接丢一个链接让你看内容时，用 readWebPage，不要假装已经读过。',
      '- 搜索后需要判断事实、内容或时效性时，读取搜索结果里的原网页；短链分享也交给 readWebPage 跟随跳转读取，包括小红书这类分享链接。',
      '- readWebPage 只证明读到了网页文本，不证明看见了图片、视频、评论区或需要登录才能展开的内容。'
    ]
  },
  listCalendars: {
    name: 'listCalendars',
    group: 'personalData',
    resultReplayMode: 'full-detail',
    brief: '读取可写系统日历',
    schema: {
      name: 'listCalendars',
      description: '读取用户已授权设备上的可写系统日历，返回稳定 calendarId、账户来源和系统默认状态。',
      parameters: objectParameters({
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '系统资料动作：',
      '1. listCalendars：读取可写系统日历及其 calendarId、账户来源和默认状态。',
      '- 同名日历可能来自不同账户；需要指定写入位置时先读取真实列表，不要根据“个人”“工作”这类显示名猜来源。',
      '- createCalendarEvent 可以使用返回的 calendarId 显式选择日历；不指定时才使用 iOS 系统默认日历。'
    ]
  },
  readCalendarEvents: {
    name: 'readCalendarEvents',
    group: 'personalData',
    resultReplayMode: 'full-detail',
    brief: '读取系统日历事件',
    schema: {
      name: 'readCalendarEvents',
      description: '读取用户已授权的本设备系统日历事件，返回可用于修改或删除的 eventId。',
      parameters: objectParameters({
        startDate: stringProperty('可选开始时间，ISO 字符串、yyyy-MM-dd 或 yyyy-MM-dd HH:mm；不填默认读取最近到未来一段日程。'),
        endDate: stringProperty('可选结束时间，ISO 字符串、yyyy-MM-dd 或 yyyy-MM-dd HH:mm。'),
        query: stringProperty('可选关键词，用于过滤标题、地点或日历名。'),
        maxEvents: numberProperty('可选返回事件数。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '2. readCalendarEvents：读取用户已授权的本设备系统日历事件。',
      '- 这个工具读取日历事件，并返回 eventId；后续修改或删除已有日程必须使用这个 eventId。',
      '- 只有用户在设置里开启“系统资料”且当前设备原生桥可用时，它才会出现在工具目录。',
      '- 需要理解用户今天/近期安排、会议、时间冲突或某个关键词相关日程时使用。',
      '- 返回的是工具读取到的事件事实；不要声称读到了提醒事项、邮件或联系人。'
    ]
  },
  createCalendarEvent: {
    name: 'createCalendarEvent',
    group: 'personalData',
    resultReplayMode: 'full-detail',
    brief: '创建系统日历事件',
    schema: {
      name: 'createCalendarEvent',
      description: '在用户已授权的本设备系统日历中创建日程事件。',
      parameters: objectParameters({
        title: stringProperty('日程标题。'),
        startDate: stringProperty('开始时间，ISO 字符串（有具体时刻时优先带时区偏移）或 yyyy-MM-dd HH:mm。'),
        endDate: stringProperty('可选结束时间，ISO 字符串（有具体时刻时优先带时区偏移）或 yyyy-MM-dd HH:mm；不填默认 1 小时后。'),
        allDay: booleanProperty('是否全天事件。'),
        location: stringProperty('可选地点。'),
        notes: stringProperty('可选备注。'),
        calendarId: stringProperty('可选目标系统日历 ID；来自 listCalendars。省略时使用 iOS 系统默认日历。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['title', 'startDate'])
    },
    rules: [
      '3. createCalendarEvent：在系统日历里创建新日程。',
      '- 用户要求安排、添加、创建日程时使用；它会写入系统日历。',
      '- 用户指定账户或日历、或设备上存在同名日历时，先用 listCalendars 取得 calendarId；不要硬编码 iCloud、Local、Exchange 或按日历名猜。',
      '- startDate 是工具边界的机器时间值：有具体时刻时优先写 ISO 8601 并带时区偏移，例如 2026-06-15T14:00:00+08:00；只有全天事件才只写日期。',
      '- 相对时间要先根据当前请求时间换算成具体 startDate；不要在参数里留下需要系统二次理解的时间描述。',
      '- 结束时间不明确时可以省略 endDate，让系统默认 1 小时，或在正文里说明你采用了默认时长。',
      '- 创建后返回 eventId，可用于后续修改或删除。'
    ]
  },
  updateCalendarEvent: {
    name: 'updateCalendarEvent',
    group: 'personalData',
    resultReplayMode: 'full-detail',
    brief: '修改系统日历事件',
    schema: {
      name: 'updateCalendarEvent',
      description: '修改用户已授权的本设备系统日历事件。需要 readCalendarEvents 或创建结果返回的 eventId。',
      parameters: objectParameters({
        eventId: stringProperty('要修改的日历事件 eventId。'),
        title: stringProperty('可选新标题。'),
        startDate: stringProperty('可选新开始时间，ISO 字符串、yyyy-MM-dd 或 yyyy-MM-dd HH:mm。'),
        endDate: stringProperty('可选新结束时间，ISO 字符串、yyyy-MM-dd 或 yyyy-MM-dd HH:mm。'),
        allDay: booleanProperty('可选是否全天事件。'),
        location: stringProperty('可选新地点；传空字符串可清空。'),
        notes: stringProperty('可选新备注；传空字符串可清空。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['eventId'])
    },
    rules: [
      '4. updateCalendarEvent：修改已有系统日历事件。',
      '- 修改已有日程前必须知道 eventId；不知道时先用 readCalendarEvents 定位。',
      '- 只传需要修改的字段；不要凭空改动用户没要求改的标题、时间、地点或备注。'
    ]
  },
  deleteCalendarEvent: {
    name: 'deleteCalendarEvent',
    group: 'personalData',
    resultReplayMode: 'full-detail',
    brief: '删除系统日历事件',
    schema: {
      name: 'deleteCalendarEvent',
      description: '删除用户已授权的本设备系统日历事件。需要 readCalendarEvents 或创建结果返回的 eventId。',
      parameters: objectParameters({
        eventId: stringProperty('要删除的日历事件 eventId。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['eventId'])
    },
    rules: [
      '5. deleteCalendarEvent：删除已有系统日历事件。',
      '- 删除已有日程前必须知道 eventId；不知道时先用 readCalendarEvents 定位。',
      '- 不要删除不确定是不是用户目标的事件；同名或时间相近时先读日历确认。'
    ]
  },
  runCode: {
    name: 'runCode',
    group: 'card',
    resultReplayMode: 'detail-excerpt',
    brief: '在沙箱里执行 JavaScript',
    schema: {
      name: 'runCode',
      description: '在浏览器沙箱里执行 JavaScript 代码并返回结果。适合做计算、数据转换、文本处理、格式转换等任务。默认是隔离本地沙箱；实验模式可以联网、弹 modal / popup、跑 blob worker 和下载。支持 async/await，用 console.log 输出中间结果；如果需要返回值，在最后显式 return。',
      parameters: objectParameters({
        code: stringProperty('要执行的 JavaScript 代码。支持 async/await。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['code'])
    },
    buildRules: (context) => [
      '代码执行动作：',
      '1. runCode：在浏览器沙箱里执行 JavaScript 代码。',
      '- 需要做数学计算、数据转换、文本处理、JSON 解析、格式转换时，直接用 runCode。',
      context?.runCodeSandboxProfile === 'experimental'
        ? '- 当前 runCode 沙箱：实验模式。可以联网 fetch / XHR / WebSocket、弹 modal / popup、跑 blob worker，也允许下载；仍然没有文件系统、同源访问或应用存储权限。'
        : '- 当前 runCode 沙箱：安全模式。只能在隔离本地环境里跑 JS，没有网络访问，没有弹窗 / 新窗口，也没有文件系统。',
      '- 用户要的是手机、Termux、ADB、服务器或外部终端里可复制执行的命令时，直接生成命令文本；不要调用 runCode 假装自己正在那个外部环境里执行。',
      '- 用 console.log() 输出中间结果；如果你需要拿到最终结果，在最后显式 return。',
      '- 如果第一次运行报错，可以根据错误信息修改代码再试。'
    ]
  },
  writeMemory: {
    name: 'writeMemory',
    group: 'memoryWrite',
    brief: '写入长期记忆',
    schema: {
      name: 'writeMemory',
      description: '写入稳定偏好和低风险长期记忆。',
      parameters: objectParameters({
        memory: stringArrayProperty('要写入的长期记忆条目。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['memory'])
    },
    rules: [
      '写入记忆动作：',
      '1. writeMemory：只写稳定偏好和低风险长期记忆。',
      '- 只有用户明确要你记住、记录偏好或写进长期记忆时，再用它。'
    ]
  },
  writeMemoryDoc: {
    name: 'writeMemoryDoc',
    group: 'memoryWrite',
    resultReplayMode: 'detail-excerpt',
    brief: '写入长期资料',
    schema: {
      name: 'writeMemoryDoc',
      description: '新建或更新当前协作者的长期资料文档。适合写较长背景、设定、关系资料、项目资料或长期日志；短偏好仍用 writeMemory。',
      parameters: objectParameters({
        docId: stringProperty('可选。要更新的长期资料 docId；不填则新建一份资料。'),
        title: stringProperty('资料标题。'),
        summary: stringProperty('目录里给模型看的短摘要。'),
        content: stringProperty('长期资料正文。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['title', 'content'])
    },
    rules: [
      '写入长期资料动作：',
      '1. writeMemoryDoc：新建或更新当前协作者的长期资料文档。',
      '- 资料适合长背景、设定、关系资料、项目资料或长期日志；短偏好和一句话事实继续用 writeMemory。',
      '- 如果要更新已有资料，使用长期资料目录里的 docId；如果没有明确目标，就新建一份标题清楚的资料。'
    ]
  },
  readMemoryDoc: {
    name: 'readMemoryDoc',
    group: 'memory',
    resultReplayMode: 'full-detail',
    brief: '读取长期资料全文',
    schema: {
      name: 'readMemoryDoc',
      description: '按记忆资料目录里的 docId 读取长期资料全文。',
      parameters: objectParameters({
        docId: stringProperty('长期资料目录里的 docId。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['docId'])
    },
    rules: [
      '长期资料动作：',
      '1. readMemoryDoc：按 docId 读取长期资料全文。',
      '- 记忆上下文只显示长期资料目录；readMemoryDoc 返回指定资料全文。'
    ]
  },
  searchMemory: {
    name: 'searchMemory',
    group: 'memoryRecall',
    resultReplayMode: 'full-detail',
    brief: '搜索过往摘要和原文锚点',
    schema: {
      name: 'searchMemory',
      description: '按查询搜索当前协作者的跨对话摘要和语义原文锚点。它只返回候选、摘要和 source ids；需要确认原文时再调用 openMemorySource。',
      parameters: objectParameters({
        query: stringProperty('要查找的记忆线索、人物、主题、说法或事件。'),
        mode: stringProperty('可选。auto 同时搜索摘要和原文；summary 只搜摘要；source 只搜原文锚点。', {
          enum: ['auto', 'summary', 'source']
        }),
        maxResults: numberProperty('每类最多返回多少条候选。默认 3。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['query'])
    },
    rules: [
      '记忆搜索动作：',
      '1. searchMemory：搜索过往摘要和原文锚点。',
      '- 当你觉得需要确认“以前聊过什么”、用户提到旧事/旧人/旧项目，或当前语义像是在接旧线索时，用它主动找记忆。',
      '- 当你不确定用户在说什么、但怀疑你们过去聊过的内容能帮你理解指代或背景时，也可以主动搜索。',
      '- searchMemory 只返回候选和 sourceConversationId/sourceMessageIds；不要把候选当作已读原文。',
      '- 如果候选会影响回答判断，继续用 openMemorySource 打开原文。'
    ]
  },
  openMemorySource: {
    name: 'openMemorySource',
    group: 'memoryRecall',
    resultReplayMode: 'full-detail',
    brief: '打开过往记忆原文',
    schema: {
      name: 'openMemorySource',
      description: '按 searchMemory 返回的 sourceConversationId 和 sourceMessageIds 读取过往对话原文。',
      parameters: objectParameters({
        sourceConversationId: stringProperty('searchMemory 返回的 sourceConversationId。'),
        sourceMessageIds: stringArrayProperty('可选。searchMemory 返回的 sourceMessageIds；不填则读取这个过往对话里的可读消息。'),
        maxChars: numberProperty('最多读取多少字符。默认 8000。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['sourceConversationId'])
    },
    rules: [
      '记忆原文动作：',
      '1. openMemorySource：按 source ids 打开过往对话原文。',
      '- 它是 searchMemory 的下一步：先找候选，再按 sourceConversationId + sourceMessageIds 打开原文。',
      '- 打开后再根据原文回答，不要只复述摘要候选。'
    ]
  },
  readPolarisKnowledge: {
    name: 'readPolarisKnowledge',
    group: 'knowledge',
    resultReplayMode: 'full-detail',
    brief: '读取 Polaris 内置产品知识文档',
    schema: {
      name: 'readPolarisKnowledge',
      description: '按需读取 Polaris 内置产品知识文档。不填 topic 会先返回章节索引；用于理解 Polaris 的对象边界、请求链路、工具箱、MCP、工作区、记忆、备份、隐私边界和主题美化选区映射。',
      parameters: objectParameters({
        topic: stringProperty('可选。想聚焦的主题关键词；不填返回章节索引；传“全文”才读取完整产品知识文档。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '产品知识动作：',
      '1. readPolarisKnowledge：读取 Polaris 内置结构知识文档。',
      '- 这个工具只读取产品知识，不读取当前运行状态、用户数据、项目文件或外部服务。',
      '- 不确定该读哪章时，先不填 topic 读取章节索引；再用章节名或关键词读取正文。',
      '- 不要默认读取全文；只有需要全局核对时才用 topic="全文"。',
      '- 找主题美化 selector 时，可以用 topic="主题美化选区" 读取自然语言意图到可改区域的映射。'
    ]
  },
  startTask: {
    name: 'startTask',
    group: 'task',
    brief: '把连续工作纳入任务账本',
    schema: {
      name: 'startTask',
      description: '把当前连续工作纳入可见任务账本。它不负责开启工具；工具是否可用只看当前工具目录、用户开关和应用状态。',
      parameters: objectParameters({
        capability: stringProperty('任务账本归类。换肤写 theme；房间卡写 room；已在工作区内继续写文件写 workspace；Mac 本机环境工作循环写 desktop；Polaris 应用内工作循环写 app；运行代码写 code；MCP 写 mcp；其他连续任务写 general。', {
          enum: ['theme', 'room', 'workspace', 'desktop', 'app', 'code', 'mcp', 'general']
        }),
        title: stringProperty('任务短标题。'),
        stage: stringProperty('当前阶段，用一句短话写。'),
        steps: stringArrayProperty('接下来 1 到 3 个眼下步骤，写短句。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    buildRules: buildStartTaskRules
  },
  completeTask: {
    name: 'completeTask',
    group: 'task',
    brief: '完成当前任务',
    schema: {
      name: 'completeTask',
      description: '当前连续任务已经真正完成、检查或交付结束时，显式关闭任务执行状态。',
      parameters: objectParameters({
        stage: stringProperty('完成状态短句，默认“已完成”。'),
        summary: stringProperty('可选完成摘要。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '任务出口：',
      '1. completeTask：当前连续任务已经真正完成、检查或交付结束时调用。',
      '- 只有实际工作已经落下、必要检查已经完成后再调用。',
      '- 调用后不要再说“我要标记完成”，这个工具本身就是完成动作。'
    ]
  },
  wait: {
    name: 'wait',
    group: 'task',
    resultReplayMode: 'detail-excerpt',
    brief: '等待一小段时间后继续',
    schema: {
      name: 'wait',
      description: '等待一段时间并把等待结果回喂给模型，用于轮询外部状态、动画、下载、MCP 调用后的异步变化或屏幕变化。它只等待，不读取状态、不截图、不替模型判断。',
      parameters: objectParameters({
        seconds: numberProperty('等待秒数。不填默认 3 秒；需要多轮轮询时，等完后继续读取真实状态再决定是否再次等待。'),
        reason: stringProperty('为什么需要等，例如“等待截图写入”“等待页面加载完成”。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '轮询等待：',
      '1. wait：等待一段时间后继续当前工具循环。',
      '- wait 只负责等待，不会读取屏幕、网页、命令输出、MCP 状态或任何外部事实。',
      '- 等待结束后，必须基于当前可见工具继续读取真实状态、检查结果，或给出自然收尾。',
      '- 不要用 wait 替代用户确认；需要用户决定、授权或提供信息时停下来问。'
    ]
  },
  createProactiveMessageRule: {
    name: 'createProactiveMessageRule',
    group: 'proactive',
    brief: '创建主动消息规则',
    schema: {
      name: 'createProactiveMessageRule',
      description: '为当前协作者创建一条主动消息规则。规则会保存到设置里的主动消息列表，之后按时间触发，让协作者主动开口。',
      parameters: objectParameters({
        prompt: stringProperty('触发时交给协作者的提示词，写清楚到点后要主动说什么、以什么语气/目标开口。'),
        scheduleKind: stringProperty('触发时间类型。daily 表示每天固定时间；interval 表示每隔一段时间。', {
          enum: ['daily', 'interval']
        }),
        time: stringProperty('scheduleKind=daily 时填写，24 小时制 HH:mm，例如 09:30。'),
        everyMinutes: numberProperty('scheduleKind=interval 时填写，每隔多少分钟触发一次。'),
        conversationMode: stringProperty('fixed 表示固定投递到当前对话；follow-latest 表示投递到这个协作者最近的对话。默认 fixed。', {
          enum: ['fixed', 'follow-latest']
        }),
        name: stringProperty('可选规则名，会显示在设置里的主动消息列表。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['prompt', 'scheduleKind'])
    },
    rules: [
      '主动消息动作：',
      '1. createProactiveMessageRule：为当前协作者创建一条主动消息规则，之后由 Polaris 按规则让 TA 主动开口。',
      ...PROACTIVE_MESSAGE_RULES,
      '- 只有用户明确想让你以后主动找 TA、按时间提醒、定期问候或设置主动消息时，才使用它。',
      '- 这个工具创建的是设置里的普通主动消息规则；用户之后可以在设置 → 主动消息里关闭、修改或删除。',
      '- 默认投递到当前对话；如果用户想“无论我之后在哪个对话都由这个协作者主动说”，conversationMode 用 follow-latest。',
      '- 不要为了普通回答、一次性补充、你自己想延伸话题或未经用户同意的自启动而创建规则。'
    ]
  },
  listProactiveMessageRules: {
    name: 'listProactiveMessageRules',
    group: 'proactive',
    resultReplayMode: 'full-detail',
    brief: '查看主动消息规则',
    schema: {
      name: 'listProactiveMessageRules',
      description: '查看当前协作者已有的主动消息规则，返回 ruleId、名称、时间、目标和提示词摘要。',
      parameters: objectParameters({
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '2. listProactiveMessageRules：查看当前协作者已有的主动消息规则。',
      ...PROACTIVE_MESSAGE_RULES
    ]
  },
  updateProactiveMessageRule: {
    name: 'updateProactiveMessageRule',
    group: 'proactive',
    resultReplayMode: 'detail-excerpt',
    brief: '修改主动消息规则',
    schema: {
      name: 'updateProactiveMessageRule',
      description: '修改当前协作者的一条主动消息规则。只传要改的字段；不传的字段保持原样。',
      parameters: objectParameters({
        ruleId: stringProperty('要修改的主动消息规则 id。先用 listProactiveMessageRules 查看。'),
        prompt: stringProperty('可选。新的触发提示词。'),
        scheduleKind: stringProperty('可选。新的触发时间类型。daily 表示每天固定时间；interval 表示每隔一段时间。', {
          enum: ['daily', 'interval']
        }),
        time: stringProperty('scheduleKind=daily 时填写，24 小时制 HH:mm，例如 21:30。'),
        everyMinutes: numberProperty('scheduleKind=interval 时填写，每隔多少分钟触发一次。'),
        conversationMode: stringProperty('可选。fixed 表示固定投递到当前对话；follow-latest 表示投递到这个协作者最近的对话。', {
          enum: ['fixed', 'follow-latest']
        }),
        name: stringProperty('可选。新的规则名。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['ruleId'])
    },
    rules: [
      '3. updateProactiveMessageRule：修改当前协作者的一条主动消息规则。',
      ...PROACTIVE_MESSAGE_RULES,
      '- 用户让你改频率、改时间、改提示词、改投递目标时，用它；不需要先取消再新建。'
    ]
  },
  deleteProactiveMessageRule: {
    name: 'deleteProactiveMessageRule',
    group: 'proactive',
    resultReplayMode: 'detail-excerpt',
    brief: '取消主动消息规则',
    schema: {
      name: 'deleteProactiveMessageRule',
      description: '取消当前协作者的一条主动消息规则。',
      parameters: objectParameters({
        ruleId: stringProperty('要取消的主动消息规则 id。先用 listProactiveMessageRules 查看。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['ruleId'])
    },
    rules: [
      '4. deleteProactiveMessageRule：取消当前协作者的一条主动消息规则。',
      ...PROACTIVE_MESSAGE_RULES,
      '- 用户说“别再主动发这个了”“取消这个提醒”“你自己把这条收掉”时，用它。'
    ]
  }
} satisfies Record<UtilityToolKind, PolarisToolDefinition<UtilityToolKind>>;

export const UTILITY_TOOL_DEFINITIONS = Object.values(UTILITY_TOOL_DEFINITION_MAP);
