import type { McpServerConfig } from '../../types/domain';

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type InitializeResult = {
  protocolVersion?: string;
  capabilities?: {
    tools?: unknown;
  };
};

export type McpTransportOptions = {
  server: McpServerConfig;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export type McpSessionConnection = {
  request: (payload: JsonRpcRequest, label: string) => Promise<JsonRpcMessage>;
  close: () => Promise<void>;
};
