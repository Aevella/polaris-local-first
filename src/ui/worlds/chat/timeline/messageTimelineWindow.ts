import type { TimelineRenderItem } from './messageTimelineItems';
import type { FollowMode } from './TimelineScroll';

const TIMELINE_WINDOW_OVERSCAN_PX = 900;
const DEFAULT_TIMELINE_ROW_HEIGHT = 168;
const TIMELINE_ROW_GAP = 18;
const ANCHOR_OVERSCAN_ITEMS = 12;

export type TimelineWindow = {
  visibleItems: TimelineRenderItem[];
  start: number;
  end: number;
  isWindowed: boolean;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
};

export type TimelineWindowMetrics = {
  scrollTop: number;
  viewportHeight: number;
  rowHeights: Record<string, number>;
  anchorMessageId?: string | null;
};

function rowHeightForItem(
  item: TimelineRenderItem,
  rowHeights: Record<string, number>,
  fallbackHeight: number
) {
  return Math.max(1, rowHeights[item.message.id] ?? fallbackHeight) + TIMELINE_ROW_GAP;
}

function sumHeights(heights: number[], start: number, end: number) {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += heights[index] ?? 0;
  }
  return total;
}

function resolveTailStart(heights: number[], viewportHeight: number) {
  const targetHeight = viewportHeight + TIMELINE_WINDOW_OVERSCAN_PX;
  let start = heights.length;
  let coveredHeight = 0;
  while (start > 0 && coveredHeight < targetHeight) {
    start -= 1;
    coveredHeight += heights[start] ?? 0;
  }
  return start;
}

export function resolveTimelineWindow(
  items: TimelineRenderItem[],
  followMode: FollowMode,
  focusedMessageId: string | null,
  metrics?: TimelineWindowMetrics
): TimelineWindow {
  if (!metrics || metrics.viewportHeight <= 0) {
    return {
      visibleItems: items,
      start: 0,
      end: items.length,
      isWindowed: false,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0
    };
  }

  // Keep unmeasured rows on one stable estimate. Deriving this fallback from
  // the currently mounted rows lets one very tall reply multiply its height
  // across every offscreen row and move the whole virtual timeline.
  const heights = items.map((item) => rowHeightForItem(
    item,
    metrics.rowHeights,
    DEFAULT_TIMELINE_ROW_HEIGHT
  ));
  if (sumHeights(heights, 0, heights.length) <= metrics.viewportHeight + (TIMELINE_WINDOW_OVERSCAN_PX * 2)) {
    return {
      visibleItems: items,
      start: 0,
      end: items.length,
      isWindowed: false,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0
    };
  }
  const visibleTop = Math.max(0, metrics.scrollTop - TIMELINE_WINDOW_OVERSCAN_PX);
  const visibleBottom = metrics.scrollTop + metrics.viewportHeight + TIMELINE_WINDOW_OVERSCAN_PX;
  let start = 0;
  let offset = 0;

  while (start < items.length && offset + (heights[start] ?? 0) < visibleTop) {
    offset += heights[start] ?? 0;
    start += 1;
  }

  let end = start;
  let bottomOffset = offset;
  while (end < items.length && bottomOffset < visibleBottom) {
    bottomOffset += heights[end] ?? 0;
    end += 1;
  }

  if (followMode === 'bottom') {
    end = items.length;
    start = Math.max(start, resolveTailStart(heights, metrics.viewportHeight));
  }

  const anchorMessageId = focusedMessageId ?? metrics.anchorMessageId ?? null;
  if (anchorMessageId) {
    const anchorIndex = items.findIndex((item) => item.message.id === anchorMessageId);
    if (anchorIndex >= 0) {
      start = Math.min(start, Math.max(0, anchorIndex - ANCHOR_OVERSCAN_ITEMS));
      end = Math.max(end, Math.min(items.length, anchorIndex + ANCHOR_OVERSCAN_ITEMS + 1));
    }
  }

  start = Math.max(0, Math.min(start, items.length));
  end = Math.max(start, Math.min(end, items.length));

  return {
    visibleItems: items.slice(start, end),
    start,
    end,
    isWindowed: start > 0 || end < items.length,
    topSpacerHeight: sumHeights(heights, 0, start),
    bottomSpacerHeight: sumHeights(heights, end, items.length)
  };
}
