import type { ChatAttachment, ChatCardReference, PersonaMemoryReferenceDoc, WorkspaceReferenceDoc } from '../../types/domain';
import { buildMemorySegmentLines } from '../memoryEngine';
import type {
  AssistantContextSegment,
  AssistantMessageContent,
  AssistantMessageContentPart
} from './requestContext';
import type { AssistantConversationSummaryDecision } from './requestConversationSummaryPlan';
import type { AssistantSemanticRecallContextCandidate } from './requestSemanticRecallPlan';
import type { RequestAttachment, RequestMessage } from './requestMessage';

export const AUTO_INLINE_FILE_MAX_CHARS = 6_000;
export const AUTO_INLINE_TOTAL_FILE_CHARS = 12_000;

function toRuntimeAttachments(message: RequestMessage): RequestAttachment[] {
  return message.attachments ?? [];
}

function shouldAutoInlineAttachmentText(attachment: ChatAttachment) {
  return !attachment.clearedAt && attachment.kind === 'file' && Boolean(attachment.textContent?.trim());
}

function buildAttachmentBlock(
  attachment: ChatAttachment,
  remainingInlineChars: number
): { block: string; inlineCharsUsed: number } {
  if (attachment.kind === 'image') {
    const textContent = attachment.textContent?.trim();
    return {
      block: attachment.clearedAt
        ? `[图片附件：${attachment.name}]\n[图片内容已从本机清理。]`
        : [
            `[图片附件：${attachment.name}]`,
            textContent ? '[图片理解结果]' : '',
            textContent ?? ''
          ].filter(Boolean).join('\n'),
      inlineCharsUsed: 0
    };
  }

  if (attachment.clearedAt) {
    return {
      block: `[文件附件：${attachment.name}]\n[附件内容已从本机清理。]`,
      inlineCharsUsed: 0
    };
  }

  const textContent = attachment.textContent?.trim();
  if (!textContent) {
    return {
      block: `[文件附件：${attachment.name}]`,
      inlineCharsUsed: 0
    };
  }

  if (!shouldAutoInlineAttachmentText(attachment) || remainingInlineChars <= 0) {
    return {
      block: [
        `[文件附件：${attachment.name}]`,
        '[正文未自动展开；需要时再读取附件正文。]'
      ].join('\n'),
      inlineCharsUsed: 0
    };
  }

  const inlineCharLimit = Math.min(AUTO_INLINE_FILE_MAX_CHARS, remainingInlineChars);
  const inlineText = textContent.slice(0, inlineCharLimit).trim();
  const wasTruncated = inlineText.length < textContent.length;

  return {
    block: [
      `[文件附件：${attachment.name}]`,
      inlineText,
      wasTruncated ? '[正文已截断；需要时再读取附件正文。]' : ''
    ]
      .filter(Boolean)
      .join('\n'),
    inlineCharsUsed: inlineText.length
  };
}

export function buildMessageContent(args: {
  message: RequestMessage;
  allowImages: boolean;
  supplementalContent?: AssistantMessageContentPart[];
}): AssistantMessageContent {
  const { message, allowImages, supplementalContent } = args;
  const attachments = toRuntimeAttachments(message);
  let remainingInlineChars = AUTO_INLINE_TOTAL_FILE_CHARS;
  const attachmentTextBlocks = attachments
    .filter((attachment) => attachment.kind === 'file')
    .map((attachment) => {
      const result = buildAttachmentBlock(attachment, remainingInlineChars);
      remainingInlineChars = Math.max(0, remainingInlineChars - result.inlineCharsUsed);
      return result.block;
    });
  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image');
  const inlineImageAttachments = imageAttachments.filter((attachment) => typeof attachment.dataUrl === 'string');

  const fallbackImageLines = !allowImages
    ? imageAttachments.map((attachment) => buildAttachmentBlock(attachment, 0).block)
    : [];
  const unavailableInlineImageLines = allowImages
    ? imageAttachments
      .filter((attachment) => typeof attachment.dataUrl !== 'string')
      .map((attachment) => buildAttachmentBlock(attachment, 0).block)
    : [];
  const supplementalTextBlocks = (supplementalContent ?? [])
    .filter((part): part is Extract<AssistantMessageContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean);
  const supplementalImageParts = (supplementalContent ?? [])
    .filter((part): part is Extract<AssistantMessageContentPart, { type: 'image_url' }> => part.type === 'image_url');
  const fallbackSupplementalImageLines = !allowImages
    ? supplementalImageParts.map(() => '[系统附加结构图：当前通道不支持直接看图，请结合上面的编号规则选择 targets。]')
    : [];
  const textSections = [
    message.content.trim(),
    ...attachmentTextBlocks,
    ...fallbackImageLines,
    ...unavailableInlineImageLines,
    ...supplementalTextBlocks,
    ...fallbackSupplementalImageLines
  ].filter(Boolean);
  const combinedText = textSections.join('\n\n').trim()
    || (message.role === 'user' && message.cardReference ? '请结合上面附带的卡片继续。' : '');

  const inlineImageParts = [
    ...inlineImageAttachments.map((attachment) => ({
      type: 'image_url' as const,
      image_url: {
        url: attachment.dataUrl as string
      }
    })),
    ...supplementalImageParts
  ];

  if (!allowImages || message.role !== 'user' || inlineImageParts.length === 0) {
    return combinedText;
  }

  const contentParts: AssistantMessageContentPart[] = [
    {
      type: 'text',
      text: combinedText || '请结合这些图片回答。'
    },
    ...inlineImageParts
  ];

  return contentParts;
}

