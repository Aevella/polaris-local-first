import { describe, expect, it } from 'vitest';
import {
  buildResponsesRequest,
  openAiResponsesAdapter
} from './providerRuntimeResponsesAdapter';
import {
  resolveProviderRuntimeRequestAdapter
} from './providerRuntimeAdapters';
import {
  createProviderRuntimeAdvanced,
  createProviderRuntimeTestContext,
  createProviderRuntimeTestProvider
} from './providerRuntimeFixtures';
import { resolveCanonicalProviderCapabilities } from './providerRuntimeCapabilities';
import type { ProviderRuntimeRequestInput } from './providerRuntimeRequestTypes';

type ResponsesAdapterParityCase = {
  id: string;
  input: ProviderRuntimeRequestInput;
  verify(request: ReturnType<typeof buildResponsesRequest>): void;
  verifyCapabilities?: unknown;
};

function responsesInput(request: ReturnType<typeof buildResponsesRequest>) {
  return Array.isArray(request.body.input) ? request.body.input as Array<Record<string, unknown>> : [];
}

function userEntry(request: ReturnType<typeof buildResponsesRequest>) {
  return responsesInput(request).find((entry) => entry.role === 'user');
}

function userEntries(request: ReturnType<typeof buildResponsesRequest>) {
  return responsesInput(request).filter((entry) => entry.role === 'user');
}

function assistantEntry(request: ReturnType<typeof buildResponsesRequest>) {
  return responsesInput(request).find((entry) => entry.role === 'assistant');
}

const parityCases: ResponsesAdapterParityCase[] = [
  {
    id: 'responses-image-and-native-tool-schema',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        path: '/responses',
        model: 'gpt-5-mini',
        capabilities: {
          images: true,
          streaming: true,
          thinking: false
        }
      }),
      context: createProviderRuntimeTestContext({ withImage: true, withTools: true, toolChoice: 'required' }),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '128', temperature: '0.7' })
    },
    verify(request) {
      expect(request.provider).toBe('openai-responses');
      expect(request.body.max_output_tokens).toBe(128);
      expect(request.body.temperature).toBe(0.7);
      expect(request.body.stream).toBe(true);
      expect(request.body.tool_choice).toBe('required');
      expect(request.body.tools).toEqual([{
        type: 'function',
        name: 'patchRawCss',
        description: 'Provider runtime conformance fixture tool.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' }
          },
          required: ['value']
        }
      }]);
      expect(userEntry(request)?.content).toEqual([
        { type: 'input_text', text: 'Describe this fixture image.' },
        { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' }
      ]);
    },
    verifyCapabilities: expect.objectContaining({
      input: expect.objectContaining({ images: 'data-url' }),
      output: expect.objectContaining({ nativeToolCalls: false, reasoning: 'none' }),
      tools: expect.objectContaining({ mode: 'transcript', choiceControl: 'required' }),
      budgets: expect.objectContaining({ outputTokenField: 'max_output_tokens', promptBudgetPolicy: 'enforced' })
    })
  },
  {
    id: 'responses-transcript-tool-history-and-medium-reasoning',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        path: '/responses',
        model: 'gpt-5-mini',
        capabilities: {
          images: true,
          streaming: true,
          thinking: true
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: true, withToolHistory: true }),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '144', thinkingBudget: '2048' })
    },
    verify(request) {
      expect(request.body.max_output_tokens).toBe(144);
      expect(request.body.reasoning).toEqual({ effort: 'medium' });
      expect(String(assistantEntry(request)?.content)).toContain('[assistant_tool_calls]');
      expect(userEntries(request).map((entry) => String(entry.content))).toEqual(expect.arrayContaining([
        expect.stringContaining('[tool_result:patchRawCss]')
      ]));
    },
    verifyCapabilities: expect.objectContaining({
      output: expect.objectContaining({ nativeToolCalls: false, reasoning: 'summary' }),
      streaming: expect.objectContaining({ text: true, reasoning: true }),
      tools: expect.objectContaining({ mode: 'transcript' }),
      budgets: expect.objectContaining({ reasoningBudget: true })
    })
  },
  {
    id: 'responses-low-reasoning-and-streaming-disabled',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        path: '/responses',
        model: 'gpt-5-mini',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: false }),
      advanced: createProviderRuntimeAdvanced({ thinkingBudget: '1024', streaming: false })
    },
    verify(request) {
      expect(request.body.reasoning).toEqual({ effort: 'low' });
      expect(request.body.stream).toBeUndefined();
      expect(request.body.tools).toBeUndefined();
      expect(request.body.tool_choice).toBeUndefined();
    },
    verifyCapabilities: expect.objectContaining({
      input: expect.objectContaining({ images: 'none' }),
      streaming: expect.objectContaining({ text: false, toolCalls: false, reasoning: false })
    })
  },
  {
    id: 'responses-high-reasoning-and-custom-relay-tool-choice-downgrade',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://relay.example.com/v1',
        path: '/responses',
        model: 'gpt-5-mini',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: true, toolChoice: 'required' }),
      advanced: createProviderRuntimeAdvanced({ thinkingBudget: '8192' })
    },
    verify(request) {
      expect(request.body.reasoning).toEqual({ effort: 'high' });
      expect(request.body.tool_choice).toBe('auto');
      expect(request.body.stream).toBe(true);
    },
    verifyCapabilities: expect.objectContaining({
      tools: expect.objectContaining({ mode: 'transcript', choiceControl: 'auto', requiredChoice: false }),
      budgets: expect.objectContaining({ promptBudgetPolicy: 'advisory', reasoningBudget: true })
    })
  }
];

describe('openAiResponsesAdapter', () => {
  it('matches only Responses protocol providers', () => {
    for (const testCase of parityCases) {
      expect(resolveProviderRuntimeRequestAdapter(testCase.input.api).id, testCase.id)
        .toBe(openAiResponsesAdapter.id);
      expect(openAiResponsesAdapter.match(testCase.input.api)).toEqual({
        adapterId: 'openai-responses',
        confidence: 'exact',
        reason: 'matched provider protocol: openai-responses'
      });
    }
  });

  it('preserves legacy Responses request output exactly', () => {
    for (const testCase of parityCases) {
      const adapterRequest = openAiResponsesAdapter.buildRequest(testCase.input);
      const directRequest = buildResponsesRequest(testCase.input);

      expect(adapterRequest, testCase.id).toEqual(directRequest);
      testCase.verify(adapterRequest);
    }
  });

  it('archives Responses capability quirks beside adapter parity fixtures', () => {
    for (const testCase of parityCases) {
      if (!testCase.verifyCapabilities) continue;
      expect(
        resolveCanonicalProviderCapabilities(testCase.input.api, testCase.input.advanced),
        testCase.id
      ).toEqual(testCase.verifyCapabilities);
    }
  });

  it('sends the real conversation id as OpenRouter sticky routing metadata', () => {
    const request = buildResponsesRequest({
      api: createProviderRuntimeTestProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://openrouter.ai/api/v1',
        path: '/responses',
        model: 'anthropic/claude-opus-4.7'
      }),
      context: createProviderRuntimeTestContext({ withTools: false }),
      sessionId: 'conversation-responses-1'
    });

    expect(request.body.session_id).toBe('conversation-responses-1');
  });
});
