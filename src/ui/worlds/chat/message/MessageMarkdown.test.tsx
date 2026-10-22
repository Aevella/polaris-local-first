import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageMarkdown } from './MessageMarkdown';

describe('MessageMarkdown', () => {
  it('renders markdown tables into semantic table markup', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown
        content={[
          '| Name | Role |',
          '| --- | :---: |',
          '| Pharos | Lead |'
        ].join('\n')}
      />
    );

    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('Pharos');
    expect(html).toContain('text-align:center');
  });

  it('renders markdown strikethrough text', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'这是 ~~删除线~~。'} />
    );

    expect(html).toContain('<del');
    expect(html).toContain('删除线');
  });

  it('renders inline Latex math', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'能量是 $E = mc^2$。'} />
    );

    expect(html).toContain('message-markdown-math-inline');
    expect(html).toContain('katex');
    expect(html).toContain('mc');
  });

  it('renders display Latex math blocks', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown
        content={[
          '前面',
          '',
          '$$',
          '\\int_0^1 x^2 dx',
          '$$',
          '',
          '后面'
        ].join('\n')}
      />
    );

    expect(html).toContain('message-markdown-math-block');
    expect(html).toContain('katex-display');
    expect(html).toContain('int');
  });

  it('does not render Latex inside inline code', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'命令是 `$E = mc^2$`。'} />
    );

    expect(html).toContain('message-markdown-code-inline');
    expect(html).not.toContain('message-markdown-math-inline');
  });

  it('keeps escaped dollars as plain text', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'价格不是公式：\\$5$'} />
    );

    expect(html).toContain('$5$');
    expect(html).not.toContain('message-markdown-math-inline');
  });

  it('renders explicit prose line breaks inside the same paragraph block', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'第一行\n第二行'} />
    );

    expect(html.match(/message-rich-text-paragraph/g)).toHaveLength(1);
    expect(html.match(/message-rich-text-line/g)).toHaveLength(2);
    expect(html).toContain('第一行');
    expect(html).toContain('第二行');
    expect(html).not.toContain('<br');
  });

  it('keeps blank lines as paragraph boundaries', () => {
    const html = renderToStaticMarkup(
      <MessageMarkdown content={'第一段第一行\n第一段第二行\n\n第二段'} />
    );

    expect(html.match(/message-rich-text-paragraph/g)).toHaveLength(2);
    expect(html.match(/message-rich-text-line/g)).toHaveLength(3);
    expect(html).toContain('第一段第一行');
    expect(html).toContain('第一段第二行');
    expect(html).toContain('第二段');
  });
});

describe('MessageMarkdown ordered lists', () => {
  it('preserves numbering across separately rendered reply segments', () => {
    for (const number of [1, 2, 3]) {
      const html = renderToStaticMarkup(<MessageMarkdown content={`${number}. 内容`} />);
      expect(html).toContain(`start="${number}"`);
    }
  });

  it('preserves the start after a paragraph interrupts the list', () => {
    const html = renderToStaticMarkup(<MessageMarkdown content={'1. 第一项\n\n说明文字\n\n2. 第二项\n3. 第三项'} />);
    expect(html).toContain('start="1"');
    expect(html).toContain('start="2"');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });
});
