import { describe, it, expect } from 'vitest';
import { buildProviderRuntimeRequest } from './providerRuntimeRequest';
import { createProviderRuntimeAdvanced, createProviderRuntimeTestContext, createProviderRuntimeTestProvider } from './providerRuntimeFixtures';
import { parseOpenAiResponsesStreamEvents } from './providerRuntimeStreamEvents';
import { applyProviderRuntimeStreamEvents } from '../chat-api/chatApiCanonicalStreamAccumulator';
import type { ReplyAccumulator } from './providerRuntimeReplyAccumulator';
import { inferProviderProtocol } from '../providerProtocol';

describe('Responses tool round trip', () => {
  it('routes official new GPT models and explicit relay paths without changing other relays', () => {
    const api = createProviderRuntimeTestProvider({ model: 'gpt-6-astra', capabilities: { images: true, streaming: true, thinking: true } });
    const request = buildProviderRuntimeRequest({ api, context: createProviderRuntimeTestContext({ withToolHistory: true }), advanced: createProviderRuntimeAdvanced({ thinkingBudget: '8192' }) });
    expect(request.endpoint).toBe('https://api.openai.com/v1/responses');
    expect(request.body.reasoning).toEqual({ effort: 'high' });
    expect(request.body.temperature).toBeUndefined();
    expect(request.body.messages).toBeUndefined();
    expect(request.body.store).toBe(false);
    const items = request.body.input as Record<string, unknown>[];
    const call = items.find(item => item.type === 'function_call');
    const result = items.find(item => item.type === 'function_call_output');
    expect(call).toBeDefined();
    expect(result?.call_id).toBe(call?.call_id);
    expect(inferProviderProtocol({ ...api, baseUrl: 'https://relay.example/v1' })).toBe('openai-completions');
    expect(inferProviderProtocol({ ...api, baseUrl: 'https://relay.example/v1', path: '/v1/responses?route=x' })).toBe('openai-responses');
  });

  it('normalizes custom chat aliases while keeping relay sampling and explicit off', () => {
    const api = createProviderRuntimeTestProvider({ protocol: 'openai-responses', path: '/responses',
      baseUrl: 'https://relay.example/v1', capabilities: { images: true, streaming: true, thinking: true } });
    const request = buildProviderRuntimeRequest({ api, context: createProviderRuntimeTestContext(),
      advanced: createProviderRuntimeAdvanced({ customBody: JSON.stringify({ reasoning_effort: 'high', max_tokens: 300,
        response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object' } } } }) }) });
    expect(request.body.reasoning).toEqual({ effort: 'high' });
    expect(request.body.reasoning_effort).toBeUndefined();
    expect(request.body.max_output_tokens).toBe(300);
    expect(request.body.temperature).toBe(0.7);
    expect(request.body.text).toEqual({ format: { type: 'json_schema', name: 'answer', schema: { type: 'object' } } });
    const off = buildProviderRuntimeRequest({ api, context: createProviderRuntimeTestContext(), advanced: createProviderRuntimeAdvanced({ customBody: JSON.stringify({ reasoning: { effort: 'none' } }) }) });
    expect(off.body.reasoning).toEqual({ effort: 'none' });
  });

  it('keeps parallel tool call ids distinct from output item ids and retains encrypted reasoning', () => {
    const target: ReplyAccumulator = { content: '', thinkingText: '' };
    const payloads = [
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'one' } },
      { type: 'response.output_item.added', output_index: 2, item: { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'two' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'fc_a', delta: '{"a":1}' },
      { type: 'response.function_call_arguments.delta', output_index: 2, item_id: 'fc_b', delta: '{}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'one', arguments: '{"a":1}' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_a', encrypted_content: 'opaque', summary: [] } }
    ];
    payloads.forEach(payload => applyProviderRuntimeStreamEvents(target, parseOpenAiResponsesStreamEvents(payload)));
    expect(target.toolCalls?.map(call => call.id)).toEqual(['call_a', 'call_b']);
    expect(target.toolCalls?.[0].argumentsText).toBe('{"a":1}');
    expect(target.providerReasoning?.items[0].encrypted_content).toBe('opaque');
    expect(parseOpenAiResponsesStreamEvents({ type: 'response.failed', response: { error: { message: 'rejected' } } })).toEqual([expect.objectContaining({ type: 'error' })]);
  });
});
