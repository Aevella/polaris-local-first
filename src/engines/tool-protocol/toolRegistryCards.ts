import type { PolarisToolDefinition } from './toolRegistryShared';
import type { AssistantToolActionKind } from '../toolActionTypes';
import {
  booleanProperty,
  numberProperty,
  objectParameters,
  stringArrayProperty,
  stringProperty
} from './toolRegistryShared';
import { buildCardFacePromptLines } from './cardFacePromptCatalog';

type CardToolKind = Extract<
  AssistantToolActionKind,
  | 'createRoomProject'
  | 'createCodeCard'
  | 'createProjectFile'
  | 'listCodeCards'
  | 'patchRoomProject'
  | 'promoteCardToProject'
  | 'patchCodeCard'
  | 'appendCodeCard'
  | 'appendProjectFile'
  | 'insertProjectFile'
  | 'replaceProjectFileLines'
  | 'writeProjectFiles'
  | 'listProjectFiles'
  | 'searchProjectFiles'
  | 'readWorkspacePreviewState'
  | 'listWorkspaceReferences'
  | 'searchWorkspaceReferences'
  | 'readWorkspaceReference'
  | 'promoteWorkspaceReferenceToProjectFile'
  | 'pinProjectFileAsReference'
  | 'searchReadableContext'
  | 'checkProjectPreview'
  | 'inspectProjectRuntime'
  | 'editCodeCardText'
  | 'editProjectFileText'
  | 'deleteProjectFile'
  | 'readProjectFile'
  | 'readProjectFileContext'
  | 'readCodeCard'
>;

