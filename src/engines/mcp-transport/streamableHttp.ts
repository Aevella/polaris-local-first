import { buildMcpServerHeaders, requestMcpHttp } from './http';
import {
  createRpcId,
  createTimeoutError,
  ensureSuccessMessage,
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  parseHttpJsonRpcResponse
} from './protocol';
import type {
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  McpSessionConnection,
  McpTransportOptions
} from './types';

type StreamableSession = {
  endpoint: string;
  protocolVersion: string;
  sessionId?: string;
};

async function postStreamableJsonRpc(
  payload: JsonRpcRequest | JsonRpcNotification,
  options: McpTransportOptions & Partial<StreamableSession> & { label: string }
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(createTimeoutError(options.label, options.timeoutMs)),
    options.timeoutMs
  );

  try {
    const headers = buildMcpServerHeaders(options.server, {
      'Content-Type': 'application/json',
      ...(options.protocolVersion ? { 'MCP-Protocol-Version': options.protocolVersion } : {}),
      ...(options.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {})
    });

    return await requestMcpHttp(options.endpoint ?? options.server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }, options);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function initializeStreamableSession(
  options: McpTransportOptions
): Promise<StreamableSession> {
  const requestId = createRpcId();
  const response = await postStreamableJsonRpc({
    jsonrpc: '2.0',
    id: requestId,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO
    }
  }, {
    ...options,
    endpoint: options.server.url,
    label: `初始化 MCP 服务 ${options.server.name}`
  });
  const sessionId = response.headers.get('Mcp-Session-Id') ?? undefined;
  const message = ensureSuccessMessage(
    await parseHttpJsonRpcResponse(response, requestId, `初始化 MCP 服务 ${options.server.name}`),
    `初始化 MCP 服务 ${options.server.name}`
  );
  const result = (message.result ?? {}) as InitializeResult;
  const protocolVersion = typeof result.protocolVersion === 'string' && result.protocolVersion.trim()
    ? result.protocolVersion
    : MCP_PROTOCOL_VERSION;

  await postStreamableJsonRpc({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }, {
    ...options,
    endpoint: options.server.url,
    protocolVersion,
    sessionId,
    label: `确认 MCP 服务 ${options.server.name} 初始化`
  }).catch(() => null);

  return {
    endpoint: options.server.url,
    protocolVersion,
    sessionId
  };
}

async function closeStreamableSession(
  options: McpTransportOptions & StreamableSession
) {
  if (!options.sessionId) return;
  try {
    await requestMcpHttp(options.endpoint, {
      method: 'DELETE',
      headers: buildMcpServerHeaders(options.server, {
        'MCP-Protocol-Version': options.protocolVersion,
        'Mcp-Session-Id': options.sessionId
      })
    }, options);
  } catch {
    // Session close is best-effort because the remote may already be gone.
  }
}

async function requestStreamableJsonRpc(
  payload: JsonRpcRequest,
  options: McpTransportOptions & StreamableSession & { label: string }
) {
  const response = await postStreamableJsonRpc(payload, options);
  return ensureSuccessMessage(
    await parseHttpJsonRpcResponse(response, payload.id, options.label),
    options.label
  );
}

export async function openStreamableHttpSession(
  options: McpTransportOptions
): Promise<McpSessionConnection> {
  const session = await initializeStreamableSession(options);
  return {
    request: async (payload, label) => await requestStreamableJsonRpc(payload, {
      ...options,
      ...session,
      label
    }),
    close: async () => {
      await closeStreamableSession({
        ...options,
        ...session
      });
    }
  };
}
