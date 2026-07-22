import { describe, expect, it } from 'vitest';
import { extractAnthropicReply, extractOpenAiCompatibleReply } from './providerRuntimeResponsePayload';

describe('extractOpenAiCompatibleReply', () => {
  it('surfaces OpenAI-compatible provider error payloads before empty response handling', () => {
    expect(() => extractOpenAiCompatibleReply({
      error: {
        message: 'Invalid model. Please select a different model to continue.',
        code: 'INVALID_MODEL_ID'
      }
    }, 'fallback-model')).toThrow('Invalid model. Please select a different model to continue.');
  });

  it('parses standard chat completions payloads', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'openai/gpt-5.4',
      usage: {
        prompt_tokens: 30,
        completion_tokens: 12,
        total_tokens: 42,
        prompt_tokens_details: {
          cached_tokens: 20
        }
      },
      choices: [{
        message: {
          content: '你好。'
        }
      }]
    }, 'fallback-model');

    expect(reply.content).toBe('你好。');
    expect(reply.model).toBe('openai/gpt-5.4');
    expect(reply.tokenCount).toBe(42);
    expect(reply.tokenUsage).toEqual({
      totalTokens: 42,
      inputTokens: 30,
      outputTokens: 12,
      cachedInputTokens: 20,
      cacheMissInputTokens: 10
    });
  });

  it('parses explicit OpenAI-compatible prompt cache hit and miss fields', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'deepseek-v4-flash',
      usage: {
        prompt_tokens: 351,
        completion_tokens: 74,
        total_tokens: 425,
        prompt_cache_hit_tokens: 256,
        prompt_cache_miss_tokens: 95
      },
      choices: [{
        message: {
          content: 'ok'
        }
      }]
    }, 'fallback-model');

    expect(reply.tokenUsage).toEqual({
      totalTokens: 425,
      inputTokens: 351,
      outputTokens: 74,
      cachedInputTokens: 256,
      cacheMissInputTokens: 95
    });
  });

  it('parses Anthropic-style cache usage fields returned by OpenAI-compatible aggregators', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'anthropic/claude-4.6-sonnet-20260217',
      usage: {
        input_tokens: 1000,
        output_tokens: 40,
        cache_read_input_tokens: 700,
        cache_creation_input_tokens: 300,
        cache_miss_input_tokens: 300
      },
      choices: [{
        message: {
          content: 'ok'
        }
      }]
    }, 'fallback-model');

    expect(reply.tokenUsage).toEqual({
      inputTokens: 1000,
      outputTokens: 40,
      cachedInputTokens: 700,
      cacheMissInputTokens: 300,
      cacheCreationInputTokens: 300
    });
  });

  it('reads OpenAI-compatible usage from the first choice when providers put stream usage there', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'kimi-k2.6',
      choices: [{
        usage: {
          prompt_tokens: 30,
          completion_tokens: 12,
          total_tokens: 42,
          prompt_tokens_details: {
            cached_tokens: 20
          }
        },
        message: {
          content: 'ok'
        }
      }]
    }, 'fallback-model');

    expect(reply.tokenCount).toBe(42);
    expect(reply.tokenUsage).toEqual({
      totalTokens: 42,
      inputTokens: 30,
      outputTokens: 12,
      cachedInputTokens: 20,
      cacheMissInputTokens: 10
    });
  });

  it('falls back to responses-style output payloads', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'openai/gpt-5.4-20260305',
      usage: {
        input_tokens: 100,
        output_tokens: 24
      },
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '先想一下。' }]
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: '真的改好了。' }]
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: '{"css":".app-shell.chat { background: black; }"}'
        }
      ]
    }, 'fallback-model');

    expect(reply.content).toBe('真的改好了。');
    expect(reply.model).toBe('openai/gpt-5.4-20260305');
    expect(reply.tokenCount).toBe(124);
    expect(reply.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 24
    });
    expect(reply.thinkingText).toBe('先想一下。');
    expect(reply.usedNativeToolCalls).toBe(true);
    expect(reply.nativeToolCallCount).toBe(1);
    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":".app-shell.chat { background: black; }"}'
    }]);
  });

  it('parses Gemini thought signatures from OpenAI-compatible tool calls', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'google/gemini-3.1-pro-preview',
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            extra_content: {
              google: {
                thought_signature: 'sig-openai-a'
              }
            },
            function: {
              name: 'patchRawCss',
              arguments: '{"css":"body { color: red; }"}'
            }
          }]
        }
      }]
    }, 'fallback-model');

    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":"body { color: red; }"}',
      providerMetadata: {
        geminiThoughtSignature: 'sig-openai-a'
      }
    }]);
  });

  it('prefers full reasoning content over abbreviated reasoning summary', () => {
    const reply = extractOpenAiCompatibleReply({
      model: 'openai/gpt-5.4-20260305',
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: '先想一下。' }],
          content: [{ type: 'reasoning_text', text: '先想一下，再把约束拆开，最后决定怎么回答。' }]
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: '真的改好了。' }]
        }
      ]
    }, 'fallback-model');

    expect(reply.thinkingText).toBe('先想一下，再把约束拆开，最后决定怎么回答。');
  });

  it('does not prefix empty function-call objects before streamed responses arguments', () => {
    const reply = extractOpenAiCompatibleReply({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        call_id: 'call_1',
        name: 'writeMemory',
        arguments: {}
      }
    }, 'fallback-model');

    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'writeMemory',
      argumentsText: ''
    }]);
  });

  it('merges repeated responses function-call items by id instead of duplicating them', () => {
    const reply = extractOpenAiCompatibleReply({
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: {}
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'patchRawCss',
          arguments: '{"css":"body { color: red; }"}'
        }
      ]
    }, 'fallback-model');

    expect(reply.nativeToolCalls).toEqual([{
      id: 'call_1',
      name: 'patchRawCss',
      argumentsText: '{"css":"body { color: red; }"}'
    }]);
  });
});

describe('extractAnthropicReply', () => {
  it('surfaces Anthropic-style error payloads before empty response handling', () => {
    expect(() => extractAnthropicReply({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'model: invalid-model is not a valid model ID'
      }
    }, 'fallback-model')).toThrow('model: invalid-model is not a valid model ID');
  });
});
