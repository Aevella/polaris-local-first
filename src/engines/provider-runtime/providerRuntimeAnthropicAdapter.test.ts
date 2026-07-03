import { describe, expect, it } from 'vitest';
import {
  anthropicMessagesAdapter,
  buildAnthropicRequest
} from './providerRuntimeAnthropicAdapter';
import type { AssistantRequestCachePlan } from '../request/requestCachePlan';
import type { AssistantRequestContext } from '../request/requestContext';
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

type AnthropicAdapterParityCase = {
  id: string;
  input: ProviderRuntimeRequestInput;
  verify(request: ReturnType<typeof buildAnthropicRequest>): void;
  verifyCapabilities?: unknown;
};

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function createContextWithCachePlan(): AssistantRequestContext {
  const context = createProviderRuntimeTestContext({ withSystem: false, withTools: true, toolChoice: 'required' });
  const cachePlan: AssistantRequestCachePlan = {
    minimumBreakpointTokens: 1024,
    requestApplication: {
      status: 'explicit_anthropic_cache_control',
      label: 'Anthropic automatic conversation cache plus explicit prefix breakpoints sent',
      sendsExplicitCacheControl: true
    },
    breakpoints: [
      {
        name: 'identity_prefix',
        label: 'identity prefix',
        partNames: ['system_identity'],
        estimatedTokens: 1200,
        minimumTokens: 1024,
        ttl: '1h',
        enabled: true,
        eligible: true,
        reason: null
      },
      {
        name: 'capability_prefix',
        label: 'capability prefix',
        partNames: ['tool_catalog_capability'],
        estimatedTokens: 2200,
        minimumTokens: 1024,
        ttl: '1h',
        enabled: true,
        eligible: true,
        reason: null
      }
    ]
  };
  return {
    ...context,
    cachePlan,
    segments: [
      {
        kind: 'system' as const,
        messages: [
          {
            role: 'system' as const,
            content: 'Stable identity prefix.',
            promptPartName: 'system_identity' as const,
            promptPartLayer: 'identity' as const
          },
          {
            role: 'system' as const,
            content: 'Model runtime context.',
            promptPartName: 'model_runtime_context' as const,
            promptPartLayer: 'context' as const
          },
          {
            role: 'system' as const,
            content: 'Stable tool catalog.',
            promptPartName: 'tool_catalog_capability' as const,
            promptPartLayer: 'capability' as const
          }
        ]
      },
      ...context.segments
    ]
  };
}

