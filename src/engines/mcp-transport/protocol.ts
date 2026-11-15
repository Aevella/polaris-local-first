import type {
  JsonRpcId,
  JsonRpcMessage
} from './types';

export type McpAuthorizationChallenge = {
  scheme: 'Bearer';
  resourceMetadataUrl?: string;
  scope?: string;
};

export class McpHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly wwwAuthenticate: string | null;
  readonly authorizationChallenge: McpAuthorizationChallenge | null;

  constructor(args: {
    message: string;
    status: number;
    responseBody: string;
    wwwAuthenticate: string | null;
    authorizationChallenge: McpAuthorizationChallenge | null;
  }) {
    super(args.message);
    this.name = 'McpHttpError';
    this.status = args.status;
    this.responseBody = args.responseBody;
    this.wwwAuthenticate = args.wwwAuthenticate;
    this.authorizationChallenge = args.authorizationChallenge;
  }
}

function readBearerParameter(value: string, name: string) {
  const pattern = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(?:"((?:\\\\.|[^"])*)"|([^,\\s]+))`, 'i');
  const match = value.match(pattern);
  const raw = match?.[1] ?? match?.[2];
  return raw?.replace(/\\([\\"])/g, '$1');
}

export function parseMcpAuthorizationChallenge(
  wwwAuthenticate: string | null,
  responseBody = ''
): McpAuthorizationChallenge | null {
  const bearer = wwwAuthenticate?.match(/(?:^|,)\s*Bearer\b([^]*)/i);
  let resourceMetadataUrl = bearer ? readBearerParameter(bearer[1] ?? '', 'resource_metadata') : undefined;
  let scope = bearer ? readBearerParameter(bearer[1] ?? '', 'scope') : undefined;

  if (!resourceMetadataUrl && responseBody) {
    try {
      const parsed = JSON.parse(responseBody) as Record<string, unknown>;
      if (typeof parsed.resource_metadata === 'string') {
        resourceMetadataUrl = parsed.resource_metadata;
      }
      if (!scope && typeof parsed.scope === 'string') {
        scope = parsed.scope;
      }
    } catch {
      // Keep non-JSON error bodies in the ordinary HTTP error message.
    }
  }

  if (!bearer && !resourceMetadataUrl) return null;
  return {
    scheme: 'Bearer',
    ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
    ...(scope ? { scope } : {})
  };
}

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export const MCP_CLIENT_INFO = {
  name: 'Polaris',
  version: '0.1.0'
} as const;

export function createRpcId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createTimeoutError(label: string, timeoutMs: number) {
  return new Error(`${label} 超时（${Math.ceil(timeoutMs / 1000)} 秒）。`);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(createTimeoutError(label, timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRpcMessage;
}

export function findResponseMessage(
  payload: unknown,
  expectedId: JsonRpcId
): JsonRpcMessage | null {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const next = findResponseMessage(entry, expectedId);
      if (next) return next;
    }
    return null;
  }

  const message = parseJsonRpcMessage(payload);
  if (!message || message.id !== expectedId) return null;
  return message;
}

export function ensureSuccessMessage(message: JsonRpcMessage | null, label: string) {
  if (!message) {
    throw new Error(`${label} 没有返回有效响应。`);
  }
  if (message.error) {
    throw new Error(`${label} 失败：${message.error.message || '未知错误'}`);
  }
  return message;
}

export function parseSseEvents(text: string) {
  const events: Array<{ event: string; data: string }> = [];
  const normalized = text.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) continue;
    events.push({
      event: eventName,
      data: dataLines.join('\n')
    });
  }

  return events;
}

function dispatchJsonRpcFromSseData(
  rawData: string,
  expectedId: JsonRpcId
): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    return findResponseMessage(parsed, expectedId);
  } catch {
    return null;
  }
}

async function readSseResponseForId(
  response: Response,
  expectedId: JsonRpcId,
  label: string
) {
  const bodyText = await response.text();
  const events = parseSseEvents(bodyText);

  for (const event of events) {
    if (event.event !== 'message') continue;
    const match = dispatchJsonRpcFromSseData(event.data, expectedId);
    if (match) return match;
  }

  throw new Error(`${label} 没有在 SSE 响应里拿到结果。`);
}

export async function parseHttpJsonRpcResponse(
  response: Response,
  expectedId: JsonRpcId,
  label: string
) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const wwwAuthenticate = response.headers.get('www-authenticate');
    throw new McpHttpError({
      message: `${label} 失败：HTTP ${response.status}${errorText ? ` · ${errorText.trim()}` : ''}`,
      status: response.status,
      responseBody: errorText,
      wwwAuthenticate,
      authorizationChallenge: response.status === 401
        ? parseMcpAuthorizationChallenge(wwwAuthenticate, errorText)
        : null
    });
  }

  if (response.status === 202) {
    return null;
  }

  if (contentType.includes('text/event-stream')) {
    return await readSseResponseForId(response, expectedId, label);
  }

  const parsed = await response.json().catch(() => null);
  const matched = findResponseMessage(parsed, expectedId);
  if (!matched) {
    throw new Error(`${label} 返回了无法识别的 JSON-RPC 结果。`);
  }
  return matched;
}
