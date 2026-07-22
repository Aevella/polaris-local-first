import type { ProviderHttpRequest } from './providerRuntimeTypes';

export type OpenAiToolHistoryMode = 'native' | 'transcript';

const OPENAI_TOOL_HISTORY_SEQUENCE_ERROR_PATTERN =
  /Messages with role ['"]tool['"] must be a response to a preceding message with ['"]tool_calls['"]|assistant message with ['"]?tool_?calls['"]? must be followed by tool messages responding to each ['"]?tool_?call_?id['"]?/i;
const OPENAI_TOOL_HISTORY_ARGUMENTS_ERROR_PATTERN =
  /unexpected end of data|unexpected end of json input|unterminated string/i;
const OPENAI_TOOL_HISTORY_GENERIC_FORMAT_ERROR_PATTERN =
  /格式不正确|format(?:ting)? (?:is )?incorrect|malformed|unable to read data|invalid(?:[_\s-]request)?/i;
const EMPTY_API_400_ERROR_PATTERN = /^API 400:\s*$/i;
const EMPTY_TOOL_HISTORY_RESPONSE_PATTERN = /^API 返回为空(?::|：|$)/i;

function getRequestMessages(request: ProviderHttpRequest) {
  return Array.isArray(request.body.messages) ? request.body.messages : [];
}

function messageContainsNativeToolHistory(message: unknown) {
  if (!message || typeof message !== 'object') return false;
  const role = (message as { role?: unknown }).role;
  return role === 'tool' || Array.isArray((message as { tool_calls?: unknown }).tool_calls);
}

function requestContainsNativeToolHistory(request: ProviderHttpRequest) {
  return getRequestMessages(request).some(messageContainsNativeToolHistory);
}

function toolArgumentsLookMalformed(argumentsText: unknown) {
  if (typeof argumentsText !== 'string') return true;
  const trimmed = argumentsText.trim();
  if (!trimmed) return false;

  try {
    const parsed = JSON.parse(trimmed);
    return !parsed || typeof parsed !== 'object' || Array.isArray(parsed);
  } catch {
    return true;
  }
}

function requestContainsMalformedNativeToolArguments(request: ProviderHttpRequest) {
  return getRequestMessages(request).some((message) => {
    if (!message || typeof message !== 'object') return false;
    const toolCalls = (message as {
      tool_calls?: Array<{
        function?: {
          arguments?: unknown;
        };
      }>;
    }).tool_calls;
    if (!Array.isArray(toolCalls)) return false;
    return toolCalls.some((toolCall) => toolArgumentsLookMalformed(toolCall?.function?.arguments));
  });
}

function readMessageRole(message: unknown) {
  return message && typeof message === 'object'
    ? (message as { role?: unknown }).role
    : undefined;
}

function readToolCalls(message: unknown) {
  if (!message || typeof message !== 'object') return [];
  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(toolCalls) ? toolCalls : [];
}

function readToolCallId(toolCall: unknown) {
  return toolCall && typeof toolCall === 'object'
    ? (toolCall as { id?: unknown }).id
    : undefined;
}

function readToolResultCallId(message: unknown) {
  return message && typeof message === 'object'
    ? (message as { tool_call_id?: unknown }).tool_call_id
    : undefined;
}

function requestContainsInvalidNativeToolSequence(request: ProviderHttpRequest) {
  const messages = getRequestMessages(request);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const role = readMessageRole(message);

    if (role === 'tool') {
      return true;
    }

    const toolCalls = readToolCalls(message);
    if (toolCalls.length === 0) {
      continue;
    }

    const requiredToolCallIds = new Set<string>();
    for (const toolCall of toolCalls) {
      const toolCallId = readToolCallId(toolCall);
      if (typeof toolCallId !== 'string' || !toolCallId.trim()) {
        return true;
      }
      if (requiredToolCallIds.has(toolCallId)) {
        return true;
      }
      requiredToolCallIds.add(toolCallId);
    }

    let nextIndex = index + 1;
    while (requiredToolCallIds.size > 0) {
      const nextMessage = messages[nextIndex];
      if (readMessageRole(nextMessage) !== 'tool') {
        return true;
      }

      const toolCallId = readToolResultCallId(nextMessage);
      if (typeof toolCallId !== 'string' || !requiredToolCallIds.has(toolCallId)) {
        return true;
      }

      requiredToolCallIds.delete(toolCallId);
      nextIndex += 1;
    }

    index = nextIndex - 1;
  }

  return false;
}

export function shouldUseTranscriptToolHistoryForRequest(
  request: ProviderHttpRequest,
  currentMode: OpenAiToolHistoryMode
) {
  if (currentMode !== 'native') return false;
  if (request.provider !== 'openai-completions') return false;
  if (!requestContainsNativeToolHistory(request)) return false;
  return requestContainsMalformedNativeToolArguments(request) || requestContainsInvalidNativeToolSequence(request);
}

export function shouldRetryWithTranscriptToolHistory(
  request: ProviderHttpRequest,
  error: unknown,
  sawProgress: boolean,
  currentMode: OpenAiToolHistoryMode
) {
  if (currentMode !== 'native') return false;
  if (request.provider !== 'openai-completions') return false;
  if (sawProgress) return false;
  if (!(error instanceof Error)) return false;
  if (!requestContainsNativeToolHistory(request)) {
    return false;
  }

  return (
    OPENAI_TOOL_HISTORY_SEQUENCE_ERROR_PATTERN.test(error.message)
    || EMPTY_API_400_ERROR_PATTERN.test(error.message)
    || EMPTY_TOOL_HISTORY_RESPONSE_PATTERN.test(error.message)
    || (
      requestContainsMalformedNativeToolArguments(request)
      && OPENAI_TOOL_HISTORY_ARGUMENTS_ERROR_PATTERN.test(error.message)
    )
    || OPENAI_TOOL_HISTORY_GENERIC_FORMAT_ERROR_PATTERN.test(error.message)
  );
}
