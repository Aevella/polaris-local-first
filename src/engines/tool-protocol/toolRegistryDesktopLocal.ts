import type { AssistantToolActionKind } from '../toolActionTypes';
import {
  booleanProperty,
  numberProperty,
  objectParameters,
  stringArrayProperty,
  stringProperty,
  type PolarisToolDefinition
} from './toolRegistryShared';

type DesktopLocalToolKind = Extract<
  AssistantToolActionKind,
  | 'listDesktopWorkspaces'
  | 'listDesktopFiles'
  | 'readDesktopFile'
  | 'searchDesktopFiles'
  | 'readDesktopFileContext'
  | 'writeDesktopFile'
  | 'editDesktopFileText'
  | 'replaceDesktopFileLines'
  | 'createDesktopDirectory'
  | 'deleteDesktopPath'
  | 'moveDesktopPath'
  | 'runDesktopCommand'
  | 'runDesktopCommandSequence'
  | 'startDesktopCommand'
  | 'listDesktopCommandSessions'
  | 'stopDesktopCommand'
  | 'syncDesktopWorkspaceFromDisk'
  | 'syncDesktopWorkspaceToDisk'
>;

export const DESKTOP_LOCAL_TOOL_DEFINITION_MAP = {
  listDesktopWorkspaces: {
    name: 'listDesktopWorkspaces',
    group: 'desktop',
    resultReplayMode: 'full-detail',
    brief: '列出已授权的 Mac 本机文件夹',
    schema: {
      name: 'listDesktopWorkspaces',
      description: '列出官网 Mac 桌面版里已经授权给 Polaris 的本机文件夹。不会读取文件正文。',
      parameters: objectParameters({
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '本机环境动作：',
      '- 把这些工具当成受授权 rootId 限制的普通 filesystem + terminal 能力：先观察真实目录/文件，再做最小改动，最后运行命令验证。',
      '1. listDesktopWorkspaces：列出已授权的 Mac 本机文件夹。',
      '- 本机工具只能碰用户在设置 → 本机环境里选过的文件夹；没有授权文件夹时不要假装能访问电脑文件。',
      '- 多个本机工作区同时存在时，先读取目录确认 rootId；省略 rootId 会使用列表里的第一个工作区。'
    ]
  },
  listDesktopFiles: {
    name: 'listDesktopFiles',
    group: 'desktop',
    resultReplayMode: 'full-detail',
    brief: '列出已授权本机文件夹里的目录',
    schema: {
      name: 'listDesktopFiles',
      description: '列出某个已授权本机工作区里的目录条目。只返回文件名和类型，不返回正文。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        path: stringProperty('可选。相对本机工作区根目录的目录路径；省略表示根目录。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '2. listDesktopFiles：列出已授权本机工作区里的目录。',
      '- path 必须是相对路径，不能传绝对路径，也不能用 .. 越出已授权文件夹。',
      '- 需要修改或运行前，先用它确认真实文件名和目录结构。'
    ]
  },
  readDesktopFile: {
    name: 'readDesktopFile',
    group: 'desktop',
    resultReplayMode: 'full-detail',
    brief: '读取已授权本机工作区里的 UTF-8 文件',
    schema: {
      name: 'readDesktopFile',
      description: '读取已授权本机工作区里的 UTF-8 文本文件全文。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        filePath: stringProperty('相对本机工作区根目录的文件路径。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['filePath'])
    },
    rules: [
      '3. readDesktopFile：读取已授权本机工作区里的文本文件。',
      '- filePath 必须是相对路径。读到的内容属于用户本机资料，只按任务需要使用。'
    ]
  },
  searchDesktopFiles: {
    name: 'searchDesktopFiles',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '搜索已授权本机工作区里的常见文本文件',
    schema: {
      name: 'searchDesktopFiles',
      description: '在已授权本机工作区里的常见文本文件中搜索路径或正文，跳过 .git、node_modules、构建产物和 .polaris 元数据。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        path: stringProperty('可选。相对本机工作区根目录的目录前缀；省略表示根目录。'),
        query: stringProperty('要搜索的路径或正文片段。'),
        maxResults: numberProperty('可选。最多返回多少处命中；省略时按默认工作区搜索窗口返回。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['query'])
    },
    rules: [
      '4. searchDesktopFiles：搜索已授权本机工作区里的常见文本文件。',
      '- 用它定位文件、函数名、样式片段或报错文本；返回行号和附近片段。',
      '- 搜索只读真实文件，不写入；会跳过依赖、构建产物、git 元数据和 Polaris 元数据目录。'
    ]
  },
  readDesktopFileContext: {
    name: 'readDesktopFileContext',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '读取已授权本机文件的行号上下文',
    schema: {
      name: 'readDesktopFileContext',
      description: '读取已授权本机文本文件的局部上下文，按 query 或 lineNumber 返回带行号的片段。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        filePath: stringProperty('相对本机工作区根目录的文件路径。'),
        query: stringProperty('可选。要定位的正文片段。'),
        lineNumber: numberProperty('可选。要定位的行号。'),
        before: numberProperty('可选。锚点前返回多少行。'),
        after: numberProperty('可选。锚点后返回多少行。'),
        occurrence: numberProperty('可选。query 第几次命中。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['filePath'])
    },
    rules: [
      '5. readDesktopFileContext：读取本机文件的行号上下文。',
      '- 适合在 searchDesktopFiles 找到路径后读取局部行号，再用 replaceDesktopFileLines 或 editDesktopFileText 改。',
      '- query 没命中时会返回文件开头并标出未命中，不要凭空替换。'
    ]
  },
  writeDesktopFile: {
    name: 'writeDesktopFile',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '写入已授权本机工作区里的 UTF-8 文件',
    schema: {
      name: 'writeDesktopFile',
      description: '把 UTF-8 文本写入已授权本机工作区里的文件。会创建中间目录并整份覆盖目标文件。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        filePath: stringProperty('相对本机工作区根目录的文件路径。'),
        content: stringProperty('要写入的完整文件正文。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['filePath', 'content'])
    },
    rules: [
      '6. writeDesktopFile：写入已授权本机工作区里的文本文件。',
      '- 这是整份覆盖；局部改动要先 readDesktopFile 看当前内容，再写回完整文件。',
      '- 写入真实电脑文件前要尊重用户的本机权限模式：每步确认会弹系统确认，信任文件读写会直接落盘。'
    ]
  },
  editDesktopFileText: {
    name: 'editDesktopFileText',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '精确局部替换已授权本机工作区里的文本文件',
    schema: {
      name: 'editDesktopFileText',
      description: '读取已授权本机工作区里的文本文件，用 oldString/newString 精确替换唯一命中的片段，再写回真实文件。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        filePath: stringProperty('相对本机工作区根目录的文件路径。'),
        oldString: stringProperty('当前文件中必须唯一命中的原文片段；必须和真实文件完全一致，包括空格、换行和引号。'),
        newString: stringProperty('替换后的新片段。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['filePath', 'oldString', 'newString'])
    },
    rules: [
      '7. editDesktopFileText：精确局部替换已授权本机文件。',
      '- 适合普通开发里的小 patch；优先用它改局部，不要为了改一小段就整份覆盖。',
      '- oldString 必须在当前真实文件中唯一命中；没命中或多处命中时工具会拒绝。',
      '- 不确定片段时，先 readDesktopFile 或 listDesktopFiles 定位，再提交更长、更稳定的 oldString。'
    ]
  },
  replaceDesktopFileLines: {
    name: 'replaceDesktopFileLines',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '按行替换已授权本机文件',
    schema: {
      name: 'replaceDesktopFileLines',
      description: '读取已授权本机文本文件，用 startLine/endLine 替换完整行区间，再写回真实文件。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        filePath: stringProperty('相对本机工作区根目录的文件路径。'),
        startLine: numberProperty('要替换的起始行号，从 1 开始。'),
        endLine: numberProperty('可选。要替换的结束行号；省略表示只替换 startLine。'),
        code: stringProperty('替换后的完整行段内容。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['filePath', 'startLine', 'code'])
    },
    rules: [
      '8. replaceDesktopFileLines：按行替换本机文件。',
      '- 适合已经通过 searchDesktopFiles 或 readDesktopFileContext 拿到行号的修改。',
      '- startLine/endLine 必须来自当前真实文件上下文；行号无效时工具会拒绝。'
    ]
  },
  createDesktopDirectory: {
    name: 'createDesktopDirectory',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '在已授权本机工作区里创建文件夹',
    schema: {
      name: 'createDesktopDirectory',
      description: '在已授权本机工作区里创建文件夹。会递归创建中间目录。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        path: stringProperty('相对本机工作区根目录的文件夹路径。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['path'])
    },
    rules: [
      '9. createDesktopDirectory：创建本机文件夹。',
      '- path 必须是相对路径，不能越出已授权本机工作区。',
      '- 适合在写入多文件前先建立清楚的目录结构。'
    ]
  },
  deleteDesktopPath: {
    name: 'deleteDesktopPath',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '删除已授权本机工作区里的文件或文件夹',
    schema: {
      name: 'deleteDesktopPath',
      description: '删除已授权本机工作区里的文件或文件夹。文件夹会递归删除；不能删除工作区根目录。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        path: stringProperty('相对本机工作区根目录的文件或文件夹路径。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['path'])
    },
    rules: [
      '10. deleteDesktopPath：删除本机文件或文件夹。',
      '- path 必须来自真实目录观察结果；不确定时先 listDesktopFiles。',
      '- 这是破坏性动作：文件夹会递归删除，不能用于清空或删除已授权根目录。'
    ]
  },
  moveDesktopPath: {
    name: 'moveDesktopPath',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '移动或重命名已授权本机工作区里的路径',
    schema: {
      name: 'moveDesktopPath',
      description: '移动或重命名已授权本机工作区里的文件或文件夹。目标路径必须不存在；会创建目标父目录。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        fromPath: stringProperty('相对本机工作区根目录的来源路径。'),
        toPath: stringProperty('相对本机工作区根目录的目标路径。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['fromPath', 'toPath'])
    },
    rules: [
      '11. moveDesktopPath：移动或重命名本机路径。',
      '- fromPath/toPath 都必须是相对路径，不能越出已授权本机工作区。',
      '- 目标路径已存在时工具会拒绝；不要用移动动作覆盖未知文件。'
    ]
  },
  runDesktopCommand: {
    name: 'runDesktopCommand',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '在已授权本机工作区里运行命令',
    schema: {
      name: 'runDesktopCommand',
      description: '在已授权本机工作区目录内运行本机命令，返回 exitCode、stdout 和 stderr。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        command: stringProperty('命令名，比如 npm、node、git。不要把参数塞进 command。'),
        args: stringArrayProperty('命令参数数组，比如 ["run","build"]。'),
        cwdPath: stringProperty('可选。相对本机工作区根目录的工作目录；省略表示根目录。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['command'])
    },
    rules: [
      '12. runDesktopCommand：在已授权本机工作区里运行命令。',
      '- command 只写命令名，参数放 args；不要用 shell 字符串拼接。',
      '- cwdPath 必须是相对目录，不能越出已授权本机工作区。',
      '- 命令不是文件读写沙盒；即使用户开启信任文件读写，运行命令也会由桌面宿主逐次确认。',
      '- 会返回 stdout / stderr 和退出码；退出码非 0 不等于工具坏了，而是命令本身失败。',
      '- 像处理普通终端输出一样处理结果：错误可定位就继续改，验证通过或证据够了再收尾。'
    ]
  },
  runDesktopCommandSequence: {
    name: 'runDesktopCommandSequence',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '在已授权本机工作区里顺序运行一组验证命令',
    schema: {
      name: 'runDesktopCommandSequence',
      description: '在已授权本机工作区目录内顺序运行一组本机命令，适合 typecheck/test/build 等验证流程。默认遇到失败步骤即停止；设置 continueOnError=true 可继续收集后续步骤输出。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        steps: {
          type: 'array',
          description: '要顺序运行的命令步骤。',
          items: objectParameters({
            label: stringProperty('可选。这个步骤的人类可读标签，比如 typecheck、test、build。'),
            command: stringProperty('命令名，比如 npm、node、git。不要把参数塞进 command。'),
            args: stringArrayProperty('命令参数数组，比如 ["run","build"]。'),
            cwdPath: stringProperty('可选。相对本机工作区根目录的工作目录；省略表示根目录。')
          }, ['command'])
        },
        continueOnError: booleanProperty('可选。默认 false。true 表示某一步失败后仍继续运行后续步骤以收集更多验证证据。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['steps'])
    },
    rules: [
      '13. runDesktopCommandSequence：运行本机验证流程。',
      '- 用于 typecheck/test/build/lint 这类短命令验证链；dev server、watch 仍然用 startDesktopCommand。',
      '- 每个 step 的 command 只写命令名，参数放 args；cwdPath 必须是相对目录，不能越出已授权本机工作区。',
      '- 默认某一步失败就停止，把失败步骤的 stdout/stderr 当作下一轮修复证据；需要同时收集多个检查结果时才设 continueOnError=true。',
      '- 这不是自动修复器：修复仍然由后续模型回合根据真实输出执行。'
    ]
  },
  startDesktopCommand: {
    name: 'startDesktopCommand',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '在已授权本机工作区里启动一个持久终端会话',
    schema: {
      name: 'startDesktopCommand',
      description: '在已授权本机工作区目录内启动一个持久本机命令会话，适合 dev server、watch、长时间运行测试等需要后续查看或停止的命令。',
      parameters: objectParameters({
        rootId: stringProperty('可选。本机工作区 id；省略时使用第一个已授权工作区。'),
        command: stringProperty('命令名，比如 npm、node、git。不要把参数塞进 command。'),
        args: stringArrayProperty('命令参数数组，比如 ["run","dev"]。'),
        cwdPath: stringProperty('可选。相对本机工作区根目录的工作目录；省略表示根目录。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['command'])
    },
    rules: [
      '14. startDesktopCommand：启动持久本机终端会话。',
      '- 用于 dev server、watch、长时间运行测试这类需要持续观察或停止的命令；短命令优先用 runDesktopCommand。',
      '- command 只写命令名，参数放 args；cwdPath 必须是相对目录，不能越出已授权本机工作区。',
      '- 命令启动仍然由桌面宿主逐次确认；工具返回 sessionId，后续用 listDesktopCommandSessions 查看输出，用 stopDesktopCommand 停止。'
    ]
  },
  listDesktopCommandSessions: {
    name: 'listDesktopCommandSessions',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '查看当前桌面宿主记录的本机终端会话',
    schema: {
      name: 'listDesktopCommandSessions',
      description: '查看官网 Mac 桌面版当前记录的持久终端会话，包括运行状态、命令、cwd、stdout、stderr 和退出信息。',
      parameters: objectParameters({
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '15. listDesktopCommandSessions：查看持久本机终端会话。',
      '- 在启动 dev server/watch 后用它查看输出、端口、报错或退出状态。',
      '- 如果会话仍在 running，不要把它当作已经完成；需要停止时用 stopDesktopCommand。'
    ]
  },
  stopDesktopCommand: {
    name: 'stopDesktopCommand',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '停止一个持久本机终端会话',
    schema: {
      name: 'stopDesktopCommand',
      description: '按 sessionId 停止官网 Mac 桌面版里的持久终端会话。',
      parameters: objectParameters({
        sessionId: stringProperty('要停止的终端会话 id。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['sessionId'])
    },
    rules: [
      '16. stopDesktopCommand：停止持久本机终端会话。',
      '- 只停止由 startDesktopCommand 或桌面终端卡创建并仍被宿主记录的会话。',
      '- 停止后继续用 listDesktopCommandSessions 或工具结果里的 stdout/stderr 判断是否已正常收尾。'
    ]
  },
  syncDesktopWorkspaceFromDisk: {
    name: 'syncDesktopWorkspaceFromDisk',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '把绑定的真实电脑文件夹同步进 Polaris 工作区',
    schema: {
      name: 'syncDesktopWorkspaceFromDisk',
      description: '读取当前绑定的 Mac 文件夹，把常见文本文件同步进对应 Polaris 工作区投影。只适用于官网 Mac 桌面版的已绑定工作区。',
      parameters: objectParameters({
        projectId: stringProperty('可选。绑定了 Mac 文件夹的 Polaris 工作区 id；省略时使用当前活动工作区。'),
        rootId: stringProperty('可选。必须与工作区绑定的 rootId 一致。'),
        allowOverwrite: booleanProperty('可选。默认 false。存在同路径覆盖或两边都改过时必须用户明确同意后才设为 true。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '17. syncDesktopWorkspaceFromDisk：把真实电脑文件夹同步进 Polaris 工作区。',
      '- 只用于已绑定 Mac 本机文件夹的工作区；网页、安卓、iOS 没有这个能力。',
      '- 发现同路径覆盖或两边都改过时，工具会拒绝；必须先向用户说明风险，用户同意后才用 allowOverwrite=true 重试。',
      '- 它不会删除 Polaris 里多出的文件。'
    ]
  },
  syncDesktopWorkspaceToDisk: {
    name: 'syncDesktopWorkspaceToDisk',
    group: 'desktop',
    resultReplayMode: 'detail-excerpt',
    brief: '把绑定的 Polaris 工作区写回真实电脑文件夹',
    schema: {
      name: 'syncDesktopWorkspaceToDisk',
      description: '把绑定 Polaris 工作区里的项目文件批量写回 Mac 真实文件夹，并更新 .polaris/workspace.json。只适用于官网 Mac 桌面版的已绑定工作区。',
      parameters: objectParameters({
        projectId: stringProperty('可选。绑定了 Mac 文件夹的 Polaris 工作区 id；省略时使用当前活动工作区。'),
        rootId: stringProperty('可选。必须与工作区绑定的 rootId 一致。'),
        allowOverwrite: booleanProperty('可选。默认 false。存在同路径覆盖或两边都改过时必须用户明确同意后才设为 true。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '18. syncDesktopWorkspaceToDisk：把 Polaris 工作区写回真实电脑文件夹。',
      '- 只用于已绑定 Mac 本机文件夹的工作区；网页、安卓、iOS 没有这个能力。',
      '- 这是批量写真实文件；发现同路径覆盖或两边都改过时，必须先向用户说明风险，用户同意后才用 allowOverwrite=true 重试。',
      '- 它会覆盖同路径文件，但不会删除电脑文件夹里多出的文件。'
    ]
  }
} satisfies Record<DesktopLocalToolKind, PolarisToolDefinition<DesktopLocalToolKind>>;

export const DESKTOP_LOCAL_TOOL_DEFINITIONS = Object.values(DESKTOP_LOCAL_TOOL_DEFINITION_MAP);
