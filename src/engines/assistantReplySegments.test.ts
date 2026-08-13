import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/domain';
import {
  buildAssistantReplySegmentContent,
  collapseAssistantReplySegmentsForRequest,
  splitAssistantReplySegments
} from './assistantReplySegments';

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    role: 'assistant',
    timestamp: 1,
    ...overrides
  };
}

describe('splitAssistantReplySegments', () => {
  it('turns ordinary prose line breaks into message boundaries', () => {
    expect(splitAssistantReplySegments([
      '第一条。',
      '第二条。'
    ].join('\n'))).toEqual(['第一条。', '第二条。']);
  });

  it('keeps fenced code together while prose around it becomes separate messages', () => {
    const content = [
      '先看这里。',
      '```html',
      '<main>',
      '  <p>完整代码</p>',
      '</main>',
      '```',
      '然后继续。'
    ].join('\n');
    expect(splitAssistantReplySegments(content)).toEqual([
      '先看这里。',
      ['```html', '<main>', '  <p>完整代码</p>', '</main>', '```'].join('\n'),
      '然后继续。'
    ]);
  });

  it('keeps consecutive list and table lines in their own complete blocks', () => {
    expect(splitAssistantReplySegments([
      '说明：',
      '- 第一项',
      '- 第二项',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| Polaris | 完成 |'
    ].join('\n'))).toEqual([
      '说明：',
      ['- 第一项', '- 第二项'].join('\n'),
      ['| 名称 | 状态 |', '| --- | --- |', '| Polaris | 完成 |'].join('\n')
    ]);
  });

  it('does not create empty messages from repeated blank lines', () => {
    expect(splitAssistantReplySegments('第一条。\n\n\n第二条。')).toEqual(['第一条。', '第二条。']);
  });
});

describe('assistant reply segment projection', () => {
  const messages: ChatMessage[] = [
    message({
      id: 'assistant-prefix',
      content: '第一条。',
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 0
    }),
    message({
      id: 'assistant-anchor',
      content: '第二条。',
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 1,
      nativeToolCalls: [{ id: 'call-1', name: 'web_search', argumentsText: '{}' }]
    }),
    message({
      id: 'tool-1',
      role: 'system',
      content: '工具完成',
      origin: 'tool-runtime',
      toolInvocation: {
        id: 'tool-1',
        kind: 'webSearch',
        status: 'executed',
        title: '联网搜索',
        summary: '工具完成',
        originMessageId: 'assistant-anchor'
      }
    })
  ];

  it('rebuilds the complete visible reply for message actions', () => {
    expect(buildAssistantReplySegmentContent(messages, 'assistant-anchor')).toBe('第一条。\n\n第二条。');
  });

  it('collapses persisted bubbles back into one provider assistant turn', () => {
    const collapsed = collapseAssistantReplySegmentsForRequest(messages);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toEqual(expect.objectContaining({
      id: 'assistant-anchor',
      content: '第一条。\n\n第二条。',
      nativeToolCalls: [expect.objectContaining({ id: 'call-1' })]
    }));
    expect(collapsed[1]?.id).toBe('tool-1');
  });
});
