import { describe, expect, it } from 'vitest';
import {
  normalizePersistedFollowMode,
  resolveReplyStageScrollTop,
  resolveTimelineJumpBehavior
} from './TimelineScroll';

describe('normalizePersistedFollowMode', () => {
  it('keeps reply-stage while generation is still active', () => {
    expect(normalizePersistedFollowMode('reply-stage', true)).toBe('reply-stage');
  });

  it('keeps reply-stage after generation settles', () => {
    expect(normalizePersistedFollowMode('reply-stage', false)).toBe('reply-stage');
  });

  it('leaves bottom and manual unchanged', () => {
    expect(normalizePersistedFollowMode('bottom', false)).toBe('bottom');
    expect(normalizePersistedFollowMode('manual', false)).toBe('manual');
  });
});

describe('resolveReplyStageScrollTop', () => {
  it('places the reply-stage row at the stable top offset when there is enough reserve', () => {
    expect(resolveReplyStageScrollTop({
      rowOffsetTop: 420,
      maxScrollTop: 1000
    })).toBe(402);
  });

  it('clamps to the current scroll range until reply-stage reserve is mounted', () => {
    expect(resolveReplyStageScrollTop({
      rowOffsetTop: 420,
      maxScrollTop: 260
    })).toBe(260);
  });
});

describe('resolveTimelineJumpBehavior', () => {
  it('keeps nearby jumps smooth', () => {
    expect(resolveTimelineJumpBehavior({
      currentTop: 1_000,
      targetTop: 2_100,
      viewportHeight: 600
    })).toBe('smooth');
  });

  it('makes multi-screen jumps instant', () => {
    expect(resolveTimelineJumpBehavior({
      currentTop: 0,
      targetTop: 120_000,
      viewportHeight: 600
    })).toBe('auto');
  });
});
