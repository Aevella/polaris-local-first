import { describe, expect, it } from 'vitest';
import {
  buildAssistantMessagePatch,
  normalizeChatMessage,
  normalizeChatNativeToolCalls
} from './chatMessageNormalization';

describe('chatMessageNormalization', () => {
  it('normalizes native tool calls into stable ids and strips blank names', () => {
    expect(normalizeChatNativeToolCalls('assistant-1', [
      {
        name: '  runCode  ',
        argumentsText: '{"code":"return 1;"}'
      },
      {
        name: '   ',
        argumentsText: '{}'
      }
    ])).toEqual([
      {
        id: 'assistant-1:tool-call:1',
        name: 'runCode',
        argumentsText: '{"code":"return 1;"}',
        sourceSpan: {
          transport: 'native',
          index: 0
        }
      }
    ]);
  });

  it('normalizes persisted assistant messages through the same helper', () => {
    expect(normalizeChatMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: 'pong',
      timestamp: 1,
      thinkingText: '   ',
      nativeToolCalls: [
        {
          name: 'createQrCode',
          argumentsText: '{"text":"https://polaris.example.com"}'
        }
      ]
    })).toEqual({
      id: 'assistant-2',
      role: 'assistant',
      content: 'pong',
      timestamp: 1,
      thinkingText: undefined,
      assistantReplyId: undefined,
      assistantReplySegmentIndex: undefined,
      nativeToolCalls: [
        {
          id: 'assistant-2:tool-call:1',
          name: 'createQrCode',
          argumentsText: '{"text":"https://polaris.example.com"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }
      ]
    });
  });

  it('builds the same assistant message patch shape for streaming and final writes', () => {
    expect(buildAssistantMessagePatch({
      messageId: 'assistant-3',
      assistantName: 'Pharos',
      visibleContent: '整理好了。',
      reply: {
        model: 'mimo-v2-pro',
        tokenCount: 128,
        thinkingText: '先看约束。'
      },
      nativeToolCalls: [
        {
          id: 'call-1',
          name: 'runCode',
          argumentsText: '{"code":"return 3;"}'
        }
      ]
    })).toEqual({
      content: '整理好了。',
      model: 'mimo-v2-pro',
      tokenCount: 128,
      assistantName: 'Pharos',
      thinkingText: '先看约束。',
      nativeToolCalls: [
        {
          id: 'call-1',
          name: 'runCode',
          argumentsText: '{"code":"return 3;"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }
      ]
    });
  });

  it('keeps only replayable provider reasoning fields in persisted messages', () => {
    expect(normalizeChatMessage({
      id: 'assistant-reasoning',
      role: 'assistant',
      content: 'done',
      timestamp: 1,
      providerReasoning: {
        protocol: 'openai-completions',
        items: [{
          type: 'reasoning.text',
          index: 0,
          text: '先检查。',
          signature: 'sig-a'
        }]
      }
    }).providerReasoning).toEqual({
      protocol: 'openai-completions',
      items: [{
        type: 'reasoning.text',
        index: 0,
        text: '先检查。',
        signature: 'sig-a'
      }]
    });
  });

  it('keeps valid assistant reply segment ownership and drops invalid partial metadata', () => {
    expect(normalizeChatMessage({
      id: 'assistant-segment',
      role: 'assistant',
      content: '第二条。',
      timestamp: 2,
      assistantReplyId: ' assistant-anchor ',
      assistantReplySegmentIndex: 1
    })).toEqual(expect.objectContaining({
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 1
    }));

    expect(normalizeChatMessage({
      id: 'user-invalid-segment',
      role: 'user',
      content: '问题',
      timestamp: 3,
      assistantReplyId: 'assistant-anchor',
      assistantReplySegmentIndex: 0
    })).toEqual(expect.objectContaining({
      assistantReplyId: undefined,
      assistantReplySegmentIndex: undefined
    }));
  });
});
