import { describe, expect, it } from 'vitest';
import type { PersonaAdvancedSettings, ProviderProfile } from '../../types/domain';
import type { AssistantRequestContext } from '../request/requestContext';
import { assembleAssistantContext } from '../request/requestContext';
import { buildApiRequest } from './chatApiRequestBuilder';
import {
  POLARIS_PUBLIC_PROVIDER,
  POLARIS_PUBLIC_PROVIDER_KEY
} from '../freeProvider';

function createProvider(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'test',
    name: 'Test',
    protocol: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    path: 'chat/completions',
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    capabilities: {
      images: false,
      streaming: true,
      thinking: false
    },
    ...overrides
  };
}

function createContext(toolChoice: AssistantRequestContext['toolChoice']): AssistantRequestContext {
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
            role: 'user',
            content: '帮我调一下页面'
          }
        ]
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'patchRawCss',
          description: 'Patch CSS.',
          parameters: {
            type: 'object',
            properties: {
              css: {
                type: 'string'
              }
            }
          }
        }
      }
    ],
    toolChoice
  };
}

function createContextWithGeminiUnsafeToolSchema(toolChoice: AssistantRequestContext['toolChoice']): AssistantRequestContext {
  return {
    ...createContext(toolChoice),
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
    ]
  };
}

function createContextWithoutTools(): AssistantRequestContext {
  return {
    ...createContext('auto'),
    tools: [],
    toolChoice: undefined
  };
}

function createContextWithSystemPrompt(): AssistantRequestContext {
  const context = createContext('auto');
  return {
    ...context,
    segments: [
      {
        kind: 'system',
        messages: [
          {
            role: 'system',
            content: '稳定身份前缀。',
            cachePrefixEligible: true
          },
          {
            role: 'system',
            content: '稳定工具目录。',
            cachePrefixEligible: true
          },
          {
            role: 'system',
            content: '当前模型执行提示。',
            cachePrefixEligible: false
          }
        ]
      },
      ...context.segments
    ]
  };
}

function createContextWithAnthropicCachePlan(): AssistantRequestContext {
  const context = createContext('auto');
  return {
    ...context,
    cachePlan: {
      minimumBreakpointTokens: 1024,
      requestApplication: {
        status: 'explicit_anthropic_cache_control',
        label: 'Anthropic automatic conversation cache plus explicit prefix breakpoints sent',
        sendsExplicitCacheControl: true
      },
      breakpoints: [
        {
          name: 'identity_prefix',
          label: '身份层前缀',
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
          label: '能力层前缀',
          partNames: ['system_identity', 'tool_catalog_capability'],
          estimatedTokens: 2600,
          minimumTokens: 1024,
          ttl: '1h',
          enabled: true,
          eligible: true,
          reason: null
        }
      ]
    },
    segments: [
      {
        kind: 'system',
        messages: [
          {
            role: 'system',
            content: '稳定身份前缀。',
            promptPartName: 'system_identity',
            promptPartLayer: 'identity'
          },
          {
            role: 'system',
            content: '当前模型执行提示。',
            promptPartName: 'model_runtime_context',
            promptPartLayer: 'context'
          },
          {
            role: 'system',
            content: '稳定工具目录。',
            promptPartName: 'tool_catalog_capability',
            promptPartLayer: 'capability'
          }
        ]
      },
      ...context.segments
    ]
  };
}

function createContextWithToolHistory(): AssistantRequestContext {
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
              argumentsText: '{"css":"body { color: red; }"}'
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

function createContextWithGeminiToolHistory(): AssistantRequestContext {
  const context = createContextWithToolHistory();
  const firstMessage = context.segments[0]?.messages[0];
  if (firstMessage?.role === 'assistant' && firstMessage.toolCalls?.[0]) {
    firstMessage.toolCalls[0] = {
      ...firstMessage.toolCalls[0],
      providerMetadata: {
        geminiThoughtSignature: 'sig-a'
      }
    };
  }
  return context;
}

function createContextWithThinkingToolHistory(): AssistantRequestContext {
  const context = createContextWithToolHistory();
  const firstMessage = context.segments[0]?.messages[0];
  if (firstMessage?.role === 'assistant') {
    firstMessage.thinkingText = '先判断主题工具是否已经写入，再决定下一轮怎么改。';
  }
  return context;
}

function createContextWithLegacyProjectFileToolHistory(): AssistantRequestContext {
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
            content: '我先继续。',
            toolCalls: [{
              id: 'call-project-file-1',
              name: 'appendCodeCard',
              argumentsText: '{"projectId":"white-cat-box","filePath":"script.js","code":"const part = "}'
            }]
          },
          {
            role: 'tool',
            content: '{"status":"executed","summary":"已续写工作区文件 · script.js"}',
            toolResult: {
              schemaVersion: 1,
              toolCallId: 'call-project-file-1',
              toolName: 'appendCodeCard',
              status: 'executed',
              structuredPayload: {
                kind: 'appendCodeCard',
                status: 'executed',
                summary: '已续写工作区文件 · script.js'
              }
            }
          },
          {
            role: 'user',
            content: '继续写'
          }
        ]
      }
    ]
  };
}

