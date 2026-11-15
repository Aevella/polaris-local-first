import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { McpAuthorizationChallenge } from '../mcp-transport/protocol';
import { requestBrowserMcpRelay, shouldUseBrowserMcpRelay } from '../mcp-http/browserRelay';
import type { McpOAuthFetch, McpOAuthServer } from './types';

export type McpProtectedResourceMetadata = {
  resource: string;
  authorizationServers: string[];
  scopesSupported?: string[];
};

export type McpAuthorizationServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  codeChallengeMethodsSupported: string[];
};

export function assertSecureOAuthUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`${label} 必须使用 HTTPS。`);
  }
  return url.toString();
}

async function requestOAuth(
  url: string,
  init: RequestInit,
  fetchImpl?: McpOAuthFetch
) {
  if (shouldUseBrowserMcpRelay(url, fetchImpl)) {
    return await requestBrowserMcpRelay(url, init);
  }
  if (fetchImpl || !Capacitor.isNativePlatform()) {
    const resolved = fetchImpl ?? globalThis.fetch;
    if (!resolved) throw new Error('当前环境没有 fetch，无法完成 MCP 授权。');
    return await resolved(url, init);
  }

  const headers = new Headers(init.headers);
  const result = await CapacitorHttp.request({
    url,
    method: init.method ?? 'GET',
    headers: Object.fromEntries(headers.entries()),
    data: typeof init.body === 'string' ? init.body : undefined,
    responseType: 'text'
  });
  const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? null);
  return new Response(body, { status: result.status, headers: result.headers });
}

async function requestJson(url: string, init: RequestInit, fetchImpl?: McpOAuthFetch) {
  const response = await requestOAuth(url, init, fetchImpl);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`MCP OAuth 请求失败：HTTP ${response.status}${bodyText ? ` · ${bodyText}` : ''}`);
  }
  try {
    return JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new Error('MCP OAuth 服务返回了无法识别的 JSON。');
  }
}

function normalizeComparableResource(value: string) {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export async function discoverProtectedResource(args: {
  server: McpOAuthServer;
  challenge: McpAuthorizationChallenge;
  fetchImpl?: McpOAuthFetch;
}): Promise<McpProtectedResourceMetadata> {
  const metadataUrls = args.challenge.resourceMetadataUrl
    ? [assertSecureOAuthUrl(args.challenge.resourceMetadataUrl, 'MCP resource_metadata 地址')]
    : protectedResourceMetadataUrls(args.server.url);
  let metadata: Record<string, unknown> | null = null;
  let lastError: unknown = null;
  for (const metadataUrl of metadataUrls) {
    try {
      metadata = await requestJson(metadataUrl, {
        headers: { Accept: 'application/json' }
      }, args.fetchImpl);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!metadata) {
    throw lastError instanceof Error
      ? lastError
      : new Error('无法发现 MCP OAuth resource metadata。');
  }
  const resource = typeof metadata.resource === 'string' ? metadata.resource : '';
  const authorizationServers = Array.isArray(metadata.authorization_servers)
    ? metadata.authorization_servers.filter((value): value is string => typeof value === 'string')
    : [];
  const scopesSupported = Array.isArray(metadata.scopes_supported)
    ? metadata.scopes_supported.filter((value): value is string => typeof value === 'string')
    : undefined;

  if (!resource || !authorizationServers.length) {
    throw new Error('MCP resource_metadata 缺少 resource 或 authorization_servers。');
  }
  if (normalizeComparableResource(resource) !== normalizeComparableResource(args.server.url)) {
    throw new Error('MCP OAuth 资源标识与当前服务器地址不一致，已停止授权。');
  }
  authorizationServers.forEach((value) => assertSecureOAuthUrl(value, 'OAuth authorization server'));

  return {
    resource,
    authorizationServers,
    ...(scopesSupported ? { scopesSupported } : {})
  };
}

export function protectedResourceMetadataUrls(resource: string) {
  const url = new URL(resource);
  const resourcePath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return Array.from(new Set([
    `${url.origin}/.well-known/oauth-protected-resource${resourcePath}`,
    `${url.origin}/.well-known/oauth-protected-resource`
  ]));
}

export function authorizationServerMetadataUrls(issuer: string) {
  const url = new URL(issuer);
  const issuerPath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return [
    `${url.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${url.origin}/.well-known/openid-configuration${issuerPath}`
  ];
}

export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl?: McpOAuthFetch
): Promise<McpAuthorizationServerMetadata> {
  let lastError: unknown = null;
  for (const metadataUrl of authorizationServerMetadataUrls(issuer)) {
    try {
      const metadata = await requestJson(metadataUrl, {
        headers: { Accept: 'application/json' }
      }, fetchImpl);
      const metadataIssuer = typeof metadata.issuer === 'string' ? metadata.issuer : '';
      const authorizationEndpoint = typeof metadata.authorization_endpoint === 'string'
        ? metadata.authorization_endpoint
        : '';
      const tokenEndpoint = typeof metadata.token_endpoint === 'string' ? metadata.token_endpoint : '';
      const registrationEndpoint = typeof metadata.registration_endpoint === 'string'
        ? metadata.registration_endpoint
        : undefined;
      const codeChallengeMethodsSupported = Array.isArray(metadata.code_challenge_methods_supported)
        ? metadata.code_challenge_methods_supported.filter((value): value is string => typeof value === 'string')
        : [];

      if (!metadataIssuer || !authorizationEndpoint || !tokenEndpoint) {
        throw new Error('授权服务器元数据缺少 issuer、authorization_endpoint 或 token_endpoint。');
      }
      if (normalizeComparableResource(metadataIssuer) !== normalizeComparableResource(issuer)) {
        throw new Error('授权服务器 issuer 与发现地址不一致。');
      }
      if (!codeChallengeMethodsSupported.includes('S256')) {
        throw new Error('授权服务器没有声明支持 PKCE S256。');
      }

      return {
        issuer: metadataIssuer,
        authorizationEndpoint: assertSecureOAuthUrl(authorizationEndpoint, 'OAuth authorization_endpoint'),
        tokenEndpoint: assertSecureOAuthUrl(tokenEndpoint, 'OAuth token_endpoint'),
        ...(registrationEndpoint
          ? { registrationEndpoint: assertSecureOAuthUrl(registrationEndpoint, 'OAuth registration_endpoint') }
          : {}),
        codeChallengeMethodsSupported
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法发现 MCP OAuth 授权服务器。');
}

export async function registerPublicClient(args: {
  registrationEndpoint: string;
  redirectUri: string;
  fetchImpl?: McpOAuthFetch;
}) {
  const response = await requestJson(args.registrationEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_name: 'Polaris',
      redirect_uris: [args.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  }, args.fetchImpl);
  const clientId = typeof response.client_id === 'string' ? response.client_id.trim() : '';
  if (!clientId) throw new Error('OAuth 动态客户端注册没有返回 client_id。');
  if (typeof response.client_secret === 'string' && response.client_secret) {
    throw new Error('该授权服务器要求客户端密钥，Polaris 不会在移动端保存 OAuth client_secret。');
  }
  return clientId;
}

export async function requestOAuthToken(args: {
  tokenEndpoint: string;
  body: URLSearchParams;
  fetchImpl?: McpOAuthFetch;
}) {
  return await requestJson(args.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: args.body.toString()
  }, args.fetchImpl);
}
