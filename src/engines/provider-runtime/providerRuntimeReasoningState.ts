import type {
  ChatProviderReasoningItem,
  ChatProviderReasoningState
} from '../../types/domain';

const TEXT_FIELDS = ['text', 'thinking', 'summary', 'data', 'signature'] as const;

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function normalizeProviderReasoningItem(
  value: unknown,
  fallbackIndex?: number
): ChatProviderReasoningItem | undefined {
  const source = readObject(value);
  if (!source || typeof source.type !== 'string' || !source.type.trim()) return undefined;

  const item: ChatProviderReasoningItem = { type: source.type };
  const index = typeof source.index === 'number' && Number.isInteger(source.index) && source.index >= 0
    ? source.index
    : fallbackIndex;
  if (index !== undefined) item.index = index;
  if (typeof source.id === 'string' && source.id) item.id = source.id;
  if (typeof source.format === 'string' && source.format) item.format = source.format;
  TEXT_FIELDS.forEach((field) => {
    if (typeof source[field] === 'string' && source[field]) {
      item[field] = source[field];
    }
  });
  return item;
}

export function normalizeProviderReasoningItems(value: unknown): ChatProviderReasoningItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => normalizeProviderReasoningItem(item, index))
    .filter((item): item is ChatProviderReasoningItem => Boolean(item));
}

export function normalizeProviderReasoningState(
  value: ChatProviderReasoningState | undefined
): ChatProviderReasoningState | undefined {
  if (!value || (value.protocol !== 'anthropic-messages' && value.protocol !== 'openai-completions')) {
    return undefined;
  }
  const items = normalizeProviderReasoningItems(value.items);
  return items.length ? { protocol: value.protocol, items } : undefined;
}

function appendFragment(current: string | undefined, incoming: string | undefined) {
  if (!incoming) return current;
  if (!current || incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;
  return current + incoming;
}

function matchesReasoningItem(left: ChatProviderReasoningItem, right: ChatProviderReasoningItem) {
  if (left.id && right.id) return left.id === right.id;
  return left.type === right.type && left.index === right.index;
}

export function mergeProviderReasoningState(
  current: ChatProviderReasoningState | undefined,
  incoming: ChatProviderReasoningState
): ChatProviderReasoningState {
  if (!current || current.protocol !== incoming.protocol) {
    return {
      protocol: incoming.protocol,
      items: incoming.items.map((item) => ({ ...item }))
    };
  }

  const items = current.items.map((item) => ({ ...item }));
  incoming.items.forEach((incomingItem) => {
    const existing = items.find((item) => matchesReasoningItem(item, incomingItem));
    if (!existing) {
      items.push({ ...incomingItem });
      return;
    }
    if (incomingItem.id) existing.id = incomingItem.id;
    if (incomingItem.format) existing.format = incomingItem.format;
    TEXT_FIELDS.forEach((field) => {
      existing[field] = appendFragment(existing[field], incomingItem[field]);
    });
  });
  return { protocol: current.protocol, items };
}

export function extractProviderReasoningText(items: ChatProviderReasoningItem[]) {
  return items
    .map((item) => item.thinking ?? item.text ?? item.summary ?? '')
    .filter(Boolean)
    .join('');
}

export function reasoningItemsForReplay(state: ChatProviderReasoningState | undefined) {
  return state?.items.map(({ index: _index, ...item }) => item) ?? [];
}
