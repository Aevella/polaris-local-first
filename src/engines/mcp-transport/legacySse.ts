import { canUseNativeMcpSse, openNativeMcpSse } from '../../native/mcpSse';
import { buildMcpServerHeaders, getMcpFetchImpl, requestMcpHttp } from './http';
import {
  createRpcId,
  createTimeoutError,
  ensureSuccessMessage,
  findResponseMessage,
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  parseJsonRpcMessage,
  parseSseEvents,
  withTimeout
} from './protocol';
import type {
  InitializeResult,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  McpSessionConnection,
  McpTransportOptions
} from './types';

type PendingSseResponse = {
  resolve: (value: JsonRpcMessage) => void;
  reject: (error: Error) => void;
};

type LegacySseConnection = {
  request: (
    payload: JsonRpcRequest | JsonRpcNotification,
    expectsResponse: boolean
  ) => Promise<JsonRpcMessage | null>;
  close: () => void;
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void
) {
  const reader = stream.getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decodeText(value);
      const normalized = buffer.replace(/\r\n/g, '\n');
      const parts = normalized.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        if (!part.trim()) continue;
        for (const event of parseSseEvents(part + '\n\n')) {
          onEvent(event.event, event.data);
        }
      }
    }

    if (buffer.trim()) {
      for (const event of parseSseEvents(buffer + '\n\n')) {
        onEvent(event.event, event.data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function openLegacySseConnection(
  options: McpTransportOptions
): Promise<LegacySseConnection> {
  const streamController = new AbortController();
  let endpointDeferred: ReturnType<typeof createDeferred<string>> | undefined;
  const pending = new Map<string, PendingSseResponse>();
  let connectionFailure: Error | null = null;
  const dispatchEvent = (eventName: string, data: string) => {
    if (eventName === 'endpoint') {
      endpointDeferred?.resolve(new URL(data.trim(), options.server.url).toString());
      return;
    }
    if (eventName !== 'message') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const dispatch = (entry: unknown) => {
      const message = parseJsonRpcMessage(entry);
      if (!message?.id) return;
      const key = String(message.id);
      const pendingEntry = pending.get(key);
      if (!pendingEntry) return;
      pending.delete(key);
      pendingEntry.resolve(message);
    };

    if (Array.isArray(parsed)) {
      parsed.forEach(dispatch);
      return;
    }
    dispatch(parsed);
  };
  const dispatchError = (error: unknown) => {
    const message = error instanceof Error ? error : new Error('SSE 连接中断。');
    connectionFailure = message;
    endpointDeferred?.reject(message);
    pending.forEach((entry) => entry.reject(message));
    pending.clear();
  };
  let endpoint: string;
  let closeStream: () => void;

  if (!options.fetchImpl && canUseNativeMcpSse()) {
    const nativeConnection = await openNativeMcpSse({
      url: options.server.url,
      headers: Object.fromEntries(buildMcpServerHeaders(options.server, {
        Accept: 'text/event-stream'
      }).entries()),
      timeoutMs: options.timeoutMs,
      onEvent: dispatchEvent,
      onError: dispatchError
    });
    endpoint = nativeConnection.endpoint;
    closeStream = () => {
      void nativeConnection.close();
    };
  } else {
    endpointDeferred = createDeferred<string>();
    const fetchImpl = getMcpFetchImpl(options.fetchImpl);
    const connectTimeoutId = globalThis.setTimeout(
      () => streamController.abort(createTimeoutError(`连接 MCP SSE 服务 ${options.server.name}`, options.timeoutMs)),
      options.timeoutMs
    );
    let response: Response;
    try {
      response = await fetchImpl(options.server.url, {
        method: 'GET',
        headers: buildMcpServerHeaders(options.server, {
          Accept: 'text/event-stream'
        }),
        signal: streamController.signal
      });
    } finally {
      globalThis.clearTimeout(connectTimeoutId);
    }

    if (!response.ok || !response.body) {
      throw new Error(`连接 MCP SSE 服务失败：HTTP ${response.status}`);
    }

    void consumeSseStream(response.body, dispatchEvent)
      .then(() => dispatchError(new Error('MCP SSE 连接已结束。')))
      .catch(dispatchError);
    try {
      endpoint = await withTimeout(
        endpointDeferred.promise,
        options.timeoutMs,
        `等待 MCP SSE 服务 ${options.server.name} 下发 endpoint`
      );
    } catch (error) {
      streamController.abort();
      throw error;
    }
    closeStream = () => streamController.abort();
  }

  const request = async (
    payload: JsonRpcRequest | JsonRpcNotification,
    expectsResponse: boolean
  ): Promise<JsonRpcMessage | null> => {
    if (connectionFailure) throw connectionFailure;
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(createTimeoutError(`调用 MCP SSE 服务 ${options.server.name}`, options.timeoutMs)),
      options.timeoutMs
    );
    const deferred = expectsResponse && 'id' in payload
      ? createDeferred<JsonRpcMessage>()
      : null;

    if (expectsResponse && deferred && 'id' in payload) {
      pending.set(String(payload.id), deferred);
    }

    try {
      const postResponse = await requestMcpHttp(endpoint, {
        method: 'POST',
        headers: buildMcpServerHeaders(options.server, {
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify(payload),
        signal: controller.signal
      }, options);

      if (!postResponse.ok) {
        const errorText = await postResponse.text().catch(() => '');
        throw new Error(`调用 MCP SSE 服务失败：HTTP ${postResponse.status}${errorText ? ` · ${errorText.trim()}` : ''}`);
      }

      const contentType = postResponse.headers.get('content-type')?.toLowerCase() ?? '';
      if (expectsResponse && contentType.includes('application/json')) {
        const parsed = await postResponse.json().catch(() => null);
        return ensureSuccessMessage(
          findResponseMessage(parsed, (payload as JsonRpcRequest).id),
          `调用 MCP SSE 服务 ${options.server.name}`
        );
      }

      if (!expectsResponse || !deferred) {
        return null;
      }

      return ensureSuccessMessage(
        await withTimeout(
          deferred.promise,
          options.timeoutMs,
          `等待 MCP SSE 服务 ${options.server.name} 返回结果`
        ),
        `调用 MCP SSE 服务 ${options.server.name}`
      );
    } finally {
      globalThis.clearTimeout(timeoutId);
      if (expectsResponse && 'id' in payload) {
        pending.delete(String(payload.id));
      }
    }
  };

  return {
    request,
    close: () => {
      closeStream();
      pending.forEach((entry) => entry.reject(new Error('MCP SSE 连接已关闭。')));
      pending.clear();
    }
  };
}

async function initializeLegacySseConnection(options: McpTransportOptions) {
  const connection = await openLegacySseConnection(options);
  try {
    const initializeResponse = ensureSuccessMessage(
      await connection.request({
        jsonrpc: '2.0',
        id: createRpcId(),
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: MCP_CLIENT_INFO
        }
      }, true),
      `初始化 MCP SSE 服务 ${options.server.name}`
    );

    await connection.request({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, false);

    return {
      connection,
      protocolVersion:
        typeof (initializeResponse.result as InitializeResult | undefined)?.protocolVersion === 'string'
          ? ((initializeResponse.result as InitializeResult).protocolVersion as string)
          : MCP_PROTOCOL_VERSION
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}

export async function openLegacySseSession(
  options: McpTransportOptions
): Promise<McpSessionConnection> {
  const { connection } = await initializeLegacySseConnection(options);
  return {
    request: async (payload, label) => ensureSuccessMessage(
      await connection.request(payload, true),
      label
    ),
    close: async () => {
      connection.close();
    }
  };
}
