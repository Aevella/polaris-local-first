import type { CSSProperties, ReactNode } from 'react';
import { renderLatexNode } from './messageMath';
import { MessageMarkdownImage, resolveMarkdownImageUrl } from './MessageMarkdownImage';

const INLINE_MARKUP_PATTERN = /<br\s*\/?>|<(span|small|sub|sup|mark|strong|b|em|i|u|del|s)([^>]*)>([\s\S]*?)<\/\1>/gi;
const INLINE_TOKEN_PATTERN = /(`[^`\n]+`|\\\([^\n]+?\\\)|\$(?![\s$])(?:\\.|[^$\\\n])*?[^\s\\]\$|~~[^~\n](?:[\s\S]*?[^~\n])?~~|\*\*[^*\n](?:[\s\S]*?[^*\n])?\*\*|__[^_\n](?:[\s\S]*?[^_\n])?__|\*[^*\n](?:[\s\S]*?[^*\n])?\*|_[^_\n](?:[\s\S]*?[^_\n])?_|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
const SAFE_STYLE_VALUE_PATTERN = /^[#(),.%\w\s'"!+\-/:]*$/i;
const UNSAFE_STYLE_VALUE_PATTERN = /(url\s*\(|expression\s*\(|javascript:|@import)/i;

const SAFE_STYLE_MAP: Record<string, keyof CSSProperties> = {
  color: 'color',
  background: 'background',
  'background-color': 'backgroundColor',
  border: 'border',
  'border-color': 'borderColor',
  'border-radius': 'borderRadius',
  padding: 'padding',
  'padding-inline': 'paddingInline',
  'padding-block': 'paddingBlock',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'font-style': 'fontStyle',
  'letter-spacing': 'letterSpacing',
  'text-transform': 'textTransform',
  'text-decoration': 'textDecoration',
  'box-shadow': 'boxShadow',
  opacity: 'opacity',
  'margin-left': 'marginLeft',
  'margin-right': 'marginRight',
  display: 'display'
};

type InlineTextRenderer = (content: string) => ReactNode[];

type RichDetailsBlock = {
  open: boolean;
  summary: string;
  body: string;
};

type RichCardBlock = {
  title: string | null;
  kicker: string | null;
  tone: 'mist' | 'warm' | 'cool' | 'rose' | 'gold';
  body: string;
};

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function parseSafeInlineStyle(styleText: string | undefined) {
  if (!styleText) return undefined;

  const style: CSSProperties = {};
  styleText.split(';').forEach((declaration) => {
    const [rawProperty, ...rawValueParts] = declaration.split(':');
    const property = rawProperty?.trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    if (!property || !value) return;

    const reactProperty = SAFE_STYLE_MAP[property];
    if (!reactProperty) return;
    if (!SAFE_STYLE_VALUE_PATTERN.test(value) || UNSAFE_STYLE_VALUE_PATTERN.test(value)) return;
    if (reactProperty === 'display' && value !== 'inline' && value !== 'inline-block') return;

    (style as Record<string, string>)[reactProperty] = value;
  });

  return Object.keys(style).length > 0 ? style : undefined;
}

function renderInlineMarkdownOnly(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of content.matchAll(INLINE_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const segment = match[0];
    if (matchIndex > cursor) {
      nodes.push(<span key={`text-${index}`}>{content.slice(cursor, matchIndex)}</span>);
      index += 1;
    }
    if (segment.startsWith('$') && matchIndex > 0 && content[matchIndex - 1] === '\\') {
      cursor = matchIndex;
      continue;
    }

    if (segment.startsWith('`') && segment.endsWith('`')) {
      nodes.push(<code key={`code-${index}`} className="message-markdown-code-inline">{segment.slice(1, -1)}</code>);
    } else if (segment.startsWith('\\(') && segment.endsWith('\\)')) {
      nodes.push(renderLatexNode(segment.slice(2, -2), false, `math-paren-${index}`));
    } else if (segment.startsWith('$') && segment.endsWith('$')) {
      nodes.push(renderLatexNode(segment.slice(1, -1), false, `math-dollar-${index}`));
    } else if (segment.startsWith('~~') && segment.endsWith('~~')) {
      nodes.push(<del key={`del-${index}`} className="message-markdown-strikethrough">{segment.slice(2, -2)}</del>);
    } else if (
      (segment.startsWith('**') && segment.endsWith('**'))
      || (segment.startsWith('__') && segment.endsWith('__'))
    ) {
      nodes.push(<strong key={`strong-${index}`}>{segment.slice(2, -2)}</strong>);
    } else if (
      (segment.startsWith('*') && segment.endsWith('*'))
      || (segment.startsWith('_') && segment.endsWith('_'))
    ) {
      nodes.push(<em key={`em-${index}`}>{segment.slice(1, -1)}</em>);
    } else {
      const imageMatch = segment.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (imageMatch) {
        const imageUrl = imageMatch[2];
        nodes.push(
          <MessageMarkdownImage
            key={`image-${index}-${resolveMarkdownImageUrl(imageUrl) ?? imageUrl}`}
            alt={imageMatch[1]}
            src={imageUrl}
          />
        );
      } else if (linkMatch) {
        nodes.push(<a key={`link-${index}`} href={linkMatch[2]} target="_blank" rel="noreferrer">{linkMatch[1]}</a>);
      } else {
        nodes.push(<span key={`text-${index}`}>{segment}</span>);
      }
    }
    cursor = matchIndex + segment.length;
    index += 1;
  }

  if (cursor < content.length) {
    nodes.push(<span key={`text-${index}`}>{content.slice(cursor)}</span>);
  }

  return nodes;
}

function renderSupportedInlineTag(match: string, index: number, renderChildren: InlineTextRenderer) {
  if (/^<br\s*\/?>$/i.test(match)) {
    return <br key={`br-${index}`} />;
  }

  const tagMatch = match.match(/^<(span|small|sub|sup|mark|strong|b|em|i|u|del|s)([^>]*)>([\s\S]*?)<\/\1>$/i);
  if (!tagMatch) {
    return <span key={`raw-${index}`}>{match}</span>;
  }

  const tagName = tagMatch[1].toLowerCase();
  const attributes = parseAttributes(tagMatch[2] ?? '');
  const style = parseSafeInlineStyle(attributes.style);
  const content = tagMatch[3] ?? '';
  const children = renderChildren(content);

  if (tagName === 'span') {
    return <span key={`span-${index}`} style={style}>{children}</span>;
  }
  if (tagName === 'small') {
    return <small key={`small-${index}`} style={style}>{children}</small>;
  }
  if (tagName === 'sub') {
    return <sub key={`sub-${index}`} style={style}>{children}</sub>;
  }
  if (tagName === 'sup') {
    return <sup key={`sup-${index}`} style={style}>{children}</sup>;
  }
  if (tagName === 'mark') {
    return <mark key={`mark-${index}`} className="message-markup-mark" style={style}>{children}</mark>;
  }
  if (tagName === 'del' || tagName === 's') {
    return <del key={`del-html-${index}`} className="message-markdown-strikethrough" style={style}>{children}</del>;
  }
  if (tagName === 'u') {
    return <u key={`u-${index}`} style={style}>{children}</u>;
  }
  if (tagName === 'strong' || tagName === 'b') {
    return <strong key={`strong-html-${index}`} style={style}>{children}</strong>;
  }
  return <em key={`em-html-${index}`} style={style}>{children}</em>;
}

export function renderRichInlineContent(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of content.matchAll(INLINE_MARKUP_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      nodes.push(...renderInlineMarkdownOnly(content.slice(cursor, matchIndex)));
    }
    nodes.push(renderSupportedInlineTag(match[0], index, renderRichInlineContent));
    cursor = matchIndex + match[0].length;
    index += 1;
  }

  if (cursor < content.length) {
    nodes.push(...renderInlineMarkdownOnly(content.slice(cursor)));
  }

  return nodes;
}

export function parseRichDetailsBlock(markup: string): RichDetailsBlock | null {
  const match = markup.trim().match(/^<details(\s+open)?>([\s\S]*?)<\/details>$/i);
  if (!match) return null;

  const inner = match[2]?.trim() ?? '';
  const summaryMatch = inner.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (!summaryMatch) return null;

  const summary = (summaryMatch[1] ?? '').trim();
  const body = inner.replace(summaryMatch[0], '').trim();

  return {
    open: Boolean(match[1]),
    summary,
    body
  };
}

export function parseRichCardBlock(markup: string): RichCardBlock | null {
  const match = markup.trim().match(/^<polaris-card([^>]*)>([\s\S]*?)<\/polaris-card>$/i);
  if (!match) return null;

  const attributes = parseAttributes(match[1] ?? '');
  const tone = (attributes.tone ?? 'mist').trim().toLowerCase();
  const normalizedTone = (
    tone === 'warm' || tone === 'cool' || tone === 'rose' || tone === 'gold' || tone === 'mist'
  ) ? tone : 'mist';

  return {
    title: attributes.title?.trim() || null,
    kicker: attributes.kicker?.trim() || null,
    tone: normalizedTone,
    body: (match[2] ?? '').trim()
  };
}
