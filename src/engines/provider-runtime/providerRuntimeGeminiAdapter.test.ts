import { describe, expect, it } from 'vitest';
import {
  buildGeminiNativeRequest,
  geminiGenerateContentAdapter
} from './providerRuntimeGeminiAdapter';
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

type GeminiAdapterParityCase = {
  id: string;
  input: ProviderRuntimeRequestInput;
  verify(request: ReturnType<typeof buildGeminiNativeRequest>): void;
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

function createContextWithGeminiToolHistory(): AssistantRequestContext {
  return {
    memorySlots: {
      session: [],
      profile: [],
      pin: []
    },
    attachmentSlots: {
      enabled: false,
      pending: []
    },
    segments: [
      {
        kind: 'conversation',
        messages: [
          {
            role: 'assistant',
            content: '我先动手。',
            toolCalls: [{
              id: 'call-1',
              name: 'patchRawCss',
              argumentsText: '{"css":"body { color: red; }"}',
              providerMetadata: {
                geminiThoughtSignature: 'sig-a'
              }
            }]
          },
          {
            role: 'tool',
            content: '{"status":"applied","summary":"body { color: red; }"}',
            toolResult: {
              schemaVersion: 1,
              toolCallId: 'call-1',
              toolName: 'patchRawCss',
              status: 'applied',
              structuredPayload: {
                kind: 'patchRawCss',
                status: 'applied',
                summary: 'body { color: red; }'
              }
            }
          },
          {
            role: 'user',
            content: '再柔一点'
          }
        ]
      }
    ]
  };
}

function createContextWithGeminiUnsafeToolSchema(
  toolChoice: AssistantRequestContext['toolChoice']
): AssistantRequestContext {
  return {
    ...createProviderRuntimeTestContext({ withTools: false }),
    tools: [
      {
        type: 'function',
        function: {
          name: 'applyThemeCoordinates',
          description: 'Apply stable theme coordinates.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              targets: {
                description: 'all or multiple target codes.',
                oneOf: [
                  { type: 'string', enum: ['all'] },
                  {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 8
                  }
                ]
              },
              hue: {
                type: 'number',
                description: 'Hue.',
                minimum: 0,
                maximum: 360
              },
              args: {
                type: 'object',
                description: 'Open-ended tool args.',
                additionalProperties: true
              }
            },
            required: ['targets', 'hue']
          }
        }
      }
    ],
    toolChoice
  };
}

