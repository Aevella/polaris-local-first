import { useEffect, useRef, useState } from 'react';
import type { CodeCardActionMode } from '../../../../app/chat/chatDerivedState';
import { extractCodeBlocksFromMessage, stripCodeBlocksFromMessage } from '../../../../engines/codeCardEngine';
import type { CodeBlockCandidate } from '../../../../engines/codeCardText';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import { TOOL_DRAFT_BLOCK_PATTERN } from '../../../../app/chat/chatMarkdownPatterns';
import { hasThemeCssProjectionToolCall, isThemeCssCodeBlock } from '../../../../app/chat/chatCodeBlockSemantics';
import { useI18n, type I18nTranslator } from '../../../../i18n';
import type { ChatMessage, ToolInvocation } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { runSuccessAction } from '../../../haptics';
import { MessageCode } from './MessageCode';
import { MessageCodeBlockView } from './MessageCodeBlockView';
import { MessageMarkdown } from './MessageMarkdown';
import { MessageThinkingProjection } from './MessageThinkingProjection';
import { isCodeWriteToolName, isProjectedCodeToolName } from './projectedCodeTools';

type MessageContentProps = {
  message: ChatMessage;
  codeCardActionMode: CodeCardActionMode;
  isCodeExpanded: boolean;
  sandboxToolInvocation?: ToolInvocation | null;
  onToggleCodeExpanded: () => void;
  onApplyCustomCss: (css: string) => void;
  showThinking: boolean;
  preferInlineCode?: boolean;
  hasProjectedCodeToolEvent?: boolean;
  hasResolvedToolEvent?: boolean;
  collapseThinkingProjection?: boolean;
  smoothStreamingText?: boolean;
};

type Translate = I18nTranslator['t'];

type IntlSegmenterLike = {
  segment: (value: string) => Iterable<{ index: number; segment: string }>;
};

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
  ) => IntlSegmenterLike;
};

function buildSafeSliceOffsets(value: string) {
  if (!value) return [0];
  const Segmenter = typeof Intl !== 'undefined' ? (Intl as IntlWithSegmenter).Segmenter : undefined;
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    const offsets = [0];
    for (const segment of segmenter.segment(value)) {
      offsets.push(segment.index + segment.segment.length);
    }
    return offsets;
  }

  const offsets = [0];
  let offset = 0;
  for (const character of Array.from(value)) {
    offset += character.length;
    offsets.push(offset);
  }
  return offsets;
}

export function buildSmoothStreamingSliceOffsets(value: string, enabled: boolean) {
  return enabled ? buildSafeSliceOffsets(value) : null;
}

function sliceBySafeOffset(value: string, offsets: number[], end: number) {
  return value.slice(0, offsets[end] ?? value.length);
}

export function shouldSmoothStreamingMessageContent(content: string, enabled: boolean) {
  return enabled && !content.includes('```');
}

function useSmoothStreamingText(messageId: string, content: string, enabled: boolean) {
  const [displayContent, setDisplayContent] = useState(content);
  const displayedLengthRef = useRef<number | null>(null);
  const activeMessageIdRef = useRef(messageId);

  useEffect(() => {
    const safeOffsets = buildSmoothStreamingSliceOffsets(content, enabled);
    if (!safeOffsets) {
      activeMessageIdRef.current = messageId;
      displayedLengthRef.current = null;
      setDisplayContent(content);
      return;
    }

    const contentLength = safeOffsets.length - 1;
    if (activeMessageIdRef.current !== messageId || displayedLengthRef.current === null) {
      activeMessageIdRef.current = messageId;
      displayedLengthRef.current = contentLength;
      setDisplayContent(content);
      return;
    }

    if (displayedLengthRef.current > contentLength) {
      displayedLengthRef.current = contentLength;
      setDisplayContent(content);
      return;
    }

    let frameId = 0;
    const tick = () => {
      const displayedLength = displayedLengthRef.current ?? contentLength;
      const backlog = contentLength - displayedLength;
      if (backlog <= 0) {
        setDisplayContent(content);
        return;
      }

      const step = backlog > 96 ? 10 : backlog > 48 ? 6 : backlog > 16 ? 3 : 1;
      const nextDisplayedLength = Math.min(contentLength, displayedLength + step);
      displayedLengthRef.current = nextDisplayedLength;
      setDisplayContent(sliceBySafeOffset(content, safeOffsets, nextDisplayedLength));

      if (nextDisplayedLength < contentLength) {
        frameId = window.setTimeout(tick, backlog > 48 ? 18 : 28);
      }
    };

    frameId = window.setTimeout(tick, 24);
    return () => {
      window.clearTimeout(frameId);
    };
  }, [content, enabled, messageId]);

  return enabled ? displayContent : content;
}

