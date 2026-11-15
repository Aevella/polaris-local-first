import { lookup } from 'node:dns/promises';
import { isPrivateHostname } from '../src/engines/chat-api/providerRelayShared.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE']);
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'origin',
  'referer',
  'transfer-encoding'
]);
const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'connection',
  'content-length',
  'set-cookie',
  'transfer-encoding'
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SAFE_REDIRECTS = 10;

type RelayAddressRecord = { address: string };

export type McpRelayRequest = {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

type McpRelayOptions = {
  fetchImpl?: typeof fetch;
  lookupAddress?: (hostname: string) => Promise<RelayAddressRecord[]>;
};

export class McpRelayTargetError extends Error {
  constructor(message = 'MCP Web relay 只接受公开 HTTPS 地址。') {
    super(message);
    this.name = 'McpRelayTargetError';
  }
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

async function resolveAddresses(hostname: string) {
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new McpRelayTargetError('MCP Web relay 目标域名无法解析。');
  }
}

export async function validateMcpRelayTarget(
  endpoint: string,
  lookupAddress: (hostname: string) => Promise<RelayAddressRecord[]> = resolveAddresses
) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new McpRelayTargetError();
  }
  const hostname = normalizeAddress(parsed.hostname);
  if (parsed.protocol !== 'https:' || isPrivateHostname(hostname)) {
    throw new McpRelayTargetError();
  }
  const addresses = await lookupAddress(hostname);
  if (!addresses.length || addresses.some((record) => isPrivateHostname(normalizeAddress(record.address)))) {
    throw new McpRelayTargetError('MCP Web relay 目标解析到了本地或内网地址。');
  }
  return parsed.toString();
}

function sanitizeRequestHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([rawName, value]) => {
    const name = rawName.trim().toLowerCase();
    if (!name || !value || FORBIDDEN_REQUEST_HEADERS.has(name)) return false;
    if (name.startsWith('proxy-') || name.startsWith('sec-') || name.startsWith('x-forwarded-')) return false;
    return true;
  }));
}

function sanitizeResponseHeaders(headers: Headers) {
  return Object.fromEntries(Array.from(headers.entries()).filter(([rawName]) => {
    const name = rawName.trim().toLowerCase();
    return Boolean(name) && !FORBIDDEN_RESPONSE_HEADERS.has(name) && !name.startsWith('proxy-');
  }));
}

function redirectRequest(response: Response, current: McpRelayRequest) {
  const location = response.headers.get('location');
  if (!location || !REDIRECT_STATUSES.has(response.status)) return null;
  const endpoint = new URL(location, current.endpoint).toString();
  const changesToGet = response.status === 303
    || ((response.status === 301 || response.status === 302) && current.method === 'POST');
  const crossesOrigin = new URL(endpoint).origin !== new URL(current.endpoint).origin;
  const headers = crossesOrigin
    ? Object.fromEntries(Object.entries(current.headers).filter(([name]) => {
        const normalized = name.trim().toLowerCase();
        return normalized === 'accept' || normalized === 'content-type';
      }))
    : current.headers;
  return {
    ...current,
    endpoint,
    headers,
    ...(changesToGet ? { method: 'GET', body: null } : {})
  };
}

export async function relayMcpRequest(
  request: McpRelayRequest,
  options: McpRelayOptions = {}
): Promise<Response> {
  const method = request.method.trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new McpRelayTargetError('MCP Web relay 只允许 GET、POST 和 DELETE。');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('MCP Web relay 当前没有 fetch。');
  const lookupAddress = options.lookupAddress ?? resolveAddresses;
  let current: McpRelayRequest = {
    ...request,
    method,
    headers: sanitizeRequestHeaders(request.headers),
    body: method === 'GET' ? null : request.body
  };

  for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
    current.endpoint = await validateMcpRelayTarget(current.endpoint, lookupAddress);
    const response = await fetchImpl(current.endpoint, {
      method: current.method,
      headers: current.headers,
      ...(current.body === null ? {} : { body: current.body }),
      redirect: 'manual'
    });
    const redirected = redirectRequest(response, current);
    if (redirected) {
      if (redirectCount === MAX_SAFE_REDIRECTS) {
        throw new McpRelayTargetError('MCP Web relay 的安全重定向次数过多。');
      }
      current = redirected;
      continue;
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeResponseHeaders(response.headers)
    });
  }
  throw new McpRelayTargetError('MCP Web relay 的安全重定向次数过多。');
}
