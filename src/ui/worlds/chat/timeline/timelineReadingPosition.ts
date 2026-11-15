export type TimelineReadingPosition = {
  messageId: string;
  offset: number;
};

export function readTimelineReadingPosition(container: HTMLDivElement): TimelineReadingPosition | null {
  const top = container.getBoundingClientRect().top;
  const rows = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > top && rect.top < top + container.clientHeight) {
      return { messageId: row.dataset.messageId!, offset: rect.top - top };
    }
  }
  return null;
}

export function resolveReadingScrollTop(args: {
  scrollTop: number;
  currentOffset: number;
  savedOffset: number;
  maxScrollTop: number;
}) {
  return Math.max(0, Math.min(args.maxScrollTop, args.scrollTop + args.currentOffset - args.savedOffset));
}

export function readingPositionScrollDelta(container: HTMLDivElement, position: TimelineReadingPosition) {
  const row = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find((candidate) => candidate.dataset.messageId === position.messageId);
  if (!row) return null;
  return row.getBoundingClientRect().top - container.getBoundingClientRect().top - position.offset;
}

export function readingPositionScrollTop(container: HTMLDivElement, position: TimelineReadingPosition) {
  const delta = readingPositionScrollDelta(container, position);
  if (delta === null) return null;
  return resolveReadingScrollTop({
    scrollTop: container.scrollTop,
    currentOffset: delta,
    savedOffset: 0,
    maxScrollTop: Math.max(0, container.scrollHeight - container.clientHeight)
  });
}
