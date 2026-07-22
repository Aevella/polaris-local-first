import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n';
import { formatCacheReadRate, ModelUsageGroupRow } from './MenuUsageRows';

const zhCopy = createTranslator('zh-CN');

describe('formatCacheReadRate', () => {
  it('shows a reported zero cache read as zero percent', () => {
    expect(formatCacheReadRate(0, 716_388, 716_388, true, zhCopy)).toBe('0%');
  });

  it('keeps a missing cache read report distinct from zero', () => {
    expect(formatCacheReadRate(0, 716_388, 0, false, zhCopy)).toBe('未记录');
  });

  it('uses only cache-observed input when reports are mixed', () => {
    expect(formatCacheReadRate(60, 220, 120, true, zhCopy)).toBe('50%');
  });

  it('renders an explicitly reported zero instead of missing data', () => {
    const html = renderToStaticMarkup(<ModelUsageGroupRow group={{
      id: 'anthropic/claude-opus-4.7',
      model: 'anthropic/claude-opus-4.7',
      assistantNames: ['Assistant'],
      replyCount: 39,
      latestTimestamp: 1,
      totalTokens: 739_156,
      inputTokens: 716_388,
      outputTokens: 22_768,
      cachedInputTokens: 0,
      cacheMissInputTokens: 716_388,
      cacheObservedInputTokens: 716_388,
      cacheCreationInputTokens: 0,
      cacheReportedReplyCount: 39,
      cacheUnreportedReplyCount: 0,
      cacheZeroReadReplyCount: 39,
      reasoningTokens: 0
    }} />);

    expect(html).toContain('缓存读 0%');
    expect(html).toContain('缓存读 0');
    expect(html).toContain('缓存写 未记录');
  });
});
