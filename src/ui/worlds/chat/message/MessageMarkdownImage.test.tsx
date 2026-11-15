import { describe, expect, it } from 'vitest';
import { resolveMarkdownImageUrl } from './MessageMarkdownImage';

describe('resolveMarkdownImageUrl', () => {
  it('accepts inline raster images returned by image providers', () => {
    for (const format of ['png', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'x-icon']) {
      const source = `data:image/${format};base64,aGVsbG8=`;
      expect(resolveMarkdownImageUrl(source)).toBe(source);
    }
    expect(resolveMarkdownImageUrl('data:image/png;base64,aGVs\nbG8=')).toBe('data:image/png;base64,aGVsbG8=');
    expect(resolveMarkdownImageUrl('data:text/html;base64,aGVsbG8=')).toBeNull();
    expect(resolveMarkdownImageUrl('data:image/png;base64,')).toBeNull();
  });

  it('accepts HTTP and HTTPS image locations', () => {
    expect(resolveMarkdownImageUrl('https://example.com/cat.png')).toBe('https://example.com/cat.png');
    expect(resolveMarkdownImageUrl('http://127.0.0.1:8080/meme.gif')).toBe('http://127.0.0.1:8080/meme.gif');
  });

  it('rejects empty, relative, and active-content locations', () => {
    expect(resolveMarkdownImageUrl('')).toBeNull();
    expect(resolveMarkdownImageUrl('/cat.png')).toBeNull();
    expect(resolveMarkdownImageUrl('javascript:alert(1)')).toBeNull();
    expect(resolveMarkdownImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
  });
});