const parityCases: AnthropicAdapterParityCase[] = [
  {
    id: 'anthropic-first-party-tools-thinking-and-cache',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4',
        capabilities: {
          images: true,
          streaming: true,
          thinking: true
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: true, toolChoice: 'required', withToolHistory: true }),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '256', thinkingBudget: '64' })
    },
    verify(request) {
      expect(request.provider).toBe('anthropic-messages');
      expect(request.headers['x-api-key']).toBe('test-key');
      expect(request.headers.Authorization).toBeUndefined();
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.body.max_tokens).toBe(256);
      expect(request.body.cache_control).toEqual({ type: 'ephemeral' });
      expect(request.body.thinking).toEqual({ type: 'enabled', budget_tokens: 64 });
      expect(request.body.stream).toBe(true);
      expect(request.body.tool_choice).toEqual({ type: 'any' });
      expect(readArray(request.body.tools)[0]).toEqual(expect.objectContaining({
        name: 'patchRawCss',
        input_schema: expect.objectContaining({ type: 'object' })
      }));

      const assistantMessage = readObject(readArray(request.body.messages)[1]);
      const assistantBlocks = readArray(assistantMessage.content);
      expect(assistantBlocks).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool_use', id: 'call-runtime-1', name: 'patchRawCss' })
      ]));
      const toolResultMessage = readObject(readArray(request.body.messages)[2]);
      expect(readArray(toolResultMessage.content)[0]).toEqual(expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'call-runtime-1',
        content: expect.stringContaining('"toolName":"patchRawCss"')
      }));
    },
    verifyCapabilities: expect.objectContaining({
      output: expect.objectContaining({ nativeToolCalls: true, reasoning: 'text' }),
      tools: expect.objectContaining({ mode: 'native', choiceControl: 'required', requiredChoice: true }),
      cache: { mode: 'explicit-cache-control', promptCaching: true },
      budgets: expect.objectContaining({ outputTokenField: 'max_tokens', promptBudgetPolicy: 'enforced', reasoningBudget: true })
    })
  },
  {
    id: 'anthropic-cache-plan-system-breakpoints',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4',
        capabilities: {
          images: true,
          streaming: true,
          thinking: false
        }
      }),
      context: createContextWithCachePlan(),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '128' })
    },
    verify(request) {
      expect(request.body.system).toEqual([
        {
          type: 'text',
          text: 'Stable identity prefix.',
          cache_control: { type: 'ephemeral', ttl: '1h' }
        },
        {
          type: 'text',
          text: 'Model runtime context.'
        },
        {
          type: 'text',
          text: 'Stable tool catalog.',
          cache_control: { type: 'ephemeral', ttl: '1h' }
        }
      ]);
      expect(request.body.thinking).toBeUndefined();
    },
    verifyCapabilities: expect.objectContaining({
      output: expect.objectContaining({ reasoning: 'none' }),
      cache: { mode: 'explicit-cache-control', promptCaching: true },
      budgets: expect.objectContaining({ reasoningBudget: false })
    })
  },
  {
    id: 'anthropic-packy-bearer-auth',
    input: {
      api: createProviderRuntimeTestProvider({
        id: 'packy',
        name: 'Packy Claude',
        protocol: 'anthropic-messages',
        baseUrl: 'https://www.packyapi.com/v1',
        path: '/messages',
        model: 'claude-opus-4-6',
        capabilities: {
          images: true,
          streaming: true,
          thinking: false
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: true, toolChoice: 'auto' }),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '512' })
    },
    verify(request) {
      expect(request.headers.Authorization).toBe('Bearer test-key');
      expect(request.headers['x-api-key']).toBeUndefined();
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.body.tool_choice).toEqual({ type: 'auto' });
      expect(request.body.max_tokens).toBe(512);
    },
    verifyCapabilities: expect.objectContaining({
      tools: expect.objectContaining({ mode: 'native', choiceControl: 'auto', requiredChoice: false }),
      budgets: expect.objectContaining({ promptBudgetPolicy: 'advisory' })
    })
  },
  {
    id: 'anthropic-sampling-top-p-without-temperature',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4',
        capabilities: {
          images: false,
          streaming: true,
          thinking: false
        }
      }),
      context: createProviderRuntimeTestContext({ withTools: false }),
      advanced: createProviderRuntimeAdvanced({ topP: '0.8', temperature: '0.7', streaming: false })
    },
    verify(request) {
      expect(request.body.top_p).toBe(0.8);
      expect(request.body.temperature).toBeUndefined();
      expect(request.body.stream).toBeUndefined();
      expect(request.body.tools).toBeUndefined();
      expect(request.body.tool_choice).toBeUndefined();
    },
    verifyCapabilities: expect.objectContaining({
      input: expect.objectContaining({ images: 'none' }),
      streaming: expect.objectContaining({ text: false, toolCalls: false, reasoning: false })
    })
  }
];

describe('anthropicMessagesAdapter', () => {
  it('matches only Anthropic messages protocol providers', () => {
    for (const testCase of parityCases) {
      expect(resolveProviderRuntimeRequestAdapter(testCase.input.api).id, testCase.id)
        .toBe(anthropicMessagesAdapter.id);
      expect(anthropicMessagesAdapter.match(testCase.input.api)).toEqual({
        adapterId: 'anthropic-messages',
        confidence: 'exact',
        reason: 'matched provider protocol: anthropic-messages'
      });
    }
  });

  it('preserves legacy Anthropic request output exactly', () => {
    for (const testCase of parityCases) {
      const adapterRequest = anthropicMessagesAdapter.buildRequest(testCase.input);
      const directRequest = buildAnthropicRequest(testCase.input);

      expect(adapterRequest, testCase.id).toEqual(directRequest);
      testCase.verify(adapterRequest);
    }
  });

  it('archives Anthropic capability quirks beside adapter parity fixtures', () => {
    for (const testCase of parityCases) {
      if (!testCase.verifyCapabilities) continue;
      expect(
        resolveCanonicalProviderCapabilities(testCase.input.api, testCase.input.advanced),
        testCase.id
      ).toEqual(testCase.verifyCapabilities);
    }
  });

  it('sends the real conversation id as OpenRouter sticky routing metadata', () => {
    const request = buildAnthropicRequest({
      api: createProviderRuntimeTestProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://openrouter.ai/api/v1',
        path: '/messages',
        model: 'anthropic/claude-opus-4.7'
      }),
      context: createProviderRuntimeTestContext({ withTools: false }),
      sessionId: 'conversation-anthropic-1'
    });

    expect(request.body.session_id).toBe('conversation-anthropic-1');
  });
});
