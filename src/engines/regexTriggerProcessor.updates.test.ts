import { buildTemplateContext } from './templateEngine';
import { describe, expect, it } from 'vitest';
import { buildRegexTriggerContext, parseRegexTriggers, parseWorldBookRegexTriggers, resolveRegexTriggerMatches } from './regexTriggerProcessor';
import type { ChatMessage } from '../types/domain';

const userMessage = (content: string): ChatMessage => ({
  id: `user-${content}`,
  role: 'user',
  content,
  timestamp: 1
});

describe('parseRegexTriggers', () => {
  it('parses JSON trigger rules and drops incomplete entries', () => {
    expect(parseRegexTriggers(JSON.stringify([
      { pattern: '白树', prompt: '带入白树设定', flags: 'i' },
      { pattern: '', prompt: '跳过' },
      { pattern: '拉梅兰', prompt: '' }
    ]))).toEqual([
      { pattern: '白树', prompt: '带入白树设定', flags: 'i' }
    ]);
  });

  it('parses compact line trigger rules', () => {
    expect(parseRegexTriggers('白树|带入白树设定|i')).toEqual([
      { pattern: '白树', prompt: '带入白树设定', flags: 'i' }
    ]);
  });
});

describe('parseWorldBookRegexTriggers', () => {
  it('imports object-entry world books as regex triggers', () => {
    expect(parseWorldBookRegexTriggers(JSON.stringify({
      entries: {
        first: {
          keys: ['白树', '拉梅兰'],
          content: '带入白树和拉梅兰的世界设定。'
        },
        disabled: {
          keys: ['跳过'],
          content: '不应该导入。',
          disabled: true
        }
      }
    })).rules).toEqual([
      {
        pattern: '白树|拉梅兰',
        prompt: '带入白树和拉梅兰的世界设定。',
        flags: 'i'
      }
    ]);
  });

  it('imports Kelivo-style world book trigger settings', () => {
    expect(parseWorldBookRegexTriggers(JSON.stringify({
      entries: [{
        keywords: ['白树'],
        content: '带入白树设定。',
        scanDepth: 4,
        priority: 7,
        useRegex: false,
        caseSensitive: false
      }, {
        content: '常驻世界规则。',
        constantActive: true
      }]
    })).rules).toEqual([
      {
        pattern: '白树',
        prompt: '带入白树设定。',
        flags: 'i',
        scanDepth: 4,
        priority: 7
      },
      {
        pattern: '',
        prompt: '常驻世界规则。',
        flags: 'i',
        alwaysOn: true
      }
    ]);
  });

  it('escapes literal keys when building patterns', () => {
    expect(parseWorldBookRegexTriggers(JSON.stringify([
      {
        key: ['A.B', 'C+D'],
        content: '这些是普通关键词，不是正则。'
      }
    ])).rules[0]).toEqual({
      pattern: 'A\\.B|C\\+D',
      prompt: '这些是普通关键词，不是正则。',
      flags: 'i'
    });
  });

  it('imports constants, character-card books and extension settings with exact entry counts', () => {
    const result = parseWorldBookRegexTriggers(JSON.stringify({ data: { character_book: {
      description: '世界书目录', scan_depth: 6,
      entries: [
        { keys: [], content: '常驻设定', constant: true },
        { keys: ['White Tree'], content: '地点设定', insertion_order: 9,
          extensions: { scan_depth: 8, case_sensitive: true } },
        { keys: ['停用'], content: '停用设定', enabled: false },
        { keys: ['空正文'], content: '' }
      ]
    } } }, null, 2));
    expect(result.skippedCount).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.rules).toEqual([
      { pattern: '', prompt: '常驻设定', flags: 'i', alwaysOn: true, scanDepth: 6 },
      { pattern: 'White Tree', prompt: '地点设定', flags: '', scanDepth: 8, priority: -9 }
    ]);
    expect(resolveRegexTriggerMatches([userMessage('普通对话')], result.rules).map((rule) => rule.prompt))
      .toEqual(['常驻设定']);
  });

  it.each([
    [0, '白树 雪 夜', true], [0, '白树 晴天', false],
    [1, '白树 雪 夜', false], [1, '白树 雪', true],
    [2, '白树 雪', false], [2, '白树 晴天', true],
    [3, '白树 雪 夜', true], [3, '白树 雪', false]
  ])('preserves selective logic %s in imported conditions for %s', (logic, text, expected) => {
    const result = parseWorldBookRegexTriggers(JSON.stringify({ entries: [{
      key: ['白树'], keysecondary: ['雪', '夜'], selective: true, selectiveLogic: logic, content: '条件设定'
    }] }));
    expect(result.skippedCount).toBe(0);
    expect(resolveRegexTriggerMatches([userMessage(text)], result.rules)).toHaveLength(expected ? 1 : 0);
    // Stored JSON and settings edits use the same canonical regex, with no hidden metadata.
    expect(resolveRegexTriggerMatches([userMessage(text)], JSON.stringify(result.rules)))
      .toHaveLength(expected ? 1 : 0);
    expect(resolveRegexTriggerMatches([userMessage('雪 夜')], result.rules)).toHaveLength(0);
  });

  it('retains regex delimiters and commas inside individual regex keys', () => {
    const result = parseWorldBookRegexTriggers(JSON.stringify([{ key: ['/a,b/i'], content: '正则设定' }]));
    expect(result.warnings).toEqual([]);
    expect(resolveRegexTriggerMatches([userMessage('A,B')], result.rules)).toHaveLength(1);
    expect(resolveRegexTriggerMatches([userMessage('a')], result.rules)).toHaveLength(0);
  });

  it('matches complete words without matching part of a longer word', () => {
    const result = parseWorldBookRegexTriggers(JSON.stringify([{ key: ['tree'], content: '整词设定', matchWholeWords: true }]));
    expect(resolveRegexTriggerMatches([userMessage('A TREE.')], result.rules)).toHaveLength(1);
    expect(resolveRegexTriggerMatches([userMessage('street trees')], result.rules)).toHaveLength(0);
  });

  it('reports unsupported activation semantics and invalid regex instead of broadening rules', () => {
    const result = parseWorldBookRegexTriggers(JSON.stringify({ entries: [
      { key: ['白树'], content: '分组', group: '地点' },
      { key: ['白树'], content: '冷却', cooldown: 2 },
      { key: ['白树'], content: '概率', useProbability: true, probability: 30 },
      { key: ['['], content: '错误正则', useRegex: true },
      { key: ['白树'], content: '正常' }
    ] }));
    expect(result.rules.map((rule) => rule.prompt)).toEqual(['正常']);
    expect(result.skippedCount).toBe(4);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings.join(' ')).toContain('概率触发');
  });

  it('does not turn generation-type metadata into extra activation keywords', () => {
    const imported = parseWorldBookRegexTriggers(JSON.stringify([{ key: ['白树'], triggers: ['normal'], content: '地点' }]));
    expect(resolveRegexTriggerMatches([userMessage('normal')], imported.rules)).toHaveLength(0);
    expect(resolveRegexTriggerMatches([userMessage('白树')], imported.rules)).toHaveLength(1);
  });

  it('retains external insertion order inside the context while keeping native priorities', () => {
    const imported = parseWorldBookRegexTriggers(JSON.stringify([{ constant: true, content: '先出现', order: 100 },
      { constant: true, content: '后出现', order: 250 }]));
    expect(resolveRegexTriggerMatches([], imported.rules).map((rule) => rule.prompt)).toEqual(['先出现', '后出现']);
  });

  it('counts entries independently of JSON formatting and text syntax', () => {
    const book = { entries: [{ key: ['白树'], content: '正常' }, { disabled: true }] };
    expect(parseWorldBookRegexTriggers(JSON.stringify(book)).skippedCount).toBe(1);
    expect(parseWorldBookRegexTriggers(JSON.stringify(book, null, 2)).skippedCount).toBe(1);
    const text = parseWorldBookRegexTriggers('白树 => 设定\n不能解析的行\n地点|另一条设定|i');
    expect(text.rules).toHaveLength(2);
    expect(text.skippedCount).toBe(1);
    expect(parseWorldBookRegexTriggers('{ damaged')).toMatchObject({ rules: [], warnings: ['JSON 格式损坏，未导入任何条目'] });
  });

  it('imports text world book lines with arrow separators', () => {
    expect(parseWorldBookRegexTriggers('白树, 拉梅兰 => 命中后带入这段设定。').rules).toEqual([
      {
        pattern: '白树|拉梅兰',
        prompt: '命中后带入这段设定。',
        flags: 'i'
      }
    ]);
  });
});

