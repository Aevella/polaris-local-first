import { describe, expect, it } from 'vitest';
import { createStreamingReplyCollector } from './chatApiStreamingCollector';

describe('chatApiStreamingCollector', () => {
  it('surfaces provider error JSON instead of reporting an empty API response', () => {
    const collector = createStreamingReplyCollector('test-model');

    expect(() => collector.pushTextChunk(
      JSON.stringify({
        error: {
          message: 'Invalid model. Please select a different model to continue.',
          reason: 'INVALID_MODEL_ID'
        }
      }) + '\n',
      false
    )).toThrow('Invalid model. Please select a different model to continue.');
  });

  it('keeps non-JSON provider error text visible when no reply content arrived', () => {
    const collector = createStreamingReplyCollector('test-model');

    collector.pushTextChunk(
      'status_code=500, HTTP 400 from AmazonQ: {"message":"Invalid model.","reason":"INVALID_MODEL_ID"}',
      false
    );

    expect(() => collector.finish()).toThrow(/^status_code=500, HTTP 400 from AmazonQ/);
  });

  it('does not treat normal Responses stream event types as provider errors', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.output_text.delta',
        delta: '正常回复。'
      }) + '\n',
      false
    );

    expect(collector.finish().content).toBe('正常回复。');
  });

  it('surfaces native tool call drafts while streaming', () => {
    const progress: Array<{ content: string; nativeToolCalls: number }> = [];
    const collector = createStreamingReplyCollector('test-model', (reply) => {
      progress.push({
        content: reply.content,
        nativeToolCalls: reply.nativeToolCalls?.length ?? 0
      });
    });

    collector.pushTextChunk(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"patchRawCss","arguments":"{\\"css\\":\\".app-shell.chat .bubble.user { background: pink; }\\""}}]}}]}\n',
      false
    );

    const latest = progress[progress.length - 1] ?? { content: '', nativeToolCalls: 0 };
    expect(latest.content).toBe('');
    expect(latest.nativeToolCalls).toBe(1);
  });

  it('closes tool drafts into a real tool block at finish', () => {
    const collector = createStreamingReplyCollector('test-model');

    collector.pushTextChunk(
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"patchRawCss","arguments":"{\\"css\\":\\".app-shell.chat .bubble.user { background: pink; }\\"}"}}]}}]}\n',
      false
    );

    const reply = collector.finish();
    expect(reply.content).toBe('');
    expect(reply.nativeToolCalls).toEqual([{
      id: undefined,
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat .bubble.user { background: pink; }"}'
    }]);
  });

  it('falls back to responses-style payloads at finish', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      JSON.stringify({
        model: 'openai/gpt-5.4-20260305',
        usage: {
          input_tokens: 10,
          output_tokens: 5
        },
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '好了。' }]
          },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: '{"css":".app-shell.chat { background: black; }"}'
        }
        ]
      }),
      false
    );

    const reply = collector.finish();
    expect(reply.model).toBe('openai/gpt-5.4-20260305');
    expect(reply.tokenCount).toBe(15);
    expect(reply.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5
    });
    expect(reply.content).toBe('好了。');
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat { background: black; }"}'
    }]);
  });

  it('streams responses-style semantic events', () => {
    const progress: Array<{ content: string; nativeToolCalls: number }> = [];
    const collector = createStreamingReplyCollector('fallback-model', (reply) => {
      progress.push({
        content: reply.content,
        nativeToolCalls: reply.nativeToolCalls?.length ?? 0
      });
    });

    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: ''
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: 'call_1',
        delta: '{"css":".app-shell.chat { background: black; }"}'
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.output_text.delta',
        delta: '好了。'
      }) + '\n',
      false
    );

    const latest = progress[progress.length - 1] ?? { content: '', nativeToolCalls: 0 };
    expect(latest.content).toBe('好了。');
    expect(latest.nativeToolCalls).toBe(1);

    const reply = collector.finish();
    expect(reply.content).toBe('好了。');
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat { background: black; }"}'
    }]);
  });

  it('accepts responses output_item.done events for streamed function calls', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: '{"css":".app-shell.chat { background: black; }"}'
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.completed',
        response: {
          model: 'openai/gpt-5.4-20260305',
          output: []
        }
      }) + '\n',
      false
    );

    const reply = collector.finish();
    expect(reply.finishReason).toBe('stop');
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat { background: black; }"}'
    }]);
  });

  it('keeps full response.completed output when no earlier response deltas arrived', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      'data: ' + JSON.stringify({
        type: 'response.completed',
        response: {
          model: 'openai/gpt-5.4-20260305',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '补全正文。' }]
            },
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'patchRawCss',
              arguments: '{"css":".app-shell.chat { color: red; }"}'
            }
          ],
          usage: {
            input_tokens: 8,
            output_tokens: 3
          }
        }
      }) + '\n\n',
      true
    );

    const reply = collector.finish();
    expect(reply.model).toBe('openai/gpt-5.4-20260305');
    expect(reply.content).toBe('补全正文。');
    expect(reply.tokenUsage).toEqual({
      inputTokens: 8,
      outputTokens: 3
    });
    expect(reply.finishReason).toBe('stop');
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat { color: red; }"}'
    }]);
  });

  it('treats response.completed output as a final snapshot instead of duplicating prior deltas', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      'data: ' + JSON.stringify({
        type: 'response.output_text.delta',
        delta: '补全'
      }) + '\n\n',
      true
    );
    collector.pushTextChunk(
      'data: ' + JSON.stringify({
        type: 'response.output_text.delta',
        delta: '正文。'
      }) + '\n\n',
      true
    );
    collector.pushTextChunk(
      'data: ' + JSON.stringify({
        type: 'response.completed',
        response: {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: '补全正文。' }]
          }]
        }
      }) + '\n\n',
      true
    );

    expect(collector.finish().content).toBe('补全正文。');
  });

  it('does not prepend {} when responses tool streaming starts from an empty object', () => {
    const collector = createStreamingReplyCollector('fallback-model');

    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call_memory_1',
          name: 'writeMemory',
          arguments: {}
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: 'call_memory_1',
        delta: '{"memory":["记住这句"]}'
      }) + '\n',
      false
    );

    const reply = collector.finish();
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_memory_1',
      name: 'writeMemory',
      argumentsText: '{"memory":["记住这句"]}'
    }]);
  });

  it('does not prepend {} when anthropic tool streaming starts from an empty input object', () => {
    const collector = createStreamingReplyCollector('claude-opus-4-6');

    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'readCodeCard',
          input: {}
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_delta',
        delta: {
          type: 'input_json_delta',
          partial_json: '{"target":"card-1","targetLabel":"top_p 配置卡 1"}'
        }
      }) + '\n',
      false
    );

    const reply = collector.finish();
    expect(reply.nativeToolCalls).toEqual([{
      id: 'toolu_1',
      name: 'readCodeCard',
      argumentsText: '{"target":"card-1","targetLabel":"top_p 配置卡 1"}'
    }]);
  });

  it('collects structured OpenRouter reasoning and native Anthropic signatures for replay', () => {
    const openRouterCollector = createStreamingReplyCollector('anthropic/claude-sonnet-4.6');
    openRouterCollector.pushTextChunk(JSON.stringify({
      choices: [{
        delta: {
          reasoning_details: [{
            type: 'reasoning.text',
            text: '先检查',
            signature: 'sig-openrouter-a',
            index: 0
          }]
        }
      }]
    }) + '\n', false);
    openRouterCollector.pushTextChunk(JSON.stringify({
      choices: [{
        delta: {
          reasoning_details: [{
            type: 'reasoning.text',
            text: '约束。',
            index: 0
          }],
          content: '结论。'
        }
      }]
    }) + '\n', false);

    const openRouterReply = openRouterCollector.finish();
    expect(openRouterReply.thinkingText).toBe('先检查约束。');
    expect(openRouterReply.providerReasoning).toEqual({
      protocol: 'openai-completions',
      items: [{
        type: 'reasoning.text',
        text: '先检查约束。',
        signature: 'sig-openrouter-a',
        index: 0
      }]
    });

    const anthropicCollector = createStreamingReplyCollector('claude-sonnet-4-6');
    anthropicCollector.pushTextChunk(JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: '先检查。' }
    }) + '\n', false);
    anthropicCollector.pushTextChunk(JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig-anthropic-a' }
    }) + '\n', false);

    expect(anthropicCollector.finish().providerReasoning).toEqual({
      protocol: 'anthropic-messages',
      items: [{
        type: 'thinking',
        thinking: '先检查。',
        signature: 'sig-anthropic-a',
        index: 0
      }]
    });
  });

  it('treats repeated OpenAI-compatible argument snapshots as replacements instead of concatenating JSON objects', () => {
    const collector = createStreamingReplyCollector('test-model');

    collector.pushTextChunk(
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_read_1',
              function: {
                name: 'readMemoryDoc',
                arguments: '{"docId":"memory-doc-1"'
              }
            }]
          }
        }]
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_read_1',
              function: {
                arguments: '{"docId":"memory-doc-1","targetLabel":"Monday 好爱"}'
              }
            }]
          }
        }]
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_read_1',
              function: {
                arguments: '{"docId":"memory-doc-1","targetLabel":"Monday 好爱，我也是"}'
              }
            }]
          }
        }]
      }) + '\n',
      false
    );

    expect(collector.finish().nativeToolCalls).toEqual([{
      id: 'call_read_1',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1","targetLabel":"Monday 好爱，我也是"}'
    }]);
  });

  it('routes Anthropic tool argument deltas by content block index', () => {
    const collector = createStreamingReplyCollector('claude-opus-4-6');

    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_read_project',
          name: 'readProjectFile',
          input: {}
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_read_memory',
          name: 'readMemoryDoc',
          input: {}
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"target":"active"}'
        }
      }) + '\n',
      false
    );
    collector.pushTextChunk(
      JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"docId":"memory-doc-1","targetLabel":"长期资料"}'
        }
      }) + '\n',
      false
    );

    expect(collector.finish().nativeToolCalls).toEqual([
      {
        id: 'toolu_read_project',
        name: 'readProjectFile',
        argumentsText: '{"target":"active"}'
      },
      {
        id: 'toolu_read_memory',
        name: 'readMemoryDoc',
        argumentsText: '{"docId":"memory-doc-1","targetLabel":"长期资料"}'
      }
    ]);
  });

  it('marks event streams that close without a terminal signal as length-truncated', () => {
    const collector = createStreamingReplyCollector('test-model');

    collector.pushTextChunk(
      'data: {"choices":[{"delta":{"content":"写到一半"}}]}\n\n',
      true
    );

    const reply = collector.finish();
    expect(reply.content).toBe('写到一半');
    expect(reply.finishReason).toBe('length');
    expect(reply.transportIncomplete).toBe(true);
  });

  it('recognizes SSE data lines even when the response content type is wrong', () => {
    const progress: string[] = [];
    const collector = createStreamingReplyCollector('test-model', (reply) => {
      progress.push(reply.content);
    });

    collector.pushTextChunk(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      false
    );
    collector.pushTextChunk(
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      false
    );

    expect(progress).toEqual(['你', '你好']);
    expect(collector.finish().content).toBe('你好');
  });

  it('does not mark anthropic message_stop streams as truncated', () => {
    const collector = createStreamingReplyCollector('claude-opus-4-6');

    collector.pushTextChunk(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好了"}}\n\n',
      true
    );
    collector.pushTextChunk(
      'data: {"type":"message_stop"}\n\n',
      true
    );

    const reply = collector.finish();
    expect(reply.content).toBe('好了');
    expect(reply.finishReason).toBe('stop');
  });
});
