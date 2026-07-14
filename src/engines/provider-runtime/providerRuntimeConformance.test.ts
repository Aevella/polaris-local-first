import { describe, expect, it } from 'vitest';
import { buildApiRequest } from '../chat-api/chatApiRequestBuilder';
import {
  canonicalToolCallFromStreamEvents,
  parseProviderRuntimeStreamEvents,
  providerRuntimeRequestAdapters,
  resolveCanonicalProviderCapabilities,
  resolveProviderRuntimeRequestAdapter
} from './index';
import {
  createProviderRuntimeAdvanced,
  createProviderRuntimeCharacterizationFixtures,
  createProviderRuntimeTestProvider
} from './providerRuntimeFixtures';
import { buildProviderRuntimeRequest } from './providerRuntimeRequest';

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasOutputTokenField(body: Record<string, unknown>, field: string | null) {
  if (!field) return false;
  if (field === 'max_output_tokens') {
    const generationConfig = readObject(body.generationConfig);
    return typeof body.max_output_tokens === 'number' || typeof generationConfig.maxOutputTokens === 'number';
  }
  return typeof body[field] === 'number';
}

describe('provider runtime characterization fixtures', () => {
  it('routes provider requests through registered adapters', () => {
    expect(providerRuntimeRequestAdapters.map((adapter) => adapter.id)).toEqual([
      'anthropic-messages',
      'openai-responses',
      'gemini-generate-content',
      'openai-compatible-chat'
    ]);

    const expectedAdapters: Record<string, string> = {
      'openai-compatible-native-tools': 'openai-compatible-chat',
      'anthropic-messages-native-tools': 'anthropic-messages',
      'gemini-native-generate-content': 'gemini-generate-content',
      'openai-responses-transcript-history': 'openai-responses',
      'mimo-openai-compatible-token-field': 'openai-compatible-chat'
    };

    for (const fixture of createProviderRuntimeCharacterizationFixtures()) {
      const adapter = resolveProviderRuntimeRequestAdapter(fixture.provider);
      expect(adapter.id, fixture.id).toBe(expectedAdapters[fixture.id]);
    }
  });

  it('lock current request protocol and streaming expectations', () => {
    for (const fixture of createProviderRuntimeCharacterizationFixtures()) {
      const request = buildProviderRuntimeRequest({
        api: fixture.provider,
        context: fixture.context,
        advanced: fixture.advanced
      });

      expect(request.provider, fixture.id).toBe(fixture.expected.protocol);
      expect(Boolean(request.body.stream), fixture.id).toBe(fixture.expected.stream);
      expect(hasOutputTokenField(request.body, fixture.expected.outputTokenField), fixture.id).toBe(true);
    }
  });

  it('keeps the chatApi request facade delegated to the canonical provider runtime entry', () => {
    for (const fixture of createProviderRuntimeCharacterizationFixtures()) {
      const runtimeRequest = buildProviderRuntimeRequest({
        api: fixture.provider,
        context: fixture.context,
        advanced: fixture.advanced
      });
      const facadeRequest = buildApiRequest({
        api: fixture.provider,
        context: fixture.context,
        advanced: fixture.advanced
      });

      expect(facadeRequest, fixture.id).toEqual(runtimeRequest);
    }
  });

  it('declares canonical capabilities separately from provider-specific request bodies', () => {
    const matrix = Object.fromEntries(
      createProviderRuntimeCharacterizationFixtures().map((fixture) => [
        fixture.id,
        resolveCanonicalProviderCapabilities(fixture.provider, fixture.advanced)
      ])
    );

    expect(matrix['openai-compatible-native-tools']).toEqual(expect.objectContaining({
      input: expect.objectContaining({ images: 'data-url' }),
      output: expect.objectContaining({ nativeToolCalls: true, reasoning: 'none' }),
      tools: expect.objectContaining({
        mode: 'native',
        historyMode: 'native-with-transcript-fallback',
        promptProtocol: 'native-first',
        choiceControl: 'required',
        requiredChoice: true
      }),
      budgets: expect.objectContaining({ outputTokenField: 'max_tokens', promptBudgetPolicy: 'enforced' })
    }));
    expect(matrix['anthropic-messages-native-tools']).toEqual(expect.objectContaining({
      output: expect.objectContaining({ nativeToolCalls: true, reasoning: 'text' }),
      cache: { mode: 'explicit-cache-control', promptCaching: true },
      budgets: expect.objectContaining({ outputTokenField: 'max_tokens', reasoningBudget: true })
    }));
    expect(matrix['gemini-native-generate-content']).toEqual(expect.objectContaining({
      input: expect.objectContaining({ images: 'model-dependent' }),
      output: expect.objectContaining({ reasoning: 'signature-required' }),
      budgets: expect.objectContaining({ outputTokenField: 'max_output_tokens' })
    }));
    expect(matrix['openai-responses-transcript-history']).toEqual(expect.objectContaining({
      output: expect.objectContaining({ nativeToolCalls: false, reasoning: 'summary' }),
      tools: expect.objectContaining({
        mode: 'transcript',
        historyMode: 'transcript',
        promptProtocol: 'native-first',
        choiceControl: 'required'
      }),
      budgets: expect.objectContaining({ outputTokenField: 'max_output_tokens' })
    }));
    expect(matrix['mimo-openai-compatible-token-field']).toEqual(expect.objectContaining({
      input: expect.objectContaining({ images: 'none' }),
      output: expect.objectContaining({ reasoning: 'none' }),
      cache: { mode: 'automatic-or-unknown', promptCaching: true },
      transport: expect.objectContaining({ modes: expect.arrayContaining(['direct']) }),
      budgets: expect.objectContaining({ outputTokenField: 'max_completion_tokens', promptBudgetPolicy: 'advisory' })
    }));
  });

  it('keeps provider tool-choice support in canonical capabilities', () => {
    const deepSeek = resolveCanonicalProviderCapabilities(createProviderRuntimeTestProvider({
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
      capabilities: {
        images: false,
        streaming: true,
        thinking: true
      }
    }));

    expect(deepSeek.tools).toEqual(expect.objectContaining({
      mode: 'native',
      historyMode: 'native-with-transcript-fallback',
      promptProtocol: 'native-first',
      choiceControl: 'none',
      requiredChoice: false
    }));
  });

  it('keeps direct Mimo protocol quirks separate from configured image capability', () => {
    const mimoProvider = createProviderRuntimeTestProvider({
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2-pro',
      capabilities: {
        images: true,
        streaming: true,
        thinking: false
      }
    });
    expect(resolveCanonicalProviderCapabilities(
      mimoProvider,
      createProviderRuntimeAdvanced({ modelOverride: 'mimo-v2-omni' })
    ).input.images).toBe('data-url');
    expect(resolveCanonicalProviderCapabilities(
      mimoProvider,
      createProviderRuntimeAdvanced({ modelOverride: 'mimo-v2-pro' })
    ).input.images).toBe('data-url');
  });

  it('characterizes OpenAI-compatible native tool calls', () => {
    const fixture = createProviderRuntimeCharacterizationFixtures()
      .find((entry) => entry.id === 'openai-compatible-native-tools');
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const request = buildProviderRuntimeRequest({
      api: fixture.provider,
      context: fixture.context,
      advanced: fixture.advanced
    });
    const tools = readArray(request.body.tools);

    expect(request.body.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user' })
    ]));
    expect(tools[0]).toEqual(expect.objectContaining({
      type: 'function',
      function: expect.objectContaining({ name: 'patchRawCss' })
    }));
    expect(request.body.tool_choice).toBe('required');
    expect(request.body.max_tokens).toBe(128);
  });

  it('characterizes Anthropic messages, tools, thinking, and cache shape', () => {
    const fixture = createProviderRuntimeCharacterizationFixtures()
      .find((entry) => entry.id === 'anthropic-messages-native-tools');
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const request = buildProviderRuntimeRequest({
      api: fixture.provider,
      context: fixture.context,
      advanced: fixture.advanced
    });
    const body = request.body;
    const system = readArray(body.system);
    const messages = readArray(body.messages);
    const tools = readArray(body.tools);

    expect(system[0]).toEqual(expect.objectContaining({
      type: 'text',
      cache_control: { type: 'ephemeral', ttl: '1h' }
    }));
    expect(messages.some((message) => readObject(message).role === 'assistant')).toBe(true);
    expect(messages.some((message) => readObject(message).role === 'user')).toBe(true);
    expect(tools[0]).toEqual(expect.objectContaining({
      name: 'patchRawCss',
      input_schema: expect.objectContaining({ type: 'object' })
    }));
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 64 });
  });

  it('characterizes Gemini native content, tools, and thinking config', () => {
    const fixture = createProviderRuntimeCharacterizationFixtures()
      .find((entry) => entry.id === 'gemini-native-generate-content');
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const request = buildProviderRuntimeRequest({
      api: fixture.provider,
      context: fixture.context,
      advanced: fixture.advanced
    });
    const body = request.body;
    const generationConfig = readObject(body.generationConfig);
    const contents = readArray(body.contents);
    const tools = readArray(body.tools);
    const firstTool = readObject(tools[0]);
    const declarations = readArray(firstTool.functionDeclarations);

    expect(request.endpoint).toContain('/models/gemini-2.5-flash:generateContent');
    expect(body.stream).toBeUndefined();
    expect(generationConfig.maxOutputTokens).toBe(96);
    expect(generationConfig.thinkingConfig).toEqual({ thinkingBudget: 32 });
    expect(contents[0]).toEqual(expect.objectContaining({ role: 'user' }));
    expect(declarations[0]).toEqual(expect.objectContaining({ name: 'patchRawCss' }));
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });

  it('characterizes Responses API transcript tool history', () => {
    const fixture = createProviderRuntimeCharacterizationFixtures()
      .find((entry) => entry.id === 'openai-responses-transcript-history');
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const request = buildProviderRuntimeRequest({
      api: fixture.provider,
      context: fixture.context,
      advanced: fixture.advanced
    });
    const input = readArray(request.body.input);
    const assistantEntry = input.find((entry) => readObject(entry).role === 'assistant');
    const assistantContent = readObject(assistantEntry).content;

    expect(request.body.max_output_tokens).toBe(144);
    expect(request.body.reasoning).toEqual({ effort: 'medium' });
    expect(String(assistantContent)).toContain('[assistant_tool_calls]');
    expect(readArray(request.body.tools)[0]).toEqual(expect.objectContaining({
      type: 'function',
      name: 'patchRawCss'
    }));
  });

  it('characterizes Mimo OpenAI-compatible output token field', () => {
    const fixture = createProviderRuntimeCharacterizationFixtures()
      .find((entry) => entry.id === 'mimo-openai-compatible-token-field');
    expect(fixture).toBeTruthy();
    if (!fixture) return;

    const request = buildProviderRuntimeRequest({
      api: fixture.provider,
      context: fixture.context,
      advanced: fixture.advanced
    });

    expect(request.endpoint).toContain('https://api.xiaomimimo.com/v1/chat/completions');
    expect(request.body.max_completion_tokens).toBe(48);
    expect(request.body.max_tokens).toBeUndefined();
    expect(request.body.tools).toBeUndefined();
  });

  it('lets adapters prepare connection-test output budgets', () => {
    const fixtures = Object.fromEntries(
      createProviderRuntimeCharacterizationFixtures().map((fixture) => [fixture.id, fixture])
    );

    const openAiFixture = fixtures['openai-compatible-native-tools'];
    const openAiRequest = buildProviderRuntimeRequest({
      api: openAiFixture.provider,
      context: openAiFixture.context,
      advanced: openAiFixture.advanced
    });
    resolveProviderRuntimeRequestAdapter(openAiFixture.provider).prepareConnectionTestRequest({
      request: openAiRequest,
      provider: openAiFixture.provider,
      maxOutputTokens: 32
    });
    expect(openAiRequest.body.max_tokens).toBe(32);
    expect(openAiRequest.body.max_output_tokens).toBeUndefined();
    expect(openAiRequest.body.max_completion_tokens).toBeUndefined();

    const mimoFixture = fixtures['mimo-openai-compatible-token-field'];
    const mimoRequest = buildProviderRuntimeRequest({
      api: mimoFixture.provider,
      context: mimoFixture.context,
      advanced: mimoFixture.advanced
    });
    resolveProviderRuntimeRequestAdapter(mimoFixture.provider).prepareConnectionTestRequest({
      request: mimoRequest,
      provider: mimoFixture.provider,
      maxOutputTokens: 32
    });
    expect(mimoRequest.body.max_completion_tokens).toBe(32);
    expect(mimoRequest.body.max_tokens).toBeUndefined();
    expect(mimoRequest.body.max_output_tokens).toBeUndefined();

    const responsesFixture = fixtures['openai-responses-transcript-history'];
    const responsesRequest = buildProviderRuntimeRequest({
      api: responsesFixture.provider,
      context: responsesFixture.context,
      advanced: responsesFixture.advanced
    });
    resolveProviderRuntimeRequestAdapter(responsesFixture.provider).prepareConnectionTestRequest({
      request: responsesRequest,
      provider: responsesFixture.provider,
      maxOutputTokens: 32
    });
    expect(responsesRequest.body.max_output_tokens).toBe(32);
    expect(responsesRequest.body.max_tokens).toBeUndefined();
    expect(responsesRequest.body.max_completion_tokens).toBeUndefined();
    expect(responsesRequest.body.reasoning).toBeUndefined();

    const anthropicFixture = fixtures['anthropic-messages-native-tools'];
    const anthropicRequest = buildProviderRuntimeRequest({
      api: anthropicFixture.provider,
      context: anthropicFixture.context,
      advanced: anthropicFixture.advanced
    });
    resolveProviderRuntimeRequestAdapter(anthropicFixture.provider).prepareConnectionTestRequest({
      request: anthropicRequest,
      provider: anthropicFixture.provider,
      maxOutputTokens: 32
    });
    expect(anthropicRequest.body.max_tokens).toBe(32);
    expect(anthropicRequest.body.thinking).toBeUndefined();

    const geminiFixture = fixtures['gemini-native-generate-content'];
    const geminiRequest = buildProviderRuntimeRequest({
      api: geminiFixture.provider,
      context: geminiFixture.context,
      advanced: geminiFixture.advanced
    });
    resolveProviderRuntimeRequestAdapter(geminiFixture.provider).prepareConnectionTestRequest({
      request: geminiRequest,
      provider: geminiFixture.provider,
      maxOutputTokens: 32
    });
    const generationConfig = readObject(geminiRequest.body.generationConfig);
    expect(generationConfig.maxOutputTokens).toBe(32);
    expect(generationConfig.thinkingConfig).toBeUndefined();
  });

  it('normalizes provider stream payloads into canonical stream events', () => {
    const openAiEvents = parseProviderRuntimeStreamEvents({
      choices: [{
        delta: {
          content: 'Hello',
          reasoning_content: 'thinking',
          tool_calls: [{
            id: 'call-1',
            function: {
              name: 'patchRawCss',
              arguments: '{"value"'
            }
          }]
        }
      }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
        prompt_tokens_details: {
          cached_tokens: 2
        }
      }
    });

    expect(openAiEvents).toEqual(expect.arrayContaining([
      { type: 'text.delta', text: 'Hello' },
      { type: 'reasoning.delta', text: 'thinking', mode: 'text' },
      { type: 'tool_call.start', id: 'call-1', name: 'patchRawCss' },
      { type: 'tool_call.delta', id: 'call-1', argumentsDelta: '{"value"' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, cachedInputTokens: 2, cacheMissInputTokens: 1 } }
    ]));

    const choiceUsageEvents = parseProviderRuntimeStreamEvents({
      choices: [{
        delta: {},
        usage: {
          prompt_tokens: 30,
          completion_tokens: 12,
          total_tokens: 42,
          prompt_tokens_details: {
            cached_tokens: 20
          }
        }
      }]
    });

    expect(choiceUsageEvents).toContainEqual({
      type: 'usage',
      usage: {
        inputTokens: 30,
        outputTokens: 12,
        totalTokens: 42,
        cachedInputTokens: 20,
        cacheMissInputTokens: 10
      }
    });

    const anthropicEvents = parseProviderRuntimeStreamEvents({
      type: 'content_block_delta',
      delta: {
        type: 'thinking_delta',
        thinking: 'step'
      },
      usage: {
        input_tokens: 2,
        output_tokens: 5
      }
    });

    expect(anthropicEvents).toEqual(expect.arrayContaining([
      { type: 'reasoning.delta', text: 'step', mode: 'text' },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 5, totalTokens: 7 } }
    ]));

    const responsesEvents = parseProviderRuntimeStreamEvents({
      type: 'response.function_call_arguments.done',
      item_id: 'call-2',
      arguments: '{"value":"ok"}'
    });

    expect(canonicalToolCallFromStreamEvents(responsesEvents)).toEqual([{
      id: 'call-2',
      name: '',
      argumentsText: '{"value":"ok"}'
    }]);

    expect(canonicalToolCallFromStreamEvents([
      { type: 'tool_call.start', id: 'call-3', name: 'readMemoryDoc' },
      { type: 'tool_call.delta', id: 'call-3', argumentsDelta: '{"docId":"memory-doc-1"' },
      { type: 'tool_call.delta', id: 'call-3', argumentsDelta: '{"docId":"memory-doc-1","targetLabel":"Monday"}' }
    ])).toEqual([{
      id: 'call-3',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1","targetLabel":"Monday"}'
    }]);
  });

  it('routes production stream parsing through matched adapters', () => {
    const fixtures = Object.fromEntries(
      createProviderRuntimeCharacterizationFixtures().map((fixture) => [fixture.id, fixture])
    );

    const openAiEvents = resolveProviderRuntimeRequestAdapter(fixtures['openai-compatible-native-tools'].provider)
      .parseStreamEvents({
        payload: {
          choices: [{ delta: { content: 'Hello' } }]
        }
      });
    expect(openAiEvents).toContainEqual({ type: 'text.delta', text: 'Hello' });

    const anthropicEvents = resolveProviderRuntimeRequestAdapter(fixtures['anthropic-messages-native-tools'].provider)
      .parseStreamEvents({
        payload: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Claude' }
        }
      });
    expect(anthropicEvents).toContainEqual({ type: 'text.delta', text: 'Claude' });

    const responsesEvents = resolveProviderRuntimeRequestAdapter(fixtures['openai-responses-transcript-history'].provider)
      .parseStreamEvents({
        payload: {
          type: 'response.output_text.delta',
          delta: 'Responses'
        }
      });
    expect(responsesEvents).toContainEqual({ type: 'text.delta', text: 'Responses' });

    const geminiEvents = resolveProviderRuntimeRequestAdapter(fixtures['gemini-native-generate-content'].provider)
      .parseStreamEvents({
        payload: {
          choices: [{ delta: { content: 'should not parse as OpenAI' } }]
        }
      });
    expect(geminiEvents).toEqual([]);
  });

  it('routes non-stream response parsing through matched adapters', () => {
    const fixtures = Object.fromEntries(
      createProviderRuntimeCharacterizationFixtures().map((fixture) => [fixture.id, fixture])
    );

    const openAiReply = resolveProviderRuntimeRequestAdapter(fixtures['openai-compatible-native-tools'].provider)
      .parseResponse({
        fallbackModel: 'openai-compatible-fallback',
        data: {
          model: 'deepseek-chat',
          choices: [{ message: { content: 'OpenAI-compatible reply' } }]
        }
      });
    expect(openAiReply.content).toBe('OpenAI-compatible reply');
    expect(openAiReply.model).toBe('deepseek-chat');

    const responsesReply = resolveProviderRuntimeRequestAdapter(fixtures['openai-responses-transcript-history'].provider)
      .parseResponse({
        fallbackModel: 'responses-fallback',
        data: {
          model: 'gpt-5.4',
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: 'Responses reply' }]
          }]
        }
      });
    expect(responsesReply.content).toBe('Responses reply');
    expect(responsesReply.model).toBe('gpt-5.4');

    const anthropicReply = resolveProviderRuntimeRequestAdapter(fixtures['anthropic-messages-native-tools'].provider)
      .parseResponse({
        fallbackModel: 'claude-fallback',
        data: {
          model: 'claude-opus-4-6',
          content: [{ type: 'text', text: 'Anthropic reply' }]
        }
      });
    expect(anthropicReply.content).toBe('Anthropic reply');
    expect(anthropicReply.model).toBe('claude-opus-4-6');

    const geminiReply = resolveProviderRuntimeRequestAdapter(fixtures['gemini-native-generate-content'].provider)
      .parseResponse({
        fallbackModel: 'gemini-fallback',
        data: {
          modelVersion: 'gemini-2.5-pro',
          candidates: [{
            content: {
              parts: [{ text: 'Gemini reply' }]
            }
          }]
        }
      });
    expect(geminiReply.content).toBe('Gemini reply');
    expect(geminiReply.model).toBe('gemini-2.5-pro');
  });
});