describe('resolveRegexTriggerMatches', () => {
  it('matches only the latest user message when scan depth is explicitly one', () => {
    const matches = resolveRegexTriggerMatches([
      userMessage('上一轮提到了白树'),
      { id: 'assistant-1', role: 'assistant', content: '继续。', timestamp: 2 },
      userMessage('这一轮说拉梅兰')
    ], [
      { pattern: '白树', prompt: '带入白树设定', scanDepth: 1 },
      { pattern: '拉梅兰', prompt: '带入拉梅兰设定', scanDepth: 1 }
    ]);

    expect(matches.map((match) => match.prompt)).toEqual(['带入拉梅兰设定']);
  });

  it('ignores invalid regular expressions instead of blocking the request', () => {
    const matches = resolveRegexTriggerMatches([userMessage('白树')], [
      { pattern: '[', prompt: '坏规则' },
      { pattern: '白树', prompt: '好规则' }
    ]);

    expect(matches.map((match) => match.prompt)).toEqual(['好规则']);
  });

  it('can scan recent user and assistant context like a world book entry', () => {
    const matches = resolveRegexTriggerMatches([
      userMessage('上一轮说白树'),
      { id: 'assistant-1', role: 'assistant', content: '我记得白树。', timestamp: 2 },
      userMessage('这一轮只说继续')
    ], [
      { pattern: '白树', prompt: '最新用户消息不会命中', scanDepth: 1 },
      { pattern: '白树', prompt: '最近上下文命中', scanDepth: 3 }
    ]);

    expect(matches.map((match) => match.prompt)).toEqual(['最近上下文命中']);
  });

  it('uses the same four-message default for stored rules without scan depth', () => {
    const messages = [
      userMessage('已经超出范围的旧设定'),
      { id: 'assistant-1', role: 'assistant' as const, content: '白树在这里。', timestamp: 2 },
      userMessage('继续走'),
      { id: 'assistant-2', role: 'assistant' as const, content: '往前走。', timestamp: 3 },
      userMessage('现在呢')
    ];
    const rules = JSON.stringify([
      { pattern: '白树', prompt: '带入白树设定' },
      { pattern: '旧设定', prompt: '不应进入请求' }
    ]);

    expect(resolveRegexTriggerMatches(messages, rules).map((rule) => rule.prompt))
      .toEqual(['带入白树设定']);
  });

  it('keeps always-on triggers and sorts by priority', () => {
    const matches = resolveRegexTriggerMatches([userMessage('白树')], [
      { pattern: '白树', prompt: '低优先级', priority: 1 },
      { pattern: '', prompt: '常驻高优先级', alwaysOn: true, priority: 5 }
    ]);

    expect(matches.map((match) => match.prompt)).toEqual(['常驻高优先级', '低优先级']);
  });
});

