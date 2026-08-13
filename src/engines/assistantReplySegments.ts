import type { ChatMessage } from '../types/domain';

type MarkdownFence = {
  character: '`' | '~';
  length: number;
};

function readMarkdownFence(line: string): MarkdownFence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return {
    character: match[1][0] as MarkdownFence['character'],
    length: match[1].length
  };
}

type StructuredLineKind = 'list' | 'table' | 'quote' | 'indented-code';

function readStructuredLineKind(line: string): StructuredLineKind | null {
  if (/^ {0,3}(?:[-+*]|\d+[.)])\s+/u.test(line)) return 'list';
  if (/^\s*\|.*\|\s*$/u.test(line)) return 'table';
  if (/^ {0,3}>\s?/u.test(line)) return 'quote';
  if (/^(?: {4}|\t)\S/u.test(line)) return 'indented-code';
  return null;
}

export function splitAssistantReplySegments(content: string): string[] {
  const segments: string[] = [];
  const currentLines: string[] = [];
  let activeFence: MarkdownFence | null = null;
  let activeStructuredKind: StructuredLineKind | null = null;

  const flushCurrentSegment = () => {
    const segment = currentLines.join('\n').trim();
    if (segment) segments.push(segment);
    currentLines.length = 0;
    activeStructuredKind = null;
  };

  content.split(/\r?\n/).forEach((line) => {
    const fence = readMarkdownFence(line);
    if (activeFence) {
      currentLines.push(line);
      if (fence?.character === activeFence.character && fence.length >= activeFence.length) {
        activeFence = null;
        flushCurrentSegment();
      }
      return;
    }

    if (fence) {
      flushCurrentSegment();
      activeFence = fence;
      currentLines.push(line);
      return;
    }

    if (!line.trim()) {
      flushCurrentSegment();
      return;
    }

    const structuredKind = readStructuredLineKind(line);
    if (structuredKind) {
      if (activeStructuredKind && activeStructuredKind !== structuredKind) flushCurrentSegment();
      if (!activeStructuredKind && currentLines.length > 0) flushCurrentSegment();
      activeStructuredKind = structuredKind;
      currentLines.push(line);
      return;
    }

    if (activeStructuredKind) flushCurrentSegment();
    if (currentLines.length > 0) flushCurrentSegment();
    currentLines.push(line);
  });

  flushCurrentSegment();
  return segments.length > 0 ? segments : [''];
}

export function resolveAssistantReplySegments(
  messages: ChatMessage[],
  messageId: string
): ChatMessage[] {
  const target = messages.find((message) => message.id === messageId);
  if (!target || target.role !== 'assistant' || target.toolInvocation) return target ? [target] : [];
  const replyId = target.assistantReplyId?.trim();
  if (!replyId) return [target];

  return messages
    .filter((message) => (
      message.role === 'assistant'
      && !message.toolInvocation
      && message.assistantReplyId === replyId
    ))
    .sort((left, right) => (
      (left.assistantReplySegmentIndex ?? 0) - (right.assistantReplySegmentIndex ?? 0)
    ));
}

export function buildAssistantReplySegmentContent(
  messages: ChatMessage[],
  messageId: string
) {
  return resolveAssistantReplySegments(messages, messageId)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function buildAssistantReplyContentIndex(messages: ChatMessage[]) {
  const contentByMessageId = new Map<string, string>();
  const grouped = new Map<string, ChatMessage[]>();

  messages.forEach((message) => {
    if (message.role !== 'assistant' || message.toolInvocation) return;
    const replyId = message.assistantReplyId?.trim();
    if (!replyId) {
      contentByMessageId.set(message.id, message.content);
      return;
    }
    const bucket = grouped.get(replyId) ?? [];
    bucket.push(message);
    grouped.set(replyId, bucket);
  });

  grouped.forEach((segments) => {
    const ordered = [...segments].sort((left, right) => (
      (left.assistantReplySegmentIndex ?? 0) - (right.assistantReplySegmentIndex ?? 0)
    ));
    const content = ordered.map((message) => message.content.trim()).filter(Boolean).join('\n\n');
    ordered.forEach((message) => contentByMessageId.set(message.id, content));
  });

  return contentByMessageId;
}

export function collapseAssistantReplySegmentsForRequest(messages: ChatMessage[]): ChatMessage[] {
  const grouped = new Map<string, ChatMessage[]>();
  messages.forEach((message) => {
    const replyId = message.assistantReplyId?.trim();
    if (!replyId || message.role !== 'assistant' || message.toolInvocation) return;
    const bucket = grouped.get(replyId) ?? [];
    bucket.push(message);
    grouped.set(replyId, bucket);
  });

  if (grouped.size === 0) return messages;

  const canonicalByReplyId = new Map<string, ChatMessage>();
  grouped.forEach((segments, replyId) => {
    const ordered = [...segments].sort((left, right) => (
      (left.assistantReplySegmentIndex ?? 0) - (right.assistantReplySegmentIndex ?? 0)
    ));
    const anchor = ordered.find((message) => message.id === replyId) ?? ordered[ordered.length - 1];
    canonicalByReplyId.set(replyId, {
      ...anchor,
      content: ordered.map((message) => message.content.trim()).filter(Boolean).join('\n\n')
    });
  });

  return messages.flatMap((message) => {
    const replyId = message.assistantReplyId?.trim();
    if (!replyId || message.role !== 'assistant' || message.toolInvocation) return [message];
    const canonical = canonicalByReplyId.get(replyId);
    return canonical?.id === message.id ? [canonical] : [];
  });
}
