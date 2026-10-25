import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../types/domain';
import {
  buildThinkingTranslationRequestContext,
  parseThinkingTranslationOutput,
  requestThinkingTranslation
} from './thinkingTranslation';

const sections = [
  { id: 'thought-1', text: 'I should inspect the owner first.' },
  { id: 'tool-1', text: 'Read the current source.' }
];

const api = {
  id: 'provider-1',
  name: 'Provider',
  protocol: 'openai-completions',
  apiKey: 'key',
  baseUrl: 'https://example.com',
  path: '/v1/chat/completions',
  model: 'model-1',
  capabilities: {
    images: false,
    streaming: true,
    thinking: false
  }
} satisfies ProviderProfile;

describe('buildThinkingTranslationRequestContext', () => {
  it('builds a no-tool request containing only translation material', () => {
    const context = buildThinkingTranslationRequestContext(sections, '简体中文');

    expect(context.toolChoice).toBe('none');
    expect(context.tools).toEqual([]);
    expect(context.memorySlots).toEqual({ session: [], profile: [], pin: [] });
    expect(context.segments).toHaveLength(2);
    expect(context.segments[1].messages[0].content).toContain('thought-1');
  });
});

describe('parseThinkingTranslationOutput', () => {
  it('accepts fenced JSON and maps translations by local source id', () => {
    expect(parseThinkingTranslationOutput(
      '```json\n{"translations":[{"id":"thought-1","text":"先检查职责。"},{"id":"tool-1","text":"读取当前源码。"}]}\n```',
      sections
    )).toEqual({
      'thought-1': '先检查职责。',
      'tool-1': '读取当前源码。'
    });
  });

  it('rejects partial model output instead of silently mixing languages', () => {
    expect(() => parseThinkingTranslationOutput(
      '{"translations":[{"id":"thought-1","text":"先检查职责。"}]}',
      sections
    )).toThrow('翻译结果缺少部分思考内容');
  });
});

describe('requestThinkingTranslation', () => {
  it('uses the selected route without tools, streaming, or another thinking pass', async () => {
    const requestReply = vi.fn(async () => ({
      content: '{"translations":[{"id":"thought-1","text":"先检查职责。"},{"id":"tool-1","text":"读取当前源码。"}]}'
    }));

    await requestThinkingTranslation({
      api,
      advanced: {
        providerId: api.id,
        modelOverride: api.model,
        temperature: '0.8',
        topP: '0.9',
        maxTokens: '4000',
        thinkingBudget: '2000',
        contextMessageLimit: '12',
        showThinking: true,
        streaming: true,
        customHeaders: '{"X-Route":"keep"}',
        customBody: '{"route":"keep"}',
        regexRules: 'replace me',
        snippets: ['replace me']
      },
      sections,
      targetLanguage: '简体中文',
      requestReply
    });

    expect(requestReply).toHaveBeenCalledWith(expect.objectContaining({
      api,
      advanced: expect.objectContaining({
        showThinking: false,
        streaming: false,
        maxTokens: '',
        contextMessageLimit: '',
        customHeaders: '{"X-Route":"keep"}',
        customBody: '{"route":"keep"}'
      }),
      context: expect.objectContaining({ toolChoice: 'none', tools: [] })
    }));
  });
});
