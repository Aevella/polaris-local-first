import { useMemo, type ReactNode } from 'react';
import { MessageCodeBlockView } from './MessageCodeBlockView';
import {
  parseRichCardBlock,
  parseRichDetailsBlock,
  renderRichInlineContent
} from './messageRichMarkup';
import { renderLatexNode } from './messageMath';
import { cleanDisplayText } from '../../../text/displayText';

type MessageMarkdownProps = {
  content: string;
};

type MarkdownBlock =
  | { type: 'heading'; depth: number; content: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[]; start: number }
  | { type: 'table'; headers: string[]; alignments: Array<'left' | 'center' | 'right' | null>; rows: string[][] }
  | { type: 'code'; language: string; code: string }
  | { type: 'math'; content: string }
  | { type: 'details'; markup: string }
  | { type: 'card'; markup: string };

function parseTableCells(line: string) {
  const trimmed = line.trim();
  const normalized = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return normalized.split('|').map((cell) => cell.trim());
}

function parseTableAlignments(line: string) {
  const cells = parseTableCells(line);
  if (!cells.length) return null;
  const alignments = cells.map((cell) => {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    const startsWithColon = cell.startsWith(':');
    const endsWithColon = cell.endsWith(':');
    if (startsWithColon && endsWithColon) return 'center';
    if (endsWithColon) return 'right';
    if (startsWithColon) return 'left';
    return null;
  });
  return alignments.every((alignment, index) => alignment !== null || /^-{3,}$/.test(cells[index] ?? ''))
    ? alignments
    : null;
}

function tryParseTable(lines: string[], index: number) {
  const headerLine = (lines[index] ?? '').trimEnd();
  const dividerLine = (lines[index + 1] ?? '').trimEnd();
  if (!headerLine.includes('|') || !dividerLine.includes('|')) return null;

  const headers = parseTableCells(headerLine);
  const alignments = parseTableAlignments(dividerLine);
  if (!headers.length || !alignments || headers.length !== alignments.length) return null;

  const rows: string[][] = [];
  let nextIndex = index + 2;
  while (nextIndex < lines.length) {
    const candidate = (lines[nextIndex] ?? '').trimEnd();
    if (!candidate.trim() || !candidate.includes('|')) break;
    const cells = parseTableCells(candidate);
    if (!cells.length) break;
    while (cells.length < headers.length) {
      cells.push('');
    }
    rows.push(cells.slice(0, headers.length));
    nextIndex += 1;
  }

  return {
    block: { type: 'table', headers, alignments, rows } satisfies MarkdownBlock,
    nextIndex
  };
}

function tryParseDisplayMath(lines: string[], index: number) {
  const rawLine = lines[index] ?? '';
  const trimmed = rawLine.trim();
  const dollarStart = trimmed.startsWith('$$');
  const bracketStart = trimmed.startsWith('\\[');
  if (!dollarStart && !bracketStart) return null;

  const startDelimiter = dollarStart ? '$$' : '\\[';
  const endDelimiter = dollarStart ? '$$' : '\\]';
  const firstLineRest = trimmed.slice(startDelimiter.length);
  if (firstLineRest.endsWith(endDelimiter) && firstLineRest.length > endDelimiter.length) {
    return {
      block: { type: 'math', content: firstLineRest.slice(0, -endDelimiter.length).trim() } satisfies MarkdownBlock,
      nextIndex: index + 1
    };
  }

  const mathLines: string[] = [];
  const firstContent = rawLine.slice(rawLine.indexOf(startDelimiter) + startDelimiter.length);
  if (firstContent.trim()) {
    mathLines.push(firstContent);
  }

  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const currentLine = lines[nextIndex] ?? '';
    const endIndex = currentLine.indexOf(endDelimiter);
    if (endIndex >= 0) {
      const beforeEnd = currentLine.slice(0, endIndex);
      if (beforeEnd.trim()) {
        mathLines.push(beforeEnd);
      }
      nextIndex += 1;
      break;
    }
    mathLines.push(currentLine);
    nextIndex += 1;
  }

  if (mathLines.length === 0) return null;

  return {
    block: { type: 'math', content: mathLines.join('\n').trim() } satisfies MarkdownBlock,
    nextIndex
  };
}

function parseMarkdownBlocks(content: string) {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  const pushParagraphBlocks = (paragraphLines: string[]) => {
    const normalizedLines = paragraphLines
      .map((line) => line.trimEnd())
      .filter((line) => line.trim());
    if (normalizedLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: normalizedLines });
    }
  };

  while (index < lines.length) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```(\S*)\s*$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fenceMatch[1] ?? '', code: codeLines.join('\n') });
      continue;
    }

    const displayMath = tryParseDisplayMath(lines, index);
    if (displayMath) {
      blocks.push(displayMath.block);
      index = displayMath.nextIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', depth: headingMatch[1].length, content: headingMatch[2].trim() });
      index += 1;
      continue;
    }

    if (/^<details(?:\s|>)/i.test(line)) {
      const markupLines: string[] = [rawLine];
      index += 1;
      while (index < lines.length) {
        markupLines.push(lines[index] ?? '');
        if (/<\/details>\s*$/i.test((lines[index] ?? '').trim())) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push({ type: 'details', markup: markupLines.join('\n') });
      continue;
    }

    if (/^<polaris-card(?:\s|>)/i.test(line)) {
      const markupLines: string[] = [rawLine];
      index += 1;
      while (index < lines.length) {
        markupLines.push(lines[index] ?? '');
        if (/<\/polaris-card>\s*$/i.test((lines[index] ?? '').trim())) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push({ type: 'card', markup: markupLines.join('\n') });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trimEnd())) {
        quoteLines.push((lines[index] ?? '').trimEnd().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test((lines[index] ?? '').trimEnd())) {
        items.push((lines[index] ?? '').trimEnd().replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const start = Number.parseInt(line, 10);
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? '').trimEnd())) {
        items.push((lines[index] ?? '').trimEnd().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items, start });
      continue;
    }

    const table = tryParseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const currentLine = (lines[index] ?? '').trimEnd();
      if (!currentLine.trim()) break;
      if (
        /^```/.test(currentLine)
        || /^(#{1,6})\s+/.test(currentLine)
        || Boolean(tryParseDisplayMath(lines, index))
        || /^>\s?/.test(currentLine)
        || /^[-*+]\s+/.test(currentLine)
        || /^\d+\.\s+/.test(currentLine)
        || Boolean(tryParseTable(lines, index))
      ) {
        break;
      }
      paragraphLines.push(currentLine);
      index += 1;
    }
    pushParagraphBlocks(paragraphLines);
  }

  return blocks;
}

