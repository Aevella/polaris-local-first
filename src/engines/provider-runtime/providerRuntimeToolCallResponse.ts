export type ProviderToolCallWireShape = 'delta' | 'complete';

export type NormalizedOpenAiToolCall = {
  id: string;
  name: string;
  index?: number;
  fallbackIndex: number;
  argumentsKind: 'missing' | 'delta' | 'snapshot';
  argumentsText: string;
  raw: Record<string, unknown>;
};

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function serializeProviderToolArguments(value: unknown) {
  if (typeof value === 'string') return value || '{}';
  if (value === undefined) return '{}';

  try {
    return JSON.stringify(value) ?? '{}';
  } catch {
    return '{}';
  }
}

export function normalizeOpenAiToolCalls(
  rawToolCalls: unknown,
  shape: ProviderToolCallWireShape
): NormalizedOpenAiToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];

  return rawToolCalls.flatMap((rawValue, offset) => {
    const raw = readObject(rawValue);
    if (!raw) return [];

    const nestedFunction = readObject(raw.function);
    const argumentPayload = nestedFunction && hasOwn(nestedFunction, 'arguments')
      ? nestedFunction
      : raw;
    const index = typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 0
      ? raw.index
      : shape === 'complete'
        ? offset
        : undefined;
    const hasArguments = hasOwn(argumentPayload, 'arguments');
    const argumentsValue = argumentPayload.arguments;
    // Stream strings are fragments, including empty strings. Only complete
    // payloads and structured relay snapshots use object-root serialization.
    const isStringDelta = shape === 'delta' && typeof argumentsValue === 'string';
    const argumentsText = hasArguments
      ? isStringDelta
        ? argumentsValue
        : serializeProviderToolArguments(argumentsValue)
      : shape === 'complete'
        ? '{}'
        : '';
    const argumentsKind = !hasArguments && shape === 'delta'
      ? 'missing' as const
      : isStringDelta
        ? 'delta' as const
        : 'snapshot' as const;

    return [{
      id: typeof raw.id === 'string' ? raw.id : '',
      name: typeof nestedFunction?.name === 'string'
        ? nestedFunction.name
        : typeof raw.name === 'string'
          ? raw.name
          : '',
      index,
      fallbackIndex: offset,
      argumentsKind,
      argumentsText,
      raw
    }];
  });
}

const TOOL_CALL_FINISH_REASONS = new Set([
  'tool_calls',
  'tool_call',
  'tool_use',
  'function_call'
]);

export function validateProviderToolCallTermination(input: {
  finishReason?: string;
  toolCalls?: Array<{ name?: string }>;
}) {
  const finishReason = input.finishReason?.trim().toLowerCase() ?? '';
  if (!TOOL_CALL_FINISH_REASONS.has(finishReason)) return;

  const hasDecodedToolCall = (input.toolCalls ?? []).some((toolCall) => Boolean(toolCall.name?.trim()));
  if (hasDecodedToolCall) return;

  throw new Error('模型服务声明要调用工具，但没有返回可解析的工具调用。请检查中转是否完整转发 tool_calls。');
}
