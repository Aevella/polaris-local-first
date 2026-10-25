import { resolveSystemPromptVars, type TemplateContext } from './templateEngine';
import type { ChatMessage } from '../types/domain';

export const DEFAULT_WORLD_BOOK_SCAN_DEPTH = 4;

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
  warnings: string[];
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
    return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []);
  }
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (/^\/.*\/[dgimsuvy]*$/s.test(text)) return [text];
  return text.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);
}

function readWorldBookKeys(entry: Record<string, unknown>) {
  const keys = [
    ...normalizeStringList(entry.keys),
    ...normalizeStringList(entry.key),
    ...normalizeStringList(entry.keywords),
    ...normalizeStringList(entry.keyword),
    ...normalizeStringList(entry.primaryKey),
    ...normalizeStringList(entry.primaryKeys),
    ...normalizeStringList(entry.primary_key),
    ...normalizeStringList(entry.primary_keys)
  ];
  return keys.length ? keys : normalizeStringList(entry.triggers);
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

function normalizeWorldBookEntry(raw: unknown, warnings: string[]): RegexTriggerRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const extensions = source.extensions && typeof source.extensions === 'object'
    ? source.extensions as Record<string, unknown> : {};
  const entry = { ...extensions, ...source };
  if (readWorldBookBoolean(entry.disable) || readWorldBookBoolean(entry.disabled)
    || !readWorldBookBoolean(entry.enabled, true)) return null;

  const label = typeof entry.comment === 'string' && entry.comment.trim() ? entry.comment
    : typeof entry.name === 'string' && entry.name.trim() ? entry.name
      : readWorldBookKeys(entry)[0] ?? '条目';
  const prompt = readWorldBookPrompt(entry);
  const alwaysOn = readWorldBookBoolean(entry.constantActive)
    || readWorldBookBoolean(entry.alwaysOn) || readWorldBookBoolean(entry.constant);
  const directRule = normalizeTriggerRule({ ...entry, alwaysOn });
  const keys = Array.from(new Set(readWorldBookKeys(entry)));
  if (!prompt || (!directRule && !keys.length && !alwaysOn)) return null;

  // These features have no equivalent in Polaris's per-request trigger layer.
  const unsupported = [
    [readWorldBookBoolean(entry.vectorized), '向量触发'],
    [readWorldBookBoolean(entry.useProbability) && readWorldBookNumber(entry.probability) !== 100, '概率触发'],
    [typeof entry.group === 'string' && entry.group.trim(), '互斥分组'],
    [readWorldBookNumber(entry.sticky) || readWorldBookNumber(entry.cooldown) || readWorldBookNumber(entry.delay), '持续、冷却或延迟']
  ].filter(([enabled]) => Boolean(enabled)).map(([, name]) => name);
  if (unsupported.length) {
    warnings.push(`${label} 未导入：暂不支持${unsupported.join('、')}`);
    return null;
  }

  const caseSensitive = readWorldBookBoolean(entry.caseSensitive ?? entry.case_sensitive);
  let flags = directRule?.flags ?? (caseSensitive ? '' : 'i');
  const useRegex = readWorldBookBoolean(entry.useRegex ?? entry.use_regex);
  const secondary = normalizeStringList(entry.keysecondary ?? entry.secondary_keys);
  const allKeys = [...keys, ...secondary];
  const regexFlags = allKeys.map((key) => key.match(/^\/(.*)\/([dgimsuvy]*)$/s)?.[2]);
  if (!directRule && allKeys.length && regexFlags.every((value) => value !== undefined)) {
    flags = regexFlags[0]!;
  }
  const wholeWords = readWorldBookBoolean(entry.matchWholeWords ?? entry.match_whole_words);
  const buildKey = (key: string) => {
    const literalRegex = key.match(/^\/(.*)\/([dgimsuvy]*)$/s);
    if (literalRegex) {
      if (literalRegex[2] !== flags) throw new Error('同一条目的正则 flags 与关键词大小写设置不同');
      return literalRegex[1];
    }
    if (useRegex) return key;
    const literal = escapeRegexLiteral(key);
    return wholeWords && !/\s/.test(key) ? `(?<!\\w)(?:${literal})(?!\\w)` : literal;
  };
  let pattern = directRule?.pattern ?? '';
  try {
    if (!directRule && !alwaysOn) pattern = keys.map(buildKey).map((key) => `(?:${key})`).join('|');
    // Keep ordinary literal-key imports readable in the existing editor.
    if (!directRule && !alwaysOn && !useRegex && !wholeWords && !keys.some((key) => key.startsWith('/'))) {
      pattern = keys.map(escapeRegexLiteral).join('|');
    }
    const selective = readWorldBookBoolean(entry.selective, true);
    if (!alwaysOn && selective && secondary.length) {
      const patterns = secondary.map(buildKey);
      const logic = readWorldBookNumber(entry.selectiveLogic ?? entry.selective_logic) ?? 0;
      if (![0, 1, 2, 3].includes(logic)) throw new Error('未知的附加关键词逻辑');
      const any = `(?:${patterns.join('|')})`;
      const all = patterns.map((key) => `(?=[\\s\\S]*(?:${key}))`).join('');
      const filter = logic === 0 ? `(?=[\\s\\S]*${any})`
        : logic === 1 ? `(?!${all})`
          : logic === 2 ? `(?![\\s\\S]*${any})` : all;
      pattern = `(?<![\\s\\S])(?=[\\s\\S]*(?:${pattern}))${filter}[\\s\\S]*`;
    }
    if (!alwaysOn) new RegExp(pattern, flags);
  } catch (error) {
    warnings.push(`${label} 未导入：${error instanceof Error ? error.message : '正则无效'}`);
    return null;
  }
  const scanDepth = readWorldBookNumber(entry.scanDepth ?? entry.scan_depth);
  const insertionOrder = readWorldBookNumber(entry.order ?? entry.insertion_order);
  const priority = readWorldBookNumber(entry.priority) ?? (insertionOrder !== null ? -insertionOrder : null);
  const position = entry.position;
  if (position !== undefined && position !== 0 && position !== 'before_char') {
    warnings.push(`${label} 的插入位置改为 Polaris 的本轮世界书上下文`);
  }
  return {
    pattern, prompt, flags,
    ...(scanDepth !== null && scanDepth > 0 ? { scanDepth: Math.floor(scanDepth) } : {}),
    ...(alwaysOn ? { alwaysOn: true } : {}),
    ...(priority !== null ? { priority: Math.trunc(priority) } : {})
  };
}

