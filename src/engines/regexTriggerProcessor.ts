import type { ChatMessage } from '../types/domain';

export interface RegexTriggerRule {
  pattern: string;
  prompt: string;
  flags?: string;
  scanDepth?: number;
  alwaysOn?: boolean;
  priority?: number;
}

export interface RegexTriggerWorldBookImportResult {
  rules: RegexTriggerRule[];
  skippedCount: number;
}

function normalizeTriggerRule(raw: unknown): RegexTriggerRule | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Partial<RegexTriggerRule>;
  if (typeof candidate.prompt !== 'string') {
    return null;
  }

  const pattern = typeof candidate.pattern === 'string' ? candidate.pattern.trim() : '';
  const prompt = candidate.prompt.trim();
  const alwaysOn = candidate.alwaysOn === true;
  if ((!pattern && !alwaysOn) || !prompt) return null;

  const scanDepth = Number(candidate.scanDepth);
  const priority = Number(candidate.priority);

  return {
    pattern,
    prompt,
    flags: typeof candidate.flags === 'string' ? candidate.flags.trim() : '',
    ...(Number.isFinite(scanDepth) && scanDepth > 0 ? { scanDepth: Math.floor(scanDepth) } : {}),
    ...(alwaysOn ? { alwaysOn: true } : {}),
    ...(Number.isFinite(priority) ? { priority: Math.trunc(priority) } : {})
  };
}

function parseLineTrigger(line: string): RegexTriggerRule | null {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length < 2) return null;

  return normalizeTriggerRule({
    pattern: parts[0],
    prompt: parts[1],
    flags: parts[2] ?? ''
  });
}

export function parseRegexTriggers(input: string | undefined): RegexTriggerRule[] {
  const trimmed = input?.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeTriggerRule(item)).filter((item): item is RegexTriggerRule => Boolean(item));
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split('\n')
    .map((line) => parseLineTrigger(line.trim()))
    .filter((item): item is RegexTriggerRule => Boolean(item));
}

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringList(item));
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readWorldBookKeys(entry: Record<string, unknown>) {
  return [
    ...normalizeStringList(entry.keys),
    ...normalizeStringList(entry.key),
    ...normalizeStringList(entry.keywords),
    ...normalizeStringList(entry.keyword),
    ...normalizeStringList(entry.triggers),
    ...normalizeStringList(entry.primaryKey),
    ...normalizeStringList(entry.primaryKeys),
    ...normalizeStringList(entry.primary_key),
    ...normalizeStringList(entry.primary_keys)
  ];
}

function readWorldBookPrompt(entry: Record<string, unknown>) {
  const candidates = [
    entry.prompt,
    entry.content,
    entry.entry,
    entry.text,
    entry.value,
    entry.description
  ];
  const text = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return text?.trim() ?? '';
}

function readWorldBookBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function readWorldBookNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeWorldBookEntry(raw: unknown): RegexTriggerRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (entry.disable === true || entry.disabled === true || entry.enabled === false) return null;

  const directRule = normalizeTriggerRule(entry);
  if (directRule) return directRule;

  const keys = Array.from(new Set(readWorldBookKeys(entry)));
  const prompt = readWorldBookPrompt(entry);
  const alwaysOn = readWorldBookBoolean(entry.constantActive) || readWorldBookBoolean(entry.alwaysOn);
  if ((!keys.length && !alwaysOn) || !prompt) return null;

  const useRegex = readWorldBookBoolean(entry.useRegex);
  const caseSensitive = readWorldBookBoolean(entry.caseSensitive);
  const scanDepth = readWorldBookNumber(entry.scanDepth);
  const priority = readWorldBookNumber(entry.priority);
  const normalizedScanDepth = scanDepth !== null && scanDepth > 0 ? Math.floor(scanDepth) : null;
  const normalizedPriority = priority !== null ? Math.trunc(priority) : null;

  return {
    pattern: useRegex ? keys.join('|') : keys.map(escapeRegexLiteral).join('|'),
    prompt,
    flags: caseSensitive ? '' : 'i',
    ...(normalizedScanDepth !== null ? { scanDepth: normalizedScanDepth } : {}),
    ...(alwaysOn ? { alwaysOn: true } : {}),
    ...(normalizedPriority !== null ? { priority: normalizedPriority } : {})
  };
}

function normalizeWorldBookEntryList(value: unknown): RegexTriggerRule[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWorldBookEntry(item)).filter((item): item is RegexTriggerRule => Boolean(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map((item) => normalizeWorldBookEntry(item)).filter((item): item is RegexTriggerRule => Boolean(item));
  }
  return [];
}

