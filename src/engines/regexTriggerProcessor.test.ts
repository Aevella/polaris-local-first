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

  it('imports world book scan depth, priority, and always-on settings', () => {
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
  it('matches only the latest user message', () => {
    const matches = resolveRegexTriggerMatches([
      userMessage('上一轮提到了白树'),
      { id: 'assistant-1', role: 'assistant', content: '继续。', timestamp: 2 },
      userMessage('这一轮说拉梅兰')
    ], [
      { pattern: '白树', prompt: '带入白树设定' },
      { pattern: '拉梅兰', prompt: '带入拉梅兰设定' }
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

  it('can scan recent user and assistant context', () => {
    const matches = resolveRegexTriggerMatches([
      userMessage('上一轮说白树'),
      { id: 'assistant-1', role: 'assistant', content: '我记得白树。', timestamp: 2 },
      userMessage('这一轮只说继续')
    ], [
      { pattern: '白树', prompt: '最新用户消息不会命中' },
      { pattern: '白树', prompt: '最近上下文命中', scanDepth: 3 }
    ]);

    expect(matches.map((match) => match.prompt)).toEqual(['最近上下文命中']);
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

    expect(context).toContain('[正则触发]');
    expect(context).toContain('不要改写用户原文');
    expect(context).toContain('/白树/：带入白树设定');
  });

  it('describes always-on world book entries without requiring a pattern', () => {
    const context = buildRegexTriggerContext([userMessage('普通消息')], [
      { pattern: '', prompt: '常驻世界规则', alwaysOn: true }
    ]);

    expect(context).toContain('常驻世界规则');
  });
});