function readObjectPath(root: Record<string, unknown>, path: string[]) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);
}

function readJsonWorldBookEntries(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  const root = parsed as Record<string, unknown>;
  if (readWorldBookPrompt(root) && (readWorldBookKeys(root).length
    || typeof root.pattern === 'string' || root.constant || root.constantActive || root.alwaysOn)) return [root];
  const candidatePaths = [
    ['entries'], ['world_info', 'entries'], ['lorebook', 'entries'],
    ['character_book', 'entries'], ['data', 'character_book', 'entries'],
    ['data', 'entries'], ['items'], ['data']
  ];
  for (const path of candidatePaths) {
    const entries = readObjectPath(root, path);
    const list = Array.isArray(entries) ? entries
      : entries && typeof entries === 'object' ? Object.values(entries) : null;
    if (list) {
      const book = readObjectPath(root, path.slice(0, -1)) as Record<string, unknown> | undefined;
      return list.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const record = entry as Record<string, unknown>;
        return {
          ...record,
          extensions: { scan_depth: book?.scan_depth, ...(record.extensions as object ?? {}) }
        };
      });
    }
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
  const warnings: string[] = [];
  if (!trimmed) return { rules: [], skippedCount: 0, warnings };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch {
      return { rules: [], skippedCount: 0, warnings: ['JSON 格式损坏，未导入任何条目'] };
    }
    const entries = readJsonWorldBookEntries(parsed);
    const rules = entries.map((entry) => normalizeWorldBookEntry(entry, warnings))
      .filter((rule): rule is RegexTriggerRule => Boolean(rule));
    return { rules, skippedCount: entries.length - rules.length, warnings };
  }
  const lines = trimmed.split('\n').filter((line) => line.trim());
  const rules = lines.flatMap((line) => parseTextWorldBookTriggers(line));
  return { rules, skippedCount: lines.length - rules.length, warnings };
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

      const depth = Math.max(1, Math.floor(rule.scanDepth ?? DEFAULT_WORLD_BOOK_SCAN_DEPTH));
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

export function buildRegexTriggerContext(
  messages: ChatMessage[], rulesInput: string | RegexTriggerRule[] | undefined, templateContext?: TemplateContext
) {
  const rules = Array.isArray(rulesInput) ? rulesInput : parseRegexTriggers(rulesInput);
  const preparedRules = templateContext ? rules.map((rule) => ({
    ...rule,
    pattern: rule.pattern.replace(/\\?\{\\?\{\s*(user|char|char_name)\s*\\?\}\\?\}/g, (_match, key: string) =>
      escapeRegexLiteral(key === 'user' ? templateContext.user_name : templateContext.assistant_name)),
    prompt: resolveSystemPromptVars(rule.prompt, templateContext)
  })) : rules;
  const matches = resolveRegexTriggerMatches(messages, preparedRules);
  if (!matches.length) return '';

  return [
    '[协作者世界书]',
    '以下正文是当前协作者在本轮生效的世界设定、角色资料和叙事约定。直接结合正文保持相关事实、角色行为和叙事的一致性，不需要用户再次要求读取。常驻条目每轮生效；关键词条目在本轮命中后生效。',
    '这些是背景资料，不是用户新发的消息，不要复述触发过程。不要改写用户原文，也不要把触发规则当作工具开关；用户明确修改设定时，以用户的新说明为准。',
    ...matches.map((rule) => {
      const source = rule.alwaysOn ? '常驻' : `/${rule.pattern}/${rule.flags ?? ''}`;
      return `- ${source}：${rule.prompt}`;
    })
  ].join('\n');
}
