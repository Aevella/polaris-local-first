import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseRichCardBlock, parseRichDetailsBlock, renderRichInlineContent } from './messageRichMarkup';

describe('messageRichMarkup', () => {
  it('parses details blocks', () => {
    expect(parseRichDetailsBlock('<details open><summary>点开看</summary>里面是正文</details>')).toEqual({
      open: true,
      summary: '点开看',
      body: '里面是正文'
    });
  });

  it('parses polaris cards', () => {
    expect(parseRichCardBlock('<polaris-card title="今晚" kicker="夜色" tone="rose">慢一点说话</polaris-card>')).toEqual({
      title: '今晚',
      kicker: '夜色',
      tone: 'rose',
      body: '慢一点说话'
    });
  });

  it('keeps supported span markup as styled react nodes', () => {
    const nodes = renderRichInlineContent('留一点 <span style="color: #c48; font-weight: 700;">玫瑰色</span> 在这里');
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toMatchObject({
      props: {
        style: {
          color: '#c48',
          fontWeight: '700'
        }
      }
    });
  });

  it('renders markdown strikethrough into del nodes', () => {
    const nodes = renderRichInlineContent('这里有 ~~删掉的话~~ 留着');
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toMatchObject({
      type: 'del',
      props: {
        className: 'message-markdown-strikethrough',
        children: '删掉的话'
      }
    });
  });

  it('renders markdown images as lazy external images', () => {
    const html = renderToStaticMarkup(renderRichInlineContent('看这个 ![猫猫](https://example.com/cat.png)'));

    expect(html).toContain('class="message-markdown-image-link is-loading"');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="猫猫"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it('does not load markdown images from unsupported protocols', () => {
    const html = renderToStaticMarkup(renderRichInlineContent('![坏图](javascript:alert(1))'));

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a');
    expect(html).toContain('message-markdown-image-unsafe');
    expect(html).toContain('坏图');
  });

  it('renders inline PNG data from a generated Markdown reply', () => {
    const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const html = renderToStaticMarkup(renderRichInlineContent(`![生成图片](${source})`));
    expect(html).toContain('<img');
    expect(html).toContain(`src="${source}"`);
    expect(html).not.toContain('message-markdown-image-unsafe');
  });
});