function extractToolDraftBlocks(content: string) {
  return Array.from(content.matchAll(TOOL_DRAFT_BLOCK_PATTERN))
    .map((match) => (match[1] ?? '').trim() || null)
    .filter((block): block is string => Boolean(block));
}

function stripToolDraftBlocks(content: string) {
  return content
    .replace(TOOL_DRAFT_BLOCK_PATTERN, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderRichText(content: string) {
  return <MessageMarkdown content={content} />;
}

function renderAssistantProse(content: string) {
  if (!content.trim()) return null;
  return renderRichText(content);
}

function renderToolDrafts(
  t: Translate,
  messageId: string,
  toolDraftBlocks: string[],
  copiedToolDraftKey: string | null,
  onCopyToolDraft: (block: string, index: number) => void
) {
  return toolDraftBlocks.map((block, index) => (
    <details key={`${messageId}-tool-draft-${index}`} className="message-tool-draft">
      <summary className="message-tool-draft-head">
        <div className="message-tool-draft-head-copy">
          <span>tool action</span>
          <strong>{t('chat.code.toolDraftTitle')}</strong>
        </div>
        <span className="message-tool-draft-toggle" aria-hidden="true" />
      </summary>
      <div className="message-tool-draft-body">
        <button
          type="button"
          className={`message-code-card-copy ${copiedToolDraftKey === `${messageId}-${index}` ? 'copied' : ''}`}
          onClick={() => onCopyToolDraft(block, index)}
          aria-label={copiedToolDraftKey === `${messageId}-${index}` ? t('chat.code.toolDraftCopied') : t('chat.code.toolDraftCopy')}
          title={copiedToolDraftKey === `${messageId}-${index}` ? t('chat.code.toolDraftCopied') : t('chat.code.toolDraftCopy')}
        >
          <Icon name="copy" size={13} />
        </button>
        <pre>{block}</pre>
      </div>
    </details>
  ));
}

function projectedCodeTitle(t: Translate, blocks: CodeBlockCandidate[]) {
  if (blocks.length === 1) {
    const block = blocks[0];
    return block ? `${block.language} · ${block.title}` : t('chat.code.projectedLabel');
  }
  return t('chat.code.projectedMultiple', { count: blocks.length });
}

function renderProjectedCodeBlocks(
  t: Translate,
  messageId: string,
  blocks: CodeBlockCandidate[],
  copiedBlockKey: string | null,
  onCopyBlock: (block: CodeBlockCandidate) => void,
  deferCodeBody = false,
  variant: 'plain' | 'sandbox' = 'plain'
) {
  if (blocks.length === 0) return null;
  const sandboxVariant = variant === 'sandbox';

  return (
    <details className={['message-projected-code', sandboxVariant ? 'message-projected-code--sandbox' : null].filter(Boolean).join(' ')}>
      <summary className="message-projected-code-summary">
        <span className="message-projected-code-icon" aria-hidden="true">
          <Icon name="code" size={13} />
        </span>
        <span className="message-projected-code-copy">
          <span>{sandboxVariant ? t('chat.code.writeLabel') : t('chat.code.projectedLabel')}</span>
          <strong>{projectedCodeTitle(t, blocks)}</strong>
        </span>
        <span className="message-projected-code-toggle">{t('chat.code.expand')}</span>
      </summary>
      {deferCodeBody ? null : (
        sandboxVariant ? (
          <div className="message-code-sandbox-band message-projected-code-sandbox-band" aria-label={t('chat.code.writeBandAria')}>
            <div className="message-code-sandbox-scroll">
              {blocks.map((block) => {
                const key = `${messageId}-${block.blockIndex}`;
                return (
                  <section key={key} className="message-code-sandbox-block">
                    <div className="message-code-sandbox-block-head">
                      <div className="message-code-sandbox-block-copy">
                        <span>{block.language}</span>
                        <strong>{block.title}</strong>
                      </div>
                      <div className="message-code-sandbox-block-actions">
                        <button
                          type="button"
                          className={`message-code-card-copy ${copiedBlockKey === key ? 'copied' : ''}`}
                          onClick={() => onCopyBlock(block)}
                          aria-label={copiedBlockKey === key ? t('chat.code.copied') : t('chat.code.copy')}
                          title={copiedBlockKey === key ? t('chat.code.copied') : t('chat.code.copy')}
                        >
                          <Icon name="copy" size={13} />
                        </button>
                      </div>
                    </div>
                    <MessageCodeBlockView
                      code={block.code}
                      language={block.language}
                      className="message-code-sandbox-pre"
                    />
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="message-projected-code-stack">
            {blocks.map((block) => {
              const key = `${messageId}-${block.blockIndex}`;
              return (
                <article key={key} className="message-projected-code-card">
                  <div className="message-projected-code-card-head">
                    <span>{block.language}</span>
                    <button
                      type="button"
                      className={`message-code-card-copy ${copiedBlockKey === key ? 'copied' : ''}`}
                      onClick={() => onCopyBlock(block)}
                      aria-label={copiedBlockKey === key ? t('chat.code.copied') : t('chat.code.copy')}
                      title={copiedBlockKey === key ? t('chat.code.copied') : t('chat.code.copy')}
                    >
                      <Icon name="copy" size={13} />
                    </button>
                  </div>
                  <MessageCodeBlockView code={block.code} language={block.language} />
                </article>
              );
            })}
          </div>
        )
      )}
    </details>
  );
}

export function MessageContent({
  message,
  codeCardActionMode,
  isCodeExpanded,
  sandboxToolInvocation = null,
  onToggleCodeExpanded,
  onApplyCustomCss,
  showThinking,
  preferInlineCode = false,
  hasProjectedCodeToolEvent = false,
  hasResolvedToolEvent = false,
  collapseThinkingProjection = false,
  smoothStreamingText = false
}: MessageContentProps) {
  const { t } = useI18n();
  const [closingThinkingText, setClosingThinkingText] = useState<string | null>(null);
  const [copiedToolDraftKey, setCopiedToolDraftKey] = useState<string | null>(null);
  const [copiedProjectedCodeKey, setCopiedProjectedCodeKey] = useState<string | null>(null);
  const isAssistantMessage = message.role === 'assistant';
  const displayedMessageContent = useSmoothStreamingText(
    message.id,
    message.content,
    shouldSmoothStreamingMessageContent(message.content, smoothStreamingText)
  );
  const toolDraftBlocks = isAssistantMessage && !hasResolvedToolEvent ? extractToolDraftBlocks(displayedMessageContent) : [];
  const contentWithoutToolDrafts = isAssistantMessage ? stripToolDraftBlocks(displayedMessageContent) : displayedMessageContent;
  const thinkingText = isAssistantMessage ? (message.thinkingText?.trim() ?? '') : '';
  const hasRunCodeToolCall = isAssistantMessage
    && (message.nativeToolCalls?.some((toolCall) => toolCall.name.trim() === 'runCode') ?? false);
  const visibleThinkingText = showThinking && !collapseThinkingProjection ? thinkingText : '';
  const hasThinkingProjection = isAssistantMessage && !contentWithoutToolDrafts.trim() && Boolean(visibleThinkingText);
  const codeBlocks = extractCodeBlocksFromMessage(contentWithoutToolDrafts);
  const sandboxDraftActive = preferInlineCode && hasRunCodeToolCall;
  const shouldPreferInlineCode = preferInlineCode && !sandboxDraftActive && codeCardActionMode === 'hidden';
  const hasSandboxCodeOrigin =
    hasRunCodeToolCall
    || sandboxDraftActive
    || sandboxToolInvocation?.kind === 'runCode';
  const hasProjectedNativeCode =
    isAssistantMessage
    && !hasSandboxCodeOrigin
    && (message.nativeToolCalls?.some((toolCall) => isProjectedCodeToolName(toolCall.name)) ?? false);
  const hasCodeWriteProjection =
    isAssistantMessage
    && (message.nativeToolCalls?.some((toolCall) => isCodeWriteToolName(toolCall.name)) ?? false);
  const hasThemeCssProjection = hasThemeCssProjectionToolCall(message.nativeToolCalls);
  const shouldCollapseProjectedCode =
    !hasSandboxCodeOrigin
    && codeBlocks.length > 0
    && (hasProjectedCodeToolEvent || hasProjectedNativeCode);
  const shouldDeferProjectedCodeBody =
    shouldPreferInlineCode
    && shouldCollapseProjectedCode;
  const shouldHideThemeCssCode =
    !hasSandboxCodeOrigin
    && !shouldCollapseProjectedCode
    && (hasThemeCssProjection || (hasProjectedCodeToolEvent && hasResolvedToolEvent))
    && codeCardActionMode === 'hidden'
    && codeBlocks.length > 0
    && codeBlocks.every(isThemeCssCodeBlock);
  const drawerCodeBlocks = shouldCollapseProjectedCode ? [] : codeBlocks;
  const projectedCodeBlocks = shouldCollapseProjectedCode && !hasResolvedToolEvent ? codeBlocks : [];
  const shouldShowCodeDrawer = drawerCodeBlocks.length > 0 && hasSandboxCodeOrigin;
  const shouldStripCodeBlocks = shouldCollapseProjectedCode || shouldShowCodeDrawer || shouldHideThemeCssCode;
  const proseContent = shouldStripCodeBlocks
    ? stripCodeBlocksFromMessage(contentWithoutToolDrafts).trim()
    : contentWithoutToolDrafts.trim();

  const copyToolDraft = async (block: string, index: number) => {
    if (!block.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(block));
    const key = `${message.id}-${index}`;
    setCopiedToolDraftKey(key);
    window.setTimeout(() => {
      setCopiedToolDraftKey((current) => (current === key ? null : current));
    }, 1400);
  };

  const copyProjectedCode = async (block: CodeBlockCandidate) => {
    if (!block.code.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(block.code));
    const key = `${message.id}-${block.blockIndex}`;
    setCopiedProjectedCodeKey(key);
    window.setTimeout(() => {
      setCopiedProjectedCodeKey((current) => (current === key ? null : current));
    }, 1400);
  };

  useEffect(() => {
    if (!isAssistantMessage) {
      setClosingThinkingText(null);
      return;
    }

    if (hasThinkingProjection && visibleThinkingText) {
      setClosingThinkingText(null);
      return;
    }

    if (!visibleThinkingText) {
      setClosingThinkingText(null);
      return;
    }

    setClosingThinkingText(visibleThinkingText);
    const timeoutId = window.setTimeout(() => {
      setClosingThinkingText((current) => (current === visibleThinkingText ? null : current));
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasThinkingProjection, isAssistantMessage, visibleThinkingText, message.id]);

  if (!isAssistantMessage) {
    return renderRichText(displayedMessageContent);
  }

  if (shouldPreferInlineCode) {
    const inlineContent = shouldCollapseProjectedCode
      ? stripCodeBlocksFromMessage(contentWithoutToolDrafts).trim()
      : contentWithoutToolDrafts.trim();

    if (!inlineContent && projectedCodeBlocks.length === 0 && toolDraftBlocks.length === 0 && !hasThinkingProjection) {
      return null;
    }

    return (
      <>
        {renderAssistantProse(inlineContent)}
        {hasThinkingProjection && visibleThinkingText ? (
          <MessageThinkingProjection thinkingText={visibleThinkingText} />
        ) : closingThinkingText ? (
          <MessageThinkingProjection thinkingText={closingThinkingText} phase="closing" />
        ) : null}
        {renderProjectedCodeBlocks(t, message.id, projectedCodeBlocks, copiedProjectedCodeKey, (block) => {
          void copyProjectedCode(block);
        }, shouldDeferProjectedCodeBody, hasCodeWriteProjection ? 'sandbox' : 'plain')}
        {renderToolDrafts(t, message.id, toolDraftBlocks, copiedToolDraftKey, (block, index) => {
          void copyToolDraft(block, index);
        })}
      </>
    );
  }
  const shouldShowThinkingProjection = !proseContent && codeBlocks.length === 0 && toolDraftBlocks.length === 0 && Boolean(visibleThinkingText);

  if (!displayedMessageContent.trim() && codeBlocks.length === 0 && toolDraftBlocks.length === 0 && !shouldShowThinkingProjection) {
    return null;
  }

  return (
    <>
      {renderAssistantProse(proseContent)}
      {shouldShowThinkingProjection && visibleThinkingText ? (
        <MessageThinkingProjection thinkingText={visibleThinkingText} />
      ) : closingThinkingText ? (
        <MessageThinkingProjection thinkingText={closingThinkingText} phase="closing" />
      ) : null}
      {renderToolDrafts(t, message.id, toolDraftBlocks, copiedToolDraftKey, (block, index) => {
        void copyToolDraft(block, index);
      })}
      {renderProjectedCodeBlocks(t, message.id, projectedCodeBlocks, copiedProjectedCodeKey, (block) => {
        void copyProjectedCode(block);
      }, false, hasCodeWriteProjection ? 'sandbox' : 'plain')}
      {shouldShowCodeDrawer && drawerCodeBlocks.length > 0 ? (
        <MessageCode
          blocks={drawerCodeBlocks}
          codeCardActionMode={codeCardActionMode}
          isExpanded={isCodeExpanded}
          message={message}
          sandboxDraftActive={sandboxDraftActive}
          sandboxToolInvocation={sandboxToolInvocation}
          onToggleExpanded={onToggleCodeExpanded}
          onApplyCustomCss={onApplyCustomCss}
        />
      ) : null}
      {codeBlocks.length === 0 && toolDraftBlocks.length === 0 && !proseContent && !shouldShowThinkingProjection ? renderRichText(displayedMessageContent) : null}
    </>
  );
}
