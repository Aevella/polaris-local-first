import { describe, expect, it } from 'vitest';
import { assembleAssistantContext } from '../request/requestContext';
import { buildAnthropicRequest } from './providerRuntimeAnthropicAdapter';
import { buildGeminiNativeRequest } from './providerRuntimeGeminiAdapter';
import { createProviderRuntimeAdvanced, createProviderRuntimeTestContext, createProviderRuntimeTestProvider } from './providerRuntimeFixtures';

function contextForTurn(turn: number) {
  return assembleAssistantContext({
    systemPrompts: ['Stable identity'],
    memoryLines: ['Stable confirmed memory'],
    messages: [
      { id: 'u1', role: 'user', content: 'Earlier question', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Earlier answer', timestamp: 2 },
      ...Array.from({ length: turn - 1 }, (_, index) => [
        { id: `latest-${index + 1}`, role: 'user' as const, content: `Current question ${index + 1}`, timestamp: 3 + index * 2 },
        { id: `answer-${index + 1}`, role: 'assistant' as const, content: `Current answer ${index + 1}`, timestamp: 4 + index * 2 }
      ]).flat(),
      { id: `latest-${turn}`, role: 'user', content: `Current question ${turn}`, timestamp: 3 + (turn - 1) * 2 }
    ],
    systemPromptParts: [
      { name: 'system_identity', layer: 'identity', content: 'Stable identity' },
      { name: 'runtime_clock_context', layer: 'context', content: `<runtime_clock turn="${turn}" />` }
    ],
    semanticRecallCandidates: [{
      id: 'old', label: 'Old room', kind: 'recent_tail', sourceConversationId: 'old-room',
      sourceMessageIds: ['old-user'], score: null, text: `Moving background ${turn}`
    }]
  });
}

describe('native provider context stability across turns', () => {
  it.each(['anthropic', 'gemini'] as const)('keeps %s stable system and completed history unchanged', (protocol) => {
    const requests = [1, 2, 3].map((turn) => {
      const common = { context: contextForTurn(turn), advanced: createProviderRuntimeAdvanced() };
      return protocol === 'anthropic'
        ? buildAnthropicRequest({ ...common, api: createProviderRuntimeTestProvider({ protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', path: '/messages', model: 'claude-sonnet-4-5' }) }).body
        : buildGeminiNativeRequest({ ...common, api: createProviderRuntimeTestProvider({ protocol: 'gemini-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-pro' }) }).body;
    });
    const systemKey = protocol === 'anthropic' ? 'system' : 'systemInstruction';
    const historyKey = protocol === 'anthropic' ? 'messages' : 'contents';
    for (const [index, request] of requests.entries()) {
      expect(request[systemKey]).toEqual(requests[0][systemKey]);
      expect(JSON.stringify(request[systemKey])).not.toContain('Moving background');
      const history = request[historyKey] as unknown[];
      expect(history.slice(0, 2)).toEqual((requests[0][historyKey] as unknown[]).slice(0, 2));
      if (index > 0) {
        const previous = requests[index - 1][historyKey] as unknown[];
        const completedCount = 2 + (index - 1) * 2;
        expect(history.slice(0, completedCount)).toEqual(previous.slice(0, completedCount));
      }
      const tail = JSON.stringify(history.slice(2));
      expect(tail).toContain(`[request_context]`);
      expect(tail).toContain(`Moving background ${index + 1}`);
      expect(tail.lastIndexOf(`Current question ${index + 1}`)).toBeGreaterThan(tail.indexOf(`Moving background ${index + 1}`));
      expect(tail).toContain('runtime_clock');
    }
  });
});


describe('dynamic background during native tool continuation', () => {
  it('keeps Claude tool use and result adjacent after the current user', () => {
    const context = createProviderRuntimeTestContext({ withToolHistory: true });
    context.segments.unshift({ kind: 'semantic_recall', messages: [{ role: 'system', promptPartLayer: 'context', content: 'Background only' }] });
    const request = buildAnthropicRequest({ context, api: createProviderRuntimeTestProvider({ protocol: 'anthropic-messages' }) });
    const messages = request.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(messages[0])).toContain('Background only');
    expect(JSON.stringify(messages[1])).toContain('"type":"tool_use"');
    expect(JSON.stringify(messages[2])).toContain('"type":"tool_result"');
    expect(JSON.stringify(messages.slice(1))).not.toContain('Background only');
  });
});