function createContextWithLegacyActiveProjectFileToolHistory(): AssistantRequestContext {
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
            content: '我先继续。',
            toolCalls: [{
              id: 'call-project-file-active-1',
              name: 'appendCodeCard',
              argumentsText: '{"target":"active","code":"const part = "}'
            }]
          },
          {
            role: 'tool',
            content: '{"status":"executed","summary":"已续写工作区文件 · index.html"}',
            toolResult: {
              schemaVersion: 1,
              toolCallId: 'call-project-file-active-1',
              toolName: 'appendProjectFile',
              status: 'executed',
              structuredPayload: {
                kind: 'appendProjectFile',
                status: 'executed',
                summary: '已续写工作区文件 · index.html'
              }
            }
          },
          {
            role: 'user',
            content: '继续写'
          }
        ]
      }
    ]
  };
}

function createAdvanced(overrides: Partial<PersonaAdvancedSettings> = {}): PersonaAdvancedSettings {
  return {
    modelOverride: '',
    temperature: '',
    topP: '',
    maxTokens: '',
    thinkingBudget: '',
    contextMessageLimit: '',
    showThinking: true,
    streaming: true,
    customHeaders: '',
    customBody: '',
    regexRules: '',
    snippets: [],
    ...overrides
  };
}

describe('buildApiRequest tool choice', () => {
  it('keeps required tool choice on OpenAI direct routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://api.openai.com/v1'
      }),
      context: createContext('required')
    });

    expect(request.body.tool_choice).toBe('required');
  });

  it('downgrades required tool choice on SiliconFlow routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'siliconflow',
        name: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'moonshotai/Kimi-K2-Instruct'
      }),
      context: createContext('required')
    });

    expect(request.body.tool_choice).toBe('auto');
  });

  it('omits tool choice on DeepSeek reasoning routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-reasoner',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContext('required')
    });

    expect(request.body.tools).toBeDefined();
    expect(request.body).not.toHaveProperty('tool_choice');
  });

  it('returns DeepSeek thinking history as reasoning_content for tool follow-up requests', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithThinkingToolHistory(),
      advanced: createAdvanced({
        thinkingBudget: '1024'
      })
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: '我先动手。',
      reasoning_content: '先判断主题工具是否已经写入，再决定下一轮怎么改。'
    });
    expect(request.body.thinking).toBeUndefined();
    expect(request.body).not.toHaveProperty('tool_choice');
  });

  it('omits auto tool choice on DeepSeek reasoning routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-reasoner',
        capabilities: {
          images: true,
          streaming: true,
          thinking: true
        }
      }),
      context: createContext('auto')
    });

    expect(request.body.tools).toBeDefined();
    expect(request.body).not.toHaveProperty('tool_choice');
  });

  it('downgrades required tool choice on Moonshot Kimi routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'moonshot',
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-thinking-preview'
      }),
      context: createContext('required')
    });

    expect(request.body.tool_choice).toBe('auto');
  });

  it('does not send budget-token thinking shape to direct Moonshot Kimi K2', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'moonshot',
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        capabilities: {
          images: true,
          streaming: true,
          thinking: true
        }
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        thinkingBudget: '1024'
      })
    });

    expect(request.body.thinking).toBeUndefined();
  });

  it('ignores stale thinking budget text when the current route does not use it', () => {
    const request = buildApiRequest({
      api: createProvider({
        capabilities: {
          images: false,
          streaming: true,
          thinking: false
        }
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        thinkingBudget: '高'
      })
    });

    expect(request.body.thinking).toBeUndefined();
  });

  it('uses the user-facing thinking budget label when the active route needs a number', () => {
    expect(() => buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        path: '/v1/messages',
        model: 'claude-sonnet-4-5',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        thinkingBudget: '高'
      })
    })).toThrow('思考预算必须是数字');
  });

  it('omits temperature for direct Moonshot Kimi K2', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'moonshot',
        name: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        capabilities: {
          images: true,
          streaming: true,
          thinking: true
        }
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        temperature: '0.7'
      })
    });

    expect(request.body.temperature).toBeUndefined();
  });

  it('downgrades required tool choice on custom OpenAI-compatible relays', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'custom-kimi',
        name: 'Custom Kimi',
        baseUrl: 'https://relay.example.com/v1',
        model: 'kimi-k2.6'
      }),
      context: createContext('required')
    });

    expect(request.body.tool_choice).toBe('auto');
  });

  it('disables streaming for n1n function calling routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'n1n',
        name: 'n1n',
        baseUrl: 'https://api.n1n.ai/v1',
        model: 'gemini-3.1-flash-lite-preview'
      }),
      context: createContext('auto')
    });

    expect(request.body.tools).toEqual(createContext('auto').tools);
    expect(request.body.stream).toBeUndefined();
  });

  it('keeps n1n streaming enabled for plain chat routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'n1n',
        name: 'n1n',
        baseUrl: 'https://api.n1n.ai/v1',
        model: 'gemini-3.1-flash-lite-preview'
      }),
      context: createContextWithoutTools()
    });

    expect(request.body.tools).toBeUndefined();
    expect(request.body.stream).toBe(true);
  });

  it('sanitizes Gemini-model tool schemas before sending them through OpenAI-compatible relays', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'n1n',
        name: 'n1n',
        baseUrl: 'https://api.n1n.ai/v1',
        model: 'gemini-3.1-flash-lite-preview'
      }),
      context: createContextWithGeminiUnsafeToolSchema('auto')
    });

    expect(request.body.tools).toEqual([
      {
        type: 'function',
        function: {
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
        }
      }
    ]);
  });

  it('attaches the device id header for the built-in free provider', () => {
    const request = buildApiRequest({
      api: createProvider({
        ...POLARIS_PUBLIC_PROVIDER,
        apiKey: POLARIS_PUBLIC_PROVIDER_KEY
      }),
      context: createContext('auto')
    });

    expect(request.headers['X-Polaris-Device-Id']).toBeTruthy();
    expect(request.usesBuiltInTrial).toBe(true);
    expect(request.body.max_tokens).toBeUndefined();
    expect(request.body.max_completion_tokens).toBeUndefined();
  });

  it('does not force a default max_tokens budget onto third-party OpenAI-compatible routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://example.com/v1',
        path: '/chat/completions'
      }),
      context: createContext('auto')
    });

    expect(request.body.max_tokens).toBeUndefined();
    expect(request.body.max_completion_tokens).toBeUndefined();
  });

  it('does not force a default max_completion_tokens budget onto third-party Mimo-compatible routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2-pro'
      }),
      context: createContext('auto')
    });

    expect(request.body.max_completion_tokens).toBeUndefined();
    expect(request.body.max_tokens).toBeUndefined();
  });

  it('returns Mimo thinking history as reasoning_content for follow-up requests', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithThinkingToolHistory()
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: '我先动手。',
      reasoning_content: '先判断主题工具是否已经写入，再决定下一轮怎么改。'
    });
  });

  it('keeps the Mimo reasoning_content field present when historical assistant thinking text is unavailable', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        path: '/chat/completions',
        model: 'mimo-v2.5-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithToolHistory()
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: ''
    });
  });

  it('keeps the built-in public Polaris route on Mimo reasoning history replay', () => {
    const request = buildApiRequest({
      api: createProvider(POLARIS_PUBLIC_PROVIDER),
      context: createContextWithToolHistory()
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: ''
    });
  });

  it('keeps synthetic Polaris tool history out of Mimo native tool calls on follow-up requests', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '粉色棉花糖！我先给你试一版。',
          thinkingText: '需要先读当前主题，再给出 CSS 试穿。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: pink; }"}',
            sourceSpan: {
              transport: 'fence',
              index: 0,
              blockIndex: 0
            }
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '粉色棉花糖气泡 · 03 · hue 26',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'patchRawCss',
            status: 'preview',
            title: '单区域精修试穿',
            summary: '粉色棉花糖气泡 · 03 · hue 26',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-1',
          role: 'user',
          content: '再黄一点',
          timestamp: 3
        }
      ],
    });

    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: '粉色棉花糖！我先给你试一版。',
      reasoning_content: '需要先读当前主题，再给出 CSS 试穿。'
    });
    expect(messages[0]).not.toHaveProperty('tool_calls');
    expect(messages.some((message) => message.role === 'tool')).toBe(false);
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('[tool_result:patchRawCss]')
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: '再黄一点'
    });
  });

  it('keeps synthetic Polaris tool transcript history acceptable to Mimo when thinking text is unavailable', () => {
    const context = assembleAssistantContext({
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '粉色棉花糖！我先给你试一版。',
          timestamp: 1,
          nativeToolCalls: [{
            id: 'call-1',
            name: 'patchRawCss',
            argumentsText: '{"css":"body { color: pink; }"}',
            sourceSpan: {
              transport: 'fence',
              index: 0
            }
          }]
        },
        {
          id: 'tool-1',
          role: 'system',
          content: '粉色棉花糖气泡 · 03 · hue 26',
          timestamp: 2,
          toolInvocation: {
            id: 'tool-1',
            kind: 'patchRawCss',
            status: 'preview',
            title: '单区域精修试穿',
            summary: '粉色棉花糖气泡 · 03 · hue 26',
            originMessageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        },
        {
          id: 'user-1',
          role: 'user',
          content: '再黄一点',
          timestamp: 3
        }
      ],
    });

    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: ''
    });
    expect(messages[0]).not.toHaveProperty('tool_calls');
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('[tool_result:patchRawCss]')
    });
  });

  it('returns reasoning_content for direct Mimo routes even with an aliased model', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'mimo',
        name: 'Mimo',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'xiaomi/mimo-v2.5-pro',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithThinkingToolHistory()
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: '先判断主题工具是否已经写入，再决定下一轮怎么改。'
    });
  });

  it('does not send reasoning_content to ordinary OpenAI-compatible routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5-mini',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithThinkingToolHistory()
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).not.toHaveProperty('reasoning_content');
  });

  it('does not force a default max_output_tokens budget onto third-party responses routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        path: '/responses',
        model: 'gpt-5'
      }),
      context: createContext('auto')
    });

    expect(request.body.max_output_tokens).toBeUndefined();
    expect(request.body.max_tokens).toBeUndefined();
  });

  it('uses the explicit anthropic protocol for messages-style routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'opencode-zen',
        name: 'OpenCode Zen',
        protocol: 'anthropic-messages',
        baseUrl: 'https://opencode.ai/zen/v1',
        path: '/messages',
        model: 'claude-opus-4-6'
      }),
      context: createContext('auto')
    });

    expect(request.provider).toBe('anthropic-messages');
    expect(request.headers['x-api-key']).toBe('test-key');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.body.max_tokens).toBe(65536);
    expect(request.body.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks the final cache-eligible Anthropic system block as an explicit cache breakpoint', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4'
      }),
      context: createContextWithSystemPrompt()
    });

    expect(request.body.system).toEqual([
      {
        type: 'text',
        text: '稳定身份前缀。'
      },
      {
        type: 'text',
        text: '稳定工具目录。',
        cache_control: { type: 'ephemeral', ttl: '1h' }
      },
      {
        type: 'text',
        text: '当前模型执行提示。'
      }
    ]);
  });

  it('marks Anthropic system cache breakpoints from the request cache plan', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4'
      }),
      context: createContextWithAnthropicCachePlan()
    });

    expect(request.body.system).toEqual([
      {
        type: 'text',
        text: '稳定身份前缀。',
        cache_control: { type: 'ephemeral', ttl: '1h' }
      },
      {
        type: 'text',
        text: '当前模型执行提示。'
      },
      {
        type: 'text',
        text: '稳定工具目录。',
        cache_control: { type: 'ephemeral', ttl: '1h' }
      }
    ]);
  });

  it('omits top_p for the Zen preset when it stays at 1', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'zen',
        name: 'OpenCode Zen',
        baseUrl: 'https://opencode.ai/zen/v1',
        path: '/chat/completions',
        model: 'claude-opus-4-6'
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        topP: '1'
      })
    });

    expect(request.body.top_p).toBeUndefined();
  });

  it('keeps top_p on generic OpenAI-compatible routes when explicitly set to 1', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://example.com/v1'
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        topP: '1'
      })
    });

    expect(request.body.top_p).toBe(1);
  });

  it('uses bearer auth for the Packy anthropic preset', () => {
    const request = buildApiRequest({
      api: createProvider({
        id: 'packy',
        name: 'Packy Claude',
        protocol: 'anthropic-messages',
        baseUrl: 'https://www.packyapi.com/v1',
        path: '/messages',
        model: 'claude-opus-4-6'
      }),
      context: createContext('auto')
    });

    expect(request.provider).toBe('anthropic-messages');
    expect(request.headers.Authorization).toBe('Bearer test-key');
    expect(request.headers['x-api-key']).toBeUndefined();
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('omits top_p at 1 for generic anthropic routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://example-anthropic-proxy.com/v1',
        path: '/messages',
        model: 'claude-opus-4-6'
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        topP: '1'
      })
    });

    expect(request.body.top_p).toBeUndefined();
  });

  it('sends top_p without temperature for anthropic sampling overrides', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4'
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        topP: '0.8'
      })
    });

    expect(request.body.top_p).toBe(0.8);
    expect(request.body.temperature).toBeUndefined();
  });

  it('omits top_p at 1 for claude relays on OpenAI-compatible routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://example-claude-relay.com/v1'
      }),
      context: createContext('auto'),
      advanced: createAdvanced({
        modelOverride: 'claude-opus-4-6',
        topP: '1'
      })
    });

    expect(request.body.top_p).toBeUndefined();
  });

  it('builds responses payloads when the provider protocol is responses', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'openai-responses',
        path: '/responses'
      }),
      context: createContext('required')
    });

    expect(request.provider).toBe('openai-responses');
    expect(request.body.input).toEqual([
      {
        role: 'user',
        content: '帮我调一下页面'
      }
    ]);
    expect(request.body.max_tokens).toBeUndefined();
    expect(request.body.tools).toEqual([{
      type: 'function',
      name: 'patchRawCss',
      description: 'Patch CSS.',
      parameters: {
        type: 'object',
        properties: {
          css: {
            type: 'string'
          }
        }
      }
    }]);
    expect(request.body.tool_choice).toBe('required');
  });

  it('rehydrates assistant tool call history for OpenAI-compatible requests', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: createContextWithToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: '我先动手。',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'patchRawCss',
            arguments: '{"css":"body { color: red; }"}'
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'patchRawCss',
        content: '{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}'
      },
      {
        role: 'user',
        content: '再柔一点'
      }
    ]);
  });

  it('does not emit OpenAI-compatible native tool calls when their result messages are missing', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
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
                content: '我先写文件。',
                toolCalls: [{
                  id: 'call-1',
                  name: 'writeDesktopFile',
                  argumentsText: '{"filePath":"server.py","content":"print(1)"}'
                }]
              },
              {
                role: 'user',
                content: '继续'
              }
            ]
          }
        ]
      }
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('[assistant_tool_calls]')
    });
    expect(messages[0]).not.toHaveProperty('tool_calls');
    expect(messages[1]).toEqual({
      role: 'user',
      content: '继续'
    });
  });

  it('converts separated OpenAI-compatible tool results into transcript evidence', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
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
                content: '我先写文件。',
                toolCalls: [{
                  id: 'call-1',
                  name: 'writeDesktopFile',
                  argumentsText: '{"filePath":"server.py","content":"print(1)"}'
                }]
              },
              {
                role: 'user',
                content: '等等'
              },
              {
                role: 'tool',
                content: '{"status":"executed","summary":"已写入 server.py"}',
                toolResult: {
                  schemaVersion: 1,
                  toolCallId: 'call-1',
                  toolName: 'writeDesktopFile',
                  status: 'executed',
                  structuredPayload: {
                    kind: 'writeDesktopFile',
                    status: 'executed',
                    summary: '已写入 server.py'
                  }
                }
              }
            ]
          }
        ]
      }
    });

    const messages = request.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('[assistant_tool_calls]')
    });
    expect(messages[0]).not.toHaveProperty('tool_calls');
    expect(messages[1]).toEqual({
      role: 'user',
      content: '等等'
    });
    expect(messages[2]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('[tool_result:writeDesktopFile]')
    });
  });

  it('rehydrates Gemini thought signatures for OpenAI-compatible Gemini routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'google/gemini-3.1-pro-preview'
      }),
      context: createContextWithGeminiToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: '我先动手。',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'patchRawCss',
            arguments: '{"css":"body { color: red; }"}'
          },
          extra_content: {
            google: {
              thought_signature: 'sig-a'
            }
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'patchRawCss',
        content: '{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}'
      },
      {
        role: 'user',
        content: '再柔一点'
      }
    ]);
  });

  it('uses transcript tool history for unsupported OpenAI-compatible Gemini signature routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        baseUrl: 'https://relay.example.com/v1',
        model: 'google/gemini-3.1-pro-preview',
        capabilities: {
          images: false,
          streaming: true,
          thinking: true
        }
      }),
      context: createContextWithGeminiToolHistory(),
      advanced: createAdvanced({
        thinkingBudget: '1024'
      })
    });

    expect(request.body.thinking).toEqual({ budget_tokens: 1024 });
    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: `我先动手。\n\n[assistant_tool_calls]\n\n[
  {
    "id": "call-1",
    "name": "patchRawCss",
    "arguments": "{\\"css\\":\\"body { color: red; }\\"}"
  }
]`
      },
      {
        role: 'user',
        content: '[tool_result:patchRawCss]\n\n{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}\n\n再柔一点'
      }
    ]);
  });

  it('does not send Gemini thought signatures to non-Gemini OpenAI-compatible routes', () => {
    const request = buildApiRequest({
      api: createProvider({
        model: 'gpt-5-mini'
      }),
      context: createContextWithGeminiToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: '我先动手。',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'patchRawCss',
            arguments: '{"css":"body { color: red; }"}'
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        name: 'patchRawCss',
        content: '{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}'
      },
      {
        role: 'user',
        content: '再柔一点'
      }
    ]);
  });

  it('can degrade OpenAI-compatible tool history into plain transcript messages', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: createContextWithToolHistory(),
      openAiToolHistoryMode: 'transcript'
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: `我先动手。\n\n[assistant_tool_calls]\n\n[
  {
    "id": "call-1",
    "name": "patchRawCss",
    "arguments": "{\\"css\\":\\"body { color: red; }\\"}"
  }
]`
      },
      {
        role: 'user',
        content: '[tool_result:patchRawCss]\n\n{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}\n\n再柔一点'
      }
    ]);
  });

  it('folds system diagnostics into user context in transcript mode', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
        ...createContext('auto'),
        segments: [
          {
            kind: 'conversation',
            messages: [
              { role: 'user', content: '你好' },
              {
                role: 'system',
                content: '[Polaris 本地请求诊断]\n上一轮 provider 请求失败。'
              },
              { role: 'user', content: '还在吗' }
            ]
          }
        ]
      },
      openAiToolHistoryMode: 'transcript'
    });

    expect(request.body.messages).toEqual([
      {
        role: 'user',
        content: '你好\n\n还在吗\n\n[system_context]\n[Polaris 本地请求诊断]\n上一轮 provider 请求失败。'
      }
    ]);
  });

  it('rehydrates assistant tool call history for anthropic requests', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4'
      }),
      context: createContextWithToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先动手。' },
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'patchRawCss',
            input: { css: 'body { color: red; }' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: '{"toolName":"patchRawCss","status":"applied","kind":"patchRawCss","summary":"body { color: red; }"}'
          },
          {
            type: 'text',
            text: '再柔一点'
          }
        ]
      }
    ]);
  });

  it('rehydrates Gemini native tool history with thought signatures', () => {
    const request = buildApiRequest({
      api: createProvider({
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
      context: createContextWithGeminiToolHistory()
    });

    expect(request.provider).toBe('gemini-generate-content');
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
  });

  it('sanitizes Gemini native function declaration schemas to Gemini-supported fields', () => {
    const request = buildApiRequest({
      api: createProvider({
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
      context: createContextWithGeminiUnsafeToolSchema('auto')
    });

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
  });

  it('preserves room tool history names for OpenAI-native requests', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: createContextWithLegacyProjectFileToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: '我先继续。',
        tool_calls: [{
          id: 'call-project-file-1',
          type: 'function',
          function: {
            name: 'appendCodeCard',
            arguments: '{"projectId":"white-cat-box","filePath":"script.js","code":"const part = "}'
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: 'call-project-file-1',
        name: 'appendCodeCard',
        content: '{"toolName":"appendCodeCard","status":"executed","kind":"appendCodeCard","summary":"已续写工作区文件 · script.js"}'
      },
      {
        role: 'user',
        content: '继续写'
      }
    ]);
  });

  it('preserves room tool history names in transcript mode too', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: createContextWithLegacyProjectFileToolHistory(),
      openAiToolHistoryMode: 'transcript'
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: `我先继续。\n\n[assistant_tool_calls]\n\n[
  {
    "id": "call-project-file-1",
    "name": "appendCodeCard",
    "arguments": "{\\"projectId\\":\\"white-cat-box\\",\\"filePath\\":\\"script.js\\",\\"code\\":\\"const part = \\"}"
  }
]`
      },
      {
        role: 'user',
        content: '[tool_result:appendCodeCard]\n\n{"toolName":"appendCodeCard","status":"executed","kind":"appendCodeCard","summary":"已续写工作区文件 · script.js"}\n\n继续写'
      }
    ]);
  });

  it('preserves room tool history names for anthropic requests too', () => {
    const request = buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com/v1',
        path: '/messages',
        model: 'claude-sonnet-4'
      }),
      context: createContextWithLegacyProjectFileToolHistory()
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先继续。' },
          {
            type: 'tool_use',
            id: 'call-project-file-1',
            name: 'appendCodeCard',
            input: {
              projectId: 'white-cat-box',
              filePath: 'script.js',
              code: 'const part = '
            }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-project-file-1',
            content: '{"toolName":"appendCodeCard","status":"executed","kind":"appendCodeCard","summary":"已续写工作区文件 · script.js"}'
          },
          {
            type: 'text',
            text: '继续写'
          }
        ]
      }
    ]);
  });

  it('prefers paired tool results when legacy project-file calls have only active targets', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: createContextWithLegacyActiveProjectFileToolHistory(),
      openAiToolHistoryMode: 'transcript'
    });

    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: `我先继续。\n\n[assistant_tool_calls]\n\n[
  {
    "id": "call-project-file-active-1",
    "name": "appendProjectFile",
    "arguments": "{\\"target\\":\\"active\\",\\"code\\":\\"const part = \\"}"
  }
]`
      },
      {
        role: 'user',
        content: '[tool_result:appendProjectFile]\n\n{"toolName":"appendProjectFile","status":"executed","kind":"appendProjectFile","summary":"已续写工作区文件 · index.html"}\n\n继续写'
      }
    ]);
  });

  it('fails locally when an anthropic request has no non-system messages', () => {
    expect(() => buildApiRequest({
      api: createProvider({
        protocol: 'anthropic-messages',
        baseUrl: 'https://www.packyapi.com/v1',
        path: '/messages',
        model: 'claude-opus-4-6'
      }),
      context: {
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
            kind: 'system',
            messages: [
              {
                role: 'system',
                content: '你是稳定的人格核心。'
              }
            ]
          }
        ]
      }
    })).toThrow('field messages is required');
  });

  it('keeps material read details in tool_result content payloads', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
        memorySlots: {
          session: [],
          profile: [],
          pin: []
        },
        attachmentSlots: {
          enabled: true,
          pending: [{ id: 'att-1', kind: 'file', name: '设定.txt' }]
        },
        segments: [{
          kind: 'conversation',
          messages: [
            {
              role: 'user',
              content: '帮我看这个附件',
            },
            {
              role: 'assistant',
              content: '我先翻一下。',
              toolCalls: [{
                id: 'call-read-1',
                name: 'readAttachmentText',
                argumentsText: '{"target":"设定.txt"}'
              }]
            },
            {
              role: 'tool',
              content: '[工具结果：读附件]\n\n附件：设定.txt\n\n第一行\n第二行',
              toolResult: {
                schemaVersion: 1,
                toolCallId: 'call-read-1',
                toolName: 'readAttachmentText',
                status: 'executed',
                structuredPayload: {
                  kind: 'readAttachmentText',
                  status: 'executed',
                  summary: '已读取：设定.txt',
                  detailText: '附件：设定.txt\n\n第一行\n第二行'
                }
              }
            }
          ]
        }]
      }
    });
    const messages = request.body.messages as Array<unknown>;

    expect(messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call-read-1',
      name: 'readAttachmentText',
      content: '{"toolName":"readAttachmentText","status":"executed","kind":"readAttachmentText","summary":"已读取：设定.txt","detailText":"附件：设定.txt\\n\\n第一行\\n第二行"}'
    });
  });

  it('keeps structured workspace write evidence in provider tool_result payloads', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
        memorySlots: {
          session: [],
          profile: [],
          pin: []
        },
        attachmentSlots: {
          enabled: false,
          pending: []
        },
        segments: [{
          kind: 'conversation',
          messages: [
            {
              role: 'assistant',
              content: '我先改文件。',
              toolCalls: [{
                id: 'call-workspace-write-1',
                name: 'appendProjectFile',
                argumentsText: '{"projectId":"project-1","filePath":"styles/main.css","code":"body { color: red; }"}'
              }]
            },
            {
              role: 'tool',
              content: '[工具结果：已续写工作区文件]\n\n已续写工作区文件 · styles/main.css',
              toolResult: {
                schemaVersion: 1,
                toolCallId: 'call-workspace-write-1',
                toolName: 'appendProjectFile',
                status: 'executed',
                structuredPayload: {
                  kind: 'appendProjectFile',
                  status: 'executed',
                  summary: '已续写工作区文件 · styles/main.css',
                  projectFileEffects: [{
                    projectId: 'project-1',
                    fileId: 'file-css',
                    filePath: 'styles/main.css',
                    operation: 'appended',
                    beforeLines: 12,
                    afterLines: 18,
                    changedLines: { start: 13, end: 18 },
                    afterExcerptStartLine: 16,
                    afterExcerptEndLine: 18,
                    afterExcerpt: '16: body {\n17:   color: red;\n18: }',
                    insertedChars: 22
                  }]
                }
              }
            },
            {
              role: 'user',
              content: '继续接着改'
            }
          ]
        }]
      }
    });
    const messages = request.body.messages as Array<{ content?: string }>;
    const payload = JSON.parse(messages[1]?.content ?? '{}') as Record<string, unknown>;

    expect(payload).toMatchObject({
      toolName: 'appendProjectFile',
      status: 'executed',
      kind: 'appendProjectFile',
      summary: '已续写工作区文件 · styles/main.css',
      projectFileEffects: [{
        projectId: 'project-1',
        fileId: 'file-css',
        filePath: 'styles/main.css',
        operation: 'appended',
        beforeLines: 12,
        afterLines: 18,
        changedLines: { start: 13, end: 18 },
        afterExcerptStartLine: 16,
        afterExcerptEndLine: 18,
        afterExcerpt: '16: body {\n17:   color: red;\n18: }',
        insertedChars: 22
      }]
    });
    expect(messages[1]?.content).not.toContain('[工具结果：已续写工作区文件]');
  });

  it('omits raw execution details from action tool_result history', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
        memorySlots: {
          session: [],
          profile: [],
          pin: []
        },
        attachmentSlots: {
          enabled: false,
          pending: []
        },
        segments: [{
          kind: 'conversation',
          messages: [
            {
              role: 'assistant',
              content: '我先换一下。',
              toolCalls: [{
                id: 'call-theme-1',
                name: 'patchRawCss',
                argumentsText: '{"css":"body { color: red; }"}'
              }]
            },
            {
              role: 'tool',
              content: '[工具结果：应用 CSS]\n\n.raw-css { color: red; }',
              toolResult: {
                schemaVersion: 1,
                toolCallId: 'call-theme-1',
                toolName: 'patchRawCss',
                status: 'applied',
                structuredPayload: {
                  kind: 'patchRawCss',
                  status: 'applied',
                  title: '应用 CSS',
                  summary: '已应用一段 CSS。',
                  detailText: '.raw-css { color: red; }'
                }
              }
            },
            {
              role: 'user',
              content: '继续'
            }
          ]
        }]
      }
    });
    const messages = request.body.messages as Array<{ role: string; content: string }>;

    expect(messages[1]?.content).toContain('"summary":"已应用一段 CSS。"');
    expect(messages[1]?.content).toContain('"detailOmitted":true');
    expect(messages[1]?.content).not.toContain('.raw-css');
  });

  it('sanitizes lone surrogate code units before building provider bodies', () => {
    const request = buildApiRequest({
      api: createProvider({}),
      context: {
        memorySlots: {
          session: [],
          profile: [],
          pin: []
        },
        attachmentSlots: {
          enabled: false,
          pending: []
        },
        segments: [{
          kind: 'conversation',
          messages: [
            {
              role: 'assistant',
              content: `坏字符高位\uD83D`,
              toolCalls: [{
                id: 'call-broken-1',
                name: 'patchRawCss',
                argumentsText: `{"css":"坏字符低位\uDE00"}`
              }]
            },
            {
              role: 'tool',
              content: `坏字符工具结果\uDE00`,
              toolResult: {
                schemaVersion: 1,
                toolCallId: 'call-broken-1',
                toolName: 'patchRawCss',
                status: 'failed',
                structuredPayload: {
                  kind: 'patchRawCss',
                  status: 'failed',
                  detailText: `坏字符详情\uD83D`
                }
              }
            },
            {
              role: 'user',
              content: `继续看这个\uDE00`
            }
          ]
        }]
      }
    });

    const messages = request.body.messages as Array<{
      role: string;
      content: string;
      tool_calls?: Array<{ function: { arguments: string } }>;
    }>;
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: '坏字符高位�'
    });
    expect(messages[0]?.tool_calls?.[0]?.function.arguments).toBe('{"css":"坏字符低位�"}');
    expect(messages[2]).toMatchObject({
      role: 'user',
      content: '继续看这个�'
    });
    expect(JSON.stringify(request.body)).not.toMatch(/[\uD800-\uDFFF]/);
  });
});
