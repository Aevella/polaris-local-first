import { parseOpenAiCompatibleStreamEvents } from '../provider-runtime/providerRuntimeStreamEvents';
import { appendOpenAiToolCalls } from '../provider-runtime/providerRuntimeResponseToolCalls';
import { extractAssistantNativeToolActions } from '../tool-protocol/assistantToolProtocolParser';
import { describe, expect, it } from 'vitest';
import type { ReplyAccumulator } from '../provider-runtime/providerRuntimeReplyAccumulator';
import { applyProviderRuntimeStreamEvents } from './chatApiCanonicalStreamAccumulator';

function createAccumulator(): ReplyAccumulator {
  return {
    content: '',
    thinkingText: '',
    toolCalls: []
  };
}

describe('applyProviderRuntimeStreamEvents', () => {
  it('keeps the internal tool-call array dense when the first provider index is nonzero', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-1',
      name: 'readMemoryDoc',
      index: 1
    }]);
    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.delta',
      id: 'call-1',
      argumentsDelta: '{"docId":"memory-doc-1"}',
      index: 1
    }]);

    expect(target.toolCalls).toEqual([{
      id: 'call-1',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1"}',
      sourceSpan: {
        transport: 'native',
        index: 1
      }
    }]);
  });

  it('merges later fragments by provider index without materializing skipped slots', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.delta',
      id: '',
      argumentsDelta: '{"target":',
      index: 4
    }]);
    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-4',
      name: 'readProjectFile',
      index: 4
    }, {
      type: 'tool_call.delta',
      id: 'call-4',
      argumentsDelta: '"active"}',
      index: 4
    }]);

    expect(target.toolCalls).toHaveLength(1);
    expect(target.toolCalls?.[0]).toEqual({
      id: 'call-4',
      name: 'readProjectFile',
      argumentsText: '{"target":"active"}',
      sourceSpan: {
        transport: 'native',
        index: 4
      }
    });
  });

  it('keeps parallel id-only tool starts in separate slots', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-a',
      name: 'readMemoryDoc'
    }, {
      type: 'tool_call.start',
      id: 'call-b',
      name: 'readProjectFile'
    }, {
      type: 'tool_call.delta',
      id: 'call-a',
      argumentsDelta: '{"docId":"memory-doc-1"}'
    }, {
      type: 'tool_call.delta',
      id: 'call-b',
      argumentsDelta: '{"target":"active"}'
    }]);

    expect(target.toolCalls?.map((call) => ({
      id: call.id,
      name: call.name,
      argumentsText: call.argumentsText
    }))).toEqual([{
      id: 'call-a',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1"}'
    }, {
      id: 'call-b',
      name: 'readProjectFile',
      argumentsText: '{"target":"active"}'
    }]);
  });
});


describe('OpenAI-compatible empty argument fragments', () => {
  it.each(['canonical', 'response'] as const)('preserves card code through leading, middle and trailing empty fragments in the %s accumulator', (path) => {
    const target = createAccumulator();
    const fragments = ['', '{"title":"demo",', '', '"code":"<main>hello</main>"}', ''];
    for (const argumentsText of fragments) {
      const wire = [{ index: 0, id: 'call-card', function: { name: 'createCodeCard', arguments: argumentsText } }];
      if (path === 'canonical') {
        applyProviderRuntimeStreamEvents(target, parseOpenAiCompatibleStreamEvents({ choices: [{ delta: { tool_calls: wire } }] }));
      } else {
        appendOpenAiToolCalls(target, wire, 'delta');
      }
    }
    expect(target.toolCalls?.[0]?.argumentsText).toBe('{"title":"demo","code":"<main>hello</main>"}');
    const result = extractAssistantNativeToolActions((target.toolCalls ?? []).map(call => ({ id: call.id ?? '', name: call.name ?? '', argumentsText: call.argumentsText })));
    expect(result.issues).toEqual([]);
    expect(result.actions).toMatchObject([{ kind: 'createCodeCard', card: { code: '<main>hello</main>' } }]);
  });
});