const parityCases: GeminiAdapterParityCase[] = [
  {
    id: 'gemini-image-tools-thinking-config',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'gemini-generate-content',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        path: '/models/{model}:generateContent',
        model: 'gemini-2.5-flash',
        capabilities: {
          images: true,
          streaming: false,
          thinking: true
        }
      }),
      context: createProviderRuntimeTestContext({ withImage: true, withTools: true, toolChoice: 'required' }),
      advanced: createProviderRuntimeAdvanced({ maxTokens: '96', thinkingBudget: '32' })
    },
    verify(request) {
      const generationConfig = readObject(request.body.generationConfig);
      const contents = readArray(request.body.contents);
      const firstContent = readObject(contents[0]);
      const firstParts = readArray(firstContent.parts);
      const tools = readArray(request.body.tools);
      const firstTool = readObject(tools[0]);
      const declarations = readArray(firstTool.functionDeclarations);

      expect(request.provider).toBe('gemini-generate-content');
      expect(request.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(request.headers['x-goog-api-key']).toBe('test-key');
      expect(request.body.stream).toBeUndefined();
      expect(request.body.systemInstruction).toEqual({
        parts: [{ text: 'You are testing provider runtime boundaries.' }]
      });
      expect(firstContent.role).toBe('user');
      expect(firstParts).toEqual([
        { text: 'Describe this fixture image.' },
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'ZmFrZQ=='
          }
        }
      ]);
      expect(declarations[0]).toEqual(expect.objectContaining({
        name: 'patchRawCss',
        parameters: expect.objectContaining({ type: 'object' })
      }));
      expect(request.body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
      expect(generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 96,
        thinkingConfig: { thinkingBudget: 32 }
      });
    },
    verifyCapabilities: expect.objectContaining({
      input: expect.objectContaining({ images: 'model-dependent' }),
      output: expect.objectContaining({ nativeToolCalls: true, reasoning: 'signature-required' }),
      streaming: expect.objectContaining({ text: false, toolCalls: false, reasoning: false, usage: false }),
      tools: expect.objectContaining({ mode: 'native', choiceControl: 'required', requiredChoice: true }),
      budgets: expect.objectContaining({ outputTokenField: 'max_output_tokens', promptBudgetPolicy: 'enforced', reasoningBudget: true }),
      cache: { mode: 'none', promptCaching: false }
    })
  },
  {
    id: 'gemini-tool-history-thought-signature',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'gemini-generate-content',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        path: '/models/{model}:generateContent',
        model: 'gemini-3.1-pro-preview',
        capabilities: {
          images: false,
          streaming: false,
          thinking: true
        }
      }),
      context: createContextWithGeminiToolHistory(),
      advanced: createProviderRuntimeAdvanced()
    },
    verify(request) {
      expect(request.endpoint).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent');
      expect(request.body.contents).toEqual([
        {
          role: 'model',
          parts: [
            { text: '我先动手。' },
            {
              functionCall: {
                id: 'call-1',
                name: 'patchRawCss',
                args: { css: 'body { color: red; }' }
              },
              thoughtSignature: 'sig-a'
            }
          ]
        },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              id: 'call-1',
              name: 'patchRawCss',
              response: {
                toolName: 'patchRawCss',
                status: 'applied',
                kind: 'patchRawCss',
                summary: 'body { color: red; }'
              }
            }
          }]
        },
        {
          role: 'user',
          parts: [{ text: '再柔一点' }]
        }
      ]);
    },
    verifyCapabilities: expect.objectContaining({
      output: expect.objectContaining({ nativeToolCalls: true, reasoning: 'signature-required' }),
      budgets: expect.objectContaining({ reasoningBudget: true })
    })
  },
  {
    id: 'gemini-function-declaration-schema-sanitizer',
    input: {
      api: createProviderRuntimeTestProvider({
        protocol: 'gemini-generate-content',
        baseUrl: 'https://api.n1n.ai/v1beta',
        path: '/models/{model}:generateContent',
        model: 'gemini-3.1-flash-lite-preview',
        capabilities: {
          images: false,
          streaming: false,
          thinking: true
        }
      }),
      context: createContextWithGeminiUnsafeToolSchema('auto'),
      advanced: createProviderRuntimeAdvanced({ streaming: false })
    },
    verify(request) {
      expect(request.body.tools).toEqual([{
        functionDeclarations: [{
          name: 'applyThemeCoordinates',
          description: 'Apply stable theme coordinates.',
          parameters: {
            type: 'object',
            properties: {
              targets: {
                description: 'all or multiple target codes.',
                type: 'string',
                enum: ['all']
              },
              hue: {
                type: 'number',
                description: 'Hue.'
              },
              args: {
                type: 'object',
                description: 'Open-ended tool args.'
              }
            },
            required: ['targets', 'hue']
          }
        }]
      }]);
      expect(request.body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
      expect(request.body.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 64
      });
    },
    verifyCapabilities: expect.objectContaining({
      input: expect.objectContaining({ images: 'none' }),
      streaming: expect.objectContaining({ text: false, toolCalls: false, reasoning: false }),
      tools: expect.objectContaining({ mode: 'native', choiceControl: 'auto', requiredChoice: false }),
      budgets: expect.objectContaining({ promptBudgetPolicy: 'advisory', reasoningBudget: true }),
      transport: expect.objectContaining({ modes: ['direct', 'browser-relay', 'native-direct'] })
    })
  }
];

describe('geminiGenerateContentAdapter', () => {
  it('matches only Gemini Generate Content protocol providers', () => {
    for (const testCase of parityCases) {
      expect(resolveProviderRuntimeRequestAdapter(testCase.input.api).id, testCase.id)
        .toBe(geminiGenerateContentAdapter.id);
      expect(geminiGenerateContentAdapter.match(testCase.input.api)).toEqual({
        adapterId: 'gemini-generate-content',
        confidence: 'exact',
        reason: 'matched provider protocol: gemini-generate-content'
      });
    }
  });

  it('preserves legacy Gemini request output exactly', () => {
    for (const testCase of parityCases) {
      const adapterRequest = geminiGenerateContentAdapter.buildRequest(testCase.input);
      const directRequest = buildGeminiNativeRequest(testCase.input);

      expect(adapterRequest, testCase.id).toEqual(directRequest);
      testCase.verify(adapterRequest);
    }
  });

  it('archives Gemini capability quirks beside adapter parity fixtures', () => {
    for (const testCase of parityCases) {
      if (!testCase.verifyCapabilities) continue;
      expect(
        resolveCanonicalProviderCapabilities(testCase.input.api, testCase.input.advanced),
        testCase.id
      ).toEqual(testCase.verifyCapabilities);
    }
  });
});
