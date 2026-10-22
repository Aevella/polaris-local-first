import { describe, expect, it } from 'vitest';
import {
  normalizeOpenAiToolCalls,
  serializeProviderToolArguments,
  validateProviderToolCallTermination
} from './providerRuntimeToolCallResponse';

describe('serializeProviderToolArguments', () => {
  it('normalizes missing and empty arguments to an object root', () => {
    expect(serializeProviderToolArguments(undefined)).toBe('{}');
    expect(serializeProviderToolArguments('')).toBe('{}');
    expect(serializeProviderToolArguments({})).toBe('{}');
  });

  it('preserves strings and serializes structured arguments', () => {
    expect(serializeProviderToolArguments('{"target":"card-1"}')).toBe('{"target":"card-1"}');
    expect(serializeProviderToolArguments({ target: 'card-1' })).toBe('{"target":"card-1"}');
  });
});

describe('normalizeOpenAiToolCalls', () => {
  it('accepts nested and flattened relay tool-call shapes', () => {
    expect(normalizeOpenAiToolCalls([
      {
        index: 4,
        id: 'call_nested',
        function: {
          name: 'readMemoryDoc',
          arguments: { docId: 'memory-1' }
        }
      },
      {
        id: 'call_flat',
        name: 'readProjectFile',
        arguments: '{"target":"active"}'
      }
    ], 'complete')).toEqual([
      expect.objectContaining({
        id: 'call_nested',
        name: 'readMemoryDoc',
        index: 4,
        argumentsKind: 'snapshot',
        argumentsText: '{"docId":"memory-1"}'
      }),
      expect.objectContaining({
        id: 'call_flat',
        name: 'readProjectFile',
        index: 1,
        argumentsKind: 'snapshot',
        argumentsText: '{"target":"active"}'
      })
    ]);
  });

  it('preserves empty string deltas without turning them into object snapshots', () => {
    expect(normalizeOpenAiToolCalls([{
      index: 0, function: { arguments: '' }
    }], 'delta')[0]).toMatchObject({ argumentsKind: 'delta', argumentsText: '' });
    expect(normalizeOpenAiToolCalls([{
      index: 0, function: { arguments: '' }
    }], 'complete')[0]).toMatchObject({ argumentsKind: 'snapshot', argumentsText: '{}' });
  });

  it('distinguishes incremental strings from relay snapshots', () => {
    expect(normalizeOpenAiToolCalls([{
      index: 0,
      function: { name: 'readMemoryDoc', arguments: '{"docId":' }
    }], 'delta')[0]).toEqual(expect.objectContaining({
      argumentsKind: 'delta',
      argumentsText: '{"docId":'
    }));

    expect(normalizeOpenAiToolCalls([{
      index: 0,
      function: { arguments: {} }
    }], 'delta')[0]).toEqual(expect.objectContaining({
      argumentsKind: 'snapshot',
      argumentsText: '{}'
    }));
  });
});

describe('validateProviderToolCallTermination', () => {
  it('rejects a declared tool finish without a decoded call', () => {
    expect(() => validateProviderToolCallTermination({
      finishReason: 'tool_calls',
      toolCalls: []
    })).toThrow('中转是否完整转发 tool_calls');
  });

  it('does not confuse a transport truncation with a missing tool body', () => {
    expect(() => validateProviderToolCallTermination({
      finishReason: 'length',
      toolCalls: []
    })).not.toThrow();
  });
});
