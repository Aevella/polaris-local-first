import {
  conversationMatchesCollaboratorScope,
  resolveConversationCollaboratorName
} from '../../engines/conversationOwnership';
import { canUseNativeSystemBackupFiles, exportFileViaSystemFiles } from '../../native/systemBackupFiles';
import type { ChatMessage, Conversation, Persona } from '../../types/domain';

export type ConversationArchiveExportTarget = 'browser-download' | 'native-file';

export type ConversationArchiveExportOptions = {
  conversations: Conversation[];
  collaborators: Persona[];
  collaboratorScopeId: string | null;
  knownCollaboratorIds: readonly string[];
  readMessages: (conversationId: string) => Promise<ChatMessage[]>;
  downloadFile: (blob: Blob, fileName: string) => void | Promise<void>;
  exportedAt?: number;
};

export type ConversationArchiveExportPayload = {
  blob: Blob;
  fileName: string;
  conversationCount: number;
  messageCount: number;
  scopeLabel: string;
};

export type ConversationArchiveExportResult = ConversationArchiveExportPayload & {
  target: ConversationArchiveExportTarget;
};

type ConversationArchiveEntry = {
  conversation: Conversation;
  collaboratorName: string | null;
  messages: ChatMessage[];
};

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, '\n').trim();
}

function headingText(value: string, fallback: string) {
  return normalizeText(value).replace(/\n+/g, ' ') || fallback;
}

function fileNameSegment(value: string) {
  return headingText(value, 'chat')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'chat';
}

function formatIsoTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unknown-time';
  return new Date(timestamp).toISOString();
}

function resolveScopeLabel(collaboratorScopeId: string | null, collaborators: Persona[]) {
  if (!collaboratorScopeId) return '全部直聊';
  return collaborators.find((collaborator) => collaborator.id === collaboratorScopeId)?.name.trim() || '当前协作者';
}

function resolveSpeakerLabel(message: ChatMessage, collaboratorName: string | null) {
  if (message.role === 'user') return '我';
  if (message.role === 'system') return '系统';
  return message.assistantName?.trim() || collaboratorName || 'Assistant';
}

function renderMessageAttachments(message: ChatMessage) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return [];

  return [
    '',
    ...attachments.map((attachment) => {
      const details = [
        attachment.kind,
        attachment.mimeType,
        `${attachment.size} bytes`
      ].filter(Boolean).join(' · ');
      return `- 附件：${attachment.name}${details ? `（${details}）` : ''}`;
    })
  ];
}

function renderToolInvocation(message: ChatMessage) {
  if (!message.toolInvocation) return [];
  const tool = message.toolInvocation;
  return [
    '',
    `- 工具记录：${tool.title || tool.toolName || tool.kind} · ${tool.status}`,
    tool.summary ? `- 工具摘要：${tool.summary}` : null
  ].filter((line): line is string => Boolean(line));
}

function renderMessage(message: ChatMessage, collaboratorName: string | null) {
  const content = normalizeText(message.content) || '（无正文）';
  return [
    `#### ${formatIsoTime(message.timestamp)} · ${resolveSpeakerLabel(message, collaboratorName)}`,
    '',
    content,
    ...renderMessageAttachments(message),
    ...renderToolInvocation(message)
  ].join('\n');
}

function sortConversationsForExport(left: ConversationArchiveEntry, right: ConversationArchiveEntry) {
  return right.conversation.updatedAt - left.conversation.updatedAt;
}

async function readExportEntry(
  conversation: Conversation,
  collaborators: Persona[],
  readMessages: ConversationArchiveExportOptions['readMessages']
): Promise<ConversationArchiveEntry | null> {
  const messages = conversation.messages.length > 0
    ? conversation.messages
    : await readMessages(conversation.id);
  if (messages.length === 0) return null;

  return {
    conversation,
    collaboratorName: resolveConversationCollaboratorName(conversation, collaborators),
    messages
  };
}

export async function buildConversationArchiveExportPayload({
  conversations,
  collaborators,
  collaboratorScopeId,
  knownCollaboratorIds,
  readMessages,
  exportedAt = Date.now()
}: Omit<ConversationArchiveExportOptions, 'downloadFile'>): Promise<ConversationArchiveExportPayload> {
  const candidates = conversations.filter((conversation) =>
    conversationMatchesCollaboratorScope(conversation, collaboratorScopeId, knownCollaboratorIds)
  );
  const entries = (await Promise.all(
    candidates.map((conversation) => readExportEntry(conversation, collaborators, readMessages))
  ))
    .filter((entry): entry is ConversationArchiveEntry => Boolean(entry))
    .sort(sortConversationsForExport);

  if (entries.length === 0) {
    throw new Error('当前范围没有可导出的对话。');
  }

  const scopeLabel = resolveScopeLabel(collaboratorScopeId, collaborators);
  const messageCount = entries.reduce((total, entry) => total + entry.messages.length, 0);
  const markdown = [
    '# Polaris 聊天记录',
    '',
    `- 导出范围：${scopeLabel}`,
    `- 导出时间：${formatIsoTime(exportedAt)}`,
    `- 对话数：${entries.length}`,
    `- 消息数：${messageCount}`,
    '',
    ...entries.flatMap((entry, index) => [
      `## ${index + 1}. ${headingText(entry.conversation.title, '未命名对话')}`,
      '',
      `- 协作者：${entry.collaboratorName ?? '未归属历史'}`,
      `- 对话 ID：${entry.conversation.id}`,
      `- 更新时间：${formatIsoTime(entry.conversation.updatedAt)}`,
      '',
      ...entry.messages.map((message) => renderMessage(message, entry.collaboratorName)),
      ''
    ])
  ].join('\n');

  const dateLabel = new Date(exportedAt).toISOString().slice(0, 10);
  const fileName = `polaris-${fileNameSegment(scopeLabel)}-chat-${dateLabel}.md`;
  return {
    blob: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    fileName,
    conversationCount: entries.length,
    messageCount,
    scopeLabel
  };
}

export async function exportConversationArchive(
  options: ConversationArchiveExportOptions
): Promise<ConversationArchiveExportResult> {
  const payload = await buildConversationArchiveExportPayload(options);
  if (canUseNativeSystemBackupFiles()) {
    await exportFileViaSystemFiles(payload.blob, payload.fileName);
    return { ...payload, target: 'native-file' };
  }

  await options.downloadFile(payload.blob, payload.fileName);
  return { ...payload, target: 'browser-download' };
}
