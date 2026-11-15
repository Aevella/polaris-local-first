import { describe, it, expect } from 'vitest';
import { readingPositionScrollDelta, resolveReadingScrollTop } from './timelineReadingPosition';

describe('resolveReadingScrollTop', () => {
  it('keeps the same paragraph visible when measured history grows above it', () => {
    expect(resolveReadingScrollTop({ scrollTop: 4000, currentOffset: 780, savedOffset: -120, maxScrollTop: 20000 })).toBe(4900);
  });

  it('compensates for browser anchoring only by the remaining displacement', () => {
    expect(resolveReadingScrollTop({ scrollTop: 4900, currentOffset: -120, savedOffset: -120, maxScrollTop: 20000 })).toBe(4900);
  });

  it('keeps reading in place when content below changes', () => {
    expect(resolveReadingScrollTop({ scrollTop: 4000, currentOffset: -120, savedOffset: -120, maxScrollTop: 30000 })).toBe(4000);
  });

  it('clamps after rows are removed', () => {
    expect(resolveReadingScrollTop({ scrollTop: 4000, currentOffset: -120, savedOffset: 900, maxScrollTop: 1000 })).toBe(1000);
    expect(resolveReadingScrollTop({ scrollTop: 20, currentOffset: -120, savedOffset: 0, maxScrollTop: 1000 })).toBe(0);
  });
});


describe('readingPositionScrollDelta', () => {
  it('uses only anchor geometry without converting asynchronous scroll position to a destination', () => {
    const container = {
      get scrollTop() { throw new Error('Must not read absolute scroll position'); },
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [{ dataset: { messageId: 'anchor' }, getBoundingClientRect: () => ({ top: 880 }) }]
    } as unknown as HTMLDivElement;
    expect(readingPositionScrollDelta(container, { messageId: 'anchor', offset: -120 })).toBe(900);
    expect(readingPositionScrollDelta(container, { messageId: 'anchor', offset: 780 })).toBe(0);
    expect(readingPositionScrollDelta(container, { messageId: 'missing', offset: 0 })).toBeNull();
  });
});
