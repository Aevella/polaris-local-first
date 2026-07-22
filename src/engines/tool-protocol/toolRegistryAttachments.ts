import type { PolarisToolDefinition } from './toolRegistryShared';
import type { AssistantToolActionKind } from '../toolActionTypes';
import {
  booleanProperty,
  numberProperty,
  objectParameters,
  stringArrayProperty,
  stringProperty
} from './toolRegistryShared';

type AttachmentToolKind = Extract<
  AssistantToolActionKind,
  | 'inspectAttachments'
  | 'readAttachmentText'
  | 'bundleAttachments'
  | 'generateImage'
  | 'sendImageAttachment'
  | 'inspectImageAsset'
  | 'extractImagePalette'
  | 'createImageVariant'
  | 'saveAttachmentToCollection'
  | 'saveAttachmentAsCodeCard'
  | 'inspectArchiveEntries'
  | 'readArchiveEntryText'
  | 'bundleArchiveEntries'
  | 'saveArchiveEntryAsCodeCard'
>;

export const ATTACHMENT_TOOL_DEFINITION_MAP = {
  inspectAttachments: {
    name: 'inspectAttachments',
    group: 'attachment',
    resultReplayMode: 'full-detail',
    brief: '查看当前对话附件清单',
    schema: {
      name: 'inspectAttachments',
      description: '查看最近一条或当前对话里的附件清单。',
      parameters: objectParameters({
        scope: stringProperty('附件范围。latest 看最近一条，all 看当前对话。', {
          enum: ['latest', 'all']
        }),
        query: stringProperty('可选筛选词。')
      })
    },
    rules: [
      '附件动作：',
      '1. inspectAttachments：查看最近一条或当前对话里的附件清单。',
      '- 返回附件 id、文件名、类型和可筛选清单；不读取附件正文，也不读取图片画面内容。'
    ]
  },
  readAttachmentText: {
    name: 'readAttachmentText',
    group: 'attachment',
    resultReplayMode: 'full-detail',
    brief: '读取文本附件内容',
    schema: {
      name: 'readAttachmentText',
      description: '读取文本附件内容。',
      parameters: objectParameters({
        target: stringProperty('附件 id 或文件名。'),
        maxChars: numberProperty('最多读取多少字符。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '2. readAttachmentText：读取文本附件内容。'
    ]
  },
  bundleAttachments: {
    name: 'bundleAttachments',
    group: 'attachment',
    brief: '把多个附件重打包成 zip',
    schema: {
      name: 'bundleAttachments',
      description: '把多个附件重新打成 zip。',
      parameters: objectParameters({
        targets: stringArrayProperty('可选附件 id 或文件名列表。'),
        archiveName: stringProperty('可选 zip 文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '3. bundleAttachments：把多个附件重新打成 zip。'
    ]
  },
  generateImage: {
    name: 'generateImage',
    group: 'generation',
    brief: '按提示词生成图片',
    schema: {
      name: 'generateImage',
      description: '使用设置里的生图模型生成一张图片，并作为本地图片附件返回。',
      parameters: objectParameters({
        prompt: stringProperty('图片生成提示词。写清主体、风格、构图、颜色、限制。'),
        title: stringProperty('可选图片标题，也会作为附件文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['prompt'])
    },
    rules: [
      '生成图片动作：',
      '1. generateImage：按提示词生成一张新图片，返回本地图片附件。',
      '- 用户要求画图、生图、生成头像、封面、插图、素材时，用 generateImage。',
      '- 生成结果只是附件；用户说收起来、放进图片库时，再用 saveAttachmentToCollection。'
    ]
  },
  sendImageAttachment: {
    name: 'sendImageAttachment',
    group: 'attachment',
    brief: '把已有图片发到聊天里',
    schema: {
      name: 'sendImageAttachment',
      description: '把当前对话里的图片附件或图片收藏里的现有图片作为本地图片附件发到聊天里。不调用生图模型。',
      parameters: objectParameters({
        target: stringProperty('图片 URL、图片附件 id、图片卡 id、assetId、文件名或标题；省略时使用最近/唯一可用图片。'),
        title: stringProperty('可选显示文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '4. sendImageAttachment：把已有图片发到聊天里，返回本地图片附件。',
      '- 用户要“发这张图/把图片库里的某张图发出来/找一张已有图给我看/把这个图片链接发出来”时，用 sendImageAttachment。',
      '- sendImageAttachment 只复用或导入已有图片，不需要生图模型，也不要改用 generateImage。'
    ]
  },
  inspectImageAsset: {
    name: 'inspectImageAsset',
    group: 'attachment',
    brief: '检查图片素材尺寸、透明度和颜色属性',
    schema: {
      name: 'inspectImageAsset',
      description: '检查图片附件的尺寸、比例、透明通道、平均色、主色和可用于 CSS 的本地地址；不做画面语义识别。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '5. inspectImageAsset：检查图片素材尺寸、透明度、主色和 `polaris-asset://...` CSS 地址。',
      '- inspectImageAsset 返回尺寸、透明度和本地素材地址，不回答图片里是什么内容；extractImagePalette 返回配色建议。'
    ]
  },
  extractImagePalette: {
    name: 'extractImagePalette',
    group: 'attachment',
    brief: '从图片提取主题配色',
    schema: {
      name: 'extractImagePalette',
      description: '从图片附件提取平均色、主色、建议文字色和主题变量建议。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '6. extractImagePalette：从图片提取 background / surface / accent / text 建议。'
    ]
  },
  createImageVariant: {
    name: 'createImageVariant',
    group: 'attachment',
    brief: '生成换肤用图片变体',
    schema: {
      name: 'createImageVariant',
      description: '从图片附件生成新的本地图片素材，例如背景版、气泡贴纸版、头像版或缩略图版。返回新的附件和 `polaris-asset://...` CSS 地址，不修改原图。',
      parameters: objectParameters({
        target: stringProperty('目标图片附件 id 或文件名；省略时使用最近图片附件。'),
        purpose: stringProperty('变体用途。', {
          enum: ['background', 'bubble-sticker', 'avatar', 'thumbnail']
        }),
        width: numberProperty('输出宽度，默认按用途决定。'),
        height: numberProperty('输出高度，默认按用途决定。'),
        fit: stringProperty('图片适配方式。cover 会裁切铺满，contain 会完整放入。', {
          enum: ['cover', 'contain']
        }),
        blur: numberProperty('可选模糊半径，适合背景素材。'),
        dim: numberProperty('可选压暗强度，适合保证文字可读。'),
        format: stringProperty('输出格式。', {
          enum: ['png', 'jpeg', 'webp']
        }),
        quality: numberProperty('jpeg/webp 输出质量。'),
        name: stringProperty('可选输出文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '7. createImageVariant：把原图加工成适合界面使用的新素材，并返回新的 `url("polaris-asset://...")`。',
      '- `purpose=background` 会输出背景向素材；`purpose=bubble-sticker` 会输出气泡角标、贴纸、小尾巴向素材。',
      '- 需要保证正文可读时，可以给背景变体加 dim 或 blur；不要改原图。'
    ]
  },
  saveAttachmentToCollection: {
    name: 'saveAttachmentToCollection',
    group: 'attachment',
    brief: '把图片附件收进图片收藏',
    schema: {
      name: 'saveAttachmentToCollection',
      description: '把图片附件收进图片收藏。',
      parameters: objectParameters({
        target: stringProperty('目标附件 id 或文件名。'),
        title: stringProperty('可选标题。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '8. saveAttachmentToCollection：把图片附件收进图片收藏。',
      '- 用户说“把这张图/二维码收起来”时，用 saveAttachmentToCollection。'
    ]
  },
  saveAttachmentAsCodeCard: {
    name: 'saveAttachmentAsCodeCard',
    group: 'attachment',
    brief: '把文本附件收成房间卡',
    schema: {
      name: 'saveAttachmentAsCodeCard',
      description: '把文本附件收成房间卡。',
      parameters: objectParameters({
        target: stringProperty('目标附件 id 或文件名。'),
        title: stringProperty('可选标题。'),
        language: stringProperty('可选语言。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '9. saveAttachmentAsCodeCard：把文本附件收成房间卡。',
      '- 用户说“把这个文件收成房间”时，用 saveAttachmentAsCodeCard。'
    ]
  },
  inspectArchiveEntries: {
    name: 'inspectArchiveEntries',
    group: 'archive',
    resultReplayMode: 'full-detail',
    brief: '查看 zip 包内目录',
    schema: {
      name: 'inspectArchiveEntries',
      description: '查看某个 zip 附件里的文件条目。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        query: stringProperty('可选筛选词。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '压缩包动作：',
      '1. inspectArchiveEntries：查看 zip 包内目录。',
      '- 返回 zip 包内条目清单；不读取条目正文。'
    ]
  },
  readArchiveEntryText: {
    name: 'readArchiveEntryText',
    group: 'archive',
    resultReplayMode: 'full-detail',
    brief: '读取 zip 包内文件文本',
    schema: {
      name: 'readArchiveEntryText',
      description: '读取 zip 包内某个文件的文本内容。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entry: stringProperty('压缩包内的文件路径。'),
        maxChars: numberProperty('最多读取多少字符。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['entry'])
    },
    rules: [
      '2. readArchiveEntryText：读取 zip 包内某个文件的文本内容。'
    ]
  },
  bundleArchiveEntries: {
    name: 'bundleArchiveEntries',
    group: 'archive',
    brief: '重打包 zip 包内文件',
    schema: {
      name: 'bundleArchiveEntries',
      description: '按条目重打包 zip 包内文件。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entries: stringArrayProperty('可选。zip 内要包含的文件路径。'),
        prefixes: stringArrayProperty('可选。zip 内要包含的目录前缀。'),
        excludeEntries: stringArrayProperty('可选。zip 内要排除的文件路径。'),
        excludePrefixes: stringArrayProperty('可选。zip 内要排除的目录前缀。'),
        archiveName: stringProperty('可选 zip 文件名。'),
        targetLabel: stringProperty('可选目标说明。')
      })
    },
    rules: [
      '3. bundleArchiveEntries：按条目重打包 zip 包内文件。'
    ]
  },
  saveArchiveEntryAsCodeCard: {
    name: 'saveArchiveEntryAsCodeCard',
    group: 'archive',
    brief: '把 zip 包内文本收成房间卡',
    schema: {
      name: 'saveArchiveEntryAsCodeCard',
      description: '把 zip 包内某个文本文件收成房间卡。',
      parameters: objectParameters({
        target: stringProperty('目标 zip 附件 id 或文件名。'),
        entry: stringProperty('压缩包内的文件路径。'),
        title: stringProperty('可选标题。'),
        language: stringProperty('可选语言。'),
        tags: stringArrayProperty('可选中文标签。'),
        openInCollection: booleanProperty('是否在收藏区打开。'),
        targetLabel: stringProperty('可选目标说明。')
      }, ['entry'])
    },
    rules: [
      '4. saveArchiveEntryAsCodeCard：把 zip 包内某个文本文件收成房间卡。'
    ]
  }
} satisfies Record<AttachmentToolKind, PolarisToolDefinition<AttachmentToolKind>>;

export const ATTACHMENT_TOOL_DEFINITIONS = Object.values(ATTACHMENT_TOOL_DEFINITION_MAP);
