import { describe, expect, it, vi } from 'vitest';
import { webToolExecutorPlugin } from './toolExecutorWebPlugin';
import type { ToolContext } from './toolExecutorTypes';

function createContext(overrides: Partial<ToolContext> = {}) {
  return {
    webSearch: vi.fn(async () => ({
      ok: true as const,
      query: 'polaris',
      results: [
        { title: 'Polaris', url: 'https://example.com', snippet: 'Demo' }
	      ],
	      provider: 'mock',
	      webSearch: {
	        query: 'polaris',
	        provider: 'mock',
	        results: [
	          { title: 'Polaris', url: 'https://example.com', snippet: 'Demo' }
	        ]
	      },
	      detailText: 'result detail'
	    })),
    readWebPage: vi.fn(async () => ({
      ok: true as const,
      url: 'https://example.com',
      title: 'Example',
	      text: 'page text',
	      provider: 'mock',
	      truncated: false,
	      originalLength: 9,
	      webPageRead: {
	        url: 'https://example.com',
	        title: 'Example',
	        provider: 'mock',
	        excerpt: 'page text'
	      },
	      detailText: 'page detail'
	    })),
    ...overrides
  } as ToolContext;
}

describe('webToolExecutorPlugin', () => {
  it('handles web search actions', async () => {
    const ctx = createContext();

    const result = await webToolExecutorPlugin.execute({
      kind: 'webSearch',
      query: 'polaris',
      maxResults: 3
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已找到 1 条网页结果 · mock',
      detailText: 'result detail',
      webSearch: {
        query: 'polaris',
        provider: 'mock',
        results: [
          { title: 'Polaris', url: 'https://example.com', snippet: 'Demo' }
        ]
      }
    });
    expect(ctx.webSearch).toHaveBeenCalledWith('polaris', 3);
  });

  it('handles read web page actions', async () => {
    const ctx = createContext();

    const result = await webToolExecutorPlugin.execute({
      kind: 'readWebPage',
      url: 'https://example.com',
      maxChars: 1200
    }, ctx);

    expect(result).toEqual({
      ok: true,
      summary: '已读取网页 · Example',
      detailText: 'page detail',
      webPageRead: {
        url: 'https://example.com',
        title: 'Example',
        provider: 'mock',
        excerpt: 'page text'
      }
    });
    expect(ctx.readWebPage).toHaveBeenCalledWith('https://example.com', 1200);
  });

  it('keeps the first degraded-search warning clause in the summary', async () => {
    const ctx = createContext({
      webSearch: vi.fn(async () => ({
        ok: true as const,
        query: 'polaris',
        results: [{ title: 'Polaris', url: 'https://example.com', snippet: 'Demo' }],
        provider: 'Bing',
        degraded: true,
        warning: 'Primary provider unavailable；using fallback',
        webSearch: {
          query: 'polaris',
          provider: 'Bing',
          degraded: true,
          results: [{ title: 'Polaris', url: 'https://example.com', snippet: 'Demo' }]
        },
        detailText: 'result detail'
      }))
    });

    const result = await webToolExecutorPlugin.execute({ kind: 'webSearch', query: 'polaris' }, ctx);

    expect(result).toMatchObject({
      ok: true,
      summary: '已降级到 Bing 搜索 · 1 条 · Primary provider unavailable'
    });
  });

  it('passes through web helper failures', async () => {
    const ctx = createContext({
      webSearch: vi.fn(async () => ({ ok: false as const, error: '搜索失败' }))
    });

    const result = await webToolExecutorPlugin.execute({
      kind: 'webSearch',
      query: 'polaris'
    }, ctx);

    expect(result).toEqual({ ok: false, error: '搜索失败' });
  });
});
