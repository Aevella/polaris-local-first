import type { McpServerConfig } from '../../types/domain';
import { openLegacySseSession } from './legacySse';
import { openStreamableHttpSession } from './streamableHttp';
import type { McpSessionConnection, McpTransportOptions } from './types';
import { createRpcId } from './protocol';

type McpSessionEntry = {
  fingerprint: string;
  connection?: McpSessionConnection;
  pending?: Promise<McpSessionConnection>;
  activeRequests: number;
  revalidation?: Promise<void>;
};

export type McpSessionAvailability = 'unknown' | 'connecting' | 'available' | 'unavailable';

const mcpSessions = new Map<string, McpSessionEntry>();
const mcpSessionAvailability = new Map<string, McpSessionAvailability>();
const fetchImplementationIds = new WeakMap<Function, number>();
let nextFetchImplementationId = 1;

function getFetchImplementationId(fetchImpl: typeof fetch | undefined) {
  if (!fetchImpl) return 'default';
  const existing = fetchImplementationIds.get(fetchImpl);
  if (existing) return String(existing);
  const next = nextFetchImplementationId;
  nextFetchImplementationId += 1;
  fetchImplementationIds.set(fetchImpl, next);
  return String(next);
}

function buildMcpSessionFingerprint(options: McpTransportOptions) {
  return JSON.stringify({
    id: options.server.id,
    transport: options.server.transport,
    url: options.server.url,
    headers: options.server.headers.map((header) => [header.key, header.value]),
    timeoutMs: options.timeoutMs,
    fetchImpl: getFetchImplementationId(options.fetchImpl)
  });
}

function createMcpSessionConnection(options: McpTransportOptions) {
  return options.server.transport === 'sse'
    ? openLegacySseSession(options)
    : openStreamableHttpSession(options);
}

async function closeMcpSessionEntry(entry: McpSessionEntry | undefined) {
  if (!entry) return;
  const connection = entry.connection ?? await entry.pending?.catch(() => undefined);
  await connection?.close();
}

export function getMcpSessionAvailability(serverId: string): McpSessionAvailability {
  return mcpSessionAvailability.get(serverId) ?? 'unknown';
}

export function markMcpSessionConnecting(serverId: string) {
  mcpSessionAvailability.set(serverId, 'connecting');
}

export function markMcpSessionUnavailable(serverId: string) {
  mcpSessionAvailability.set(serverId, 'unavailable');
}

export function invalidateMcpSession(
  serverId: string,
  nextAvailability: McpSessionAvailability = 'unavailable'
) {
  const entry = mcpSessions.get(serverId);
  mcpSessions.delete(serverId);
  mcpSessionAvailability.set(serverId, nextAvailability);
  void closeMcpSessionEntry(entry).catch(() => undefined);
}

export async function disposeMcpSession(
  serverId: string,
  nextAvailability: McpSessionAvailability = 'unavailable'
) {
  const entry = mcpSessions.get(serverId);
  mcpSessions.delete(serverId);
  mcpSessionAvailability.set(serverId, nextAvailability);
  await closeMcpSessionEntry(entry);
}

export async function getMcpSessionConnection(options: McpTransportOptions) {
  const fingerprint = buildMcpSessionFingerprint(options);
  const current = mcpSessions.get(options.server.id);
  if (current?.fingerprint === fingerprint) {
    if (current.connection) return current.connection;
    if (current.pending) return await current.pending;
  }

  if (current) {
    invalidateMcpSession(options.server.id, 'unknown');
  }

  const entry: McpSessionEntry = { fingerprint, activeRequests: 0 };
  markMcpSessionConnecting(options.server.id);
  const pending = createMcpSessionConnection(options)
    .then((connection) => {
      const trackedConnection: McpSessionConnection = {
        request: async (payload, label) => {
          entry.activeRequests += 1;
          try {
            return await connection.request(payload, label);
          } finally {
            entry.activeRequests -= 1;
          }
        },
        close: () => connection.close()
      };
      if (mcpSessions.get(options.server.id) === entry) {
        entry.connection = trackedConnection;
        entry.pending = undefined;
        mcpSessionAvailability.set(options.server.id, 'available');
      } else {
        void connection.close();
      }
      return trackedConnection;
    })
    .catch((error) => {
      if (mcpSessions.get(options.server.id) === entry) {
        mcpSessions.delete(options.server.id);
        markMcpSessionUnavailable(options.server.id);
      }
      throw error;
    });
  entry.pending = pending;
  mcpSessions.set(options.server.id, entry);
  return await pending;
}

// Foreground recovery checks idle connections only; an in-flight tool owns its
// outcome and must never be cancelled or replayed by lifecycle recovery.
export async function revalidateMcpSession(options: McpTransportOptions) {
  const connection = await getMcpSessionConnection(options);
  const entry = mcpSessions.get(options.server.id);
  if (!entry || entry.connection !== connection) return;
  if (entry.revalidation) return await entry.revalidation;
  if (entry.activeRequests > 0) return;

  const revalidation = (async () => {
    try {
      await connection.request({ jsonrpc: '2.0', id: createRpcId(), method: 'ping' },
        `确认 MCP 连接 · ${options.server.name}`);
    } catch {
      // A late probe must not discard a session created by a newer owner.
      if (mcpSessions.get(options.server.id) !== entry) return;
      if (entry.activeRequests > 0) return;
      invalidateMcpSession(options.server.id, 'unknown');
      await getMcpSessionConnection(options);
    }
  })();
  entry.revalidation = revalidation;
  try {
    await revalidation;
  } finally {
    entry.revalidation = undefined;
  }
}

export function reconcileMcpSessions(servers: McpServerConfig[]) {
  const activeServers = new Map(
    servers
      .filter((server) => server.isActive && server.url.trim())
      .map((server) => [server.id, server] as const)
  );

  for (const [serverId, entry] of mcpSessions) {
    const server = activeServers.get(serverId);
    if (!server) {
      void disposeMcpSession(serverId, 'unknown');
      continue;
    }
    const fingerprint = JSON.parse(entry.fingerprint) as {
      transport?: string;
      url?: string;
      headers?: Array<[string, string]>;
    };
    const currentConfig = JSON.stringify({
      transport: server.transport,
      url: server.url,
      headers: server.headers.map((header) => [header.key, header.value])
    });
    const connectedConfig = JSON.stringify({
      transport: fingerprint.transport,
      url: fingerprint.url,
      headers: fingerprint.headers
    });
    if (currentConfig !== connectedConfig) {
      void disposeMcpSession(serverId, 'unknown');
    }
  }
}

export async function closeAllMcpSessions() {
  const entries = [...mcpSessions.values()];
  mcpSessions.clear();
  mcpSessionAvailability.clear();
  await Promise.all(entries.map(closeMcpSessionEntry));
}
