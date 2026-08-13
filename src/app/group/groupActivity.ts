import type { Conversation } from '../../types/domain';
import { isPlayableAudioAttachment } from '../../engines/attachmentMedia';

// 私域里干什么，群面上就显示什么——不让一切都伪装成「正在输入」
const TOOL_ACTIVITY_KEYS = {
  searchMemory: 'group.activity.recall',
  readMemoryDoc: 'group.activity.recall',
  openMemorySource: 'group.activity.recall',
  writeMemory: 'group.activity.memorize',
  writeMemoryDoc: 'group.activity.memorize',
  generateImage: 'group.activity.image',
  createImageVariant: 'group.activity.imageWork',
  inspectImageAsset: 'group.activity.imageWork',
  extractImagePalette: 'group.activity.imageWork',
  createQrCode: 'group.activity.qr',
  webSearch: 'group.activity.webSearch',
  readWebPage: 'group.activity.webRead',
  inspectAttachments: 'group.activity.attachments',
  readAttachmentText: 'group.activity.attachments',
  inspectArchiveEntries: 'group.activity.attachments',
  readArchiveEntryText: 'group.activity.attachments',
  bundleArchiveEntries: 'group.activity.attachments',
  bundleAttachments: 'group.activity.attachments',
  saveAttachmentToCollection: 'group.activity.attachments',
  createCodeCard: 'group.activity.cardMake',
  patchCodeCard: 'group.activity.cardMake',
  appendCodeCard: 'group.activity.cardMake',
  editCodeCardText: 'group.activity.cardMake',
  saveAttachmentAsCodeCard: 'group.activity.cardMake',
  saveArchiveEntryAsCodeCard: 'group.activity.cardMake',
  readCodeCard: 'group.activity.cardRead',
  listCodeCards: 'group.activity.cardRead',
  invokeCodeCardTool: 'group.activity.cardRun',
  invokeMcpTool: 'group.activity.mcp',
  runCode: 'group.activity.code'
} as const;

export type GroupActivityKey =
  | (typeof TOOL_ACTIVITY_KEYS)[keyof typeof TOOL_ACTIVITY_KEYS]
  | 'group.activity.tool';

export function toolActivityKey(kind: string | undefined | null): GroupActivityKey {
  if (!kind) return 'group.activity.tool';
  return (TOOL_ACTIVITY_KEYS as Record<string, GroupActivityKey>)[kind] ?? 'group.activity.tool';
}

// 成员当下正在跑的工具：倒着找这位成员名下还停在 running 的过程消息
export function memberRunningActivityKey(
  conversation: Conversation | null | undefined,
  memberId: string
): GroupActivityKey | null {
  if (!conversation) return null;
  const messages = conversation.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.origin !== 'tool-runtime') continue;
    if (message.speakerCollaboratorId !== memberId) continue;
    if (message.toolInvocation?.status !== 'running') continue;
    return toolActivityKey(message.toolInvocation.kind);
  }
  return null;
}

// 生成成果里的图片：群面上要露出来、图片区要收进去的那部分
export function messageGeneratedImageAttachments(message: Conversation['messages'][number]) {
  if (message.origin !== 'tool-runtime') return [];
  const invocation = message.toolInvocation;
  if (!invocation || invocation.status === 'failed' || invocation.status === 'running') return [];
  return (message.attachments ?? []).filter(
    (attachment) => attachment.kind === 'image' && attachment.assetId && !attachment.clearedAt
  );
}

export function messageGeneratedAudioAttachments(message: Conversation['messages'][number]) {
  if (message.origin !== 'tool-runtime') return [];
  const invocation = message.toolInvocation;
  if (!invocation || invocation.status === 'failed' || invocation.status === 'running') return [];
  return (message.attachments ?? []).filter(
    (attachment) => attachment.assetId && !attachment.clearedAt && isPlayableAudioAttachment(attachment)
  );
}