export function buildCardReferenceSystemContent(reference: ChatCardReference): string {
  const cardFaceCss = reference.cardFaceCss?.trim();
  const cardNote = reference.cardNote?.trim();
  return [
    '[用户本轮附带卡片]',
    `\`\`\`polaris-card-reference\n${JSON.stringify({
      id: reference.id,
      title: reference.title,
      language: reference.language,
      mode: reference.mode
    }, null, 2)}\n\`\`\``,
    reference.mode === 'continue'
      ? '这张卡是本轮明确要继续修改的目标。优先直接修改它，不要按标题猜，也不要新建卡片。'
      : '这张卡是用户这轮明确附带给你的参考材料，不是默认修改目标；只有用户明确要求修改这张卡时，才优先使用这张。',
    '卡片正文：',
    `\`\`\`${reference.language}\n${reference.code}\n\`\`\``,
    '卡面小字：',
    cardNote || '[当前沿用默认来源小字。]',
    '卡面 CSS：',
    cardFaceCss
      ? `\`\`\`css\n${cardFaceCss}\n\`\`\``
      : '[当前没有单独设置卡面 CSS。]'
  ].join('\n');
}

export function normalizeMemoryLines(lines?: string[]): string[] {
  if (!lines?.length) return [];
  return lines.map((line) => line.trim()).filter(Boolean);
}

export type MemoryReferenceDocDirectoryItem = {
  id: string;
  title: string;
  summary: string;
  updatedAt: number;
  charCount: number;
};

export type WorkspaceReferenceDocDirectoryItem = {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  updatedAt: number;
  charCount: number;
};

export function normalizeMemoryReferenceDocs(docs?: PersonaMemoryReferenceDoc[]): MemoryReferenceDocDirectoryItem[] {
  if (!docs?.length) return [];
  return docs
    .map((doc) => ({
      id: doc.id.trim(),
      title: doc.title.trim(),
      summary: doc.summary.trim(),
      updatedAt: doc.updatedAt,
      charCount: doc.charCount ?? doc.content.length
    }))
    .filter((doc) => doc.id && doc.title);
}

export function normalizeWorkspaceReferenceDocs(docs?: WorkspaceReferenceDoc[]): WorkspaceReferenceDocDirectoryItem[] {
  if (!docs?.length) return [];
  return docs
    .map((doc) => ({
      id: doc.id.trim(),
      projectId: doc.projectId.trim(),
      title: doc.title.trim(),
      summary: doc.summary.trim(),
      updatedAt: doc.updatedAt,
      charCount: doc.charCount ?? doc.content.length
    }))
    .filter((doc) => doc.id && doc.projectId && doc.title);
}

function buildMemoryReferenceDocLines(docs: MemoryReferenceDocDirectoryItem[]) {
  if (!docs.length) return [];
  return [
    '',
    '[长期资料目录]',
    '这些是当前协作者可按需读取的长期资料。你现在只看到了目录；需要具体背景时，先调用 readMemoryDoc 读取全文，不要凭目录假装读过正文。',
    ...docs.map((doc, index) => {
      const summary = doc.summary || '无摘要';
      return `${index + 1}. ${doc.title}（docId: ${doc.id}，${doc.charCount} 字）— ${summary}`;
    })
  ];
}