function readObjectPath(root: Record<string, unknown>, path: string[]) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
}

function parseJsonWorldBookTriggers(parsed: unknown): RegexTriggerRule[] {
  if (Array.isArray(parsed)) {
    return normalizeWorldBookEntryList(parsed);
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const root = parsed as Record<string, unknown>;
  const directRule = normalizeWorldBookEntry(root);
  if (directRule) return [directRule];

  const candidatePaths = [
    ['entries'],
    ['world_info', 'entries'],
    ['lorebook', 'entries'],
    ['data', 'entries'],
    ['data'],
    ['items']
  ];

  for (const path of candidatePaths) {
    const rules = normalizeWorldBookEntryList(readObjectPath(root, path));
    if (rules.length > 0) return rules;
  }

  return [];
}

function parseTextWorldBookTriggers(input: string): RegexTriggerRule[] {
  const compactRules = parseRegexTriggers(input);
  if (compactRules.length > 0) return compactRules;

  return input
    .split('\n')
    .map<RegexTriggerRule | null>((line) => {
      const [keysPart, promptPart] = line.split(/\s*(?:=>|->|→)\s*/);
      const keys = normalizeStringList(keysPart);
      const prompt = promptPart?.trim() ?? '';
      if (!keys.length || !prompt) return null;
      return {
        pattern: keys.map(escapeRegexLiteral).join('|'),
        prompt,
        flags: 'i'
      };
    })
    .filter((item): item is RegexTriggerRule => Boolean(item));
}

export function parseWorldBookRegexTriggers(input: string): RegexTriggerWorldBookImportResult {
  const trimmed = input.trim();
  if (!trimmed) return { rules: [], skippedCount: 0 };

  let rules: RegexTriggerRule[] = [];
  try {
    rules = parseJsonWorldBookTriggers(JSON.parse(trimmed));
  } catch {
    rules = parseTextWorldBookTriggers(trimmed);
  }

  return {
    rules,
    skippedCount: Math.max(0, trimmed.split('\n').filter((line) => line.trim()).length - rules.length)
  };
}

function getLatestUserContent(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message.content;
    }
  }
  return '';
}

function extractRecentConversationContent(messages: ChatMessage[], depth: number) {
  const limit = Math.max(1, Math.floor(depth));
  const parts: string[] = [];
  for (let index = messages.length - 1; index >= 0 && parts.length < limit; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.content.trim();
    if (!content) continue;
    parts.push(content);
  }
  return parts.reverse().join('\n');
}

export function resolveRegexTriggerMatches(messages: ChatMessage[], rulesInput: string | RegexTriggerRule[] | undefined): RegexTriggerRule[] {
  const rules = Array.isArray(rulesInput) ? rulesInput : parseRegexTriggers(rulesInput);
  if (!rules.length) return [];

  const latestUserContent = getLatestUserContent(messages);
  const contextByDepth = new Map<number, string>();

  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => {
      if (rule.alwaysOn) return true;
      if (!rule.pattern.trim()) return false;

      const depth = Math.max(1, Math.floor(rule.scanDepth ?? 1));
      const context = depth <= 1
        ? latestUserContent
        : contextByDepth.get(depth) ?? extractRecentConversationContent(messages, depth);
      if (depth > 1 && !contextByDepth.has(depth)) {
        contextByDepth.set(depth, context);
      }
      if (!context.trim()) return false;

      try {
        return new RegExp(rule.pattern, rule.flags).test(context);
      } catch {
        return false;
      }
    })
    .sort((left, right) => {
      const priorityDelta = (right.rule.priority ?? 0) - (left.rule.priority ?? 0);
      return priorityDelta || left.index - right.index;
    })
    .map(({ rule }) => rule);
}

export function buildRegexTriggerContext(messages: ChatMessage[], rulesInput: string | RegexTriggerRule[] | undefined) {
  const matches = resolveRegexTriggerMatches(messages, rulesInput);
  if (!matches.length) return '';

  return [
    '[正则触发]',
    '当前对话上下文命中了以下协作者世界书触发规则。把这些内容作为本轮额外上下文参考；不要改写用户原文，也不要把触发规则当作工具开关。',
    ...matches.map((rule) => {
      const source = rule.alwaysOn ? '常驻' : `/${rule.pattern}/${rule.flags ?? ''}`;
      return `- ${source}：${rule.prompt}`;
    })
  ].join('\n');
}