function renderLines(lines: string[]) {
  return lines.map((line, lineIndex) => (
    <span key={`line-${lineIndex}`} className="message-rich-text-line">
      {renderRichInlineContent(line)}
    </span>
  ));
}

function renderMarkdownBlocks(content: string, keyPrefix: string) {
  return parseMarkdownBlocks(content.trim()).map((block, index) => renderBlock(block, index, keyPrefix));
}

function renderBlock(block: MarkdownBlock, index: number, keyPrefix = 'block'): ReactNode {
  if (block.type === 'heading') {
    const depth = Math.min(block.depth, 4);
    const className = `message-markdown-heading depth-${block.depth}`;
    if (depth === 1) {
      return <h1 key={`${keyPrefix}-heading-${index}`} className={className}>{renderRichInlineContent(block.content)}</h1>;
    }
    if (depth === 2) {
      return <h2 key={`${keyPrefix}-heading-${index}`} className={className}>{renderRichInlineContent(block.content)}</h2>;
    }
    if (depth === 3) {
      return <h3 key={`${keyPrefix}-heading-${index}`} className={className}>{renderRichInlineContent(block.content)}</h3>;
    }
    return <h4 key={`${keyPrefix}-heading-${index}`} className={className}>{renderRichInlineContent(block.content)}</h4>;
  }
  if (block.type === 'blockquote') {
    return <blockquote key={`${keyPrefix}-blockquote-${index}`} className="message-markdown-blockquote">{renderLines(block.lines)}</blockquote>;
  }
  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const ListTag = block.type === 'unordered-list' ? 'ul' : 'ol';
    return (
      <ListTag start={block.type === 'ordered-list' ? block.start : undefined} key={`${keyPrefix}-list-${index}`} className={`message-markdown-list ${block.type}`}>
        {block.items.map((item, itemIndex) => <li key={`item-${itemIndex}`}>{renderRichInlineContent(item)}</li>)}
      </ListTag>
    );
  }
  if (block.type === 'table') {
    return (
      <div key={`${keyPrefix}-table-${index}`} className="message-markdown-table-wrap">
        <table className="message-markdown-table">
          <thead>
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th
                  key={`head-${headerIndex}`}
                  style={block.alignments[headerIndex] ? { textAlign: block.alignments[headerIndex] ?? undefined } : undefined}
                >
                  {renderRichInlineContent(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`cell-${rowIndex}-${cellIndex}`}
                    style={block.alignments[cellIndex] ? { textAlign: block.alignments[cellIndex] ?? undefined } : undefined}
                  >
                    {renderRichInlineContent(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === 'code') {
    return (
      <MessageCodeBlockView
        key={`${keyPrefix}-code-${index}`}
        code={block.code}
        language={block.language}
        className="message-markdown-code-block"
        copyable
      />
    );
  }
  if (block.type === 'math') {
    return renderLatexNode(block.content, true, `${keyPrefix}-math-${index}`);
  }
  if (block.type === 'details') {
    const details = parseRichDetailsBlock(block.markup);
    if (!details) {
      return <p key={`${keyPrefix}-details-fallback-${index}`} className="message-rich-text-paragraph">{block.markup}</p>;
    }
    return (
      <details
        key={`${keyPrefix}-details-${index}`}
        className="message-markdown-details"
        open={details.open || undefined}
      >
        <summary className="message-markdown-details-summary">
          {renderRichInlineContent(details.summary)}
        </summary>
        <div className="message-markdown-details-body">
          {renderMarkdownBlocks(details.body, `${keyPrefix}-details-${index}`)}
        </div>
      </details>
    );
  }
  if (block.type === 'card') {
    const card = parseRichCardBlock(block.markup);
    if (!card) {
      return <p key={`${keyPrefix}-card-fallback-${index}`} className="message-rich-text-paragraph">{block.markup}</p>;
    }
    return (
      <section
        key={`${keyPrefix}-card-${index}`}
        className={`message-markdown-card tone-${card.tone}`}
      >
        {card.kicker ? <span className="message-markdown-card-kicker">{renderRichInlineContent(card.kicker)}</span> : null}
        {card.title ? <strong className="message-markdown-card-title">{renderRichInlineContent(card.title)}</strong> : null}
        <div className="message-markdown-card-body">
          {renderMarkdownBlocks(card.body, `${keyPrefix}-card-${index}`)}
        </div>
      </section>
    );
  }
  return <p key={`${keyPrefix}-paragraph-${index}`} className="message-rich-text-paragraph">{renderLines(block.lines)}</p>;
}

export function MessageMarkdown({ content }: MessageMarkdownProps) {
  const displayContent = useMemo(() => cleanDisplayText(content), [content]);
  const blocks = useMemo(() => parseMarkdownBlocks(displayContent.trim()), [displayContent]);
  if (!blocks.length) return null;

  return (
    <div className="message-rich-text message-markdown">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
