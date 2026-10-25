import {
  extractCodeBlocksFromMessage,
  type CodeBlockCandidate
} from '../../engines/codeCardEngine';
import type { ChatMessage, ChatNativeToolCall } from '../../types/domain';

const messageCodeBlocks = new WeakMap<Pick<ChatMessage, 'content'>, { content: string; blocks: CodeBlockCandidate[] }>();

export function readMessageCodeBlocks(message: Pick<ChatMessage, 'content'>) {
  const cached = messageCodeBlocks.get(message);
  if (cached?.content === message.content) return cached.blocks;
  const blocks = extractCodeBlocksFromMessage(message.content);
  messageCodeBlocks.set(message, { content: message.content, blocks });
  return blocks;
}

export function isThemeCssCodeBlock(block: Pick<CodeBlockCandidate, 'language'>) {
  const language = block.language.trim().toLowerCase();
  return language === 'css' || language === 'scss' || language === 'sass' || language === 'less';
}

export function hasOnlyThemeCssCodeBlocks(content: string) {
  const codeBlocks = extractCodeBlocksFromMessage(content);
  return codeBlocks.length > 0 && codeBlocks.every((block) => isThemeCssCodeBlock(block));
}

export function hasThemeCssProjectionToolCall(nativeToolCalls: ChatNativeToolCall[] | undefined) {
  return nativeToolCalls?.some((toolCall) => {
    const name = toolCall.name.trim();
    return name === 'patchRawCss' || name === 'appendThemeCss' || name === 'insertThemeCss' || name === 'deleteThemeCss';
  }) ?? false;
}