function buildWorkspaceReferenceDocLines(docs: WorkspaceReferenceDocDirectoryItem[]) {
  if (!docs.length) return [];
  return [
    '[工作区参考资料目录]',
    '这些资料属于当前工作区，只用于理解背景、设定、小说原文或风格，不是运行产物文件。你现在只看到了目录；需要正文时，先调用 readWorkspaceReference 读取全文，或用 searchWorkspaceReferences / searchReadableContext 找入口。',
    ...docs.map((doc, index) => {
      const summary = doc.summary || '无摘要';
      return `${index + 1}. ${doc.title}（docId: ${doc.id}，workspace: ${doc.projectId}，${doc.charCount} 字）— ${summary}`;
    })
  ];
}

export function buildWorkspaceReferenceSegment(docs: WorkspaceReferenceDocDirectoryItem[]): AssistantContextSegment | null {
  if (!docs.length) return null;
  return {
    kind: 'system',
    messages: [
      {
        role: 'system',
        content: buildWorkspaceReferenceDocLines(docs).join('\n'),
        cachePrefixEligible: true
      }
    ]
  };
}

function formatSemanticRecallKind(kind: AssistantSemanticRecallContextCandidate['kind']) {
  if (kind === 'recent_tail') return '接着聊';
  if (kind === 'vector_match') return '语义候选';
  if (kind === 'voice_anchor') return '语感锚点';
  return '锚点命中';
}

export function buildSemanticRecallSegment(candidates?: AssistantSemanticRecallContextCandidate[]): AssistantContextSegment | null {
  const normalized = (candidates ?? [])
    .map((candidate) => ({
      ...candidate,
      text: candidate.text.trim()
    }))
    .filter((candidate) => candidate.id && candidate.text);
  if (!normalized.length) return null;

  return {
    kind: 'semantic_recall',
    messages: [
      {
        role: 'system',
        promptPartLayer: 'context',
        content: [
          '[跨对话前文片段]',
          '这些是本机旧对话里的片段，作为你们连续性的背景材料，相关时自然吸收，不要机械复述。',
          '它们不是用户本轮说的话，也不是已确认的长期记忆；与当前消息或确认记忆冲突时，以后者为准。',
          ...normalized.map((candidate, index) => [
            `${index + 1}. ${candidate.label}（${formatSemanticRecallKind(candidate.kind)}）`,
            candidate.text
          ].join('\n'))
        ].join('\n\n')
      }
    ]
  };
}

function formatConversationSummaryKind(kind: AssistantConversationSummaryDecision['kind']) {
  if (kind === 'relational_profile') return '双方思维画像';
  return '最近事项';
}

function formatConversationSummarySubject(summary: AssistantConversationSummaryDecision) {
  const userLabel = summary.userLabel?.trim() || '用户';
  const collaboratorName = summary.subjectCollaboratorName?.trim() || '协作者';
  return `${userLabel} ↔ ${collaboratorName}`;
}

export function buildConversationSummarySegment(
  summaries?: AssistantConversationSummaryDecision[]
): AssistantContextSegment | null {
  const normalized = (summaries ?? [])
    .map((summary) => ({
      ...summary,
      content: summary.content.trim()
    }))
    .filter((summary) => summary.id && summary.content);
  if (!normalized.length) return null;

  return {
    kind: 'conversation_summary',
    messages: [
      {
        role: 'system',
        content: [
          '[跨对话总结]',
          '这些是跨对话维护的总结，不是逐字原文也不是硬规则；过时或与当前消息冲突时让位，不要替任何一方宣告当前消息里没说出的事实。',
          '每条带对象标签；摘要文本里如残留“我/你”等人称，按对象标签还原成明确对象再使用。',
          ...normalized.map((summary, index) => [
            `${index + 1}. ${summary.title}（type: ${formatConversationSummaryKind(summary.kind)}，对象: ${formatConversationSummarySubject(summary)}）`,
            summary.content
          ].join('\n'))
        ].join('\n\n'),
        cachePrefixEligible: true
      }
    ]
  };
}

export function buildMemorySegment(args: {
  lines: string[];
  referenceDocs?: MemoryReferenceDocDirectoryItem[];
}): AssistantContextSegment | null {
  const referenceDocs = args.referenceDocs ?? [];
  if (!args.lines.length && !referenceDocs.length) return null;

  return {
    kind: 'memory',
    messages: [
      {
        role: 'system',
        content: [
          '以下是当前协作者可调用的长期记忆线索。',
          '只在相关时自然使用，不要逐条复述，也不要把它们说成系统说明。',
          ...buildMemorySegmentLines(args.lines),
          ...buildMemoryReferenceDocLines(referenceDocs)
        ].join('\n'),
        cachePrefixEligible: true
      }
    ]
  };
}
