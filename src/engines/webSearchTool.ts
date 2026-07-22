import { buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import type { ToolResult } from './toolResult';
import type { WebPageReadEvidence, WebSearchConfig, WebSearchEvidence } from '../types/domain';

const DEFAULT_SEARCH_MAX_RESULTS = 8;
const MAX_SEARCH_RESULTS = 20;
const DEFAULT_PAGE_MAX_CHARS = 40_000;
const MAX_PAGE_CHARS = 80_000;
const SEARCH_ENDPOINT = '/api/search';

type WebSearchRequestConfig =
  Pick<WebSearchConfig, 'provider' | 'apiKey' | 'bochaSummary' | 'bochaFreshness'>
  & Partial<Pick<WebSearchConfig, 'customEndpoint' | 'customAdapter' | 'customLabel'>>;

export type WebSearchItem = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
};

export type WebSearchResult = ToolResult<{
  query: string;
  results: WebSearchItem[];
  provider: string;
  degraded?: boolean;
  warning?: string;
  webSearch: WebSearchEvidence;
  detailText: string;
}>;

export type ReadWebPageResult = ToolResult<{
  url: string;
  title: string | null;
  text: string;
  provider: string;
  truncated: boolean;
  originalLength: number;
  webPageRead: WebPageReadEvidence;
  detailText: string;
}>;

async function postSearchPayload<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildInternalApiEndpoint(SEARCH_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null) as
    | (T & { error?: { message?: string } })
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `搜索服务异常（${response.status}）`);
  }
  if (!data) {
    throw new Error('搜索服务返回了空响应。');
  }
  return data as T;
}

function buildSearchProviderPayload(searchConfig?: WebSearchRequestConfig | null) {
  const provider = searchConfig?.provider ?? 'bingLocal';
  return {
    searchProvider: provider,
    searchApiKey: provider === 'bingLocal' ? undefined : searchConfig?.apiKey,
    bochaSummary: provider === 'bocha' ? searchConfig?.bochaSummary : undefined,
    bochaFreshness: provider === 'bocha' ? searchConfig?.bochaFreshness : undefined,
    customSearchEndpoint: provider === 'custom' ? searchConfig?.customEndpoint : undefined,
    customSearchAdapter: provider === 'custom' ? searchConfig?.customAdapter : undefined,
    customSearchLabel: provider === 'custom' ? searchConfig?.customLabel : undefined
  };
}

export async function runWebSearch(
  query: string,
  maxResults?: number,
  searchConfig?: WebSearchRequestConfig | null
): Promise<WebSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { ok: false, error: '搜索内容不能为空。' };
  }

  try {
    const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(maxResults ?? DEFAULT_SEARCH_MAX_RESULTS)));
    const data = await postSearchPayload<{
      query: string;
      provider: string;
      degraded?: boolean;
      warning?: string;
      results: WebSearchItem[];
    }>({
      mode: 'search',
      query: normalizedQuery,
      maxResults: limit,
      ...buildSearchProviderPayload(searchConfig)
    });

    if (!Array.isArray(data.results)) {
      throw new Error('搜索服务返回格式异常。');
    }
    if (!data.results.length) {
      return { ok: false, error: `没有找到和“${normalizedQuery}”相关的网页结果。` };
    }

    const webSearch: WebSearchEvidence = {
      query: data.query,
      provider: data.provider,
      degraded: data.degraded || undefined,
      warning: data.warning || undefined,
      results: data.results
    };

    const detailParts = [
      `查询：${data.query}`,
      `来源：${data.provider}`,
      data.degraded ? '状态：降级搜索结果，请优先用 readWebPage 读取可靠来源后再回答。' : '',
      data.warning ? `提示：${data.warning}` : '',
      ...data.results.map(
        (item, index) =>
          [
            `${index + 1}. ${item.title}`,
            item.url,
            item.publishedAt ? `时间：${item.publishedAt}` : '',
            item.snippet
          ].filter(Boolean).join('\n')
      ),
      '下一步：如果用户要事实、时效信息、产品/地点/新闻/规则判断，请继续用 readWebPage 读取已返回的相关结果页；只有用户只要链接时，才直接根据搜索结果回答。不要对同一个查询再次调用 webSearch 来等待更好的结果；如果候选来源不足或不可读，直接说明限制。'
    ].filter(Boolean);

    return {
      ok: true,
      query: data.query,
      provider: data.provider,
      degraded: data.degraded || undefined,
      warning: data.warning || undefined,
      results: data.results,
      webSearch,
      detailText: detailParts.join('\n\n')
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '联网搜索失败。'
    };
  }
}

export async function readWebPageContent(url: string, maxChars?: number): Promise<ReadWebPageResult> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return { ok: false, error: '网页地址不能为空。' };
  }

  try {
    const limit = Math.max(1000, Math.min(MAX_PAGE_CHARS, Math.floor(maxChars ?? DEFAULT_PAGE_MAX_CHARS)));
    const data = await postSearchPayload<{
      url: string;
      title: string | null;
      text: string;
      provider: string;
      truncated: boolean;
      originalLength: number;
    }>({
      mode: 'read',
      url: normalizedUrl,
      maxChars: limit
    });

    if (typeof data.text !== 'string') {
      throw new Error('网页读取服务返回格式异常。');
    }
    const webPageRead: WebPageReadEvidence = {
      url: data.url,
      title: data.title,
      provider: data.provider,
      excerpt: data.text,
      truncated: data.truncated || undefined,
      originalLength: data.originalLength || undefined
    };

    const detailText = [
      `网页：${data.title || data.url}`,
      data.url,
      `来源：${data.provider}`,
      '',
      data.text
    ];
    if (data.truncated) {
      detailText.push('', `[内容已截断，原始长度 ${data.originalLength.toLocaleString('zh-CN')} 字]`);
    }

    return {
      ok: true,
      url: data.url,
      title: data.title,
      text: data.text,
      provider: data.provider,
      truncated: data.truncated,
      originalLength: data.originalLength,
      webPageRead,
      detailText: detailText.join('\n')
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '网页读取失败。'
    };
  }
}
