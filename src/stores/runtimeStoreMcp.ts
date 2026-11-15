import { createUid } from '../engines/id';
import { buildMcpHandle } from '../engines/mcpHandle';
import type {
  McpServerConfig,
  McpServerHeader,
  McpServerToolConfig,
  McpServerTransport
} from '../types/domain';

export type RuntimeMcpState = {
  mcpServers: McpServerConfig[];
  mcpToolTimeoutSeconds: number;
};

type McpJsonPayload = {
  mcpServers?: Record<string, unknown>;
};

const DEFAULT_MCP_SERVER_TRANSPORT: McpServerTransport = 'streamable-http';
export const DEFAULT_MCP_TOOL_TIMEOUT_SECONDS = 30;

export const DEFAULT_RUNTIME_MCP_STATE: RuntimeMcpState = {
  mcpServers: [],
  mcpToolTimeoutSeconds: DEFAULT_MCP_TOOL_TIMEOUT_SECONDS
};

function normalizePositiveInt(value: unknown, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeMcpTransport(value: unknown): McpServerTransport {
  if (typeof value !== 'string') return DEFAULT_MCP_SERVER_TRANSPORT;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'sse') return 'sse';
  if (
    normalized === 'streamable-http'
    || normalized === 'streamable_http'
    || normalized === 'streamablehttp'
    || normalized === 'http'
  ) {
    return 'streamable-http';
  }
  return DEFAULT_MCP_SERVER_TRANSPORT;
}

function normalizeMcpHeader(
  header: Partial<McpServerHeader> | null | undefined,
  index: number
): McpServerHeader {
  return {
    id: header?.id?.trim() || `header-${index + 1}`,
    key: header?.key?.trim() || '',
    value: header?.value ?? ''
  };
}

function normalizeMcpHeaders(value: unknown): McpServerHeader[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return normalizeMcpHeader(undefined, index);
        }
        const asHeader = entry as Partial<McpServerHeader>;
        return normalizeMcpHeader(asHeader, index);
      })
      .filter((header) => header.key || header.value);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([key, headerValue], index) =>
      normalizeMcpHeader({
        id: `header-${index + 1}`,
        key,
        value: typeof headerValue === 'string' ? headerValue : String(headerValue ?? '')
      }, index)
    )
    .filter((header) => header.key);
}

function createDefaultToolInputSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {}
  } satisfies Record<string, unknown>;
}

function normalizeMcpToolConfig(value: unknown): McpServerToolConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const tool = value as Partial<McpServerToolConfig> & Record<string, unknown>;
  const name = typeof tool.name === 'string' ? tool.name.trim() : '';
  if (!name) return null;
  const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
    ? tool.inputSchema as Record<string, unknown>
    : createDefaultToolInputSchema();

  return {
    name,
    description: typeof tool.description === 'string' ? tool.description.trim() : '',
    inputSchema,
    enabled: typeof tool.enabled === 'boolean' ? tool.enabled : true
  };
}

function normalizeMcpTools(value: unknown): McpServerToolConfig[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tools: McpServerToolConfig[] = [];
  for (const entry of value) {
    const tool = normalizeMcpToolConfig(entry);
    if (!tool || seen.has(tool.name)) continue;
    seen.add(tool.name);
    tools.push(tool);
  }
  return tools;
}

export function normalizeMcpServer(
  input?: Partial<McpServerConfig> | null,
  fallbackKey?: string
): McpServerConfig {
  const id = input?.id?.trim() || createUid('mcp');
  const handle = buildMcpHandle({
    handle: fallbackKey || input?.handle,
    name: input?.name,
    url: input?.url,
    id
  });

  return {
    id,
    handle,
    name: input?.name?.trim() || `@${handle}`,
    description: input?.description?.trim() || '',
    transport: normalizeMcpTransport(input?.transport),
    url: input?.url?.trim() || '',
    oauthClientId: input?.oauthClientId?.trim() || undefined,
    headers: normalizeMcpHeaders(input?.headers),
    tools: normalizeMcpTools(input?.tools),
    isActive: input?.isActive ?? true
  };
}

export function normalizeRuntimeMcpState(
  state?: Partial<RuntimeMcpState> | null
): RuntimeMcpState {
  const seenHandles = new Set<string>();
  const servers = (state?.mcpServers ?? [])
    .map((server) => normalizeMcpServer(server))
    .map((server, index) => {
      let nextHandle = server.handle;
      while (seenHandles.has(nextHandle)) {
        nextHandle = `${server.handle}_${index + 1}`;
      }
      seenHandles.add(nextHandle);
      return nextHandle === server.handle
        ? server
        : { ...server, handle: nextHandle };
    });

  return {
    mcpServers: servers,
    mcpToolTimeoutSeconds: normalizePositiveInt(
      state?.mcpToolTimeoutSeconds,
      DEFAULT_MCP_TOOL_TIMEOUT_SECONDS
    )
  };
}

export function mergeMcpServerPatch(
  server: McpServerConfig,
  patch: Partial<McpServerConfig>
): McpServerConfig {
  return normalizeMcpServer({
    ...server,
    ...patch,
    headers: patch.headers !== undefined ? patch.headers : server.headers,
    tools: patch.tools !== undefined ? patch.tools : server.tools
  });
}

export function serializeMcpServersToJson(servers: McpServerConfig[]) {
  const payload: McpJsonPayload = {
    mcpServers: Object.fromEntries(
      servers.map((server) => [
        buildMcpHandle({ handle: server.handle, name: server.name, url: server.url, id: server.id }),
        {
          name: server.name,
          transport: server.transport,
          url: server.url,
          oauthClientId: server.oauthClientId,
          description: server.description || undefined,
          headers: Object.fromEntries(
            server.headers
              .filter((header) => header.key.trim())
              .map((header) => [header.key.trim(), header.value])
          ),
          tools: (server.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description || undefined,
            inputSchema: tool.inputSchema,
            enabled: tool.enabled
          })),
          isActive: server.isActive
        }
      ])
    )
  };

  return JSON.stringify(payload, null, 2);
}

export function parseMcpServersJson(jsonText: string): McpServerConfig[] {
  const parsed = JSON.parse(jsonText) as McpJsonPayload;
  const serverEntries = parsed?.mcpServers;
  if (!serverEntries || typeof serverEntries !== 'object' || Array.isArray(serverEntries)) {
    throw new Error('JSON 里缺少合法的 mcpServers 对象。');
  }

  return normalizeRuntimeMcpState({
    mcpServers: Object.entries(serverEntries).map(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`mcpServers.${key} 不是合法对象。`);
      }
      const entry = value as Record<string, unknown>;
      return normalizeMcpServer({
        handle: key,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        description: typeof entry.description === 'string' ? entry.description : undefined,
        transport: normalizeMcpTransport(entry.transport ?? entry.type),
        url: typeof entry.url === 'string'
          ? entry.url
          : typeof entry.endpoint === 'string'
            ? entry.endpoint
            : '',
        oauthClientId: typeof entry.oauthClientId === 'string' ? entry.oauthClientId : undefined,
        headers: normalizeMcpHeaders(entry.headers),
        tools: normalizeMcpTools(entry.tools),
        isActive: typeof entry.isActive === 'boolean' ? entry.isActive : true
      }, key);
    })
  }).mcpServers;
}