describe('buildRegexTriggerContext', () => {
  it('builds a prompt context without rewriting the user text', () => {
    const context = buildRegexTriggerContext([userMessage('白树落下来了')], [
      { pattern: '白树', prompt: '带入白树设定' }
    ]);

    expect(context).toContain('[协作者世界书]');
    expect(context).toContain('不需要用户再次要求读取');
    expect(context).toContain('不是用户新发的消息');
    expect(context).toContain('不要改写用户原文');
    expect(context).toContain('/白树/：带入白树设定');
  });

  it('resolves user and character macros in keywords and contents for the current request', () => {
    const rules = parseWorldBookRegexTriggers(JSON.stringify([{ keys: ['{{char}}'], content: '{{char}} 与 {{user}} 的设定' }])).rules;
    const templateContext = buildTemplateContext({ modelId: 'test', assistantName: 'A.B', nickname: 'AA' });
    expect(buildRegexTriggerContext([userMessage('A.B 来了')], rules, templateContext)).toContain('A.B 与 AA 的设定');
    expect(buildRegexTriggerContext([userMessage('AxB 来了')], rules, templateContext)).toBe('');
    expect(rules[0].prompt).toBe('{{char}} 与 {{user}} 的设定');
  });

  it('describes always-on world book entries without requiring a pattern', () => {
    const context = buildRegexTriggerContext([userMessage('普通消息')], [
      { pattern: '', prompt: '常驻世界规则', alwaysOn: true }
    ]);

    expect(context).toContain('常驻世界规则');
  });
});