export const CARD_TOOL_DEFINITION_MAP = {
  createRoomProject: {
    name: 'createRoomProject',
    group: 'cross-boundary',
    brief: '新建一个工作区，让后续文件卡成组落下',
    schema: {
      name: 'createRoomProject',
      description: '往收藏区新建一个工作区。工作区会把后续文件按 filePath 成组维护。',
      parameters: objectParameters({
        projectId: stringProperty('工作区 id。多文件同一轮输出时，后续 createProjectFile 都复用这个 id。'),
        title: stringProperty('工作区标题。'),
        slug: stringProperty('可选。工作区 slug。'),
        tags: stringArrayProperty('可选。工作区标签。'),
        coverNote: stringProperty('可选。工作区封面上的一句短说明。'),
        coverStyle: stringProperty('可选。只给这个工作区封面用的局部 CSS。作用域自动收在封面卡根节点；`&` 表示封面根节点。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。是否切到收藏区。')
      }, ['projectId', 'title'])
    },
    rules: [
      '工作区文件动作：',
      '0. createRoomProject：创建一个工作区，用来按 `filePath` 成组维护文件卡。',
      '- 多条文件路径彼此引用、后续要按 `filePath` 分开维护的内容属于工作区，比如 `index.html` 明确引用 `styles/app.css` 和 `src/main.js`。',
      '- `createRoomProject` 必须自己给一个稳定 `projectId`，同一轮后续文件动作全部复用这个 id。',
      '- 单文件房间、一次性交付页、文案配图卡、能内联解决的小页面属于房间卡边界。',
      '- `coverNote` 和 `coverStyle` 是工作区封面的标题外观信息，不会修改任何项目文件正文。',
      '- `coverStyle` 只改工作区封面卡，封面根节点就是 `&`；可用真实节点：`&`、`& .project-cover-decoration`、`& .project-cover-inner`、`& .project-cover-header`、`& .project-cover-mark`、`& .project-cover-name`、`& .project-cover-tag`、`& .project-cover-title`、`& .project-cover-description`、`& .project-cover-footer`、`& .project-cover-meta`、`& .project-cover-time`、`&::before`、`&::after`。',
      '- `coverStyle` 不要引用远程 url，也不要写全局 selector；封面像名片一样固定比例显示，风格可以强，但不要靠 height / position / transform 去改收藏区布局。'
    ]
  },
  createCodeCard: {
    name: 'createCodeCard',
    group: 'card',
    brief: '新建房间卡，把内容存进收藏区',
    schema: {
      name: 'createCodeCard',
      description: '往收藏区新建一张房间卡。适合把刚写好的内容、代码、HTML、CSS 或一整段结果直接落进房间。',
      parameters: objectParameters({
        kind: stringProperty('可选卡片类型。普通房间写 card；想把它固化成下次可直接调用的工具就写 tool。', {
          enum: ['card', 'tool']
        }),
        title: stringProperty('可选标题。'),
        cardNote: stringProperty('可选。显示在卡面底部的一句轻写小字；不传就保留默认来源文案。'),
        language: stringProperty('可选语言，比如 text、html、css、javascript。'),
        code: stringProperty('卡片正文内容。'),
        cardFaceCss: stringProperty('可选。只给这张房间卡 / 代码卡用的局部卡面 CSS。自由度按创意模式改房间卡卡面来理解；`&` 表示这张卡的卡面根节点。'),
        tags: stringArrayProperty('2 到 4 个中文标签。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。是否在收藏区打开这张卡。')
      }, ['code'])
    },
    rules: [
      '房间卡 / 代码卡动作：',
      '1. createCodeCard：新建一个代码/HTML/CSS 房间并存进收藏区。',
      '- `createCodeCard` 参数一律平铺：`kind / title / cardNote / language / code / cardFaceCss / tags`。不要再包一层 `card`，也不要在正文里手写 `<tool_call>` 伪标签。',
      '- 创建卡片时必须附带 2-4 个描述性标签（tags 字段），标签用中文。',
      '- 卡面底部那句轻写小字走 `cardNote`。想写就直接写一句；不写就保留默认来源文案，不要为了凑字段硬编。',
      '- 普通单张小房间用 `createCodeCard`。如果用户明确要进入工作区，不要在普通对话里代建工作区；等用户从目标工作区打开对话后，再用工作区文件动作。',
      '- 如果这张卡已经明显像一个项目，比如 HTML/CSS/JS 混在一起、正文很长、需要反复修 bug 或运行检查，房间卡仍可承载单文件产物；继续维护时更接近工作区边界。',
      '- `cardFaceCss` 承载这张卡自己的卡面外观；小游戏、页面、礼物、规则页、作品样张、气氛文本这类产物通常有可见卡面。',
      '- `cardFaceCss` 直接按创意模式改房间卡卡面来写，只是作用域已经自动收在这张卡自己，不用再重复写外层收藏区 selector。',
      '- `cardFaceCss` 不要引用远程 url；其余怎么表达按内容需要来，不要自己先把它写死。',
      '- 做 HTML 卡片时不要把 emoji 或特殊 Unicode 符号当作按钮、图标、状态灯或装饰主视觉；这些在部分 iOS 模拟器 / WebView 会显示成问号方框。需要图标就写内联 SVG、CSS 图形或普通中文标签。',
      '- 如果用户想把这张卡变成下次可复用的工具，直接设 `kind=tool`；tool 卡目前只支持 `javascript`，运行时读 `window.PolarisTool.input / args / card`，也能继续用 `window.PolarisRoom` 持久化状态。',
      '- 简单 `input / textarea / select` 会自动持久化；这层适合直接把值长在 DOM 上的表单。',
      '- 如果这张卡有待办、计数器、开关、分页、小游戏、日记本这种“页面脚本自己维护内部状态”的交互，不要只靠 DOM 默认值硬撑；直接把核心状态放进 `window.PolarisRoom`。',
      '- 复杂交互卡把 `window.PolarisRoom` 当成唯一状态源：`getState()` / `whenReady()` 读取状态，`patchState(...)` / `setState(...)` 写入状态；不要让 checkbox DOM 和你自己的 JS 数组各记一份。',
      ...buildCardFacePromptLines()
    ]
  },
  createProjectFile: {
    name: 'createProjectFile',
    group: 'project',
    brief: '在工作区里创建一个文件，可创建空文件并由追加工具继续写入',
    schema: {
      name: 'createProjectFile',
      description: '在已有工作区里创建一个文件。支持创建带正文的文件，也支持创建空文件并由 appendProjectFile 分块写入。',
      parameters: objectParameters({
        projectId: stringProperty('所属工作区 id。必须是当前对话已经绑定的工作区 id。'),
        filePath: stringProperty('工作区里的文件路径，比如 index.html、styles/app.css、src/main.js。'),
        fileRole: stringProperty('可选。文件角色，比如 entry、style、logic、content、note。'),
        language: stringProperty('可选语言，比如 html、css、javascript、text。'),
        code: stringProperty('可选。文件初始正文。长文件可以先空着或只写稳定起始片段。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。是否在收藏区打开这个文件。')
      }, ['projectId', 'filePath'])
    },
    rules: [
      '1. createProjectFile：在工作区里创建文件。',
      '- 工作区文件不要再冒充散卡；用户进入工作区后，再在里面建每个文件。',
      '- 这个工具允许 `code` 为空；空文件可由 `appendProjectFile` 继续追加正文。',
      '- 每个工作区文件必须带 `projectId / filePath`；`fileRole` 用来说明 entry、style、logic、content、note 这类文件角色。',
      '- 创建后如果文件还没写完，不要声明工作区完成；下一段继续用 `appendProjectFile`。'
    ]
  },
  patchRoomProject: {
    name: 'patchRoomProject',
    group: 'project',
    brief: '修改当前工作区的标题、标签或封面',
    schema: {
      name: 'patchRoomProject',
      description: '修改当前工作区自己的外壳信息。适合给手动新建的工作区补封面、改标题、小字、标签或封面 CSS；不修改任何项目文件正文。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        title: stringProperty('可选。新的工作区标题。'),
        slug: stringProperty('可选。新的工作区 slug。'),
        tags: stringArrayProperty('可选。新的工作区标签。'),
        coverNote: stringProperty('可选。工作区封面上的一句短说明。'),
        coverStyle: stringProperty('可选。只给这个工作区封面用的局部 CSS。作用域自动收在封面卡根节点；`&` 表示封面根节点。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。修改后是否在收藏区打开工作区。')
      })
    },
    rules: [
      '2. patchRoomProject：修改当前工作区外壳。',
      '- 这是工作区封面/标题/标签工具，不是文件写入工具；不要把 HTML/CSS/JS 文件正文塞进这里。',
      '- 用户说当前工作区封面、项目封面、这组文件外面的卡片、工作区标题或小字时，一定用它。',
      '- `coverNote` / `coverStyle` 是工作区外壳信息；它们只影响封面，不影响文件正文。',
      '- `coverStyle` 只改工作区封面卡，封面根节点就是 `&`；可用真实节点：`&`、`& .project-cover-decoration`、`& .project-cover-inner`、`& .project-cover-header`、`& .project-cover-mark`、`& .project-cover-name`、`& .project-cover-tag`、`& .project-cover-title`、`& .project-cover-description`、`& .project-cover-footer`、`& .project-cover-meta`、`& .project-cover-time`、`&::before`、`&::after`。',
      '- `coverStyle` 不要引用远程 url，也不要写全局 selector；封面像名片一样固定比例显示，风格可以强，但不要靠 height / position / transform 去改收藏区布局。'
    ]
  },
  promoteCardToProject: {
    name: 'promoteCardToProject',
    group: 'cross-boundary',
    brief: '把一张现有房间卡转生成工作区，并拿它做第一个文件',
    schema: {
      name: 'promoteCardToProject',
      description: '把一张现有房间卡升为工作区。原卡会转生成新工作区的第一个文件，不保留分身。',
      parameters: objectParameters({
        target: stringProperty('目标房间。写 active 表示当前活动房间，或直接写卡片 id / 标题。'),
        projectTitle: stringProperty('可选。新工作区标题；不传就沿用原卡标题。'),
        filePath: stringProperty('可选。转生后的首个文件路径；不传就按卡片语言自动推断。'),
        fileRole: stringProperty('可选。转生后的首个文件角色，比如 entry、style、logic、content、note。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。转生后是否切到工作区 shelf。')
      })
    },
    rules: [
      '2. promoteCardToProject：把现有房间卡转生成工作区。',
      '- 这不是复制，是转生：原卡会消失，正文进入新工作区的第一个文件。',
      '- 默认沿用原卡标题做工作区标题，沿用原卡内容做第一个文件；只有用户明确要求时才改 `projectTitle / filePath / fileRole`。',
      '- 原卡的小字、卡面和来源信息会进入工作区外壳；不要再额外补一层重复说明。',
      '- tool 卡暂时不要走这条路径；它代表可执行能力，不是普通页面或文档。'
    ]
  },
  listCodeCards: {
    name: 'listCodeCards',
    group: 'card',
    resultReplayMode: 'full-detail',
    brief: '列出当前协作者房间卡目录',
    schema: {
      name: 'listCodeCards',
      description: '列出当前协作者房间里可访问的房间卡目录。它只返回标题、id、语言、标签和更新时间，不返回卡片正文。',
      parameters: objectParameters({
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '4. listCodeCards：列出当前协作者房间卡目录。',
      '- 用户提到过去的卡、某张卡、之前那个房间，但目标不明确时，先用它看目录。',
      '- 它只返回标题、id、语言、标签和更新时间；不返回正文。',
      '- 看到目标后，再用 `readCodeCard` 按 id 或标题读取全文。'
    ]
  },
  patchCodeCard: {
    name: 'patchCodeCard',
    group: 'card',
    brief: '修改现有房间卡内容',
    schema: {
      name: 'patchCodeCard',
      description: '修改现有房间卡。适合继续写、补、改当前卡片内容。',
      parameters: objectParameters({
        target: stringProperty('目标卡片。写 active 表示当前活动房间，或直接写卡片 id。'),
        kind: stringProperty('可选卡片类型。普通房间写 card；想把它固化成下次可直接调用的工具就写 tool。', {
          enum: ['card', 'tool']
        }),
        title: stringProperty('可选的新标题。'),
        cardNote: stringProperty('可选的新卡面小字。传字符串就改；不传就保留现状。'),
        language: stringProperty('可选的新语言。'),
        code: stringProperty('新的正文内容。'),
        cardFaceCss: stringProperty('可选。只改这张房间卡 / 代码卡的局部卡面 CSS。自由度按创意模式改房间卡卡面来理解；`&` 表示这张卡的卡面根节点。'),
        tags: stringArrayProperty('可选的新标签。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。修改后是否在收藏区打开这张卡。')
      })
    },
    rules: [
      '5. patchCodeCard：修改现有房间。',
      '- 收藏检索结果和当前活动房间是可用上下文；当前活动房间就是目标时，target 可以写 active。',
      '- 房间动作会真实修改房间卡 / 代码卡；正文代码块只显示在聊天里，不会保存成卡。',
      '- `patchCodeCard.code` 是整份正文替换。只有你确实需要替换整张卡、并且内容不长时才用它写 code。',
      '- 长页面、多段脚本、复杂交互或反复调 bug 更接近工作区文件；房间卡更适合单文件产物。',
      '- 当前对话绑定工作区时，长文件续写和项目文件维护属于工作区文件工具。',
      '- 只改文件里一小段文本时，改用当前工作区里的文件局部替换工具，不要为了一个局部改动整份替换。',
      '- `cardNote` 是卡面底部那句轻写小字，和正文开头不是同一个位置。',
      '- `cardFaceCss` 是这张卡自己的卡面外观，和正文里的 HTML / `<style>`、整页换肤不是同一个作用域。',
      '- 如果用户是要把这张卡固化成可重复调用的工具，直接把 `kind` 改成 `tool`；tool 卡目前只支持 `javascript`，运行时读 `window.PolarisTool.input / args / card`，也能继续用 `window.PolarisRoom`。',
      '- 如果你改的是带内部状态的交互卡，比如待办、计数器、小游戏、表单面板，继续沿用它的 `window.PolarisRoom` 状态，不要把持久化拆成另一套临时变量。',
      ...buildCardFacePromptLines()
    ]
  },
  appendCodeCard: {
    name: 'appendCodeCard',
    group: 'card',
    brief: '向现有房间卡正文尾部追加一段内容',
    schema: {
      name: 'appendCodeCard',
      description: '向现有房间卡的正文尾部追加一段内容。适合继续写当前卡、顺着已有正文往后接，不需要整张替换。',
      parameters: objectParameters({
        target: stringProperty('目标卡片。写 active 表示当前活动房间，或直接写卡片 id / 标题。'),
        code: stringProperty('要追加到卡片正文尾部的原文片段。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。追加后是否在收藏区打开这张卡。')
      }, ['code'])
    },
    rules: [
      '6. appendCodeCard：向现有房间卡正文尾部追加一段内容。',
      '- 这是房间卡续写工具，不是工作区文件工具；不要再传 `projectId + filePath`。',
      '- 当前活动房间就写 `target=active`；其他卡片按 id 或标题定位。',
      '- 只是接着往后写时用它；如果要改标题、标签、小字、卡面或整份正文，改用 `patchCodeCard`。'
    ]
  },
  appendProjectFile: {
    name: 'appendProjectFile',
    group: 'project',
    brief: '续写现有工作区文件正文片段',
    schema: {
      name: 'appendProjectFile',
      description: '续写现有工作区文件的一段内容。适合长代码、工作区文件、连续生成、分块续写，不需要重发整份文件；HTML 文件已闭合时系统会把片段落回文档结构内。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        code: stringProperty('要续写的新内容片段。需要换行就把换行写进这个字段；系统会按原样写入。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。追加后是否在收藏区打开这张卡。')
      }, ['filePath', 'code'])
    },
    rules: [
      '2. appendProjectFile：续写现有工作区文件正文片段。',
      '- 它把 `code` 追加到指定工作区文件的末尾；HTML 文件会落在可运行文档内部，而不是写到 `</html>` 后面。',
      '- 必须明确 `filePath`：续写入口文件传 `filePath="index.html"`；续写脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- `appendProjectFile` 保留原文件内容，只增加新片段；整份覆盖属于 `polaris-project-file mode=replace` 或 `writeProjectFiles`。'
    ]
  },
  insertProjectFile: {
    name: 'insertProjectFile',
    group: 'project',
    brief: '在工作区文件的锚点或行号前后插入正文片段',
    schema: {
      name: 'insertProjectFile',
      description: '在现有工作区文件里的某个原文锚点或行号前后插入一段新内容，不替换锚点本身。适合补 CSS 规则、插入一段 HTML、给函数前后加逻辑。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        beforeString: stringProperty('可选。把 code 插到这段原文前面。必须和当前文件中某一处完全一致。'),
        afterString: stringProperty('可选。把 code 插到这段原文后面。必须和当前文件中某一处完全一致。'),
        lineNumber: numberProperty('可选。把 code 插到这个行号前或后。行号可以来自 readProjectFileContext 或 searchProjectFiles 的结果。'),
        linePosition: stringProperty('可选。配合 lineNumber 使用：before 表示插到该行前，after 表示插到该行后；不传默认 after。'),
        code: stringProperty('要插入的新内容。需要换行就把换行写进这个字段；系统会按原样插入，不会替换锚点。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。插入后是否在收藏区打开这张卡。')
      }, ['filePath', 'code'])
    },
    rules: [
      '3. insertProjectFile：在工作区文件的锚点或行号前后插入正文片段。',
      '- 这是定点插入工具，不是替换工具：锚点会保留，`code` 只长在锚点前或锚点后。',
      '- 必须明确 `filePath`：插入入口文件传 `filePath="index.html"`；插入脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- 要插到某段前面，传 `beforeString`；要插到某段后面，传 `afterString`。二选一即可，不要两个都传。',
      '- `lineNumber` + `linePosition` 使用带行号的上下文定位；`beforeString / afterString` 使用原文片段定位。',
      '- `beforeString / afterString` 必须来自你已经看到的当前文件内容，并且尽量包含足够上下文，让它只匹配一处。',
      '- 它只插入新内容，不替换锚点；替换已有文字属于 `editProjectFileText`。'
    ]
  },
  writeProjectFiles: {
    name: 'writeProjectFiles',
    group: 'project',
    brief: '批量写入当前工作区的多个文件，适合项目级重写',
    exposeAsNative: false,
    schema: {
      name: 'writeProjectFiles',
      description: '在当前工作区里一次写入多个文件。适合把 HTML/CSS/JS 拆分、同步重写多个互相引用的项目文件；默认整份覆盖目标文件。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        files: {
          type: 'array',
          description: '要写入的工作区文件列表。默认 replaceContent=true，即整份覆盖；只有明确续写时才传 replaceContent=false。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              filePath: stringProperty('工作区里的文件路径，比如 index.html、styles/main.css、scripts/app.js。'),
              fileRole: stringProperty('可选。文件角色，比如 entry、style、logic、content、note。'),
              language: stringProperty('可选语言，比如 html、css、javascript、text。'),
              code: stringProperty('这份文件的完整正文。'),
              replaceContent: booleanProperty('可选。默认 true；false 表示追加到文件尾部。')
            },
            required: ['filePath', 'code']
          }
        },
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。写入后是否在收藏区打开工作区。')
      }, ['files'])
    },
    rules: [
      '4. writeProjectFiles：批量写入当前工作区的多个文件。',
      '- 这是工作区项目级写入工具，不是普通房间卡工具；只能在用户已经进入工作区对话后使用。',
      '- 它能在一次动作里写入 `index.html + CSS + JS` 这类互相引用的文件，避免多文件之间路径不同步。',
      '- 不传 `replaceContent=false` 时，每个文件都是整份替换；`replaceContent=false` 表示把该文件当作长文件续写追加。',
      '- 每个文件都写真实路径和完整正文；HTML 引用的 CSS/JS 路径必须和同批写入的文件路径对上。'
    ]
  },
  listProjectFiles: {
    name: 'listProjectFiles',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '列出当前工作区文件目录',
    schema: {
      name: 'listProjectFiles',
      description: '列出当前工作区里的文件路径、语言、角色和入口标记。它只返回目录，不返回文件正文。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '5. listProjectFiles：列出当前工作区文件目录。',
      '- 返回文件路径、语言、角色和入口标记；不返回文件正文。',
      '- 它是只读目录工具。'
    ]
  },
  searchProjectFiles: {
    name: 'searchProjectFiles',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '在当前工作区文件里定位代码片段并返回命中上下文',
    schema: {
      name: 'searchProjectFiles',
      description: '在当前工作区全部文件里定位一个代码片段、符号或路径片段，返回命中文件、行号、匹配原因和附近上下文。适合定位函数名、类名、锚点、缺失符号，或在局部替换前确认出现次数。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        query: stringProperty('要定位的代码片段、符号、文件路径片段或原文锚点。不要写正则；需要看函数就搜函数名，需要找锚点就搜原文片段。'),
        maxResults: numberProperty('可选。最多返回多少条命中；不传默认 20。'),
        targetLabel: stringProperty('可选的目标说明。')
      }, ['query'])
    },
    rules: [
      '6. searchProjectFiles：在当前工作区文件里定位代码片段。',
      '- 返回命中文件、行号、匹配原因和附近上下文。',
      '- 它适合定位函数名、类名、变量、HTML 锚点、路径片段或原文片段。',
      '- 它返回的是命中窗口，不是完整文件正文。'
    ]
  },
  readWorkspacePreviewState: {
    name: 'readWorkspacePreviewState',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '读取当前工作区预览里由宿主保存的运行时状态',
    schema: {
      name: 'readWorkspacePreviewState',
      description: '读取当前工作区托管预览已经同步给 Polaris 宿主的状态。只包含这个工作区 preview room 的 PolarisRoom、预览内 localStorage/sessionStorage shim 和自动保存的表单字段；不读取项目文件、真实浏览器存储、本机文件或其他工作区。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '7. readWorkspacePreviewState：读取当前工作区预览状态。',
      '- 只有用户在工作区设置里允许协作者读取预览状态时，这个工具才存在。',
      '- 它读取的是 Polaris 宿主保存的当前工作区 preview room state：`window.PolarisRoom`、预览内 `localStorage/sessionStorage` shim、自动保存的表单字段。',
      '- 它不读取项目文件；要看源码仍用 readProjectFile / searchProjectFiles。',
      '- 它不读取真实浏览器 localStorage、本机文件、其他工作区、外部网页或未托管页面。',
      '- 当用户问“我刚刚在预览里填了什么 / 当前页面状态是什么 / 你能看到我写进去的内容吗”，优先用它确认事实，不要要求用户再导出粘贴。'
    ]
  },
  listWorkspaceReferences: {
    name: 'listWorkspaceReferences',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '列出当前工作区的参考资料目录',
    schema: {
      name: 'listWorkspaceReferences',
      description: '列出当前工作区里的参考资料标题、摘要和 docId。它只返回目录，不返回资料全文。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '7. listWorkspaceReferences：列出当前工作区参考资料目录。',
      '- 参考资料只用于模型理解背景，不是运行产物，也不是项目文件。',
      '- 返回 docId、标题、摘要、字数和更新时间；不返回全文。'
    ]
  },
  searchWorkspaceReferences: {
    name: 'searchWorkspaceReferences',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '在当前工作区参考资料里搜索背景片段',
    schema: {
      name: 'searchWorkspaceReferences',
      description: '在当前工作区参考资料的标题、摘要和正文里搜索，返回命中的资料、匹配类型和片段。适合在读全文前判断哪份设定或小说材料相关。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        query: stringProperty('要搜索的背景、角色、设定、关键词或原文片段。不要写正则。'),
        maxResults: numberProperty('可选。最多返回多少条命中；不传默认 12。'),
        targetLabel: stringProperty('可选的目标说明。')
      }, ['query'])
    },
    rules: [
      '8. searchWorkspaceReferences：搜索当前工作区参考资料。',
      '- 返回命中的资料和片段，不返回完整正文。',
      '- 搜到目标后，用 `readWorkspaceReference` 按 docId 读取完整资料。'
    ]
  },
  readWorkspaceReference: {
    name: 'readWorkspaceReference',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '读取当前工作区的一份参考资料全文',
    schema: {
      name: 'readWorkspaceReference',
      description: '读取当前工作区某一份参考资料的完整正文。它只读背景材料，不修改产物文件。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        docId: stringProperty('参考资料 id。优先使用 listWorkspaceReferences 或 searchWorkspaceReferences 返回的 docId。'),
        title: stringProperty('可选。没有 docId 时可用精确标题读取；多个同名会失败。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '9. readWorkspaceReference：读取当前工作区参考资料全文。',
      '- 这是背景读取工具，不会修改工作区产物文件。',
      '- 优先传 `docId`；没有 docId 时才传精确 `title`。'
    ]
  },
  promoteWorkspaceReferenceToProjectFile: {
    name: 'promoteWorkspaceReferenceToProjectFile',
    group: 'project',
    brief: '把当前工作区的一份参考资料移成可修改的工作区文件',
    schema: {
      name: 'promoteWorkspaceReferenceToProjectFile',
      description: '把当前工作区参考资料移动成项目文件。原参考资料会移出参考资料区，新文件进入可编辑、可运行的工作区产物区。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        docId: stringProperty('参考资料 id。优先使用 listWorkspaceReferences 或 searchWorkspaceReferences 返回的 docId。'),
        title: stringProperty('可选。没有 docId 时可用精确标题匹配参考资料。'),
        filePath: stringProperty('要生成的工作区文件路径，比如 docs/source.md、story/chapter-01.md、data/notes.json。'),
        fileRole: stringProperty('可选。文件角色，比如 content、note、entry。'),
        language: stringProperty('可选语言，比如 markdown、text、json、html。'),
        replaceContent: booleanProperty('可选。目标路径已存在时是否覆盖；默认 true。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。是否在收藏区打开工作区。')
      }, ['filePath'])
    },
    rules: [
      '10. promoteWorkspaceReferenceToProjectFile：把参考资料移成可改的工作区文件。',
      '- 这是 Polaris 内部归类移动；原参考资料会从参考资料区移走，生成的新文件进入产物编辑和运行边界。',
      '- 当用户要“把参考资料拿来改”“把背景材料整理成产物文件”“让这份资料进入项目文件”时用它。',
      '- 必须传 `filePath`；优先用 `docId` 指定资料，没有 docId 时才用精确 `title`。',
      '- 目标路径已存在且确实要替换时保持默认；如果只是续写/合并，先读取目标文件再用文件编辑工具处理。'
    ]
  },
  pinProjectFileAsReference: {
    name: 'pinProjectFileAsReference',
    group: 'project',
    brief: '把当前工作区文件移成参考资料',
    schema: {
      name: 'pinProjectFileAsReference',
      description: '把当前工作区文件移动成参考资料。原项目文件会移出产物区，新参考资料只用于模型理解背景，不参与运行。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('要钉为参考资料的工作区文件路径。'),
        target: stringProperty('可选。兼容旧目标写法；工作区文件优先传 filePath。'),
        title: stringProperty('可选。新参考资料标题；不传就用文件路径。'),
        summary: stringProperty('可选。新参考资料摘要；不传会按文件路径生成一句摘要。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。是否在收藏区打开工作区。')
      }, ['filePath'])
    },
    rules: [
      '11. pinProjectFileAsReference：把项目文件移成参考资料。',
      '- 这是 Polaris 内部归类移动；原文件会从产物区移走，新参考资料只留在参考资料区。',
      '- 当某个文件暂时不参与运行、但以后要给模型当设定/资料/说明时用它。',
      '- 必须传当前工作区里的 `filePath`；不要用它替代 `deleteProjectFile`，如果产物区要删文件应另行明确删除。'
    ]
  },
  searchReadableContext: {
    name: 'searchReadableContext',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '跨产物文件、工作区参考和长期资料找可读取入口',
    schema: {
      name: 'searchReadableContext',
      description: '辅助搜索当前可读取材料，返回候选来源和推荐的下一步读取工具。它不返回完整正文，不替代 readProjectFile、readWorkspaceReference 或 readMemoryDoc。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        query: stringProperty('要找的主题、文件、角色、设定、片段或关键词。'),
        maxResults: numberProperty('可选。最多返回多少条候选；不传默认 12。'),
        targetLabel: stringProperty('可选的目标说明。')
      }, ['query'])
    },
    rules: [
      '10. searchReadableContext：跨当前可读取材料找入口。',
      '- 它只返回候选和推荐工具：项目文件用 `readProjectFile`，工作区参考用 `readWorkspaceReference`，协作者长期资料用 `readMemoryDoc`。',
      '- 这个工具是导航辅助，不是万能读取；需要正文时必须调用候选里推荐的 read 工具。'
    ]
  },
  checkProjectPreview: {
    name: 'checkProjectPreview',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '检查当前工作区预览入口、本地资源引用和脚本语法',
    schema: {
      name: 'checkProjectPreview',
      description: '轻量检查当前工作区能否形成预览：是否有 HTML 入口、入口文件是哪一个、本地 CSS/JS 引用是否能找到，并对入口引用的脚本做 parse 阶段语法预检，返回文件、行号和片段证据。不做视觉截图，也不自动修复。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '7. checkProjectPreview：检查当前工作区预览入口、资源引用和脚本语法。',
      '- 返回入口文件、资源引用、缺失文件、重复声明风险和 parse 阶段脚本语法错误。',
      '- 它是运行前诊断，不执行页面 JS，也不评价视觉效果。'
    ]
  },
  inspectProjectRuntime: {
    name: 'inspectProjectRuntime',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '实际运行当前工作区预览并返回 console/error/DOM 可见性反馈',
    schema: {
      name: 'inspectProjectRuntime',
      description: '在离屏预览 iframe 中实际运行当前工作区入口页，收集 console.log/warn/error、window error、unhandled rejection、资源加载失败、body 空态、可见节点、文本量和文档尺寸。适合写完或修完项目后确认真实运行错误。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        settleMs: numberProperty('可选。页面 load 后继续等待多少毫秒再采集；不传默认 1000。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '8. inspectProjectRuntime：实际运行当前工作区预览并返回 console/error/DOM 可见性反馈。',
      '- 返回 console、window error、unhandled rejection、资源加载失败、body 空态、可见节点、文本量和文档尺寸。',
      '- 它是离屏 iframe 运行反馈，不是视觉截图；能确认脚本有没有炸、页面有没有可见 DOM 和基础内容，但不能评价画面好不好看。'
    ]
  },
  editCodeCardText: {
    name: 'editCodeCardText',
    group: 'card',
    brief: '对房间卡正文做 oldString / newString 局部替换',
    schema: {
      name: 'editCodeCardText',
      description: '对现有房间卡正文做精确局部替换。适合只改卡里一小段文本，不需要整张重写。',
      parameters: objectParameters({
        target: stringProperty('目标卡片。写 active 表示当前活动房间，或直接写卡片 id / 标题。'),
        oldString: stringProperty('要被替换的原文片段。必须和当前卡片正文里某一处完全一致。'),
        newString: stringProperty('替换后的新片段。可以为空字符串，表示删除 oldString。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。替换后是否在收藏区打开这张卡。')
      }, ['oldString', 'newString'])
    },
    rules: [
      '7. editCodeCardText：对房间卡正文做局部替换。',
      '- 这是房间卡局部编辑工具，不是工作区文件工具；不要再传 `projectId + filePath`。',
      '- `oldString` 必须来自你已经看到的当前卡片正文，并且尽量带够上下文，让它只命中一处。',
      '- 如果要同时动卡面、小字、标签、标题或整份正文，改用 `patchCodeCard`，不要把所有事都塞进局部替换。'
    ]
  },
  editProjectFileText: {
    name: 'editProjectFileText',
    group: 'project',
    brief: '对工作区文件做 oldString / newString 局部替换',
    schema: {
      name: 'editProjectFileText',
      description: '对现有工作区文件做精确局部替换。适合只改几行、修一个函数、插入一段 UI，不需要重发整份文件。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        oldString: stringProperty('要被替换的原文片段。必须和当前文件中某一处完全一致。'),
        newString: stringProperty('替换后的新片段。可以为空字符串，表示删除 oldString。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。替换后是否在收藏区打开这张卡。')
      }, ['filePath', 'oldString', 'newString'])
    },
    rules: [
      '9. editProjectFileText：对工作区文件做局部替换。',
      '- 它用 `oldString / newString` 对单段原文做精确替换。',
      '- 必须明确 `filePath`：替换入口文件传 `filePath="index.html"`；替换脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- `oldString` 必须来自你已经看到的当前内容，并且尽量包含足够上下文，让它只匹配一处。',
      '- 它是精确单段替换，不是“按意思改这一块”。空格、换行、引号和缩进都要和当前文件里那一段完全一致。',
      '- 插入新内容属于 `insertProjectFile`；整份重写属于 `polaris-project-file mode=replace`。'
    ]
  },
  replaceProjectFileLines: {
    name: 'replaceProjectFileLines',
    group: 'project',
    brief: '按 readProjectFileContext 返回的行号替换工作区文件行段',
    schema: {
      name: 'replaceProjectFileLines',
      description: '对现有工作区文件按行号替换一段完整行。适合已经用 readProjectFileContext 或 searchProjectFiles 看到目标行号后，替换某几行而不手拼 oldString。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        startLine: numberProperty('要替换的起始行号，来自 readProjectFileContext 或 searchProjectFiles 返回。'),
        endLine: numberProperty('可选。要替换的结束行号；不传时只替换 startLine 这一行。'),
        code: stringProperty('替换后的完整行内容。可以为空字符串，表示删除这段行。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。替换后是否在收藏区打开工作区。')
      }, ['filePath', 'startLine', 'code'])
    },
    rules: [
      '10. replaceProjectFileLines：按行号替换工作区文件行段。',
      '- 先用 `readProjectFileContext` 或 `searchProjectFiles` 拿到目标行号；再传 `filePath + startLine + endLine + code`。',
      '- 适合替换完整的一行或连续多行；不需要手拼 `oldString`，也不会按语义模糊匹配。',
      '- 只想在某行前后新增内容，用 `insertProjectFile` 的 `lineNumber + linePosition`；同一个文件多处结构性修改，直接用 `polaris-project-file mode=replace`。'
    ]
  },
  deleteProjectFile: {
    name: 'deleteProjectFile',
    group: 'project',
    brief: '删除当前工作区里的一个文件',
    schema: {
      name: 'deleteProjectFile',
      description: '删除当前工作区里的一个文件。适合清理误建文件、废弃旧文件或删除不再被项目引用的文件；删除文件内容片段请用 editProjectFileText，把 newString 设为空字符串。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        targetLabel: stringProperty('可选的目标说明。'),
        openInCollection: booleanProperty('可选。删除后是否在收藏区打开工作区。')
      }, ['filePath'])
    },
    rules: [
      '11. deleteProjectFile：删除当前工作区里的一个文件。',
      '- 只在要删除整个文件时用它；删除文件里一段误写内容时，用 `editProjectFileText` 且 `newString=""`。',
      '- 必须明确 `filePath`：删除入口文件传 `filePath="index.html"`；删除脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- 它删除整个文件；删除文件里的片段属于 `editProjectFileText` 且 `newString=""`。'
    ]
  },
  readProjectFile: {
    name: 'readProjectFile',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '读取某个工作区文件全文',
    schema: {
      name: 'readProjectFile',
      description: '读取某个工作区文件的完整正文。它返回全文；用于上下文没有目标文件正文、用户要看全文，或需要确认完整文件结构。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        targetLabel: stringProperty('可选的目标说明。')
      }, ['filePath'])
    },
    rules: [
      '12. readProjectFile：读取某个工作区文件的完整正文。',
      '- 必须明确 `filePath`：读取入口文件传 `filePath="index.html"`；读取脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- 返回完整正文；不修改文件。目录信息属于 `listProjectFiles`，局部窗口属于 `readProjectFileContext`。'
    ]
  },
  readProjectFileContext: {
    name: 'readProjectFileContext',
    group: 'project',
    resultReplayMode: 'full-detail',
    brief: '读取某个工作区文件中锚点附近的局部上下文',
    schema: {
      name: 'readProjectFileContext',
      description: '读取某个工作区文件中指定 query 或 lineNumber 附近的局部上下文，返回带行号的片段。适合在长文件里定位修改点，不需要全文。',
      parameters: objectParameters({
        projectId: stringProperty('可选，默认当前工作区，通常省略。'),
        filePath: stringProperty('目标工作区文件路径（入口文件写 index.html，不写 active）。'),
        query: stringProperty('可选。要定位的精确字符串。和 lineNumber 二选一；两个都传时，query 是定位锚点。'),
        lineNumber: numberProperty('可选。要定位的行号。'),
        before: numberProperty('可选。返回锚点前多少行；不传默认 8。'),
        after: numberProperty('可选。返回锚点后多少行；不传默认 8。'),
        occurrence: numberProperty('可选。query 第几次出现；不传默认第 1 次。'),
        targetLabel: stringProperty('可选的目标说明。')
      }, ['filePath'])
    },
    rules: [
      '13. readProjectFileContext：读取某个工作区文件的局部上下文。',
      '- 必须明确 `filePath`：读取入口文件上下文传 `filePath="index.html"`；读取脚本就传 `filePath="script.js"`，不要写 active，也不要省略目标让系统猜。',
      '- 返回 query 或 lineNumber 附近的局部窗口和行号；不返回完整文件正文。',
      '- 返回内容带行号；拿到行号后可用 `replaceProjectFileLines` 替换完整行段。`editProjectFileText` 仍然需要原文片段完全一致。',
      '- 如果 query 没命中，它会返回文件开头并说明没有锚点。'
    ]
  },
  readCodeCard: {
    name: 'readCodeCard',
    group: 'card',
    resultReplayMode: 'full-detail',
    brief: '读取某张房间卡全文',
    schema: {
      name: 'readCodeCard',
      description: '读取某张房间卡的完整正文。它返回卡片全文，不修改卡片。',
      parameters: objectParameters({
        target: stringProperty('目标卡片。写 active 表示当前活动房间，或直接写卡片 id / 标题。'),
        targetLabel: stringProperty('可选的目标说明。')
      })
    },
    rules: [
      '8. readCodeCard：读取某张房间卡的完整正文。',
      '- 返回完整正文；不修改卡片。',
      '- 当前活动房间已经在上下文里给出全文时，readCodeCard 不会提供新的信息。'
    ]
  }
} satisfies Record<CardToolKind, PolarisToolDefinition>;

export const CARD_TOOL_DEFINITIONS = Object.values(CARD_TOOL_DEFINITION_MAP);

export const CARD_TOOL_ALIAS_DEFINITIONS = [] satisfies PolarisToolDefinition[];
