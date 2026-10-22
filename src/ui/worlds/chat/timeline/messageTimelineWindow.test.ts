import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../types/domain';
import { resolveTimelineWindow } from './messageTimelineWindow';
import type { TimelineRenderItem } from './messageTimelineItems';

function buildMessage(index: number, role: ChatMessage['role'] = 'assistant'): ChatMessage {
  return {
    id: `message-${index}`,
    role,
    content: `message ${index}`,
    timestamp: index
  };
}

function buildItem(index: number, role: ChatMessage['role'] = 'assistant'): TimelineRenderItem {
  return {
    message: buildMessage(index, role),
    toolMessages: [],
    messageCycleIndex: index,
    userBubbleIndex: role === 'user' ? index : undefined,
    isAssistantContinuation: false,
    isTerminalAssistantInUserTurn: true,
    assistantReplyContent: `message ${index}`
  };
}

describe('resolveTimelineWindow', () => {
  it('keeps the manual reading anchor mounted while measured history displaces the old viewport', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'manual', null, {
      scrollTop: 12_000,
      viewportHeight: 640,
      rowHeights: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`message-${index}`, 900])),
      anchorMessageId: 'message-65'
    });
    expect(window.visibleItems.some((item) => item.message.id === 'message-65')).toBe(true);
    expect(window.visibleItems.length).toBeLessThan(40);
  });

  it('lets explicit search take precedence over the manual reading anchor', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'manual', 'message-5', {
      scrollTop: 12_000, viewportHeight: 640, rowHeights: {}, anchorMessageId: 'message-65'
    });
    expect(window.visibleItems.some((item) => item.message.id === 'message-5')).toBe(true);
    expect(window.visibleItems.some((item) => item.message.id === 'message-65')).toBe(false);
  });

  it('mounts only the destination window when focusing far across 5000 messages', () => {
    const items = Array.from({ length: 5000 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'manual', 'message-5', {
      scrollTop: 900_000, viewportHeight: 640, rowHeights: {}
    });
    expect(window.visibleItems.some(item => item.message.id === 'message-5')).toBe(true);
    expect(window.visibleItems.length).toBeLessThan(50);
    expect(window.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('keeps short timelines whole', () => {
    const items = Array.from({ length: 8 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'manual', null, {
      scrollTop: 0,
      viewportHeight: 520,
      rowHeights: {}
    });

    expect(window.isWindowed).toBe(false);
    expect(window.visibleItems).toHaveLength(8);
    expect(window.topSpacerHeight).toBe(0);
    expect(window.bottomSpacerHeight).toBe(0);
  });

  it('windows long timelines around the manual viewport', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'manual', null, {
      scrollTop: 4200,
      viewportHeight: 640,
      rowHeights: {}
    });

    expect(window.isWindowed).toBe(true);
    expect(window.start).toBeGreaterThan(0);
    expect(window.end).toBeLessThan(96);
    expect(window.visibleItems.length).toBeGreaterThan(8);
    expect(window.topSpacerHeight).toBeGreaterThan(0);
    expect(window.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('keeps the live tail visible while following bottom', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'bottom', null, {
      scrollTop: 0,
      viewportHeight: 640,
      rowHeights: {}
    });

    expect(window.isWindowed).toBe(true);
    expect(window.end).toBe(96);
    expect(window.visibleItems[window.visibleItems.length - 1]?.message.id).toBe('message-95');
    expect(window.visibleItems.length).toBeLessThan(20);
    expect(window.topSpacerHeight).toBeGreaterThan(0);
    expect(window.bottomSpacerHeight).toBe(0);
  });

  it('keeps the reply-stage anchor mounted even when it is outside the viewport range', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const window = resolveTimelineWindow(items, 'reply-stage', null, {
      scrollTop: 9000,
      viewportHeight: 640,
      rowHeights: {},
      anchorMessageId: 'message-12'
    });

    expect(window.isWindowed).toBe(true);
    expect(window.visibleItems.some((item) => item.message.id === 'message-12')).toBe(true);
    expect(window.start).toBeLessThanOrEqual(12);
    expect(window.end).toBeGreaterThan(12);
    expect(window.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('does not let one tall measured reply inflate every unmeasured spacer row', () => {
    const items = Array.from({ length: 96 }, (_, index) => buildItem(index));
    const baseline = resolveTimelineWindow(items, 'reply-stage', 'message-72', {
      scrollTop: 12_000,
      viewportHeight: 640,
      rowHeights: {}
    });
    const withTallReply = resolveTimelineWindow(items, 'reply-stage', 'message-72', {
      scrollTop: 12_000,
      viewportHeight: 640,
      rowHeights: {
        'message-72': 3_600
      }
    });

    expect(withTallReply.topSpacerHeight).toBe(baseline.topSpacerHeight);
  });
});


describe('timeline spacer geometry', () => {
  it.each([11, 12, 16, 18])('preserves full layout height with a %i px CSS gap', (rowGap) => {
    const items = Array.from({ length: 300 }, (_, index) => buildItem(index));
    const rowHeights = Object.fromEntries(items.map((item, index) => [item.message.id, index % 7 ? 100 : 900]));
    const fullHeight = Object.values(rowHeights).reduce((sum, height) => sum + height, 0) + (items.length - 1) * rowGap;
    for (const scrollTop of [0, 5000, 20000, fullHeight - 640]) {
      const window = resolveTimelineWindow(items, 'manual', null, { scrollTop, viewportHeight: 640, rowHeights, rowGap });
      const spacerCount = Number(window.start > 0) + Number(window.end < items.length);
      const renderedHeight = window.visibleItems.reduce((sum, item) => sum + rowHeights[item.message.id], 0)
        + window.topSpacerHeight + window.bottomSpacerHeight
        + (window.visibleItems.length + spacerCount - 1) * rowGap;
      expect(renderedHeight).toBe(fullHeight);
      const firstRowOffset = window.topSpacerHeight + (window.start > 0 ? rowGap : 0);
      const fullOffset = items.slice(0, window.start).reduce((sum, item) => sum + rowHeights[item.message.id] + rowGap, 0);
      expect(firstRowOffset).toBe(fullOffset);
    }
  });
});
