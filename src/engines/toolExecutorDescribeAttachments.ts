import type { ToolAction } from './toolExecutorTypes';
import type { ToolActionDescription } from './toolExecutorDescribe';

export type AttachmentsToolAction = Extract<
  ToolAction,
  {
    kind:
      | 'inspectAttachments'
      | 'webSearch'
      | 'readWebPage'
      | 'listCalendars'
      | 'readCalendarEvents'
      | 'createCalendarEvent'
      | 'updateCalendarEvent'
      | 'deleteCalendarEvent'
      | 'readAttachmentText'
      | 'bundleAttachments'
      | 'createQrCode'
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
      | 'runCode';
  }
>;

/**
 * Natural-language descriptions for the attachment / web / calendar / image / archive / code-run
 * tool actions. This is **description only**: pure field formatting with no side effects. The
 * executors — attachment reading, web access, calendar permissions, image generation, the code
 * sandbox — live elsewhere and are untouched. The central `describeToolAction` dispatcher
 * delegates these kinds here.
 */
export function describeAttachmentsToolAction(action: AttachmentsToolAction): ToolActionDescription {
  switch (action.kind) {
    case 'inspectAttachments':
      return {
        kind: action.kind,
        title: '检查附件',
        summary: `检查 ${action.scope === 'all' ? '当前对话' : '最近一条'}附件${action.query ? ` · ${action.query}` : ''}`
      };
    case 'webSearch':
      return {
        kind: action.kind,
        title: '联网搜索',
        summary: `搜索网页结果 · ${action.query}`,
        targetLabel: action.targetLabel ?? action.query
      };
    case 'readWebPage':
      return {
        kind: action.kind,
        title: '读取网页',
        summary: `读取网页正文 · ${action.url}`,
        targetLabel: action.targetLabel ?? action.url
      };
    case 'listCalendars':
      return {
        kind: action.kind,
        title: '读取可写日历',
        summary: '读取设备上的可写系统日历',
        targetLabel: action.targetLabel
      };
    case 'readCalendarEvents':
      return {
        kind: action.kind,
        title: '读取系统日历',
        summary: `读取日历事件${action.query ? ` · ${action.query}` : ''}`,
        targetLabel: action.targetLabel ?? action.query
      };
    case 'createCalendarEvent':
      return {
        kind: action.kind,
        title: '创建系统日程',
        summary: `创建日程 · ${action.title}`,
        targetLabel: action.targetLabel ?? action.title
      };
    case 'updateCalendarEvent':
      return {
        kind: action.kind,
        title: '修改系统日程',
        summary: `修改日程 · ${action.targetLabel ?? action.title ?? action.eventId}`,
        targetLabel: action.targetLabel ?? action.title ?? action.eventId
      };
    case 'deleteCalendarEvent':
      return {
        kind: action.kind,
        title: '删除系统日程',
        summary: `删除日程 · ${action.targetLabel ?? action.eventId}`,
        targetLabel: action.targetLabel ?? action.eventId
      };
    case 'readAttachmentText':
      return {
        kind: action.kind,
        title: '读取附件',
        summary: `读取文本附件${action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.target
      };
    case 'bundleAttachments':
      return {
        kind: action.kind,
        title: '打包附件',
        summary: `重新打包附件${action.archiveName ? ` · ${action.archiveName}` : ''}`,
        targetLabel: action.targetLabel ?? action.archiveName
      };
    case 'createQrCode':
      return {
        kind: action.kind,
        title: '生成二维码',
        summary: `生成二维码${action.targetLabel ? ` · ${action.targetLabel}` : ''}`,
        targetLabel: action.targetLabel ?? action.fileName
      };
    case 'generateImage':
      return {
        kind: action.kind,
        title: '生成图片',
        summary: `按提示词生成图片${action.targetLabel ? ` · ${action.targetLabel}` : action.title ? ` · ${action.title}` : ''}`,
        targetLabel: action.targetLabel ?? action.title
      };
    case 'sendImageAttachment':
      return {
        kind: action.kind,
        title: '发送图片',
        summary: `发送已有图片${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.title ?? action.target
      };
    case 'inspectImageAsset':
      return {
        kind: action.kind,
        title: '检查图片素材',
        summary: `检查图片尺寸、透明度和主色${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.target
      };
    case 'extractImagePalette':
      return {
        kind: action.kind,
        title: '提取图片配色',
        summary: `从图片提取主题配色${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.target
      };
    case 'createImageVariant':
      return {
        kind: action.kind,
        title: '生成图片素材',
        summary: `生成${action.purpose === 'bubble-sticker' ? '气泡贴纸' : action.purpose === 'avatar' ? '头像' : action.purpose === 'thumbnail' ? '缩略图' : '背景'}素材${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.name ?? action.target
      };
    case 'saveAttachmentToCollection':
      return {
        kind: action.kind,
        title: '存入图片收藏',
        summary: `把图片存进图片卡${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.title ?? action.target
      };
    case 'saveAttachmentAsCodeCard':
      return {
        kind: action.kind,
        title: '存成房间',
        summary: `把文本附件存成房间${action.targetLabel ? ` · ${action.targetLabel}` : action.target ? ` · ${action.target}` : ''}`,
        targetLabel: action.targetLabel ?? action.title ?? action.target
      };
    case 'inspectArchiveEntries':
      return {
        kind: action.kind,
        title: '查看压缩包',
        summary: `查看 zip 目录${action.target ? ` · ${action.target}` : ''}${action.query ? ` · ${action.query}` : ''}`,
        targetLabel: action.targetLabel ?? action.target
      };
    case 'readArchiveEntryText':
      return {
        kind: action.kind,
        title: '读取包内文件',
        summary: `读取 zip 内文件${action.entry ? ` · ${action.entry}` : ''}`,
        targetLabel: action.targetLabel ?? action.entry ?? action.target
      };
    case 'bundleArchiveEntries':
      return {
        kind: action.kind,
        title: '重打包压缩包文件',
        summary: `从 zip 里挑文件重新打包${
          action.prefixes?.length
            ? ` · ${action.prefixes.join('、')}`
            : action.archiveName
              ? ` · ${action.archiveName}`
              : ''
        }${
          action.excludePrefixes?.length
            ? ` · 排除 ${action.excludePrefixes.join('、')}`
            : action.excludeEntries?.length
              ? ` · 排除 ${action.excludeEntries.join('、')}`
              : ''
        }`,
        targetLabel: action.targetLabel ?? action.archiveName ?? action.target
      };
    case 'saveArchiveEntryAsCodeCard':
      return {
        kind: action.kind,
        title: '压缩包文件存成房间',
        summary: `把 zip 内文件存成房间${action.entry ? ` · ${action.entry}` : ''}`,
        targetLabel: action.targetLabel ?? action.title ?? action.entry ?? action.target
      };
    case 'runCode':
      return {
        kind: action.kind,
        title: '执行代码',
        summary: `执行 JavaScript${action.targetLabel ? ` · ${action.targetLabel}` : ''}`,
        targetLabel: action.targetLabel
      };
  }
}
